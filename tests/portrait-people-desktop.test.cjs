'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const P = require('../src/portrait-people.cjs');
const D = require('../src/portrait-people-desktop.cjs');
const E = require('../src/portrait-engine.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const ctx = { sourceRevision: 'desktop-source-1', batchId: 'desktop-batch-1' };
const copy = v => JSON.parse(JSON.stringify(v));
const error = (fn, code) => assert.throws(fn, e => code ? e.code === code : typeof e.code === 'string');
const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
function mesh(cx, cy, fw = .10, fh = .22) {
  const p = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  OVAL.forEach((id, i) => { const a = i * Math.PI * 2 / OVAL.length; p[id] = { x: cx + fw / 2 * Math.sin(a), y: cy - fh / 2 * Math.cos(a), z: 0 }; });
  const ellipse = (ids, x, y, rx, ry) => ids.forEach((id, i) => { const a = i * Math.PI * 2 / ids.length; p[id] = { x: cx + fw * (x + rx * Math.cos(a)), y: cy + fh * (y + ry * Math.sin(a)), z: 0 }; });
  ellipse([33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246], -.2, -.13, .1, .04);
  ellipse([263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466], .2, -.13, .1, .04);
  ellipse([61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185], 0, .2, .17, .045);
  ellipse([70,63,105,66,107,55,65,52,53,46], -.2, -.21, .12, .02);
  ellipse([336,296,334,293,300,276,283,282,295,285], .2, -.21, .12, .02);
  return p;
}
function batch(n = 2) {
  const places = n <= 2 ? [[.24,.5],[.76,.5]] : [[.15,.25],[.5,.25],[.85,.25],[.28,.75],[.72,.75]];
  return P.createBatch({ ...ctx, detector: { ...P.DEFAULT_DETECTOR }, detectionSize: { width: 480, height: 320 }, landmarks: places.slice(0,n).map(p => mesh(...p)) });
}
function configured(n, phase) {
  const b = batch(n);
  b.faces.forEach((f,i) => { if (phase === 'beauty') Object.assign(f.beauty, { smooth: 15+i*3, brighten: 12+i*4, warmth: i%2?-10:10, underEye: 10, redness: 5, lip: 15, blush: 8, palette: ['natural','peach','rose'][i%3] }); else Object.assign(f.reshape, { slim: 10+i*3, eyes: 20+i*4, nose: i%2?-15:15, jaw: i%2?-8:8 }); });
  return b;
}
function image(w = 480, h = 320, transparent = false) {
  const data = new Uint8ClampedArray(w*h*4);
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) { const i=(y*w+x)*4; data[i]=145+(x*7+y*11)%60; data[i+1]=100+(x*11+y*7)%35; data[i+2]=70+(x*3+y*5)%30; data[i+3]=transparent?(x%37===0?0:(y%31===0?128:255)):255; }
  return { width:w, height:h, data };
}
function changed(a,b) { let n=0; for(let i=0;i<a.length;i+=4) if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3]) n++; return n; }
function apply(im,b,phase,options=ctx) { return D[phase==='beauty'?'applyBeauty':'applyReshape'](im,b,options); }
function independent(im,b,phase) {
  const expected=im.data.slice(), counts=[];
  for(const f of b.faces) {
    const out=E[phase](im,f[phase],f.landmarks); let n=0;
    for(let i=0;i<out.data.length;i+=4) if(out.data[i]!==im.data[i]||out.data[i+1]!==im.data[i+1]||out.data[i+2]!==im.data[i+2]||out.data[i+3]!==im.data[i+3]) {
      assert.deepEqual(expected.subarray(i,i+4),im.data.subarray(i,i+4),'independent deltas must be disjoint'); expected.set(out.data.subarray(i,i+4),i); n++;
    }
    counts.push(n);
  }
  return { expected, counts };
}
function assertProtected(im,out,plan) {
  for(const f of plan.faces.filter(f=>!f.active)) { const r=f.protectedBounds; for(let y=r.minY;y<=r.maxY;y++) for(let x=r.minX;x<=r.maxX;x++) { const i=(y*im.width+x)*4; assert.deepEqual(out.data.subarray(i,i+4),im.data.subarray(i,i+4)); } }
}

