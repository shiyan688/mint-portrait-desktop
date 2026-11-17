'use strict';
// Executes shipped app functions with authored DOM/canvas/IPC doubles and the real
// Levels, reference, preset/project codecs and real geometry/pixel cores. This is not native-browser,
// model inference, screen-layout or native-dialog QA.
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
  const elements=new Map(),events=new Map(),calls={saved:[],opens:0,confirm:0,decoded:[],encoded:[],dirty:[],urls:[],revoked:[],writes:[],model:0,renders:[],encodes:[],draws:[]};let sequence=0,timer=0;
  class Element {
    constructor(tag){this.id=tag;this.tag=tag;this.children=[];this.parent=null;this.dataset={};this.style={setProperty(){}};this.attributes={};this.classes=new Set();this.classList={toggle:(c,on)=>{if(on??!this.classes.has(c))this.classes.add(c);else this.classes.delete(c);},add:(...cs)=>cs.forEach(c=>this.classes.add(c)),remove:(...cs)=>cs.forEach(c=>this.classes.delete(c)),contains:c=>this.classes.has(c)};this.value='';this.min='0';this.max='100';this.width=2;this.height=2;this.clientWidth=1000;this.clientHeight=700;this.listeners=new Map();this.open=false;this.innerHTML='';this.textContent='';}
    addEventListener(n,fn){this.listeners.set(n,fn);}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}insertAdjacentHTML(){}replaceChildren(...c){this.children=[];this.append(...c);}append(...c){for(const e of c){e.remove();this.children.push(e);e.parent=this;}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}focus(){}click(){return this.listeners.get('click')?.({target:this});}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(id){this.capture=null;}matches(selector){return selector.split(',').includes(this.tag)||selector==='[contenteditable]'&&this.isContentEditable;}closest(selector){return selector===`#${this.id}`||selector==='.control'?this:null;}showModal(){this.open=true;}close(){this.open=false;this.innerHTML='';this.textContent='';}
    querySelector(s){return this.children.find(e=>s==='input'?e.tag==='input':s==='span'?e.tag==='span':e.className===s.slice(1))||new Element('stub');}
    getBoundingClientRect(){const width=this.clientWidth,height=this.clientHeight;return {left:0,top:0,width,height,right:width,bottom:height};}
    toBlob(fn){fn(overrides.thumbnailFailure?.(++calls.thumbnailCount)?null:new Blob(['thumbnail'],{type:'image/jpeg'}));}
    getContext(){return {clearRect(){},drawImage:(canvas,...args)=>{if(overrides.copyHook&&this.id==='canvas')overrides.copyHook(this,canvas);calls.draws.push({target:this.id,canvas,args});if(canvas.pixels)this.pixels=new Uint8ClampedArray(canvas.pixels);},closePath(){},save(){},restore(){},beginPath(){},rect(){},clip(){},stroke(){},fill(){},arc(){},ellipse(){},lineTo(){},moveTo(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData:(image)=>{this.pixels=new Uint8ClampedArray(image.data);},getImageData:(x,y,w,h)=>{if(this.pixels)return {width:w,height:h,data:new Uint8ClampedArray(this.pixels)};const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data[i*4]=120+i%13;data[i*4+1]=110+i%7;data[i*4+2]=100+i%5;data[i*4+3]=255;}return {width:w,height:h,data};}};}
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
  let app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  app+='\nglobalThis.audit={editLevels,updateLevelsControls,updateToneHistogram,pinReference,clearReference,setReferenceCompare,freshAcceptedRender,referenceCaptureReason,updateReferenceComparison,cancelReferenceGesture,positionReferencePanes,fitReference,zoomReference,scheduleRender,queryPhotoReview,reviewDefaults,reviewOf,setReviewView,applyPhotoReview,selectVisiblePhotos,navigateReview,updateCards,updateReviewControls,batchScopeCounts,batchScopeLive,approveBatchScope,refreshExportPlan,stageNamedPreset,presetDocumentFromPhoto,stagedPresetDocument,applyNamedPreset,cancelNamedPresetApplication,saveNamedPreset,importNamedPreset,exportNamedPreset,removeNamedPreset,restoreNamedPreset,recoverNamedPresets,loadNamedPresets,presetFaceMeshReady,locked,analyzeCurrent,framingPlan,exportDimensions,previewDimensions,currentDisplayStamp,currentDisplayMode,sourceWorkingViewReady,originalForView,prepareFramingView,startCropDraft,cancelCropDraft,acceptCropDraft,framingAction,updateFramingControls,updateNumericCrop,drawCropOverlay,setCompare,fit,positionSurface,setTool,renderCurrent,manualPoint,beginManualStroke,appendManualStroke,finishManualStroke,editSelection,updateManualControls,photos,saveProject,openProject,projectSnapshot,startExport,cancelExport,openExport,exportLimit,addLocalLayer,removeLocalLayer,moveLocalLayer,changeLocalLayer,selectedLocalLayer,updateLocalControls,drawPreview,hasUnsavedProjectChanges,projectFingerprint,changeSettings,undo,redo,activatePhoto,importFiles,removeSelected,startExport,updateAvailability,factsForPhoto,appendPhotoCard,set:(v)=>{if("renderVersion"in v)renderVersion=v.renderVersion;if("renderController"in v)renderController=v.renderController;if("renderFailure"in v)renderFailure=v.renderFailure;if("projectOperation"in v)projectOperation=v.projectOperation;if("openingDialog"in v)openingDialog=v.openingDialog;if("loadingDemo"in v)loadingDemo=v.loadingDemo;if("renderPending"in v)renderPending=v.renderPending;if("viewToken"in v)viewToken=v.viewToken;if("pointer"in v)pointer=v.pointer;if("manualDraft"in v)manualDraft=v.manualDraft;if("cropDraft"in v)cropDraft=v.cropDraft;if("presetOperation"in v)presetOperation=v.presetOperation;if("manualViewReady"in v)manualViewReady=v.manualViewReady;if("originalHeld"in v)originalHeld=v.originalHeld;if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("modelState"in v)modelState=v.modelState;if("backendJob"in v)backendJob=v.backendJob;if("loadingPhoto"in v)loadingPhoto=v.loadingPhoto;if("analyzingPhoto"in v)analyzingPhoto=v.analyzingPhoto;if("renderingPhoto"in v)renderingPhoto=v.renderingPhoto;if("importing"in v)importing=v.importing;if("exportRunning"in v)exportRunning=v.exportRunning;if("matteDraft"in v)matteDraft=v.matteDraft;},get:()=>({toneHistogram,referenceSnapshot,referenceRequested,referenceSuspended,referencePointer,referenceRightCanvas,referenceViewState,acceptedRender,renderPending,renderFailure,renderVersion,reviewView,presetCatalog,presetCatalogReady,presetCatalogError,presetDraft,selectedPresetId,presetOperation,viewToken,cropDraft,renderedDisplayStamp,requestedDisplayMode,zoom,panX,panY,compare,repairSample,repairMode,manualDraft,manualViewReady,renderedManualMode,pointer,tool,rendered,exportQueue,exportFolder,exportRunning,projectOperation,projectDisplayName,currentId,source,analysis,matteDraft,loadingPhoto,savedProjectFingerprint})};';
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


