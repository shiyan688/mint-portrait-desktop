'use strict';
// Unit scheduling/Canvas doubles plus the real shared cores. No browser was launched.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Padding=require('../src/canvas-padding.cjs');
const Geometry=require('../src/geometry.cjs');
const recipe=extra=>({...Padding.defaults(),top:.3,right:.2,bottom:.1,left:.4,color:'#fedcba',opacity:.5,...extra});
const framing={version:1,crop:{x:.1,y:.2,w:.7,h:.6},quarterTurns:1,flipX:true,flipY:false};
function harness({padding=true,geometry=true}={}) {
  const workers=[];
  class Canvas {
    constructor(width=9,height=7) {this.width=width;this.height=height;this.reads=0;this.pixels=null;}
    getContext() {return {getImageData:()=>{this.reads++;return{width:this.width,height:this.height,data:this.pixels?.slice()||new Uint8ClampedArray(this.width*this.height*4).fill(33)};},putImageData:im=>{this.pixels=im.data.slice();},fillRect(){},drawImage(){}};}
    toBlob(callback,type) {callback(new Blob([new Uint8Array([1,2,3])],{type}));}
  }
  class Worker {
    constructor(){workers.push(this);}
    postMessage(input){this.input=structuredClone(input);}
    terminate(){this.terminated=true;}
    finish(){const i=this.input;let out={width:i.width,height:i.height,data:new Uint8ClampedArray(i.buffer)};if(i.settings.framing!=null)out=Geometry.apply(out,i.settings.framing);if(i.settings.canvasPadding!=null)out=Padding.apply(out,i.settings.canvasPadding,{maxPixels:16777216,maxEdge:16384});this.onmessage({data:{width:out.width,height:out.height,buffer:out.data.buffer}});}
  }
  const c=vm.createContext({console,URL,DOMException,structuredClone,queueMicrotask,AbortController,setTimeout,Worker,Blob,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},document:{createElement:()=>new Canvas()}});
  // Load into the scheduler realm: strict core records deliberately reject foreign
  // object prototypes, so directly injecting a required CommonJS API is not valid.
  if(geometry)vm.runInContext(fs.readFileSync(require.resolve('../src/geometry.cjs'),'utf8'),c);
  if(padding)vm.runInContext(fs.readFileSync(require.resolve('../src/canvas-padding.cjs'),'utf8'),c);
  let source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
  vm.runInContext(source+'\nglobalThis.api={render,cancelRenders,encode,DEFAULT_SETTINGS,PRESETS};',c);
  // Inputs supplied by browser application code live in the same realm.
  const local=value=>{c.valueJSON=JSON.stringify(value);return vm.runInContext('JSON.parse(valueJSON)',c);};
  return {api:c.api,Canvas,workers,local};
}
test('padding scheduler defaults and built-in presets carry explicit neutral padding',()=>{
  const h=harness();assert.equal(h.api.DEFAULT_SETTINGS.canvasPadding,null);assert.ok(Object.isFrozen(h.api.DEFAULT_SETTINGS));for(const preset of h.api.PRESETS)assert.equal(preset.settings.canvasPadding,null);
});
test('scheduler plans framing then padding and allocates only exact final-size canvas',async()=>{
  const h=harness(),source=new h.Canvas(),s=h.local({framing,canvasPadding:recipe()}),before=JSON.stringify(s),pending=h.api.render(source,s);h.workers[0].finish();const out=await pending;
  const framed=Geometry.plan(9,7,framing).outputSize,expected=Padding.plan(framed.width,framed.height,recipe()).outputSize;
  assert.deepEqual([out.width,out.height],[expected.width,expected.height]);assert.equal(out.pixels.length,expected.width*expected.height*4);assert.deepEqual([source.width,source.height],[9,7]);assert.equal(JSON.stringify(s),before);
});
for(const options of [{sourceView:true},{manualEditing:true}])test(`source-coordinate view suppresses framing and padding without touching saved recipe: ${Object.keys(options)[0]}`,async()=>{
  const h=harness(),source=new h.Canvas(),s=h.local({framing,canvasPadding:recipe(),bgMode:'color',slim:5,exposure:11}),before=JSON.stringify(s),pending=h.api.render(source,s,null,options),input=h.workers[0].input;
  assert.equal(input.settings.framing,null);assert.equal(input.settings.canvasPadding,null);assert.equal(input.settings.exposure,11);assert.equal(input.settings.bgMode,options.manualEditing?'original':'color');assert.equal(input.settings.slim,options.manualEditing?0:5);
  h.workers[0].finish();assert.deepEqual([(await pending).width,source.height],[9,7]);assert.equal(JSON.stringify(s),before);
});
test('queued padding uses captured recipe and expected size despite later edits',async()=>{
  const h=harness(),source=new h.Canvas(),s=h.local({canvasPadding:recipe()}),a=h.api.render(source),b=h.api.render(source),c=h.api.render(source,s);
  s.canvasPadding.left=0;s.canvasPadding.opacity=0;
  assert.equal(h.workers.length,2);h.workers[0].finish();await a;await Promise.resolve();assert.equal(h.workers.length,3);assert.equal(h.workers[2].input.settings.canvasPadding.left,.4);assert.equal(h.workers[2].input.settings.canvasPadding.opacity,.5);
  h.workers[1].finish();h.workers[2].finish();await b;const out=await c,expected=Padding.plan(9,7,recipe()).outputSize;assert.deepEqual([out.width,out.height],[expected.width,expected.height]);
});
test('missing shared padding component fails closed, but source inspection remains available',async()=>{
  const h=harness({padding:false}),source=new h.Canvas(),s=h.local({canvasPadding:recipe()});
  await assert.rejects(h.api.render(source,s),/扩边组件不可用/);assert.equal(h.workers.length,0);assert.equal(source.reads,0);
  const pending=h.api.render(source,s,null,{sourceView:true});h.workers[0].finish();assert.equal((await pending).width,9);
});
test('scheduler rejects malformed/over-budget final canvas before source read or worker creation',async()=>{
  for(const [w,h,r] of [[4000,4000,recipe({top:.02,right:.02,bottom:.02,left:.02})],[16384,1,recipe({top:0,right:.5,bottom:0,left:0})],[9,7,{version:1}]]) {
    const harnessed=harness(),source=new harnessed.Canvas(w,h);
    await assert.rejects(harnessed.api.render(source,harnessed.local({canvasPadding:r})),/budget|range|missing/);assert.equal(harnessed.workers.length,0);assert.equal(source.reads,0);
  }
});
test('render original source limit remains 16M even if crop and padding would otherwise fit',async()=>{
  const h=harness(),source=new h.Canvas(4001,4000),s=h.local({framing:{...framing,crop:{x:0,y:0,w:.01,h:.01}},canvasPadding:recipe()});
  await assert.rejects(h.api.render(source,s),/1600/);assert.equal(source.reads,0);assert.equal(h.workers.length,0);
});
test('malformed worker output rejects without silently stretching, then the next render succeeds',async()=>{
  for(const bad of [{width:9,height:7,buffer:new ArrayBuffer(9*7*4)},{width:13,height:10,buffer:new ArrayBuffer(4)}]) {
    const h=harness(),source=new h.Canvas(),pending=h.api.render(source,h.local({canvasPadding:recipe()}));h.workers[0].onmessage({data:bad});await assert.rejects(pending,/尺寸/);assert.equal(h.workers[0].terminated,true);
    const next=h.api.render(source);h.workers[1].finish();assert.equal((await next).width,9);
  }
});
test('cancellation terminates padded job and stale completion cannot replace next source view',async()=>{
  const h=harness(),source=new h.Canvas(),s=h.local({canvasPadding:recipe()}),abort=new AbortController(),a=h.api.render(source,s,null,{signal:abort.signal}).catch(e=>e.name);abort.abort();assert.equal(await a,'AbortError');
  const b=h.api.render(source,s,null,{sourceView:true});h.workers[0].finish();h.workers[1].finish();assert.equal((await b).width,9);assert.equal(h.workers[0].terminated,true);
});
test('queued cancellation reads no source and cancel-all releases every padded job',async()=>{
  const h=harness(),source=new h.Canvas(),s=h.local({canvasPadding:recipe()}),abort=new AbortController();
  const a=h.api.render(source,s).catch(e=>e.name),b=h.api.render(source,s).catch(e=>e.name),queuedSource=new h.Canvas(),c=h.api.render(queuedSource,s,null,{signal:abort.signal}).catch(e=>e.name);
  abort.abort();assert.equal(await c,'AbortError');assert.equal(queuedSource.reads,0);assert.equal(h.workers.length,2);h.api.cancelRenders();assert.deepEqual(await Promise.all([a,b]),['AbortError','AbortError']);
  const next=h.api.render(source);h.workers[2].finish();assert.equal((await next).width,9);
});
test('final browser encode accepts worker output budget rather than incorrectly applying source 16M budget',async()=>{
  const h=harness();const final=new h.Canvas(4096,4000);assert.deepEqual(Array.from(await h.api.encode(final,'jpeg')),[1,2,3]);
  await assert.rejects(h.api.encode(new h.Canvas(4097,4096),'jpeg'),/16777216/);await assert.rejects(h.api.encode(new h.Canvas(16385,1),'jpeg'),/16384/);
});