test('frozen shared core and calibrated engine hashes; Node and browser APIs',()=>{
  assert.equal(hash(fs.readFileSync(path.join(__dirname,'../src/portrait-people.cjs'))),'0de2c158f3a23c6e4de8326e7474ad809e02d41ccc2931a5ccfba76505a02b3a');
  assert.equal(hash(fs.readFileSync(path.join(__dirname,'../src/portrait-engine.cjs'))),'5cde7dcd60aab1d68e1ec5fb026c6396c2f395c1597dd03113c34674ba57d524');
  const sandbox={}; for(const file of ['portrait-engine.cjs','portrait-people.cjs','portrait-people-desktop.cjs']) vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),sandbox);
  assert.equal(sandbox.MintPortraitPeopleDesktop.version,1);
  assert.equal(vm.runInNewContext("MintPortraitPeopleDesktop.applyBeauty({width:1,height:1,data:new Uint8ClampedArray([1,2,3,0])},null,{sourceRevision:'browser'}).data[2]",sandbox),3);
  assert(Object.isFrozen(D)); assert(Object.isFrozen(D.LIMITS));
});

test('nullable strict validation detaches controls/mesh, pins model and exact source',()=>{
  assert.equal(D.validate(null,ctx),null); const b=batch(),v=D.validate(b,ctx); v.faces[0].landmarks[0].x=0; v.faces[0].beauty.brighten=100; assert.notDeepEqual(v,b);
  error(()=>D.validate(undefined,ctx),'INVALID_RECORD'); error(()=>D.validate(null,{}),'MISSING_FIELD'); error(()=>D.validate(b,{sourceRevision:'wrong'}),'SOURCE_MISMATCH'); error(()=>D.validate(b,{...ctx,batchId:'wrong'}),'BATCH_MISMATCH');
  for(const mutate of [b=>b.detector.id='wrong',b=>b.detector.modelSha256='0'.repeat(64),b=>{b.detector.topology='MediaPipe468';b.faces.forEach(f=>f.landmarks=f.landmarks.slice(0,468));}]) {const b=batch();mutate(b);error(()=>D.validate(b,ctx),'MODEL_MISMATCH');}
  error(()=>D.validate(null,{...ctx,detector:{...P.DEFAULT_DETECTOR,id:'wrong'}}),'MODEL_MISMATCH');
});

test('metadata/options reject getters, hidden fields, unknowns, holes and invalid controls without evaluating accessors',()=>{
  let reads=0;
  for(const [group,key] of [['batch','sourceRevision'],['face','landmarks'],['beauty','smooth'],['point','x']]) {
    const b=batch(),obj=group==='batch'?b:group==='face'?b.faces[0]:group==='beauty'?b.faces[0].beauty:b.faces[0].landmarks[0]; Object.defineProperty(obj,key,{configurable:true,enumerable:true,get(){reads++;return 0;}});error(()=>D.validate(b,ctx),'ACCESSOR');
  }
  const mutations=[b=>Object.defineProperty(b,'sourceRevision',{enumerable:false}),b=>Object.defineProperty(b.faces[0].landmarks,'0',{enumerable:false}),b=>Object.defineProperty(b,'hidden',{value:1}),b=>b.faces[0].beauty.unknown=1,b=>b[Symbol('x')]=1,b=>delete b.faces[0].landmarks[12],b=>b.faces[0].reshape.slim=61,b=>b.faces[0].reshape.jaw=-51,b=>b.faces[0].beauty.warmth=NaN,b=>b.faces[0].landmarks[0].x=Infinity,b=>b.faces.push(copy(b.faces[0]))];
  for(const mutate of mutations){const b=batch();mutate(b);error(()=>D.validate(b,ctx));}
  const c={...ctx};Object.defineProperty(c,'shouldCancel',{enumerable:true,get(){reads++;return()=>false;}});error(()=>D.validate(null,c),'ACCESSOR');
  error(()=>D.planSize(1,1,null,{...ctx,phase:'beauty',unknown:true}),'UNKNOWN_FIELD');error(()=>D.hasEffect(null,'bad'),'PHASE');error(()=>D.applyBeauty(image(1,1),null,{...ctx,shouldCancel:1}),'INVALID_CALLBACK'); assert.equal(reads,0);
});