const pixels = canvas => canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
async function pinned(overrides={}) { const h=await ready(overrides),p=h.activate();await h.api.renderCurrent();await flush();assert.equal(h.api.referenceCaptureReason(),'');assert.equal(h.api.pinReference(),true);return {h,p}; }
function gesture(h,pane='referencePane',id=6){h.fire(pane,'pointerdown',{pointerId:id,button:0,clientX:300,clientY:200});assert.equal(h.api.get().referencePointer?.id,id);h.fire(pane,'pointermove',{pointerId:id,clientX:330,clientY:220});}
function keyboard(h,key,code=key){h.events.get('keydown')({key,code,target:h.get('viewport'),preventDefault(){}});}

const fields = ['InputBlack','Gamma','InputWhite','OutputBlack','OutputWhite'];
const setInput = (h,id,value,commit=true) => { h.get(id).value=String(value);h.fire(id,'input');if(commit)h.fire(id,'change'); };
const select = (h,value) => { h.get('levelsChannel').value=value;h.fire('levelsChannel','change'); };
const recipe = (changes={},channel='rgb') => { const value=Levels.defaults();Object.assign(value.channels[channel],changes);return value; };
const preset = (levels=null) => { const doc=Presets.defaults('色阶测试');doc.controls.levels=levels;return doc; };

