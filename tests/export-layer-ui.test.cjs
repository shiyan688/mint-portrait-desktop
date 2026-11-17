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
    getContext(){return {clearRect(){},drawImage(){},save(){},restore(){},beginPath(){},rect(){},clip(){},stroke(){},fill(){},arc(){},ellipse(){},lineTo(){},moveTo(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){}};}
  }
  calls.thumbnailCount=0;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});
  get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';get('matteRadius').value='4';get('matteHardness').value='100';get('matteOpacity').value='100';
  const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),
    decodeImage:async(blob,max)=>{calls.decoded.push({blob,max});const d=Codec.inspectImage(new Uint8Array(await blob.arrayBuffer()),blob.type);return {canvas:canvas(Math.min(d.width,max),Math.min(d.height,max)),originalWidth:d.width,originalHeight:d.height};},
    analyze:async()=>{calls.model++;return {faceCount:0,landmarks:[],mask:null};},render:async c=>c,encode:async()=>new Uint8Array(sourceBytes),...overrides.pipeline};
  const bridge={saveProject:async payload=>{calls.saved.push(payload);return {canceled:false,displayName:'saved.mintproj'};},openProject:async()=>{calls.opens++;return {canceled:true};},confirmReplaceProject:async()=>{calls.confirm++;return true;},setSessionDirty:v=>calls.dirty.push(v),onMenuAction:fn=>events.set('menu',fn),chooseExportFolder:async()=>({token:'test',displayPath:'test folder'}),writeExport:async payload=>calls.writes.push(payload),...overrides.bridge};
  const codec={VERSION:Codec.VERSION,encode:async value=>{calls.encoded.push(structuredClone(value));return Codec.encode(structuredClone(value));},decode:bytes=>Codec.decode(bytes),...overrides.codec};
  const context=vm.createContext({Pipeline:pipeline,window:{desktop:bridge,MintExportQueue:require('../src/export-queue.cjs'),PortraitEngine:require('../src/portrait-engine.cjs'),MintProjectDocument:codec,MintLearnedAnalysis:Learned,addEventListener:(n,fn)=>events.set(n,fn)},document:{getElementById:get,querySelectorAll:s=>s==='.photo-card'?get('filmstrip').children.filter(e=>e.className==='photo-card'):[],querySelector:s=>get('filmstrip').children.find(e=>s===`[data-photo-id="${e.dataset.photoId}"]`)||null,createElement:t=>new Element(t),body:new Element('body')},console,structuredClone,AbortController,Blob,Uint8Array,Float32Array,Uint8ClampedArray,ArrayBuffer,HTMLElement:Element,crypto:{randomUUID:()=>`photo-${++sequence}`},URL:{createObjectURL:()=>{const u=`blob:thumb-${++sequence}`;calls.urls.push(u);return u;},revokeObjectURL:u=>calls.revoked.push(u)},ResizeObserver:class{observe(){}},setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){},setInterval:()=>++timer,clearInterval(){}});
  let app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  app+='\nglobalThis.audit={photos,saveProject,openProject,projectSnapshot,startExport,cancelExport,openExport,exportLimit,addLocalLayer,removeLocalLayer,moveLocalLayer,changeLocalLayer,selectedLocalLayer,updateLocalControls,drawPreview,hasUnsavedProjectChanges,projectFingerprint,changeSettings,undo,redo,activatePhoto,importFiles,removeSelected,startExport,updateAvailability,factsForPhoto,appendPhotoCard,set:(v)=>{if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("modelState"in v)modelState=v.modelState;if("backendJob"in v)backendJob=v.backendJob;if("loadingPhoto"in v)loadingPhoto=v.loadingPhoto;if("analyzingPhoto"in v)analyzingPhoto=v.analyzingPhoto;if("renderingPhoto"in v)renderingPhoto=v.renderingPhoto;if("importing"in v)importing=v.importing;if("exportRunning"in v)exportRunning=v.exportRunning;if("matteDraft"in v)matteDraft=v.matteDraft;},get:()=>({exportQueue,exportFolder,exportRunning,projectOperation,projectDisplayName,currentId,source,analysis,matteDraft,loadingPhoto,savedProjectFingerprint})};';
  vm.runInContext(app,context);const api=context.audit;
  function photo(id='old',settings={}){const p={id,name:`${id}.png`,blob:new Blob([sourceBytes],{type:'image/png'}),thumb:`blob:old-${id}`,sourceRevision:`${id}:source-0`,originalWidth:100,originalHeight:80,selected:true,settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,preset:null,learnedCache:new Map()};api.photos.push(p);api.appendPhotoCard(p);return p;}
  function activate(p=photo()){api.set({currentId:p.id,source:canvas(100,80),analysis:null});api.updateAvailability();return p;}
  const fire=(id,name='click',extra={})=>get(id).listeners.get(name)?.({target:get(id),preventDefault(){},stopPropagation(){},...extra});
  return {api,photo,activate,calls,bridge,pipeline,codec,events,get,fire,canvas};
}

