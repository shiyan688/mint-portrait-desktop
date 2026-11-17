// Mobile contract regression copied from mobile tests/redact-core.test.cjs.
// Frozen original test SHA-256: 8e5f9b0533f308863abc6666cdafefacbfbfdd212b9c12cb22dca6199c17b663.
// Only the module path and the explicit additive createProfile export expectation changed.
// BEGIN MOBILE CONTRACT REGRESSION
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/redact-core.cjs');
function recipe(overrides = {}) { return { version: 1, mode: 'cover', blockSize: .04, color: '#123456', strokes: [], ...overrides }; }
function stroke(points = [{ x: .5, y: .5 }], radius = .1) { return { radius, points }; }
function image(width, height, array) {
  const data = array ? new Uint8ClampedArray(array) : Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 97 + 17) % 256);
  return { width, height, data };
}
function reference(input, r) {
  const { width: w, height: h, data } = input, out = new Uint8ClampedArray(data);
  const edge = Math.max(1, Math.round(Math.min(w, h) * r.blockSize));
  const colors = new Map();
  const rgb = [1, 3, 5].map(i => parseInt(r.color.slice(i, i + 2), 16));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let covered = false;
    for (const s of r.strokes) {
      const radius = s.radius * Math.min(w, h);
      const tolerance = 64 * Number.EPSILON * Math.max(1, radius * radius);
      for (let j = 0; j < Math.max(1, s.points.length - 1); j++) {
        const a = s.points[j], b = s.points[Math.min(j + 1, s.points.length - 1)];
        const ax = a.x * (w - 1), ay = a.y * (h - 1), bx = b.x * (w - 1), by = b.y * (h - 1);
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
        const d2 = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
        if (d2 <= radius * radius + tolerance) covered = true;
      }
    }
    if (!covered) continue;
    const i = (y * w + x) * 4;
    if (r.mode === 'cover') out.set([...rgb, 255], i);
    else if (data[i + 3]) {
      const x0 = Math.floor(x / edge) * edge, y0 = Math.floor(y / edge) * edge, key = x0 + ',' + y0;
      if (!colors.has(key)) {
        const sums = [0, 0, 0]; let alpha = 0;
        for (let sy = y0; sy < Math.min(h, y0 + edge); sy++) for (let sx = x0; sx < Math.min(w, x0 + edge); sx++) {
          const k = (sy * w + sx) * 4, a = data[k + 3]; alpha += a;
          for (let c = 0; c < 3; c++) sums[c] += data[k + c] * a;
        }
        colors.set(key, sums.map(v => Math.round(v / alpha)));
      }
      out.set(colors.get(key), i);
    }
  }
  return out;
}
let seed = 0x98ad2613;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }

