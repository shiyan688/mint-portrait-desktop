'use strict';
// Deterministic scheduling tests; these do not launch a browser or execute WASM.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function harness(){
 const workers=[];
 class Canvas {
  constructor(w=2,h=2){this.width=w;this.height=h;this.reads=0;this.pixels=new Uint8ClampedArray(w*h*4).fill(19);}
  getContext(){return{getImageData:()=>{this.reads++;return{width:this.width,height:this.height,data:this.pixels.slice()};},putImageData:image=>{this.pixels=image.data.slice();}};}
 }
 class Worker {
  constructor(url){this.url=url;this.terminated=false;workers.push(this);}
  postMessage(data){this.input=structuredClone(data);}
  terminate(){this.terminated=true;}
  finish(){const i=this.input;this.onmessage({data:{width:i.width,height:i.height,buffer:i.buffer}});}
 }
 const context=vm.createContext({console,URL,DOMException,Uint8ClampedArray,Uint8Array,Float32Array,structuredClone,queueMicrotask,AbortController,setTimeout,Worker,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},document:{createElement:()=>new Canvas()},Blob});
 let source=fs.readFileSync(path.join(__dirname,'../src/pipeline.js'),'utf8');
 source=source.replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
 vm.runInContext(source+'\nglobalThis.api={render,cancelRenders};',context);
 return{api:context.api,Canvas,workers};
}
test('audit: render concurrency is capped and queued abort does not read pixels',async()=>{
 const h=harness(),sources=[new h.Canvas(),new h.Canvas(),new h.Canvas()],controller=new AbortController();
 const a=h.api.render(sources[0]),b=h.api.render(sources[1]),c=h.api.render(sources[2],{},null,{signal:controller.signal});
 const caught=c.catch(e=>e.name);
 assert.equal(h.workers.length,2);assert.equal(sources[2].reads,0);
 controller.abort();assert.equal(await caught,'AbortError');assert.equal(sources[2].reads,0);
 h.workers[0].finish();h.workers[1].finish();await Promise.all([a,b]);
 assert.equal(h.workers.length,2);assert.ok(h.workers.every(w=>w.terminated));
});
test('audit: cancellation terminates workers and late replies cannot settle another render',async()=>{
 const h=harness(),source=new h.Canvas(),controller=new AbortController();
 const a=h.api.render(source,{exposure:2},null,{signal:controller.signal}).catch(e=>e.name);
 controller.abort();assert.equal(await a,'AbortError');assert.equal(h.workers[0].terminated,true);
 const b=h.api.render(source);h.workers[0].finish();h.workers[1].finish();const canvas=await b;
 assert.deepEqual(canvas.pixels,source.pixels);assert.equal(source.reads,2);
});
test('audit: cancelRenders clears active and queued jobs and allows a fresh render',async()=>{
 const h=harness(),source=new h.Canvas();
 const jobs=Array.from({length:5},()=>h.api.render(source).catch(e=>e.name));
 h.api.cancelRenders();assert.deepEqual(await Promise.all(jobs),Array(5).fill('AbortError'));
 assert.equal(h.workers.length,2);assert.ok(h.workers.every(w=>w.terminated));
 const fresh=h.api.render(source);assert.equal(h.workers.length,3);h.workers[2].finish();await fresh;
});
test('audit: render settings are snapshotted before a queued job starts',async()=>{
 const h=harness(),source=new h.Canvas(),settings={exposure:12,spots:[{x:.2,y:.3,r:.02}]};
 const first=h.api.render(source),second=h.api.render(source),third=h.api.render(source,settings);
 settings.exposure=90;settings.spots[0].x=.9;h.workers[0].finish();await first;await Promise.resolve();
 assert.equal(h.workers[2].input.settings.exposure,12);assert.equal(h.workers[2].input.settings.spots[0].x,.2);
 h.workers[1].finish();h.workers[2].finish();await Promise.all([second,third]);
});
test('audit: worker errors release capacity and surface to caller',async()=>{
 const h=harness(),source=new h.Canvas(),first=h.api.render(source).catch(e=>e.message),second=h.api.render(source),third=h.api.render(source);
 h.workers[0].onerror({message:'deliberate test failure'});assert.match(await first,/deliberate test failure/);await Promise.resolve();
 assert.equal(h.workers.length,3);assert.equal(h.workers[0].terminated,true);
 h.workers[1].finish();h.workers[2].finish();await Promise.all([second,third]);
});
test('audit: already-aborted and oversized canvases do not create workers',async()=>{
 const h=harness(),c=new AbortController();c.abort();
 await assert.rejects(h.api.render(new h.Canvas(),{},null,{signal:c.signal}),{name:'AbortError'});
 await assert.rejects(h.api.render({width:4097,height:4097}),/尺寸/);assert.equal(h.workers.length,0);
});