test('per-face mode rejects flat global effects, but not a neutral palette/region or legacy controls in null mode',()=>{
  const b=batch(),neutral={faceAdjustments:b,palette:'rose',region:{x:.5,y:.5,r:.3},manualLiquify:[]};
  assert.equal(D.validateCompatibility(neutral,ctx.sourceRevision).faces.length,2);
  for(const key of ['smooth','brighten','warmth','underEye','redness','lip','blush','slim','eyes','nose','jaw']) {error(()=>D.validateCompatibility({...neutral,[key]:1},ctx.sourceRevision),'PORTRAIT_GLOBAL_CONFLICT');error(()=>D.validateCompatibility({...neutral,[key]:'0'},ctx.sourceRevision),'RANGE');}
  assert.equal(D.validateCompatibility({faceAdjustments:null,slim:100,eyes:100,brighten:100},ctx.sourceRevision),null);
  assert.equal(D.validateCompatibility({slim:100},ctx.sourceRevision),null);
  let reads=0;const bad={...neutral};Object.defineProperty(bad,'other',{enumerable:true,get(){reads++;return 1;}});error(()=>D.validateCompatibility(bad,ctx.sourceRevision),'ACCESSOR');assert.equal(reads,0);
});

test('beauty-before-manual remains allowed; reshape rejects manual liquify and explicit transparent background',()=>{
  const b=configured(2,'beauty'); assert(D.validateCompatibility({faceAdjustments:b,manualLiquify:[{}]},ctx.sourceRevision));
  b.faces[0].reshape.eyes=20;error(()=>D.validateCompatibility({faceAdjustments:b,manualLiquify:[{}]},ctx.sourceRevision),'MANUAL_STALE_ANALYSIS');error(()=>D.validateCompatibility({faceAdjustments:b,bgMode:'transparent'},ctx.sourceRevision),'TRANSPARENT_RESHAPE');
  assert(D.validateCompatibility({faceAdjustments:b,bgMode:'blur',manualLiquify:[]},ctx.sourceRevision));
  assert(D.validateCompatibility({faceAdjustments:batch(),bgMode:'transparent'},ctx.sourceRevision));
  const commands=[];commands.length=1;error(()=>D.validateCompatibility({faceAdjustments:b,manualLiquify:commands},ctx.sourceRevision),'INVALID_ARRAY');
});

test('no-op identity preserves original object, all bytes and alpha; 64MP plan avoids portrait cap and allocation',()=>{
  for(const b of [null,batch(0),batch(2),batch(5)]) for(const phase of ['beauty','reshape']) {const im=image(100,70,true); const before=im.data.slice();assert.equal(apply(im,b,phase),im);assert.deepEqual(im.data,before);assert.equal(D.hasEffect(b,phase),false);}
  for(const b of [null,batch(2)]) for(const phase of ['beauty','reshape']) {const p=D.planSize(8000,8000,b,{...ctx,phase});assert.equal(p.noOp,true);assert.equal(p.resources.extraPeakBytes,0);assert.equal(p.resources.cumulativeTypedArrayBytes,0);assert.equal(p.resources.retainedOutputBytes,0);assert.equal(p.opaqueAlphaRequired,false);assert(Object.isFrozen(p));}
  // A >16M no-op uses an already-existing 68MB backing store, no output copy.
  const big={width:17000/2,height:2000,data:new Uint8ClampedArray(17000000*4)};big.data[0]=27;big.data[big.data.length-1]=91;assert.equal(D.applyReshape(big,batch(),ctx),big);assert.equal(big.data[0],27);assert.equal(big.data[big.data.length-1],91);
  error(()=>D.planSize(8001,8000,null,{...ctx,phase:'beauty'}),'LIMIT');error(()=>D.planSize(16385,1,null,{...ctx,phase:'beauty'}),'RANGE');error(()=>D.applyBeauty(image(1,1),batch(),{sourceRevision:'wrong'}),'SOURCE_MISMATCH');
});

test('inactive image validation still rejects wrong lengths, accessors, sharing and hidden metadata',()=>{
  const im=image(5,5);error(()=>D.applyBeauty({...im,data:new Uint8Array(1)},null,ctx),'IMAGE_DATA');let reads=0;const bad={height:5,data:im.data};Object.defineProperty(bad,'width',{enumerable:true,get(){reads++;return 5;}});error(()=>D.applyBeauty(bad,null,ctx),'ACCESSOR');
  const hidden={...im};Object.defineProperty(hidden,'width',{enumerable:false});error(()=>D.applyBeauty(hidden,null,ctx),'HIDDEN_FIELD');
  const bytes=im.data.slice();Object.defineProperty(bytes,'length',{get(){reads++;return 100;}});error(()=>D.applyBeauty({...im,data:bytes},null,ctx),'IMAGE_DATA');
  if(typeof SharedArrayBuffer==='function')error(()=>D.applyBeauty({...im,data:new Uint8Array(new SharedArrayBuffer(100))},null,ctx),'IMAGE_DATA');assert.equal(reads,0);
});