test('Levels DOM: five labelled endpoint/gamma sliders, explicit four channels, strength, guards and correct script order',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const section=/<details id="levelsSection"([^>]*)>[\s\S]*?<\/details>/.exec(html);assert.ok(section);assert.doesNotMatch(section[1],/\bopen\b/);
 assert.ok(html.indexOf('id="colorSection"')<html.indexOf('id="lightBalanceSection"'));assert.ok(html.indexOf('id="lightBalanceSection"')<html.indexOf('id="levelsSection"'));assert.ok(html.indexOf('id="levelsSection"')<html.indexOf('id="advancedToneSection"'));
 for(const name of fields){assert.match(section[0],new RegExp(`label for="levels${name}"`));assert.match(section[0],new RegExp(`output id="levels${name}Value" for="levels${name}"`));assert.match(section[0],new RegExp(`input id="levels${name}" type="range"`));}
 assert.equal((section[0].match(/type="range"/g)||[]).length,6);assert.equal((section[0].match(/<option/g)||[]).length,4);
 for(const text of ['0–255 整数','必须小于','可等于','不会暗中交换','8位 sRGB','Gamma &gt; 1 提亮','先基础调色，再明暗/白平衡、色阶，最后曲线/HSL','整体强度只混合一次'])assert.ok(section[0].includes(text),text);
 for(const consumer of ['advanced-tone.cjs','preset-codec.cjs','project-document.cjs','app.js'])assert.ok(html.indexOf('src="levels.cjs"')<html.indexOf(`src="${consumer}"`));
 assert.match(html,/同步基础调色、明暗\/白平衡、色阶/);assert.match(html,/预览直方图/);assert.match(html,/不是 RAW 或全尺寸分析/);
 assert.match(fs.readFileSync(path.join(__dirname,'../src/styles.css'),'utf8'),/\.levels-section input:focus-visible/);
});

test('Levels UI: neutral defaults and channel navigation do not change pixels, history, recipe or project fingerprint',async()=>{
 const h=await ready(),p=h.activate(),before=h.api.projectFingerprint(),source=pixels(h.api.get().source);
 assert.equal(p.settings.levels,null);assert.equal(h.get('resetLevels').disabled,true);
 for(const channel of ['red','green','blue','rgb']){select(h,channel);assert.equal(h.get('levelsGamma').value,1);assert.equal(h.get('levelsInputBlack').value,0);assert.equal(h.get('levelsInputWhite').value,255);}
 h.fire('resetLevelsChannel');h.fire('resetLevels');assert.equal(h.api.projectFingerprint(),before);assert.equal(p.undo.length,0);
 await h.api.renderCurrent();assert.deepEqual(pixels(h.api.get().rendered),source);assert.equal(p.settings.levels,null);
 assert.equal(h.calls.codecDependencies.levels,h.context.window.MintLevels);assert.equal(h.calls.codecDependencies.advancedTone,h.context.window.MintAdvancedTone);
});

