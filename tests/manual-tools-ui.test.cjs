'use strict';
// Executes shipped app functions with authored DOM/canvas/IPC doubles and the real
// project codec. This is not native-browser, model inference, or native-dialog QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
const Manual = require('../src/manual-tools.cjs'), Repair = require('../src/repair-brush-core.cjs');
const Codec = require('../src/project-document.cjs'), Learned = require('../src/learned-analysis.cjs');
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
const settle = async h => { for(let i=0;i<1000&&h.api.get().projectOperation;i++)await new Promise(resolve=>setTimeout(resolve,1));await flush();assert.equal(h.api.get().projectOperation,''); };
const defaults = structuredClone(Codec.DEFAULT_SETTINGS);
function png(width=100,height=80) {
  const crc = bytes => { let v=0xffffffff; for(const b of bytes){v^=b;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}return (v^0xffffffff)>>>0; };
  const chunk = (type,data) => { const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out; };
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]));
}
const sourceBytes=png();
function snapshot(id='restored',changes={}) {
  return {version:1,currentId:id,photos:[{id,name:`${id}.png`,sourceRevision:`${id}:source-0`,source:{bytes:new Uint8Array(sourceBytes),mime:'image/png',width:100,height:80},selected:false,settings:{...structuredClone(defaults),...changes},committed:{...structuredClone(defaults),...changes},undo:[structuredClone(defaults)],redo:[],revision:1,preset:null,learnedCache:[]}]};
}
function harness(overrides={}) {
  const elements=new Map(),events=new Map(),calls={saved:[],opens:0,confirm:0,decoded:[],encoded:[],dirty:[],urls:[],revoked:[],writes:[],model:0,renders:[],encodes:[],draws:[]};let sequence=0,timer=0;
  class Element {
    constructor(tag){this.id=tag;this.tag=tag;this.children=[];this.parent=null;this.dataset={};this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.value='';this.min='0';this.max='100';this.width=2;this.height=2;this.clientWidth=1000;this.clientHeight=700;this.listeners=new Map();this.open=false;}
    addEventListener(n,fn){this.listeners.set(n,fn);}setAttribute(){}insertAdjacentHTML(){}replaceChildren(...c){this.children=[];this.append(...c);}append(...c){for(const e of c){e.remove();this.children.push(e);e.parent=this;}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}focus(){}click(){return this.listeners.get('click')?.({target:this});}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(id){this.capture=null;}matches(){return false;}closest(selector){return selector===`#${this.id}`||selector==='.control'?this:null;}showModal(){this.open=true;}close(){this.open=false;}
    querySelector(s){return this.children.find(e=>s==='input'?e.tag==='input':s==='span'?e.tag==='span':e.className===s.slice(1))||new Element('stub');}
    getBoundingClientRect(){return {left:0,top:0,width:1000,height:700,right:1000,bottom:700};}
    toBlob(fn){fn(overrides.thumbnailFailure?.(++calls.thumbnailCount)?null:new Blob(['thumbnail'],{type:'image/jpeg'}));}
    getContext(){return {clearRect(){},drawImage:(canvas)=>calls.draws.push({target:this.id,canvas}),closePath(){},save(){},restore(){},beginPath(){},rect(){},clip(){},stroke(){},fill(){},arc(){},ellipse(){},lineTo(){},moveTo(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){},getImageData:(x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data[i*4]=120+i%13;data[i*4+1]=110+i%7;data[i*4+2]=100+i%5;data[i*4+3]=255;}return {width:w,height:h,data};}};}
  }
  calls.thumbnailCount=0;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});
  get('repairRadius').value='1.4';get('repairHardness').value='60';get('repairStrength').value='80';get('selectionMode').value='add';get('selectionRadius').value='3';get('selectionFeather').value='0';get('liquifyRadius').value='10';get('liquifyStrength').value='50';get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';get('matteRadius').value='4';get('matteHardness').value='100';get('matteOpacity').value='100';
  const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),
    decodeImage:async(blob,max)=>{calls.decoded.push({blob,max});const d=Codec.inspectImage(new Uint8Array(await blob.arrayBuffer()),blob.type);return {canvas:canvas(Math.min(d.width,max),Math.min(d.height,max)),originalWidth:d.width,originalHeight:d.height};},
    analyze:async()=>{calls.model++;return {faceCount:0,landmarks:[],mask:null};},render:async(c,settings,facts,options={})=>{calls.renders.push({canvas:c,settings:structuredClone(settings),facts,options});return canvas(c.width,c.height);},encode:async(c)=>{calls.encodes.push(c);return new Uint8Array(sourceBytes);},...overrides.pipeline};
  const bridge={saveProject:async payload=>{calls.saved.push(payload);return {canceled:false,displayName:'saved.mintproj'};},openProject:async()=>{calls.opens++;return {canceled:true};},confirmReplaceProject:async()=>{calls.confirm++;return true;},setSessionDirty:v=>calls.dirty.push(v),onMenuAction:fn=>events.set('menu',fn),chooseExportFolder:async()=>({token:'test',displayPath:'test folder'}),writeExport:async payload=>calls.writes.push(payload),...overrides.bridge};
  const codec={VERSION:Codec.VERSION,encode:async value=>{calls.encoded.push(structuredClone(value));return Codec.encode(structuredClone(value));},decode:bytes=>Codec.decode(bytes),...overrides.codec};
  const context=vm.createContext({Pipeline:pipeline,window:{desktop:bridge,MintManualPipeline:require('../src/manual-pipeline.cjs'),RepairBrushCore:overrides.repairCore===false?null:{...Repair,validate:(c,o)=>Repair.validate(structuredClone(c),{...o,manualTools:Manual}),resolveSource:(i,c,o)=>Repair.resolveSource(structuredClone(i),structuredClone(c),{...o,manualTools:Manual,selection:structuredClone(o.selection)}),apply:(i,c,o)=>Repair.apply(structuredClone(i),structuredClone(c),{...o,manualTools:Manual,selection:structuredClone(o.selection)})},MintManualTools:overrides.manualCore === false ? null : Object.fromEntries(['validateSelection','rasterizeSelection','validateLiquifyCommands','liquify'].map(key=>[key,(...args)=>Manual[key](...args.map(value=>structuredClone(value)))])),MintExportQueue:require('../src/export-queue.cjs'),PortraitEngine:require('../src/portrait-engine.cjs'),MintProjectDocument:codec,MintLearnedAnalysis:Learned,addEventListener:(n,fn)=>events.set(n,fn)},document:{getElementById:get,querySelectorAll:s=>s==='.photo-card'?get('filmstrip').children.filter(e=>e.className==='photo-card'):[],querySelector:s=>get('filmstrip').children.find(e=>s===`[data-photo-id="${e.dataset.photoId}"]`)||null,createElement:t=>new Element(t),body:new Element('body')},console,structuredClone,AbortController,Blob,Uint8Array,Float32Array,Uint8ClampedArray,ArrayBuffer,HTMLElement:Element,crypto:{randomUUID:()=>`photo-${++sequence}`},URL:{createObjectURL:()=>{const u=`blob:thumb-${++sequence}`;calls.urls.push(u);return u;},revokeObjectURL:u=>calls.revoked.push(u)},ResizeObserver:class{observe(){}},setTimeout:(fn,delay)=>++timer,clearTimeout(){},setInterval:()=>++timer,clearInterval(){}});
  let app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  app+='\nglobalThis.audit={setTool,renderCurrent,manualPoint,beginManualStroke,appendManualStroke,finishManualStroke,editSelection,updateManualControls,photos,saveProject,openProject,projectSnapshot,startExport,cancelExport,openExport,exportLimit,addLocalLayer,removeLocalLayer,moveLocalLayer,changeLocalLayer,selectedLocalLayer,updateLocalControls,drawPreview,hasUnsavedProjectChanges,projectFingerprint,changeSettings,undo,redo,activatePhoto,importFiles,removeSelected,startExport,updateAvailability,factsForPhoto,appendPhotoCard,set:(v)=>{if("manualViewReady"in v)manualViewReady=v.manualViewReady;if("originalHeld"in v)originalHeld=v.originalHeld;if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("modelState"in v)modelState=v.modelState;if("backendJob"in v)backendJob=v.backendJob;if("loadingPhoto"in v)loadingPhoto=v.loadingPhoto;if("analyzingPhoto"in v)analyzingPhoto=v.analyzingPhoto;if("renderingPhoto"in v)renderingPhoto=v.renderingPhoto;if("importing"in v)importing=v.importing;if("exportRunning"in v)exportRunning=v.exportRunning;if("matteDraft"in v)matteDraft=v.matteDraft;},get:()=>({repairSample,repairMode,manualDraft,manualViewReady,renderedManualMode,pointer,tool,rendered,exportQueue,exportFolder,exportRunning,projectOperation,projectDisplayName,currentId,source,analysis,matteDraft,loadingPhoto,savedProjectFingerprint})};';
  vm.runInContext(app,context);const api=context.audit;
  function photo(id='old',settings={}){const p={id,name:`${id}.png`,blob:new Blob([sourceBytes],{type:'image/png'}),thumb:`blob:old-${id}`,sourceRevision:`${id}:source-0`,originalWidth:100,originalHeight:80,selected:true,settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,preset:null,learnedCache:new Map()};api.photos.push(p);api.appendPhotoCard(p);return p;}
  function activate(p=photo()){api.set({currentId:p.id,source:canvas(100,80),analysis:null});api.updateAvailability();return p;}
  const fire=(id,name='click',extra={})=>get(id).listeners.get(name)?.({type:name,target:get(id),preventDefault(){},stopPropagation(){},...extra});
  return {api,photo,activate,calls,bridge,pipeline,codec,events,get,fire,canvas};
}