test('backing-buffer intrinsic checks never evaluate instance accessors in inactive or active phases',()=>{
  for(const active of [false,true]) for(const phase of ['beauty','reshape']) {
    const im=image(160,100),b=active?configured(2,phase):batch(),expected=apply(im,b,phase),buffer=im.data.buffer;let reads=0;
    Object.defineProperty(buffer,'resizable',{get(){reads++;throw Error('instance resizable accessor executed');}});
    Object.defineProperty(buffer,'byteLength',{get(){reads++;throw Error('instance byteLength accessor executed');}});
    const out=apply(im,b,phase);assert.equal(reads,0);assert.deepEqual(out.data,expected.data);if(!active)assert.equal(out,im);
  }
});

test('actual resizable, detached and disguised shared backing buffers fail even when properties lie',()=>{
  const canResize=typeof Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get==='function';
  for(const active of [false,true]) for(const phase of ['beauty','reshape']) {
    const b=active?configured(2,phase):batch();
    if(canResize) {const buffer=new ArrayBuffer(160*100*4,{maxByteLength:160*100*8});Object.defineProperty(buffer,'resizable',{value:false});const im={width:160,height:100,data:new Uint8ClampedArray(buffer)};error(()=>apply(im,b,phase),'IMAGE_DATA');}
    if(typeof structuredClone==='function') {const im=image(160,100);structuredClone(im.data.buffer,{transfer:[im.data.buffer]});error(()=>apply(im,b,phase),'IMAGE_DATA');}
    if(typeof SharedArrayBuffer==='function') {const buffer=new SharedArrayBuffer(160*100*4);Object.setPrototypeOf(buffer,ArrayBuffer.prototype);Object.defineProperty(buffer,'resizable',{value:false});const im={width:160,height:100,data:new Uint8ClampedArray(buffer)};error(()=>apply(im,b,phase),'IMAGE_DATA');}
  }
});

for(const n of [2,5]) for(const phase of ['beauty','reshape']) test(`${n} independent ${phase} faces match immutable-input direct deltas and array-order invariance`,()=>{
  const b=configured(n,phase),im=image(),before=im.data.slice(),prior=copy(b),r=independent(im,b,phase),out=apply(im,b,phase);assert(r.counts.every(n=>n>0));assert.deepEqual(out.data,r.expected);assert.deepEqual(im.data,before);assert.deepEqual(b,prior);b.faces.reverse();assert.deepEqual(apply(im,b,phase).data,out.data);
  const p=D.planSize(im.width,im.height,b,{...ctx,phase});assert.equal(p.noOp,false);assert.equal(p.resources.activeFaces,n);assert(p.resources.cumulativeTypedArrayBytes<=D.LIMITS.maxCumulativeTypedArrayBytes);assert(Object.isFrozen(p.faces[0].controls));
});

for(const phase of ['beauty','reshape']) test(`inactive neighbors remain byte exact and overlap fails atomically for ${phase}`,()=>{
  const b=configured(5,phase),im=image();b.faces.slice(1).forEach(f=>f[phase]=phase==='beauty'?P.defaultsBeauty():P.defaultsReshape());const p=D.planSize(im.width,im.height,b,{...ctx,phase}),out=apply(im,b,phase);assert(changed(im.data,out.data)>0);assertProtected(im,out,p);
  const before=im.data.slice();b.faces[1].landmarks=copy(b.faces[0].landmarks);error(()=>apply(im,b,phase),'FACE_OVERLAP');assert.deepEqual(im.data,before);
});

