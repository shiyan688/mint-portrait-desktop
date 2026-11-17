'use strict';
// Executes the actual app module and original-coordinate helper with authored
// DOM/canvas/pipeline/IPC doubles. No browser, model inference or disk export.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const A = require('../src/learned-analysis.cjs');
const { classes: CLASSES } = require('../backend/adapters/segface/manifest.json');
const { makeConservativeSkinMasks } = require('../backend/adapters/segface/mask.cjs');
const POLICY = (()=>{const data=new Float32Array(CLASSES.length*4);data.fill(1,2*4,3*4);return makeConservativeSkinMasks({kind:'parsing',width:2,height:2,classes:CLASSES,data,layout:'planar',encoding:'unit-float32',space:'roi-original-pixels'}).policy;})();
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
const defaults = {exposure:0,contrast:0,saturation:0,temperature:0,smooth:0,brighten:0,warmth:0,slim:0,eyes:0,nose:0,jaw:0,bgMode:'original',bgBlur:18,bgColor:'#e9eee9',bgFeather:2,spots:[]};
const mesh = (left=.4, top=.3, width=.2, height=.3) => Array.from({length:478},(_,i)=>({x:left+(i%2)*width,y:top+(i%3)*height/2}));
function selection(kind) { return {device:'cpu',ready:true,kind:'model',modelId:`fixture-${kind}`,modelVersion:'pinned-v1',weightsSha256:'a'.repeat(64)}; }
function response(request, task) {
  const {width,height}=request.roi, data=new Float32Array(width*height).fill(.75);
  const provenance={kind:'model',task,modelId:request.modelId,modelVersion:request.modelVersion,weightsSha256:'a'.repeat(64),device:{kind:request.device},selection:request.selection,
    classVocabulary:[...CLASSES],maskClasses:{skin:['skin','nose'],protected:CLASSES.filter(x=>!['skin','nose'].includes(x))},maskPolicy:structuredClone(POLICY)};
  return task==='parse' ? {kind:'face-masks',width,height,roi:{...request.roi},skin:data,protected:new Float32Array(width*height).fill(.25),provenance}
    : {kind:'matting',matte:{width,height,roi:{...request.roi},data,space:'roi-original-pixels',encoding:'unit-float32'},provenance};
}
function harness(overrides={}) {
  const elements=new Map(), events=new Map(), calls={draw:[],put:[],crop:[],parse:[],matte:[],cancel:[],render:[],encode:[],write:[],original:[],decode:[],dirty:[]};
  let sequence=0,timer=0;
  class Element {
    constructor(id) { this.id=id; this.dataset={}; this.style={setProperty(){}}; this.classList={toggle(){},add(){},remove(){}}; this.value=''; this.min='0'; this.max='100'; this.open=false; this.width=2; this.height=2; this.clientWidth=1000; this.clientHeight=700; this.listeners=new Map(); this.children=[]; this.checked=false; }
    addEventListener(name,fn){this.listeners.set(name,fn);} setAttribute(){} insertAdjacentHTML(){} append(...items){this.children.push(...items);} replaceChildren(...items){this.children=items;} remove(){} click(){return this.listeners.get('click')?.({target:this});} focus(){} setPointerCapture(){} releasePointerCapture(){} matches(){return false;} closest(selector){return selector==='#compareDivider'?null:this;}
    querySelector(){return new Element('child');} showModal(){this.open=true;} close(){this.open=false;}
    getBoundingClientRect(){return this.rect || {left:0,top:0,width:1000,height:700,right:1000,bottom:700};}
    getContext(){const owner=this;return {clearRect(){},drawImage(...args){calls.draw.push({owner:owner.id,args});},save(){},restore(){},beginPath(){},rect(){},clip(){},strokeRect(){},fillText(){},arc(){},stroke(){},fill(){},moveTo(){},lineTo(){},
      createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},putImageData(image,x,y){calls.put.push({owner:owner.id,image,x,y});},
      getImageData(x,y,w,h){calls.crop.push({owner:owner.id,x,y,width:w,height:h});const data=new Uint8ClampedArray(w*h*4);for(let p=0;p<w*h;p++){data[p*4]=(x+p%w)%256;data[p*4+1]=(y+Math.floor(p/w))%256;data[p*4+3]=255;}return {width:w,height:h,data};}};}
  }
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const canvas=(width,height,id='original')=>Object.assign(new Element(id),{width,height});
  get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';get('syncScope').value='all';
  get('matteRadius').value='4';get('matteHardness').value='100';get('matteOpacity').value='100';
  const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),
    decodeOriginalImage:async(blob,options)=>{calls.original.push({blob,options});return {canvas:canvas(100,80),originalWidth:100,originalHeight:80,scaled:false};},
    decodeImage:async(blob,max)=>{calls.decode.push({blob,max});return {canvas:canvas(25,20,'preview'),originalWidth:100,originalHeight:80};},
    analyze:async()=>({faceCount:0,landmarks:[],mask:null}),
    render:async(input,settings,facts,options)=>{calls.render.push({input,settings,facts,options});return input;},
    encode:async(input,...args)=>{calls.encode.push({input,args});return new Uint8Array([137,80,78,71,13,10,26,10]);},...overrides.pipeline};
  const bridge={parseFaceMasks:async request=>{calls.parse.push(request);return response(request,'parse');},matteImage:async request=>{calls.matte.push(request);return response(request,'matting');},
    cancelBackend:async id=>{calls.cancel.push(id);},chooseExportFolder:async()=>({token:'test',displayPath:'/test-only'}),writeExport:async payload=>{calls.write.push(payload);},setSessionDirty:v=>calls.dirty.push(v),onMenuAction:fn=>events.set('menu',fn),...overrides.bridge};
  const panel={getSelection:kind=>overrides.selections?.[kind] || selection(kind)};
  const context=vm.createContext({Pipeline:pipeline,window:{desktop:bridge,MintExportQueue:require('../src/export-queue.cjs'),MintLearnedAnalysis:A,MintBackendPanel:{mount:()=>panel},addEventListener:(name,fn)=>events.set(name,fn)},
    document:{getElementById:get,querySelectorAll:()=>[],querySelector:()=>null,createElement:tag=>new Element(`created-${tag}-${++sequence}`),body:new Element('body')},console,structuredClone,AbortController,URL,Blob,Uint8Array,Uint8ClampedArray,Float32Array,ArrayBuffer,HTMLElement:Element,crypto:{randomUUID:()=>`test-job-${++sequence}`},ResizeObserver:class{observe(){}},
    setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){},setInterval:()=>++timer,clearInterval(){}});
  let code=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  code+='\nglobalThis.learnedAudit={photos,runLearnedTask,cancelBackendJob,cachedResult,factsForPhoto,drawPreview,drawLearnedDiagnostics,activatePhoto,removeSelected,historyCommit,changeSettings,undo,redo,startExport,cancelExport,updateBackendControls,setTool,learnedCacheBytes,sourceRevisionOf,beginMatteStroke,appendMatteStroke,finishMatteStroke,originalPoint,correctedOriginalMatte,set:(v)=>{if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("rendered"in v)rendered=v.rendered;if("modelState"in v)modelState=v.modelState;if("originalHeld"in v)originalHeld=v.originalHeld;if("compare"in v)compare=v.compare;},get:()=>({backendJob,source,currentId,analysis,rendered,viewToken,activeDiagnosticOverlay,activeMattePreview,activeCorrectedMatte,matteDraft,exportRunning,tool})};';
  vm.runInContext(code,context);
  function photo(id='one',settings={}) {const p={id,name:`${id}.png`,blob:new Blob(['synthetic']),thumb:'blob:test',settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,selected:true,sourceRevision:`${id}:source-0`,originalWidth:100,originalHeight:80,learnedCache:new Map(),faceChoice:0};context.learnedAudit.photos.push(p);return p;}
  function activate(p=photo(),faces=[mesh()]) {context.learnedAudit.set({currentId:p.id,source:canvas(25,20,'preview'),analysis:{faceCount:faces.length,landmarks:faces,mask:null}});return p;}
  const fire=(id,event='click',values={})=>get(id).listeners.get(event)?.({type:event,target:get(id),preventDefault(){},stopPropagation(){},...values});
  return {api:context.learnedAudit,photo,activate,canvas,get,elements,events,calls,pipeline,bridge,fire};
}

