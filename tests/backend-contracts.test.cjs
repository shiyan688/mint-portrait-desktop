'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TASKS, DEFAULT_MAX_PIXELS, BackendContractError, createBackendSession } = require('../src/backend-contracts.cjs');

function image(width = 7, height = 5) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([p % 128, (p * 3) % 128, (p * 5) % 128, p % 256], p * 4);
  return { width, height, format: 'rgba8', alphaMode: 'straight', colorSpace: 'srgb', data };
}
function mask(width, height, values = 1) {
  return { width, height, space: 'roi-original-pixels', encoding: 'unit-float32',
    data: typeof values === 'number' ? new Float32Array(width * height).fill(values) : new Float32Array(values) };
}
function descriptor(overrides = {}) {
  return { id: 'test-fixture-only', version: '1.0.0', weightsSha256: 'test-double:no-weights', kind: 'test-double', tasks: [...TASKS],
    device: { kind: 'cpu', name: 'test fixture, not inference' },
    license: { id: 'TEST-ONLY', url: 'https://example.invalid/test-only-license', status: 'approved' }, status: 'ready', ...overrides };
}
function provenance(context, overrides = {}) {
  return { jobId: context.jobId, task: context.task, modelId: context.model.id, modelVersion: context.model.version,
    weightsSha256: context.model.weightsSha256, kind: context.model.kind, device: context.model.device, ...overrides };
}
function output(context, value = 200) {
  const data = new Uint8ClampedArray(context.source.data);
  for (let i = 0; i < data.length; i += 4) data.fill(value, i, i + 3);
  return { image: { ...context.source, data }, provenance: provenance(context) };
}
function adapter(run = context => context.task === 'matting' ?
  { matte: mask(context.roi.width, context.roi.height, 0.5), provenance: provenance(context) } : output(context), overrides = {}) {
  return { descriptor: descriptor(overrides), run };
}
function session(source = image(), injected = adapter(), options = {}) {
  return createBackendSession(source, { adapters: [injected], allowTestDoubles: true, ...options });
}
function request(overrides = {}) {
  return { task: 'retouch', modelId: 'test-fixture-only', modelVersion: '1.0.0',
    roi: { x: 2, y: 1, width: 3, height: 2 }, mask: mask(3, 2), strength: 1, ...overrides };
}
function code(expected) { return error => error instanceof BackendContractError && error.code === expected; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('scaffold ships no adapters, model downloads or fallback: exact model/version is mandatory', () => {
  const s = createBackendSession(image());
  assert.deepEqual(s.listModels(), []);
  assert.throws(() => s.start(request()), code('MODEL_MISSING'));
  assert.throws(() => session().start(request({ modelVersion: '2.0.0' })), code('MODEL_MISSING'));
  assert.equal(DEFAULT_MAX_PIXELS, 16777216);
});

test('all four tasks are explicit and unsupported or mismatched tasks fail closed', () => {
  assert.deepEqual(TASKS, ['retouch', 'matting', 'inpaint', 'restore']);
  assert.throws(() => session().start(request({ task: 'reshape' })), code('UNSUPPORTED_TASK'));
  assert.throws(() => session(image(), adapter(undefined, { tasks: ['matting'] })).start(request()), code('INCOMPATIBLE_TASK'));
});

test('unavailable models, pending licenses and unapproved test doubles never execute', () => {
  let calls = 0;
  for (const status of ['missing', 'incompatible', 'disabled']) {
    assert.throws(() => session(image(), adapter(() => calls++, { status })).start(request()), code('MODEL_UNAVAILABLE'));
  }
  for (const status of ['pending', 'blocked']) {
    const a = adapter(() => calls++);
    a.descriptor.license.status = status;
    assert.throws(() => session(image(), a).start(request()), code('LICENSE_NOT_APPROVED'));
  }
  const options = { adapters: [adapter(() => calls++)] };
  const s = createBackendSession(image(), options);
  options.allowTestDoubles = true; // Option mutation must not grant a later bypass.
  assert.throws(() => s.start(request()), code('TEST_DOUBLE_DISABLED'));
  assert.equal(calls, 0);
});

test('descriptors are copied, explicit, immutable and unique by ID/version', () => {
  const a = adapter();
  const s = session(image(), a);
  a.descriptor.version = 'mutated';
  a.descriptor.device.name = 'mutated';
  a.descriptor.tasks.length = 0;
  const [listed] = s.listModels();
  assert.equal(listed.version, '1.0.0');
  assert.equal(listed.device.name, 'test fixture, not inference');
  assert.throws(() => { listed.license.status = 'blocked'; }, TypeError);
  for (const changes of [{ id: '' }, { kind: 'AI-ish' }, { status: 'unknown' }, { tasks: ['retouch', 'retouch'] },
    { device: { kind: 'auto', name: 'unverified' } }, { license: { id: 'x', url: 'javascript:bad', status: 'approved' } }]) {
    assert.throws(() => session(image(), adapter(undefined, changes)), code('INVALID_INPUT'));
  }
  assert.throws(() => createBackendSession(image(), { adapters: [adapter(), adapter()] }), code('INVALID_INPUT'));
});

test('real-model declarations require an exact weights digest, never the test sentinel', () => {
  for (const weightsSha256 of [undefined, '', 'test-double:no-weights', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
    assert.throws(() => session(image(), adapter(undefined, { kind: 'model', weightsSha256 })), code('INVALID_INPUT'));
  }
  // Metadata validation only. No test adapter is run under a model label.
  const s = session(image(), adapter(undefined, { kind: 'model', weightsSha256: 'a'.repeat(64) }));
  assert.equal(s.listModels()[0].weightsSha256, 'a'.repeat(64));
});

test('original RGBA type, format, alpha, dimensions and resource budget are checked', () => {
  for (const changes of [{ width: 1.5 }, { height: 0 }, { width: NaN }, { data: new Float32Array(140) },
    { data: new Uint8Array(1) }, { alphaMode: 'premultiplied' }, { colorSpace: 'display-p3' }, { format: 'rgb8' }]) {
    assert.throws(() => createBackendSession({ ...image(), ...changes }), code('INVALID_INPUT'));
  }
  assert.throws(() => createBackendSession(image(), { maxPixels: 34 }), code('INVALID_INPUT'));
  assert.throws(() => createBackendSession(image(), { maxPixels: Infinity }), code('INVALID_INPUT'));
  if (typeof SharedArrayBuffer !== 'undefined') {
    assert.throws(() => createBackendSession({ ...image(), data: new Uint8Array(new SharedArrayBuffer(140)) }), code('INVALID_INPUT'));
  }
});

test('ROI rejects fractional, out-of-bounds, empty, overflowing or preview coordinates', () => {
  const s = session();
  for (const roi of [{ x: -1, y: 0, width: 3, height: 2 }, { x: 0.5, y: 0, width: 3, height: 2 },
    { x: 5, y: 0, width: 3, height: 2 }, { x: 0, y: 4, width: 3, height: 2 },
    { x: 0, y: 0, width: 0, height: 2 }, { x: Number.MAX_SAFE_INTEGER, y: 0, width: 3, height: 2 }]) {
    assert.throws(() => s.start(request({ roi })), code('INVALID_INPUT'));
  }
});

test('masks and strength reject wrong dimensions, implicit scales, bad types, NaN and infinity', () => {
  const s = session();
  for (const invalid of [null, mask(2, 3), { ...mask(3, 2), encoding: 'bytes' },
    { ...mask(3, 2), space: 'preview' }, { ...mask(3, 2), data: new Uint8Array(6) },
    mask(3, 2, NaN), mask(3, 2, Infinity), mask(3, 2, -0.1), mask(3, 2, 255)]) {
    assert.throws(() => s.start(request({ mask: invalid })), code('INVALID_INPUT'));
  }
  for (const strength of [undefined, NaN, Infinity, -1, 1.001, '1']) assert.throws(() => s.start(request({ strength })), code('INVALID_INPUT'));
  assert.throws(() => s.start(request({ signal: {} })), code('INVALID_INPUT'));
});

test('every color task preserves full dimensions, all outside/zero-mask pixels and all alpha exactly', async () => {
  for (const task of ['retouch', 'inpaint', 'restore']) {
    const original = image(), s = session(original);
    const r = request({ task, strength: 0.5, mask: mask(3, 2, [0, 0.25, 0.5, 0.75, 1, 0]) });
    const result = await s.start(r).result;
    assert.equal(result.status, 'completed');
    assert.equal(result.provenance.kind, 'test-double');
    assert.equal(result.image.width, original.width); assert.equal(result.image.height, original.height);
    for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
      const i = (y * original.width + x) * 4;
      const p = (y - r.roi.y) * r.roi.width + x - r.roi.x;
      const inside = x >= 2 && x < 5 && y >= 1 && y < 3;
      const weight = inside ? r.mask.data[p] * r.strength : 0;
      for (let c = 0; c < 3; c++) {
        assert.equal(result.image.data[i + c], Math.round(original.data[i + c] + weight * (200 - original.data[i + c])));
        assert.ok(Math.abs(result.image.data[i + c] - original.data[i + c]) <= Math.ceil(255 * weight));
      }
      assert.equal(result.image.data[i + 3], original.data[i + 3]);
    }
  }
});

test('matting uses an explicit alpha multiplier, never changes RGB or grows alpha', async () => {
  const original = image(), s = session(original);
  const result = await s.start(request({ task: 'matting', strength: 0.5, mask: mask(3, 2, [0, 1, 1, 1, 1, 1]) })).result;
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    const i = (y * original.width + x) * 4;
    const affected = x >= 2 && x < 5 && y >= 1 && y < 3 && !(x === 2 && y === 1);
    assert.deepEqual(result.image.data.slice(i, i + 3), original.data.slice(i, i + 3));
    assert.equal(result.image.data[i + 3], affected ? Math.round(original.data[i + 3] * 0.75) : original.data[i + 3]);
  }
});