test('active beauty preserves alpha and hidden RGB; active reshape rejects any alpha below 255',()=>{
  const im=image(480,320,true),before=im.data.slice(),b=configured(2,'beauty'),out=D.applyBeauty(im,b,ctx);assert(changed(im.data,out.data)>0);for(let i=0;i<im.data.length;i+=4){assert.equal(out.data[i+3],im.data[i+3]);if(im.data[i+3]===0)assert.deepEqual(out.data.subarray(i,i+4),im.data.subarray(i,i+4));}assert.deepEqual(im.data,before);
  const shape=configured(2,'reshape');assert.equal(D.planSize(im.width,im.height,shape,{...ctx,phase:'reshape'}).opaqueAlphaRequired,true);error(()=>D.applyReshape(im,shape,ctx),'TRANSPARENT_RESHAPE');
});

test('all active budgets preflight before engine work, including cumulative typed allocation',()=>{
  const b=configured(5,'beauty');error(()=>D.planSize(4001,4000,b,{...ctx,phase:'beauty'}),'LIMIT');error(()=>D.planSize(16385,1,b,{...ctx,phase:'beauty'}),'RANGE');error(()=>D.planSize(3000,3000,b,{...ctx,phase:'beauty'}),'CUMULATIVE_MEMORY_BUDGET');
  const p=D.planSize(3000,3000,configured(5,'reshape'),{...ctx,phase:'reshape'});assert.equal(p.resources.cumulativeTypedArrayBytes,180000000);assert(p.resources.workUnits<=512000000);assert(p.resources.extraPeakBytes<=268435456);
  // Instrument the browser load with the real core and zero-call fake engine.
  const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/portrait-people.cjs'),'utf8'),sandbox);vm.runInContext('var calls=0;var PortraitEngine={beauty(){calls++;throw Error("engine ran");},reshape(){calls++;throw Error("engine ran");}};',sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/portrait-people-desktop.cjs'),'utf8'),sandbox);
  const code=`var b=${JSON.stringify(b)};var im={width:3000,height:3000,data:new Uint8ClampedArray(36000000)};try{MintPortraitPeopleDesktop.applyBeauty(im,b,{sourceRevision:'desktop-source-1'});}catch(e){var code=e.code;} var unchanged=MintPortraitPeopleDesktop.applyReshape(im,b,{sourceRevision:'desktop-source-1'})===im;`;
  vm.runInContext(code,sandbox);assert.equal(sandbox.code,'CUMULATIVE_MEMORY_BUDGET');assert.equal(sandbox.calls,0);assert.equal(sandbox.unchanged,true);
});

test('cancellation before processing, during validation scan and after engine returns no partial image',()=>{
  const im=image(),before=im.data.slice(),b=configured(5,'beauty');error(()=>D.applyBeauty(im,b,{...ctx,shouldCancel:()=>true}),'CANCELLED');
  for(const count of [2,6,10,20]) {let checks=0;error(()=>D.applyBeauty(im,b,{...ctx,shouldCancel:()=>++checks>=count}),'CANCELLED');assert.deepEqual(im.data,before);}
  error(()=>D.applyReshape(im,null,{...ctx,shouldCancel:()=>true}),'CANCELLED');error(()=>D.planSize(8000,8000,null,{...ctx,phase:'beauty',shouldCancel:()=>true}),'CANCELLED');
});