test('learned UI: parses the explicitly selected face from original pixels, not the preview',async()=>{
  const h=harness(),p=h.activate(h.photo(),[mesh(.1,.1),mesh(.6,.4,.1,.2)]);p.faceChoice=1;
  await h.api.runLearnedTask('parse');assert.equal(h.calls.parse.length,1);
  const req=h.calls.parse[0],expected=A.faceROI(mesh(.6,.4,.1,.2),{width:100,height:80});
  assert.deepEqual(JSON.parse(JSON.stringify(req.roi)),expected);assert.deepEqual({...req.originalSize},{width:100,height:80});
  assert.equal(req.selection.faceId,'one:face-1');assert.equal(req.selection.revision,p.sourceRevision);
  assert.equal(h.calls.crop[0].owner,'original');assert.equal(req.source.data[0],expected.x);assert.equal(req.source.data[1],expected.y);
  assert.equal(p.learnedCache.size,1);assert.ok(p.settings.diagnosticParseId);assert.equal(p.settings.diagnosticOverlay,true);assert.equal(p.settings.learnedMatteId,undefined);
});
test('learned UI: absent explicit face or unavailable model never runs inference',async()=>{
  const h=harness(),p=h.activate();p.faceChoice=null;await h.api.runLearnedTask('parse');assert.equal(h.calls.parse.length,0);assert.match(p.learnedError,/选择/);
  const no=harness({selections:{parse:{...selection('parse'),ready:false}}});no.activate();await no.api.runLearnedTask('parse');assert.equal(no.calls.original.length,0);assert.equal(no.calls.parse.length,0);
});
test('learned UI: matting sends full original geometry and preserves continuous alpha',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const req=h.calls.matte[0];assert.deepEqual({...req.roi},{x:0,y:0,width:100,height:80});
  const cached=h.api.cachedResult(p,p.settings.learnedMatteId,'matting');assert.equal(cached.result.matte.data[0],.75);assert.equal(cached.result.matte.data.length,8000);assert.equal(h.api.learnedCacheBytes(),32000);
});
test('learned UI: cancellation while original decoding is pending prevents even submitting IPC',async()=>{
  const d=defer(),h=harness({pipeline:{decodeOriginalImage:()=>d.promise}}),p=h.activate();const job=h.api.runLearnedTask('parse');h.api.cancelBackendJob();
  d.resolve({canvas:h.canvas(100,80),originalWidth:100,originalHeight:80});await job;assert.equal(h.calls.parse.length,0);assert.equal(h.calls.cancel.length,0);assert.equal(p.learnedCache.size,0);
});
test('learned UI: repeated run is single-flight and cancelled late results cannot commit',async()=>{
  const d=defer(),entered=defer();let request;const h=harness({bridge:{parseFaceMasks:r=>{request=r;entered.resolve();return d.promise;}}}),p=h.activate();
  const first=h.api.runLearnedTask('parse');await entered.promise;await h.api.runLearnedTask('parse');const id=h.api.get().backendJob.id;h.api.cancelBackendJob();
  d.resolve(response(request,'parse'));await first;assert.deepEqual(h.calls.cancel,[id]);assert.equal(p.learnedCache.size,0);assert.equal(p.settings.diagnosticParseId,undefined);assert.equal(h.api.get().backendJob,null);
});
for(const reason of ['switch','remove','source-revision'])test(`learned UI: stale response after ${reason} is discarded`,async()=>{
  const d=defer(),entered=defer();let request;const h=harness({bridge:{parseFaceMasks:r=>{request=r;entered.resolve();return d.promise;}}}),p=h.activate();
  const job=h.api.runLearnedTask('parse');await entered.promise;
  if(reason==='switch'){h.photo('two');await h.api.activatePhoto('two');}else if(reason==='remove')h.api.removeSelected();else p.sourceRevision='one:source-1';
  d.resolve(response(request,'parse'));await job;assert.equal(p.learnedCache.size,0);assert.equal(p.settings.diagnosticParseId,undefined);
});
test('learned UI: switching away and back cannot revive a task with an old view token',async()=>{
  const d=defer(),entered=defer();let request;const h=harness({bridge:{parseFaceMasks:r=>{request=r;entered.resolve();return d.promise;}}}),p=h.activate();h.photo('two');
  const job=h.api.runLearnedTask('parse');await entered.promise;await h.api.activatePhoto('two');await h.api.activatePhoto(p.id);d.resolve(response(request,'parse'));await job;assert.equal(p.learnedCache.size,0);
});
test('learned UI: malformed geometry or wrong model digest leaves old settings and cache intact',async()=>{
  for(const defect of ['roi','hash']){const h=harness({bridge:{parseFaceMasks:async req=>{const r=response(req,'parse');if(defect==='roi')r.roi.x++;else r.provenance.weightsSha256='b'.repeat(64);return r;}}}),p=h.activate();p.settings.exposure=17;
    await h.api.runLearnedTask('parse');assert.equal(p.learnedCache.size,0);assert.equal(p.settings.exposure,17);assert.match(p.learnedError,/失败/);}
});
test('learned UI: original decoder scaling or dimension mismatch fails closed without inference',async()=>{
  const h=harness(),p=h.activate();h.pipeline.decodeOriginalImage=async()=>({canvas:h.canvas(50,40),originalWidth:100,originalHeight:80,scaled:true});
  await h.api.runLearnedTask('matting');assert.equal(h.calls.matte.length,0);assert.equal(p.learnedCache.size,0);assert.match(p.learnedError,/没有缩小原图/);
});
test('learned UI: diagnostic overlay is registered to the original ROI and shown over the source',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('parse');await flush();h.api.set({rendered:h.canvas(25,20,'retouched')});h.calls.draw.length=0;h.api.drawPreview();
  const previewCalls=h.calls.draw.filter(x=>x.owner==='previewCanvas');assert.equal(previewCalls[0].args[0].id,'preview');
  const entry=h.api.cachedResult(p,p.settings.diagnosticParseId,'parse'),r=entry.result.roi,overlay=previewCalls.at(-1).args;
  overlay.slice(1).forEach((value,i)=>assert.ok(Math.abs(value-[r.x/4,r.y/4,r.width/4,r.height/4][i])<1e-12));
  h.api.set({originalHeld:true});h.calls.draw.length=0;h.api.drawPreview();assert.equal(h.calls.draw.filter(x=>x.owner==='previewCanvas').length,1);
});
test('learned UI: cached matting is bound to photo, source revision and original dimensions',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const id=p.settings.learnedMatteId,entry=p.learnedCache.get(id),other=h.photo('two');other.learnedCache.set(id,entry);
  assert.equal(h.api.cachedResult(other,id,'matting'),null);p.sourceRevision='new';assert.equal(h.api.cachedResult(p,id,'matting'),null);
  assert.throws(()=>h.api.factsForPhoto(p,null,h.canvas(25,20)),/原图版本/);p.sourceRevision=entry.sourceRevision;p.originalWidth++;assert.equal(h.api.cachedResult(p,id,'matting'),null);
});
test('learned UI: preview resamples only a derived mask and export facts use original alpha',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const entry=p.learnedCache.get(p.settings.learnedMatteId),original=entry.result.matte.data;original[0]=.125;
  const small=h.api.factsForPhoto(p,null,h.canvas(25,20));assert.equal(small.mask.data.length,500);assert.notEqual(small.mask.data,original);
  const full=h.api.factsForPhoto(p,null,h.canvas(100,80));assert.equal(full.mask.data,original);assert.equal(full.mask.data[0],.125);assert.equal(full.learnedMatte.sourceRevision,p.sourceRevision);
});
test('learned UI: undo and redo restore immutable cache references without another model call',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const id=p.settings.learnedMatteId;h.api.undo();assert.equal(p.settings.learnedMatteId,undefined);assert.equal(p.learnedCache.size,1);
  h.api.redo();assert.equal(p.settings.learnedMatteId,id);assert.ok(h.api.cachedResult(p,id,'matting'));assert.equal(h.calls.matte.length,1);
});
test('learned UI: parameter sync never copies learned mask IDs or diagnostic settings to another photo',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');await h.api.runLearnedTask('parse');p.settings.exposure=23;
  const own={learnedMatteId:'second-matte',diagnosticParseId:'second-parse',diagnosticOverlay:false,diagnosticLayer:'protected'};const other=h.photo('two',own),empty=h.photo('three');
  h.fire('applySync');assert.equal(other.settings.exposure,23);for(const [k,v]of Object.entries(own))assert.equal(other.settings[k],v);
  for(const k of Object.keys(own))assert.equal(empty.settings[k],undefined);assert.equal(other.learnedCache.size,0);assert.equal(empty.learnedCache.size,0);
});
test('learned UI: reset then undo restores the same per-photo matte cache',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const id=p.settings.learnedMatteId;h.fire('resetBtn');assert.equal(p.settings.learnedMatteId,undefined);h.api.undo();assert.equal(p.settings.learnedMatteId,id);assert.ok(h.api.cachedResult(p,id,'matting'));
});
test('learned UI: export of a learned matte decodes original pixels and passes original alpha to render',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');await flush();p.settings.bgMode='transparent';h.calls.render.length=0;h.calls.decode.length=0;h.calls.original.length=0;
  await h.api.startExport({preventDefault(){}});const job=h.calls.render.find(c=>c.input.id==='original');assert.ok(job);assert.equal(job.facts.mask.width,100);assert.equal(job.facts.mask.height,80);assert.equal(job.facts.mask.data,p.learnedCache.get(p.settings.learnedMatteId).result.matte.data);assert.equal(h.calls.original.length,1);assert.equal(h.calls.decode.length,0);assert.equal(h.calls.write.length,1);
});
test('learned UI: missing or scaled learned matte prevents export instead of falling back',async()=>{
  for(const defect of ['missing','scaled']){const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');await flush();if(defect==='missing')p.learnedCache.clear();else h.pipeline.decodeOriginalImage=async()=>({canvas:h.canvas(50,40),originalWidth:100,originalHeight:80,scaled:true});
    await h.api.startExport({preventDefault(){}});assert.equal(h.calls.write.length,0);assert.match(h.get('exportProgressText').textContent,/1 张失败/);assert.equal(h.api.get().exportRunning,false);}
});
test('learned UI: export never encodes the diagnostic preview canvas',async()=>{
  const h=harness();h.activate();await h.api.runLearnedTask('parse');await flush();await h.api.startExport({preventDefault(){}});assert.equal(h.calls.write.length,1);assert.equal(h.calls.encode.length,1);assert.notEqual(h.calls.encode[0].input,h.get('previewCanvas'));assert.ok(!h.calls.encode[0].input.id.startsWith('created-canvas'));
});
test('learned UI: an old cancelled completion cannot clear or overwrite the replacement job',async()=>{
  const first=defer(),second=defer(),entered1=defer(),entered2=defer(),requests=[];
  const h=harness({bridge:{parseFaceMasks:req=>{requests.push(req);(requests.length===1?entered1:entered2).resolve();return requests.length===1?first.promise:second.promise;}}}),p=h.activate();
  const a=h.api.runLearnedTask('parse');await entered1.promise;h.api.cancelBackendJob();const b=h.api.runLearnedTask('parse');await entered2.promise;const replacement=h.api.get().backendJob;
  first.resolve(response(requests[0],'parse'));await a;assert.equal(h.api.get().backendJob,replacement);assert.equal(p.learnedCache.size,0);
  second.resolve(response(requests[1],'parse'));await b;assert.equal(p.settings.diagnosticParseId,replacement.id);assert.equal(p.learnedCache.size,1);
});
test('learned UI: failed rerun retains the previously active learned matte',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const id=p.settings.learnedMatteId,entry=p.learnedCache.get(id);h.bridge.matteImage=async()=>{throw new Error('authored failure');};
  await h.api.runLearnedTask('matting');assert.equal(p.settings.learnedMatteId,id);assert.equal(p.learnedCache.get(id),entry);assert.equal(p.learnedCache.size,1);assert.match(p.learnedError,/authored failure/);
});
test('learned UI: export cannot start during a pending learned job',async()=>{
  const d=defer(),entered=defer();let request;const h=harness({bridge:{matteImage:r=>{request=r;entered.resolve();return d.promise;}}});h.activate();
  const job=h.api.runLearnedTask('matting');await entered.promise;await h.api.startExport({preventDefault(){}});assert.equal(h.api.get().exportRunning,false);assert.equal(h.calls.write.length,0);assert.equal(h.calls.encode.length,0);h.api.cancelBackendJob();d.resolve(response(request,'matting'));await job;
});
test('learned UI: cache budget stops a new submission without evicting undo data',async()=>{
  const h=harness(),p=h.activate();p.learnedCache.set('retained-undo',{bytes:256*1024*1024});await h.api.runLearnedTask('parse');assert.equal(h.calls.parse.length,0);assert.equal(p.learnedCache.size,1);assert.match(p.learnedError,/256 MB/);
});
test('learned UI: oversized original sources are rejected, not silently reduced',async()=>{
  const h=harness(),p=h.activate();p.originalWidth=5000;p.originalHeight=80;h.pipeline.decodeOriginalImage=async()=>({canvas:h.canvas(5000,80),originalWidth:5000,originalHeight:80,scaled:false});
  await h.api.runLearnedTask('matting');assert.equal(h.calls.matte.length,0);assert.equal(h.calls.crop.length,0);assert.match(p.learnedError,/4096/);
});
test('learned UI: malformed conservative policy, vocabulary or complement cannot enter the cache',async()=>{
  const corruptions=[
    r=>{r.provenance.maskPolicy.version='unknown';},
    r=>{r.provenance.maskPolicy.kind='generative-retouch';},
    r=>{r.provenance.maskPolicy.guard.radiusPx=0;},
    r=>{r.provenance.maskPolicy.guard.units='model-pixels';},
    r=>{r.provenance.maskPolicy.guard.outsideRoi='skin';},
    r=>{r.provenance.classVocabulary.reverse();},
    r=>{r.provenance.maskClasses.skin=['nose','skin'];},
    r=>{r.protected[0]=.9;}
  ];
  for(const corrupt of corruptions){const h=harness({bridge:{parseFaceMasks:async req=>{const result=response(req,'parse');corrupt(result);return result;}}}),p=h.activate();
    await h.api.runLearnedTask('parse');assert.equal(p.learnedCache.size,0,`Accepted malformed reply: ${corrupt}`);assert.equal(p.settings.diagnosticParseId,undefined);assert.match(p.learnedError,/失败/);}
});

