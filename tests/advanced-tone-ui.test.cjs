'use strict';
// Executes shipped advanced-color UI with authored DOM/canvas/IPC doubles and real
// tone pixels/project codec. Not native Chromium rendering, model or native-dialog QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
const Tone = require('../src/advanced-tone.cjs');
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
  const elements=new Map(),events=new Map(),calls={saved:[],opens:0,confirm:0,decoded:[],encoded:[],dirty:[],urls:[],revoked:[],writes:[],model:0,renders:[],encodes:[],draws:[],histograms:[]};let sequence=0,timer=0;
  class Element {
    constructor(tag){this.id=tag;this.tag=tag;this.children=[];this.parent=null;this.dataset={};this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.value='';this.min='0';this.max='100';this.width=2;this.height=2;this.clientWidth=1000;this.clientHeight=700;this.listeners=new Map();this.open=false;}
    addEventListener(n,fn){this.listeners.set(n,fn);}setAttribute(key,value){this.attributes ||= {};this.attributes[key]=String(value);}insertAdjacentHTML(){}replaceChildren(...c){this.children=[];this.append(...c);}append(...c){for(const e of c){e.remove();this.children.push(e);e.parent=this;}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}focus(){}click(){return this.listeners.get('click')?.({target:this});}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(id){this.capture=null;}matches(){return false;}closest(selector){return selector===`#${this.id}`||selector==='.control'?this:null;}showModal(){this.open=true;}close(){this.open=false;}
    querySelector(s){return this.children.find(e=>s==='input'?e.tag==='input':s==='span'?e.tag==='span':e.className===s.slice(1))||new Element('stub');}
    getBoundingClientRect(){return {left:0,top:0,width:1000,height:700,right:1000,bottom:700};}
    toBlob(fn){fn(overrides.thumbnailFailure?.(++calls.thumbnailCount)?null:new Blob(['thumbnail'],{type:'image/jpeg'}));}
    getContext(){return {clearRect(){},drawImage:(canvas)=>calls.draws.push({target:this.id,canvas}),closePath(){},save(){},restore(){},beginPath(){},rect(){},clip(){},stroke(){},fill(){},arc(){},ellipse(){},lineTo(){},moveTo(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){},getImageData:(x,y,w,h)=>{if(this.pixels)return new CanvasPixels(w,h,new Uint8ClampedArray(this.pixels));const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data[i*4]=120+i%13;data[i*4+1]=110+i%7;data[i*4+2]=100+i%5;data[i*4+3]=255;}return new CanvasPixels(w,h,data);}};}
  }
  class CanvasPixels { constructor(width,height,data) { Object.assign(this,{width,height,data}); } }
  calls.thumbnailCount=0;
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});
  get('repairRadius').value='1.4';get('repairHardness').value='60';get('repairStrength').value='80';get('selectionMode').value='add';get('selectionRadius').value='3';get('selectionFeather').value='0';get('liquifyRadius').value='10';get('liquifyStrength').value='50';get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';get('matteRadius').value='4';get('matteHardness').value='100';get('matteOpacity').value='100';
  const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),
    decodeImage:async(blob,max)=>{calls.decoded.push({blob,max});const d=Codec.inspectImage(new Uint8Array(await blob.arrayBuffer()),blob.type);return {canvas:canvas(Math.min(d.width,max),Math.min(d.height,max)),originalWidth:d.width,originalHeight:d.height};},
    analyze:async()=>{calls.model++;return {faceCount:0,landmarks:[],mask:null};},render:async(c,settings,facts,options={})=>{calls.renders.push({canvas:c,settings:structuredClone(settings),facts,options});const output=canvas(c.width,c.height);output.pixels=Tone.apply(structuredClone(c.getContext('2d').getImageData(0,0,c.width,c.height)),structuredClone(settings.advancedTone)).data;return output;},encode:async(c)=>{calls.encodes.push(c);return new Uint8Array(sourceBytes);},...overrides.pipeline};
  const bridge={saveProject:async payload=>{calls.saved.push(payload);return {canceled:false,displayName:'saved.mintproj'};},openProject:async()=>{calls.opens++;return {canceled:true};},confirmReplaceProject:async()=>{calls.confirm++;return true;},setSessionDirty:v=>calls.dirty.push(v),onMenuAction:fn=>events.set('menu',fn),chooseExportFolder:async()=>({token:'test',displayPath:'test folder'}),writeExport:async payload=>calls.writes.push(payload),...overrides.bridge};
  const codec={VERSION:Codec.VERSION,encode:async value=>{calls.encoded.push(structuredClone(value));return Codec.encode(structuredClone(value));},decode:bytes=>Codec.decode(bytes),...overrides.codec};
  const context=vm.createContext({Pipeline:pipeline,window:{desktop:bridge,MintAdvancedTone:overrides.toneCore===false?null:{defaults:()=>Tone.defaults(),validate:r=>Tone.validate(structuredClone(r)),isActive:r=>Tone.isActive(structuredClone(r)),apply:(im,r,o)=>Tone.apply(structuredClone(im),structuredClone(r),o),histogram:(im,o)=>{assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(im)),null,'app wraps ImageData as plain image record');calls.histograms.push({image:structuredClone(im),options:structuredClone(o)});return overrides.histogram?overrides.histogram(im,o):Tone.histogram(structuredClone(im),structuredClone(o));}},MintManualPipeline:require('../src/manual-pipeline.cjs'),RepairBrushCore:overrides.repairCore===false?null:{...Repair,validate:(c,o)=>Repair.validate(structuredClone(c),{...o,manualTools:Manual}),resolveSource:(i,c,o)=>Repair.resolveSource(structuredClone(i),structuredClone(c),{...o,manualTools:Manual,selection:structuredClone(o.selection)}),apply:(i,c,o)=>Repair.apply(structuredClone(i),structuredClone(c),{...o,manualTools:Manual,selection:structuredClone(o.selection)})},MintManualTools:overrides.manualCore === false ? null : Object.fromEntries(['validateSelection','rasterizeSelection','validateLiquifyCommands','liquify'].map(key=>[key,(...args)=>Manual[key](...args.map(value=>structuredClone(value)))])),MintExportQueue:require('../src/export-queue.cjs'),PortraitEngine:require('../src/portrait-engine.cjs'),MintProjectDocument:codec,MintLearnedAnalysis:Learned,addEventListener:(n,fn)=>events.set(n,fn)},document:{getElementById:get,querySelectorAll:s=>s==='.photo-card'?get('filmstrip').children.filter(e=>e.className==='photo-card'):[],querySelector:s=>get('filmstrip').children.find(e=>s===`[data-photo-id="${e.dataset.photoId}"]`)||null,createElement:t=>new Element(t),body:new Element('body')},console,structuredClone,AbortController,Blob,Uint8Array,Float32Array,Uint8ClampedArray,ArrayBuffer,HTMLElement:Element,crypto:{randomUUID:()=>`photo-${++sequence}`},URL:{createObjectURL:()=>{const u=`blob:thumb-${++sequence}`;calls.urls.push(u);return u;},revokeObjectURL:u=>calls.revoked.push(u)},ResizeObserver:class{observe(){}},setTimeout:(fn,delay)=>++timer,clearTimeout(){},setInterval:()=>++timer,clearInterval(){}});
  let app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
  app+='\nglobalThis.audit={scheduleRender,clearSessionView,setCompare,clearToneHistogram,updateToneHistogram,updateAdvancedToneControls,editAdvancedTone,requireOpaqueManualLiquifyView,setTool,renderCurrent,manualPoint,beginManualStroke,appendManualStroke,finishManualStroke,editSelection,updateManualControls,photos,saveProject,openProject,projectSnapshot,startExport,cancelExport,openExport,exportLimit,addLocalLayer,removeLocalLayer,moveLocalLayer,changeLocalLayer,selectedLocalLayer,updateLocalControls,drawPreview,hasUnsavedProjectChanges,projectFingerprint,changeSettings,undo,redo,activatePhoto,importFiles,removeSelected,startExport,updateAvailability,factsForPhoto,appendPhotoCard,set:(v)=>{if("viewToken"in v)viewToken=v.viewToken;if("renderVersion"in v)renderVersion=v.renderVersion;if("rendered"in v)rendered=v.rendered;if("manualViewReady"in v)manualViewReady=v.manualViewReady;if("originalHeld"in v)originalHeld=v.originalHeld;if("source"in v)source=v.source;if("currentId"in v)currentId=v.currentId;if("analysis"in v)analysis=v.analysis;if("modelState"in v)modelState=v.modelState;if("backendJob"in v)backendJob=v.backendJob;if("loadingPhoto"in v)loadingPhoto=v.loadingPhoto;if("analyzingPhoto"in v)analyzingPhoto=v.analyzingPhoto;if("renderingPhoto"in v)renderingPhoto=v.renderingPhoto;if("importing"in v)importing=v.importing;if("exportRunning"in v)exportRunning=v.exportRunning;if("matteDraft"in v)matteDraft=v.matteDraft;},get:()=>({toneHistogram,toneCurveGraphKey,renderVersion,viewToken,repairSample,repairMode,manualDraft,manualViewReady,renderedManualMode,pointer,tool,rendered,exportQueue,exportFolder,exportRunning,projectOperation,projectDisplayName,currentId,source,analysis,matteDraft,loadingPhoto,savedProjectFingerprint})};';
  vm.runInContext(app,context);const api=context.audit;
  function photo(id='old',settings={}){const p={id,name:`${id}.png`,blob:new Blob([sourceBytes],{type:'image/png'}),thumb:`blob:old-${id}`,sourceRevision:`${id}:source-0`,originalWidth:100,originalHeight:80,selected:true,settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,preset:null,learnedCache:new Map()};api.photos.push(p);api.appendPhotoCard(p);return p;}
  function activate(p=photo()){api.set({currentId:p.id,source:canvas(100,80),analysis:null});api.updateAvailability();return p;}
  const fire=(id,name='click',extra={})=>get(id).listeners.get(name)?.({type:name,target:get(id),preventDefault(){},stopPropagation(){},...extra});
  return {api,photo,activate,calls,bridge,pipeline,codec,events,get,fire,canvas};
}