test('Levels UI: live input changes real pixels, invalidates accepted preview and groups a drag into one reversible history step',async()=>{
 const h=await ready(),p=h.activate(),original=pixels(h.api.get().source);await h.api.renderCurrent();const neutral=pixels(h.api.get().rendered);
 setInput(h,'levelsGamma',1.5,false);setInput(h,'levelsGamma',2,false);assert.equal(p.undo.length,0);assert.equal(p.revision,0);assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().renderPending,true);assert.equal(h.api.get().toneHistogram,null);
 assert.equal(h.get('levelsGammaValue').textContent,'2');h.fire('levelsGamma','change');assert.equal(p.undo.length,1);assert.equal(p.revision,1);
 await h.api.renderCurrent();const adjusted=pixels(h.api.get().rendered);assert.ok(adjusted[0]>neutral[0]);for(let i=3;i<adjusted.length;i+=4)assert.equal(adjusted[i],neutral[i]);assert.deepEqual(pixels(h.api.get().source),original);
 h.api.undo();assert.equal(p.settings.levels,null);await h.api.renderCurrent();assert.deepEqual(pixels(h.api.get().rendered),neutral);
 h.api.redo();assert.equal(p.settings.levels.channels.rgb.gamma,2);await h.api.renderCurrent();assert.deepEqual(pixels(h.api.get().rendered),adjusted);
});

test('Levels UI: four channel selections retain independent parameters; switching channels does not commit or render',async()=>{
 const h=await ready(),p=h.activate();
 for(const [i,channel] of ['rgb','red','green','blue'].entries()){select(h,channel);setInput(h,'levelsInputBlack',i+3);setInput(h,'levelsInputWhite',245-i);setInput(h,'levelsGamma',1+i*.2);setInput(h,'levelsOutputBlack',i+7);setInput(h,'levelsOutputWhite',230-i);}
 const prior=state(p),version=h.api.get().renderVersion;
 for(const [i,channel] of ['rgb','red','green','blue'].entries()){select(h,channel);assert.equal(Number(h.get('levelsInputBlack').value),i+3);assert.equal(Number(h.get('levelsGamma').value),1+i*.2);assert.equal(Number(h.get('levelsInputWhite').min),i+4);assert.equal(Number(h.get('levelsOutputBlack').max),230-i);}
 assert.deepEqual(state(p),prior);assert.equal(h.api.get().renderVersion,version);
});

test('Levels UI: a change-only keyboard/accessibility event validates and commits its value once',async()=>{
 const h=await ready(),p=h.activate();h.get('levelsInputBlack').value='24';h.fire('levelsInputBlack','change');assert.equal(p.settings.levels.channels.rgb.inputBlack,24);assert.equal(p.undo.length,1);
 h.fire('levelsInputBlack','change');assert.equal(p.undo.length,1);assert.equal(Number(h.get('levelsInputWhite').min),25);
});

test('Levels UI: endpoint order, integer limits, gamma and strength are validated before mutation without silent repair',async()=>{
 const h=await ready(),p=h.activate();setInput(h,'levelsInputWhite',170);setInput(h,'levelsOutputWhite',190);const prior=state(p),version=h.api.get().renderVersion;
 for(const [name,value] of [['InputBlack',170],['InputBlack',171],['InputBlack',3.5],['InputBlack',-1],['InputWhite',256],['InputWhite',0],['OutputBlack',191],['OutputWhite',-1],['OutputWhite',2.5],['Gamma',0],['Gamma',.099],['Gamma',10.01],['Gamma','NaN'],['Strength',-1],['Strength',101],['Strength','Infinity']]){
  h.get(`levels${name}`).value=String(value);h.fire(`levels${name}`,'input');assert.deepEqual(state(p),prior,`${name}=${value}`);assert.match(h.get('toast').textContent,/色阶未更改/);
 }
 assert.equal(h.api.get().renderVersion,version);assert.equal(Number(h.get('levelsInputBlack').max),169);assert.equal(Number(h.get('levelsOutputBlack').max),190);
});

