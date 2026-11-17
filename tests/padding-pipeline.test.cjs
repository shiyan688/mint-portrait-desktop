'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const sharp = require('sharp');
const Padding = require('../src/canvas-padding.cjs');
const Geometry = require('../src/geometry.cjs');
const Levels = require('../src/levels.cjs');
const Manual = require('../src/manual-pipeline.cjs');
const P = require('../src/project-document.cjs');
const Core = require('../export-render-core.cjs');
const {createExportRenderer} = require('../export-renderer.cjs');
const rev = 'padding-source:1';
const analysis = {landmarks:[],sourceRevision:rev};
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const settings = extra => ({...structuredClone(P.DEFAULT_SETTINGS),...extra});
const recipe = extra => ({...Padding.defaults(),top:.3,right:.2,bottom:.1,left:.4,color:'#129bdf',opacity:.6,...extra});
const frame = {version:1,crop:{x:.1,y:.2,w:.7,h:.6},quarterTurns:1,flipX:true,flipY:false};
function picture(width=41,height=29,alpha=false) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([(x*7+y*3)%256,(x*11+y*5)%256,(x*13+y*17)%256,alpha?[0,1,64,128,254,255][(x+y)%6]:255],(y*width+x)*4);
  return {width,height,data};
}
const png = im => sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).png().toBuffer();
const request = (bytes,s,extra={}) => ({requestId:'padding-export',bytes:new Uint8Array(bytes),sourceRevision:rev,settings:s,analysis,mode:'original',format:'png',quality:.95,...extra});
async function exported(r) {const service=createExportRenderer();try{return await service.render(r);}finally{service.dispose();}}
function workerContext() {
  let result;
  const c=vm.createContext({self:{postMessage:r=>result=r}});
  c.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),c);};
  vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),c);
  return {c,result:()=>result};
}
function worker(im,s,a=analysis) {
  const h=workerContext(); h.c.inputJSON=JSON.stringify({width:im.width,height:im.height,data:Array.from(im.data),settings:s,analysis:{...a,mask:a.mask?{...a.mask,data:Array.from(a.mask.data)}:undefined}});
  vm.runInContext('const i=JSON.parse(inputJSON);i.buffer=Uint8ClampedArray.from(i.data).buffer;delete i.data;if(i.analysis.mask)i.analysis.mask.data=Float32Array.from(i.analysis.mask.data);self.onmessage({data:i});',h.c);
  const result=h.result(); if(result.error)throw new Error(result.error);
  return {width:result.width,height:result.height,data:new Uint8ClampedArray(result.buffer)};
}
function sanitize(im) {const out={width:im.width,height:im.height,data:im.data.slice()};for(let i=0;i<out.data.length;i+=4)if(out.data[i+3]===0)out.data[i]=out.data[i+1]=out.data[i+2]=0;return out;}
async function decodeSource(bytes,plan) {
  let image=sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha();
  if(plan?.scaled)image=image.resize(plan.processingWidth,plan.processingHeight,{fit:'fill',kernel:'lanczos3'});
  const {data,info}=await image.raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
  return {width:info.width,height:info.height,data:new Uint8ClampedArray(data)};
}
test('neutral/null and quantized-zero padding are byte identities in worker/native, including hidden RGB', () => {
  const im=picture(11,7,true),before=im.data.slice();
  for(const canvasPadding of [null,Padding.defaults(),recipe({top:.01,right:.01,bottom:.01,left:.01})]) {
    const s=settings({canvasPadding}); assert.deepEqual(Core.processPixels(im,s,analysis),im); assert.deepEqual(worker(im,s),im);
    assert.equal(Core.sizePlan(im.width,im.height,'original',s).padded,false);
  }
  assert.deepEqual(im.data,before);
});
for(const opacity of [0,.001,.5,1]) test(`asymmetric padding opacity ${opacity} matches pure core exactly and preserves source placement`, () => {
  const im=picture(11,5,true),before=im.data.slice(),r=recipe({top:.5,right:.25,bottom:.1,left:.4,opacity}),s=settings({canvasPadding:r}),expected=Padding.apply(im,r);
  assert.deepEqual([expected.width,expected.height],[14,9]);
  assert.deepEqual(Core.processPixels(im,s,analysis),expected); assert.deepEqual(worker(im,s),expected); assert.deepEqual(im.data,before);
  const plan=Padding.plan(im.width,im.height,r);
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)assert.deepEqual(expected.data.slice(((y+plan.padding.top)*expected.width+x+plan.padding.left)*4,((y+plan.padding.top)*expected.width+x+plan.padding.left)*4+4),im.data.slice((y*im.width+x)*4,(y*im.width+x)*4+4));
});
test('padding follows levels, source-coordinate local/manual edits, and final crop/turn/flip without accumulating', () => {
  const im=picture(137,103),before=im.data.slice(),levels=Levels.defaults();levels.channels.rgb.gamma=1.4;
  const selection={version:1,sourceRevision:rev,base:'all',inverted:false,feather:0,commands:[]};
  const s=settings({exposure:7,levels,framing:frame,canvasPadding:recipe(),localLayers:[{id:'local',name:'local',enabled:true,opacity:.4,sourceRevision:rev,adjustments:{exposure:10,contrast:0,saturation:0,temperature:0},mask:{kind:'selection',selection}}],manualLiquify:[{kind:'push',sourceRevision:rev,radius:.12,strength:.4,points:[{x:.35,y:.5},{x:.39,y:.5}],selection}],manualRepair:[{version:1,type:'repair-stroke',mode:'clone',sourceRevision:rev,radius:.02,hardness:.4,strength:.6,points:[{x:.63,y:.62}],source:{x:.25,y:.3},sampleMode:'manual',selection}]});
  const upstream=Core.processPixels(im,{...s,framing:null,canvasPadding:null},analysis),framed=Geometry.apply({width:upstream.width,height:upstream.height,data:upstream.data},frame),expected=Padding.apply(framed,s.canvasPadding),saved=structuredClone(s);
  assert.deepEqual(Core.processPixels(im,s,analysis),expected); assert.deepEqual(worker(im,s),expected); assert.deepEqual(Core.processPixels(im,s,analysis),expected); assert.notDeepEqual(upstream.data,im.data); assert.deepEqual(im.data,before); assert.deepEqual(s,saved);
});
test('padding strips transient liquify diagnostics even when framing is disabled', () => {
  const im=picture(137,103),s=settings({canvasPadding:recipe(),manualLiquify:[{kind:'push',sourceRevision:rev,radius:.12,strength:.4,points:[{x:.35,y:.5},{x:.39,y:.5}],selection:null}]});
  const upstream=Manual.apply(im,s,analysis); assert.ok(Object.hasOwn(upstream,'diagnostics'));
  const expected=Padding.apply({width:upstream.width,height:upstream.height,data:upstream.data},s.canvasPadding);
  assert.deepEqual(Core.processPixels(im,s,analysis),expected);assert.deepEqual(worker(im,s),expected);
});
test('learned masks remain pre-framing processing size, while final expansion never changes analysis bytes or revision', async () => {
  const im=picture(),bytes=await png(im),mask={width:im.width,height:im.height,data:Float32Array.from({length:im.width*im.height},(_,i)=>(i%41)/40),maxValue:1,learnedMatteId:'matte-fixed',space:'working-pixels'},a={...analysis,mask,learnedMatte:{cacheId:'matte-fixed',sourceRevision:rev,originalSize:{width:im.width,height:im.height},provenance:{kind:'model',task:'matting',modelId:'synthetic-fixture',weightsSha256:'a'.repeat(64)}}},s=settings({bgMode:'transparent',learnedMatteId:'matte-fixed',framing:frame,canvasPadding:recipe()}),before=mask.data.slice();
  const valid=Core.validateRequest(request(bytes,s,{analysis:a})); assert.deepEqual([valid.plan.processingWidth,valid.plan.processingHeight],[im.width,im.height]);assert.equal(valid.analysis.mask.width,im.width);
  const upstream=Core.processPixels(im,{...s,canvasPadding:null},a),expected=Padding.apply(upstream,s.canvasPadding);
  assert.deepEqual(Core.processPixels(im,s,a),expected);assert.deepEqual(worker(im,s,a),expected);assert.deepEqual(mask.data,before);assert.equal(a.learnedMatte.sourceRevision,rev);
  const wrong={...a,mask:{...mask,width:expected.width,height:expected.height,data:new Float32Array(expected.width*expected.height)}};
  assert.throws(()=>Core.validateRequest(request(bytes,s,{analysis:wrong})),/蒙版/);
});
test('source budgets and expensive-effect limits are enforced before any framing/padding escape', () => {
  const tiny={...frame,crop:{x:0,y:0,w:.001,h:.001}},s=settings({framing:tiny,canvasPadding:recipe()});
  for(const mode of ['original','working']) {assert.throws(()=>Core.sizePlan(8001,8000,mode,s),/6400/);assert.throws(()=>Core.sizePlan(16385,1,mode,s),/16384/);}
  assert.throws(()=>Core.sizePlan(6000,4000,'original',{...s,spots:[{x:.5,y:.5,r:.01}]}),/1600/);
});
test('native padded output obeys tighter desktop 64,000,000 and 16384 ceilings, never shared-core 64 Mi ceiling', () => {
  const r=recipe({top:.5,right:.5,bottom:.5,left:.5});
  const exact=Core.sizePlan(4000,4000,'original',settings({canvasPadding:r}));assert.deepEqual([exact.width,exact.height],[8000,8000]);assert.equal(exact.padded,true);assert.equal(exact.scaled,false);
  const pixelEdge=recipe({top:1/16000,right:0,bottom:0,left:0});assert.equal(Padding.plan(8000,8000,pixelEdge).outputSize.height,8001);
  assert.throws(()=>Core.sizePlan(8000,8000,'original',settings({canvasPadding:pixelEdge})),/budget/);
  assert.throws(()=>Core.sizePlan(16384,1,'original',settings({canvasPadding:recipe({top:0,right:.5,bottom:0,left:0})})),/range/);
});
test('working source size is fixed before padding and never shrunk to make a border fit', () => {
  const r=recipe({top:.5,right:.5,bottom:.5,left:.5}),s=settings({canvasPadding:r}),p=Core.sizePlan(8000,8000,'working',s);
  assert.deepEqual([p.processingWidth,p.processingHeight],[4000,4000]);assert.deepEqual([p.width,p.height],[8000,8000]);assert.equal(p.scaled,true);
  const plain=Core.sizePlan(6000,4000,'working',settings()),padded=Core.sizePlan(6000,4000,'working',s);
  assert.deepEqual([padded.processingWidth,padded.processingHeight],[plain.processingWidth,plain.processingHeight]);assert.equal(padded.processingWidth,4096);
  const cropped=Core.sizePlan(6000,4000,'working',{...s,framing:frame});assert.deepEqual([cropped.processingWidth,cropped.processingHeight],[plain.processingWidth,plain.processingHeight]);
});
test('worker accepts a 1280-pixel preview source then expands it without hidden downsampling', () => {
  const im=picture(1280,7,true),s=settings({canvasPadding:recipe()}),expected=Padding.apply(im,s.canvasPadding);
  assert.deepEqual(worker(im,s),expected);assert.ok(expected.width>1280);
});
test('worker preflight rejects final pixel/edge budget before effects and cannot crop away an invalid source', () => {
  for(const input of [
    {width:4000,height:4000,canvasPadding:recipe({top:.02,right:.02,bottom:.02,left:.02}),framing:null,expected:/budget/},
    {width:16384,height:1,canvasPadding:recipe({top:0,right:.5,bottom:0,left:0}),framing:null,expected:/range/},
    {width:5000,height:4000,canvasPadding:recipe(),framing:{...frame,crop:{x:0,y:0,w:.001,h:.001}},expected:/无效/}
  ]) {
    const h=workerContext();h.c.inputJSON=JSON.stringify(input);
    vm.runInContext('const i=JSON.parse(inputJSON);self.onmessage({data:{width:i.width,height:i.height,buffer:{byteLength:i.width*i.height*4},settings:{canvasPadding:i.canvasPadding,framing:i.framing},analysis:{landmarks:[]}}});',h.c);
    assert.match(h.result().error,input.expected);
  }
});
for(const opacity of [0,.5,1])test(`actual PNG padding opacity ${opacity} matches pure expected pixels, sanitized only at export`,async()=>{
  const im=picture(37,23,true),bytes=await png(im),before=hash(bytes),s=settings({framing:frame,canvasPadding:recipe({opacity})}),decoded=await decodeSource(bytes),expected=sanitize(Padding.apply(Geometry.apply(decoded,frame),s.canvasPadding)),result=await exported(request(bytes,s)),actual=await sharp(result.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual(actual.data,Buffer.from(expected.data));assert.deepEqual([actual.info.width,actual.info.height],[expected.width,expected.height]);assert.equal(result.padded,true);assert.equal(result.scaled,false);assert.equal(result.details.resampling,'none');assert.deepEqual([result.processingWidth,result.processingHeight],[37,23]);assert.equal(hash(bytes),before);assert.deepEqual(im.data,picture(37,23,true).data);
});
test('actual JPEG exactly matches encoding of pure padded pixels with explicit white alpha flattening',async()=>{
  const im=picture(53,41,true),bytes=await png(im),before=hash(bytes),s=settings({framing:frame,canvasPadding:recipe({opacity:.5})}),decoded=await decodeSource(bytes),expected=sanitize(Padding.apply(Geometry.apply(decoded,frame),s.canvasPadding));
  const expectedBytes=await sharp(Buffer.from(expected.data),{raw:{width:expected.width,height:expected.height,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
  const result=await exported(request(bytes,s,{format:'jpeg'}));assert.deepEqual(Buffer.from(result.bytes),expectedBytes);assert.equal((await sharp(result.bytes).metadata()).hasAlpha,false);assert.equal(result.scaled,false);assert.equal(hash(bytes),before);
});
test('actual working export resizes only processing source once, then frames and pads without final upscale/crop',async()=>{
  const im=picture(5000,11),bytes=await png(im),before=hash(bytes),s=settings({framing:frame,canvasPadding:recipe()}),plan=Core.sizePlan(im.width,im.height,'working',s),decoded=await decodeSource(bytes,plan),expected=Padding.apply(Geometry.apply(decoded,frame),s.canvasPadding),out=await exported(request(bytes,s,{mode:'working'}));
  assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(),Buffer.from(expected.data));assert.equal(out.processingWidth,4096);assert.equal(out.processingHeight,9);assert.deepEqual([out.width,out.height],[expected.width,expected.height]);assert.equal(out.scaled,true);assert.match(out.details.resampling,/explicit-working-size/);assert.equal(hash(bytes),before);
});
test('actual EXIF source is oriented exactly once before framing and padding',async()=>{
  const im=picture(15,9),bytes=new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:15,height:9,channels:4}}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer()),before=hash(bytes),s=settings({framing:frame,canvasPadding:recipe()}),decoded=await decodeSource(bytes),expected=Padding.apply(Geometry.apply(decoded,frame),s.canvasPadding),out=await exported(request(bytes,s));
  assert.deepEqual([out.originalWidth,out.originalHeight],[9,15]);assert.deepEqual(await sharp(out.bytes).raw().toBuffer(),Buffer.from(expected.data));assert.equal((await sharp(out.bytes).metadata()).orientation,undefined);assert.equal(hash(bytes),before);
});
test('actual neutral null/default exports are byte-identical, not just dimension-identical',async()=>{
  const bytes=await png(picture(19,13,true)),base=await exported(request(bytes,settings())),identity=await exported(request(bytes,settings({canvasPadding:Padding.defaults()})));
  assert.deepEqual(base.bytes,identity.bytes);assert.equal(base.padded,false);assert.equal(identity.padded,false);
});
test('native request snapshot owns padding values and rejects mismatched padded worker metadata',async()=>{
  const bytes=await png(picture(11,7)),r=request(bytes,settings({canvasPadding:recipe()})),valid=Core.validateRequest(r);r.settings.canvasPadding.left=.5;assert.equal(valid.settings.canvasPadding.left,.4);
  class WrongMetadata extends EventEmitter {constructor(_path,options){super();queueMicrotask(()=>this.emit('message',{ok:true,bytes:new Uint8Array(bytes),...options.workerData.plan,padded:false}));}terminate(){return Promise.resolve(0);}}
  const service=createExportRenderer({WorkerClass:WrongMetadata});try{await assert.rejects(service.render(request(bytes,settings({canvasPadding:recipe()}))),/padded/);}finally{service.dispose();}
});
