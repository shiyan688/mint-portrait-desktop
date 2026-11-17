'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

// Persistence-only coverage. Synthetic source/cache bytes; no image decoder,
// renderer, inference, dependency download, or platform/device claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const P = require('../src/project-document.cjs');
const S = require('../src/straighten.cjs');
const { createRecoveryStore } = require('../recovery-store.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const revision = 'straighten-historical:source-0';
const recipe = (angle = 13, mode = 'expand') => ({ version: 1, angle, mode });
const slots = photo => [photo.settings, photo.committed, ...photo.undo, ...photo.redo,
  ...(photo.exportedSettings === null || photo.exportedSettings === undefined ? [] : [photo.exportedSettings])];
// Generated once using the untouched schema13 codec, before the schema14 change.
// It contains distinct current/committed/two undo/redo/exported snapshots, legacy
// paint/redaction geometry keys, original PNG bytes and signed-zero learned matte.
// Gzip is only a compact source-code fixture; the decompressed bytes are .mintproj.
const historical13 = () => zlib.gunzipSync(Buffer.from('H4sIAAAAAAAAA+1azYscRRQvA0qI5OhFkMiLhxx64vT0fPZF82WyMQnL7hojzoLV3a9nare7qlNdPbvjMhA8GfBfEDwKgie9q3hT9OzBg3gWPHgQ8aCvenpmdrNRVIQ99MAwVe/Vq3r16vd+VUzV7bU7W+sbN9lZxtjLjLHXLzB2kzH2wwXGTjHGvp88vTXoffT7wW/vf/XL55P3rv94z33hw9Pf3PU+aH/67ndfH0CsdMoN+JAKaRqZ0kZzYRqZVjsYGnBggjoXSoLveg6EhdYozVoEPoxFbpQWIU8a2VgZ5bvggC3l4L95AOKxjSRP8bAun0ozRiPCi5kcgQO5KnSIGzgR5diQk1ujsUHZWJr5ZbNGc2EB/gEEU4M5+BAkKrCqVNjhRMpH+GLZ/56IzBh814ExUre2SIa3UI5I02s6kI95q9MFH6I+x6AXeK7rtjteJwjiQdPrdLr9drcddTDwIh7FPOC81+y0Orzd70WtsNnu9NxW02u3ujBzIMcEQ4MR+EYXSHVjhBzl5DHuZyovNFovQiWN5rkBn1zgptDc2Bg0HTCYZqhJhqU6VYq8bToQ6DI8trLHdTqX54lIbQGnFJWmA1LlpfUO3ytNR7dVRBFSWoyE5AmQ7HJSaPDdPpWvqERp8OE8DhBxYPWvIDdj1OC3HMgzZWjRtx0oZIT62rQcQWMkMS+HTURWjpYUeelaxhM0hgaWdpo0bqJCntziU9Tz/lIuC55s2ujZMMgiSSrxLXG/EPF0teUGZlzoUpJQSC7zhEtCRmmY4ASTvKrxaELKaEvJRYtY81TIUVUNuZzwfJ1H0YrQ4L5Z9TLjQi4EBys582+gPEKVotHTV3EKPhwMK4+G4B8Mq76H1PkQQq2yUr4/pKAOYTr/3Zu3GNPvzBnC/YJrg3qr0DKft4kTkd0bgh/zJMd5/Y2qTjaHJn/c+MYOT31Z/M3LgTJGpfNKgnElDwlHQ/CHcD62nyE4Q1AZD4WZVn4eWtqhje/QwnjeCQF5XiQoz4s7nCbcnBGGqoU5wkENu0qrDHRjEf/nA02wdAAlDxJK0zImoDEUGT6yqEarXbSLv8jtBTpnJNMYcSurAXFyAEELE/MQL0U7RW5SlCZf8gLXEqPb3Bg8ur2lJPRdovFQpakwlsdXebtV83bN23Wa1rxdA+Jk8nYhI2WRteRsr+bsmrPrFK05uwbEieTsVa5u11xdc3WdmjVX14A4iVy9bdf16AG7U5N2Tdp1jtakXQPixJJ2tW5dBzKNOZojXVzh4RiPvc6t+nFgV0jSkUDY21V70/v4O+J/jpmKyzfF2xa9x1zfWpTmRWJI/4hH1tnHWDqglSDdviXyabnpHDtCnnEiXzJoVD41MrFPJEzZFqqSV6GQwjTiRHHjtcCBiBte3Ujbv6MyrSYoSypfuqsipG3D8Hz3sPeksPFc3JM3DOamoWQyrfR3q6wE9yLFbM/6nW9Wl9j8P35oGjgRhzwOs2LJP1fWX6Op4T6GBXHFulaxSGxzHvHM0Pa6nABYwIUVBKpYzWYzp7rBb1cQxb2jtDN/h0BiOlFQzD0H4oRT8DMR7tpECTCxUS/w0F+AlUVzYSFpx1xa2OrKoWbbToveRmC0eey9fbc+6tRHnXpnq486NSBO4lGHuqIN8y9bUaPcbM7faf3t2Yk28xWwLl6bzbfGFU5WcWwPVs3/94nZqiMrx7L5zprgiie9I660VzzpRp1+d9DqtjvhIHLDmMeu12m7YRC1Ov2433UHHsZdL2zFbuT1424QhHzQdXterxX1gqgLs+3Zw/U718+eefYMY+zs2o2rG4yxJ+h7+inG2LlnvnxoFVcvbZ1+Lvz1289+PseefHDqpbUvfvqEMcbWrt25+vHlt975s/zgD1AgJijhKAAA', 'base64'));
const historical13Hash = '73909a05dd55bd2c67d8d1bde0a7a3c4e81d485affeda1c87950e4eebca5c925';
function metadata(bytes) {
  const header = P.inspectHeader(bytes);
  return JSON.parse(Buffer.from(bytes.subarray(64, 64 + header.metadataBytes)).toString('utf8'));
}
function payload(bytes) { return Buffer.from(bytes.subarray(64 + P.inspectHeader(bytes).metadataBytes)); }
function rewrite(bytes, change) {
  const doc = metadata(bytes); change(doc);
  const body = Buffer.from(JSON.stringify(historicalImageFields(doc))), header = Buffer.from(bytes.subarray(0, 64));
  const originalPayload = payload(bytes);
  header.writeUInt32LE(doc.version, 8); header.writeUInt32LE(body.length, 16);
  header.writeUInt32LE(64 + body.length + originalPayload.length, 24);
  Buffer.from(sha(body), 'hex').copy(header, 32);
  return Buffer.concat([header, body, originalPayload]);
}
async function fixture(active = false) {
  const input = await P.decode(historical13());
  if (active) {
    const recipes = [recipe(13.125), recipe(-13.125, 'crop'), null, recipe(0), recipe(-180), recipe(90, 'crop')];
    slots(input.photos[0]).forEach((s, index) => {
      s.straighten = recipes[index]; s.paintLayers = null; s.redactions = null;
    });
  }
  return input;
}

test('schema14 default is null; direct legacy omission is neutral but explicit zero stays a complete recipe', () => {
  assert.equal(P.DEFAULT_SETTINGS.straighten, null);
  const settings = structuredClone(P.DEFAULT_SETTINGS); delete settings.straighten;
  assert.equal(P.validateSettings(settings, { width: 3, height: 2 }, revision).straighten, null);
  for (const angle of [-180, -90, -1e-20, -0, 0, 1e-20, 90, 180]) {
    for (const mode of ['expand', 'crop']) {
      const normalized = P.validateSettings({ ...settings, straighten: recipe(angle, mode) }, { width: 3, height: 2 }, revision);
      assert.deepEqual(normalized.straighten, S.validate(recipe(angle, mode)));
      assert.equal(Object.is(normalized.straighten.angle, -0), false);
    }
  }
});

test('genuine frozen schema13 migrates all snapshots without changing source, history, cache provenance or geometry keys', async () => {
  const original = historical13(), oldDoc = metadata(original), originalHash = sha(original);
  assert.equal(originalHash, historical13Hash); assert.equal(P.inspectHeader(original).version, 13);
  for (const slot of slots(oldDoc.photos[0])) assert.equal(Object.hasOwn(slot, 'straighten'), false);
  const out = await P.decode(original), photo = out.photos[0];
  assert.equal(out.version, P.VERSION);
  assert.deepEqual(slots(photo), slots(oldDoc.photos[0]).map(s => ({ ...s, straighten: null, perspective: null, sharpness: null, imageLayers: [] })));
  assert.deepEqual(slots(photo).map(s => s.exposure), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(photo.review, oldDoc.photos[0].review);
  assert.equal(photo.sourceRevision, revision); assert.equal(photo.revision, 6);
  assert.equal(sha(photo.source.bytes), oldDoc.photos[0].source.sha256);
  assert.deepEqual(Buffer.from(photo.source.bytes), payload(original).subarray(0, oldDoc.blobs[0].byteLength));
  assert.deepEqual(photo.learnedCache[0].result.provenance, oldDoc.photos[0].learnedCache[0].result.provenance);
  assert.equal(Object.is(photo.learnedCache[0].result.matte.data[0], -0), true);
  for (const [index, slot] of slots(photo).entries()) {
    assert.equal(slot.paintLayers.geometryKey, slots(oldDoc.photos[0])[index].paintLayers.geometryKey);
    assert.equal(slot.redactions.geometryKey, slots(oldDoc.photos[0])[index].redactions.geometryKey);
  }
  assert.equal(sha(original), originalHash, 'reading does not rewrite the old file');
  const current = await P.encode(out);
  assert.equal(P.inspectHeader(current).version, P.VERSION);
  assert.deepEqual(payload(current), payload(original), 'all original/cache blob bytes remain exact');
  assert.deepEqual(await P.decode(current), out);
});

for (let version = 1; version <= 13; version++) {
  test(`properly rehashed schema${version} without straighten migrates every snapshot to null`, async () => {
    const historical = rewrite(historical13(), document => {
      document.version = version;
      for (const photo of document.photos) {
        if (version < 6) delete photo.review;
        const introduced = { localLayers: 2, manualSelection: 3, manualLiquify: 3, manualRepair: 3,
          advancedTone: 4, framing: 5, levels: 7, canvasPadding: 8, textLayers: 9,
          lightBalance: 10, redactions: 11, paintLayers: 12, faceAdjustments: 13 };
        for (const slot of slots(photo)) for (const [key, firstVersion] of Object.entries(introduced)) {
          if (version < firstVersion) delete slot[key];
        }
      }
    });
    const before = sha(historical), out = await P.decode(historical);
    assert.equal(P.inspectHeader(historical).version, version);
    assert.equal(metadata(historical).version, version);
    assert.equal(out.version, P.VERSION);
    for (const slot of slots(out.photos[0])) assert.equal(slot.straighten, null);
    assert.equal(sha(historical), before);
    assert.deepEqual(payload(await P.encode(out)), payload(historical));
    assert.deepEqual(slots(out.photos[0]).map(s => s.exposure), [1, 2, 3, 4, 5, 6]);
    assert.equal(Object.is(out.photos[0].learnedCache[0].result.matte.data[0], -0), true);
  });
}

test('schema14 owns independent exact recipes in every slot and preserves original/cache bytes', async () => {
  const input = await fixture(true), before = structuredClone(input), encoded = await P.encode(input);
  const out = await P.decode(encoded);
  assert.equal(P.inspectHeader(encoded).version, P.VERSION);
  assert.deepEqual(out, before); assert.deepEqual(input, before);
  assert.deepEqual(payload(encoded), payload(historical13()));
  assert.deepEqual(await P.encode(out), encoded);
  out.photos[0].settings.straighten.angle = 1;
  assert.equal(out.photos[0].committed.straighten.angle, -13.125);
  assert.equal(input.photos[0].settings.straighten.angle, 13.125);
  out.photos[0].learnedCache[0].result.matte.data[0] = 1;
  assert.equal(Object.is(input.photos[0].learnedCache[0].result.matte.data[0], -0), true);
});

test('explicit zero preserves historical paint/redaction keys exactly without rewriting bound collections', async () => {
  const input = await fixture(), originalSlots = structuredClone(slots(input.photos[0]));
  for (const [index, slot] of slots(input.photos[0]).entries()) slot.straighten = recipe(0, index % 2 ? 'crop' : 'expand');
  const output = await P.decode(await P.encode(input));
  for (const [index, slot] of slots(output.photos[0]).entries()) {
    assert.deepEqual(slot.paintLayers, originalSlots[index].paintLayers);
    assert.deepEqual(slot.redactions, originalSlots[index].redactions);
    assert.deepEqual(slot.straighten, recipe(0, index % 2 ? 'crop' : 'expand'));
  }
});

for (const [index, name] of ['current', 'committed', 'undo[0]', 'undo[1]', 'redo', 'exported'].entries()) {
  test(`schema14 requires explicit straighten in ${name} on both encode and decode`, async () => {
    const input = await fixture(), saved = await P.encode(input);
    delete slots(input.photos[0])[index].straighten;
    await assert.rejects(P.encode(input), /Missing settings field: straighten/);
    await assert.rejects(P.decode(rewrite(saved, doc => delete slots(doc.photos[0])[index].straighten)), /Missing settings field: straighten/);
  });
}

test('straighten rejects incomplete, malformed and unsafe records without invoking getters', async () => {
  let reads = 0;
  const accessor = recipe(); Object.defineProperty(accessor, 'angle', { enumerable: true, get() { reads++; return 13; } });
  const hidden = recipe(); Object.defineProperty(hidden, 'angle', { value: 13, enumerable: false });
  const inherited = Object.create({ angle: 13 }); inherited.version = 1; inherited.mode = 'expand';
  const symbol = { ...recipe(), [Symbol('unsafe')]: 1 };
  const badRecipes = [undefined, {}, { version: 1 }, { angle: 13, mode: 'expand' },
    { version: 1, angle: 13 }, { version: 2, angle: 13, mode: 'expand' }, recipe(NaN), recipe(Infinity),
    recipe(-Infinity), recipe(180.0001), recipe(-180.0001), recipe('13'), recipe(13, 'auto'),
    [], 13, false, { ...recipe(), extra: 1 }, accessor, hidden, inherited, symbol];
  for (const value of badRecipes) {
    const input = await fixture(); input.photos[0].settings.straighten = value;
    assert.throws(() => P.validateSettings(input.photos[0].settings, { width: 1, height: 1 }, revision), /straighten|Straighten/);
    await assert.rejects(P.encode(input), /straighten|Straighten/);
  }
  assert.equal(reads, 0);
  const saved = await P.encode(await fixture());
  for (const value of [{}, { version: 1, angle: 13 }, recipe('13'), recipe(13, 'auto'), recipe(181)]) {
    await assert.rejects(P.decode(rewrite(saved, doc => { doc.photos[0].settings.straighten = value; })), /straighten|Straighten/);
  }
});

test('UMD codec uses shared strict validation before bound paint/redaction and never plans a render', () => {
  const sandbox = vm.createContext({ TextEncoder, TextDecoder });
  vm.runInContext(fs.readFileSync(require.resolve('../src/straighten.cjs'), 'utf8'), sandbox);
  vm.runInContext(`
    globalThis.events = [];
    const sharedValidate = MintStraighten.validate;
    globalThis.MintStraighten = {
      validate(value) { events.push('straighten'); return sharedValidate(value); },
      plan() { throw Error('Codec must not plan a render'); },
      apply() { throw Error('Codec must not render pixels'); }
    };
    globalThis.MintPaintLayers = { validate(value, context) {
      events.push('paint'); if (context.settings.straighten.angle !== 13) throw Error('Not canonical'); return null;
    } };
    globalThis.MintRedactionLayers = { validate(value, context) {
      events.push('redaction'); if (context.settings.straighten.angle !== 13) throw Error('Not canonical'); return null;
    } };
  `, sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/project-document.cjs'), 'utf8'), sandbox);
  vm.runInContext(`
    const s = { ...MintProjectDocument.DEFAULT_SETTINGS, straighten: {version:1, angle:13, mode:'expand'}, paintLayers:{}, redactions:{} };
    MintProjectDocument.validateSettings(s, {width:65535, height:4000}, 'test:source');
  `, sandbox);
  assert.deepEqual(Array.from(sandbox.events), ['straighten', 'paint', 'redaction']);
  assert.throws(() => vm.runInContext(`events.length=0; s.straighten={version:1}; MintProjectDocument.validateSettings(s,{width:1,height:1},'test:source');`, sandbox), /Invalid straighten/);
  assert.deepEqual(Array.from(sandbox.events), ['straighten']);
});

test('UMD schema14 roundtrip uses browser globals/WebCrypto and preserves exact source/cache payloads', async () => {
  const saved = await P.encode(await fixture(true));
  const sandbox = vm.createContext({ TextEncoder, TextDecoder, crypto: crypto.webcrypto,
    Uint8Array, Uint16Array, Float32Array, ArrayBuffer, DataView,
    inputJSON: JSON.stringify(Array.from(saved)) });
  for (const file of ['straighten.cjs', 'photo-review.cjs', 'project-document.cjs']) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/' + file), 'utf8'), sandbox);
  }
  vm.runInContext(`
    const validate = MintStraighten.validate;
    globalThis.MintStraighten = { validate,
      plan() { throw Error('Project loading cannot plan geometry'); },
      apply() { throw Error('Project loading cannot render geometry'); }
    };
    globalThis.roundtrip = MintProjectDocument.decode(Uint8Array.from(JSON.parse(inputJSON)))
      .then(snapshot => MintProjectDocument.encode(snapshot));
  `, sandbox);
  assert.deepEqual(Array.from(await sandbox.roundtrip), Array.from(saved));
});

test('loading oversized metadata does not impose straighten execution caps or allocate decoded pixels', async () => {
  const input = await fixture(), photo = input.photos[0];
  // Deliberate header-only synthetic JPEG: the project codec does not decode or
  // claim raster validity. A real render must independently reject these sizes.
  photo.source = { bytes: Uint8Array.from([255,216,255,192,0,11,8,15,160,195,80,1,1,17,0,255,218,0,2,255,217]),
    mime: 'image/jpeg', width: 50000, height: 4000 };
  photo.learnedCache = []; delete photo.latestMatteId; delete photo.lastSelectedMatteId;
  for (const slot of slots(photo)) {
    delete slot.learnedMatteId; slot.paintLayers = null; slot.redactions = null; slot.straighten = recipe(45);
  }
  assert.throws(() => S.plan(50000, 4000, recipe(45)), /limit/i);
  const before = structuredClone(input), restored = await P.decode(await P.encode(input));
  assert.equal(restored.photos[0].source.width, 50000);
  assert.equal(restored.photos[0].source.height, 4000);
  assert.deepEqual(slots(restored.photos[0]), slots(before.photos[0]));
  assert.deepEqual(restored.photos[0].source.bytes, before.photos[0].source.bytes);
  assert.deepEqual(input, before);
});

test('recovery generations roundtrip schema14 recipes and genuine historical13 without rewriting source blobs', async t => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'mint-straighten-recovery-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const store = createRecoveryStore({ root: path.join(base, 'owned') });
  await store.configure({ enabled: true, budgetMiB: 128 });
  const original = historical13(), current = await P.encode(await fixture(true));
  assert.equal((await store.save({ bytes: original })).committed, true);
  assert.equal((await store.save({ bytes: current })).committed, true);
  const latest = await store.open({ slot: 'latest' }), previous = await store.open({ slot: 'previous' });
  assert.deepEqual(Buffer.from(latest.bytes), Buffer.from(current));
  assert.deepEqual(Buffer.from(previous.bytes), original);
  assert.deepEqual(slots((await P.decode(latest.bytes)).photos[0]), slots((await fixture(true)).photos[0]));
  for (const slot of slots((await P.decode(previous.bytes)).photos[0])) assert.equal(slot.straighten, null);
  assert.equal(sha(previous.bytes), historical13Hash);
});