test('UMD CommonJS, global and AMD exports contain only the public API', () => {
  const code = fs.readFileSync(require.resolve('../src/redact-core.cjs'), 'utf8');
  const context = {}; vm.runInNewContext(code, context); assert.equal(typeof context.MintRedact.apply, 'function');
  let amd; const define = (_, fn) => { amd = fn(); }; define.amd = true;
  vm.runInNewContext(code, { define }); assert.equal(typeof amd.apply, 'function');
  assert.deepEqual(Object.keys(core).sort(), ['LIMITS', 'apply', 'createProfile', 'defaults', 'isActive', 'plan', 'validate'].sort());
  assert.ok(Object.isFrozen(core) && Object.isFrozen(core.LIMITS));
});
test('defaults are independent, complete, frozen, and strictly valid', () => {
  const a = core.defaults(), b = core.defaults();
  assert.notEqual(a, b); assert.notEqual(a.strokes, b.strokes);
  assert.deepEqual(a, { version: 1, mode: 'mosaic', blockSize: .04, color: '#173e31', strokes: [] });
  assert.deepEqual(core.validate(a), a); assert.equal(core.isActive(a), false);
});
test('canonical deep snapshot is frozen, independent and normalizes color/-0', () => {
  const r = recipe({ color: '#AABBCC', strokes: [stroke([{ x: -0, y: .5 }])] });
  const v = core.validate(r); r.color = '#000000'; r.strokes[0].points[0].y = 1;
  assert.equal(v.color, '#aabbcc'); assert.equal(v.strokes[0].points[0].y, .5); assert.equal(Object.is(v.strokes[0].points[0].x, -0), false);
  for (const o of [v, v.strokes, v.strokes[0], v.strokes[0].points, v.strokes[0].points[0]]) assert.ok(Object.isFrozen(o));
  assert.equal(core.isActive(v), true);
});
test('null-prototype own records and arrays are accepted and canonicalized', () => {
  const r = Object.assign(Object.create(null), recipe({ strokes: [stroke()] }));
  Object.setPrototypeOf(r.strokes, null); Object.setPrototypeOf(r.strokes[0], null);
  Object.setPrototypeOf(r.strokes[0].points, null); Object.setPrototypeOf(r.strokes[0].points[0], null);
  assert.equal(core.validate(r).strokes.length, 1);
});
test('strict exact recipe records reject omissions, extras, symbols, prototypes and accessors without invoking accessors', () => {
  for (const value of [null, undefined, [], 1, '', new Date(), Object.create(recipe())]) assert.throws(() => core.validate(value));
  for (const key of Object.keys(recipe())) { const r = recipe(); delete r[key]; assert.throws(() => core.validate(r)); }
  for (const key of ['extra', '__proto__', Symbol('evil')]) {
    const r = recipe(); Object.defineProperty(r, key, { value: 1, enumerable: true }); assert.throws(() => core.validate(r));
  }
  let invoked = 0;
  for (const key of Object.keys(recipe())) {
    const r = recipe(); Object.defineProperty(r, key, { get() { invoked++; throw Error('getter'); }, enumerable: true });
    assert.throws(() => core.validate(r), { code: 'REDACT_INVALID' });
  }
  const hidden = recipe(); Object.defineProperty(hidden, 'color', { value: '#000000' });
  // Redefining an existing enumerable property preserves its attribute. Force hidden.
  Object.defineProperty(hidden, 'color', { enumerable: false }); assert.throws(() => core.validate(hidden));
  assert.equal(invoked, 0);
});
test('strict stroke/point records and dense arrays reject inherited, extra and accessor data', () => {
  const invalid = [
    { radius: .1, points: [] }, { radius: .1, points: [,,] }, { radius: .1, points: [{ x: .5 }] },
    { radius: .1, points: [{ x: .5, y: .5, z: 0 }] }, { radius: .1, points: [{ x: .5, y: .5 }], opacity: 1 },
    Object.create({ radius: .1, points: [{ x: .5, y: .5 }] }),
  ];
  for (const s of invalid) assert.throws(() => core.validate(recipe({ strokes: [s] })));
  let called = 0;
  for (const target of ['array', 'stroke', 'point']) {
    const s = stroke(), r = recipe({ strokes: [s] });
    const o = target === 'array' ? s.points : target === 'stroke' ? s : s.points[0];
    const key = target === 'array' ? '0' : target === 'stroke' ? 'radius' : 'x';
    Object.defineProperty(o, key, { get() { called++; }, enumerable: true }); assert.throws(() => core.validate(r));
  }
  for (const list of [recipe().strokes, stroke().points]) { list.extra = true; assert.throws(() => core.validate(recipe({ strokes: list }))); }
  const symbol = [stroke()]; symbol[Symbol()] = 1; assert.throws(() => core.validate(recipe({ strokes: symbol })));
  assert.equal(called, 0);
});
test('numbers and enum boundaries are strict and bounded, never clamped', () => {
  for (const value of [NaN, Infinity, -Infinity, '.1', null, true, {}, new Number(.1)]) {
    assert.throws(() => core.validate(recipe({ blockSize: value })));
    assert.throws(() => core.validate(recipe({ strokes: [stroke(undefined, value)] })));
    assert.throws(() => core.validate(recipe({ strokes: [stroke([{ x: value, y: 0 }])] })));
  }
  for (const blockSize of [.0099, .2501]) assert.throws(() => core.validate(recipe({ blockSize })), { code: 'REDACT_LIMIT' });
  for (const radius of [.00199, .50001]) assert.throws(() => core.validate(recipe({ strokes: [stroke(undefined, radius)] })));
  for (const x of [-.0001, 1.0001]) assert.throws(() => core.validate(recipe({ strokes: [stroke([{ x, y: 0 }])] })));
  for (const color of ['red', '#fff', '#12345678', '#12345g', '#123456\n']) assert.throws(() => core.validate(recipe({ color })));
  for (const mode of ['paint', 'MOSAIC', null]) assert.throws(() => core.validate(recipe({ mode })));
  for (const version of [0, 2, '1']) assert.throws(() => core.validate(recipe({ version })));
  for (const radius of [.002, .5]) for (const blockSize of [.01, .25]) assert.doesNotThrow(() => core.validate(recipe({ blockSize, strokes: [stroke(undefined, radius)] })));
});
test('stroke and total-point budgets reject before oversized traversal', () => {
  assert.doesNotThrow(() => core.validate(recipe({ strokes: Array.from({ length: 64 }, () => stroke(Array.from({ length: 64 }, () => ({ x: 0, y: 0 })))) })));
  assert.throws(() => core.validate(recipe({ strokes: Array.from({ length: 65 }, () => stroke()) })), { code: 'REDACT_LIMIT' });
  assert.throws(() => core.validate(recipe({ strokes: [stroke(Array.from({ length: 4097 }, () => ({ x: 0, y: 0 })))] })), { code: 'REDACT_LIMIT' });
  assert.throws(() => core.validate(recipe({ strokes: Array.from({ length: 64 }, () => stroke(Array.from({ length: 65 }, () => ({ x: 0, y: 0 })))) })), { code: 'REDACT_LIMIT' });
});
test('dimension and source validation reject silent coercion, shared/resizable buffers and accessors', () => {
  const r = recipe();
  for (const [width, height] of [[0, 1], [1, 0], [1.5, 2], ['2', 2], [Infinity, 1], [4097, 1], [4096, 1954]]) assert.throws(() => core.plan(width, height, r));
  for (const data of [[], new Float32Array(4), new Uint16Array(4), Buffer.alloc(4), new DataView(new ArrayBuffer(4)), new Uint8Array(3)]) assert.throws(() => core.apply({ width: 1, height: 1, data }, r));
  if (typeof SharedArrayBuffer !== 'undefined') assert.throws(() => core.apply({ width: 1, height: 1, data: new Uint8Array(new SharedArrayBuffer(4)) }, r));
  if ('resizable' in ArrayBuffer.prototype) assert.throws(() => core.apply({ width: 1, height: 1, data: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })) }, r));
  let invoked = 0; const source = { width: 1, height: 1, get data() { invoked++; } };
  assert.throws(() => core.apply(source, r)); assert.equal(invoked, 0);
  const s = image(1, 1); s.extra = 1; assert.throws(() => core.apply(s, r));
});
test('neutral identity is exact object and buffer identity, yet still validates and checks cancel', () => {
  const s = image(3, 2), before = s.data.slice();
  assert.equal(core.apply(s, core.defaults()), s); assert.equal(core.apply(s, recipe()).data, s.data); assert.deepEqual(s.data, before);
  assert.equal(core.plan(3, 2, recipe()).workPixels, 0); assert.equal(core.plan(3, 2, recipe()).active, false);
  assert.throws(() => core.apply(s, recipe(), { shouldCancel: () => true }), { name: 'AbortError', code: 'REDACT_CANCELLED' });
});
test('cover draws exact opaque RGB over transparent source and preserves all outside bytes', () => {
  const s = image(5, 5), before = s.data.slice(); s.data.fill(0); s.data[0] = 87; s.data[1] = 29;
  const r = recipe({ strokes: [stroke([{ x: 0, y: 0 }], .2)] });
  const input = s.data.slice(), out = core.apply(s, r);
  assert.notEqual(out, s); assert.notEqual(out.data.buffer, s.data.buffer); assert.deepEqual(out.data, reference(s, r));
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) assert.deepEqual(Array.from(out.data.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)), [18, 52, 86, 255]);
  assert.deepEqual(out.data.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 4), input.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 4));
  assert.deepEqual(s.data, input); assert.notDeepEqual(before, input);
});
test('hard capsules are continuous with round caps, no square or soft boundary', () => {
  const s = { width: 9, height: 9, data: new Uint8ClampedArray(9 * 9 * 4) };
  const r = recipe({ strokes: [stroke([{ x: .25, y: .5 }, { x: .75, y: .5 }], 1 / 9)] });
  const out = core.apply(s, r); const rows = [];
  for (let y = 0; y < 9; y++) { let row = ''; for (let x = 0; x < 9; x++) row += out.data[(y * 9 + x) * 4 + 3] ? '#' : '.'; rows.push(row); }
  assert.deepEqual(rows, ['.........', '.........', '.........', '..#####..', '.#######.', '..#####..', '.........', '.........', '.........']);
});
test('mosaic uses full origin-anchored cells, alpha weighting and source alpha/hidden-RGB preservation', () => {
  const s = image(8, 8); s.data.fill(0);
  s.data.set([100, 0, 0, 255], 0); s.data.set([0, 100, 0, 128], 4);
  s.data.set([0, 0, 100, 0], 8 * 4); s.data.set([100, 100, 100, 64], 9 * 4);
  const r = recipe({ mode: 'mosaic', blockSize: .25, strokes: [stroke([{ x: 0, y: 0 }], .002)] });
  const out = core.apply(s, r);
  assert.deepEqual(Array.from(out.data.slice(0, 4)), [71, 43, 14, 255]);
  assert.deepEqual(out.data.slice(4), s.data.slice(4)); // Only mask's origin pixel changed, but whole cell informed average.
  const all = core.apply(s, { ...r, strokes: [stroke([{ x: 0, y: .5 }, { x: 1, y: .5 }], .5)] });
  assert.deepEqual(Array.from(all.data.slice(4, 8)), [71, 43, 14, 128]);
  assert.deepEqual(Array.from(all.data.slice(8 * 4, 8 * 4 + 4)), [0, 0, 100, 0]);
  assert.deepEqual(Array.from(all.data.slice(9 * 4, 9 * 4 + 4)), [71, 43, 14, 64]);
  assert.deepEqual(all.data, reference(s, { ...r, strokes: [stroke([{ x: 0, y: .5 }, { x: 1, y: .5 }], .5)] }));
});
test('mosaic cell size one is identity bytes even with coverage and partial edge cells match source reference', () => {
  for (const [w, h] of [[1, 1], [1, 17], [19, 1], [7, 7], [10, 11], [21, 13]]) {
    const s = image(w, h); const r = recipe({ mode: 'mosaic', blockSize: .25, strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], .5)] });
    assert.deepEqual(core.apply(s, r).data, reference(s, r));
    const unit = { ...r, blockSize: .01 }; assert.deepEqual(core.apply(s, unit).data, s.data);
  }
});
test('overlap, stroke ordering, duplicate points and reversals never compound or feed processed pixels back', () => {
  const s = image(53, 31);
  for (const mode of ['cover', 'mosaic']) {
    const a = stroke([{ x: .1, y: .2 }, { x: .9, y: .8 }], .2), b = stroke([{ x: .2, y: .9 }, { x: .8, y: .1 }], .08);
    const r = recipe({ mode, blockSize: .12, strokes: [a, b] });
    const expected = core.apply(s, r).data;
    assert.deepEqual(core.apply(s, { ...r, strokes: [b, a, a, b] }).data, expected);
    assert.deepEqual(core.apply(s, { ...r, strokes: [{ ...a, points: [a.points[0], a.points[0], a.points[1]] }, { ...b, points: [...b.points].reverse() }] }).data, expected);
  }
});
test('collinear event density is invariant for horizontal, vertical, diagonal, reverse and tiny-slope gestures', () => {
  const s = image(127, 97);
  for (const [a, b] of [[{ x: 0, y: .5 }, { x: 1, y: .5 }], [{ x: .5, y: 0 }, { x: .5, y: 1 }], [{ x: .02, y: .03 }, { x: .98, y: .97 }], [{ x: .1, y: .499999999999 }, { x: .9, y: .500000000001 }]]) {
    for (const mode of ['cover', 'mosaic']) for (const radius of [.002, .03, .5]) {
      const r = recipe({ mode, blockSize: .25, strokes: [stroke([a, b], radius)] });
      const baseline = core.apply(s, r).data;
      for (const count of [3, 17, 129, 4096]) {
        const points = Array.from({ length: count }, (_, i) => ({ x: a.x + (b.x - a.x) * i / (count - 1), y: a.y + (b.y - a.y) * i / (count - 1) }));
        assert.deepEqual(core.apply(s, { ...r, strokes: [stroke(points, radius)] }).data, baseline, `count=${count} mode=${mode} radius=${radius}`);
      }
    }
  }
});
test('randomized capsule raster and mosaic match independent pixel-distance reference', () => {
  for (let n = 0; n < 320; n++) {
    const w = 1 + Math.floor(random() * 45), h = 1 + Math.floor(random() * 45), s = image(w, h);
    const strokes = Array.from({ length: 1 + Math.floor(random() * 4) }, () => stroke(Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({ x: random(), y: random() })), .002 + random() * .498));
    const r = recipe({ mode: n % 2 ? 'cover' : 'mosaic', blockSize: .01 + random() * .24, strokes });
    assert.deepEqual(core.apply(s, r).data, reference(s, r), `random case ${n} ${w}x${h}`);
  }
});
test('one-pixel edges and exact canvas corners clip correctly', () => {
  for (const [w, h] of [[1, 1], [1, 64], [64, 1], [8, 8]]) for (const x of [0, 1]) for (const y of [0, 1]) {
    const s = image(w, h), r = recipe({ strokes: [stroke([{ x, y }], .5)] }); assert.deepEqual(core.apply(s, r).data, reference(s, r));
  }
});
test('subnormal and near-axis slopes remain finite and correctly cover the entire capsule body', () => {
  const s = image(95, 65);
  for (const tiny of [Number.MIN_VALUE, 1e-320, 1e-200, 1e-16, 1e-12]) {
    for (const points of [
      [{ x: 0, y: 0 }, { x: 1, y: tiny }], [{ x: 0, y: 0 }, { x: tiny, y: 1 }],
      [{ x: 1, y: tiny }, { x: 0, y: 0 }], [{ x: tiny, y: 1 }, { x: 0, y: 0 }],
      [{ x: 0, y: tiny }, { x: tiny, y: 0 }],
    ]) {
      const r = recipe({ strokes: [stroke(points, .25)] });
      assert.deepEqual(core.apply(s, r).data, reference(s, r), `tiny=${tiny}`);
    }
  }
});
test('near-tangent rows never turn into falsely covered horizontal or vertical strips', () => {
  const s = image(50, 50);
  for (const delta of [-1e-6, -1e-8, -1e-10, 0, 1e-10, 1e-8, 1e-6]) {
    const coordinate = (20 + delta) / 49;
    for (const points of [[{ x: .1, y: coordinate }, { x: .9, y: coordinate }], [{ x: coordinate, y: .1 }, { x: coordinate, y: .9 }]]) {
      const r = recipe({ strokes: [stroke(points, .1)] });
      assert.deepEqual(core.apply(s, r).data, reference(s, r), `delta=${delta}`);
    }
  }
});
test('subarray offsets and own shadow getters cannot redirect typed data', () => {
  const storage = new Uint8Array(48); for (let i = 0; i < storage.length; i++) storage[i] = i;
  const data = storage.subarray(8, 40), s = { width: 4, height: 2, data }, before = storage.slice();
  let called = 0; for (const key of ['byteOffset', 'buffer', 'length']) Object.defineProperty(data, key, { get() { called++; throw Error('evil'); } });
  const r = recipe({ strokes: [stroke([{ x: 0, y: 0 }])] });
  const out = core.apply(s, r); assert.equal(out.data.length, 32); assert.equal(called, 0); assert.deepEqual(storage, before);
});
test('options are strict and cancellation at early/mid/final checkpoints never mutates source', () => {
  const s = image(220, 210), before = s.data.slice();
  const r = recipe({ mode: 'mosaic', blockSize: .25, strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], .5)] });
  for (const value of [null, true, { other: 1 }, { shouldCancel: true }, Object.create({ shouldCancel() {} })]) assert.throws(() => core.apply(s, r, value));
  let invoked = 0; const access = {}; Object.defineProperty(access, 'shouldCancel', { get() { invoked++; }, enumerable: true });
  assert.throws(() => core.apply(s, r, access)); assert.equal(invoked, 0);
  let total = 0; core.apply(s, r, { shouldCancel() { total++; return false; } });
  for (const cancelAt of [1, 2, 4, 8, 12, 50, total]) {
    let calls = 0; assert.throws(() => core.apply(s, r, { shouldCancel() { return ++calls === cancelAt; } }), { name: 'AbortError', code: 'REDACT_CANCELLED' });
    assert.deepEqual(s.data, before);
  }
  const thrown = Error('external hook failure'); assert.throws(() => core.apply(s, r, { shouldCancel() { throw thrown; } }), e => e === thrown);
  assert.deepEqual(s.data, before);
});
test('invalid inputs and dimension errors fail before cancellation or pixel work', () => {
  let calls = 0; const shouldCancel = () => { calls++; return false; };
  assert.throws(() => core.apply(image(2, 2), { ...recipe(), mode: 'wrong' }, { shouldCancel }));
  assert.throws(() => core.apply({ width: 4096, height: 4096, data: new Uint8Array(0) }, recipe(), { shouldCancel }));
  assert.equal(calls, 0);
});
test('plan is pure, dimension-aware, consistent, frozen, and supports every legal maximum', () => {
  const r = recipe({ mode: 'mosaic', blockSize: .01, strokes: Array.from({ length: 64 }, () => stroke(Array.from({ length: 64 }, () => ({ x: .5, y: .5 })), .5)) });
  const before = JSON.stringify(r); const p = core.plan(1953, 4096, r);
  assert.equal(p.pixels, 7999488); assert.equal(p.segmentCount, 4032); assert.equal(p.workPixels, p.pixels * 3 + p.height * p.segmentCount);
  assert.ok(p.extraBytes < 128 * 1024 * 1024); assert.ok(p.workPixels < 64000000); assert.ok(Object.isFrozen(p)); assert.equal(JSON.stringify(r), before);
  for (const [w, h] of [[4096, 149], [149, 4096], [4096, 1], [1, 4096], [2828, 2828]]) {
    const p = core.plan(w, h, r); assert.ok(p.extraBytes < core.LIMITS.maxExtraBytes); assert.ok(p.workPixels < core.LIMITS.maxWorkPixels);
  }
});
test('actual full 8MP-cover allocation and cancellation after allocation remain within contract', () => {
  const s = { width: 4000, height: 2000, data: new Uint8Array(32000000) };
  const r = recipe({ strokes: [stroke([{ x: 0, y: 0 }], .002)] });
  const out = core.apply(s, r); assert.equal(out.data.length, 32000000); assert.deepEqual(Array.from(out.data.slice(0, 4)), [18, 52, 86, 255]);
  assert.equal(s.data[3], 0); assert.equal(out.data.at(-1), 0);
  let calls = 0; assert.throws(() => core.apply(s, r, { shouldCancel: () => ++calls === 6 }), { code: 'REDACT_CANCELLED' });
  assert.equal(s.data.reduce((a, b) => a + b, 0), 0);
});

