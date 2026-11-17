/* UI-only shell for the verified 0.2.9 runtime resource copy.
 * Moves existing controls without replacing their IDs or processing handlers. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const q = s => document.querySelector(s);
  const svg = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const make = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
  const parameters = $('parameters'), rail = q('.left-panel');
  let syncToolOptions=()=>{}, syncPanelTabs=()=>{}, lastPropertiesKey='adjust';
  document.documentElement.classList.add('ui-studio');
  document.title = '薄荷人像 · 0.2.9 UI 开发预览';
  const symbols = {
    crop:'<path d="M6 3v15h15M3 6h15v15"/>',
    layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    repair:'<path d="m8 3 13 13a3 3 0 0 1-5 5L3 8a3 3 0 0 1 5-5Z"/><path d="m7 11 4-4m2 10 4-4m-7-3 .01.01M14 14l.01.01"/>',
    select:'<path d="M7 4H4v3m0 4v2m0 4v3h3m4 0h2m4 0h3v-3m0-4v-2m0-4V4h-3m-4 0h-2"/>',
    folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    background:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 6-7 5 6 3-4 4 5M16 7h.01"/>'
  };
  const defs=q('.icon-definitions defs');
  for(const [name,paths] of Object.entries(symbols)) { const s=document.createElementNS('http://www.w3.org/2000/svg','symbol');s.id=`i-${name}`;s.setAttribute('viewBox','0 0 24 24');s.innerHTML=paths;defs.append(s); }

  // Pull repair out of the long manual-tools form; keep every original node.
  const repair=make('details','parameter-section');repair.id='repairSection';
  repair.innerHTML='<summary><span>取样修复</span></summary>';
  const repairPanel=q('.manual-repair-panel');repairPanel.classList.add('section-content');
  repairPanel.querySelector('h3').hidden=true;repair.append(repairPanel);parameters.insertBefore(repair,$('healSection'));
  const done=$('manualDone');q('.right-footer').replaceChildren(done);
  done.title='退出当前手动工具并查看完整效果';
  $('resetBtn').textContent='全部重置';
  $('resetBtn').title='重置当前照片的全部调整，可撤销';
  $('resetBtn').setAttribute('aria-label','重置当前照片的全部调整，可撤销');

  const presetGroup=make('section','ui-preset-group');presetGroup.id='uiPresetGroup';
  presetGroup.append(q('.section-title'),$('presets'),$('namedPresets'));parameters.append(presetGroup);
  const projectGroup=make('section','ui-project-group');projectGroup.id='uiProjectGroup';
  projectGroup.append(q('.session-card'));parameters.append(projectGroup);
  const count=$('photoCount');count.classList.add('ui-count');q('.filmstrip-heading>div').append(count);
  const version=q('.version');version.textContent='0.2.9 · UI 开发预览';version.className='ui-version';q('.brand').append(version);
  const help=$('helpBtn');help.innerHTML=svg('info');help.title='使用指南与快捷键';help.setAttribute('aria-label',help.title);help.className='ui-rail-help';
  const nav=make('nav','ui-tool-nav');nav.setAttribute('aria-label','编辑工具');
  rail.replaceChildren(nav,help);

  const groups=[
    ['adjust','调色','sliders','曝光 / 色彩 / 细节',['colorSection','lightBalanceSection','levelsSection','advancedToneSection','sharpnessSection']],
    ['portrait','人像','face','人物选择与局部修饰',['skinSection','peopleSection','faceColorSection','shapeSection']],
    ['frame','构图','crop','裁剪 / 调平 / 透视',['framingSection','straightenSection','perspectiveSection','paddingSection']],
    ['repair','修复','repair','手动取样与纹理修复',['repairSection','healSection']],
    ['select','选区','select','选区与手动形变',['manualSection']],
    ['layers','图层','layers','调整 / 贴图 / 文字 / 绘画',['localSection','imageLayerSection','textSection','paintSection','redactionSection']],
    ['background','背景','background','人物分割与背景属性',['backgroundSection','learnedSection']],
    ['presets','预设','spark','参数配方与本地预设',['uiPresetGroup']],
    ['project','项目','folder','工程与恢复草稿',['uiProjectGroup']]
  ];
  const subtitle=make('p','ui-context-subtitle');q('.adjustment-header').after(subtitle);
  const title=q('.adjustment-header strong'), titleIcon=q('.adjustment-header svg use');
  const sections=new Map(), buttons=new Map();
  groups.forEach(([key,label,icon,desc,ids])=>{
    const b=make('button','ui-nav-button');b.type='button';b.dataset.uiCategory=key;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed','false');b.innerHTML=svg(icon)+`<span>${label}</span>`;nav.append(b);buttons.set(key,b);
    ids.forEach(id=>{const e=$(id);if(e)sections.set(e,key);});
    b.addEventListener('click',()=>{
      if(!done.disabled && key!==document.body.dataset.uiCategory)done.click();
      activate(key);
    });
  });
  // Preserve any future/unknown section visibly under the advanced background tab.
  Array.from(parameters.children).forEach(e=>{if(!sections.has(e))sections.set(e,'background');});
  function activate(key) {
    const g=groups.find(x=>x[0]===key);document.body.dataset.uiCategory=key;
    buttons.forEach((b,k)=>b.setAttribute('aria-pressed',String(k===key)));
    sections.forEach((k,e)=>e.classList.toggle('ui-group-hidden',k!==key));
    title.textContent=g[1];titleIcon.setAttribute('href',`#i-${g[2]}`);subtitle.textContent=g[3];
    $('faceStatus').classList.toggle('ui-group-hidden',key!=='portrait');
    $('resetBtn').classList.toggle('ui-group-hidden',['presets','project'].includes(key));
    parameters.scrollTop=0;
    if(key!=='layers')lastPropertiesKey=key;
    syncPanelTabs(key==='layers'?'layers':'properties');syncToolOptions();
  }
  // Start with just the common controls expanded.
  sections.forEach((key,e)=>{if(e.tagName==='DETAILS')e.open=['colorSection','skinSection','framingSection','repairSection','manualSection','localSection','backgroundSection'].includes(e.id);});
  activate('adjust');

  // Long explanatory text stays available under an explicit disclosure.
  for(const section of parameters.querySelectorAll('.section-content')) {
    const notes=Array.from(section.children).filter(e=>e.matches('p.control-note')&&!e.id&&e.textContent.length>90);
    if(notes.length){const d=make('details','ui-guidance');d.innerHTML='<summary>使用说明与边界</summary>';notes.forEach(n=>d.append(n));section.append(d);}
  }
  const welcome=$('welcome');welcome.querySelector('h1').textContent='打开图像';
  welcome.querySelector('.eyebrow').textContent='';
  welcome.querySelector('p').textContent='从本机打开照片，或将文件拖入画布。';
  $('welcomeImport').innerHTML=svg('import')+'选择文件…';
  welcome.querySelector('.drop-hint').textContent='JPG / PNG / WebP';
  q('.build-tag').textContent='STUDIO';
  q('.footer-local').innerHTML=svg('lock')+(window.desktop?'UI 开发预览':'浏览器预览')+' · 本地处理';
  q('.privacy-label').innerHTML=svg('lock')+'本地处理';
  $('backendBtn').title='模型与设备';

  // Real document actions, kept in the header rather than represented by fake menus.
  const documentActions=make('div','ui-document-actions');
  documentActions.append($('openProjectBtn'),$('saveProjectBtn'));q('.brand').after(documentActions);
  q('.toolbar-left').prepend(make('span','ui-document-icon'));
  q('.ui-document-icon').innerHTML=svg('photo');q('.toolbar-left').append($('imageDimensions'));

  // These tabs expose existing layer tools and actual undo/redo availability only.
  const panelTabs=make('nav','ui-panel-tabs');panelTabs.setAttribute('aria-label','面板');
  const panelButtons=new Map();
  for(const [key,label] of [['properties','属性'],['layers','图层'],['history','历史']]){
    const b=make('button','ui-panel-tab',label);b.type='button';b.dataset.uiPanel=key;b.setAttribute('aria-pressed','false');panelButtons.set(key,b);panelTabs.append(b);
  }
  q('.right-panel').prepend(panelTabs);
  const historyPanel=make('section','ui-history-panel ui-group-hidden');historyPanel.id='uiHistoryPanel';
  const historyUndo=$('undoBtn'),historyRedo=$('redoBtn');
  const historyActions=make('div','ui-history-actions');historyActions.append(historyUndo,historyRedo);
  historyUndo.innerHTML=svg('undo')+'<span>撤销</span>';historyRedo.innerHTML=svg('redo')+'<span>重做</span>';
  const historyStatus=make('p','control-note');historyStatus.id='uiHistoryStatus';historyStatus.setAttribute('role','status');
  historyPanel.append(historyActions,historyStatus,make('p','control-note','Ctrl+Z 撤销 · Ctrl+Shift+Z 重做。此处显示当前照片的编辑状态。'));
  parameters.append(historyPanel);sections.set(historyPanel,'history');
  const updateHistory=()=>{historyStatus.textContent=$('undoBtn').disabled?($('redoBtn').disabled?'当前没有可撤销或重做的调整。':'已撤销调整，可重做。'):($('redoBtn').disabled?'当前调整可撤销。':'当前调整可撤销，也可重做。');};
  for(const id of ['undoBtn','redoBtn'])new MutationObserver(updateHistory).observe($(id),{attributes:true,attributeFilter:['disabled']});updateHistory();
  syncPanelTabs=key=>panelButtons.forEach((b,k)=>b.setAttribute('aria-pressed',String(k===key)));
  panelButtons.get('properties').addEventListener('click',()=>buttons.get(lastPropertiesKey).click());
  panelButtons.get('layers').addEventListener('click',()=>buttons.get('layers').click());
  panelButtons.get('history').addEventListener('click',()=>{
    sections.forEach((k,e)=>e.classList.toggle('ui-group-hidden',k!=='history'));
    title.textContent='历史';titleIcon.setAttribute('href','#i-undo');subtitle.textContent='当前照片的撤销与重做';
    $('faceStatus').classList.add('ui-group-hidden');$('resetBtn').classList.add('ui-group-hidden');parameters.scrollTop=0;syncPanelTabs('history');
  });syncPanelTabs('properties');

  // Move the original parameter elements into a genuine tool-options bar.
  // No proxy values or duplicated processing handlers are introduced.
  const toolOptions=make('section','ui-tool-options');toolOptions.setAttribute('aria-label','当前工具选项');
  const optionTitle=make('strong','ui-options-title');const optionFields=make('div','ui-option-fields');
  toolOptions.append(optionTitle,optionFields);q('.app-header').after(toolOptions);
  const controlHomes=new Map();
  for(const id of ['repairRadius','repairHardness','repairStrength','selectionRadius','selectionFeather','liquifyRadius','liquifyStrength']){
    const control=$(id).closest('.control');const home=document.createComment(`UI option home: ${id}`);control.before(home);controlHomes.set(id,{control,home});
  }
  let shownOptionKey=null;
  syncToolOptions=()=>{
    const key=document.body.dataset.uiCategory;const group=groups.find(g=>g[0]===key);optionTitle.textContent=group?.[1]||'工具';
    let ids=[];
    if(key==='repair')ids=['repairRadius','repairHardness','repairStrength'];
    if(key==='select'){
      if(['liquifyPushTool','liquifyRestoreTool'].some(id=>$(id).getAttribute('aria-pressed')==='true'))ids=['liquifyRadius','liquifyStrength'];
      else ids=$('selectionLassoTool').getAttribute('aria-pressed')==='true'?['selectionFeather']:['selectionRadius','selectionFeather'];
    }
    const optionKey=`${key}:${ids.join(',')}`;
    if(optionKey!==shownOptionKey){
      for(const {control,home} of controlHomes.values())home.after(control);
      optionFields.replaceChildren();ids.forEach(id=>optionFields.append(controlHomes.get(id).control));
      if(!ids.length)optionFields.append(make('span','ui-option-hint',group?.[3]||'在属性面板中调整'));
      shownOptionKey=optionKey;
    }
    const active=['repairHealTool','repairCloneTool','repairSampleTool','selectionBrushTool','selectionLassoTool','liquifyPushTool','liquifyRestoreTool'].find(id=>$(id).getAttribute('aria-pressed')==='true');
    if(active)optionTitle.textContent=$(active).textContent;
  };syncToolOptions();

  // Keep the queue and reference management accessible without taking canvas space.
  const queue=make('details','ui-photo-drawer');queue.id='uiPhotoDrawer';
  const queueSummary=make('summary','ui-queue-summary');queueSummary.innerHTML=svg('photo')+'<span>照片队列</span>';
  queueSummary.append($('queueCount'));queue.append(queueSummary);
  for(const sel of ['.filmstrip-heading','.review-overview','#reviewHiddenCurrent','#photoReview','#filmstrip'])queue.append(q(sel));
  q('.editor-panel').append(queue);
  const pixel=q('.preview-pixel-inspector');projectGroup.append(pixel);
  const reference=q('.reference-toolbar');
  reference.id='uiReferenceToolbar';
  const referenceToggle=make('button','ui-reference-toggle','参考设置');
  referenceToggle.id='uiReferenceToggle';referenceToggle.type='button';
  referenceToggle.title='固定、替换或清除参考照片';
  referenceToggle.setAttribute('aria-controls',reference.id);
  referenceToggle.setAttribute('aria-expanded','false');
  q('.view-switch').append(referenceToggle);
  let referenceSettingsOpen=false;
  referenceToggle.addEventListener('click',()=>{
    referenceSettingsOpen=!referenceSettingsOpen;syncView();
  });
  function syncView(){
    const hasImage=!$('imageSurface').hidden||!$('referenceCompare').hidden;
    document.body.classList.toggle('ui-has-image',hasImage);
    referenceToggle.disabled=!hasImage;
    const showReference=referenceSettingsOpen&&hasImage;
    referenceToggle.setAttribute('aria-expanded',String(showReference));
    reference.classList.toggle('ui-group-hidden',!showReference);
    q('.right-footer').classList.toggle('ui-group-hidden',done.disabled);
  }
  new MutationObserver(syncView).observe($('imageSurface'),{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(syncView).observe($('referenceView'),{attributes:true,attributeFilter:['aria-pressed']});
  new MutationObserver(syncView).observe($('referenceCompare'),{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(syncView).observe(done,{attributes:true,attributeFilter:['disabled']});syncView();
  // Navigation follows shortcuts/tool activations as well as mouse clicks.
  for(const [id,key] of [['repairHealTool','repair'],['repairCloneTool','repair'],['repairSampleTool','repair'],['selectionBrushTool','select'],['selectionLassoTool','select'],['liquifyPushTool','select'],['liquifyRestoreTool','select']]){
    new MutationObserver(()=>{if($(id).getAttribute('aria-pressed')==='true'&&document.body.dataset.uiCategory!==key)activate(key);else syncToolOptions();}).observe($(id),{attributes:true,attributeFilter:['aria-pressed']});
  }
})();