const plain = value => JSON.parse(JSON.stringify(value));
async function toolReady(h,name){h.api.setTool(name);await h.api.renderCurrent();assert.equal(h.api.get().manualViewReady,true);}
function stroke(h,points,end='pointerup',id=1){
  const event=([x,y])=>({pointerId:id,button:0,clientX:x*1000,clientY:y*700,target:h.get('imageSurface')});
  h.fire('viewport','pointerdown',event(points[0]));
  for(const point of points.slice(1,-1))h.fire('viewport','pointermove',event(point));
  if(end)h.fire('viewport',end,event(points.at(-1)));
}
test('manual UI: source-coordinate view is awaited, full effect settings remain unchanged, tool-off rerenders full output',async()=>{
  const h=harness(),p=h.activate(h.photo('one',{slim:40,bgMode:'color',bgColor:'#aaccee'}));
  h.api.setTool('selection-brush');stroke(h,[[0,0],[.2,.2]]);assert.equal(p.undo.length,0);assert.equal(h.api.get().manualDraft,null);
  await h.api.renderCurrent();assert.equal(h.calls.renders.at(-1).options.manualEditing,true);assert.equal(p.settings.slim,40);assert.equal(p.settings.bgMode,'color');assert.equal(h.api.get().manualViewReady,true);
  h.api.setTool('pan');await h.api.renderCurrent();assert.equal(h.calls.renders.at(-1).options.manualEditing,false);assert.equal(h.api.get().renderedManualMode,false);
});
test('manual UI: brush accepts zero coordinates and reversed strokes, commits once at pointerup and supports exact undo/redo',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[1,1],[.5,.5],[0,0]],null);assert.equal(p.undo.length,0);assert.equal(p.settings.manualSelection,null);
  h.fire('viewport','pointerup',{pointerId:1,clientX:0,clientY:0,target:h.get('imageSurface')});assert.equal(p.undo.length,1,h.get('toast').textContent);assert.deepEqual(plain(p.settings.manualSelection.commands[0].points),[{x:1,y:1},{x:.5,y:.5},{x:0,y:0}]);
  assert.equal(p.settings.manualSelection.sourceRevision,p.sourceRevision);const committed=plain(p.settings.manualSelection);h.fire('viewport','lostpointercapture',{pointerId:1});assert.equal(p.undo.length,1);
  h.api.undo();assert.equal(p.settings.manualSelection,null);h.api.redo();assert.deepEqual(plain(p.settings.manualSelection),committed);
});
for(const cancelled of ['pointercancel','lostpointercapture','escape','blur','fit','zoom','source-revision','original','export','save','change-tool'])test(`manual UI: ${cancelled} discards draft without settings/history/pixel commit`,async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'liquify-push');const before=JSON.stringify(p.settings),renders=h.calls.renders.length;
  stroke(h,[[.2,.2],[.4,.4],[.5,.5]],null);assert.ok(h.api.get().manualDraft);
  if(cancelled==='escape')h.events.get('keydown')({key:'Escape',target:h.get('viewport')});
  else if(cancelled==='blur')h.events.get('blur')();
  else if(cancelled==='fit')h.fire('fitBtn');
  else if(cancelled==='zoom')h.fire('zoomIn');
  else if(cancelled==='source-revision'){p.sourceRevision+='changed';h.fire('viewport','pointerup',{pointerId:1,clientX:500,clientY:350});}
  else if(cancelled==='original')h.events.get('keydown')({key:' ',code:'Space',target:h.get('viewport'),preventDefault(){}});
  else if(cancelled==='export')h.api.openExport();
  else if(cancelled==='save')await h.api.saveProject();
  else if(cancelled==='change-tool')h.api.setTool('selection-brush');
  else h.fire('viewport',cancelled,{pointerId:1});
  assert.equal(h.api.get().manualDraft,null);assert.equal(JSON.stringify(p.settings),before);assert.equal(p.undo.length,0);assert.equal(p.settings.manualLiquify.length,0);assert.equal(h.calls.renders.length,renders);
});
test('manual UI: wrong pointer, non-primary button and pointerdown during a stroke cannot commit or replace it',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'liquify-push');stroke(h,[[.2,.2],[.4,.4],[.5,.5]],null,7);const draft=h.api.get().manualDraft;
  h.fire('viewport','pointerup',{pointerId:8,clientX:500,clientY:350});assert.equal(p.undo.length,0);assert.equal(h.api.get().manualDraft,draft);
  h.fire('viewport','pointerdown',{pointerId:8,button:0,clientX:10,clientY:10,target:h.get('imageSurface')});assert.equal(h.api.get().manualDraft,draft);
  h.fire('viewport','pointercancel',{pointerId:7});h.fire('viewport','pointerdown',{pointerId:9,button:2,clientX:100,clientY:100,target:h.get('imageSurface')});assert.equal(h.api.get().manualDraft,null);
});
test('manual UI: lasso add/subtract, inverted semantics, feather, empty protection and clearing restriction are executable',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-lasso');stroke(h,[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]);assert.equal(p.settings.manualSelection.commands[0].kind,'lasso');assert.equal(p.settings.manualSelection.base,'none');
  h.fire('selectionInvert');assert.equal(p.settings.manualSelection.inverted,true);await h.api.renderCurrent();h.get('selectionMode').value='add';stroke(h,[[.2,.2],[.3,.2],[.3,.3]]);assert.equal(p.settings.manualSelection.commands.at(-1).mode,'subtract');
  h.get('selectionFeather').value='2.5';h.fire('selectionFeather','input');const old=p.settings.manualSelection.feather;assert.equal(old,0);h.fire('selectionFeather','change');assert.equal(p.settings.manualSelection.feather,.025);
  h.fire('selectionEmpty');assert.ok(Manual.rasterizeSelection(10,10,structuredClone(p.settings.manualSelection),{sourceRevision:p.sourceRevision}).every(v=>v===0));h.fire('selectionClear');assert.equal(p.settings.manualSelection,null);
  await h.api.renderCurrent();h.get('selectionMode').value='subtract';stroke(h,[[.2,.2],[.3,.2],[.3,.3]]);assert.equal(p.settings.manualSelection.base,'all');
});
test('manual UI: one-point push and underspecified lasso do not add history; restore tap is a real command',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'liquify-push');stroke(h,[[0,0]]);assert.equal(p.undo.length,0);await toolReady(h,'selection-lasso');stroke(h,[[0,0],[.1,.1]]);assert.equal(p.undo.length,0);await toolReady(h,'liquify-restore');stroke(h,[[0,0]]);assert.equal(p.settings.manualLiquify[0].kind,'restore');assert.equal(p.undo.length,1);
});
test('manual UI: push/restore use immutable selection snapshot captured at pointerdown, original coordinates and source revision',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[0,0],[.2,.2]]);const initial=plain(p.settings.manualSelection);await toolReady(h,'liquify-push');stroke(h,[[.5,.5],[.6,.5],[.7,.5]],null);p.settings.manualSelection.commands[0].points[0].x=.9;h.fire('viewport','pointerup',{pointerId:1,clientX:700,clientY:350});
  assert.deepEqual(plain(p.settings.manualLiquify[0].selection),initial);assert.equal(p.settings.manualLiquify[0].sourceRevision,p.sourceRevision);assert.equal(p.settings.manualLiquify[0].radius,.1);assert.equal(p.settings.manualLiquify[0].strength,.5);h.fire('selectionClear');assert.deepEqual(plain(p.settings.manualLiquify[0].selection),initial);
});
test('manual UI: source mismatch is rejected before draft; late mismatch cannot commit',async()=>{
  const h=harness(),p=h.activate();p.settings.manualSelection={version:1,sourceRevision:'wrong',base:'all',inverted:false,feather:0,commands:[]};await toolReady(h,'selection-brush');stroke(h,[[.2,.2],[.3,.3]]);assert.equal(h.api.get().manualDraft,null);assert.equal(p.undo.length,0);assert.match(h.get('toast').textContent,/不匹配/);
});
test('manual UI: no face is required but missing core, export/project locks and original-held view disable strokes',async()=>{
  const missing=harness({manualCore:false});missing.activate();missing.api.setTool('liquify-push');assert.equal(missing.api.get().tool,'pan');assert.equal(missing.get('selectionBrushTool').disabled,true);
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');for(const flag of ['exportRunning','loadingPhoto','importing','originalHeld']){h.api.set({[flag]:true});stroke(h,[[.2,.2],[.3,.3]]);assert.equal(p.undo.length,0);h.api.set({[flag]:false});}
});
test('manual UI: selection-based adjustment layer captures independent selection and hides unsupported geometry controls',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[.1,.1],[.4,.4]]);const selection=plain(p.settings.manualSelection);h.fire('selectionToLayer');const layer=p.settings.localLayers[0];assert.equal(layer.mask.kind,'selection');assert.deepEqual(plain(layer.mask.selection),selection);assert.equal(h.get('localRadialFields').hidden,true);assert.equal(h.get('localLinearFields').hidden,true);assert.equal(h.get('localKind').disabled,true);assert.equal(h.get('localSelectionSummary').hidden,false);
  h.fire('selectionClear');assert.deepEqual(plain(layer.mask.selection),selection);h.get('localExposure').value='20';h.fire('localExposure','input');h.fire('localExposure','change');assert.equal(p.settings.localLayers[0].adjustments.exposure,20);
});
test('manual UI: selection/strokes/layer and undo redo survive actual project save and restore',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[.1,.1],[.4,.4]]);h.fire('selectionToLayer');await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.5]]);await h.api.renderCurrent();await h.api.saveProject();assert.equal(h.calls.saved.length,1);const saved=await Codec.decode(h.calls.saved[0].bytes);assert.equal(saved.photos[0].settings.manualLiquify.length,1);assert.equal(saved.photos[0].settings.manualSelection.commands.length,1);assert.equal(saved.photos[0].settings.localLayers[0].mask.kind,'selection');assert.ok(saved.photos[0].undo.length>=3);
  const restored=harness({bridge:{openProject:async()=>({canceled:false,bytes:h.calls.saved[0].bytes,displayName:'manual.mintproj'})}});await restored.api.openProject();const q=restored.api.photos[0];assert.deepEqual(plain(q.settings),plain(p.settings));restored.api.undo();assert.equal(q.settings.manualLiquify.length,0);restored.api.undo();assert.equal(q.settings.localLayers?.length||0,0);restored.api.redo();assert.equal(q.settings.localLayers[0].mask.kind,'selection');restored.api.redo();assert.equal(q.settings.manualLiquify.length,1);
});
test('manual UI: sync preserves each destination selection and strokes rather than copying source-bound geometry',async()=>{
  const h=harness(),p=h.activate(),other=h.photo('two',{exposure:4});await toolReady(h,'selection-brush');stroke(h,[[.1,.1],[.4,.4]]);await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.5]]);h.get('syncScope').value='all';h.fire('applySync');assert.equal(other.settings.manualSelection,null);assert.equal(other.settings.manualLiquify.length,0);assert.equal(p.settings.manualLiquify.length,1);
});
test('manual UI: colored selection is preview-only, selection-only export uses source render without manual view flag',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[.1,.1],[.4,.4]]);h.api.drawPreview();assert.ok(h.calls.draws.some(x=>x.target==='previewCanvas'&&x.canvas.id==='canvas'));
  await h.api.startExport({preventDefault(){}});const render=h.calls.renders.at(-1);assert.notEqual(render.canvas,h.get('previewCanvas'));assert.equal(render.options.manualEditing,undefined);assert.equal(render.settings.manualSelection.commands.length,1);assert.equal(h.calls.encodes.length,1);assert.notEqual(h.calls.encodes[0],h.get('previewCanvas'));assert.equal(p.settings.manualLiquify.length,0);
});
test('manual UI: existing repair protects donor geometry from later push/restore and clear liquify',async()=>{
  const h=harness(),p=h.activate();p.settings.manualRepair=[{test:'existing repair fixture'}];h.api.updateManualControls();assert.equal(h.get('liquifyPushTool').disabled,true);assert.equal(h.get('liquifyRestoreTool').disabled,true);h.api.setTool('liquify-push');assert.equal(h.api.get().tool,'pan');assert.match(h.get('toast').textContent,/先完成推形/);await toolReady(h,'selection-brush');
});
test('manual UI: HTML loads pure manual core before app and labels selection preview and conventional scope honestly',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');assert.ok(html.indexOf('src="manual-tools.cjs"')<html.indexOf('src="app.js"'));assert.ok(html.indexOf('src="manual-pipeline.cjs"')<html.indexOf('src="project-document.cjs"'));for(const id of ['selectionBrushTool','selectionLassoTool','selectionMode','selectionRadius','selectionFeather','selectionInvert','selectionEmpty','selectionClear','selectionToLayer','liquifyPushTool','liquifyRestoreTool','liquifyRadius','liquifyStrength','manualDone'])assert.match(html,new RegExp(`id="${id}"`));assert.match(html,/颜色不导出/);assert.match(html,/不是学习模型精修/);assert.match(html,/旧版单点柔化/);
});