test('zero strength and empty mask are byte-exact no-ops with no inference provenance', async () => {
  let calls = 0;
  const original = image(), s = session(original, adapter(() => calls++));
  for (const changes of [{ strength: 0 }, { mask: mask(3, 2, 0) }]) {
    const result = await s.start(request(changes)).result;
    assert.equal(result.status, 'noop'); assert.equal(result.provenance, null);
    assert.deepEqual(result.image.data, original.data);
    assert.notEqual(result.image.data, original.data);
  }
  assert.equal(calls, 0);
  assert.throws(() => createBackendSession(original).start(request({ strength: 0 })), code('MODEL_MISSING'));
});

test('source, mask, caller inputs, snapshots and returned output cannot mutate the private original', async () => {
  const original = image(), baseline = image();
  let adapterOutput;
  const s = session(original, adapter(context => {
    adapterOutput = output(context);
    context.source.data.fill(255); context.mask.data.fill(1);
    return adapterOutput;
  }));
  original.data.fill(255); s.getOriginal().data.fill(255);
  const r = request({ mask: mask(3, 2, [0, 1, 1, 1, 1, 1]) });
  const job = s.start(r);
  r.mask.data.fill(1); r.roi.x = 0;
  const result = await job.result;
  const unaffected = (1 * 7 + 2) * 4;
  assert.deepEqual(result.image.data.slice(unaffected, unaffected + 4), baseline.data.slice(unaffected, unaffected + 4));
  adapterOutput.image.data.fill(0);
  assert.equal(result.image.data[(1 * 7 + 3) * 4], 200);
  result.image.data.fill(255);
  assert.deepEqual(s.getOriginal().data, baseline.data);
});

