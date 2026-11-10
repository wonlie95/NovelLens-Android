/* 本地注音仅改变显示层；原文和完整短语高亮仍由现有阅读器维护。 */
(() => {
  const hasKanji = text => /[\p{Script=Han}々〆]/u.test(text);
  const hiragana = text => text.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0x60));
  const previousRender = renderJapanese;
  let enabled = localStorage.getItem('novel-furigana') !== 'off';
  let tokenizer = null, loading = null;
  const cache = new Map();
  const button = document.createElement('button');
  button.type='button';button.id='furiganaBtn';button.className='ghost';
  button.title='在汉字上方显示平假名；本地词典自动判断读音';
  $('#reviewBtn').before(button);
  function updateButton(){button.textContent=enabled?(tokenizer?'汉字注音：开':'注音准备中…'):'汉字注音：关';button.setAttribute('aria-pressed',String(enabled))}

  // 在整句上获取词典读音，按原文位置保留空格和标点；仅缓存最近 500 段。
  function tokenize(text){
    if(cache.has(text))return cache.get(text);
    const result=[];let cursor=0;
    for(const token of tokenizer.tokenize(text)){
      const at=text.indexOf(token.surface_form,cursor);if(at<0)continue;
      if(at>cursor)result.push({text:text.slice(cursor,at),start:cursor});
      result.push({text:token.surface_form,start:at,reading:token.reading&&token.reading!=='*'?hiragana(token.reading):''});cursor=at+token.surface_form.length;
    }
    if(cursor<text.length)result.push({text:text.slice(cursor),start:cursor});
    if(cache.size>=500)cache.delete(cache.keys().next().value);
    cache.set(text,result);return result;
  }
  // 以送假名为锚点，将「開ける」对齐为「開・あ」和「ける」，无法对齐时按整个词标注。
  function alignReading(surface, reading){
    const groups=surface.match(/[\p{Script=Han}々〆]+|[^\p{Script=Han}々〆]+/gu)||[];
    function align(index,offset){
      if(index===groups.length)return offset===reading.length?[]:null;
      const group=groups[index];
      if(!hasKanji(group)){const kana=hiragana(group);if(!reading.startsWith(kana,offset))return null;const tail=align(index+1,offset+kana.length);return tail?[{text:group,reading:''},...tail]:null}
      for(let end=offset+1;end<=reading.length;end++){const tail=align(index+1,end);if(tail)return [{text:group,reading:reading.slice(offset,end)},...tail]}
      return null;
    }
    return align(0,0)||[{text:surface,reading}];
  }
  // 保存原高亮区间；即使一个生词跨越多个注音词，也保留其每个汉字的高亮颜色。
  function markedRanges(container){let offset=0;const ranges=[];for(const child of container.childNodes){const length=child.textContent.length;if(child.nodeType===1&&child.classList.contains('known'))ranges.push({start:offset,end:offset+length,color:child.style.background,title:child.title});offset+=length}return ranges}
  function appendMarked(parent,text,start,ranges){
    let cursor=0;
    while(cursor<text.length){const absolute=start+cursor,range=ranges.find(r=>r.start<=absolute&&r.end>absolute);const next=range?Math.min(text.length,range.end-start):Math.min(text.length,...ranges.filter(r=>r.start>absolute).map(r=>r.start-start));const chunk=text.slice(cursor,next);
      if(range){const span=document.createElement('span');span.className='token known';span.style.background=range.color;span.title=range.title;span.textContent=chunk;parent.append(span)}else parent.append(document.createTextNode(chunk));cursor=next;
    }
  }
  renderJapanese=(container,text)=>{
    previousRender(container,text);if(!enabled||!tokenizer||!hasKanji(text))return;
    const ranges=markedRanges(container),fragment=document.createDocumentFragment();
    for(const token of tokenize(text)){
      if(!hasKanji(token.text)||!token.reading){appendMarked(fragment,token.text,token.start,ranges);continue}
      let offset=token.start;
      for(const part of alignReading(token.text,token.reading)){
        if(part.reading){const ruby=document.createElement('ruby');ruby.className='jp-ruby';const base=document.createElement('rb');appendMarked(base,part.text,offset,ranges);const rt=document.createElement('rt');rt.textContent=part.reading;rt.setAttribute('aria-hidden','true');ruby.append(base,rt);fragment.append(ruby)}else appendMarked(fragment,part.text,offset,ranges);offset+=part.text.length;
      }
    }
    container.replaceChildren(fragment);
  };
  function ensureTokenizer(){
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>kuromoji.builder({dicPath:'dict/'}).build((error,result)=>error?reject(error):resolve(result)))
      .then(result=>{tokenizer=result;updateButton();refreshKnownHighlights();return result})
      .catch(()=>{loading=null;enabled=false;localStorage.setItem('novel-furigana','off');updateButton();toast('本地注音词典加载失败，可点击汉字注音重试')});
    return loading;
  }
  button.onclick=()=>{enabled=!enabled;localStorage.setItem('novel-furigana',enabled?'on':'off');updateButton();refreshKnownHighlights();if(enabled&&!tokenizer)ensureTokenizer()};

  // 浏览器的 Range 文本可能混入 rt 注音；查词和复制时显式移除它，保留选中的汉字原文。
  function selectedOriginal(range){const fragment=range.cloneContents();fragment.querySelectorAll('rt,rp').forEach(node=>node.remove());return fragment.textContent}
  lookupSelection=()=>{
    const selection=getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return;
    const range=selection.getRangeAt(0),start=closestElement(range.startContainer),end=closestElement(range.endContainer);
    if(!start?.closest('.jp')||!end?.closest('.jp'))return;
    const word=normalizeWord(selectedOriginal(range)).replace(/^[^\p{L}\p{N}々〆ヶ]+|[^\p{L}\p{N}々〆ヶ]+$/gu,'');
    if(!word||!/[぀-ヿ㐀-鿿]/u.test(word))return;
    const rect=range.getBoundingClientRect();if(!rect.width&&!rect.height)return;selection.removeAllRanges();lookup(word,{getBoundingClientRect:()=>rect});
  };
  reader.addEventListener('copy',event=>{
    const selection=getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);
    if(!closestElement(range.startContainer)?.closest('.jp')||!closestElement(range.endContainer)?.closest('.jp'))return;
    event.clipboardData?.setData('text/plain',selectedOriginal(range));event.preventDefault();
  });
  updateButton();if(enabled)ensureTokenizer();
})();