test('manual UI: presets on the same source retain selections, applied strokes and layers, explicit reset remains undoable',async()=>{
  const h=harness({pipeline:{PRESETS:[{id:'test-preset',name:'Test',description:'Fixture only',settings:{exposure:15}}]}}),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[.1,.1],[.4,.4]]);h.fire('selectionToLayer');await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.5]]);const selection=plain(p.settings.manualSelection),commands=plain(p.settings.manualLiquify),layers=plain(p.settings.localLayers);h.get('presets').children[0].click();assert.equal(p.settings.exposure,15);assert.deepEqual(plain(p.settings.manualSelection),selection);assert.deepEqual(plain(p.settings.manualLiquify),commands);assert.deepEqual(plain(p.settings.localLayers),layers);h.fire('resetBtn');assert.equal(p.settings.manualSelection,null);assert.equal(p.settings.manualLiquify.length,0);h.api.undo();assert.deepEqual(plain(p.settings.manualLiquify),commands);
});
test('manual UI: stale manual-view render cannot replace a later full-result render or enable a stroke',async()=>{
  const pending=defer(),entered=defer(),h=harness({pipeline:{render:async(c,s,f,o)=>{if(o.manualEditing){entered.resolve();await pending.promise;}return c;}}});h.activate();h.api.setTool('liquify-push');const old=h.api.renderCurrent();await entered.promise;h.api.setTool('pan');await h.api.renderCurrent();pending.resolve();await old;assert.equal(h.api.get().manualViewReady,false);assert.equal(h.api.get().renderedManualMode,false);assert.equal(h.api.get().tool,'pan');
});