// These tests execute shipped UI plus real queue/codec with DOM/IPC doubles.
// They do not assert visual layout, real model output or native Windows behavior.
const nativeResult=(width=100,height=80)=>({bytes:new Uint8Array(sourceBytes),width,height,processingWidth:width,processingHeight:height,originalWidth:width,originalHeight:height,scaled:false,framed:false});
test('export UI: original is default and native renderer receives immutable originals and selected settings',async()=>{
  const seen=[],h=harness({bridge:{renderExport:async r=>{seen.push(r);return nativeResult();}}}),p=h.activate(h.photo('one',{exposure:12}));
  await h.api.startExport({preventDefault(){}});
  assert.equal(seen.length,1);assert.equal(seen[0].mode,'original');assert.deepEqual(seen[0].bytes,sourceBytes);assert.equal(seen[0].settings.exposure,12);assert.equal(seen[0].sourceRevision,p.sourceRevision);assert.equal(seen[0].analysis.sourceRevision,p.sourceRevision);assert.deepEqual({...seen[0].analysis.originalSize},{width:100,height:80});assert.equal(h.calls.decoded.length,0);assert.equal(h.calls.writes.length,1);assert.equal(h.api.get().exportQueue.items[0].state,'saved');
});
test('export UI: failure retry keeps the old snapshot and never repeats saved items',async()=>{
  const seen=[],h=harness({bridge:{renderExport:async r=>{seen.push([r.sourceRevision,r.settings.exposure]);if(r.sourceRevision.startsWith('two')&&seen.length===2)throw new Error('disk allocation');return nativeResult();}}}),p=h.activate(h.photo('one',{exposure:12})),other=h.photo('two',{exposure:7});
  await h.api.startExport({preventDefault(){}});assert.deepEqual(Array.from(h.api.get().exportQueue.items,x=>x.state),['saved','failed']);
  other.settings.exposure=90;p.settings.exposure=80;await h.api.startExport({preventDefault(){}},true);
  assert.deepEqual(seen,[['one:source-0',12],['two:source-0',7],['two:source-0',7]]);assert.equal(h.calls.writes.length,2);assert.equal(h.api.get().exportQueue.summary().success,2);
});
test('export UI: cancellation while native rendering is pending calls cancellation and never writes',async()=>{
  const pending=defer(),entered=defer(),cancel=[],h=harness({bridge:{renderExport:async r=>{entered.resolve(r);return pending.promise;},cancelExportRender:async id=>cancel.push(id)}});h.activate();h.photo('two');
  const run=h.api.startExport({preventDefault(){}}),r=await entered.promise;h.api.cancelExport();pending.resolve(nativeResult());await run;
  assert.deepEqual(cancel,[r.requestId]);assert.equal(h.calls.writes.length,0);assert.deepEqual(Array.from(h.api.get().exportQueue.items,x=>x.state),['cancelled','cancelled']);assert.equal(h.api.get().exportRunning,false);
});
test('export UI: stop during native save waits and counts the actual commit once',async()=>{
  const entered=defer(),write=defer(),seen=[],h=harness({bridge:{renderExport:async()=>nativeResult(),writeExport:async payload=>{seen.push(payload.name);if(seen.length===1){entered.resolve();await write.promise;}return {filename:payload.name};}}});h.activate();h.photo('two');
  const run=h.api.startExport({preventDefault(){}});await entered.promise;h.api.cancelExport();assert.equal(h.api.get().exportRunning,true);write.resolve();await run;
  assert.equal(h.api.get().exportQueue.summary().saved,1);assert.match(h.get('globalStatus').textContent,/已导出 1 张/);await h.api.startExport({preventDefault(){}},true);assert.deepEqual(seen,['old_薄荷_01.png','two_薄荷_02.png']);
});
test('export UI: original cap rejects active portrait effects on >16MP without submitting native render',async()=>{
  let calls=0;const h=harness({bridge:{renderExport:async()=>{calls++;return nativeResult();}}}),p=h.activate(h.photo('large',{smooth:1}));p.originalWidth=6000;p.originalHeight=4000;
  await h.api.startExport({preventDefault(){}});assert.equal(calls,0);assert.equal(h.calls.writes.length,0);assert.match(h.api.get().exportQueue.items[0].error,/1600万/);assert.equal(p.originalWidth,6000);
});
test('export UI: oversized original fails explicitly while working size requires deliberate selection',async()=>{
  let calls=0;const h=harness({bridge:{renderExport:async()=>{calls++;return {bytes:sourceBytes,width:4096,height:2048,processingWidth:4096,processingHeight:2048,originalWidth:8000,originalHeight:4000,scaled:true,framed:false};}}}),p=h.activate(h.photo('large',{smooth:12}));p.originalWidth=8000;p.originalHeight=4000;
  await h.api.startExport({preventDefault(){}});assert.equal(calls,0);assert.match(h.api.get().exportQueue.items[0].error,/裁剪前处理上限1600万/);
  p.settings.smooth=0;
  h.get('exportMode').value='working';h.api.openExport();assert.match(h.get('exportPlan').textContent,/8000 × 4000 → 4096 × 2048/);assert.match(h.get('exportModeNote').textContent,/选择等比缩小/);await h.api.startExport({preventDefault(){}});assert.equal(calls,1);assert.equal(h.calls.writes.length,1);assert.equal(h.api.get().exportQueue.items[0].output.scaled,true);
});
test('export UI: a silently reduced native or browser original is rejected before any write',async()=>{
  for(const native of [true,false]){const h=harness(native?{bridge:{renderExport:async()=>({...nativeResult(),width:50,scaled:true})}}:{pipeline:{decodeExportImage:async()=>({canvas:{width:50,height:40},originalWidth:100,originalHeight:80,scaled:true})}});h.activate();await h.api.startExport({preventDefault(){}});assert.equal(h.calls.writes.length,0);assert.equal(h.api.get().exportQueue.items[0].state,'failed');assert.match(h.api.get().exportQueue.items[0].error,/尺寸/);}
});
test('export UI: unavailable requested face or mask effects fail instead of silently exporting less',async()=>{
  for(const settings of [{underEye:20},{bgMode:'blur'}]){const h=harness({bridge:{renderExport:async()=>nativeResult()}});h.activate(h.photo('one',settings));await h.api.startExport({preventDefault(){}});assert.equal(h.calls.writes.length,0);assert.match(h.api.get().exportQueue.items[0].error,/未就绪/);}
});
test('layer UI: create, edit, order, toggle and remove are undoable source-bound operations',()=>{
  const h=harness(),p=h.activate();h.api.addLocalLayer('radial');const radial=p.settings.localLayers[0];assert.equal(radial.sourceRevision,p.sourceRevision);assert.equal(radial.mask.kind,'radial');assert.equal(p.localInspect,true);
  h.api.changeLocalLayer({adjustments:{exposure:20,contrast:0,saturation:0,temperature:0}});h.api.undo();assert.equal(p.settings.localLayers[0].adjustments.exposure,0);h.api.redo();assert.equal(p.settings.localLayers[0].adjustments.exposure,20);
  h.api.addLocalLayer('linear');const linear=p.settings.localLayers[1];h.api.moveLocalLayer(-1);assert.equal(p.settings.localLayers[0].id,linear.id);h.api.changeLocalLayer({enabled:false,opacity:.4});assert.equal(p.settings.localLayers[0].enabled,false);assert.equal(p.settings.localLayers[0].opacity,.4);h.api.removeLocalLayer();assert.equal(p.settings.localLayers.length,1);h.api.undo();assert.equal(p.settings.localLayers.length,2);
});
test('layer UI: cap, invalid coordinates and degenerate gradients cannot corrupt settings',()=>{
  const h=harness(),p=h.activate();for(let i=0;i<9;i++)h.api.addLocalLayer('radial');assert.equal(p.settings.localLayers.length,8);
  h.get('localRx').value='0';h.fire('localRx','change');assert.equal(h.api.selectedLocalLayer().mask.rx,.25);h.get('localKind').value='linear';h.fire('localKind','change');
  h.get('localX1').value='25';h.fire('localX1','change');assert.equal(h.api.selectedLocalLayer().mask.x1,.75);
});
test('layer UI: facts carry immutable source context without learned matte; sync preserves destination layers',()=>{
  const h=harness(),p=h.activate();h.api.addLocalLayer();const srcId=p.settings.localLayers[0].id,other=h.photo('two');const own={...structuredClone(p.settings.localLayers[0]),id:'own-layer',sourceRevision:other.sourceRevision};other.settings.localLayers=[own];h.photo('three');h.get('syncScope').value='all';h.fire('applySync');
  assert.equal(other.settings.localLayers[0].id,'own-layer');assert.notEqual(other.settings.localLayers[0].id,srcId);assert.deepEqual(h.api.photos[2].settings.localLayers,[]);
  const facts=h.api.factsForPhoto(p,null,h.canvas(25,20));assert.equal(facts.sourceRevision,p.sourceRevision);assert.deepEqual({...facts.originalSize},{width:100,height:80});
});
test('layer UI: source-bound layers and history survive v2 project save/open',async()=>{
  const h=harness(),p=h.activate();h.api.addLocalLayer();h.api.changeLocalLayer({opacity:.4,adjustments:{exposure:15,contrast:2,saturation:-1,temperature:3}});await h.api.saveProject();assert.equal(h.calls.saved.length,1);const bytes=h.calls.saved[0].bytes,saved=await Codec.decode(bytes);assert.equal(saved.version,Codec.VERSION);assert.equal(saved.photos[0].settings.localLayers.length,1);assert.equal(saved.photos[0].settings.localLayers[0].opacity,.4);
  const restored=harness({bridge:{openProject:async()=>({bytes,displayName:'local.mintproj'})}});await restored.api.openProject();assert.equal(restored.api.photos[0].settings.localLayers[0].sourceRevision,p.sourceRevision);assert.equal(restored.api.photos[0].undo.length,p.undo.length);assert.equal(restored.api.hasUnsavedProjectChanges(),false);
});
test('layer UI: outline is labeled original-space and excluded from exported image rendering',async()=>{
  const seen=[],h=harness({bridge:{renderExport:async r=>{seen.push(r);return nativeResult();}}}),p=h.activate();h.api.addLocalLayer();h.api.drawPreview();assert.match(h.get('diagnosticBadge').textContent,/完整原图坐标/);assert.match(h.get('diagnosticBadge').textContent,/边界不导出/);await h.api.startExport({preventDefault(){}});assert.equal(seen[0].settings.localLayers[0].sourceRevision,p.sourceRevision);assert.equal(seen[0].settings.localInspect,undefined);
});
test('export UI: successful write durability warning is visible, counted saved and never retried',async()=>{
  let writes=0;const h=harness({bridge:{renderExport:async()=>nativeResult(),writeExport:async()=>{writes++;return {filename:'kept.png',durabilityWarning:'directory fsync failed'};}}});h.activate();await h.api.startExport({preventDefault(){}});assert.equal(h.api.get().exportQueue.summary().saved,1);assert.equal(h.api.get().exportQueue.summary().retryable,0);assert.match(h.get('globalStatus').textContent,/已导出 1 张/);assert.match(h.get('globalStatus').textContent,/持久化\/清理警告/);assert.match(h.get('exportQueueList').children.at(-1).children.at(-1).textContent,/directory fsync failed/);await h.api.startExport({preventDefault(){}},true);assert.equal(writes,1);
});
test('export UI: shipped app, real native worker and atomic filesystem write agree on original dimensions',async()=>{
  const sharp=require('sharp'),os=require('node:os'),fsp=require('node:fs/promises'),{createExportRenderer}=require('../export-renderer.cjs'),{writeUniqueImage}=require('../desktop-core.cjs');
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'mint-ui-native-')),renderer=createExportRenderer();
  try{
    const h=harness({bridge:{renderExport:r=>renderer.render(structuredClone(r)),cancelExportRender:id=>renderer.cancel(id),writeExport:({name,bytes})=>writeUniqueImage(dir,name,bytes)}}),p=h.activate();
    p.blob=new Blob([await sharp({create:{width:5000,height:8,channels:4,background:{r:90,g:120,b:160,alpha:1}}}).png().toBuffer()],{type:'image/png'});p.originalWidth=5000;p.originalHeight=8;
    h.api.addLocalLayer();h.api.changeLocalLayer({adjustments:{exposure:25,contrast:0,saturation:0,temperature:0}});const before=new Uint8Array(await p.blob.arrayBuffer());await h.api.startExport({preventDefault(){}});
    const item=h.api.get().exportQueue.items[0];assert.equal(item.state,'saved',item.error);assert.equal(item.output.width,5000);const bytes=await fsp.readFile(path.join(dir,item.receipt.filename)),meta=await sharp(bytes).metadata();assert.equal(meta.width,5000);assert.equal(meta.height,8);assert.equal(meta.hasProfile,true);assert.equal(meta.exif,undefined);assert.deepEqual(new Uint8Array(await p.blob.arrayBuffer()),before);
    const center=await sharp(bytes).extract({left:2500,top:4,width:1,height:1}).raw().toBuffer(),outside=await sharp(bytes).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.ok(center[0]>90);assert.deepEqual([...outside],[90,120,160,255]);
  }finally{renderer.dispose();await fsp.rm(dir,{recursive:true,force:true});}
});
test('face color UI: controls are gated by real core capability and detected faces, remain zero by default',()=>{
  const h=harness(),p=h.activate();for(const key of ['underEye','redness','lip','blush']){assert.equal(p.settings[key],0);assert.equal(h.get(`control-${key}`).disabled,true);}assert.equal(h.get('facePalette').disabled,true);
  h.api.set({analysis:{faceCount:1,landmarks:[Array.from({length:478},()=>({x:.5,y:.5}))],mask:null}});h.api.updateAvailability();for(const key of ['underEye','redness','lip','blush'])assert.equal(h.get(`control-${key}`).disabled,false);assert.equal(h.get('facePalette').disabled,false);assert.match(h.get('faceColorStatus').textContent,/不是学习型精修/);assert.equal(p.settings.slim,0);assert.equal(p.settings.brighten,0);
});
test('face color UI: numeric edits and palette selection commit, undo and roundtrip without changing geometry',async()=>{
  const h=harness(),p=h.activate();h.api.set({analysis:{faceCount:1,landmarks:[Array.from({length:478},()=>({x:.5,y:.5}))],mask:null}});h.api.updateAvailability();
  for(const [key,value]of [['underEye','12'],['redness','18'],['lip','20'],['blush','10'],['palette','peach']]){const target={dataset:{setting:key},value};h.fire('parameters','input',{target});h.fire('parameters','change',{target});}
  assert.equal(p.settings.palette,'peach');assert.equal(p.settings.underEye,12);assert.equal(p.settings.redness,18);assert.equal(p.settings.lip,20);assert.equal(p.settings.blush,10);assert.equal(p.settings.slim,0);assert.equal(p.settings.brighten,0);
  h.api.undo();assert.equal(p.settings.palette,'natural');h.api.redo();assert.equal(p.settings.palette,'peach');await h.api.saveProject();const saved=await Codec.decode(h.calls.saved[0].bytes);assert.equal(saved.photos[0].settings.palette,'peach');assert.equal(saved.photos[0].settings.underEye,12);
});
test('face color UI: experimental classical scope and no default ethnicity/whitening claims remain visible',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');assert.match(html,/局部色彩修饰/);assert.match(html,/实验/);assert.match(html,/不自动判断族裔，不默认瘦脸或统一美白/);assert.match(html,/不代表专业精修或 SOTA 质量/);assert.match(html,/8位 sRGB/);
});