test('browser active replay matches Node bytes and catches injected out-of-support engine writes atomically',()=>{
  const im=image(160,100),b=configured(2,'beauty'),expected=D.applyBeauty(im,b,ctx),sandbox={};vm.createContext(sandbox);
  for(const file of ['portrait-engine.cjs','portrait-people.cjs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),sandbox);
  vm.runInContext(`var source={width:160,height:100,data:new Uint8ClampedArray(${JSON.stringify(Array.from(im.data))})};var batch=${JSON.stringify(b)};var trusted=PortraitEngine;var corrupt=false;PortraitEngine={beauty(...args){const out=trusted.beauty(...args);if(corrupt)out.data[0]^=1;return out;},reshape:trusted.reshape};`,sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/portrait-people-desktop.cjs'),'utf8'),sandbox);
  vm.runInContext(`var result=MintPortraitPeopleDesktop.applyBeauty(source,batch,{sourceRevision:'desktop-source-1'});var returned=false;corrupt=true;try{MintPortraitPeopleDesktop.applyBeauty(source,batch,{sourceRevision:'desktop-source-1'});returned=true;}catch(error){var errorCode=error.code;}`,sandbox);
  assert.deepEqual(Uint8ClampedArray.from(sandbox.result.data),expected.data);assert.equal(sandbox.errorCode,'SUPPORT_ESCAPE');assert.equal(sandbox.returned,false);assert.deepEqual(Uint8ClampedArray.from(sandbox.source.data),im.data);
});

test('canonical geometry binding ignores beauty and array order, but retains inactive neighbors and exact metadata',()=>{
  assert.equal(D.geometryBinding(null),null);assert.equal(D.geometryBinding(configured(2,'beauty')),null);const b=batch(2);b.faces[0].reshape.eyes=20;const binding=D.geometryBinding(b),serialized=JSON.stringify(binding);assert.equal(binding.faces.length,2);assert.equal(binding.faces[1].reshape.eyes,0);assert(!own(binding.faces[0],'beauty'));assert(Object.isFrozen(binding.faces[0].landmarks[0]));
  b.faces.reverse();b.faces[0].beauty.brighten=40;b.faces[1].beauty.palette='rose';assert.equal(JSON.stringify(D.geometryBinding(b)),serialized);
  for(const change of [b=>b.batchId='new-batch',b=>b.sourceRevision='new-source',b=>b.detectionSize.width++,b=>b.faces[0].landmarks[0].x+=.000001,b=>b.faces[0].reshape.nose=1]) {const v=copy(b);change(v);assert.notEqual(JSON.stringify(D.geometryBinding(v)),serialized);}
  function own(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
});

// Optional public-photo regression input, deliberately outside app assets. The
// pixels were visually inspected before this suite was authored. These are two
// and five separated adult NASA portrait composites, NOT real group photographs.
// Landmark files are existing fresh MediaPipe Tasks Python CPU / 478 host results,
// not Electron/Windows/browser detector or device-performance acceptance.
const qaRoot=process.env.MINT_MULTIFACE_QA_DIR||path.join(__dirname,'../quality/portrait-people-qa/inputs');
for(const n of [2,5]) for(const phase of ['beauty','reshape']) test(`public NASA composite ${n}: ${phase} actual pixels, independent oracle, inactive neighbors`,{skip:!fs.existsSync(path.join(qaRoot,`synthetic-${n}-adults-900.png`))},async t=>{
  const sharp=require('sharp'),filename=path.join(qaRoot,`synthetic-${n}-adults-900.png`),j=JSON.parse(fs.readFileSync(path.join(qaRoot,`synthetic-${n}-adults-900.landmarks.json`),'utf8'));
  const decoded=await sharp(filename).ensureAlpha().raw().toBuffer({resolveWithObject:true});const im={width:decoded.info.width,height:decoded.info.height,data:new Uint8ClampedArray(decoded.data)},before=hash(im.data);
  assert.equal(j.faces.length,n);assert(j.faces.every(f=>f.landmarks.length===478));const b=P.createBatch({...ctx,detector:j.detector,detectionSize:j.detectionSize,landmarks:j.faces.map(f=>f.landmarks)});
  b.faces.forEach((f,i)=>{if(phase==='beauty')Object.assign(f.beauty,{brighten:8+i*5,warmth:i%2?-12:12,underEye:10+i*3,lip:8+i*3,palette:['natural','peach','rose'][i%3]});else Object.assign(f.reshape,{eyes:12+i*7,nose:i%2?-18:18});});
  const r=independent(im,b,phase),out=apply(im,b,phase);assert(r.counts.every(n=>n>0));assert.deepEqual(out.data,r.expected);assert.equal(hash(im.data),before);b.faces.reverse();assert.deepEqual(apply(im,b,phase).data,out.data);
  const one=copy(b);one.faces.slice(1).forEach(f=>f[phase]=phase==='beauty'?P.defaultsBeauty():P.defaultsReshape());const p=D.planSize(im.width,im.height,one,{...ctx,phase});assertProtected(im,apply(im,one,phase),p);
  const overlap=copy(b);overlap.faces.forEach(f=>Object.assign(f.reshape,{slim:20,eyes:20,nose:10,jaw:10}));error(()=>D.planSize(im.width,im.height,overlap,{...ctx,phase:'reshape'}),'FACE_OVERLAP');
  t.diagnostic(JSON.stringify({fixture:`synthetic-${n}-adults-900.png`,hostOnly:true,phase,changedPixelsPerFace:r.counts,inputSha256:before,outputSha256:hash(out.data)}));
});