function pointerEvent(h,point={x:50.5,y:40.5},extra={}) {
  h.get('imageSurface').rect={left:30,top:40,width:250,height:200,right:280,bottom:240};
  return {pointerId:1,button:0,target:h.get('imageSurface'),clientX:30+point.x*2.5,clientY:40+point.y*2.5,...extra};
}
function paint(h,mode='remove',points=[{x:50.5,y:40.5}]) {
  h.api.setTool(`matte-${mode}`);h.fire('viewport','pointerdown',pointerEvent(h,points[0]));
  for(const point of points.slice(1))h.fire('viewport','pointermove',pointerEvent(h,point));
  h.fire('viewport','pointerup',pointerEvent(h,points.at(-1)));
}
test('learned UI brush: pointer path stores original pixel coordinates and one undoable stroke',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const oldUndo=p.undo.length;
  paint(h,'remove',[{x:50.5,y:40.5},{x:60.5,y:42.5}]);
  assert.equal(p.settings.learnedMatteStrokes.length,1);const stroke=p.settings.learnedMatteStrokes[0];assert.equal(stroke.mode,'remove');assert.equal(stroke.radiusPx,4);assert.equal(stroke.hardness,1);assert.equal(stroke.opacity,1);
  assert.deepEqual(JSON.parse(JSON.stringify(stroke.points)),[{x:50.5,y:40.5},{x:60.5,y:42.5}]);assert.equal(p.undo.length,oldUndo+1);assert.equal(h.api.get().matteDraft,null);
});
test('learned UI brush: remove and keep change derived alpha, never cached model output',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const original=p.learnedCache.get(p.settings.learnedMatteId).result.matte.data,prior=new Float32Array(original),index=40*100+50;
  paint(h,'remove');let facts=h.api.factsForPhoto(p,null,h.canvas(100,80));assert.equal(facts.mask.data[index],0);assert.notEqual(facts.mask.data,original);assert.equal(facts.learnedMatte.correction.learned,false);
  paint(h,'keep');facts=h.api.factsForPhoto(p,null,h.canvas(100,80));assert.equal(facts.mask.data[index],1);assert.deepEqual(original,prior);assert.equal(facts.learnedMatte.correction.strokeCount,2);
});
test('learned UI brush: opacity remains continuous and repeated points do not compound one stroke',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');h.get('matteOpacity').value='50';paint(h,'remove',[{x:50.5,y:40.5},{x:51.5,y:40.5},{x:50.5,y:40.5}]);
  const facts=h.api.factsForPhoto(p,null,h.canvas(100,80));assert.equal(facts.mask.data[40*100+50],.375);
});
test('learned UI brush: undo, redo and clear correction restore exact original alpha',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');paint(h);const id=p.settings.learnedMatteId,at=40*100+50;
  h.api.undo();assert.equal(p.settings.learnedMatteId,id);assert.equal(p.settings.learnedMatteStrokes.length,0);assert.equal(h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data[at],.75);
  h.api.redo();assert.equal(h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data[at],0);h.fire('clearMatteStrokes');assert.equal(p.settings.learnedMatteStrokes.length,0);assert.equal(h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data[at],.75);
  h.api.undo();assert.equal(h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data[at],0);assert.equal(h.calls.matte.length,1);
});
for(const interruption of ['pointercancel','lostpointercapture','escape','blur','switch','source-revision','disable','raw-inspection'])test(`learned UI brush: ${interruption} discards an uncommitted draft`,async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');h.api.setTool('matte-remove');h.fire('viewport','pointerdown',pointerEvent(h));assert.ok(h.api.get().matteDraft);
  if(interruption==='escape')h.events.get('keydown')({key:'Escape',target:h.get('viewport')});
  else if(interruption==='blur')h.events.get('blur')();
  else if(interruption==='switch'){h.photo('two');await h.api.activatePhoto('two');}
  else if(interruption==='source-revision'){p.sourceRevision='one:source-1';h.fire('viewport','pointerup',pointerEvent(h));}
  else if(interruption==='disable'){h.get('learnedMatteEnabled').checked=false;h.fire('learnedMatteEnabled','change');}
  else if(interruption==='raw-inspection'){h.get('learnedRawMatte').checked=true;h.fire('learnedRawMatte','change');}
  else h.fire('viewport',interruption,pointerEvent(h));
  assert.equal(h.api.get().matteDraft,null);assert.equal(p.settings.learnedMatteStrokes.length,0);
});
test('learned UI brush: absent matte, original-held view and out-of-image points cannot begin a stroke',async()=>{
  const h=harness(),p=h.activate();h.api.setTool('matte-remove');assert.equal(h.api.get().tool,'pan');assert.equal(h.api.beginMatteStroke(pointerEvent(h)),false);
  await h.api.runLearnedTask('matting');h.api.setTool('matte-remove');h.api.set({originalHeld:true});assert.equal(h.api.beginMatteStroke(pointerEvent(h)),false);h.api.set({originalHeld:false});assert.equal(h.api.beginMatteStroke(pointerEvent(h,{x:-5,y:40})),false);assert.equal(p.settings.learnedMatteStrokes.length,0);
});
test('learned UI brush: parameter sync preserves destination corrections and does not copy strokes',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');paint(h);p.settings.exposure=12;
  const own=[{mode:'keep',points:[{x:2,y:3}],radiusPx:2,hardness:.5,opacity:.5}],other=h.photo('two',{learnedMatteStrokes:structuredClone(own)}),empty=h.photo('three');h.fire('applySync');
  assert.deepEqual(JSON.parse(JSON.stringify(other.settings.learnedMatteStrokes)),own);assert.equal(empty.settings.learnedMatteStrokes,undefined);assert.equal(other.settings.exposure,12);
});
test('learned UI brush: corrected original alpha is used by export, not a preview-sized repaint',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');paint(h);await flush();p.settings.bgMode='transparent';h.calls.render.length=0;
  const expected=h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data;await h.api.startExport({preventDefault(){}});const job=h.calls.render.find(c=>c.input.id==='original');
  assert.equal(job.facts.mask.data,expected);assert.equal(job.facts.mask.data[40*100+50],0);assert.equal(job.facts.mask.data.length,8000);assert.equal(job.facts.learnedMatte.correction.learned,false);assert.equal(h.calls.write.length,1);assert.equal(h.calls.matte.length,1);
});
test('learned UI brush: opening export cancels an uncommitted draft before the modal',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');h.api.setTool('matte-remove');h.fire('viewport','pointerdown',pointerEvent(h));assert.ok(h.api.get().matteDraft);
  h.fire('exportBtn');assert.equal(h.get('exportDialog').open,true);assert.equal(h.api.get().matteDraft,null);h.fire('viewport','pointerup',pointerEvent(h));assert.equal(p.settings.learnedMatteStrokes.length,0);
});
test('learned UI brush: direct export entry cannot retain a stale brush draft',async()=>{
  const folder=defer(),h=harness({bridge:{chooseExportFolder:()=>folder.promise}}),p=h.activate();await h.api.runLearnedTask('matting');h.api.setTool('matte-remove');h.fire('viewport','pointerdown',pointerEvent(h));
  const job=h.api.startExport({preventDefault(){}});const draftAfterStart=h.api.get().matteDraft;folder.resolve({token:'test',displayPath:'/test-only'});await job;assert.equal(draftAfterStart,null);assert.equal(p.settings.learnedMatteStrokes.length,0);
});
test('learned UI brush: entering original-held view cancels the draft instead of committing hidden edits',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');h.api.setTool('matte-remove');h.fire('viewport','pointerdown',pointerEvent(h));
  h.events.get('keydown')({key:' ',code:'Space',target:h.get('viewport'),preventDefault(){}});assert.equal(h.api.get().matteDraft,null);h.fire('viewport','pointerup',pointerEvent(h));assert.equal(p.settings.learnedMatteStrokes.length,0);
});
test('learned UI brush: rejected kernel parameters cannot mutate alpha or append history',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');const oldUndo=p.undo.length,original=p.learnedCache.get(p.settings.learnedMatteId).result.matte.data,prior=new Float32Array(original);h.get('matteRadius').value='256';
  paint(h);assert.equal(p.settings.learnedMatteStrokes.length,0);assert.equal(p.undo.length,oldUndo);assert.deepEqual(original,prior);assert.match(p.learnedError,/未应用/);
});
for(const navigation of ['fitBtn','zoomIn','zoomOut'])test(`learned UI brush: ${navigation} discards the current coordinate-space draft`,async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');h.api.setTool('matte-remove');h.fire('viewport','pointerdown',pointerEvent(h));h.fire(navigation);assert.equal(h.api.get().matteDraft,null);h.fire('viewport','pointerup',pointerEvent(h));assert.equal(p.settings.learnedMatteStrokes.length,0);
});
test('learned UI: learned-only background export does not require the legacy segmentation model',async()=>{
  let analyzes=0;const h=harness({pipeline:{analyze:async()=>{analyzes++;throw new Error('legacy model intentionally unavailable');}}}),p=h.activate();await h.api.runLearnedTask('matting');await flush();p.settings.bgMode='transparent';h.api.set({modelState:'ready'});h.calls.decode.length=0;
  await h.api.startExport({preventDefault(){}});assert.equal(analyzes,0);assert.equal(h.calls.decode.length,0);assert.equal(h.calls.write.length,1);
});
test('learned UI: optional face analysis cannot overwrite the selected learned alpha',async()=>{
  let analyzes=0;const h=harness({pipeline:{analyze:async()=>{analyzes++;return {faceCount:1,landmarks:[mesh()],mask:{width:25,height:20,data:new Float32Array(500).fill(.1),maxValue:1}};}}}),p=h.activate();await h.api.runLearnedTask('matting');await flush();p.settings.bgMode='transparent';p.settings.slim=10;h.api.set({modelState:'ready'});h.calls.render.length=0;
  await h.api.startExport({preventDefault(){}});const job=h.calls.render.find(c=>c.input.id==='original');assert.equal(analyzes,1);assert.equal(job.facts.faceCount,1);assert.equal(job.facts.mask.data[0],.75);assert.equal(job.facts.mask.learnedMatteId,p.settings.learnedMatteId);assert.equal(h.calls.write.length,1);
});
test('learned UI brush: raw-model inspection does not disable corrections used by export',async()=>{
  const h=harness(),p=h.activate();await h.api.runLearnedTask('matting');paint(h);const corrected=h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data;h.get('learnedRawMatte').checked=true;h.fire('learnedRawMatte','change');
  assert.equal(p.matteInspectOriginal,true);assert.equal(h.api.get().tool,'pan');assert.equal(h.api.factsForPhoto(p,null,h.canvas(100,80)).mask.data,corrected);assert.equal(corrected[40*100+50],0);assert.equal(p.learnedCache.get(p.settings.learnedMatteId).result.matte.data[40*100+50],.75);
});

