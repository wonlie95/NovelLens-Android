/* Windows 本地日语朗读。正文来自 data-jp，因此不读中文译文或 ruby 注音。 */
(() => {
  // Windows 使用 WebView2，Android 使用应用提供的同名消息桥。
  const nativeAvailable = !!window.chrome?.webview || !!window.AndroidBridge?.request;
  const bar = document.createElement('section');
  bar.className='speech-bar';bar.setAttribute('aria-label','日语朗读');
  bar.innerHTML='<button class="pagebtn" id="speechPlay">▶ 朗读当前页</button><button class="pagebtn" id="speechPause" disabled>暂停</button><button class="pagebtn" id="speechStop" disabled>停止</button><label>日语语音 <select id="speechVoice" aria-label="日语语音"></select></label><label>语速 <select id="speechRate" aria-label="朗读语速"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><span id="speechStatus" role="status">正在加载日语语音…</span>';
  $('.reading-shell').before(bar);
  const play=$('#speechPlay'),pause=$('#speechPause'),stop=$('#speechStop'),voice=$('#speechVoice'),rate=$('#speechRate'),label=$('#speechStatus');
  rate.value=['0.5','0.75','1','1.25','1.5','2'].includes(localStorage.getItem('novel-speech-rate'))?localStorage.getItem('novel-speech-rate'):'1';
  let queue=[],index=0,session=0,active=false,paused=false,timer=null,ready=false;
  let commands=Promise.resolve();

  // 所有本地语音命令串行执行，避免快速点击开始/停止造成旧请求覆盖新状态。
  function command(action,extra={}){
    const task=commands.catch(()=>{}).then(()=>getJson({type:'speech',action,...extra}));commands=task;return task;
  }
  function unmark(){reader.querySelectorAll('.speech-active').forEach(card=>card.classList.remove('speech-active'))}
  function controls(){play.disabled=!ready;pause.disabled=!active;stop.disabled=!active;pause.textContent=paused?'继续':'暂停';voice.disabled=active}
  function finish(text){clearTimeout(timer);active=false;paused=false;unmark();controls();label.textContent=text}
  function stopReading(text='已停止朗读'){
    session++;finish(text);queue=[];
    if(ready)command('stop').catch(error=>{label.textContent=error.message});
  }
  function fail(error,run){if(run!==session)return;session++;finish('朗读失败：'+error.message);command('stop').catch(()=>{})}
  async function poll(run){
    if(run!==session||!active)return;
    try{
      const state=await command('status');
      if(run!==session||!active)return;
      if(!paused&&!state.paused&&!state.speaking){index++;await speakNext(run)}
      else timer=setTimeout(()=>poll(run),250);
    }catch(error){fail(error,run)}
  }
  async function speakNext(run){
    if(run!==session)return;
    if(index>=queue.length){finish('本页朗读完成');return}
    const item=queue[index];unmark();item.card.classList.add('speech-active');
    item.card.scrollIntoView({behavior:'smooth',block:'nearest'});
    label.textContent=`正在朗读 ${index+1} / ${queue.length}`;
    try{await command('speak',{text:item.text,voice:voice.value,rate:Number(rate.value)});if(run===session)timer=setTimeout(()=>poll(run),300)}catch(error){fail(error,run)}
  }
  function startReading(items){
    if(!ready)return toast('请先安装或选择日语语音');
    if(!items.length)return toast('请先粘贴日文并开始阅读，或导入电子书');
    session++;clearTimeout(timer);queue=items;index=0;active=true;paused=false;controls();speakNext(session);
  }
  // 超长段落按长度分批送给语音服务，连续朗读时保留同一张原文卡片的定位。
  function itemsFor(cards){return cards.flatMap(card=>{const text=card.dataset.jp||'';const items=[];for(let n=0;n<text.length;n+=2000)items.push({card,text:text.slice(n,n+2000)});return items})}
  play.onclick=()=>startReading(itemsFor([...reader.querySelectorAll('.pair[data-jp]')]));
  stop.onclick=()=>stopReading();
  pause.onclick=async()=>{
    if(!active)return;const run=session;paused=!paused;controls();label.textContent=paused?'已暂停':`正在朗读 ${index+1} / ${queue.length}`;
    try{await command(paused?'pause':'resume')}catch(error){fail(error,run)}
  };
  rate.onchange=()=>{localStorage.setItem('novel-speech-rate',rate.value);if(active)startReading(queue.slice(index))};
  voice.onchange=()=>localStorage.setItem('novel-speech-voice',voice.value);

  function addSentenceButtons(){
    reader.querySelectorAll('.pair[data-jp]').forEach(card=>{
      if(card.querySelector('.speech-sentence'))return;
      const button=document.createElement('button');button.type='button';button.className='speech-sentence';button.textContent='▶ 朗读';button.title='朗读这句日文';button.disabled=!ready;
      button.onclick=()=>startReading(itemsFor([card]));card.append(button);
    });
    if(active&&queue[index]&&!reader.contains(queue[index].card))stopReading('页面已更换，朗读已停止');
  }
  const observer=new MutationObserver(addSentenceButtons);observer.observe(reader,{childList:true,subtree:true});addSentenceButtons();
  for(const id of ['translateBtn','prevPage','nextPage','clearBtn'])$('#'+id)?.addEventListener('click',()=>{if(active)stopReading('页面已更换，朗读已停止')},true);
  window.addEventListener('pagehide',()=>{if(ready)command('stop').catch(()=>{})});

  // 缺少日语包时明确提示，不回退为中文或英语语音。
  if(nativeAvailable){
    command('voices').then(voices=>{
      voice.replaceChildren();for(const item of voices)voice.add(new Option(item.name,item.id));
      const saved=localStorage.getItem('novel-speech-voice');if([...voice.options].some(option=>option.value===saved))voice.value=saved;
      ready=voices.length>0;label.textContent=ready?'就绪 · 离线日语朗读':'未检测到离线日语语音，请在手机系统的文字转语音设置中安装日语语音包';controls();
      reader.querySelectorAll('.speech-sentence').forEach(button=>button.disabled=!ready);
    }).catch(error=>{label.textContent='语音服务不可用：'+error.message;controls()});
  }else{label.textContent='请在应用中使用本地日语朗读';controls()}
})();
