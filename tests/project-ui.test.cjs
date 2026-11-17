'use strict';
// Executes shipped app functions with authored DOM/canvas/IPC doubles and the real
// project codec. This is not native-browser, model inference, or native-dialog QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
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
  const elements=new Map(),events=new Map(),calls={saved:[],opens:0,confirm:0,decoded:[],encoded:[],dirty:[],urls:[],revoked:[],writes:[],model:0};let sequence=0,timer=0;
  class Element {
    constructor(tag){this.id=tag;this.tag=tag;this.children=[];this.parent=null;this.dataset={};this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.value='';this.min='0';this.max='100';this.width=2;this.height=2;this.clientWidth=1000;this.clientHeight=700;this.listeners=new Map();this.open=false;}
    addEventListener(n,fn){this.listeners.set(n,fn);}setAttribute(){}insertAdjacentHTML(){}replaceChildren(...c){this.children=[];this.append(...c);}append(...c){for(const e of c){e.remove();this.children.push(e);e.parent=this;}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}focus(){}click(){return this.listeners.get('click')?.({target:this});}setPointerCapture(){}matches(){return false;}closest(){return this;}showModal(){this.open=true;}close(){this.open=false;}
    querySelector(s){return this.children.find(e=>s==='input'?e.tag==='input':s==='span'?e.tag==='span':e.className===s.slice(1))||new Element('stub');}
    getBoundingClientRect(){return {left:0,top:0,width:1000,height:700,right:1000,bottom:700};}
    toBlob(fn){fn(overrides.thumbnailFailure?.(++calls.thumbnailCount)?null:new Blob(['thumbnail'],{type:'image/jpeg'}));}
    getContext(){return {clearRect(){},drawImage(){},save(){},restore(){},beginPath(){},rect(){},clip(){},stroke(){},fill(){},arc(){},lineTo(){},moveTo(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){}};}
  }
  calls.thumbnailCount=0;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});
  get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';get('matteRadius').value='4';get('matteHardness').value='100';get('matteOpacity').value='100';
  const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),
    decodeImage:async(blob,max)=>{calls.decoded.push({blob,max});const d=Codec.inspectImage(new Uint8Array(await blob.arrayBuffer()),blob.type);return {canvas:canvas(Math.min(d.width,max),Math.min(d.height,max)),originalWidth:d.width,originalHeight:d.height};},
    analyze:async()=>{calls.model++;return {faceCount:0,landmarks:[],mask:null};},render:async c=>c,encode:async()=>new Uint8Array(sourceBytes),...overrides.pipeline};
  const bridge={saveProject:async payload=>{calls.saved.push(payload);return {canceled:false,displayName:'saved.mintproj'};},openProject:async()=>{calls.opens++;return {canceled:true};},confirmReplaceProject:async()=>{calls.confirm++;return true;},setSessionDirty:v=>calls.dirty.push(v),onMenuAction:fn=>events.set('menu',fn),chooseExportFolder:async()=>({token:'test',displayPath:'test folder'}),writeExport:async payload=>calls.writes.push(payload),...overrides.bridge};
  const codec={encode:async value=>{calls.encoded.push(structuredClone(value));return Codec.encode(structuredClone(value));},decode:bytes=>Codec.decode(bytes),...overrides.codec};
  const context=vm.createContext({Pipeline:pipeline,window:{desktop:bridge,MintExportQueue:require('../src/export-queue.cjs'),MintProjectDocument:codec,MintLearnedAnalysis:Learned,addEventListener:(n,fn)=>events.set(n,fn)},document:{getElementById:get,querySelectorAll:s=>s==='.photo-card'?get('filmstrip').children.filter(e=>e.className==='photo-card'):[],querySelector:s=>get('filmstrip').children.find(e=>s===`[data-photo-id="${e.dataset.photoId}"]`)||null,createElement:t=>new Element(t),body:new Element('body')},console,structuredClone,AbortController,Blob,Uint8Array,Float32Array,Uint8ClampedArray,ArrayBuffer,HTMLElement:Element,crypto:{randomUUID:()=>`photo-${++sequence}`},URL:{createObjectURL:()=>{const u=`blob:thumb-${++sequence}`;calls.urls.push(u);return u;},revokeObjectURL:u=>calls.revoked.push(u)},ResizeObserver:class{observe(){}},setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){},setInterval:()=>++timer,clearInterval(){}});
  let app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  app+='\nglobalThis.audit={photos,saveProject,openProject,projectSnapshot,hasUnsavedProjectChanges,projectFingerprint,changeSettings,undo,redo,activatePhoto,importFiles,removeSelected,startExport,updateAvailability,factsForPhoto,appendPhotoCard,set:(v)=>{if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("modelState"in v)modelState=v.modelState;if("backendJob"in v)backendJob=v.backendJob;if("loadingPhoto"in v)loadingPhoto=v.loadingPhoto;if("analyzingPhoto"in v)analyzingPhoto=v.analyzingPhoto;if("renderingPhoto"in v)renderingPhoto=v.renderingPhoto;if("importing"in v)importing=v.importing;if("exportRunning"in v)exportRunning=v.exportRunning;if("matteDraft"in v)matteDraft=v.matteDraft;},get:()=>({projectOperation,projectDisplayName,currentId,source,analysis,matteDraft,loadingPhoto,savedProjectFingerprint})};';
  vm.runInContext(app,context);const api=context.audit;
  function photo(id='old',settings={}){const p={id,name:`${id}.png`,blob:new Blob([sourceBytes],{type:'image/png'}),thumb:`blob:old-${id}`,sourceRevision:`${id}:source-0`,originalWidth:100,originalHeight:80,selected:true,settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,preset:null,learnedCache:new Map()};api.photos.push(p);api.appendPhotoCard(p);return p;}
  function activate(p=photo()){api.set({currentId:p.id,source:canvas(100,80),analysis:null});api.updateAvailability();return p;}
  const fire=(id,name='click',extra={})=>get(id).listeners.get(name)?.({target:get(id),preventDefault(){},stopPropagation(){},...extra});
  return {api,photo,activate,calls,bridge,pipeline,codec,events,get,fire,canvas};
}