// END MOBILE CONTRACT REGRESSION

// Desktop named-profile additions. No external packages, browser, or native codec.
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const frozen = require('../quality/redact-qa/mobile-core-control.cjs');
const desktop = core.createProfile('desktop');
const mobile = core.createProfile('mobile');
const sourcePath = require.resolve('../src/redact-core.cjs');
const controlPath = require.resolve('../quality/redact-qa/mobile-core-control.cjs');
const controlSha256 = '76feabea4b8b940bf26d9b807e2799ce5012ef6973841f38120770a537c9da61';
const mobileTestsSha256 = '8e5f9b0533f308863abc6666cdafefacbfbfdd212b9c12cb22dca6199c17b663';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const profileEvidence = {
  version: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
  frozenMobileSha256: controlSha256,
  copiedMobileTestsSha256: mobileTestsSha256,
  desktopSourceSha256: sha(fs.readFileSync(sourcePath)),
  limits: { default: core.LIMITS, mobile: mobile.LIMITS, desktop: desktop.LIMITS },
  recipeVersion: desktop.defaults().version,
  scope: 'Synthetic core tests only; no editor, Canvas, PNG/JPEG, browser, native platform, or installer acceptance.',
};
function checked(name, details = true) { profileEvidence.checks.push({ name, details }); }
function denseRecipe(mode = 'cover', points = 4096) {
  return recipe({ mode, strokes: [stroke(Array.from({ length: points }, () => ({ x: .5, y: .5 })))] });
}
function allocationProbe() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    globalThis.allocations = [];
    for (const key of ['Uint8Array', 'Uint8ClampedArray', 'Int32Array', 'Float64Array']) {
      const Native = globalThis[key];
      globalThis[key] = new Proxy(Native, {
        construct(target, args, newTarget) {
          allocations.push({ type: key, length: args[0] });
          return Reflect.construct(target, args, newTarget);
        }
      });
    }
  `, ctx);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), ctx);
  vm.runInContext(`globalThis.api = MintRedact.createProfile('desktop')`, ctx);
  return ctx;
}

test('frozen mobile control hash and entire source transformation prove no raster or recipe semantic edits', () => {
  const original = fs.readFileSync(controlPath, 'utf8');
  assert.equal(sha(original), controlSha256);
  // The complete copied mobile suite remains reconstructable byte for byte.
  let copied = fs.readFileSync(__filename, 'utf8').split('// BEGIN MOBILE CONTRACT REGRESSION\n')[1].split('\n// END MOBILE CONTRACT REGRESSION\n')[0];
  copied = copied.replaceAll('../src/redact-core.cjs', '../app/src/main/assets/redact-core.js');
  copied = copied.replace("['LIMITS', 'apply', 'createProfile', 'defaults', 'isActive', 'plan', 'validate'].sort()", "['LIMITS', 'apply', 'defaults', 'isActive', 'plan', 'validate'].sort()");
  assert.equal(sha(copied), mobileTestsSha256);
  let expected = original.replace('  const api = factory();', "  const api = factory('mobile');");
  expected = expected.replace("globalThis : this, function () {\n  'use strict';", "globalThis : this, function createProfile(profile) {\n  'use strict';\n\n  // A trusted host selects one named resource profile, never an imported recipe.\n  // Strict comparisons do not inspect properties or coerce executable objects.\n  if (arguments.length !== 1 || (profile !== 'mobile' && profile !== 'desktop')) {\n    fail('Resource profile must be exactly one primitive mobile or desktop string');\n  }");
  expected = expected.replace('    maxPixels: 8000000, maxEdge: 4096, minRadius: 0.002, maxRadius: 0.5,', "    maxPixels: profile === 'desktop' ? 16 * 1024 * 1024 : 8000000,\n    maxEdge: profile === 'desktop' ? 16384 : 4096, minRadius: 0.002, maxRadius: 0.5,");
  expected = expected.replace('return Object.freeze({ LIMITS, defaults, validate, isActive, plan, apply });', 'return Object.freeze({ LIMITS, defaults, validate, isActive, plan, apply, createProfile });');
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), expected);
  for (const name of ['defaults', 'validate', 'isActive', 'plan', 'apply']) {
    assert.equal(core[name].toString(), frozen[name].toString(), name);
    assert.equal(desktop[name].toString(), frozen[name].toString(), name);
  }
  checked('exact source transformation; frozen original and copied-test digests');
});

test('factory accepts exactly mobile or desktop with frozen, independent limits and unchanged v1 defaults', () => {
  assert.deepEqual(core.LIMITS, frozen.LIMITS);
  assert.deepEqual(mobile.LIMITS, frozen.LIMITS);
  assert.deepEqual(desktop.LIMITS, { ...frozen.LIMITS, maxPixels: 16 * 1024 * 1024, maxEdge: 16384 });
  for (const api of [core, mobile, desktop, desktop.createProfile('mobile'), mobile.createProfile('desktop')]) {
    assert.ok(Object.isFrozen(api)); assert.ok(Object.isFrozen(api.LIMITS));
    assert.deepEqual(api.defaults(), frozen.defaults());
    assert.equal(api.defaults().version, 1);
  }
  const again = core.createProfile('desktop');
  assert.notEqual(again, desktop); assert.notEqual(again.LIMITS, desktop.LIMITS);
  assert.throws(() => { desktop.LIMITS.maxPixels = Infinity; }, TypeError);
  assert.equal(core.LIMITS.maxPixels, 8000000);
  checked('only maxPixels and maxEdge differ by profile');
});

test('factory rejects unknown, nonprimitive and extra profile arguments without getters, traps or coercion', () => {
  let invoked = 0;
  const hostile = { get name() { invoked++; throw Error('getter'); }, get toString() { invoked++; throw Error('coercion'); }, get [Symbol.toPrimitive]() { invoked++; throw Error('coercion'); } };
  const proxy = new Proxy({}, { get() { invoked++; throw Error('get'); }, getPrototypeOf() { invoked++; throw Error('prototype'); }, ownKeys() { invoked++; throw Error('keys'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [undefined, null, '', 'Desktop', ' desktop', 'desktop\n', 'tablet', 0, 1, true, NaN, Symbol('desktop'), 1n, {}, [], new String('desktop'), () => 'desktop', hostile, proxy, revoked.proxy]) {
    assert.throws(() => core.createProfile(value), { name: 'TypeError', code: 'REDACT_INVALID' });
  }
  assert.throws(() => core.createProfile(), { code: 'REDACT_INVALID' });
  assert.throws(() => core.createProfile('desktop', {}), { code: 'REDACT_INVALID' });
  assert.throws(() => core.createProfile('desktop', undefined), { code: 'REDACT_INVALID' });
  assert.equal(invoked, 0);
  checked('strict primitive profile names; no getters, reflection traps, coercion, or arbitrary overrides');
});

test('CommonJS, AMD and global entries all expose an explicit desktop profile and mobile default', () => {
  const code = fs.readFileSync(sourcePath, 'utf8');
  const global = {}; vm.runInNewContext(code, global);
  let amd; const define = (_, fn) => { amd = fn(); }; define.amd = true;
  vm.runInNewContext(code, { define });
  for (const api of [core, global.MintRedact, amd]) {
    assert.equal(api.LIMITS.maxPixels, 8000000);
    assert.equal(api.createProfile('desktop').LIMITS.maxPixels, 16777216);
    assert.equal(api.createProfile('desktop').LIMITS.maxEdge, 16384);
    assert.equal(api.createProfile('mobile').LIMITS.maxEdge, 4096);
  }
  checked('UMD entry parity');
});

test('default and both named profiles have exact frozen-mobile pixels, plans, alpha and hidden RGB in 512 random cases', () => {
  let seed = 0x5d817b9e;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let valuesCompared = 0;
  for (let n = 0; n < 512; n++) {
    const w = 1 + Math.floor(next() * 71), h = 1 + Math.floor(next() * 73);
    const data = n % 2 ? new Uint8Array(w * h * 4 + 12).subarray(8, w * h * 4 + 8) : new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(next() * 256); data[i + 1] = Math.floor(next() * 256); data[i + 2] = Math.floor(next() * 256);
      data[i + 3] = n % 7 === 0 ? 0 : [0, 1, 64, 127, 128, 254, 255][Math.floor(next() * 7)];
    }
    const input = { width: w, height: h, data }, before = data.slice();
    const r = recipe({ mode: n % 2 ? 'cover' : 'mosaic', blockSize: .01 + next() * .24,
      color: '#' + Math.floor(next() * 16777216).toString(16).padStart(6, '0'),
      strokes: Array.from({ length: n % 13 === 0 ? 0 : 1 + Math.floor(next() * 5) }, () => stroke(Array.from({ length: 1 + Math.floor(next() * 6) }, () => ({ x: next(), y: next() })), .002 + next() * .498)) });
    const expected = frozen.apply(input, r);
    const expectedPlan = frozen.plan(w, h, r);
    for (const api of [core, mobile, desktop]) {
      const actual = api.apply(input, r);
      assert.deepEqual(api.plan(w, h, r), expectedPlan, 'plan case ' + n);
      assert.deepEqual(actual.data, expected.data, 'pixels case ' + n);
      assert.equal(actual === input, !r.strokes.length);
      if (r.mode === 'mosaic') for (let i = 0; i < data.length; i += 4) {
        assert.equal(actual.data[i + 3], data[i + 3]);
        if (!data[i + 3]) assert.deepEqual(actual.data.subarray(i, i + 4), data.subarray(i, i + 4));
      }
      valuesCompared += data.length;
    }
    assert.deepEqual(data, before);
  }
  checked('frozen-mobile differential pixels and plans', { cases: 512, comparedRGBAValues: valuesCompared, profilesCompared: 3, seed: '0x5d817b9e' });
});

test('default and desktop cancellation checkpoint counts and hook failures equal frozen mobile', () => {
  const s = image(193, 177), before = s.data.slice();
  for (const mode of ['cover', 'mosaic']) for (const strokes of [[], [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], .5)]]) {
    const r = recipe({ mode, strokes });
    let count = 0; frozen.apply(s, r, { shouldCancel() { count++; return false; } });
    for (const api of [core, mobile, desktop]) {
      let actualCount = 0; api.apply(s, r, { shouldCancel() { actualCount++; return false; } });
      assert.equal(actualCount, count);
      for (const cancelAt of new Set([1, Math.ceil(count / 2), count])) {
        let calls = 0;
        assert.throws(() => api.apply(s, r, { shouldCancel: () => ++calls === cancelAt }), { name: 'AbortError', code: 'REDACT_CANCELLED' });
        assert.equal(calls, cancelAt);
        assert.deepEqual(s.data, before);
      }
      const exception = new Error('deliberate hook exception');
      assert.throws(() => api.apply(s, r, { shouldCancel() { throw exception; } }), e => e === exception);
    }
  }
  checked('frozen-mobile cancellation counts, early/mid/final aborts, hook identity and source immutability');
});

test('desktop edges beyond mobile match the independent pixel-distance oracle including extreme aspect and subnormal slopes', () => {
  let cases = 0, values = 0;
  for (const [w, h] of [[16384, 1], [1, 16384], [8192, 3], [3, 8192], [5000, 9], [9, 5000]]) {
    const s = image(w, h), before = s.data.slice();
    for (let i = 3; i < s.data.length; i += 28) s.data[i] = 0;
    for (const mode of ['cover', 'mosaic']) for (const points of [
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: Number.MIN_VALUE }],
      [{ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: 1 }],
      [{ x: .5, y: .5 }],
    ]) {
      const r = recipe({ mode, blockSize: .25, strokes: [stroke(points, .5)] });
      assert.deepEqual(desktop.apply(s, r).data, reference(s, r), `${w}x${h} ${mode}`);
      assert.throws(() => core.plan(w, h, r), { code: 'REDACT_LIMIT' });
      cases++; values += s.data.length;
    }
    for (let i = 0; i < s.data.length; i++) if (i % 28 !== 3) assert.equal(s.data[i], before[i]);
  }
  checked('independent pixel oracle on desktop-only edges', { cases, comparedRGBAValues: values });
});

test('inclusive 16 Mi-pixel and 16384-edge plans are pure and preserve original budget formulas', () => {
  const plans = [];
  for (const [w, h] of [[4096, 4096], [16384, 1024], [1024, 16384], [16384, 1], [1, 16384]]) {
    for (const mode of ['cover', 'mosaic']) {
      const r = recipe({ mode, blockSize: .01, strokes: [stroke()] });
      const p = desktop.plan(w, h, r); plans.push(p);
      assert.equal(p.pixels, w * h); assert.ok(Object.isFrozen(p));
      assert.equal(p.segmentRows, h);
      assert.equal(p.workPixels, p.pixels * (mode === 'mosaic' ? 3 : 2) + h);
      assert.equal(p.extraBytes, 2 * 1024 * 1024 + 256 + 256 + 4 * p.pixels + 4 * (w + 1) + 160 + (mode === 'mosaic' ? 3 * p.gridCells : 0));
      assert.ok(p.workPixels <= 64000000); assert.ok(p.extraBytes <= 128 * 1024 * 1024);
    }
  }
  const ctx = allocationProbe();
  vm.runInContext(`for (const [w,h] of [[4096,4096],[16384,1024],[1024,16384],[16384,1],[1,16384]]) api.plan(w,h,api.defaults())`, ctx);
  assert.equal(ctx.allocations.length, 0);
  checked('inclusive dimension plans; no pixel/geometry typed allocation in plan', plans);
});

test('above-pixel and above-edge dimensions reject before cancellation or allocation, even neutral', () => {
  const dimensions = [[4097, 4096], [16384, 1025], [1025, 16384], [16385, 1], [1, 16385], [0, 1], [1, 0], [1.1, 1], ['1', 1], [Number.MAX_SAFE_INTEGER, 1], [NaN, 1], [Infinity, 1]];
  for (const [w, h] of dimensions) for (const strokes of [[], [stroke()]]) {
    const r = recipe({ strokes });
    assert.throws(() => desktop.plan(w, h, r), { code: 'REDACT_LIMIT' });
    let calls = 0;
    assert.throws(() => desktop.apply({ width: w, height: h, data: new Uint8Array(0) }, r, { shouldCancel: () => { calls++; return false; } }), { code: 'REDACT_LIMIT' });
    assert.equal(calls, 0);
  }
  const ctx = allocationProbe();
  vm.runInContext(`globalThis.input = { width: 4097, height: 4096, data: new Uint8Array(0) }; allocations.length = 0; globalThis.calls = 0`, ctx);
  assert.throws(() => vm.runInContext(`api.apply(input, api.defaults(), { shouldCancel() { calls++; return false; } })`, ctx), { code: 'REDACT_LIMIT' });
  assert.equal(ctx.allocations.length, 0); assert.equal(ctx.calls, 0);
  checked('dimensions outside bound fail before cancellation and typed allocation', { dimensionCases: dimensions.length, activeAndNeutral: true });
});

test('desktop work guard rejects expensive legal recipes and extreme tall aspect before any output allocation', () => {
  const rejects = [];
  for (const [w, h, mode] of [[4096, 4096, 'mosaic'], [1024, 16384, 'cover'], [1024, 16384, 'mosaic'], [1, 16384, 'cover'], [1, 16384, 'mosaic']]) {
    const r = denseRecipe(mode), work = w * h * (mode === 'mosaic' ? 3 : 2) + h * 4095;
    assert.ok(work > 64000000);
    assert.throws(() => desktop.plan(w, h, r), { code: 'REDACT_LIMIT', message: 'Redaction exceeds its work budget' });
    rejects.push({ width: w, height: h, mode, segmentCount: 4095, workPixels: work });
  }
  const wide = desktop.plan(16384, 1, denseRecipe('mosaic'));
  assert.equal(wide.segmentRows, 4095); assert.equal(wide.workPixels, 53247);
  // 3904 segments is the largest tall one-pixel recipe under the fixed work cap.
  const exactTall = desktop.plan(1, 16384, denseRecipe('cover', 3905));
  assert.equal(exactTall.workPixels, 63995904);
  assert.throws(() => desktop.plan(1, 16384, denseRecipe('cover', 3906)), { code: 'REDACT_LIMIT' });
  const ctx = allocationProbe();
  ctx.serializedRecipe = JSON.stringify(denseRecipe('cover'));
  vm.runInContext(`globalThis.input = { width: 1, height: 16384, data: new Uint8Array(65536) }; globalThis.recipe = JSON.parse(serializedRecipe); allocations.length = 0; globalThis.calls = 0`, ctx);
  assert.throws(() => vm.runInContext(`api.apply(input, recipe, { shouldCancel() { calls++; return false; } })`, ctx), { code: 'REDACT_LIMIT', message: 'Redaction exceeds its work budget' });
  assert.equal(ctx.allocations.length, 0); assert.equal(ctx.calls, 0);
  assert.equal(vm.runInContext('input.data.reduce((sum, value) => sum + value, 0)', ctx), 0);
  checked('work limit is not relaxed by desktop dimensions; tall/wide row accounting', { rejects, acceptedWide: wide, acceptedTallBoundary: exactTall });
});

test('unchanged extra-memory limit remains fixed and its guard stays ahead of allocation', () => {
  assert.equal(desktop.LIMITS.maxExtraBytes, 134217728);
  // Loose independent-maxima upper bound, with gridCells <= pixels and segmentCount <= 4096.
  // Even this intentionally overestimated bound is below the preserved extra-buffer cap.
  const looseMaximum = 2 * 1024 * 1024 + 4096 * 256 + 64 * 256 + 16777216 * 4 + (16384 + 1) * 4 + 4096 * 160 + 16777216 * 3;
  assert.equal(looseMaximum, 121323524);
  assert.ok(looseMaximum < desktop.LIMITS.maxExtraBytes);
  const code = fs.readFileSync(sourcePath, 'utf8');
  assert.ok(code.indexOf("if (extraBytes > LIMITS.maxExtraBytes)") < code.indexOf('const output = new Uint8ClampedArray'));
  checked('128 MiB guard unchanged; no legal profile input reaches the extra-byte rejection branch', { looseIndependentMaximaBytes: looseMaximum, limitBytes: desktop.LIMITS.maxExtraBytes, note: 'The guard cannot be dynamically breached without altering production limits; no artificial profile or budget override was added.' });
});

test('zero-stroke desktop operations preserve wrapper/buffer identity but still validate every field and cancel', () => {
  const data = new Uint8Array(16384 * 4), s = { width: 16384, height: 1, data };
  data.set([7, 11, 19, 0]); data.set([31, 41, 59, 127], data.length - 4);
  const before = data.slice(); let count = 0;
  const output = desktop.apply(s, desktop.defaults(), { shouldCancel() { count++; return false; } });
  assert.equal(output, s); assert.equal(output.data, data); assert.equal(count, 1); assert.deepEqual(data, before);
  assert.equal(desktop.plan(16384, 1, desktop.defaults()).extraBytes, 2 * 1024 * 1024);
  assert.equal(desktop.plan(16384, 1, desktop.defaults()).workPixels, 0);
  assert.throws(() => desktop.apply(s, desktop.defaults(), { shouldCancel: () => true }), { code: 'REDACT_CANCELLED' });
  for (const r of [recipe({ color: '#fff' }), recipe({ blockSize: 1 }), recipe({ mode: 'other' }), recipe({ profile: 'desktop' }), recipe({ maxPixels: Infinity }), recipe({ version: 2 })]) {
    let calls = 0;
    assert.throws(() => desktop.apply(s, r, { shouldCancel() { calls++; return false; } }));
    assert.equal(calls, 0);
  }
  const ctx = allocationProbe();
  vm.runInContext(`globalThis.input = { width: 16384, height: 1, data: new Uint8Array(65536) }; allocations.length = 0; globalThis.same = api.apply(input,api.defaults()) === input`, ctx);
  assert.equal(ctx.same, true); assert.equal(ctx.allocations.length, 0);
  checked('neutral identity, strict validation, cancellation and no typed allocation at desktop edge');
});

test('isolated serial full-resolution 16 Mi-pixel cover allocation has exact shape, opaque result and immutable source', () => {
  // Run in an isolated process to measure this smoke independently of earlier 8MP regression allocations.
  // No performance promise or automatic downsample/fallback is made.
  const script = `
    'use strict';
    const assert = require('node:assert/strict');
    const core = require(${JSON.stringify(sourcePath)}).createProfile('desktop');
    const crypto = require('node:crypto');
    const os = require('node:os');
    const fs = require('node:fs');
    const width = 4096, height = 4096, bytes = width * height * 4;
    const availableBytes = os.freemem();
    assert.ok(availableBytes > bytes * 4, 'At least 256 MiB available memory is required for this optional smoke');
    global.gc();
    const baseline = process.memoryUsage();
    const data = new Uint8Array(bytes);
    // Transparent input with nonzero hidden RGB at both ends, never modified.
    data.set([7,11,19,0]); data.set([31,41,59,0], bytes - 4);
    const input = { width, height, data };
    assert.equal(core.apply(input, core.defaults()), input);
    assert.equal(core.apply(input, core.defaults()).data, data);
    assert.throws(() => core.apply(input, core.defaults(), { shouldCancel: () => true }), { code: 'REDACT_CANCELLED' });
    const r = { version:1,mode:'cover',blockSize:.04,color:'#123456',strokes:[{radius:.5,points:[{x:0,y:.5},{x:1,y:.5}]}] };
    const plan = core.plan(width,height,r);
    const before = process.memoryUsage();
    const start = process.hrtime.bigint();
    const output = core.apply(input,r);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const after = process.memoryUsage();
    assert.equal(output.width,width); assert.equal(output.height,height);
    assert.equal(Object.getPrototypeOf(output),Object.prototype);
    assert.equal(Object.getPrototypeOf(output.data),Uint8ClampedArray.prototype);
    assert.equal(output.data.length,bytes); assert.notEqual(output,input); assert.notEqual(output.data.buffer,data.buffer);
    for (let i=0;i<bytes;i+=4) {
      assert.equal(output.data[i],18); assert.equal(output.data[i+1],52); assert.equal(output.data[i+2],86); assert.equal(output.data[i+3],255);
      assert.equal(data[i+3],0);
    }
    assert.deepEqual(Array.from(data.slice(0,4)),[7,11,19,0]);
    assert.deepEqual(Array.from(data.slice(-4)),[31,41,59,0]);
    for (let i=4;i<bytes-4;i++) assert.equal(data[i],0);
    const result = {
      width,height,pixels:width*height,sourceBytes:bytes,outputBytes:output.data.byteLength,
      plan,elapsedApplyMs:elapsedMs,availableBytesBefore:availableBytes,
      memory:{baseline,beforeApply:before,afterApply:after,maxRSSBytes:process.resourceUsage().maxRSS*1024},
      outputSha256:crypto.createHash('sha256').update(output.data).digest('hex'),
      allPixelsExactOpaqueColor:true,sourceUnchanged:true,neutralIdentityAndCancelAtInclusiveBound:true,
      warning:'Single synthetic Node observation, not a platform memory bound, benchmark promise, or editor/export validation.'
    };
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', script], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const smoke = JSON.parse(result.stdout);
  assert.equal(smoke.pixels, desktop.LIMITS.maxPixels);
  assert.equal(smoke.outputBytes, 67108864);
  checked('isolated inclusive-bound full-cover allocation', smoke);
});

test('write opt-in reproducible profile evidence after successful checks', () => {
  assert.equal(profileEvidence.checks.length, 13);
  profileEvidence.testFileSha256 = sha(fs.readFileSync(__filename));
  profileEvidence.copiedMobileContractChecks = 25;
  profileEvidence.desktopProfileChecks = profileEvidence.checks.length;
  profileEvidence.totalNodeTests = 39;
  profileEvidence.command = 'REDACT_WRITE_REPORT=1 node --test --test-concurrency=1 tests/redact-core-desktop.test.cjs';
  profileEvidence.status = 'passed';
  if (process.env.REDACT_WRITE_REPORT === '1') {
    const destination = path.join(__dirname, '../quality/redact-qa/profile-report.json');
    // The final exit status includes failures in the copied mobile regressions.
    // Never replace evidence with a successful-looking record after a failed run.
    process.once('exit', code => {
      if (code === 0) fs.writeFileSync(destination, JSON.stringify(profileEvidence, null, 2) + '\n');
    });
  }
});
