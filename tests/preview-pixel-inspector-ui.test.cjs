'use strict';
// Runs the complete shipped app with authored DOM/Canvas/IPC doubles. The pointer,
// wheel, toggle, render and lifecycle handlers below are production code, not a
// simulated inspector. This is not browser/layout/native-dialog acceptance.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
const Reference = require('../src/reference-compare.cjs');
const Tone = require('../src/advanced-tone.cjs'), Levels = require('../src/levels.cjs'), PresetModule = require('../src/preset-codec.cjs');
const Presets = PresetModule.createCodec({advancedTone:Tone,levels:Levels});
const Geometry = require('../src/geometry.cjs'), ExportCore = require('../export-render-core.cjs');
const Manual = require('../src/manual-tools.cjs'), Repair = require('../src/repair-brush-core.cjs');
const Codec = require('../src/project-document.cjs'), Learned = require('../src/learned-analysis.cjs');
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
const settle = async h => { for(let i=0;i<1000&&h.api.get().projectOperation;i++)await new Promise(resolve=>setTimeout(resolve,1));await flush();assert.equal(h.api.get().projectOperation,''); };
const presetDoc=(name='测试配方',basic={},beauty={},advancedTone=null)=>{const doc=Presets.defaults(name);Object.assign(doc.controls.basic,basic);Object.assign(doc.controls.beauty,beauty);doc.controls.advancedTone=advancedTone;return Presets.validate(doc);};
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
  const elements=new Map(),events=new Map(),calls={saved:[],opens:0,confirm:0,decoded:[],encoded:[],dirty:[],urls:[],revoked:[],writes:[],model:0,renders:[],encodes:[],draws:[],inspectorReads:[]};let sequence=0,timer=0;
  class Element {
    constructor(tag){this.id=tag;this.tag=tag;this.children=[];this.parent=null;this.dataset={};this.style={setProperty(){}};this.attributes={};this.classes=new Set();this.classList={toggle:(c,on)=>{if(on??!this.classes.has(c))this.classes.add(c);else this.classes.delete(c);},add:(...cs)=>cs.forEach(c=>this.classes.add(c)),remove:(...cs)=>cs.forEach(c=>this.classes.delete(c)),contains:c=>this.classes.has(c)};this.value='';this.min='0';this.max='100';this.width=2;this.height=2;this.clientWidth=1000;this.clientHeight=700;this.listeners=new Map();this.open=false;this.innerHTML='';this.textContent='';}
    addEventListener(n,fn){this.listeners.set(n,fn);}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}insertAdjacentHTML(){}replaceChildren(...c){this.children=[];this.append(...c);}append(...c){for(const e of c){e.remove();this.children.push(e);e.parent=this;}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}focus(){}click(){return this.listeners.get('click')?.({target:this});}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(id){this.capture=null;}matches(selector){return selector.split(',').includes(this.tag)||selector==='[contenteditable]'&&this.isContentEditable;}closest(selector){return selector===`#${this.id}`||selector==='.control'?this:null;}showModal(){this.open=true;}close(){this.open=false;this.innerHTML='';this.textContent='';}
    querySelector(s){return this.children.find(e=>s==='input'?e.tag==='input':s==='span'?e.tag==='span':e.className===s.slice(1))||new Element('stub');}
    getBoundingClientRect(){const width=this.clientWidth,height=this.clientHeight;return {left:0,top:0,width,height,right:width,bottom:height};}
    toBlob(fn){fn(overrides.thumbnailFailure?.(++calls.thumbnailCount)?null:new Blob(['thumbnail'],{type:'image/jpeg'}));}
    getContext(){return {clearRect(){},drawImage:(canvas,...args)=>{if(overrides.copyHook&&this.id==='canvas')overrides.copyHook(this,canvas);calls.draws.push({target:this.id,canvas,args});if(canvas.pixels)this.pixels=new Uint8ClampedArray(canvas.pixels);},closePath(){},save(){},restore(){},beginPath(){},rect(){},clip(){},stroke(){},fill(){},arc(){},ellipse(){},lineTo(){},moveTo(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData:(image)=>{this.pixels=new Uint8ClampedArray(image.data);},getImageData:(x,y,w,h,options)=>{if(options?.pixelFormat){calls.inspectorReads.push({canvas:this,x,y,w,h,options});overrides.readbackHook?.(this);} if(this.pixels)return {width:w,height:h,data:new Uint8ClampedArray(this.pixels)};const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data[i*4]=120+i%13;data[i*4+1]=110+i%7;data[i*4+2]=100+i%5;data[i*4+3]=255;}return {width:w,height:h,data};}};}
  }
  calls.thumbnailCount=0;calls.scopeConfirm=[];calls.reviewQueries=0;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});
  get('repairRadius').value='1.4';get('repairHardness').value='60';get('repairStrength').value='80';get('selectionMode').value='add';get('selectionRadius').value='3';get('selectionFeather').value='0';get('liquifyRadius').value='10';get('liquifyStrength').value='50';get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';get('matteRadius').value='4';get('matteHardness').value='100';get('matteOpacity').value='100';
  get('reviewScope').value='current';get('reviewRating').value='0';get('reviewFlag').value='none';get('reviewLabel').value='none';get('reviewMin').value='0';get('reviewMax').value='5';get('reviewFilterFlag').value='all';get('reviewFilterLabel').value='all';get('reviewSort').value='import';get('reviewHideRejected').checked=false;get('namedPresetScope').value='current';get('namedPresetMode').value='full';
  const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),
    decodeImage:async(blob,max)=>{calls.decoded.push({blob,max});const d=Codec.inspectImage(new Uint8Array(await blob.arrayBuffer()),blob.type);return {canvas:canvas(Math.min(d.width,max),Math.min(d.height,max)),originalWidth:d.width,originalHeight:d.height};},
    analyze:async()=>{calls.model++;return {faceCount:0,landmarks:[],mask:null};},render:async(c,settings,facts,options={})=>{calls.renders.push({canvas:c,settings:structuredClone(settings),facts,options});let effective=structuredClone(settings);if(options.sourceView||options.manualEditing)effective.framing=null;if(options.manualEditing)Object.assign(effective,{bgMode:'original',slim:0,eyes:0,nose:0,jaw:0});const image=ExportCore.processPixels(c.getContext('2d').getImageData(0,0,c.width,c.height),effective,{...facts,landmarks:facts?.landmarks||[],sourceRevision:facts?.sourceRevision});const out=canvas(image.width,image.height);out.pixels=image.data;return out;},encode:async(c)=>{calls.encodes.push(c);return new Uint8Array(sourceBytes);},...overrides.pipeline};
  let catalog=structuredClone(overrides.catalog||{items:[],trash:[]});calls.presetSaves=[];calls.presetExports=[];calls.presetLists=0;
  const bridge={listPresets:async()=>{calls.presetLists++;return structuredClone(catalog);},savePreset:async payload=>{calls.presetSaves.push(structuredClone(payload));const document=Presets.validate(structuredClone(payload.document));if(catalog.items.some(item=>item.id!==payload.id&&item.document.name.normalize('NFC').toLowerCase()===document.name.normalize('NFC').toLowerCase()))throw new Error('预设名称重复');const item={id:payload.id||`preset-${calls.presetSaves.length}`,document};const prior=catalog.items.findIndex(x=>x.id===item.id);if(prior<0)catalog.items.push(item);else catalog.items[prior]=item;return structuredClone(item);},removePreset:async id=>{catalog.trash.push(...catalog.items.splice(catalog.items.findIndex(item=>item.id===id),1));return structuredClone(catalog);},restorePreset:async id=>{catalog.items.push(...catalog.trash.splice(catalog.trash.findIndex(item=>item.id===id),1));return structuredClone(catalog);},importPreset:async()=>null,exportPreset:async doc=>{calls.presetExports.push(structuredClone(doc));return{name:'fixture.mintpreset.json',bytes:300};},recoverPresetBackup:async()=>null,saveProject:async payload=>{calls.saved.push(payload);return {canceled:false,displayName:'saved.mintproj'};},openProject:async()=>{calls.opens++;return {canceled:true};},confirmReplaceProject:async()=>{calls.confirm++;return true;},setSessionDirty:v=>calls.dirty.push(v),onMenuAction:fn=>events.set('menu',fn),chooseExportFolder:async()=>({token:'test',displayPath:'test folder'}),writeExport:async payload=>calls.writes.push(payload),...overrides.bridge};
  const codec={VERSION:Codec.VERSION,encode:async value=>{calls.encoded.push(structuredClone(value));return Codec.encode(structuredClone(value));},decode:bytes=>Codec.decode(bytes),...overrides.codec};
  const context=vm.createContext({Pipeline:pipeline,window:{MintReferenceCompare:overrides.referenceCore===false?null:(overrides.referenceCore||Reference),confirm:overrides.confirm===false?undefined:(message)=>{calls.scopeConfirm.push(message);return overrides.confirm?overrides.confirm(message):true;},desktop:bridge,MintAdjustmentPreset:overrides.presetCore===false?null:{createCodec:dependencies=>{calls.codecDependencies=dependencies;const codec=PresetModule.createCodec({advancedTone:dependencies.advancedTone,levels:dependencies.levels});return Object.fromEntries(Object.entries(codec).map(([key,fn])=>[key,(...args)=>fn(...args.map(arg=>structuredClone(arg)))]));}},MintLevels:overrides.levelsCore===false?null:(overrides.levelsCore||Object.fromEntries(Object.entries(Levels).map(([key,fn])=>[key,typeof fn==='function'?(...args)=>fn(...args.map(arg=>structuredClone(arg))):fn]))),MintAdvancedTone:Object.fromEntries(Object.entries(Tone).map(([key,fn])=>[key,typeof fn==='function'?(...args)=>fn(...args.map(arg=>structuredClone(arg))):fn])),MintGeometry:overrides.geometryCore===false?null:Object.fromEntries(Object.entries(Geometry).map(([key,value])=>[key,typeof value==='function'? (...args)=>value(...args.map(arg=>typeof arg==='function'?arg:structuredClone(arg))):value])),MintManualPipeline:require('../src/manual-pipeline.cjs'),RepairBrushCore:overrides.repairCore===false?null:{...Repair,validate:(c,o)=>Repair.validate(structuredClone(c),{...o,manualTools:Manual}),resolveSource:(i,c,o)=>Repair.resolveSource(structuredClone(i),structuredClone(c),{...o,manualTools:Manual,selection:structuredClone(o.selection)}),apply:(i,c,o)=>Repair.apply(structuredClone(i),structuredClone(c),{...o,manualTools:Manual,selection:structuredClone(o.selection)})},MintManualTools:overrides.manualCore === false ? null : Object.fromEntries(['validateSelection','rasterizeSelection','validateLiquifyCommands','liquify'].map(key=>[key,(...args)=>Manual[key](...args.map(value=>structuredClone(value)))])),MintExportQueue:require('../src/export-queue.cjs'),PortraitEngine:require('../src/portrait-engine.cjs'),MintProjectDocument:codec,MintLearnedAnalysis:Learned,addEventListener:(n,fn)=>events.set(n,fn)},document:{getElementById:get,querySelectorAll:s=>s==='.photo-card'?get('filmstrip').children.filter(e=>e.className==='photo-card'):[],querySelector:s=>get('filmstrip').children.find(e=>s===`[data-photo-id="${e.dataset.photoId}"]`)||null,createElement:t=>new Element(t),body:new Element('body')},console,structuredClone,AbortController,Blob,Uint8Array,Float32Array,Uint8ClampedArray,ArrayBuffer,HTMLElement:Element,crypto:{randomUUID:()=>`photo-${++sequence}`},URL:{createObjectURL:()=>{const u=`blob:thumb-${++sequence}`;calls.urls.push(u);return u;},revokeObjectURL:u=>calls.revoked.push(u)},ResizeObserver:class{constructor(fn){this.fn=fn;}observe(el){events.set('resize-'+el.id,this.fn);}},setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){},setInterval:()=>++timer,clearInterval(){}});
  // The authored VM has no native structuredClone. Preserve the real review core's
  // same-realm plain-data contract when the host clone returns review records.
  context.structuredClone=value=>{const copy=structuredClone(value);return copy&&copy.version===1&&copy.current&&'rating'in copy.current&&'undo'in copy&&'redo'in copy?vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(copy))})`,context):copy;};
  if(overrides.reviewCore!==false){vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/photo-review.cjs'),'utf8'),context);context.window.MintPhotoReview={...context.MintPhotoReview,query:(...args)=>{calls.reviewQueries++;return context.MintPhotoReview.query(...args);}};}
  if(overrides.pixelCore!==false){vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/preview-pixel-inspector.cjs'),'utf8'),context);context.window.MintPreviewPixelInspector=context.MintPreviewPixelInspector;}
  let app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  app+='\nglobalThis.audit={previewPixelReason,clearPreviewPixelInspector,syncPreviewPixelInspector,refreshPreviewPixelReadout,rememberPreviewPixelPointer,zoomBy,clearSessionView,editLevels,updateLevelsControls,updateToneHistogram,pinReference,clearReference,setReferenceCompare,freshAcceptedRender,referenceCaptureReason,updateReferenceComparison,cancelReferenceGesture,positionReferencePanes,fitReference,zoomReference,scheduleRender,queryPhotoReview,reviewDefaults,reviewOf,setReviewView,applyPhotoReview,selectVisiblePhotos,navigateReview,updateCards,updateReviewControls,batchScopeCounts,batchScopeLive,approveBatchScope,refreshExportPlan,stageNamedPreset,presetDocumentFromPhoto,stagedPresetDocument,applyNamedPreset,cancelNamedPresetApplication,saveNamedPreset,importNamedPreset,exportNamedPreset,removeNamedPreset,restoreNamedPreset,recoverNamedPresets,loadNamedPresets,presetFaceMeshReady,locked,analyzeCurrent,framingPlan,exportDimensions,previewDimensions,currentDisplayStamp,currentDisplayMode,sourceWorkingViewReady,originalForView,prepareFramingView,startCropDraft,cancelCropDraft,acceptCropDraft,framingAction,updateFramingControls,updateNumericCrop,drawCropOverlay,setCompare,fit,positionSurface,setTool,renderCurrent,manualPoint,beginManualStroke,appendManualStroke,finishManualStroke,editSelection,updateManualControls,photos,saveProject,openProject,projectSnapshot,startExport,cancelExport,openExport,exportLimit,addLocalLayer,removeLocalLayer,moveLocalLayer,changeLocalLayer,selectedLocalLayer,updateLocalControls,drawPreview,hasUnsavedProjectChanges,projectFingerprint,changeSettings,undo,redo,activatePhoto,importFiles,removeSelected,startExport,updateAvailability,factsForPhoto,appendPhotoCard,set:(v)=>{if("renderVersion"in v)renderVersion=v.renderVersion;if("renderController"in v)renderController=v.renderController;if("renderFailure"in v)renderFailure=v.renderFailure;if("projectOperation"in v)projectOperation=v.projectOperation;if("openingDialog"in v)openingDialog=v.openingDialog;if("loadingDemo"in v)loadingDemo=v.loadingDemo;if("renderPending"in v)renderPending=v.renderPending;if("viewToken"in v)viewToken=v.viewToken;if("pointer"in v)pointer=v.pointer;if("manualDraft"in v)manualDraft=v.manualDraft;if("cropDraft"in v)cropDraft=v.cropDraft;if("presetOperation"in v)presetOperation=v.presetOperation;if("manualViewReady"in v)manualViewReady=v.manualViewReady;if("originalHeld"in v)originalHeld=v.originalHeld;if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("modelState"in v)modelState=v.modelState;if("backendJob"in v)backendJob=v.backendJob;if("loadingPhoto"in v)loadingPhoto=v.loadingPhoto;if("analyzingPhoto"in v)analyzingPhoto=v.analyzingPhoto;if("renderingPhoto"in v)renderingPhoto=v.renderingPhoto;if("importing"in v)importing=v.importing;if("exportRunning"in v)exportRunning=v.exportRunning;if("matteDraft"in v)matteDraft=v.matteDraft;},get:()=>({previewPixelEnabled,previewPixelCache,previewPixelPointer,previewPixelFailedRender,toneHistogram,referenceSnapshot,referenceRequested,referenceSuspended,referencePointer,referenceRightCanvas,referenceViewState,acceptedRender,renderPending,renderFailure,renderVersion,reviewView,presetCatalog,presetCatalogReady,presetCatalogError,presetDraft,selectedPresetId,presetOperation,viewToken,cropDraft,renderedDisplayStamp,requestedDisplayMode,zoom,panX,panY,compare,repairSample,repairMode,manualDraft,manualViewReady,renderedManualMode,pointer,tool,rendered,exportQueue,exportFolder,exportRunning,projectOperation,projectDisplayName,currentId,source,analysis,matteDraft,loadingPhoto,savedProjectFingerprint})};';
  vm.runInContext(app,context);const api=context.audit;
  function photo(id='old',settings={}){const p={id,name:`${id}.png`,blob:new Blob([sourceBytes],{type:'image/png'}),thumb:`blob:old-${id}`,review:api.reviewDefaults(),sourceRevision:`${id}:source-0`,originalWidth:100,originalHeight:80,selected:true,settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,preset:null,learnedCache:new Map()};api.photos.push(p);p.committed=structuredClone(p.settings);api.appendPhotoCard(p);return p;}
  function activate(p=photo()){api.set({currentId:p.id,source:canvas(100,80),analysis:null});api.updateCards();return p;}
  const fire=(id,name='click',extra={})=>get(id).listeners.get(name)?.({type:name,target:get(id),preventDefault(){},stopPropagation(){},...extra});
  return {api,photo,activate,calls,bridge,pipeline,codec,events,get,fire,canvas,context};
}
const plain=value=>JSON.parse(JSON.stringify(value));
async function ready(overrides={}){const h=harness(overrides);await flush();assert.equal(h.api.get().presetOperation,null);return h;}
function authoredMesh(cx=.5){const mesh=Array.from({length:478},(_,i)=>({x:cx+Math.cos(i*.17)*.13,y:.5+Math.sin(i*.17)*.22,z:0}));return {faceCount:1,landmarks:[mesh],mask:null};}
function stage(h,doc,scope='current',mode='full'){h.api.stageNamedPreset(doc,'测试暂存');h.get('namedPresetScope').value=scope;h.get('namedPresetMode').value=mode;}
const state=p=>plain({settings:p.settings,committed:p.committed,undo:p.undo,redo:p.redo,revision:p.revision,preset:p.preset});
async function until(check){for(let i=0;i<100&&!check();i++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(check(),'expected asynchronous checkpoint');}

const text = h => h.get('previewPixelReadout').textContent;
const set = (h,code) => vm.runInContext(code,h.context);
function enable(h,value=true) { h.get('previewPixelToggle').checked=value; h.fire('previewPixelToggle','change'); }
function point(h,x=500,y=350) { h.fire('viewport','pointermove',{clientX:x,clientY:y,pointerId:8}); }
function screen(h) {
  const viewport=h.get('viewport');viewport.clientWidth=1000;viewport.clientHeight=700;
  viewport.getBoundingClientRect=()=>({left:10,top:20,width:1000,height:700,right:1010,bottom:720});
  h.get('imageSurface').getBoundingClientRect=()=>{const {zoom,panX,panY,rendered}=h.api.get(),width=(rendered?.width||100)*zoom,height=(rendered?.height||80)*zoom,left=510+panX-width/2,top=370+panY-height/2;return {left,top,width,height,right:left+width,bottom:top+height};};
}
async function prepared(overrides={}) { const h=await ready(overrides),p=h.activate();await h.api.renderCurrent();await flush();screen(h);return {h,p}; }
async function enabled(overrides={}) { const all=await prepared(overrides);enable(all.h);assert.ok(all.h.api.get().previewPixelCache,text(all.h));return all; }
function inspectCenter(h){point(h,510,370);return text(h);}

test('pixel UI: default off, explicit labeled toggle and preview-only accessible scope',async()=>{
  const {h}=await prepared();assert.equal(h.api.get().previewPixelEnabled,false);assert.equal(h.api.get().previewPixelCache,null);assert.equal(h.calls.inspectorReads.length,0);assert.equal(h.get('previewPixelDetails').hidden,true);
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');assert.match(html,/id="previewPixelToggle" type="checkbox"/);assert.doesNotMatch(html,/<input[^>]*id="previewPixelToggle"[^>]*checked/);
  for(const phrase of ['检查当前结果像素','8-bit sRGB PREVIEW','不是原图采样','x/y 从 0 开始','aria-live="off"'])assert.ok(html.includes(phrase));
  assert.ok(html.indexOf('preview-pixel-inspector.cjs')<html.indexOf('src="app.js"'));
});
test('pixel UI: actual toggle and pointer use accepted result, never composed preview or original',async()=>{
  const {h}=await prepared(),accepted=h.api.get().acceptedRender;accepted.canvas.pixels=new Uint8ClampedArray(100*80*4);for(let i=0;i<8000;i++)accepted.canvas.pixels.set([0,100,255,255],i*4);
  h.get('previewCanvas').pixels=new Uint8ClampedArray(32000).fill(2);h.api.get().source.pixels=new Uint8ClampedArray(32000).fill(7);
  enable(h);assert.equal(h.calls.inspectorReads.length,1);assert.equal(h.calls.inspectorReads[0].canvas,accepted.canvas);assert.deepEqual(plain(h.calls.inspectorReads[0].options),{colorSpace:'srgb',pixelFormat:'rgba-unorm8'});
  assert.match(inspectCenter(h),/x 50 · y 40 · R 0 · G 100 · B 255 · A 255/);assert.match(text(h),/R = 0；B = 255/);
  const cache=h.api.get().previewPixelCache;for(let i=0;i<200;i++)point(h,500+i/10,365);
  assert.equal(h.calls.inspectorReads.length,1);assert.equal(h.api.get().previewPixelCache,cache);
  enable(h,false);assert.equal(h.api.get().previewPixelCache,null);assert.equal(text(h),'');assert.equal(h.get('previewPixelDetails').hidden,true);
});
test('pixel UI: alpha-zero hidden colors suppressed and partial alpha not checkerboard-composited',async()=>{
  const {h}=await prepared(),accepted=h.api.get().acceptedRender;accepted.canvas.pixels=new Uint8ClampedArray(32000);const offset=(40*100+50)*4;accepted.canvas.pixels.set([255,0,128,0],offset);
  enable(h);inspectCenter(h);assert.match(text(h),/RGB —（完全透明/);assert.match(text(h),/A 0/);assert.doesNotMatch(text(h),/R 255|G 0|B 128|码值端点/);
  enable(h,false);accepted.canvas.pixels.set([255,0,128,123],offset);enable(h);inspectCenter(h);assert.match(text(h),/R 255 · G 0 · B 128 · A 123/);assert.match(text(h),/RGB 未与棋盘格合成/);assert.match(text(h),/G = 0；R = 255/);
});
test('pixel UI: half-open displayed image and visible viewport bounds do not clamp or accept captured outside points',async()=>{
  const {h}=await enabled();const r=h.get('imageSurface').getBoundingClientRect();point(h,r.left,r.top);assert.match(text(h),/x 0 · y 0/);
  for(const [x,y] of [[r.right,r.top],[r.left,r.bottom],[r.left-.001,r.top],[r.left,r.top-.001],[1010,400],[-1,400]]){point(h,x,y);assert.doesNotMatch(text(h),/ · x \d/);assert.match(text(h),/可见图像内/);}
  h.get('imageSurface').getBoundingClientRect=()=>({left:-100,top:-100,width:2000,height:1600});point(h,1009,719);assert.match(text(h),/ · x \d/);point(h,1010,719);assert.doesNotMatch(text(h),/ · x \d/);point(h,1009,720);assert.doesNotMatch(text(h),/ · x \d/);
});
test('pixel UI: pan, zoom, fit, resize update mapping with no readback, capture, inference or pixel pipeline work',async()=>{
  const {h}=await enabled();inspectCenter(h);const count=h.calls.renders.length,models=h.calls.model,reads=h.calls.inspectorReads.length,cache=h.api.get().previewPixelCache;
  h.fire('viewport','pointerdown',{button:0,pointerId:8,clientX:510,clientY:370});h.fire('viewport','pointermove',{pointerId:8,clientX:530,clientY:380});assert.match(text(h),/x 50 · y 40/);
  h.fire('viewport','pointerup',{pointerId:8,clientX:530,clientY:380});point(h,510,370);assert.match(text(h),/x 30 · y 30/);
  h.fire('viewport','wheel',{clientX:510,clientY:370,deltaY:-100});assert.match(text(h),/x 30 · y 30/);
  h.fire('fitBtn');inspectCenter(h);assert.match(text(h),/x 50 · y 40/);h.events.get('resize-viewport')();assert.match(text(h),/x 50 · y 40/);
  assert.equal(h.calls.inspectorReads.length,reads);assert.equal(h.calls.renders.length,count);assert.equal(h.calls.model,models);assert.equal(h.api.get().previewPixelCache,cache);assert.equal(h.api.get().referenceSnapshot,null);
});
test('pixel UI: source settings/history/project/export remain unchanged after all readout interactions',async()=>{
  const {h,p}=await prepared(),source=h.api.get().source,before=source.getContext('2d').getImageData(0,0,100,80).data,blob=await p.blob.arrayBuffer(),stateBefore=state(p),fingerprint=h.api.projectFingerprint(),project=await h.api.projectSnapshot(),exported=ExportCore.processPixels({width:100,height:80,data:before},p.settings,{landmarks:[]}),dirty=h.calls.dirty.length;
  enable(h);inspectCenter(h);h.api.zoomBy(2);h.fire('viewport','pointerleave');enable(h,false);
  assert.deepEqual(state(p),stateBefore);assert.equal(h.api.projectFingerprint(),fingerprint);assert.deepEqual(await h.api.projectSnapshot(),project);assert.deepEqual(await p.blob.arrayBuffer(),blob);assert.deepEqual(source.getContext('2d').getImageData(0,0,100,80).data,before);assert.deepEqual(ExportCore.processPixels({width:100,height:80,data:before},p.settings,{landmarks:[]}),exported);assert.equal(h.calls.dirty.length,dirty);
});
test('pixel UI: debounced setting change immediately releases cache and values, new accepted render refreshes once',async()=>{
  const {h}=await enabled();inspectCenter(h);const old=h.api.get().previewPixelCache;
  h.api.changeSettings({exposure:15});assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/ · x \d/);assert.equal(h.api.get().renderPending,true);
  point(h,510,370);assert.equal(h.calls.inspectorReads.length,1);await h.api.renderCurrent();await flush();assert.ok(h.api.get().previewPixelCache);assert.notEqual(h.api.get().previewPixelCache,old);assert.equal(h.calls.inspectorReads.length,2);inspectCenter(h);assert.match(text(h),/ · x 50/);
});
for(const mode of ['compare','original','reference','crop','manual','point','matte','local','diagnostic','boxes'])test(`pixel UI: ${mode} display releases readback and suppresses sampled values`,async()=>{
  const {h,p}=await enabled();inspectCenter(h);
  if(mode==='compare')h.api.setCompare(true);if(mode==='original'){set(h,'originalHeld=true');h.api.drawPreview();}if(mode==='reference')assert.equal(h.api.pinReference(),true);
  if(mode==='crop')h.api.startCropDraft();if(mode==='manual')h.api.setTool('selection-brush');if(mode==='point')h.api.setTool('brush');
  if(mode==='matte'){p.matteInspect=true;h.api.updateAvailability();}if(mode==='local'){p.localInspect=true;h.api.updateAvailability();}if(mode==='diagnostic'){p.settings.diagnosticOverlay=true;h.api.updateAvailability();}if(mode==='boxes'){h.get('learnedFaceBoxes').checked=true;h.api.updateAvailability();}
  assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/ · x \d/);const reads=h.calls.inspectorReads.length;point(h,510,370);assert.equal(h.calls.inspectorReads.length,reads);assert.equal(h.api.get().previewPixelCache,null);
});
for(const flag of ['loadingPhoto','analyzingPhoto','renderingPhoto','renderPending','importing','exportRunning','openingDialog','loadingDemo','projectOperation','presetOperation','backendJob','manualDraft','matteDraft'])test(`pixel UI: ${flag} invalidation prevents stale readback`,async()=>{
  const {h}=await enabled();inspectCenter(h);h.api.set({[flag]:['presetOperation','backendJob','manualDraft','matteDraft'].includes(flag)?{}:flag==='projectOperation'?'save':true});h.api.syncPreviewPixelInspector();assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/ · x \d/);assert.equal(h.calls.inspectorReads.length,1);
});
for(const identity of ['blob','source','sourceRevision','photo','viewToken','generation','dimensions','recipe','aborted'])test(`pixel UI: changed ${identity} cannot reuse accepted pixels`,async()=>{
  const {h,p}=await enabled();inspectCenter(h);
  if(identity==='blob')p.blob=new Blob(['other']);if(identity==='source')h.api.set({source:h.canvas(100,80)});if(identity==='sourceRevision')p.sourceRevision+='next';if(identity==='photo')h.api.photos[0]={...p};if(identity==='viewToken')h.api.set({viewToken:99});if(identity==='generation')h.api.set({renderVersion:99});if(identity==='dimensions')h.api.get().rendered.width=101;if(identity==='recipe')p.settings.exposure=5;if(identity==='aborted')set(h,'renderController.abort()');
  h.api.syncPreviewPixelInspector();assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/ · x \d/);assert.equal(h.calls.inspectorReads.length,1);
});
for(const outcome of ['failed','discarded','pending','wrong-photo','wrong-recipe'])test(`pixel UI: ${outcome} candidate never publishes stale values`,async()=>{
  const {h,p}=await enabled(),d=defer();h.pipeline.render=()=>d.promise;const task=h.api.renderCurrent();assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/ · x \d/);point(h,510,370);assert.equal(h.calls.inspectorReads.length,1);
  if(outcome==='failed')d.reject(Error('synthetic failure'));else{if(outcome==='discarded')h.api.set({viewToken:90});if(outcome==='wrong-photo')h.api.photos[0]={...p};if(outcome==='wrong-recipe')p.settings.exposure=44;d.resolve(h.canvas(100,80));}
  await task;if(outcome==='pending'){assert.ok(h.api.get().previewPixelCache);assert.equal(h.calls.inspectorReads.length,2);}else{h.api.syncPreviewPixelInspector();assert.equal(h.api.get().previewPixelCache,null);assert.equal(h.calls.inspectorReads.length,1);}
});
test('pixel UI: readback failure is closed once per accepted render, no toasts or editing failure, explicit toggle can retry',async()=>{
  let fail=true;const {h}=await prepared({readbackHook:()=>{if(fail)throw Error('synthetic readback denied');}});enable(h);assert.equal(h.api.get().previewPixelCache,null);assert.match(text(h),/编辑仍可继续/);
  for(let i=0;i<20;i++){point(h,510,370);h.api.syncPreviewPixelInspector();}assert.equal(h.calls.inspectorReads.length,1);assert.equal(h.get('toast').textContent,'');
  fail=false;enable(h,false);enable(h);assert.equal(h.calls.inspectorReads.length,2);assert.ok(h.api.get().previewPixelCache);h.api.changeSettings({contrast:4});await h.api.renderCurrent();assert.ok(h.api.get().previewPixelCache);
});
test('pixel UI: reentrant readback invalidation discards candidate and wrong-sized storage fails closed',async()=>{
  let run=()=>{};const {h,p}=await prepared({readbackHook:()=>run()});run=()=>{p.settings.exposure=2;};enable(h);assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/ · x \d/);
  run=()=>{};await h.api.renderCurrent();enable(h,false);h.api.get().rendered.pixels=new Uint8ClampedArray(4);enable(h);assert.equal(h.api.get().previewPixelCache,null);assert.match(text(h),/无法读取/);
});
test('pixel UI: photo switch, removal, blur, pointer leave and pagehide remove stale labels/readings',async()=>{
  const {h,p}=await enabled();inspectCenter(h);h.fire('viewport','pointerleave');assert.doesNotMatch(text(h),/ · x \d/);inspectCenter(h);h.events.get('blur')();assert.doesNotMatch(text(h),/ · x \d/);
  const next=h.photo('new'),d=defer();h.pipeline.decodeImage=()=>d.promise;const task=h.api.activatePhoto(next.id);assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/old.png/);d.resolve({canvas:h.canvas(100,80),originalWidth:100,originalHeight:80});await task;await flush();await h.api.renderCurrent();inspectCenter(h);assert.match(text(h),/new.png/);assert.doesNotMatch(text(h),/old.png/);
  h.api.removeSelected();assert.equal(h.api.get().previewPixelCache,null);assert.doesNotMatch(text(h),/new.png/);h.events.get('pagehide')();assert.equal(h.api.get().previewPixelEnabled,false);assert.equal(h.api.get().previewPixelCache,null);
});
test('pixel UI: missing optional core and DOM readout failures do not block processing',async()=>{
  const {h}=await prepared({pixelCore:false});enable(h);assert.equal(h.api.get().previewPixelCache,null);assert.match(text(h),/组件不可用/);h.api.changeSettings({exposure:2});await h.api.renderCurrent();assert.ok(h.api.get().acceptedRender);
  const other=await prepared();Object.defineProperty(other.h.get('previewPixelReadout'),'textContent',{get(){throw Error('detached UI');},set(){throw Error('detached UI');}});assert.doesNotThrow(()=>enable(other.h));await other.h.api.renderCurrent();assert.ok(other.h.api.get().acceptedRender);
});
// Native Skia uses a fifth color-space string, not browser ImageDataSettings.
// Adapt only that signature; production app readback, mapping and real pixels remain.
test('pixel UI native Skia: production readback and pointer handler report real accepted canvas RGBA',async t=>{
  let native;try{native=require('@napi-rs/canvas');}catch{t.skip('Installed native canvas unavailable; no browser claim');return;}
  const {h}=await prepared();h.pipeline.render=async()=>{const c=native.createCanvas(100,80),ctx=c.getContext('2d');ctx.fillStyle='rgba(240,80,16,0.5)';ctx.fillRect(0,0,100,80);const read=ctx.getImageData.bind(ctx);ctx.getImageData=(x,y,w,h,options)=>read(x,y,w,h,options?.colorSpace||'srgb');return c;};await h.api.renderCurrent();const canvas=h.api.get().rendered,pixel=canvas.getContext('2d').getImageData(50,40,1,1).data;
  enable(h);inspectCenter(h);assert.match(text(h),new RegExp(`R ${pixel[0]} · G ${pixel[1]} · B ${pixel[2]} · A ${pixel[3]}`));assert.match(text(h),/RGB 未与棋盘格合成/);assert.equal(h.api.get().previewPixelCache.image.data.length,32000);
});

test('pixel UI: pointer cancellation clears coordinates; wheel uses its own current pointer position',async()=>{
  const {h}=await enabled();inspectCenter(h);h.fire('viewport','pointercancel',{pointerId:8});assert.doesNotMatch(text(h),/ · x \d/);
  inspectCenter(h);h.fire('viewport','lostpointercapture',{pointerId:8});assert.doesNotMatch(text(h),/ · x \d/);
  inspectCenter(h);h.fire('viewport','wheel',{clientX:520,clientY:375,deltaY:-100});assert.match(text(h),/x 60 · y 45/);assert.equal(h.calls.inspectorReads.length,1);
});