test('project UI: saves exact compressed sources, per-photo state/history, and export metadata through real codec',async()=>{
  const h=harness(),p=h.activate(h.photo('one',{exposure:23}));p.selected=false;p.exportedSettings=JSON.stringify(p.settings);
  await h.api.saveProject();assert.equal(h.calls.saved.length,1);const saved=await Codec.decode(h.calls.saved[0].bytes);
  assert.deepEqual(saved.photos[0].source.bytes,sourceBytes);assert.equal(saved.photos[0].source.width,100);assert.equal(saved.photos[0].settings.exposure,23);assert.equal(saved.photos[0].undo.length,1);assert.equal(saved.photos[0].committed.exposure,23);assert.equal(saved.photos[0].selected,false);assert.equal(saved.photos[0].exportedSettings.exposure,23);assert.equal(h.api.hasUnsavedProjectChanges(),false);assert.equal(h.calls.dirty.at(-1),false);assert.equal(h.api.get().projectOperation,'');
});
test('project UI: exporting never substitutes for saving the project',async()=>{
  const h=harness(),p=h.activate(h.photo('one',{exposure:12}));await h.api.startExport({preventDefault(){}});assert.equal(h.calls.writes.length,1);assert.equal(h.api.hasUnsavedProjectChanges(),true);await flush();await h.api.saveProject();assert.equal(h.api.hasUnsavedProjectChanges(),false);await flush();await h.api.startExport({preventDefault(){}});assert.equal(h.api.hasUnsavedProjectChanges(),false);await flush();h.api.changeSettings({exposure:24});assert.equal(h.api.hasUnsavedProjectChanges(),true);
});
for(const outcome of ['cancel','error'])test(`project UI: save ${outcome} retains dirty session and original URLs`,async()=>{
  const h=harness({bridge:{saveProject:async()=>{if(outcome==='error')throw new Error('disk full');return {canceled:true};}}}),p=h.activate();await h.api.saveProject();assert.equal(h.api.photos[0],p);assert.equal(h.api.hasUnsavedProjectChanges(),true);assert.deepEqual(h.calls.revoked,[]);assert.equal(h.api.get().projectOperation,'');
});
test('project UI: save locks mutation and repeated operations; late unexpected edits cannot become clean',async()=>{
  const d=defer(),entered=defer(),h=harness({bridge:{saveProject:async payload=>{h.calls.saved.push(payload);entered.resolve();return d.promise;}}}),p=h.activate();const first=h.api.saveProject();await entered.promise;
  h.api.changeSettings({exposure:65});h.api.removeSelected();await h.api.saveProject();await h.api.openProject();await h.api.startExport({preventDefault(){}});assert.equal(p.settings.exposure,0);assert.equal(h.api.photos.length,1);assert.equal(h.calls.saved.length,1);assert.equal(h.calls.opens,0);assert.equal(h.calls.writes.length,0);
  p.settings.exposure=7;d.resolve({canceled:false,displayName:'saved.mintproj'});await first;assert.equal(h.api.hasUnsavedProjectChanges(),true);
});
for(const flag of ['backendJob','loadingPhoto','analyzingPhoto','renderingPhoto','importing','exportRunning'])test(`project UI: ${flag} blocks both project entries`,async()=>{
  const h=harness();h.activate();h.api.set({[flag]:flag==='backendJob'?{id:'pending'}:true});await h.api.saveProject();await h.api.openProject();assert.equal(h.calls.saved.length,0);assert.equal(h.calls.opens,0);
});
test('project UI: save discards unfinished matte brush rather than persisting draft',async()=>{
  const h=harness();h.activate();h.api.set({matteDraft:{photoId:'old'}});await h.api.saveProject();assert.equal(h.api.get().matteDraft,null);assert.equal(h.calls.encoded[0].photos[0].settings.learnedMatteStrokes,undefined);
});
test('project UI: complete decode and all thumbnails precede confirmation/replacement',async()=>{
  const s=snapshot('first');s.photos.push({...structuredClone(s.photos[0]),id:'second',name:'second.png',sourceRevision:'second:source-0'});s.currentId='second';const bytes=await Codec.encode(s);
  const h=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'two.mintproj'}),confirmReplaceProject:async()=>{assert.equal(h.calls.decoded.length,2);assert.equal(h.calls.urls.length,2);assert.equal(h.api.photos[0],old);h.calls.confirm++;return true;}}}),old=h.activate();
  await h.api.openProject();assert.equal(h.calls.confirm,1);assert.equal(h.api.photos.length,2);assert.equal(h.api.get().currentId,'second');assert.equal(h.api.photos[0].selected,false);assert.equal(h.api.photos[0].undo.length,1);assert.ok(h.calls.revoked.includes(old.thumb));assert.equal(h.api.hasUnsavedProjectChanges(),false);assert.deepEqual(h.calls.decoded.map(x=>x.max),[320,1280]);
});
for(const failure of ['chooser-cancel','invalid-container','decode','dimensions','thumbnail','decline','missing-confirm'])test(`project UI: ${failure} preserves prior state and releases only staged URLs`,async()=>{
  const bytes=await Codec.encode(snapshot());const h=harness({thumbnailFailure:failure==='thumbnail'?()=>true:undefined,bridge:{openProject:async()=>failure==='chooser-cancel'?{canceled:true}:{canceled:false,bytes:failure==='invalid-container'?new Uint8Array([1,2]):bytes,displayName:'new.mintproj'},...(failure==='decline'?{confirmReplaceProject:async()=>false}:{}),...(failure==='missing-confirm'?{confirmReplaceProject:undefined}:{} )}}),old=h.activate(h.photo('old',{exposure:19})),oldSource=h.api.get().source;
  if(failure==='decode')h.pipeline.decodeImage=async()=>{throw new Error('image decode failed');};if(failure==='dimensions')h.pipeline.decodeImage=async()=>({canvas:h.canvas(2,2),originalWidth:2,originalHeight:2});
  const before=h.api.projectFingerprint();await h.api.openProject();assert.equal(h.api.photos[0],old);assert.equal(h.api.get().source,oldSource);assert.equal(h.api.projectFingerprint(),before);assert.equal(h.api.hasUnsavedProjectChanges(),true);assert.ok(!h.calls.revoked.includes(old.thumb));for(const url of h.calls.urls)assert.ok(h.calls.revoked.includes(url));assert.equal(h.api.get().projectOperation,'');
});
test('project UI: later source failure frees earlier staged thumbnail without discarding workspace',async()=>{
  const s=snapshot('one');s.photos.push({...structuredClone(s.photos[0]),id:'two',name:'two.png',sourceRevision:'two:source-0'});const bytes=await Codec.encode(s),h=harness({bridge:{openProject:async()=>({canceled:false,bytes})}}),old=h.activate();let count=0;const decode=h.pipeline.decodeImage;h.pipeline.decodeImage=async(...args)=>{if(++count===2)throw new Error('second source broken');return decode(...args);};await h.api.openProject();assert.equal(h.api.photos[0],old);assert.equal(h.calls.urls.length,1);assert.deepEqual(h.calls.revoked,h.calls.urls);
});
test('project UI: selected/current changes, import and removal each dirty a saved project',async()=>{
  const h=harness(),p=h.activate();h.photo('second');await h.api.saveProject();h.get('selectAll').checked=false;h.fire('selectAll','change');assert.equal(h.api.hasUnsavedProjectChanges(),true);await flush();await h.api.saveProject();await flush();await h.api.activatePhoto('second');assert.equal(h.api.hasUnsavedProjectChanges(),true);await flush();await h.api.saveProject();await flush();await h.api.importFiles([{name:'third.png',bytes:sourceBytes}]);assert.equal(h.api.hasUnsavedProjectChanges(),true);await flush();await h.api.saveProject();await flush();h.api.photos.forEach(p=>p.selected=true);h.api.removeSelected();assert.equal(h.api.hasUnsavedProjectChanges(),true);await h.api.saveProject();assert.equal(h.api.hasUnsavedProjectChanges(),false);assert.equal((await Codec.decode(h.calls.saved.at(-1).bytes)).photos.length,0);
});
test('project UI: empty project can restore an empty saved workspace',async()=>{
  const bytes=await Codec.encode({version:1,currentId:null,photos:[]}),h=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'empty.mintproj'})}});h.activate();await h.api.openProject();assert.equal(h.api.photos.length,0);assert.equal(h.api.get().currentId,null);assert.equal(h.api.get().source,null);assert.equal(h.api.hasUnsavedProjectChanges(),false);
});
test('project UI: desktop menu and keyboard distinguish project open from photo import',async()=>{
  const h=harness();h.activate();h.events.get('menu')('save-project');await settle(h);assert.equal(h.calls.saved.length,1);await flush();h.events.get('keydown')({key:'o',ctrlKey:true,shiftKey:true,target:h.get('viewport'),preventDefault(){}});await flush();assert.equal(h.calls.opens,1);await flush();h.events.get('keydown')({key:'s',ctrlKey:true,target:h.get('viewport'),preventDefault(){}});await settle(h);assert.equal(h.calls.saved.length,2);
});
test('project UI: HTML loads codec and distinguishes project preservation from explicit output sizing',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');assert.match(html,/id="openProjectBtn"/);assert.match(html,/id="saveProjectBtn"/);assert.match(html,/project-document\.cjs/);assert.match(html,/导出照片不等于保存项目/);assert.match(html,/原尺寸导出有独立的像素与效果上限/);assert.match(html,/id="exportMode"/);assert.match(html,/id="retryExport"/);assert.ok(html.indexOf('project-document.cjs')<html.indexOf('src="app.js"'));
});
test('project UI: immutable learned alpha, corrections and histories survive missing-model restoration',async()=>{
  const s=snapshot('learned'),p=s.photos[0],id='cached-alpha';
  const base={...structuredClone(defaults),bgMode:'color',learnedMatteId:id,learnedMatteStrokes:[]};
  const stroke={mode:'remove',points:[{x:50,y:40}],radiusPx:4,hardness:1,opacity:1};
  p.settings={...structuredClone(base),learnedMatteStrokes:[stroke]};p.committed=structuredClone(p.settings);p.undo=[structuredClone(defaults),structuredClone(base)];p.redo=[{...structuredClone(base),exposure:5}];p.latestMatteId=id;p.lastSelectedMatteId=id;
  p.learnedCache=[{id,kind:'matting',photoId:p.id,sourceRevision:p.sourceRevision,originalSize:{width:100,height:80},bytes:32000,result:{matte:{width:100,height:80,roi:{x:0,y:0,width:100,height:80},space:'roi-original-pixels',encoding:'unit-float32',data:new Float32Array(8000).fill(.75)},provenance:{kind:'model',task:'matting',modelId:'fixture-only',modelVersion:'v1',weightsSha256:'a'.repeat(64),device:{kind:'cpu'}}}}];
  const bytes=await Codec.encode(s),h=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'learned.mintproj'})}});h.api.set({modelState:'error'});await h.api.openProject();await flush();const restored=h.api.photos[0];
  assert.equal(h.calls.model,0);assert.equal(restored.learnedCache.size,1);assert.equal(restored.settings.learnedMatteStrokes.length,1);assert.equal(restored.redo.length,1);assert.equal(restored.learnedCache.get(id).result.matte.data[4050],.75);assert.equal(h.api.factsForPhoto(restored,null,h.canvas(100,80)).mask.data[4050],0);
  h.api.undo();assert.equal(restored.settings.learnedMatteStrokes.length,0);assert.equal(h.api.factsForPhoto(restored,null,h.canvas(100,80)).mask.data[4050],.75);h.api.redo();assert.equal(restored.settings.learnedMatteStrokes.length,1);await flush();await h.api.saveProject();assert.equal(h.calls.saved.length,1);const resaved=await Codec.decode(h.calls.saved[0].bytes);assert.equal(resaved.photos[0].learnedCache[0].result.matte.data[4050],.75);assert.equal(resaved.photos[0].settings.learnedMatteStrokes.length,1);
});
test('project UI: oversized source is embedded unchanged without asserting full-resolution processing',async()=>{
  const s=snapshot('wide');s.photos[0].source={bytes:png(5000,2),mime:'image/png',width:5000,height:2};const bytes=await Codec.encode(s),h=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'wide.mintproj'})}});await h.api.openProject();await flush();assert.equal(h.api.photos[0].originalWidth,5000);assert.match(h.get('reductionNotice').textContent,/4096/);await h.api.saveProject();const saved=await Codec.decode(h.calls.saved[0].bytes);assert.deepEqual(saved.photos[0].source.bytes,s.photos[0].source.bytes);assert.equal(saved.photos[0].source.width,5000);
});
test('project UI: a DOM failure during installation rolls back photos, history, preview and saved baseline',async()=>{
  const bytes=await Codec.encode(snapshot()),h=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'new.mintproj'})}}),old=h.activate(h.photo('old',{exposure:11}));await h.api.saveProject();await flush();const prior=h.api.projectFingerprint(),oldSource=h.api.get().source,oldBaseline=h.api.get().savedProjectFingerprint;const title=h.get('activeFileName');let value=title.textContent,failed=false;
  Object.defineProperty(title,'textContent',{get(){return value;},set(next){if(next==='restored.png'&&!failed){failed=true;throw new Error('authored DOM failure');}value=next;},configurable:true});
  await h.api.openProject();assert.equal(failed,true);assert.equal(h.api.photos[0],old);assert.equal(h.api.get().source,oldSource);assert.equal(h.api.projectFingerprint(),prior);assert.equal(h.api.get().savedProjectFingerprint,oldBaseline);assert.equal(h.api.hasUnsavedProjectChanges(),false);assert.ok(!h.calls.revoked.includes(old.thumb));for(const url of h.calls.urls)assert.ok(h.calls.revoked.includes(url));assert.match(h.get('toast').textContent,/原有会话未替换/);
});