test('manual UI: new selection layers are refused after manual geometry without mutating layers or history',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');stroke(h,[[.1,.1],[.4,.4]]);await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.5]]);const before=JSON.stringify(p.settings),history=p.undo.length;assert.equal(h.get('selectionToLayer').disabled,true);h.fire('selectionToLayer');assert.equal(JSON.stringify(p.settings),before);assert.equal(p.undo.length,history);assert.match(h.get('toast').textContent,/避免范围错位/);
});

async function sampleReady(h,point=[.7,.7],mode='heal'){await toolReady(h,`repair-${mode}`);h.fire('repairSampleTool');stroke(h,[point]);assert.equal(h.api.get().tool,`repair-${mode}`);assert.ok(h.api.get().repairSample);}
test('repair UI: genuine core capability is required and both repair modes require explicit donor source',async()=>{
  const absent=harness({repairCore:false});absent.activate();absent.api.setTool('repair-heal');assert.equal(absent.api.get().tool,'pan');assert.equal(absent.get('repairHealTool').disabled,true);
  const h=harness(),p=h.activate();await toolReady(h,'repair-heal');stroke(h,[[.4,.4]]);assert.equal(p.undo.length,0);assert.equal(p.settings.manualRepair.length,0);assert.match(h.get('toast').textContent,/选择取样点/);
});
for(const mode of ['heal','clone'])test(`repair UI: explicit sample and ${mode} short stroke commit once with immutable pixels, source and selection`,async()=>{
  const h=harness(),p=h.activate();await sampleReady(h,[.7,.7],mode);assert.equal(p.undo.length,0);const sample=plain(h.api.get().repairSample.point);
  stroke(h,[[.4,.4],[.42,.4],[.44,.4]],null);assert.equal(p.settings.manualRepair.length,0);const image=h.api.get().manualDraft.image,data=new Uint8ClampedArray(image.data);h.fire('viewport','pointerup',{pointerId:1,clientX:440,clientY:280});assert.equal(p.settings.manualRepair.length,1,h.get('toast').textContent);const command=p.settings.manualRepair[0];assert.equal(command.mode,mode);assert.equal(command.sampleMode,'manual');assert.ok(Math.abs(command.radius-.014)<1e-12);assert.equal(command.hardness,.6);assert.equal(command.strength,.8);assert.deepEqual(plain(command.source),sample);assert.equal(command.sourceRevision,p.sourceRevision);assert.deepEqual(image.data,data);assert.equal(p.undo.length,1);assert.equal(h.get('liquifyPushTool').disabled,true);h.api.undo();assert.equal(p.settings.manualRepair.length,0);h.api.redo();assert.equal(p.settings.manualRepair[0].mode,mode);
});
for(const ending of ['pointercancel','lostpointercapture','Escape','blur'])test(`repair UI: ${ending} discards real repair draft and sample-picking draft without history`,async()=>{
  const h=harness(),p=h.activate();await sampleReady(h);const sample=plain(h.api.get().repairSample);stroke(h,[[.4,.4],[.41,.4],[.42,.4]],null);if(ending==='Escape')h.events.get('keydown')({key:'Escape'});else if(ending==='blur')h.events.get('blur')();else h.fire('viewport',ending,{pointerId:1});assert.equal(p.undo.length,0);assert.equal(p.settings.manualRepair.length,0);assert.equal(h.api.get().manualDraft,null);assert.deepEqual(plain(h.api.get().repairSample),sample);
  await toolReady(h,'repair-sample');stroke(h,[[.9,.9]],null);h.fire('viewport','pointercancel',{pointerId:1});assert.deepEqual(plain(h.api.get().repairSample),sample);
});
test('repair UI: preflight rejects overlapping heal donor, invalid edge donor and overlong swept strokes without committing',async()=>{
  const h=harness(),p=h.activate();await sampleReady(h,[.4,.4]);stroke(h,[[.4,.4]]);assert.equal(p.undo.length,0);assert.match(h.get('toast').textContent,/重叠/);
  await sampleReady(h,[0,0],'clone');stroke(h,[[.4,.4]]);assert.equal(p.undo.length,0);assert.match(h.get('toast').textContent,/取样区域/);
  await sampleReady(h,[.7,.7]);stroke(h,[[.1,.1],[.8,.1]]);assert.equal(p.undo.length,0);assert.match(h.get('toast').textContent,/短笔/);
});
test('repair UI: source pick is ephemeral, per-stroke selection is persistent, project save restores genuine repair commands',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-lasso');stroke(h,[[.3,.3],[.6,.3],[.6,.6],[.3,.6]]);await sampleReady(h);const selection=plain(p.settings.manualSelection);stroke(h,[[.4,.4],[.42,.4]]);assert.equal(p.settings.manualRepair.length,1,h.get('toast').textContent);h.fire('selectionClear');assert.deepEqual(plain(p.settings.manualRepair[0].selection),selection);await h.api.renderCurrent();await h.api.saveProject();assert.equal(h.calls.saved.length,1);const snapshot=await Codec.decode(h.calls.saved[0].bytes);assert.equal(snapshot.photos[0].settings.manualRepair[0].mode,'heal');assert.equal(snapshot.photos[0].repairSample,undefined);assert.deepEqual(plain(snapshot.photos[0].settings.manualRepair[0].selection),selection);
});
test('repair UI: explicit repair after liquify is allowed and sampling is invalidated when source geometry changes',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.4]]);await sampleReady(h);stroke(h,[[.4,.4]]);assert.equal(p.settings.manualRepair.length,1,h.get('toast').textContent);h.fire('clearRepair');assert.equal(p.settings.manualRepair.length,0);h.fire('clearLiquify');await toolReady(h,'repair-clone');stroke(h,[[.4,.4]]);assert.equal(p.settings.manualRepair.length,0);assert.match(h.get('toast').textContent,/选择取样点/);
});
test('manual UI: geometry/background conflicts reject new push or later automatic effects without mutating settings',async()=>{
  const h=harness(),p=h.activate(h.photo('one',{slim:20,bgMode:'color'}));h.api.setTool('liquify-push');assert.equal(h.api.get().tool,'pan');assert.equal(p.settings.slim,20);h.api.changeSettings({slim:0,bgMode:'original'});await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.4]]);const before=JSON.stringify(p.settings),history=p.undo.length;h.api.changeSettings({eyes:30});assert.equal(JSON.stringify(p.settings),before);h.api.changeSettings({bgMode:'transparent'});assert.equal(JSON.stringify(p.settings),before);assert.equal(p.undo.length,history);assert.equal(h.get('control-eyes').disabled,true);
});
test('manual UI: preset and sync exclude automatic shape/background conflicts on existing manual geometry',async()=>{
  const h=harness({pipeline:{PRESETS:[{id:'shape',name:'Shape',description:'Test fixture',settings:{slim:40,bgMode:'color',exposure:12}}]}}),p=h.activate();await toolReady(h,'liquify-push');stroke(h,[[.4,.4],[.5,.4]]);h.get('presets').children[0].click();assert.equal(p.settings.slim,0);assert.equal(p.settings.bgMode,'original');assert.equal(p.settings.exposure,12);
  const other=h.photo('two',{...structuredClone(p.settings),manualLiquify:p.settings.manualLiquify.map(c=>({...structuredClone(c),sourceRevision:'two:source-0'}))});h.fire('clearLiquify');h.api.changeSettings({slim:40,bgMode:'color'});h.get('syncScope').value='all';h.fire('applySync');assert.equal(other.settings.slim,0);assert.equal(other.settings.bgMode,'original');assert.equal(other.settings.manualLiquify.length,1);
});