test('odd original sizes and narrow high-resolution images keep exact original coordinates without rescaling', async () => {
  for (const [width, height] of [[17, 11], [4097, 3], [3, 4097]]) {
    const original = image(width, height);
    const roi = { x: width - 2, y: height - 2, width: 2, height: 2 };
    const s = session(original, adapter(context => {
      assert.deepEqual(context.originalSize, { width, height });
      assert.deepEqual(context.roi, roi);
      assert.equal(context.source.width, 2); assert.equal(context.source.height, 2);
      for (let y = 0; y < 2; y++) {
        const offset = ((roi.y + y) * width + roi.x) * 4;
        assert.deepEqual(context.source.data.slice(y * 8, y * 8 + 8), original.data.slice(offset, offset + 8));
      }
      return output(context);
    }));
    const result = await s.start(request({ roi, mask: mask(2, 2) })).result;
    assert.equal(result.image.width, width); assert.equal(result.image.height, height);
    assert.deepEqual(result.image.data.slice(0, (roi.y * width + roi.x) * 4), original.data.slice(0, (roi.y * width + roi.x) * 4));
  }
});

test('provenance mismatches fail closed for every identity field', async () => {
  for (const changes of [{ jobId: 'other-job' }, { task: 'inpaint' }, { modelId: 'other' }, { modelVersion: 'other' },
    { weightsSha256: 'b'.repeat(64) }, { kind: 'model' }, { device: { kind: 'cuda', name: 'different' } }, { device: null }]) {
    const s = session(image(), adapter(context => ({ ...output(context), provenance: provenance(context, changes) })));
    const job = s.start(request());
    await assert.rejects(job.result, code('INVALID_PROVENANCE'));
    assert.equal(job.state, 'failed');
  }
});

