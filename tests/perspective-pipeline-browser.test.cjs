'use strict';
// Scheduling/Canvas doubles around real pixel-worker VM code. Not a real browser.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../src/perspective.cjs'),G=require('../src/geometry.cjs'),S=require('../src/straighten.cjs'),Padding=require('../src/canvas-padding.cjs');
const recipe=()=>({version:1,quad:[{x:.1,y:.2},{x:.7,y:.1},{x:.8,y:.7},{x:.2,y:.8}],outputFraction:{width:.8,height:.7}});
function harness({core=true}={}){
 const workers=[];let creates=0;
 class Canvas{constructor(width=31,height=23){this.width=width;this.height=height;this.reads=0;}getContext(){return{getImageData:()=>{this.reads++;return{width:this.width,height:this.height,data:Uint8ClampedArray.from({length:this.width*this.height*4},(_,i)=>i%4===3?255:i%251)};},putImageData:im=>{this.pixels=im.data.slice();}};}}
 class Worker{constructor(){workers.push(this);}postMessage(input){this.input=structuredClone(input);}terminate(){this.terminated=true;}finish(damage){
  let result;const i=this.input,w=vm.createContext({width:i.width,height:i.height,raw:Array.from(new Uint8ClampedArray(i.buffer)),json:JSON.stringify(i.settings),facts:JSON.stringify(i.analysis),retained:i.retainedBytes,self:{postMessage:r=>result=r}});
  w.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),w);};
  vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),w);
  vm.runInContext('self.onmessage({data:{width,height,buffer:Uint8ClampedArray.from(raw).buffer,settings:JSON.parse(json),analysis:JSON.parse(facts),retainedBytes:retained}})',w);
  const host=structuredClone(result);damage?.(host);const data=local({...host,buffer:undefined});if(host.buffer)data.buffer=host.buffer;this.onmessage({data});
 }}
 const c=vm.createContext({URL,console,DOMException,structuredClone,queueMicrotask,AbortController,setTimeout,Worker,Blob,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},document:{createElement:()=>{creates++;return new Canvas();}}});
 for(const name of ['geometry','straighten','canvas-padding','sharpness',...(core?['perspective']:[])])vm.runInContext(fs.readFileSync(require.resolve('../src/'+name+'.cjs'),'utf8'),c);
 const source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
 vm.runInContext(source+'\nglobalThis.api={render,preflightRender,cancelRenders,lightBalanceInputSettings,DEFAULT_SETTINGS};',c);
 function local(value){c.json=JSON.stringify(value);return vm.runInContext('JSON.parse(json)',c);}
 return{api:c.api,Canvas,workers,c,local,creates:()=>creates};
}
test('preflight is metadata-only and freezes exact post-straighten/pre-padding receipt',async()=>{
 const h=harness(),canvas=new h.Canvas(),s=h.local({framing:{...G.defaults(),quarterTurns:1},straighten:{version:1,angle:13,mode:'expand'},perspective:recipe(),canvasPadding:{...Padding.defaults(),left:.2}}),plan=h.api.preflightRender(canvas,s),receipt=plan.perspectiveMetadata.perspectiveReceipt;
 assert.equal(canvas.reads,0);assert.equal(h.workers.length,0);assert.equal(h.creates(),0);assert.ok(Object.isFrozen(receipt)&&Object.isFrozen(receipt.recipe));
 const up=S.plan(23,31,JSON.parse(JSON.stringify(s.straighten))).outputSize,pp=P.plan(up.width,up.height,recipe()),final=Padding.plan(pp.renderedSize.width,pp.renderedSize.height,JSON.parse(JSON.stringify(s.canvasPadding))).outputSize;
 assert.deepEqual([receipt.inputWidth,receipt.inputHeight,receipt.outputWidth,receipt.outputHeight],[up.width,up.height,pp.outputSize.width,pp.outputSize.height]);assert.deepEqual([plan.expectedSize.width,plan.expectedSize.height],[final.width,final.height]);
 const pending=h.api.render(canvas,s);s.perspective.quad[0].x=.4;h.workers[0].finish();const out=await pending;assert.equal(out.perspectiveReceipt.recipe.quad[0].x,.1);assert.ok(Object.isFrozen(out.perspectiveReceipt));assert.equal(Object.getOwnPropertyDescriptor(out,'perspectiveReceipt').writable,false);
});
test('neutral recipe does not plan or add metadata and leaves legacy Canvas shape unchanged',async()=>{
 const h=harness();vm.runInContext(`const realPerspective=MintPerspective;globalThis.MintPerspective={...realPerspective,plan(){throw Error('neutral must not plan')}}`,h.c);
 for(const perspective of [null,P.defaults()]){const s=h.local({perspective}),p=h.api.preflightRender(new h.Canvas(),s);assert.equal(p.perspectiveMetadata,null);assert.equal(p.managedGeometryBytes,null);const pending=h.api.render(new h.Canvas(),s);h.workers.at(-1).finish();assert.equal(Object.hasOwn(await pending,'perspectiveReceipt'),false);}
});
test('all receipt recipe, kind, dimensions and presence mismatches reject before output Canvas',async()=>{
 const attacks=[r=>delete r.perspectiveReceipt,r=>r.perspectiveReceipt=null,r=>r.perspectiveReceipt.recipe.quad[0].x=.15,r=>r.perspectiveReceipt.recipe.outputFraction.width=.79,r=>r.perspectiveReceipt.kind='copy',r=>r.perspectiveReceipt.resampling='none',r=>r.perspectiveReceipt.inputWidth++,r=>r.perspectiveReceipt.inputHeight++,r=>r.perspectiveReceipt.outputWidth++,r=>r.perspectiveReceipt.outputHeight++,r=>r.perspectiveReceipt.extra=true,r=>r.perspectiveReceipt.recipe.extra=true,r=>delete r.perspectiveReceipt.version];
 for(const attack of attacks){const h=harness(),pending=h.api.render(new h.Canvas(),h.local({perspective:recipe()}));h.workers[0].finish(attack);await assert.rejects(pending,/透视|Perspective/);assert.equal(h.creates(),0);}
});
test('inactive or exact neutral rejects extra perspective receipts including null',async()=>{
 for(const perspective of [null,P.defaults()])for(const receipt of [null,{version:1}]){const h=harness(),pending=h.api.render(new h.Canvas(),h.local({perspective}));h.workers[0].finish(r=>r.perspectiveReceipt=receipt);await assert.rejects(pending,/透视/);assert.equal(h.creates(),0);}
});
test('active perspective serializes with both comparisons and other geometry jobs',async()=>{
 const h=harness(),canvas=new h.Canvas(),a=h.api.render(canvas),b=h.api.render(canvas),c=h.api.render(canvas,h.local({perspective:recipe()})),d=h.api.render(canvas,h.local({straighten:{version:1,angle:90,mode:'expand'}})),e=h.api.render(canvas);
 assert.equal(h.workers.length,2);h.workers[0].finish();await a;await Promise.resolve();assert.equal(h.workers.length,2);h.workers[1].finish();await b;await Promise.resolve();assert.equal(h.workers.length,3);h.workers[2].finish();await c;await Promise.resolve();assert.equal(h.workers.length,4);h.workers[3].finish();await d;await Promise.resolve();assert.equal(h.workers.length,5);h.workers[4].finish();await e;
});
test('queued cancellation reads nothing; late cancelled/error results cannot replace newer output',async()=>{
 const h=harness(),canvas=new h.Canvas(),a=h.api.render(canvas,h.local({perspective:recipe()})),controller=new AbortController(),queued=h.api.render(canvas,h.local({perspective:recipe()}),null,{signal:controller.signal}).catch(e=>e.name);controller.abort();assert.equal(await queued,'AbortError');assert.equal(canvas.reads,1);h.workers[0].finish();await a;
 const abort=new AbortController(),b=h.api.render(canvas,h.local({perspective:recipe()}),null,{signal:abort.signal}).catch(e=>e.name);abort.abort();assert.equal(await b,'AbortError');const newer=h.api.render(canvas);h.workers[1].finish(r=>r.error='old failure');h.workers[2].finish();assert.equal(Object.hasOwn(await newer,'perspectiveReceipt'),false);assert.equal(h.creates(),2);
});
test('source-view/manual/WB diagnostics omit perspective without modifying accepted settings',async()=>{
 const h=harness({core:false}),canvas=new h.Canvas(),s=h.local({perspective:recipe(),exposure:9}),before=JSON.stringify(s);await assert.rejects(h.api.render(canvas,s),/透视组件/);
 for(const options of [{sourceView:true},{manualEditing:true}]){const pending=h.api.render(canvas,s,null,options);assert.equal(h.workers.at(-1).input.settings.perspective,null);h.workers.at(-1).finish();await pending;}
 assert.equal(h.api.lightBalanceInputSettings(s).perspective,null);assert.equal(h.api.lightBalanceInputSettings(s).exposure,9);assert.equal(JSON.stringify(s),before);
});
test('strict undefined/accessor/bad geometry reject before reads, workers or output allocations',async()=>{
 const h=harness();let reads=0;const cases=[h.local({perspective:{...recipe(),quad:[...recipe().quad].reverse()}}),h.local({perspective:{...recipe(),outputFraction:{width:0,height:1}}})];
 const undef=h.local({});undef.perspective=undefined;cases.push(undef);const accessor=h.local({});Object.defineProperty(accessor,'perspective',{enumerable:true,get(){reads++;return h.local(recipe());}});cases.push(accessor);
 for(const s of cases){const canvas=new h.Canvas();await assert.rejects(h.api.render(canvas,s));assert.equal(canvas.reads,0);}assert.equal(reads,0);assert.equal(h.workers.length,0);assert.equal(h.creates(),0);
});
test('full preview source, upstream straighten and cumulative mip/retained limits precede small output',async()=>{
 const h=harness(),tiny={...P.defaults(),outputFraction:{width:Number.MIN_VALUE,height:Number.MIN_VALUE}};
 for(const [w,ht,s,opts]of [[4001,4000,{perspective:tiny},{}],[4000,4000,{straighten:{version:1,angle:45,mode:'expand'},perspective:tiny},{}],[31,23,{perspective:recipe()},{retainedBytes:512*1024*1024}],[31,23,{perspective:recipe()},{retainedBytes:-1}]]){
  const canvas=new h.Canvas(w,ht);await assert.rejects(h.api.render(canvas,h.local(s),null,opts));assert.equal(canvas.reads,0);
 }assert.equal(h.workers.length,0);assert.equal(h.creates(),0);
 const r={...P.defaults(),outputFraction:{width:.25,height:.25}},pp=P.plan(320,240,r),p=h.api.preflightRender({width:320,height:240},h.local({perspective:r}),null,{retainedBytes:101});
 assert.equal(p.managedGeometryBytes,320*240*12+pp.estimates.extraBytes+80*60*12+101);
});

test('preview enforces core work cap before readback and worker construction',async()=>{
 const h=harness(),canvas=new h.Canvas(3000,3000),perspective={version:1,quad:[{x:0,y:0},{x:1,y:0},{x:.6,y:1},{x:.4,y:1}],outputFraction:{width:1,height:1}};
 await assert.rejects(h.api.render(canvas,h.local({perspective})),/work budget/);assert.equal(canvas.reads,0);assert.equal(h.workers.length,0);assert.equal(h.creates(),0);
});

test('oversized narrow original preview cannot hide behind crop before worker/readback',async()=>{
 const h=harness(),canvas=new h.Canvas(16385,1),s=h.local({framing:{...G.defaults(),crop:{x:0,y:0,w:.25,h:1}},perspective:recipe()});
 await assert.rejects(h.api.render(canvas,s),/16384/);assert.equal(canvas.reads,0);assert.equal(h.workers.length,0);
});