const plain = value => JSON.parse(JSON.stringify(value));
const pixelData = pixels => new Uint8ClampedArray(pixels.flat());
const setInput = (h,id,value,commit=true) => { h.get(id).value=String(value);h.fire(id,'input');if(commit)h.fire(id,'change'); };
const select = (h,id,value) => { h.get(id).value=String(value);h.fire(id,'change'); };
const renderedPixels = h => new Uint8ClampedArray(h.api.get().rendered.pixels);
async function ready(h, name) { h.api.setTool(name);await h.api.renderCurrent();assert.equal(h.api.get().manualViewReady,true); }
function stroke(h,end=true){h.fire('viewport','pointerdown',{pointerId:1,button:0,clientX:200,clientY:200,target:h.get('imageSurface')});if(end)h.fire('viewport','pointerup',{pointerId:1,clientX:500,clientY:350,target:h.get('imageSurface')});}

test('tone DOM: collapsed after basic color, before portrait; five labelled nodes, eight bands, honest controls and script ordering',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  const section=/<details id="advancedToneSection"([^>]*)>/.exec(html);assert.ok(section);assert.doesNotMatch(section[1],/\bopen\b/);
  assert.ok(html.indexOf('id="colorSection"')<html.indexOf('id="advancedToneSection"'));assert.ok(html.indexOf('id="advancedToneSection"')<html.indexOf('id="skinSection"'));
  for(let i=0;i<5;i++){assert.match(html,new RegExp(`label for="toneCurveNode${i}"`));assert.match(html,new RegExp(`input id="toneCurveNode${i}" type="range"`));}
  assert.equal((html.match(/id="toneCurveNode\d"/g)||[]).length,5);
  assert.equal(/<select id="toneHslBand"[\s\S]*?<\/select>/.exec(html)[0].match(/<option/g).length,8);
  assert.ok(html.indexOf('src="advanced-tone.cjs"')<html.indexOf('src="project-document.cjs"'));
  assert.match(html,/不是 RAW 或全尺寸分析/);assert.match(html,/半透明按 alpha 加权/);assert.match(html,/不会自动铺底/);assert.match(html,/全局风格预设会重置高级调色/);
  const css=fs.readFileSync(path.join(__dirname,'../src/styles.css'),'utf8');assert.match(css,/\.tone-curve-graph, #toneHistogramGraph \{[^}]*width: 100%/);assert.match(css,/\.tone-select-row select \{[^}]*min-width: 100px/);
});