test('image outputs reject changed alpha, wrong dimensions/type/encoding and mixed result kinds', async () => {
  for (const transform of [value => { value.image.data[3] ^= 1; }, value => { value.image = image(2, 3); },
    value => { value.image.data = new Float32Array(24); }, value => { value.image.alphaMode = 'premultiplied'; },
    value => { value.matte = mask(3, 2); }]) {
    const s = session(image(), adapter(context => { const value = output(context); transform(value); return value; }));
    await assert.rejects(s.start(request()).result, code('INVALID_OUTPUT'));
  }
});

test('matte outputs reject NaN, outside-unit values, wrong sizes and byte-scale guesses', async () => {
  for (const invalid of [mask(3, 2, NaN), mask(3, 2, -1), mask(3, 2, 255), mask(2, 3), { ...mask(3, 2), data: new Uint8Array(6) }]) {
    const s = session(image(), adapter(context => ({ matte: invalid, provenance: provenance(context) })));
    await assert.rejects(s.start(request({ task: 'matting' })).result, code('INVALID_OUTPUT'));
  }
});

test('queued cancellation and pre-aborted signals do not call an adapter', async () => {
  let calls = 0;
  const s = session(image(), adapter(() => calls++));
  const job = s.start(request());
  assert.equal(job.state, 'queued'); assert.equal(job.cancel(), true); assert.equal(job.cancel(), false);
  await assert.rejects(job.result, code('CANCELLED'));
  const controller = new AbortController(); controller.abort();
  const aborted = s.start(request({ signal: controller.signal }));
  await assert.rejects(aborted.result, code('CANCELLED'));
  await tick(); assert.equal(calls, 0);
});

test('AbortSignal cancels promptly and discards late success from an uncooperative adapter', async () => {
  const gate = deferred(), controller = new AbortController();
  let context;
  const s = session(image(), adapter(c => { context = c; return gate.promise; }));
  const job = s.start(request({ signal: controller.signal }));
  const rejected = assert.rejects(job.result, code('CANCELLED'));
  await tick(); assert.equal(job.state, 'running');
  controller.abort(); await rejected;
  assert.equal(context.signal.aborted, true);
  gate.resolve(output(context)); await tick();
  assert.equal(job.state, 'cancelled'); assert.deepEqual(s.getOriginal().data, image().data);
});