test('Levels UI: equal output endpoints are legal, collapsed ranges stay finite and alpha is untouched',async()=>{
 const h=await ready(),p=h.activate(),source=h.api.get().source;source.pixels=pixels(source);for(let i=3;i<source.pixels.length;i+=4)source.pixels[i]=i%256;source.pixels[3]=0;
 setInput(h,'levelsOutputWhite',0);assert.equal(p.settings.levels.channels.rgb.outputWhite,0);assert.equal(Number(h.get('levelsOutputBlack').max),0);await h.api.renderCurrent();const out=pixels(h.api.get().rendered);for(let i=0;i<out.length;i+=4){assert.equal(out[i],source.pixels[i+3]===0?source.pixels[i]:0);assert.equal(out[i+1],source.pixels[i+3]===0?source.pixels[i+1]:0);assert.equal(out[i+2],source.pixels[i+3]===0?source.pixels[i+2]:0);assert.equal(out[i+3],source.pixels[i+3]);}
 setInput(h,'levelsOutputWhite',255);setInput(h,'levelsOutputBlack',255);assert.equal(Number(h.get('levelsOutputWhite').min),255);
});

test('Levels UI: strength zero is pixel identity, preserves channels, and channel/all resets have exact undo scope',async()=>{
 const h=await ready(),p=h.activate(),source=pixels(h.api.get().source);select(h,'red');setInput(h,'levelsGamma',2);select(h,'blue');setInput(h,'levelsOutputBlack',32);setInput(h,'levelsStrength',40);
 h.fire('resetLevelsChannel');assert.equal(p.settings.levels.channels.blue.outputBlack,0);assert.equal(p.settings.levels.channels.red.gamma,2);assert.equal(p.settings.levels.strength,.4);
 setInput(h,'levelsStrength',0);await h.api.renderCurrent();assert.deepEqual(pixels(h.api.get().rendered),source);assert.match(h.get('levelsStatus').textContent,/强度为0/);assert.equal(p.settings.levels.channels.red.gamma,2);
 const prior=plain(p.settings.levels);h.fire('resetLevels');assert.equal(p.settings.levels,null);h.api.undo();assert.deepEqual(plain(p.settings.levels),prior);h.api.redo();assert.equal(p.settings.levels,null);
});

test('Levels UI: missing core and all existing application locks reject injected control edits without affecting saved recipes',async()=>{
 const absent=await ready({levelsCore:false}),saved=recipe({gamma:1.7}),p=absent.activate(absent.photo('saved',{levels:saved})),prior=state(p);
 for(const id of [...fields.map(name=>`levels${name}`),'levelsStrength','levelsChannel','resetLevelsChannel','resetLevels'])assert.equal(absent.get(id).disabled,true);
 setInput(absent,'levelsGamma',2);absent.fire('resetLevelsChannel');absent.fire('resetLevels');assert.deepEqual(state(p),prior);assert.match(absent.get('levelsStatus').textContent,/核心不可用/);assert.equal(absent.get('captureNamedPreset').disabled,true);
 const h=await ready(),q=h.activate();for(const [flag,value] of [['exportRunning',true],['loadingPhoto',true],['importing',true],['openingDialog',true],['loadingDemo',true],['projectOperation','save'],['presetOperation',{kind:'apply'}]]){
  h.api.set({[flag]:value});h.api.updateAvailability();assert.equal(h.get('levelsGamma').disabled,true,flag);setInput(h,'levelsGamma',2);h.fire('resetLevels');assert.equal(q.settings.levels,null);assert.equal(q.undo.length,0);h.api.set({[flag]:typeof value==='string'?'':flag==='presetOperation'?null:false});
 }
 h.api.updateAvailability();assert.equal(h.get('levelsGamma').disabled,false);
});

test('Levels UI: core validation errors stay local, corrupted recipe is visible and explicit reset is recoverable',async()=>{
 const h=await ready(),p=h.activate();const before=state(p);h.context.window.MintLevels.validate=()=>{throw Error('authored core failure');};setInput(h,'levelsGamma',2);assert.deepEqual(state(p),before);assert.equal(h.get('levelsGamma').disabled,true);assert.match(h.get('levelsStatus').textContent,/authored core failure/);
 h.context.window.MintLevels.validate=value=>Levels.validate(structuredClone(value));p.settings.levels=recipe({inputBlack:200,inputWhite:100});p.committed=structuredClone(p.settings);h.api.updateAvailability();assert.match(h.get('levelsStatus').textContent,/参数无效/);assert.equal(h.get('resetLevels').disabled,false);h.fire('resetLevels');assert.equal(p.settings.levels,null);assert.equal(p.undo.length,1);assert.equal(h.get('levelsGamma').disabled,false);
});