test('tone UI: missing core disables every editing path without fake mutations',async()=>{
  const h=harness({toneCore:false}),p=h.activate();
  for(const id of ['advancedToneEnabled','advancedToneStrength','toneCurveNode2','toneCurveMode','toneHslHue','resetAdvancedTone'])assert.equal(h.get(id).disabled,true);
  setInput(h,'toneCurveNode2',70);setInput(h,'toneHslHue',20);h.fire('resetToneHsl');assert.equal(p.settings.advancedTone,null);assert.equal(p.undo.length,0);
  await h.api.renderCurrent();assert.equal(h.api.get().toneHistogram,null);assert.match(h.get('advancedToneStatus').textContent,/核心不可用/);assert.match(h.get('toneHistogramSummary').textContent,/不可用/);
});

test('tone UI: range input uses actual pixels, groups drag into one history item, preserves alpha, undo/redo exact',async()=>{
  const h=harness(),p=h.activate();await h.api.renderCurrent();const before=renderedPixels(h);
  setInput(h,'toneCurveNode2',60,false);setInput(h,'toneCurveNode2',66,false);assert.equal(p.undo.length,0);h.fire('toneCurveNode2','change');assert.equal(p.undo.length,1);
  assert.equal(p.settings.advancedTone.curves.rgb[2],.66);await h.api.renderCurrent();const after=renderedPixels(h);assert.notDeepEqual(after,before);for(let i=3;i<after.length;i+=4)assert.equal(after[i],before[i]);
  h.api.undo();assert.equal(p.settings.advancedTone,null);await h.api.renderCurrent();assert.deepEqual(renderedPixels(h),before);
  h.api.redo();await h.api.renderCurrent();assert.deepEqual(renderedPixels(h),after);
});