function panelHarness(initial) {
  const {mount}=require('../src/backend-panel.js'),elements=new Map();let report=initial;
  class Element{constructor(){this.listeners=new Map();this.children=[];}addEventListener(name,fn){this.listeners.set(name,fn);}append(child){this.children.push(child);}replaceChildren(){this.children=[];}showModal(){this.open=true;}close(){this.open=false;}}
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  return {panel:mount({backendProbe:async()=>report},{getElementById:get,createElement:()=>new Element()}),get,set:value=>{report=value;},choose(id,value){get(id).value=value;get(id).listeners.get('change')();}};
}
const panelModel=(id,version='v1',devices=['cpu'])=>({id,version,devices,kind:'model',status:'ready',tasks:['parse'],weightsSha256:'a'.repeat(64),license:{id:'MIT',status:'approved'}});
const panelReport=models=>({runtime:{available:true,version:'test-double-only'},devices:[{kind:'cpu',available:true},{kind:'cuda',available:true}],models});
test('learned UI panel: a vanished desired model never silently switches to a different ready model',async()=>{
  const h=panelHarness(panelReport([panelModel('first'),panelModel('alternative')]));await h.panel.refresh();assert.equal(h.panel.getSelection().modelId,'first');
  h.set(panelReport([panelModel('alternative')]));await h.panel.refresh();assert.equal(h.panel.getSelection().modelId,null);assert.equal(h.panel.getSelection().ready,false);assert.equal(h.get('backendModel').disabled,false);assert.match(h.get('backendModel').children[0].textContent,/明确选择/);
  h.choose('backendModel',JSON.stringify(['alternative','v1']));assert.equal(h.panel.getSelection().modelId,'alternative');assert.equal(h.panel.getSelection().ready,true);
});
test('learned UI panel: explicit device changes do not silently swap models or fall back to CPU',async()=>{
  const h=panelHarness(panelReport([panelModel('cpu-only'),panelModel('cuda-only','v1',['cuda'])]));await h.panel.refresh();
  h.choose('backendDevice','cuda');assert.equal(h.panel.getSelection().device,'cuda');assert.equal(h.panel.getSelection().modelId,null);assert.equal(h.panel.getSelection().ready,false);
  h.choose('backendModel',JSON.stringify(['cuda-only','v1']));assert.equal(h.panel.getSelection().ready,true);assert.equal(h.panel.getSelection().device,'cuda');
  h.choose('backendDevice','cpu');assert.equal(h.panel.getSelection().device,'cpu');assert.equal(h.panel.getSelection().modelId,null);assert.equal(h.panel.getSelection().ready,false);
});
test('learned UI panel: a version replacement also requires explicit model selection',async()=>{
  const h=panelHarness(panelReport([panelModel('same-id','v1')]));await h.panel.refresh();h.set(panelReport([panelModel('same-id','v2')]));await h.panel.refresh();assert.equal(h.panel.getSelection().modelId,null);
  h.choose('backendModel',JSON.stringify(['same-id','v2']));assert.equal(h.panel.getSelection().modelVersion,'v2');assert.equal(h.panel.getSelection().ready,true);
});