test('Levels UI: an uncommitted Levels edit invalidates reference capture and late rendered/histogram results, retaining frozen pixels',async()=>{
 const {h,p}=await pinned(),frozen=h.api.get().referenceSnapshot,frozenPixels=pixels(frozen.canvas),previous=h.api.get().rendered,gate=defer(),real=h.pipeline.render;
 h.pipeline.render=()=>gate.promise;const pending=h.api.renderCurrent();await flush();setInput(h,'levelsGamma',1.8,false);assert.equal(p.undo.length,0);assert.equal(h.api.pinReference(),false);assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().toneHistogram,null);
 gate.resolve(h.canvas(100,80));await pending;assert.equal(h.api.get().rendered,previous);assert.equal(h.api.get().referenceSnapshot,frozen);assert.deepEqual(pixels(frozen.canvas),frozenPixels);assert.equal(h.api.freshAcceptedRender(),false);
 h.pipeline.render=real;h.fire('levelsGamma','change');await h.api.renderCurrent();assert.equal(h.api.freshAcceptedRender(),true);assert.notDeepEqual(pixels(h.api.get().rendered),frozenPixels);assert.deepEqual(pixels(frozen.canvas),frozenPixels);
 const accepted=h.api.get().acceptedRender;assert.equal(h.api.updateToneHistogram(previous,{token:accepted.viewToken,version:accepted.generation-1,photoId:p.id,sourceRevision:p.sourceRevision}),false);
});

test('Levels UI: a source revision change during rendering cannot accept stale Levels pixels',async()=>{
 const h=await ready(),p=h.activate();setInput(h,'levelsGamma',2);const gate=defer();h.pipeline.render=()=>gate.promise;const pending=h.api.renderCurrent();await flush();p.sourceRevision='replacement-source';gate.resolve(h.canvas(100,80));await pending;assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().toneHistogram,null);assert.equal(h.api.get().rendered,null);
});

test('Levels presets: capture uses v3 real codec, clones all channels, and neither dirties photos nor leaks source-bound data',async()=>{
 const h=await ready(),levels=recipe({inputBlack:13,gamma:1.5});levels.channels.red.gamma=.8;const p=h.activate(h.photo('private',{levels,framing:{version:1,crop:{x:0,y:0,w:1,h:1},quarterTurns:1,flipX:false,flipY:false},manualRepair:[],learnedMatteId:'private-cache'}));
 const before=h.api.projectFingerprint();h.get('namedPresetName').value='色阶配方';h.fire('captureNamedPreset');const doc=h.api.stagedPresetDocument();assert.equal(doc.version,3);assert.deepEqual(plain(doc.controls.levels),levels);assert.equal(h.api.projectFingerprint(),before);assert.doesNotMatch(Presets.stringify(structuredClone(doc)),/private|framing|manualRepair|learnedMatteId/);
 doc.controls.levels.channels.red.gamma=3;assert.equal(p.settings.levels.channels.red.gamma,.8);assert.equal(h.api.stagedPresetDocument().controls.levels.channels.red.gamma,.8);
});

for(const mode of ['full','color'])test(`Levels presets: ${mode} applies v2 channels and v1 neutral migration atomically in selected scope with individual undo`,async()=>{
 const h=await ready(),old=recipe({gamma:.7}),a=h.activate(h.photo('a',{levels:old,smooth:10})),b=h.photo('b',{levels:old,smooth:30}),c=h.photo('c',{levels:old});c.selected=false;
 const newLevels=recipe({inputBlack:20,gamma:1.4}),doc=preset(newLevels);doc.version=2;delete doc.controls.lightBalance;doc.controls.basic.contrast=12;const before=[a,b,c].map(state);
 stage(h,doc,'selected',mode);await h.api.applyNamedPreset();for(const [i,p] of [a,b].entries()){assert.deepEqual(plain(p.settings.levels),newLevels);assert.equal(p.settings.smooth,mode==='full'?0:before[i].settings.smooth);assert.equal(p.undo.length,1);assert.deepEqual(plain(p.undo[0]),before[i].settings);}assert.deepEqual(state(c),before[2]);
 const legacy=preset();legacy.version=1;delete legacy.controls.levels;delete legacy.controls.lightBalance;stage(h,legacy,'selected',mode);await h.api.applyNamedPreset();assert.equal(a.settings.levels,null);assert.equal(b.settings.levels,null);assert.deepEqual(plain(c.settings.levels),old);h.api.undo();assert.deepEqual(plain(a.settings.levels),newLevels);
});