test('tone UI: real per-channel curves, HSL bands, enabled and strength values independently change pixels',async()=>{
  const h=harness(),p=h.activate();const src=h.api.get().source;src.pixels=Tone.apply({width:src.width,height:src.height,data:new Uint8ClampedArray(src.width*src.height*4).map((_,i)=>[190,70,45,255][i%4])},null).data;
  await h.api.renderCurrent();const baseline=renderedPixels(h);select(h,'toneCurveChannel','red');setInput(h,'toneCurveNode2',65);await h.api.renderCurrent();assert.ok(renderedPixels(h)[0]>baseline[0]);assert.equal(renderedPixels(h)[1],baseline[1]);
  h.fire('resetToneCurves');select(h,'toneHslBand',0);setInput(h,'toneHslHue',25);setInput(h,'toneHslSaturation',-50);setInput(h,'toneHslLuminance',20);await h.api.renderCurrent();assert.notDeepEqual(renderedPixels(h),baseline);
  assert.deepEqual(plain(p.settings.advancedTone.hsl[0]),{hue:25,saturation:-50,luminance:20});
  h.get('advancedToneEnabled').checked=false;h.fire('advancedToneEnabled','change');await h.api.renderCurrent();assert.deepEqual(renderedPixels(h),baseline);assert.equal(p.settings.advancedTone.hsl[0].hue,25);
  h.get('advancedToneEnabled').checked=true;h.fire('advancedToneEnabled','change');setInput(h,'advancedToneStrength',0);await h.api.renderCurrent();assert.deepEqual(renderedPixels(h),baseline);
  setInput(h,'advancedToneStrength',100);await h.api.renderCurrent();assert.notDeepEqual(renderedPixels(h),baseline);
});