test('new valid requests supersede older work and late adapter rejection is consumed', async () => {
  const gate = deferred(); let calls = 0;
  const s = session(image(), adapter(context => ++calls === 1 ? gate.promise : output(context, 150)));
  const first = s.start(request()); const rejected = assert.rejects(first.result, code('STALE_JOB'));
  await tick();
  const second = s.start(request());
  const result = await second.result; await rejected;
  assert.equal(first.state, 'superseded'); assert.equal(second.state, 'succeeded');
  assert.equal(result.image.data[(1 * 7 + 2) * 4], 150);
  gate.reject(new Error('late failure')); await tick();
  assert.equal(first.state, 'superseded'); assert.equal(second.cancel(), false);
});

test('invalid or pre-aborted new requests do not discard a valid running job', async () => {
  const gate = deferred(); let context;
  const s = session(image(), adapter(c => { context = c; return gate.promise; }));
  const first = s.start(request()); await tick();
  assert.throws(() => s.start(request({ strength: NaN })), code('INVALID_INPUT'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(s.start(request({ signal: controller.signal })).result, code('CANCELLED'));
  assert.equal(first.state, 'running'); assert.equal(context.signal.aborted, false);
  gate.resolve(output(context)); await first.result;
});

test('reentrant start from an abort listener keeps the newest job and settles all displaced jobs', async () => {
  let newest, firstContext, rejectMiddle;
  const gate = deferred(); let calls = 0;
  const s = session(image(), adapter(context => {
    if (++calls === 1) {
      firstContext = context;
      context.signal.addEventListener('abort', () => { newest = s.start(request()); });
      return gate.promise;
    }
    return output(context);
  }));
  const first = s.start(request()); const rejectFirst = assert.rejects(first.result, code('STALE_JOB'));
  await tick();
  const middle = s.start(request()); rejectMiddle = assert.rejects(middle.result, code('STALE_JOB'));
  await Promise.all([rejectFirst, rejectMiddle, newest.result]);
  assert.equal(middle.state, 'superseded'); assert.equal(newest.state, 'succeeded');
  gate.resolve(output(firstContext)); await tick();
});

test('adapter exceptions fail the job without fake results and allow a later retry', async () => {
  let calls = 0;
  const s = session(image(), adapter(context => { if (++calls === 1) throw new Error('weights not loaded'); return output(context); }));
  const first = s.start(request());
  await assert.rejects(first.result, code('INFERENCE_FAILED')); assert.equal(first.state, 'failed');
  assert.equal((await s.start(request()).result).status, 'completed');
});

test('different sessions cannot accept each other’s same-sequence job provenance', async () => {
  let foreign;
  await session(image(), adapter(context => { foreign = provenance(context); return output(context); })).start(request()).result;
  const s = session(image(), adapter(context => ({ ...output(context), provenance: foreign })));
  await assert.rejects(s.start(request()).result, code('INVALID_PROVENANCE'));
});

test('dispose cancels pending work, remains idempotent and rejects future use', async () => {
  const s = session(); const job = s.start(request());
  const rejected = assert.rejects(job.result, code('CANCELLED'));
  s.dispose(); s.dispose(); await rejected;
  assert.throws(() => s.start(request()), code('SESSION_CLOSED'));
  assert.throws(() => s.getOriginal(), code('SESSION_CLOSED'));
});

function refined(context, values = 0.5) {
  const matte = mask(context.roi.width, context.roi.height, values);
  const foreground = { ...context.source, data: new Uint8ClampedArray(context.source.data) };
  for (let p = 0; p < matte.data.length; p++) if (foreground.data[p*4+3] === 255 && matte.data[p] !== 1) foreground.data.fill(240, p*4, p*4+3);
  const bytes = Buffer.alloc(matte.data.length*4); matte.data.forEach((value,i)=>bytes.writeFloatLE(value,i*4));
  return {matte,foreground,provenance:provenance(context,{foregroundRefinement:{kind:'classical-color-estimation',implementation:'pymatting',version:'1.1.16',method:'estimate_foreground_ml',sourceDigest:require('node:crypto').createHash('sha256').update(context.source.data).digest('hex'),alphaDigest:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),settings:{workingColorSpace:'linear-srgb'}}})};
}
function opaqueImage(width=7,height=5) {const original=image(width,height);for(let i=3;i<original.data.length;i+=4)original.data[i]=255;return original;}

test('separate classical foreground is ignored by default and requires explicit matting-only application',async()=>{
  const original=opaqueImage(),s=session(original,adapter(refined));
  const result=await s.start(request({task:'matting'})).result;
  assert.equal(result.provenance.foregroundApplied,false);
  for(let i=0;i<original.data.length;i++)if(i%4!==3)assert.equal(result.image.data[i],original.data[i]);
  for(const changes of [{applyForeground:'yes',task:'matting'},{applyForeground:true,foregroundStrength:1,task:'retouch'},{applyForeground:false,task:'restore'}])assert.throws(()=>s.start(request(changes)),code('INVALID_INPUT'));
  await assert.rejects(session().start(request({task:'matting',applyForeground:true,foregroundStrength:1})).result,code('INVALID_OUTPUT'));
});

test('opted-in foreground uses bounded linear-light premultiplied blend only inside original-pixel edit mask',async()=>{
  const original=opaqueImage(17,11),s=session(original,adapter(c=>refined(c,[0,0.25,0.5,0.75,1,0.5])));
  const roi={x:11,y:7,width:3,height:2},edit=mask(3,2,[1,0.2,0.5,0.8,1,0]);
  const result=await s.start(request({task:'matting',roi,mask:edit,strength:0.5,applyForeground:true,foregroundStrength:1})).result;
  const linear=b=>{const v=b/255;return v<=0.04045?v/12.92:((v+.055)/1.055)**2.4;};
  const srgb=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
  const alpha=[0,.25,.5,.75,1,.5];
  for(let y=0;y<11;y++)for(let x=0;x<17;x++){
    const i=(y*17+x)*4,inside=x>=11&&x<14&&y>=7&&y<9,p=(y-7)*3+x-11;
    const w=inside?edit.data[p]*.5:0,a=inside?alpha[p]:1,denom=1-w+w*a;
    assert.equal(result.image.data[i+3],Math.round(255*denom));
    for(let c=0;c<3;c++){
      const from=original.data[i+c],to=a===1?from:240;
      const expected=w===0||a===0||to===from?from:srgb(((1-w)*linear(from)+w*a*linear(to))/denom);
      assert.equal(result.image.data[i+c],expected);assert.ok(result.image.data[i+c]>=from&&result.image.data[i+c]<=Math.max(from,to));
    }
  }
  assert.equal(result.provenance.foregroundApplied,true);assert.deepEqual(s.getOriginal().data,original.data);
  assert.throws(()=>{result.provenance.foregroundRefinement.settings.workingColorSpace='other';},TypeError);
});

test('refinement zero strength/empty mask is exact without inference; zero-alpha hidden RGB is preserved',async()=>{
  const original=opaqueImage();original.data[3]=0;
  let calls=0;const s=session(original,adapter(c=>{calls++;return refined(c,0);}));
  for(const changes of [{strength:0},{mask:mask(3,2,0)}])assert.deepEqual((await s.start(request({task:'matting',applyForeground:true,foregroundStrength:1,...changes})).result).image.data,original.data);
  assert.equal(calls,0);
  const roi={x:0,y:0,width:3,height:2};const result=await s.start(request({task:'matting',roi,applyForeground:true,foregroundStrength:1})).result;
  for(let p=0;p<original.width*original.height;p++)assert.deepEqual(result.image.data.slice(p*4,p*4+3),original.data.slice(p*4,p*4+3));
  assert.equal(result.image.data[3],0);assert.deepEqual(s.getOriginal().data,original.data);
});

test('foreground rejects stale-alpha digests, malformed planes, undeclared estimates and changed protected pixels',async()=>{
  for(const mutate of [r=>r.provenance.foregroundRefinement.sourceDigest='0'.repeat(64),r=>r.foreground.width++,r=>r.foreground.alphaMode='premultiplied',r=>r.foreground.data[3]--,
    r=>r.provenance.foregroundRefinement.version='other',r=>delete r.provenance.foregroundRefinement,r=>r.provenance.foregroundRefinement.alphaDigest='0'.repeat(64),r=>r.matte.data[0]=0.7]){
    await assert.rejects(session(opaqueImage(),adapter(c=>{const r=refined(c);mutate(r);return r;})).start(request({task:'matting',applyForeground:true,foregroundStrength:1})).result,code('INVALID_OUTPUT'));
  }
  const source=image();await assert.rejects(session(source,adapter(c=>{const r=refined(c);r.foreground.data[0]++;return r;})).start(request({task:'matting',applyForeground:true,foregroundStrength:1})).result,code('INVALID_OUTPUT'));
  await assert.rejects(session(opaqueImage(),adapter(c=>{const r=refined(c,1);r.foreground.data[0]++;return r;})).start(request({task:'matting',applyForeground:true,foregroundStrength:1})).result,code('INVALID_OUTPUT'));
  await assert.rejects(session(opaqueImage(),adapter(c=>({...output(c),foreground:c.source}))).start(request()).result,code('INVALID_OUTPUT'));
});

test('mutating foreground adapter cannot replace private source, mask, or future output snapshots',async()=>{
  const original=opaqueImage(),baseline=new Uint8ClampedArray(original.data);let response;
  const s=session(original,adapter(c=>{response=refined(c);c.source.data.fill(0);c.mask.data.fill(1);return response;}));
  const r=request({task:'matting',mask:mask(3,2,[0,1,1,1,1,1]),applyForeground:true,foregroundStrength:1});const result=await s.start(r).result;
  const index=(1*7+2)*4;assert.deepEqual(result.image.data.slice(index,index+4),baseline.slice(index,index+4));
  const before=new Uint8ClampedArray(result.image.data);response.foreground.data.fill(0);response.matte.data.fill(0);assert.deepEqual(result.image.data,before);assert.deepEqual(s.getOriginal().data,baseline);
});

test('independent foreground strengths 0/.5/1 are explicit, default to zero and never double-apply matte strength',async()=>{
  const original=opaqueImage(),s=session(original,adapter(refined));
  const base=request({task:'matting',applyForeground:true,strength:0.4});
  const alphaOnly=await s.start({...base,applyForeground:false}).result;
  const implicit=await s.start(base).result;
  assert.deepEqual(implicit.image.data,alphaOnly.image.data);assert.equal(implicit.provenance.foregroundApplied,false);
  const results=[];for(const foregroundStrength of [0,.5,1])results.push(await s.start({...base,foregroundStrength}).result);
  assert.deepEqual(results[0].image.data,alphaOnly.image.data);
  for(let i=0;i<original.data.length;i++){
    if(i%4===3)assert.ok(results.every(r=>r.image.data[i]===alphaOnly.image.data[i]));
    else assert.ok(results[0].image.data[i]<=results[1].image.data[i]&&results[1].image.data[i]<=results[2].image.data[i]);
  }
  for(const foregroundStrength of [NaN,Infinity,-.1,1.1,'1'])assert.throws(()=>s.start({...base,foregroundStrength}),code('INVALID_INPUT'));
  assert.throws(()=>s.start({...base,applyForeground:false,foregroundStrength:0}),code('INVALID_INPUT'));
});
