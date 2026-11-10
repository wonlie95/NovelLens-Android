/* 小说伴读 1.9：免密钥翻译、手动生词和集中管理。沿用原存储键以保留复习统计。 */
(() => {
  const colors = {yellow:'#fae8a5',red:'#f5c8c5',green:'#cce5c6',blue:'#c6ddf5',purple:'#dfcef0'};
  const labels = {yellow:'黄色',red:'红色',green:'绿色',blue:'蓝色',purple:'紫色'};
  let manager = null;
  let tokenPromise = null;
  let tokenExpires = 0;

  // 从 Bing 免费翻译页获取当前会话参数；缓存短时间并在失败后刷新。
  async function microsoftToken() {
    if (!tokenPromise || Date.now() > tokenExpires) {
      tokenExpires = Date.now() + 8 * 60 * 1000;
      tokenPromise = hostRequest('https://cn.bing.com/translator').then(r => {
        const params=r.body.match(/params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/);
        const ig=r.body.match(/IG:"([^"]+)"/);
        const iid=r.body.match(/data-iid="([^"]+)"/);
        if (!r.ok || !params || !ig || !iid) throw Error('Bing 翻译会话暂不可用');
        const values=JSON.parse(params[1]);
        return {key:values[0],token:values[1],ig:ig[1],iid:iid[1]};
      }).catch(e => {tokenPromise=null;throw e});
    }
    return tokenPromise;
  }
  async function translateBing(text, sl, tl) {
    const token = await microsoftToken();
    const target = /^zh/i.test(tl) ? 'zh-Hans' : tl;
    const body=new URLSearchParams({fromLang:sl,text,to:target,token:token.token,key:String(token.key)}).toString();
    const data = await getJson({url:`https://cn.bing.com/ttranslatev3?isVertical=1&IG=${encodeURIComponent(token.ig)}&IID=${encodeURIComponent(token.iid)}`,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const result = data[0]?.translations?.[0]?.text;
    if (!result) {tokenPromise=null;throw Error('微软翻译未返回译文')}
    return result;
  }
  const originalTranslate = translate;
  const originalProviderInfo = providerInfo;
  providerInfo = provider => provider === 'bing' ? '微软 / Bing 免费翻译，无需个人密钥。' : provider === 'auto' ? '免费自动备用：Google → 微软 / Bing → MyMemory → Lingva。' : originalProviderInfo(provider);
  translate = async (text, sl='ja', tl='zh-CN') => {
    const provider = translationSettings().provider;
    if (provider === 'bing') return translateBing(text,sl,tl);
    if (provider !== 'auto') return originalTranslate(text,sl,tl);
    const services = [()=>translateGoogle(text,sl,tl),()=>translateBing(text,sl,tl),()=>translateMyMemory(text,sl,tl),()=>translateLingva(text,sl,tl)];
    const errors = [];
    for (const service of services) {
      try {const result=await service();if(result?.trim())return result;throw Error('没有返回译文')}
      catch(e){errors.push(e.message)}
    }
    throw Error('免费翻译暂不可用，请切换服务重试：'+errors.join('；'));
  };
  const providerSelect = $('#translationProvider');
  const bingOption = new Option('微软 / Bing（免费免密钥）','bing');
  providerSelect.insertBefore(bingOption,providerSelect.options[2]);
  providerSelect.options[0].textContent='免费自动备用（Google → 微软 / Bing → 其他）';
  providerSelect.value=translationSettings().provider;
  updateProviderUI();

  function commit() {persistVocabulary();renderVocabulary();refreshKnownHighlights();if(manager)renderManager()}
  function makeButton(text, action, className='pagebtn') {const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;button.onclick=action;return button}
  function colorSelect(value) {const select=document.createElement('select');for(const key of Object.keys(colors))select.add(new Option(labels[key],key));select.value=colors[value]?value:'yellow';return select}

  // 添加和编辑共用表单，只改用户内容，不重置已经积累的记忆次数。
  openVocabularyEditor = (entry=null) => {
    const overlay=document.createElement('div');overlay.className='vocab-editor';
    overlay.innerHTML='<form class="vocab-editor-card enhanced-editor"><h3></h3><label>词语<input name="word" required maxlength="200"></label><label>读音<input name="reading"></label><label>释义与用法<textarea name="meaning"></textarea></label><label>备注 / 自定义记号<textarea name="note"></textarea></label><label class="color-field">标记颜色</label><label class="star-field"><input type="checkbox" name="starred"> ★ 重点标记</label><div class="editor-buttons"><button type="button" class="cancel">取消</button><button class="confirm">保存</button></div></form>';
    const form=overlay.querySelector('form'),fields=form.elements;
    overlay.querySelector('h3').textContent=entry?'编辑生词':'手动添加生词';
    for(const key of ['word','reading','meaning','note'])fields[key].value=entry?.[key]||'';
    fields.starred.checked=!!entry?.starred;
    const color=colorSelect(entry?.color);form.querySelector('.color-field').append(color);
    const close=()=>overlay.remove();form.querySelector('.cancel').onclick=close;
    overlay.onclick=e=>{if(e.target===overlay)close()};
    form.onsubmit=e=>{
      e.preventDefault();const word=normalizeWord(fields.word.value);
      if(!word)return toast('请输入词语');
      if(vocabulary.some(v=>v!==entry&&normalizeWord(v.word)===word))return toast('生词本中已有这个词');
      const target=entry||{addedAt:Date.now(),remembered:0,forgotten:0};
      Object.assign(target,{word,reading:fields.reading.value.trim(),meaning:fields.meaning.value.trim()||'暂无释义',note:fields.note.value.trim(),color:color.value,starred:fields.starred.checked});
      if(!entry)vocabulary.unshift(target);
      commit();close();toast('生词已保存');
    };
    document.body.append(overlay);fields.word.focus();
  };
  // 用标记颜色增强原来的完整短语匹配，避免重新引入分词依赖。
  const originalRenderJapanese=renderJapanese;
  renderJapanese=(container,text)=>{originalRenderJapanese(container,text);container.querySelectorAll('.known').forEach(span=>{const entry=vocabulary.find(v=>normalizeWord(v.word)===span.textContent);span.style.background=colors[entry?.color]||colors.yellow;span.title=entry?.note||''})};
  const originalRenderVocabulary=renderVocabulary;
  renderVocabulary=()=>{originalRenderVocabulary();const query=($('#vocabSearch').value||'').trim().toLowerCase();const shown=vocabulary.filter(v=>!query||[v.word,v.reading,v.meaning].join(' ').toLowerCase().includes(query));$('#vocabList').querySelectorAll('.vocab-item').forEach((item,index)=>{const entry=shown[index];if(!entry)return;item.style.borderLeft='5px solid '+(colors[entry.color]||colors.yellow);if(entry.starred)item.querySelector('.vocab-word').prepend('★ ');if(entry.note){const note=document.createElement('div');note.className='review-stats';note.textContent=entry.note;item.append(note)}})};

  // 集中管理采用可调整大小的窗口；搜索、颜色筛选和排序都只影响展示，不丢失词条。
  function renderManager() {
    if(!manager)return;
    const query=manager.querySelector('[name=query]').value.trim().toLowerCase();
    const filter=manager.querySelector('[name=filter]').value;
    const sort=manager.querySelector('[name=sort]').value;
    let entries=vocabulary.filter(v=>(!query||[v.word,v.reading,v.meaning,v.note].join(' ').toLowerCase().includes(query))&&(!filter||(filter==='star'?v.starred:(v.color||'yellow')===filter)));
    entries=entries.slice().sort((a,b)=>sort==='word'?a.word.localeCompare(b.word,'ja'):sort==='forgotten'?reviewCounts(b).forgotten-reviewCounts(a).forgotten:sort==='remembered'?reviewCounts(a).remembered-reviewCounts(b).remembered:sort==='color'?(a.color||'yellow').localeCompare(b.color||'yellow'):(b.addedAt||0)-(a.addedAt||0));
    manager.querySelector('.manager-count').textContent=`显示 ${entries.length} / ${vocabulary.length} 个生词`;
    const body=manager.querySelector('tbody');body.replaceChildren();
    for(const entry of entries){const row=document.createElement('tr');row.style.borderLeft='5px solid '+(colors[entry.color]||colors.yellow);
      const values=[(entry.starred?'★ ':'')+entry.word,entry.reading||'—',entry.meaning||'—',entry.note||'—',`记得 ${reviewCounts(entry).remembered} / 不记得 ${reviewCounts(entry).forgotten}`];
      for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}
      const mark=document.createElement('td'),select=colorSelect(entry.color);select.onchange=()=>{entry.color=select.value;commit()};mark.append(select,makeButton(entry.starred?'取消重点':'★ 重点',()=>{entry.starred=!entry.starred;commit()}));row.append(mark);
      const actions=document.createElement('td');actions.append(makeButton('编辑',()=>openVocabularyEditor(entry)),makeButton('删除',()=>{if(confirm(`删除「${entry.word}」？`)){vocabulary=vocabulary.filter(v=>v!==entry);commit()}}));row.append(actions);body.append(row);
    }
  }
  function openManager(){
    if(manager)return;
    const overlay=document.createElement('div');overlay.className='vocab-editor manager-overlay';
    overlay.innerHTML='<section class="vocab-editor-card manager-window"><div class="manager-head"><h3>生词管理</h3><button class="pagebtn close-manager">关闭</button></div><div class="manager-toolbar"><input name="query" placeholder="搜索词语、读音、释义、备注"><select name="filter"><option value="">全部标记</option><option value="star">★ 重点词</option></select><select name="sort"><option value="new">最新添加</option><option value="word">日语词序</option><option value="color">按颜色排列</option><option value="forgotten">不记得次数最多</option><option value="remembered">记得次数最少</option></select><button class="pagebtn add-word">＋ 添加生词</button></div><div class="manager-count"></div><div class="manager-table"><table><thead><tr><th>词语</th><th>读音</th><th>释义与用法</th><th>备注</th><th>复习统计</th><th>标记</th><th>操作</th></tr></thead><tbody></tbody></table></div></section>';
    manager=overlay;for(const key of Object.keys(colors))overlay.querySelector('[name=filter]').add(new Option(labels[key],key));
    overlay.querySelector('.close-manager').onclick=()=>{overlay.remove();manager=null};
    overlay.querySelector('.add-word').onclick=()=>openVocabularyEditor();
    for(const name of ['query','filter','sort'])overlay.querySelector(`[name=${name}]`).addEventListener(name==='query'?'input':'change',renderManager);
    document.body.append(overlay);renderManager();
  }
  const toolbar=document.createElement('div');toolbar.className='vocab-toolbar';toolbar.append(makeButton('＋ 添加生词',()=>openVocabularyEditor()),makeButton('整理全部生词',openManager));$('#vocabSearch').before(toolbar);
  $('#clearBtn').before(makeButton('生词管理',openManager,'ghost'));
  renderVocabulary();refreshKnownHighlights();
})();