test('tone UI: monotone limits and free-mode reversals are explicit, invalid switch never silently reshapes channels',()=>{
  const h=harness(),p=h.activate();setInput(h,'toneCurveNode2',68);assert.equal(Number(h.get('toneCurveNode1').max),68);assert.equal(Number(h.get('toneCurveNode3').min),68);
  const before=JSON.stringify(p.settings);setInput(h,'toneCurveNode2',99);assert.equal(JSON.stringify(p.settings),before);assert.match(h.get('toast').textContent,/未更改/);
  select(h,'toneCurveMode','free');select(h,'toneCurveChannel','blue');setInput(h,'toneCurveNode1',90);setInput(h,'toneCurveNode2',10);const free=JSON.stringify(p.settings);
  select(h,'toneCurveChannel','rgb');select(h,'toneCurveMode','monotone');assert.equal(JSON.stringify(p.settings),free);assert.equal(h.get('toneCurveMode').value,'free');assert.match(h.get('toast').textContent,/不会|未改变/);
  h.fire('resetToneCurves');select(h,'toneCurveMode','monotone');assert.equal(p.settings.advancedTone.curveMode,'monotone');assert.deepEqual(plain(p.settings.advancedTone.curves.blue),[0,.25,.5,.75,1]);
});

test('tone UI: all eight HSL bands persist independently and resets have precise scope',()=>{
  const h=harness(),p=h.activate();for(let band=0;band<8;band++){select(h,'toneHslBand',band);setInput(h,'toneHslHue',band+1);setInput(h,'toneHslSaturation',band*10);setInput(h,'toneHslLuminance',-band*10);}
  assert.deepEqual(plain(p.settings.advancedTone.hsl.map(v=>v.hue)),[1,2,3,4,5,6,7,8]);
  select(h,'toneHslBand',2);assert.equal(Number(h.get('toneHslHue').value),3);h.fire('resetToneBand');assert.deepEqual(plain(p.settings.advancedTone.hsl[2]),{hue:0,saturation:0,luminance:0});assert.equal(p.settings.advancedTone.hsl[7].hue,8);
  select(h,'toneCurveChannel','red');setInput(h,'toneCurveNode2',60);select(h,'toneCurveChannel','blue');setInput(h,'toneCurveNode2',40);h.fire('resetToneChannel');assert.equal(p.settings.advancedTone.curves.red[2],.6);assert.equal(p.settings.advancedTone.curves.blue[2],.5);
  h.fire('resetToneHsl');assert.ok(p.settings.advancedTone.hsl.every(v=>v.hue===0&&v.saturation===0&&v.luminance===0));assert.equal(p.settings.advancedTone.curves.red[2],.6);
  h.fire('resetAdvancedTone');assert.equal(p.settings.advancedTone,null);h.api.undo();assert.equal(p.settings.advancedTone.curves.red[2],.6);
});

test('tone UI: photo/export/project locks reject injected changes',()=>{
  const h=harness(),p=h.activate();for(const flag of ['exportRunning','loadingPhoto','importing']){h.api.set({[flag]:true});h.api.updateAvailability();assert.equal(h.get('toneCurveNode2').disabled,true);setInput(h,'toneCurveNode2',65);assert.equal(p.settings.advancedTone,null);h.api.set({[flag]:false});}
  h.api.updateAvailability();assert.equal(h.get('toneCurveNode2').disabled,false);
});

