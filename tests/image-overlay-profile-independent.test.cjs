'use strict';

// Independent reviewer evidence. Dependency-free; reads the frozen baseline but
// does not write it or any production file. Run with node --test this-file.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const originalPath = process.env.IMAGE_OVERLAY_FROZEN_SOURCE
  ? path.resolve(process.env.IMAGE_OVERLAY_FROZEN_SOURCE)
  : path.resolve(__dirname, 'fixtures/image-overlay-mobile-frozen.cjs');
const candidatePath = path.resolve(__dirname, '../src/image-overlay.cjs');
const original = require(originalPath);
const mobile = require(candidatePath);
const desktop = mobile.createProfile('desktop');
const asset = Object.freeze({ version: 1, width: 1, height: 1, data: 'AQID/w==' });
const recipe = overrides => ({ ...desktop.defaults(), ...overrides });
const inactive = recipe({ opacity: 0 });
const rejectsInvalid = fn => assert.throws(fn, e => e.code === 'IMAGE_OVERLAY_INVALID');
const rejectsLimit = fn => assert.throws(fn, e => e.code === 'IMAGE_OVERLAY_LIMIT');

test('independent: reverse normalization reproduces the exact frozen baseline', () => {
  const baseline = fs.readFileSync(originalPath, 'utf8');
  assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'),
    '800751bc88f2539e51f742d57fe6287b44c2c2c8c74f958d297cf878790d579c');
  const normalized = fs.readFileSync(candidatePath, 'utf8')
    .replace('/* MintImageOverlay v1. Pure, bounded RGBA image-overlay compositor.\n' +
      ' * Isolated desktop-profile candidate; default mobile behavior is preserved. */',
    '/* MintImageOverlay v1. Pure, bounded RGBA image-overlay compositor. */')
    .replace('function createApi(desktop) {', 'function () {')
    .replace('maxPixels: desktop ? 16777216 : 8000000, maxEdge: desktop ? 16384 : 4096',
      'maxPixels: 8000000, maxEdge: 4096')
    .replace('maxWorkUnits: desktop ? 256000000 : 100000000', 'maxWorkUnits: 100000000')
    .replace('maxExtraBytes: (desktop ? 128 : 64) * 1024 * 1024',
      'maxExtraBytes: 64 * 1024 * 1024')
    .replace("  function createProfile(name) {\n" +
      "    if (arguments.length !== 1 || name !== 'desktop') fail('Unsupported image-overlay profile');\n" +
      '    return createApi(true);\n  }\n\n', '')
    .replace('layout, apply, createProfile', 'layout, apply');
  assert.equal(normalized, baseline);
});

test('independent: default limits are unchanged and desktop profiles are fixed and isolated', () => {
  assert.deepEqual(mobile.LIMITS, original.LIMITS);
  assert.deepEqual({ ...desktop.LIMITS, maxPixels: 8000000, maxEdge: 4096,
    maxExtraBytes: 67108864, maxWorkUnits: 100000000 }, original.LIMITS);
  assert.equal(desktop.LIMITS.maxPixels, 16777216);
  assert.equal(desktop.LIMITS.maxEdge, 16384);
  assert.equal(desktop.LIMITS.maxExtraBytes, 134217728);
  assert.equal(desktop.LIMITS.maxWorkUnits, 256000000);
  assert.deepEqual(Object.keys(mobile).sort(), [...Object.keys(original), 'createProfile'].sort());
  assert.deepEqual(Object.keys(desktop).sort(), Object.keys(mobile).sort());
  const another = mobile.createProfile('desktop');
  const nested = desktop.createProfile('desktop');
  for (const api of [mobile, desktop, another, nested]) {
    assert(Object.isFrozen(api));
    assert(Object.isFrozen(api.LIMITS));
    assert.throws(() => { api.LIMITS.maxPixels = 1; }, TypeError);
    assert.throws(() => { api.apply = () => {}; }, TypeError);
  }
  for (const api of [mobile, another, nested]) {
    assert.notEqual(desktop, api);
    assert.notEqual(desktop.LIMITS, api.LIMITS);
    assert.notEqual(desktop.apply, api.apply);
  }
});

test('independent: profile selector rejects unknown names, coercion and all extra arguments', () => {
  let coercions = 0;
  const coercible = { toString() { coercions++; return 'desktop'; },
    [Symbol.toPrimitive]() { coercions++; return 'desktop'; } };
  const badArguments = [[], [undefined], ['mobile'], ['default'], ['Desktop'], [''],
    ['desktop', undefined], ['desktop', {}], ['desktop', { maxPixels: 1 }],
    [null], [true], [1], [Symbol('desktop')], [() => 'desktop'],
    [{ maxPixels: 16777216 }], [new String('desktop')], [coercible]];
  for (const api of [mobile, desktop]) {
    for (const args of badArguments) rejectsInvalid(() => api.createProfile(...args));
  }
  assert.equal(coercions, 0);
});

test('independent: desktop dimension boundaries remain mandatory at zero opacity', () => {
  for (const dimensions of [[4096, 4096], [16384, 1024], [1024, 16384], [16384, 1], [1, 16384]]) {
    const plan = desktop.layout(...dimensions, asset, inactive);
    assert.equal(plan.width, dimensions[0]);
    assert.equal(plan.height, dimensions[1]);
    assert.equal(plan.active, false);
    assert.equal(plan.workUnits, 8);
  }
  for (const dimensions of [[4097, 4096], [16385, 1], [1, 16385], [16384, 1025],
    [16777216, 1], [4096, 4096.1], [Number.MAX_SAFE_INTEGER, 1], [0, 1], [1, Infinity]]) {
    rejectsLimit(() => desktop.layout(...dimensions, asset, inactive));
  }
  for (const dimensions of [[4096, 4096], [16384, 1024]]) {
    rejectsLimit(() => mobile.layout(...dimensions, asset, inactive));
  }
});

