'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const candidatePath = path.resolve(__dirname, '../src/image-overlay.cjs');
const originalPath = process.env.IMAGE_OVERLAY_FROZEN_SOURCE || path.resolve(__dirname,'fixtures/image-overlay-mobile-frozen.cjs');
const originalHash = '800751bc88f2539e51f742d57fe6287b44c2c2c8c74f958d297cf878790d579c';
const original = require(originalPath), candidate = require(candidatePath), desktop = candidate.createProfile('desktop');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const code = fs.readFileSync(candidatePath, 'utf8');
const recipe = changes => ({ ...candidate.defaults(), ...changes });
const report = { runtime: process.version, frozenOriginalSha256: originalHash, candidateSha256: hash(code), differentialCases: 0, pixelComparisons: 0, productionIntegration: false, rssClaim: false };
function image(width, height, fill = [11, 25, 94, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}
function rng(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
function randomImage(width, height, random) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = random() * 256;
  return { width, height, data };
}
function sameBytes(a, b) { const bytes = x => Buffer.from(x.buffer, x.byteOffset, x.byteLength); assert.equal(Buffer.compare(bytes(a.data), bytes(b.data)), 0); report.pixelComparisons += a.data.length / 4; }
function bad(fn, expected = 'IMAGE_OVERLAY_INVALID') { assert.throws(fn, e => e.code === expected); }
function allocationProbe() {
  const state = { ownedBytes: 0, allocations: [], views: 0, failAt: Infinity };
  const wrap = Type => new Proxy(Type, { construct(target, args) {
    const number = state.allocations.length + state.views + 1;
    if (number === state.failAt) throw new RangeError('simulated platform allocation failure');
    const value = Reflect.construct(target, args);
    if (args[0] instanceof ArrayBuffer) state.views++;
    else { state.ownedBytes += value.byteLength; state.allocations.push({ type: Type.name, bytes: value.byteLength }); }
    return value;
  } });
  const context = { Object, Array, ArrayBuffer, Uint8Array: wrap(Uint8Array), Uint8ClampedArray: wrap(Uint8ClampedArray), Float64Array: wrap(Float64Array), module: { exports: {} } };
  new Function(...Object.keys(context), code)(...Object.values(context));
  return { state, root: context.module.exports, desktop: context.module.exports.createProfile('desktop') };
}
const smallAsset = candidate.encodeAsset(image(1, 1, [31, 192, 77, 128]));

test('frozen original matches asserted source and rendering body is byte-for-byte unchanged', () => {
  const frozenCode = fs.readFileSync(originalPath, 'utf8');
  assert.equal(hash(frozenCode), originalHash);
  const body = s => s.slice(s.indexOf('  const RECIPE_KEYS'), s.indexOf('\n  return Object.freeze({ LIMITS'));
  const candidateBody = body(code).replace(/\n  function createProfile\(name\) \{[\s\S]*?\n  \}\n$/, '');
  assert.equal(candidateBody, body(frozenCode));
  assert.equal(code.match(/function apply\(/g).length, 1);
  assert.equal(code.match(/function sample\(/g).length, 1);
  assert.equal(code.match(/function prepare\(/g).length, 1);
});

test('fixed desktop selector, frozen isolated APIs and exact unchanged default/asset limits', () => {
  assert.deepEqual(candidate.LIMITS, original.LIMITS);
  const expected = { ...original.LIMITS, maxPixels: 16777216, maxEdge: 16384, maxWorkUnits: 256000000, maxExtraBytes: 128 * 1024 * 1024 };
  assert.deepEqual(desktop.LIMITS, expected);
  const a = candidate.createProfile('desktop'), b = candidate.createProfile('desktop');
  for (const api of [candidate, desktop, a, b]) {
    assert(Object.isFrozen(api)); assert(Object.isFrozen(api.LIMITS));
    assert.deepEqual(Object.keys(api).sort(), [...Object.keys(original), 'createProfile'].sort());
    assert.throws(() => { api.LIMITS.maxPixels = Number.MAX_SAFE_INTEGER; }, TypeError);
    assert.throws(() => Object.defineProperty(api.LIMITS, 'maxExtraBytes', { value: Infinity }), TypeError);
    assert.throws(() => Object.setPrototypeOf(api.LIMITS, {}), TypeError);
    assert.throws(() => { api.LIMITS = expected; }, TypeError);
  }
  for (const k of Object.keys(a)) assert.notEqual(a[k], b[k], k + ' per-profile isolation');
  a.apply.untrustedBudget = Infinity; // Function expandos cannot change closed-over budgets.
  bad(() => a.layout(16385, 1, smallAsset, recipe()), 'IMAGE_OVERLAY_LIMIT');
  assert.equal(b.apply.untrustedBudget, undefined);
  let touched = 0;
  const hostile = { get desktop() { touched++; throw Error('getter'); }, toString() { touched++; return 'desktop'; } };
  for (const name of [undefined, null, '', 'mobile', 'default', 'Desktop', 'desktop ', 1, true, {}, [], new String('desktop'), Symbol('desktop'), hostile]) bad(() => candidate.createProfile(name));
  bad(() => candidate.createProfile());
  bad(() => candidate.createProfile('desktop', { maxPixels: Infinity }));
  bad(() => candidate.createProfile('desktop', undefined));
  assert.equal(touched, 0);
  assert.deepEqual(desktop.createProfile('desktop').LIMITS, expected);
});

test('CommonJS, AMD and global profile entry points agree', () => {
  const context = vm.createContext({}); vm.runInContext(code, context);
  assert.equal(context.MintImageOverlay.LIMITS.maxPixels, 8000000);
  assert.equal(context.MintImageOverlay.createProfile('desktop').LIMITS.maxPixels, 16777216);
  let amd; const define = (_, factory) => { amd = factory(); }; define.amd = {};
  vm.runInNewContext(code, { define });
  assert.equal(amd.LIMITS.maxEdge, 4096); assert.equal(amd.createProfile('desktop').LIMITS.maxEdge, 16384);
});

test('deterministic synthetic RGBA default and desktop outputs/plans equal original at 300 shared-domain cases', () => {
  const random = rng(0x61c20e44);
  const angles = [0, 90, -90, 180, -180, 37, -147, 89.99999999999999, -179.99999999999, Number.MIN_VALUE, 1e-300];
  for (let n = 0; n < 300; n++) {
    const w = 1 + Math.floor(random() * 49), h = 1 + Math.floor(random() * 47);
    const aw = 1 + Math.floor(random() * 85), ah = 1 + Math.floor(random() * 81);
    const target = randomImage(w, h, random), assetImage = randomImage(aw, ah, random);
    if (n % 13 === 0) for (let k = 3; k < assetImage.data.length; k += 4) assetImage.data[k] = 0;
    const r = recipe({ x: n % 7 === 0 ? 0 : n % 7 === 1 ? 1 : random(), y: n % 9 === 0 ? 1 : random(), size: n % 4 === 0 ? .02 : n % 4 === 1 ? 2 : .02 + random() * 1.98, rotation: angles[n % angles.length], opacity: n % 17 === 0 ? 0 : n % 19 === 0 ? Number.MIN_VALUE : random(), flipX: n % 2 === 0, flipY: n % 3 === 0 });
    const before = hash(target.data), asset = original.encodeAsset(assetImage);
    assert.deepEqual(candidate.encodeAsset(assetImage), asset);
    assert.deepEqual(desktop.encodeAsset(assetImage), asset);
    const plan = original.layout(w, h, asset, r), output = original.apply(target, asset, r);
    for (const api of [candidate, desktop]) {
      assert.deepEqual(api.layout(w, h, asset, r), plan);
      sameBytes(api.decodeAsset(asset), assetImage);
      const result = api.apply(target, asset, r);
      sameBytes(result, output);
      assert.equal(result === target, output === target);
    }
    assert.equal(hash(target.data), before); report.differentialCases++;
  }
});

test('default threshold stays 8M/4096 while desktop admits fixed exact 16Mi-pixel and 16384-edge ceilings', () => {
  const p = candidate.layout(4000, 2000, smallAsset, recipe()); assert.equal(p.width * p.height, 8000000);
  for (const api of [original, candidate]) {
    bad(() => api.layout(4000, 2001, smallAsset, recipe()), 'IMAGE_OVERLAY_LIMIT');
    api.layout(4096, 1, smallAsset, recipe());
    bad(() => api.layout(4097, 1, smallAsset, recipe()), 'IMAGE_OVERLAY_LIMIT');
    bad(() => api.layout(4096, 4096, smallAsset, recipe()), 'IMAGE_OVERLAY_LIMIT');
  }
  for (const [w, h] of [[4096,4096],[16384,1024],[1024,16384],[8192,2048],[16384,1],[1,16384]]) {
    const plan = desktop.layout(w,h,smallAsset,recipe({size:2}));
    assert.equal(plan.width,w); assert.equal(plan.height,h);
    assert(plan.workUnits <= 256000000); assert(plan.extraBytes <= 134217728);
  }
  for (const [w,h] of [[4097,4096],[16385,1],[1,16385],[16384,1025],[16777217,1],[Number.MAX_SAFE_INTEGER,2],[2,Number.MAX_SAFE_INTEGER],[Number.MAX_SAFE_INTEGER+1,1],[Infinity,1],[NaN,1],[0,1],[-1,1],[1.1,1],['4096',1],[1,BigInt(1)]]) bad(() => desktop.layout(w,h,smallAsset,recipe({opacity:0})), 'IMAGE_OVERLAY_LIMIT');
});

test('desktop asset caps and all recipe caps are unchanged, including inactive content', () => {
  const maximum = desktop.encodeAsset(image(1024,1024,[35,98,210,127]));
  assert.equal(maximum.data.length,5592408); assert.equal(maximum.data,original.encodeAsset(desktop.decodeAsset(maximum)).data);
  for (const api of [original,candidate,desktop]) {
    for (const r of [{size:.019},{size:2.001},{x:1.0001},{y:-.0001},{rotation:180.1},{opacity:1.001}]) bad(()=>api.layout(1,1,smallAsset,recipe(r)),'IMAGE_OVERLAY_LIMIT');
    for (const a of [{...smallAsset,width:1025},{...smallAsset,height:1025},{...smallAsset,width:1024,height:1025}]) bad(()=>api.layout(1,1,a,recipe({opacity:0})),'IMAGE_OVERLAY_LIMIT');
  }
});

test('preflight rejects overflows, dimensions, hostile metadata, canonical base64 and options before any pixel allocation', () => {
  const probe = allocationProbe(), api = probe.desktop, target = image(2,2);
  let invoked = 0;
  for (const kind of ['image','asset','recipe','options']) {
    const values = { image: {...target}, asset: {...smallAsset}, recipe: recipe(), options: {shouldCancel:()=>false} };
    const field = {image:'width',asset:'data',recipe:'x',options:'shouldCancel'}[kind];
    Object.defineProperty(values[kind],field,{enumerable:true,get(){invoked++;throw Error('accessor invoked');}});
    bad(()=>api.apply(values.image,values.asset,values.recipe,values.options));
  }
  for (const kind of ['image','asset','recipe','options']) {
    const values = { image: {...target}, asset: {...smallAsset}, recipe: recipe(), options: {} };
    values[kind] = Object.assign(Object.create({ untrusted: true }),values[kind]);
    bad(()=>api.apply(values.image,values.asset,values.recipe,values.options));
  }
  for (const extra of [{path:'/tmp/user.png'},{uri:'file:///tmp/user.png'},{mime:'image/png'},{sourceRevision:1},{[Symbol('metadata')]:0}]) bad(()=>api.apply(target,{...smallAsset,...extra},recipe()));
  for (const p of [{width:16385,height:1},{width:4097,height:4096},{width:Number.MAX_SAFE_INTEGER,height:Number.MAX_SAFE_INTEGER}]) bad(()=>api.apply({...target,...p},smallAsset,recipe({opacity:0})),'IMAGE_OVERLAY_LIMIT');
  bad(()=>api.apply(target,{...smallAsset,data:'?'.repeat(smallAsset.data.length)},recipe()));
  assert.throws(()=>api.apply(target,smallAsset,recipe(),{shouldCancel:()=>true}),e=>e.code==='IMAGE_OVERLAY_CANCELLED');
  assert.equal(api.apply(target,smallAsset,recipe({opacity:0})),target);
  api.layout(4096,4096,smallAsset,recipe({size:2}));
  assert.equal(invoked,0); assert.equal(probe.state.ownedBytes,0); assert.equal(probe.state.views,0);
});

test('strict native local fixed ArrayBuffer safety remains enforced for desktop', () => {
  const typed = [[],Buffer.alloc(4),new Uint16Array(4),new Float64Array(4),new DataView(new ArrayBuffer(4)),new Proxy(new Uint8Array(4),{}),vm.runInNewContext('new Uint8Array(4)')];
  class ViewSubclass extends Uint8Array {} typed.push(new ViewSubclass(4));
  class BufferSubclass extends ArrayBuffer {} typed.push(new Uint8Array(new BufferSubclass(4)));
  typed.push(new Uint8Array(new SharedArrayBuffer(4)));
  typed.push(new Uint8Array(new ArrayBuffer(4,{maxByteLength:8})));
  const detached = new Uint8Array(4); structuredClone(detached,{transfer:[detached.buffer]}); typed.push(detached);
  for (const data of typed) bad(()=>desktop.apply({width:1,height:1,data},smallAsset,recipe()));
  const backing = new Uint8Array(12);backing.set([1,99,201,127],4);
  const offset = backing.subarray(4,8); let invoked=0;
  for(const name of ['length','byteLength','buffer','byteOffset','set','subarray']) Object.defineProperty(offset,name,{get(){invoked++;throw Error('shadow getter');}});
  const target = {width:1,height:1,data:offset};
  assert.equal(desktop.encodeAsset(target).data,'AWPJfw==');
  assert.notEqual(desktop.apply(target,smallAsset,recipe({size:1})),target);
  assert.equal(invoked,0); assert.deepEqual(Array.from(backing),[0,0,0,0,1,99,201,127,0,0,0,0]);
});

test('cancellation invocation order and failures remain equal across frozen original, default and desktop', () => {
  const target=image(128,128,[12,34,56,78]), asset=candidate.encodeAsset(image(128,128,[120,140,160,255])), r=recipe({size:.2,rotation:25});
  const before=hash(target.data), counts=[];
  for (const api of [original,candidate,desktop]) { let calls=0; api.apply(target,asset,r,{shouldCancel(){calls++;return false;}});counts.push(calls); }
  assert.equal(counts[0],counts[1]);assert.equal(counts[1],counts[2]);assert(counts[0]>20);
  for (const api of [original,candidate,desktop]) for(const stop of [1,2,3,4,5,6,Math.floor(counts[0]/4),Math.floor(counts[0]/2),Math.floor(counts[0]*.75),counts[0]-1,counts[0]]) {
    let calls=0;assert.throws(()=>api.apply(target,asset,r,{shouldCancel(){return ++calls===stop;}}),e=>e.name==='AbortError'&&e.code==='IMAGE_OVERLAY_CANCELLED');assert.equal(hash(target.data),before);
  }
  const sentinel=new Error('callback failure');
  assert.throws(()=>desktop.apply(target,asset,r,{shouldCancel(){throw sentinel;}}),e=>e===sentinel);assert.equal(hash(target.data),before);
  report.cancellationChecksPerCompletedFixture=counts[0];
});

test('managed allocation accounting matches cumulative owned output, decode and Float64 mip buffers, not RSS', () => {
  const probe=allocationProbe(), target=image(257,193,[10,20,30,255]), asset=candidate.encodeAsset(image(1024,1024,[128,40,200,127])),r=recipe({size:.02,rotation:33});
  const p=probe.desktop.layout(target.width,target.height,asset,r);
  assert.equal(probe.state.ownedBytes,0);assert.equal(probe.state.views,0);
  probe.desktop.apply(target,asset,r);
  assert(p.mipLevels>0);assert.equal(probe.state.ownedBytes,p.extraBytes-2*1024*1024);
  assert.equal(probe.state.allocations.filter(x=>x.type==='Float64Array').length,p.mipLevels);
  report.managedAccounting={planExtraBytes:p.extraBytes,ownedPixelBufferBytes:probe.state.ownedBytes,allowanceBytes:2097152,allocations:probe.state.allocations,temporaryCopyViews:probe.state.views,mipPixels:p.mipPixels,definition:'Cumulative owned typed pixel buffers plus fixed 2 MiB allowance; excludes caller input, existing asset string, external pipeline, callbacks, runtime/GC and RSS.'};
});

test('preflight work/memory checks are retained and guard pixel allocation even in isolated guard fault injection', () => {
  // Test-only fault injection lowers caps, never raises them. It establishes guard placement;
  // it is NOT a public configurable profile or evidence that real-profile maxima are attained.
  for (const kind of ['work','memory']) {
    const reduced=code.replace(kind==='work'?'maxWorkUnits: desktop ? 256000000 : 100000000':'maxExtraBytes: (desktop ? 128 : 64) * 1024 * 1024',kind==='work'?'maxWorkUnits: 1':'maxExtraBytes: 1');
    let allocations=0;
    const wrap=T=>new Proxy(T,{construct(t,args){allocations++;return Reflect.construct(t,args);}});
    const context={Object,Array,ArrayBuffer,Uint8Array:wrap(Uint8Array),Uint8ClampedArray:wrap(Uint8ClampedArray),Float64Array:wrap(Float64Array),module:{exports:{}}};
    new Function(...Object.keys(context), reduced)(...Object.values(context));
    const api=context.module.exports.createProfile('desktop');
    bad(()=>api.apply(image(2,2),smallAsset,recipe()),'IMAGE_OVERLAY_LIMIT');assert.equal(allocations,0);
  }
});

test('actual 16,777,216-pixel desktop composition equals independent integer simple oracle; default rejects; source is unchanged', () => {
  const width=4096,height=4096,data=new Uint8ClampedArray(width*height*4);
  for(let p=0,i=0;p<width*height;p++,i+=4){data[i]=(p*17+11)&255;data[i+1]=(p*31+92)&255;data[i+2]=(p*7+209)&255;data[i+3]=p%7===0?0:255;}
  const target={width,height,data},before=hash(data),r=recipe({x:.375,y:.625,size:.5,rotation:90,opacity:.5,flipX:true,flipY:true});
  const probe=allocationProbe(), plan=probe.desktop.layout(width,height,smallAsset,r);
  assert.equal(probe.state.ownedBytes,0);
  bad(()=>candidate.apply(target,smallAsset,r),'IMAGE_OVERLAY_LIMIT');
  const start=performance.now(),actual=probe.desktop.apply(target,smallAsset,r),renderMs=performance.now()-start;
  assert.notEqual(actual,target);assert.equal(hash(data),before);
  const expected=new Uint8ClampedArray(data);
  // Independent oracle for this aligned constant-color rectangle. Neither layout, rowRange,
  // sample, rotate math nor compositor code is reused. Rotation/flips preserve a square.
  // Effective source alpha is 128*0.5=64; only integer numerators are used below.
  for(let y=1536;y<3584;y++)for(let x=512;x<2560;x++){
    const i=(y*width+x)*4;
    if(data[i+3]===0){expected[i]=31;expected[i+1]=192;expected[i+2]=77;expected[i+3]=64;}
    else {expected[i]=Math.round((31*64+data[i]*191)/255);expected[i+1]=Math.round((192*64+data[i+1]*191)/255);expected[i+2]=Math.round((77*64+data[i+2]*191)/255);expected[i+3]=255;}
  }
  sameBytes(actual,{data:expected});
  assert.equal(probe.state.ownedBytes,plan.extraBytes-2097152);assert.equal(plan.extraBytes,69206020);
  report.largeOracle={width,height,pixels:width*height,sourceSha256:before,resultSha256:hash(actual.data),oracleSha256:hash(expected),byteExact:true,sourceUnchanged:true,recipe:r,plan:JSON.parse(JSON.stringify(plan)),ownedPixelBufferBytes:probe.state.ownedBytes,copyViewCount:probe.state.views,renderMs:Math.round(renderMs*100)/100,oracle:'Aligned 2048x2048 constant RGBA rectangle at x=512..2559,y=1536..3583, independent integer source-over over deterministic opaque/transparent target.'};
  // A second full-frame case exercises >100M work units rather than only the higher
  // dimension/memory caps. It still uses the same fixed desktop budget and implementation.
  const fullRecipe=recipe({size:1,opacity:1}),fullProbe=allocationProbe(),fullPlan=fullProbe.desktop.layout(width,height,smallAsset,fullRecipe);
  assert(fullPlan.workUnits>original.LIMITS.maxWorkUnits);assert(fullPlan.workUnits<=desktop.LIMITS.maxWorkUnits);
  const fullStart=performance.now(),full=fullProbe.desktop.apply(target,smallAsset,fullRecipe),fullRenderMs=performance.now()-fullStart;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0){expected[i]=31;expected[i+1]=192;expected[i+2]=77;expected[i+3]=128;}
    else{expected[i]=Math.round((31*128+data[i]*127)/255);expected[i+1]=Math.round((192*128+data[i+1]*127)/255);expected[i+2]=Math.round((77*128+data[i+2]*127)/255);expected[i+3]=255;}
  }
  sameBytes(full,{data:expected});assert.equal(hash(data),before);assert.equal(fullProbe.state.ownedBytes,fullPlan.extraBytes-2097152);
  report.largeFullFrameOracle={pixels:width*height,byteExact:true,sourceUnchanged:true,resultSha256:hash(full.data),oracleSha256:hash(expected),workUnits:fullPlan.workUnits,planExtraBytes:fullPlan.extraBytes,ownedPixelBufferBytes:fullProbe.state.ownedBytes,renderMs:Math.round(fullRenderMs*100)/100,oracle:'Whole target receives constant RGBA [31,192,77,128]; independent integer source-over against deterministic opaque/transparent source pixels.'};
  // Cancel during a real large source copy after several bounded native views.
  const cancelProbe=allocationProbe();
  assert.throws(()=>cancelProbe.desktop.apply(target,smallAsset,r,{shouldCancel(){return cancelProbe.state.views>=4;}}),e=>e.code==='IMAGE_OVERLAY_CANCELLED');
  assert.equal(hash(data),before);
  report.largeOracle.largeCopyCancellation={afterCopyViews:cancelProbe.state.views,sourceUnchanged:true};
});

test('allocation failure before publish is atomic and frozen mobile source remains unchanged', () => {
  const probe=allocationProbe(),target=image(2,2),before=hash(target.data);probe.state.failAt=2;
  assert.throws(()=>probe.desktop.apply(target,smallAsset,recipe({size:1})),/simulated platform allocation failure/);
  assert.equal(hash(target.data),before);assert.equal(hash(fs.readFileSync(originalPath)),originalHash);
  fs.writeFileSync(path.resolve(__dirname,'../quality/image-overlay-qa/profile/qualification-report.json'),JSON.stringify(report,null,2)+'\n');
});