test('tone histogram: actual accepted render pixels, alpha weighting, endpoints, no checkerboard/overlays/compare contamination',async()=>{
  const h=harness(),p=h.activate();const src=h.canvas(4,1);src.pixels=pixelData([[0,0,0,255],[255,255,255,128],[19,30,40,0],[255,0,128,255]]);h.api.set({source:src});await h.api.renderCurrent();
  const result=h.api.get().toneHistogram;assert.equal(result.sampledPixels,4);assert.equal(result.visibleSamples,3);assert.equal(result.effectiveSamples,2+128/255);assert.equal(result.bins.red[0],1);assert.equal(result.bins.red[255],1+128/255);assert.equal(result.bins.red[19],0);
  assert.equal(h.calls.histograms.length,1);assert.deepEqual(h.calls.histograms[0].options,{maxSamples:262144});assert.deepEqual(h.calls.histograms[0].image.data,src.pixels);assert.match(h.get('toneHistogramSummary').textContent,/全部预览像素 4 \/ 4/);assert.match(h.get('toneHistogramEndpoints').textContent,/0码值/);
  h.api.setCompare(true);h.api.drawPreview();h.api.set({originalHeld:true});h.api.drawPreview();assert.equal(h.calls.histograms.length,1);assert.equal(h.api.get().toneHistogram,result);
  const white=h.canvas(1,1);white.pixels=pixelData([[255,255,255,0]]);h.api.set({source:white,originalHeld:false});await h.api.renderCurrent();assert.equal(h.api.get().toneHistogram.effectiveSamples,0);assert.match(h.get('toneHistogramSummary').textContent,/没有可见像素/);
});

test('tone histogram: bounded large preview sampling is labelled approximate and retains accepted render identity',async()=>{
  const h=harness();h.activate();const src=h.canvas(1024,512);src.pixels=new Uint8ClampedArray(src.width*src.height*4).fill(255);h.api.set({source:src});await h.api.renderCurrent();const result=h.api.get().toneHistogram;
  assert.equal(result.sampledPixels,262144);assert.equal(result.totalPixels,524288);assert.equal(result.approximate,true);assert.equal(result.endpoints.red.whiteFraction,1);assert.match(h.get('toneHistogramSummary').textContent,/分层采样近似/);
});

test('tone histogram: superseded/aborted render, photo switch and source revision changes cannot publish stale data',async()=>{
  const h=harness(),p=h.activate();await h.api.renderCurrent();const first=h.api.get().toneHistogram;const deferred=defer();h.pipeline.render=()=>deferred.promise;
  const pending=h.api.renderCurrent();assert.equal(h.api.get().toneHistogram,null);h.api.scheduleRender(0);deferred.resolve(h.canvas(20,10));await pending;assert.equal(h.api.get().toneHistogram,null);
  const old=first.stamp;assert.equal(h.api.updateToneHistogram(h.api.get().rendered,old),false);assert.equal(h.api.get().toneHistogram,null);
  const photoSwitch=defer();h.pipeline.render=()=>photoSwitch.promise;const pendingPhoto=h.api.renderCurrent();const other=h.photo('other');h.api.set({currentId:other.id});photoSwitch.resolve(h.canvas(30,10));await pendingPhoto;assert.equal(h.api.get().toneHistogram,null);
  h.api.set({currentId:p.id});const revision=defer();h.pipeline.render=()=>revision.promise;const pendingRevision=h.api.renderCurrent();p.sourceRevision+='-replaced';revision.resolve(h.canvas(40,10));await pendingRevision;assert.equal(h.api.get().toneHistogram,null);
  h.api.clearSessionView();assert.equal(h.api.get().toneHistogram,null);assert.match(h.get('toneHistogramSummary').textContent,/等待/);
});

test('tone histogram: render failures clear current statistics, and histogram-only failure keeps accepted image',async()=>{
  const h=harness();h.activate();await h.api.renderCurrent();h.pipeline.render=async()=>{throw new Error('render test failure');};await h.api.renderCurrent();assert.equal(h.api.get().toneHistogram,null);assert.match(h.get('toneHistogramSummary').textContent,/尚未完成/);
  const broken=harness({histogram:()=>{throw new Error('histogram read failure');}});broken.activate();await broken.api.renderCurrent();assert.ok(broken.api.get().rendered);assert.equal(broken.api.get().toneHistogram,null);assert.match(broken.get('toneHistogramSummary').textContent,/无法读取/);
});