test('manual UI: rendered manual view is bound to immutable source revision, including late source changes during rendering',async()=>{
  const h=harness(),p=h.activate();await toolReady(h,'selection-brush');p.sourceRevision='replacement-source';stroke(h,[[.2,.2],[.3,.3]]);assert.equal(h.api.get().manualDraft,null);assert.equal(p.undo.length,0);
  const pending=defer(),entered=defer(),late=harness({pipeline:{render:async c=>{entered.resolve();await pending.promise;return c;}}}),q=late.activate();late.api.setTool('selection-brush');const job=late.api.renderCurrent();await entered.promise;q.sourceRevision='newer-source';pending.resolve();await job;assert.equal(late.api.get().manualViewReady,false);stroke(late,[[.2,.2],[.3,.3]]);assert.equal(q.undo.length,0);
});

test('manual UI: failed project installation restores the prior manual mode and explicit donor along with original pixels',async()=>{
  const bytes=await Codec.encode(snapshot()),h=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'new.mintproj'})}}),p=h.activate();await sampleReady(h,[.6,.6],'clone');const sample=plain(h.api.get().repairSample),original=h.api.get().source;const title=h.get('activeFileName');let value=title.textContent,failed=false;Object.defineProperty(title,'textContent',{get(){return value;},set(next){if(next==='restored.png'&&!failed){failed=true;throw new Error('authored DOM failure');}value=next;},configurable:true});await h.api.openProject();assert.equal(failed,true);assert.equal(h.api.photos[0],p);assert.equal(h.api.get().source,original);assert.equal(h.api.get().tool,'repair-clone');assert.deepEqual(plain(h.api.get().repairSample),sample);await h.api.renderCurrent();stroke(h,[[.4,.4]]);assert.equal(p.settings.manualRepair.length,1,h.get('toast').textContent);
});