test('Levels presets: invalid endpoints fail before staging or mutating targets',async()=>{
 const h=await ready(),a=h.activate(),before=state(a),bad=preset(recipe({inputBlack:201,inputWhite:200}));assert.throws(()=>stage(h,bad),/input|black|white|endpoint/i);assert.deepEqual(state(a),before);assert.equal(h.api.get().presetDraft,null);
});

test('Levels presets: source-bound/manual/framing settings and review survive batch color apply and sync',async()=>{
 const h=await ready(),a=h.activate(h.photo('a',{levels:recipe({gamma:1.5})})),b=h.photo('b');const framing={version:1,crop:{x:.1,y:.2,w:.7,h:.6},quarterTurns:1,flipX:true,flipY:false};Object.assign(b.settings,{framing,manualSelection:{version:1,sourceRevision:b.sourceRevision,base:'all',inverted:false,feather:0,commands:[]},manualRepair:[],localLayers:[],spots:[{x:.5,y:.5,r:.03}],learnedMatteId:'source-cache',learnedMatteStrokes:[],slim:4});b.committed=structuredClone(b.settings);const original=structuredClone(b.settings),review=plain(b.review),blob=b.blob,cache=b.learnedCache;
 const doc=preset(recipe({gamma:2},'blue'));stage(h,doc,'all','color');await h.api.applyNamedPreset();for(const key of ['framing','manualSelection','manualRepair','localLayers','spots','learnedMatteId','learnedMatteStrokes','slim'])assert.deepEqual(plain(b.settings[key]),plain(original[key]));assert.deepEqual(plain(b.review),review);assert.equal(b.blob,blob);assert.equal(b.learnedCache,cache);
 select(h,'green');setInput(h,'levelsInputBlack',11);h.get('syncScope').value='all';h.fire('applySync');assert.deepEqual(plain(b.settings.levels),plain(a.settings.levels));assert.notEqual(b.settings.levels,a.settings.levels);assert.deepEqual(plain(b.settings.framing),framing);assert.deepEqual(plain(b.settings.manualSelection),plain(original.manualSelection));
});

test('Levels built-in presets reset Levels and advanced tone together, retaining independent editing state',async()=>{
 const tone=Tone.defaults();tone.curves.rgb[2]=.65;const h=await ready({pipeline:{PRESETS:[{id:'neutral',name:'中性',description:'测试',settings:{exposure:12}}]}}),p=h.activate(h.photo('builtin',{levels:recipe({gamma:2}),advancedTone:tone,framing:{version:1,crop:{x:0,y:0,w:1,h:1},quarterTurns:1,flipX:false,flipY:false},manualRepair:[],localLayers:[],spots:[{x:.2,y:.3,r:.02}]})),before=state(p);
 const button=h.get('presets').children[0];assert.match(button.title,/重置色阶与高级调色/);button.click();assert.equal(p.settings.levels,null);assert.equal(p.settings.advancedTone,null);assert.equal(p.settings.exposure,12);for(const key of ['framing','manualRepair','localLayers','spots'])assert.deepEqual(plain(p.settings[key]),before.settings[key]);assert.equal(p.undo.length,1);h.api.undo();assert.deepEqual(plain(p.settings),before.settings);
});