test('tone UI: global synchronization copies tone deeply but retains per-photo source-bound work; preset explicitly resets tone',()=>{
  const preset={id:'test',name:'Test',description:'Test',settings:{...structuredClone(defaults),exposure:15}};
  const h=harness({pipeline:{PRESETS:[preset]}}),p=h.activate(),other=h.photo('other');
  other.settings.manualSelection={version:1,sourceRevision:other.sourceRevision,base:'none',inverted:false,feather:0,commands:[]};other.settings.manualLiquify=[{kind:'push',sourceRevision:other.sourceRevision,radius:.1,strength:.4,points:[{x:.2,y:.2},{x:.3,y:.2}],selection:null}];
  const manual=JSON.stringify(other.settings.manualLiquify),selection=JSON.stringify(other.settings.manualSelection);setInput(h,'toneCurveNode2',65);h.get('syncScope').value='all';h.fire('applySync');
  assert.deepEqual(plain(other.settings.advancedTone),plain(p.settings.advancedTone));assert.notEqual(other.settings.advancedTone,p.settings.advancedTone);assert.equal(JSON.stringify(other.settings.manualLiquify),manual);assert.equal(JSON.stringify(other.settings.manualSelection),selection);assert.equal(other.undo.length,1);
  h.get('presets').children[0].click();assert.equal(p.settings.advancedTone,null);assert.equal(p.settings.exposure,15);h.api.undo();assert.equal(p.settings.advancedTone.curves.rgb[2],.65);
});

test('tone UI: recipe and undo history survive real project encode/decode and UI restore',async()=>{
  const h=harness(),p=h.activate();select(h,'toneCurveMode','free');setInput(h,'toneCurveNode1',80);select(h,'toneHslBand',6);setInput(h,'toneHslHue',-12);const expected=plain(p.settings.advancedTone);
  await h.api.saveProject();assert.equal(h.calls.saved.length,1,h.get('toast').textContent);const bytes=h.calls.saved[0].bytes;const decoded=await Codec.decode(bytes);assert.deepEqual(plain(decoded.photos[0].settings.advancedTone),expected);assert.ok(decoded.photos[0].undo.some(item=>item.advancedTone?.curveMode==='free'));
  const restored=harness({bridge:{openProject:async()=>({canceled:false,bytes,displayName:'tone.mintproj'})}});restored.activate();await restored.api.openProject();await settle(restored);assert.deepEqual(plain(restored.api.photos[0].settings.advancedTone),expected);assert.equal(restored.get('toneCurveMode').value,'free');assert.equal(Number(restored.get('toneCurveNode1').value),80);
});

for(const alpha of [0,1,128,254])for(const tool of ['liquify-push','liquify-restore'])test(`liquify safety: ${tool} refuses alpha ${alpha} in accepted view, without draft/history/flattening`,async()=>{
  const h=harness(),p=h.activate();await ready(h,tool);h.api.get().rendered.pixels[3]=alpha;const original=renderedPixels(h),before=JSON.stringify(p.settings);stroke(h);
  assert.equal(h.api.get().manualDraft,null);assert.equal(h.api.get().pointer,null);assert.equal(p.undo.length,0);assert.equal(JSON.stringify(p.settings),before);assert.deepEqual(renderedPixels(h),original);assert.match(h.get('toast').textContent,/不透明原图/);assert.match(h.get('toast').textContent,/不会自动铺底/);
});

test('liquify safety: accepted manual view, not composited source or preview overlay, is checked at begin and commit',async()=>{
  const h=harness(),p=h.activate();await ready(h,'liquify-push');stroke(h,false);assert.ok(h.api.get().manualDraft);h.api.get().rendered.pixels[3]=128;h.fire('viewport','pointerup',{pointerId:1,clientX:500,clientY:350});assert.equal(p.undo.length,0);assert.equal(p.settings.manualLiquify.length,0);assert.equal(h.api.get().manualDraft,null);
  h.api.get().rendered.pixels[3]=255;stroke(h);assert.equal(p.undo.length,1);assert.equal(p.settings.manualLiquify.length,1);assert.equal(p.settings.manualLiquify[0].kind,'push');
});