test('independent: strict metadata rejects hidden fields, accessors, extras and unsafe prototypes', () => {
  let getterCalls = 0;
  for (const api of [mobile, desktop]) {
    const good = { width: 1, height: 1, data: new Uint8Array(4) };
    for (const [record, validate] of [[good, value => api.apply(value, asset, inactive)],
      [asset, value => api.validateAsset(value)], [inactive, value => api.validate(value)]]) {
      for (const key of Object.keys(record)) {
        const accessor = { ...record };
        Object.defineProperty(accessor, key, { enumerable: true,
          get() { getterCalls++; throw Error('Unexpected getter execution'); } });
        rejectsInvalid(() => validate(accessor));
        const hidden = { ...record };
        Object.defineProperty(hidden, key, { enumerable: false });
        rejectsInvalid(() => validate(hidden));
        const missing = { ...record };
        delete missing[key];
        rejectsInvalid(() => validate(missing));
      }
      for (const invalid of [{ ...record, extra: 1 }, { ...record, [Symbol('extra')]: 1 },
        Object.assign(Object.create({}), record)]) rejectsInvalid(() => validate(invalid));
      validate(Object.assign(Object.create(null), record));
    }
  }
  assert.equal(getterCalls, 0);
});

test('independent: native attached fixed non-shared buffers remain required; safe offsets work', () => {
  class SubView extends Uint8Array {}
  class SubBuffer extends ArrayBuffer {}
  let shadowCalls = 0;
  for (const api of [mobile, desktop]) {
    const good = { width: 1, height: 1, data: new Uint8Array(4) };
    const invalid = [Buffer.alloc(4), new SubView(4), new Uint8Array(new SubBuffer(4)),
      new Uint16Array(4), new DataView(new ArrayBuffer(4)), new Uint8Array(5),
      vm.runInNewContext('new Uint8Array(4)'), new Proxy(new Uint8Array(4), {})];
    if (typeof SharedArrayBuffer !== 'undefined') invalid.push(new Uint8Array(new SharedArrayBuffer(4)));
    if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) {
      invalid.push(new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })));
    }
    const detached = new Uint8Array(4);
    structuredClone(detached, { transfer: [detached.buffer] });
    invalid.push(detached);
    for (const data of invalid) rejectsInvalid(() => api.apply({ ...good, data }, asset, inactive));
    assert.equal(api.apply(good, asset, inactive), good);
    const storage = new Uint8Array(12);
    storage.set([7, 8, 9, 255], 4);
    const data = storage.subarray(4, 8);
    for (const key of ['length', 'buffer', 'byteOffset', 'subarray', 'set']) {
      Object.defineProperty(data, key, { get() { shadowCalls++; throw Error('Unexpected shadow getter'); } });
    }
    assert.equal(api.encodeAsset({ width: 1, height: 1, data }).data, 'BwgJ/w==');
  }
  assert.equal(shadowCalls, 0);
});

test('independent: 200 seeded differential compositions and plans match the frozen original', () => {
  let seed = 725238;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let run = 0; run < 200; run++) {
    const width = 1 + (random() * 63 | 0), height = 1 + (random() * 63 | 0);
    const aw = 1 + (random() * 48 | 0), ah = 1 + (random() * 48 | 0);
    const input = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const pixels = { width: aw, height: ah, data: new Uint8ClampedArray(aw * ah * 4) };
    for (let i = 0; i < input.data.length; i++) input.data[i] = random() * 256 | 0;
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = random() * 256 | 0;
    const encoded = original.encodeAsset(pixels);
    const r = { ...original.defaults(), x: random(), y: random(), size: .02 + random() * 1.98,
      rotation: -180 + random() * 360, opacity: random(), flipX: random() < .5, flipY: random() < .5 };
    const originalBytes = new Uint8ClampedArray(input.data);
    const expected = original.apply(input, encoded, r);
    const expectedPlan = original.layout(width, height, encoded, r);
    for (const api of [mobile, desktop]) {
      assert.deepEqual(api.layout(width, height, encoded, r), expectedPlan, `plan case ${run}`);
      assert.deepEqual(api.apply(input, encoded, r), expected, `pixels case ${run}`);
    }
    assert.deepEqual(input.data, originalBytes, `unchanged input case ${run}`);
  }
});

test('independent: maximum-canvas plans document extra-memory accounting, not total memory', () => {
  const largeAsset = { version: 1, width: 1024, height: 1024, data: 'A'.repeat(5592406) + '==' };
  const full = desktop.layout(4096, 4096, largeAsset, recipe({ size: 2 }));
  assert.equal(full.workUnits, 111531352);
  assert.equal(full.extraBytes, 73400320);
  const mipped = desktop.layout(16384, 1024, largeAsset, recipe({ size: .02, rotation: 37 }));
  assert.equal(mipped.mipPixels, 349184);
  assert.equal(mipped.extraBytes, 84574208);
  assert.equal(mipped.extraBytes, 2097152 + 4194304 + 16777216 * 4 + 349184 * 32);
  assert(mipped.extraBytes <= desktop.LIMITS.maxExtraBytes);
  // The caller's 64 MiB target is not part of extraBytes. Asset strings, other
  // pipeline stages and runtime overhead are additional exclusions.
  assert(mipped.extraBytes + 16777216 * 4 > desktop.LIMITS.maxExtraBytes);
  assert(Number.isSafeInteger(mipped.workUnits));
  assert(Number.isSafeInteger(mipped.extraBytes));
});