test('Levels UI: rendering errors retain editable recipe, clear histogram and cannot expose failed pixels as a reference',async()=>{
 const h=await ready(),p=h.activate();await h.api.renderCurrent();setInput(h,'levelsGamma',1.7);const saved=plain(p.settings.levels),real=h.pipeline.render;
 h.pipeline.render=async()=>{throw Error('authored Levels rendering failure');};await h.api.renderCurrent();assert.deepEqual(plain(p.settings.levels),saved);assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().toneHistogram,null);assert.equal(h.api.pinReference(),false);assert.match(h.api.get().renderFailure,/Levels rendering failure/);assert.match(h.get('toast').textContent,/处理失败/);
 h.fire('resetLevels');h.pipeline.render=real;await h.api.renderCurrent();assert.equal(p.settings.levels,null);assert.equal(h.api.get().renderFailure,'');assert.equal(h.api.freshAcceptedRender(),true);
});

test('Levels project: exact recipes, per-channel UI and undo history survive real v7 encode/decode and application restore',async()=>{
 const h=await ready(),p=h.activate();setInput(h,'levelsInputBlack',17);select(h,'red');setInput(h,'levelsGamma',1.75);setInput(h,'levelsStrength',37);const expected=plain(p.settings.levels);
 await h.api.saveProject();assert.equal(h.calls.saved.length,1,h.get('toast').textContent);const bytes=h.calls.saved[0].bytes,decoded=await Codec.decode(bytes);assert.equal(decoded.version,Codec.VERSION);assert.deepEqual(plain(decoded.photos[0].settings.levels),expected);assert.ok(decoded.photos[0].undo.some(value=>value.levels?.channels.red.gamma===1.75));
 const restored=await ready({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'levels.mintproj'})}});restored.activate();await restored.api.openProject();await settle(restored);assert.deepEqual(plain(restored.api.photos[0].settings.levels),expected);select(restored,'red');assert.equal(Number(restored.get('levelsGamma').value),1.75);assert.equal(Number(restored.get('levelsStrength').value),37);select(restored,'rgb');assert.equal(Number(restored.get('levelsInputBlack').value),17);
 restored.api.undo();assert.equal(restored.api.photos[0].settings.levels.strength,1);restored.api.redo();assert.deepEqual(plain(restored.api.photos[0].settings.levels),expected);
});

test('Levels UI: existing liquify and framed photo retain commands/source geometry while Levels are edited and undone',async()=>{
 const h=await ready(),push={sourceRevision:'manual:source-0',kind:'push',radius:.1,strength:.5,points:[{x:.4,y:.5},{x:.5,y:.5}],selection:null},framing={version:1,crop:{x:.1,y:.1,w:.8,h:.8},quarterTurns:1,flipX:false,flipY:true};
 const p=h.activate(h.photo('manual',{manualLiquify:[push],framing})),before=plain(p.settings);await h.api.renderCurrent();setInput(h,'levelsGamma',1.6);assert.equal(p.settings.levels.channels.rgb.gamma,1.6);assert.deepEqual(plain(p.settings.manualLiquify),[push]);assert.deepEqual(plain(p.settings.framing),framing);await h.api.renderCurrent();assert.ok(h.api.get().acceptedRender,h.get('toast').textContent);assert.equal(h.api.get().rendered.width,64);assert.equal(h.api.get().rendered.height,80);
 h.api.undo();assert.deepEqual(plain(p.settings),before);assert.equal(h.api.get().source.width,100);assert.equal(h.api.get().source.height,80);
});

test('Levels presets: cancellation during portrait preflight never commits the Levels part early',async()=>{
 const gate=defer(),h=await ready({pipeline:{analyze:()=>gate.promise}}),p=h.activate(),before=state(p),doc=preset(recipe({gamma:2}));doc.controls.beauty.smooth=35;h.api.set({modelState:'ready'});stage(h,doc,'current','full');const applying=h.api.applyNamedPreset();await until(()=>h.calls.decoded.length===1);assert.deepEqual(state(p),before);h.api.cancelNamedPresetApplication();gate.resolve(authoredMesh());await applying;assert.deepEqual(state(p),before);assert.equal(h.api.get().presetOperation,null);assert.match(h.get('toast').textContent,/取消/);
});