test('liquify safety: unreadable alpha fails closed, while selection tools remain usable on transparency',async()=>{
  const h=harness(),p=h.activate();await ready(h,'liquify-push');h.api.get().rendered.getContext=()=>({getImageData(){throw new Error('unreadable');}});stroke(h);assert.equal(p.undo.length,0);assert.match(h.get('toast').textContent,/未开始/);
  await ready(h,'selection-brush');h.api.get().rendered.pixels[3]=0;stroke(h);assert.equal(p.settings.manualSelection.commands.length,1);assert.equal(p.undo.length,1);
});

test('tone histogram: late older completion cannot replace newer accepted statistics',async()=>{
  const h=harness();h.activate();h.api.set({source:h.canvas(2,1)});const older=defer(),newer=defer();let count=0;h.pipeline.render=()=>++count===1?older.promise:newer.promise;
  const oldWork=h.api.renderCurrent(),newWork=h.api.renderCurrent();const accepted=h.canvas(2,1);accepted.pixels=pixelData([[5,6,7,255],[200,201,202,255]]);newer.resolve(accepted);await newWork;
  const histogram=h.api.get().toneHistogram;assert.equal(histogram.bins.red[5],1);assert.equal(h.calls.histograms.length,1);
  const late=h.canvas(3,1);late.pixels=pixelData([[255,255,255,255],[255,255,255,255],[255,255,255,255]]);older.resolve(late);await oldWork;
  assert.equal(h.api.get().rendered,accepted);assert.equal(h.api.get().toneHistogram,histogram);assert.equal(h.calls.histograms.length,1);
});

test('tone histogram: source replacement after sampling starts cannot publish computed stale bins',async()=>{
  let hook=null;const h=harness({histogram:(image,options)=>{const result=Tone.histogram(structuredClone(image),structuredClone(options));hook?.();return result;}}),p=h.activate();
  hook=()=>{p.sourceRevision+='-changed';};await h.api.renderCurrent();assert.equal(h.api.get().toneHistogram,null);
});

test('tone graph: free channel trace samples actual shared curve and never applies other channels/HSL/strength to its ramp',()=>{
  const h=harness(),p=h.activate();select(h,'toneCurveMode','free');select(h,'toneCurveChannel','green');setInput(h,'toneCurveNode1',90);setInput(h,'toneCurveNode2',10);setInput(h,'toneHslHue',25);setInput(h,'advancedToneStrength',20);
  const label=h.get('toneCurveGraph').attributes['aria-label'];assert.match(label,/绿色曲线/);assert.match(label,/90%.*10%/);assert.match(label,/不含整体强度或 HSL/);assert.equal(p.settings.advancedTone.strength,.2);
  const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');const body=source.slice(source.indexOf('function drawToneCurve('),source.indexOf('function updateAdvancedToneControls('));assert.match(body,/graphRecipe = window.MintAdvancedTone.defaults\(\)/);assert.match(body,/graphRecipe.curves.rgb = \[\.\.\.recipe.curves\[channel\]\]/);assert.match(body,/window.MintAdvancedTone.apply\(/);
});

test('tone histogram: manual-edit labels and rendered pixels remain separate from selection overlay',async()=>{
  const h=harness(),p=h.activate();p.settings.manualSelection={version:1,sourceRevision:p.sourceRevision,base:'all',inverted:false,feather:0,commands:[]};await ready(h,'selection-brush');
  assert.equal(h.api.get().toneHistogram.stamp.manualEditing,true);assert.match(h.get('toneHistogramSummary').textContent,/手动编辑视图/);const result=h.api.get().toneHistogram;h.api.drawPreview();assert.equal(h.api.get().toneHistogram,result);assert.equal(h.calls.histograms.length,1);
});
