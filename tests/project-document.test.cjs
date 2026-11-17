'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const P = require('../src/project-document.cjs');
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const body = Buffer.concat([Buffer.from(type), bytes]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(bytes.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out; }
function png(width = 4, height = 3, exif) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set([31,64,127,255], y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...(exif ? [chunk('eXIf', exif)] : []), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function exif(orientation) { const bytes = Buffer.alloc(26); bytes.write('II'); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(8, 4); bytes.writeUInt16LE(1, 8); bytes.writeUInt16LE(0x112, 10); bytes.writeUInt16LE(3, 12); bytes.writeUInt32LE(1, 14); bytes.writeUInt16LE(orientation, 18); return bytes; }
const settings = extra => ({ ...P.DEFAULT_SETTINGS, spots: [], ...extra });
function fixture(withCache = false) {
  const photo = { id: 'photo-1', name: '原片.png', sourceRevision: 'photo-1:source-0', source: { bytes: new Uint8Array(png()), mime: 'image/png', width: 4, height: 3 }, selected: true, settings: settings(), committed: settings(), undo: [], redo: [], revision: 0, preset: null, imageAssets: [], learnedCache: [] };
  if (withCache) {
    const base = { kind: 'model', modelId: 'local-pinned-model', modelVersion: '1.0', weightsSha256: 'a'.repeat(64), device: { kind: 'cpu', name: 'CPU' }, executionProfile: { adapter: 'birefnet', inputSize: 2048, precision: 'mixed-bfloat16', threads: 4, operatorPrecision: { deformConv2d: 'float32', weights: 'float32' } } };
    const matte = { id: 'matte-1', kind: 'matting', photoId: photo.id, sourceRevision: photo.sourceRevision, originalSize: { width: 4, height: 3 }, bytes: 48, result: { matte: { width: 4, height: 3, roi: { x: 0, y: 0, width: 4, height: 3 }, space: 'roi-original-pixels', encoding: 'unit-float32', data: new Float32Array([0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, -0]) }, provenance: { ...base, task: 'matting' } } };
    const parse = { id: 'parse-1', kind: 'parse', photoId: photo.id, sourceRevision: photo.sourceRevision, originalSize: { width: 4, height: 3 }, bytes: 32, result: { kind: 'face-masks', width: 2, height: 2, roi: { x: 1, y: 0, width: 2, height: 2 }, skin: new Float32Array([0,.25,.5,1]), protected: new Float32Array([1,.75,.5,0]), provenance: { ...base, task: 'parse', selection: { kind: 'detected-face', faceId: 'photo-1:face-0', revision: photo.sourceRevision }, classVocabulary: ['background','neck','skin','cloth','l_ear','r_ear','l_brow','r_brow','l_eye','r_eye','nose','mouth','l_lip','u_lip','hair','eye_g','hat','ear_r','neck_l'], maskClasses: { skin: ['skin','nose'] }, maskPolicy: { version: 'segface-conservative-v1', kind: 'deterministic-mask-postprocessing-not-a-retouch-model', guard: { units: 'original-roi-pixels', outsideRoi: 'fully-protected', radiusPx: 2 } } } } };
    const edit = { learnedMatteId: matte.id, learnedMatteStrokes: [{ mode: 'remove', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }], radiusPx: 1, hardness: .5, opacity: .75 }], diagnosticParseId: parse.id, diagnosticOverlay: true, diagnosticLayer: 'protected', exposure: 8, spots: [{ x: .2, y: .8, r: .018 }] };
    photo.learnedCache = [matte, parse]; photo.settings = settings(edit); photo.committed = settings(edit); photo.undo = [settings(), settings({ learnedMatteId: matte.id })]; photo.redo = [settings({ learnedMatteId: matte.id, exposure: 10 })]; photo.revision = 4; photo.latestMatteId = matte.id; photo.lastSelectedMatteId = matte.id; photo.exportedSettings = settings({ learnedMatteId: matte.id });
  }
  return { version: P.VERSION, currentId: photo.id, photos: [photo] };
}
function rebuild(bytes, mutate) {
  const h = P.inspectHeader(bytes), json = JSON.parse(Buffer.from(bytes.subarray(64, 64 + h.metadataBytes)).toString('utf8'));
  mutate(json);
  const body = Buffer.from(JSON.stringify(historicalImageFields(json))), header = Buffer.from(bytes.subarray(0, 64)), payload = Buffer.from(bytes.subarray(64 + h.metadataBytes));
  header.writeUInt32LE(body.length, 16); header.writeUInt32LE(64 + body.length + payload.length, 24); Buffer.from(digest(body), 'hex').copy(header, 32);
  return Buffer.concat([header, body, payload]);
}
function rebuildVersion(bytes, version, mutate = () => {}) {
  const out = rebuild(bytes, document => { document.version = version; mutate(document); });
  out.writeUInt32LE(version, 8);
  return out;
}
function recipeSlots(photo) { return [photo.settings, photo.committed, ...photo.undo, ...photo.redo, ...(photo.exportedSettings ? [photo.exportedSettings] : [])]; }
test('empty project is supported and versioned with an exact 64-byte frame', async () => {
  const empty = { version: P.VERSION, currentId: null, photos: [] }, bytes = await P.encode(empty);
  assert.deepEqual(await P.decode(bytes), empty); const h = P.inspectHeader(bytes); assert.equal(h.version, P.VERSION); assert.equal(h.payloadBytes, 0); assert.equal(h.blobCount, 0); assert.equal(h.byteLength, bytes.length);
});
test('roundtrip preserves original compressed bytes, identities, settings and history without model execution', async () => {
  const original = fixture(true), before = structuredClone(original), bytes = await P.encode(original), restored = await P.decode(bytes);
  assert.deepEqual(original, before, 'encode must not mutate the session');
  const expected = structuredClone(original); expected.photos[0].review = require('../src/photo-review.cjs').defaults(); expected.photos[0].source.byteLength = expected.photos[0].source.bytes.length; expected.photos[0].source.sha256 = digest(expected.photos[0].source.bytes);
  assert.deepEqual(restored, expected);
  assert.deepEqual(await P.encode(restored), bytes, 'format is stable for normalized snapshots');
  assert.ok(restored.photos[0].learnedCache[0].result.matte.data instanceof Float32Array);
  assert.ok(Object.is(restored.photos[0].learnedCache[0].result.matte.data[11], -0), 'Float32 signed zero is preserved');
  assert.equal(restored.photos[0].source.sha256, digest(original.photos[0].source.bytes));
});
for (let version = 1; version <= 12; version++) test(`historical schema${version} migrates absent face adjustments in every slot and preserves valid metadata`, async () => {
  const input = fixture(true), encoded = await P.encode(input);
  const legacy = rebuildVersion(encoded, version, document => {
    for (const photo of document.photos) {
      if (version < 6) delete photo.review;
      for (const slot of recipeSlots(photo)) delete slot.faceAdjustments;
    }
  });
  const before = digest(legacy), restored = await P.decode(legacy);
  assert.equal(P.inspectHeader(legacy).version, version, 'fixture header remains genuinely historical');
  assert.equal(restored.version, P.VERSION);
  for (const slot of recipeSlots(restored.photos[0])) assert.equal(slot.faceAdjustments, null);
  assert.deepEqual(recipeSlots(restored.photos[0]), recipeSlots(input.photos[0]), 'all valid existing recipe fields survive');
  assert.deepEqual(restored.photos[0].learnedCache, input.photos[0].learnedCache, 'valid model provenance and typed cache planes survive');
  assert.deepEqual(restored.photos[0].source.bytes, input.photos[0].source.bytes);
  assert.equal(digest(legacy), before, 'decode does not rewrite historical container bytes');
});
for (const slot of ['settings', 'committed', 'undo', 'redo', 'exportedSettings']) test(`schema13 requires explicit faceAdjustments in ${slot}; historical schema12 still requires paintLayers`, async () => {
  const input = fixture(true), encoded = await P.encode(input);
  const omit = (photo, key) => { const recipe = Array.isArray(photo[slot]) ? photo[slot][0] : photo[slot]; delete recipe[key]; };
  const bad = structuredClone(input); omit(bad.photos[0], 'faceAdjustments');
  await assert.rejects(P.encode(bad), /Missing settings field: faceAdjustments/);
  await assert.rejects(P.decode(rebuildVersion(encoded, 13, document => omit(document.photos[0], 'faceAdjustments'))), /Missing settings field: faceAdjustments/);
  const historical = rebuildVersion(encoded, 12, document => {
    for (const recipe of recipeSlots(document.photos[0])) delete recipe.faceAdjustments;
    omit(document.photos[0], 'paintLayers');
  });
  assert.equal(P.inspectHeader(historical).version, 12);
  await assert.rejects(P.decode(historical), /Missing settings field: paintLayers/);
});
test('restored buffers do not alias the container or another decode and brush edits do not alter learned planes', async () => {
  const encoded = await P.encode(fixture(true)), a = await P.decode(encoded), b = await P.decode(encoded);
  a.photos[0].source.bytes[0] = 0; a.photos[0].learnedCache[0].result.matte.data[1] = 1; a.photos[0].settings.learnedMatteStrokes[0].points[0].x = 3;
  assert.equal(b.photos[0].source.bytes[0], 137); assert.notEqual(b.photos[0].learnedCache[0].result.matte.data[1], 1); assert.equal(b.photos[0].settings.learnedMatteStrokes[0].points[0].x, 1);
  assert.deepEqual(await P.decode(encoded), b);
});
test('encodeParts supports sequential writes and snapshots sources/masks before any asynchronous hash', async () => {
  const input = fixture(true), before = structuredClone(input); let first = true;
  const result = await P.encodeParts(input, { sha256: async bytes => { if (first) { first = false; input.photos[0].source.bytes.fill(0); input.photos[0].learnedCache[0].result.matte.data.fill(1); input.photos[0].settings.exposure = 90; } return digest(bytes); } });
  const bytes = Buffer.concat(result.parts); assert.equal(bytes.length, result.byteLength);
  const out = await P.decode(bytes); assert.deepEqual(out.photos[0].source.bytes, before.photos[0].source.bytes); assert.deepEqual(out.photos[0].learnedCache, before.photos[0].learnedCache); assert.equal(out.photos[0].settings.exposure, 8);
});
test('UMD browser path works with WebCrypto, typed arrays and no require or model globals', async () => {
  const sandbox = { crypto: crypto.webcrypto, Uint8Array, Uint16Array, Uint8ClampedArray, Float32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve('../src/project-document.cjs'), 'utf8'), sandbox);
  assert.ok(sandbox.MintProjectDocument); const input = fixture(); input.photos[0].source.bytes = Array.from(input.photos[0].source.bytes); sandbox.inputJson = JSON.stringify(input);
  vm.runInContext('const input = JSON.parse(inputJson); input.photos[0].source.bytes = new Uint8Array(input.photos[0].source.bytes); globalThis.testPromise = MintProjectDocument.encode(input);', sandbox);
  const bytes = await sandbox.testPromise; assert.equal((await P.decode(bytes)).photos[0].id, 'photo-1');
});
test('SHA-256 binds metadata and each original/mask payload', async () => {
  const bytes = await P.encode(fixture(true)), h = P.inspectHeader(bytes);
  const badMeta = bytes.slice(); badMeta[64 + 10] ^= 1; await assert.rejects(P.decode(badMeta), /metadata SHA-256/);
  const badSource = bytes.slice(); badSource[64 + h.metadataBytes + 50] ^= 1; await assert.rejects(P.decode(badSource), /SHA-256/);
  const badMatte = bytes.slice(); badMatte[badMatte.length - 1] ^= 1; await assert.rejects(P.decode(badMatte), /SHA-256|probability|complementary/);
  const changed = fixture(); changed.photos[0].source.sha256 = 'b'.repeat(64); await assert.rejects(P.encode(changed), /identity mismatch/);
});
test('truncation, trailing bytes, unknown format/version and inconsistent lengths fail closed', async () => {
  const bytes = await P.encode(fixture());
  for (const length of [0, 7, 63, bytes.length - 1]) await assert.rejects(P.decode(bytes.subarray(0, length)), /Truncated|Mint Portrait/);
  await assert.rejects(P.decode(Buffer.concat([bytes, Buffer.from([0])])), /trailing/);
  const version = bytes.slice(); new DataView(version.buffer).setUint32(8, 99, true); await assert.rejects(P.decode(version), /Unsupported project version/);
  const total = bytes.slice(); new DataView(total.buffer).setUint32(24, bytes.length + 1, true); await assert.rejects(P.decode(total), /framing/);
  const huge = bytes.slice(); new DataView(huge.buffer).setUint32(16, P.LIMITS.maxMetadataBytes + 1, true); await assert.rejects(P.decode(huge), /metadata byte length/);
  await assert.rejects(P.decode(rebuild(bytes, d => { d.format = 'something-else'; })), /Unknown project format/);
  await assert.rejects(P.decode(rebuild(bytes, d => { d.version = 99; })), /version mismatch/);
});
test('unknown keys, prototypes, getters, functions, symbols, cycles and nonfinite settings are rejected', async () => {
  for (const mutate of [
    p => { p.settings.exposure = NaN; }, p => { p.settings.smooth = Infinity; }, p => { p.settings.bgBlur = 51; },
    p => { p.settings.extra = 1; }, p => { p.path = '/private/photo.jpg'; }, p => { p.settings.toJSON = () => ({}); },
    p => { Object.defineProperty(p.settings, 'exposure', { get() { throw new Error('getter must not execute'); }, enumerable: true }); },
    p => { p.settings = Object.create({ inherited: true }); }, p => { p.settings[Symbol('hidden')] = 1; },
    p => { p.settings.spots = [undefined]; }, p => { p.settings.spots = new Array(1); }, p => { p.settings.spots.extra = true; },
    p => { p.settings.learnedMatteStrokes = [p.settings]; }
  ]) { const input = fixture(); mutate(input.photos[0]); await assert.rejects(P.encode(input), e => e.name === 'ProjectFormatError' && !/getter must not execute/.test(e.message)); }
  const bytes = await P.encode(fixture());
  for (const key of ['__proto__','constructor','prototype']) await assert.rejects(P.decode(rebuild(bytes, d => { Object.defineProperty(d.photos[0].settings, key, { value: { polluted: true }, enumerable: true }); })), /unsafe/);
  assert.equal({}.polluted, undefined);
});
test('history, reference, cache, ownership and source dimension checks are strict', async () => {
  for (const [label, mutate] of [
    ['history', p => { p.undo = Array.from({ length: 41 }, () => settings()); }],
    ['missing matte', p => { p.undo[0].learnedMatteId = 'missing'; }],
    ['missing parse', p => { p.redo[0].diagnosticParseId = 'missing'; }],
    ['ownership', p => { p.learnedCache[0].photoId = 'another-photo'; }],
    ['revision', p => { p.learnedCache[0].sourceRevision = 'stale'; }],
    ['pixels', p => { p.learnedCache[0].originalSize.width = 5; }],
    ['cache bytes', p => { p.learnedCache[0].bytes--; }],
    ['source size', p => { p.source.width = 3; }],
    ['source byte size', p => { p.source.byteLength = 999; }],
    ['mime', p => { p.source.mime = 'image/jpeg'; }],
    ['matte ROI', p => { p.learnedCache[0].result.matte.roi.x = 1; }],
    ['edited cached matte', p => { p.learnedCache[0].result.matte.correction = { learned: false }; }],
    ['unaccepted foreground', p => { p.learnedCache[0].result.foreground = {}; }],
    ['NaN probability', p => { p.learnedCache[0].result.matte.data[0] = NaN; }],
    ['range probability', p => { p.learnedCache[0].result.matte.data[0] = -1; }],
    ['complement', p => { p.learnedCache[1].result.protected[0] = 0; }],
    ['policy', p => { p.learnedCache[1].result.provenance.maskPolicy.guard.radiusPx = 1; }],
    ['selection', p => { p.learnedCache[1].result.provenance.selection.faceId = 'other:face-0'; }],
    ['nose', p => { p.learnedCache[1].result.provenance.maskClasses.skin = ['skin']; }],
    ['not model', p => { p.learnedCache[0].result.provenance.kind = 'fake-model'; }],
    ['duplicate cache', p => { p.learnedCache.push(p.learnedCache[0]); }],
    ['last matte', p => { p.lastSelectedMatteId = 'missing'; }]
  ]) { const input = fixture(true); mutate(input.photos[0]); await assert.rejects(P.encode(input), { name: 'ProjectFormatError' }, label); }
  const many = fixture(); many.photos = Array.from({ length: 101 }, () => many.photos[0]); await assert.rejects(P.encode(many), /photos/);
  const duplicate = fixture(); duplicate.photos.push(duplicate.photos[0]); await assert.rejects(P.encode(duplicate), /Duplicate photo/);
  const missing = fixture(); missing.currentId = 'missing'; await assert.rejects(P.encode(missing), /Current photo/);
});
test('brush corrections are explicit original-pixel operations with bounded sizes and work', async () => {
  for (const mutate of [s => { s.radiusPx = 2; }, s => { s.hardness = NaN; }, s => { s.opacity = 2; }, s => { s.points[0].x = 100; }, s => { s.points = []; }, s => { s.points = Array.from({ length: 513 }, () => ({ x: 1, y: 1 })); }]) {
    const input = fixture(true); mutate(input.photos[0].settings.learnedMatteStrokes[0]); await assert.rejects(P.encode(input), { name: 'ProjectFormatError' });
  }
  const many = fixture(true); many.photos[0].settings.learnedMatteStrokes = Array(65).fill(many.photos[0].settings.learnedMatteStrokes[0]); await assert.rejects(P.encode(many), /strokes/);
  const disabled = fixture(true); disabled.photos[0].settings.learnedMatteId = null; assert.equal((await P.decode(await P.encode(disabled))).photos[0].settings.learnedMatteStrokes.length, 1, 'disabling a learned matte must not discard its corrections');
});
test('blob aliases, unused blobs, overlaps, wrong encodings and forged source identity are rejected', async () => {
  const bytes = await P.encode(fixture(true));
  for (const mutate of [
    d => { d.blobs[1].offset--; }, d => { d.blobs[1].kind = 'javascript'; }, d => { d.photos[0].source.bytes = 'missing'; },
    d => { d.photos[0].source.sha256 = 'b'.repeat(64); }, d => { d.photos[0].learnedCache[1].result.protected = d.photos[0].learnedCache[1].result.skin; },
    d => { d.photos[0].learnedCache.pop(); d.photos[0].settings.diagnosticParseId = null; d.photos[0].settings.diagnosticOverlay = false; d.photos[0].committed.diagnosticParseId = null; d.photos[0].committed.diagnosticOverlay = false; },
    d => { d.blobs[0].byteLength = P.LIMITS.maxPhotoBytes + 1; }
  ]) await assert.rejects(P.decode(rebuild(bytes, mutate)), { name: 'ProjectFormatError' });
});
test('header inspection handles offset views and validates framing without reading a whole file', async () => {
  const bytes = await P.encode(fixture()), padded = Buffer.concat([Buffer.from([1,2,3]), bytes, Buffer.from([4])]);
  assert.equal(P.inspectHeader(padded.subarray(3, 67)).byteLength, bytes.length);
  assert.deepEqual(await P.decode(padded.subarray(3, 3 + bytes.length)), await P.decode(bytes));
});
test('image header validation respects EXIF orientation and rejects truncation or mismatched dimensions', async () => {
  const input = fixture(); input.photos[0].source.bytes = png(4, 3, exif(6)); input.photos[0].source.width = 3; input.photos[0].source.height = 4;
  assert.equal(P.inspectImage(input.photos[0].source.bytes, 'image/png').orientation, 6); assert.equal((await P.decode(await P.encode(input))).photos[0].source.width, 3);
  input.photos[0].source.width = 4; input.photos[0].source.height = 3; await assert.rejects(P.encode(input), /oriented image header/);
  assert.throws(() => P.inspectImage(png().subarray(0, 30), 'image/png'), /PNG/);
  assert.throws(() => P.inspectImage(png(4, 3, exif(9)), 'image/png'), /orientation/);
  assert.throws(() => P.inspectImage(Buffer.from('<svg></svg>'), 'image/png'), /signature/);
});
test('JPEG and WebP header signatures/dimensions are bounded without executing a decoder', () => {
  const jpeg = Buffer.from([255,216, 255,192, 0,11, 8,0,3,0,4,1,1,0x11,0, 255,218,0,2,255,217]);
  assert.deepEqual(P.inspectImage(jpeg, 'image/jpeg'), { mime: 'image/jpeg', encodedWidth: 4, encodedHeight: 3, orientation: 1, width: 4, height: 3 });
  const riff = Buffer.alloc(26); riff.write('RIFF'); riff.writeUInt32LE(18,4); riff.write('WEBPVP8L',8); riff.writeUInt32LE(5,16); riff[20] = 0x2f; riff.writeUInt32LE(3 | (2 << 14),21);
  assert.equal(P.inspectImage(riff, 'image/webp').width, 4); riff.writeUInt32LE(17,4); assert.throws(() => P.inspectImage(riff,'image/webp'), /length mismatch/);
});
test('declared image geometry above processing limits is preserved, not falsely treated as learned full resolution', async () => {
  const input = fixture(), bytes = png(); bytes.writeUInt32BE(5000, 16); input.photos[0].source.bytes = bytes; input.photos[0].source.width = 5000;
  // Header-only codec validation intentionally does not replace the application's actual image decoder.
  assert.equal((await P.decode(await P.encode(input))).photos[0].source.width, 5000);
  bytes.writeUInt32BE(65536, 16); input.photos[0].source.width = 65536; await assert.rejects(P.encode(input), /width/);
});
test('invalid UTF-8, excessive nesting and unsafe provenance cannot become executable state', async () => {
  const bytes = await P.encode(fixture()), bad = bytes.slice(), h = P.inspectHeader(bytes); bad[64] = 0xff; Buffer.from(digest(bad.subarray(64,64+h.metadataBytes)), 'hex').copy(bad, 32); await assert.rejects(P.decode(bad), /UTF-8 JSON/);
  const nested = fixture(true); let root = {}; nested.photos[0].learnedCache[0].result.provenance.executionProfile = root; for (let i=0;i<20;i++) { root.next = {}; root = root.next; } await assert.rejects(P.encode(nested), /nesting/);
  const unsafe = fixture(true); unsafe.photos[0].learnedCache[0].result.provenance.executionProfile = JSON.parse('{"__proto__":{"evil":true}}'); await assert.rejects(P.encode(unsafe), /unsafe/);
});
test('typed-buffer getters, subclasses and shared buffers cannot execute or race validation', async () => {
  const attack = fixture(); Object.defineProperty(attack.photos[0].source.bytes, 'buffer', { get() { throw new Error('untrusted getter executed'); } });
  await assert.rejects(P.encode(attack), /Unsafe binary property/);
  const subclass = fixture(true); class StrangePlane extends Float32Array { [Symbol.iterator]() { throw new Error('untrusted iterator executed'); } } subclass.photos[0].learnedCache[0].result.matte.data = new StrangePlane(12);
  await assert.rejects(P.encode(subclass), /Unsupported binary subclass/);
  const iterator = fixture(true); iterator.photos[0].learnedCache[0].result.matte.data[Symbol.iterator] = () => { throw new Error('untrusted iterator executed'); };
  await assert.rejects(P.encode(iterator), /Unsafe binary property/);
  const shared = fixture(); shared.photos[0].source.bytes = new Uint8Array(new SharedArrayBuffer(100)); await assert.rejects(P.encode(shared), /Shared buffers/);
});
test('duplicate JSON keys are rejected even if a hostile file recomputes its metadata hash', async () => {
  const encoded = await P.encode(fixture()), h = P.inspectHeader(encoded), header = Buffer.from(encoded.subarray(0, 64));
  const old = Buffer.from(encoded.subarray(64,64+h.metadataBytes)).toString(), json = Buffer.from(old.replace(`"version":${P.VERSION}`, `"version":${P.VERSION},"version":${P.VERSION}`));
  header.writeUInt32LE(json.length,16); header.writeUInt32LE(64+json.length+h.payloadBytes,24); Buffer.from(digest(json),'hex').copy(header,32);
  await assert.rejects(P.decode(Buffer.concat([header,json,encoded.subarray(64+h.metadataBytes)])), /duplicate-key/);
});
test('optional legacy matting result kind is preserved but cannot name an incompatible result', async () => {
  const input = fixture(true); input.photos[0].learnedCache[0].result.kind = 'matting'; const output = await P.decode(await P.encode(input)); assert.equal(output.photos[0].learnedCache[0].result.kind, 'matting');
  input.photos[0].learnedCache[0].result.kind = 'face-masks'; await assert.rejects(P.encode(input), /matting result kind/);
});
test('exact photo/history/cache-count ceilings work and the next entry is refused, never dropped', async () => {
  const one = fixture().photos[0], many = { version: P.VERSION, currentId: null, photos: Array.from({ length: 100 }, (_, i) => ({ ...one, id: `photo-${i}`, sourceRevision: `photo-${i}:source-0` })) };
  assert.equal((await P.decode(await P.encode(many))).photos.length, 100);
  const history = fixture(); history.photos[0].undo = Array.from({ length: 40 }, (_, i) => settings({ exposure: i })); history.photos[0].redo = Array.from({ length: 40 }, (_, i) => settings({ exposure: -i }));
  const restored = await P.decode(await P.encode(history)); assert.equal(restored.photos[0].undo.length, 40); assert.equal(restored.photos[0].redo.length, 40);
  const caches = fixture(true), p = caches.photos[0], matte = p.learnedCache[0]; p.learnedCache.push(...Array.from({ length: 510 }, (_, i) => ({ ...matte, id: `extra-${i}` })));
  assert.equal((await P.decode(await P.encode(caches))).photos[0].learnedCache.length, 512); p.learnedCache.push({ ...matte, id: 'extra-over-limit' }); await assert.rejects(P.encode(caches), /learned cache/);
});
test('byte, pixel and provenance ceilings fail before unsafe allocation or model loading', async () => {
  const tooLarge = fixture(); tooLarge.photos[0].source.bytes = new Uint8Array(P.LIMITS.maxPhotoBytes + 1); await assert.rejects(P.encode(tooLarge), /source byte size/);
  const dimensions = fixture(); dimensions.photos[0].source.width = 20000; dimensions.photos[0].source.height = 20000; await assert.rejects(P.encode(dimensions), /pixel limit/);
  const learned = fixture(true); learned.photos[0].learnedCache[0].originalSize.width = 4097; await assert.rejects(P.encode(learned), /width/);
  const provenance = fixture(true); provenance.photos[0].learnedCache[0].result.provenance.executionProfile = { description: 'x'.repeat(32769) }; await assert.rejects(P.encode(provenance), /string too long/);
});

test('v1 projects migrate to the current format without changing embedded source, history or identity', async () => {
 const input=fixture(), encoded=await P.encode(input);
 const legacy=rebuild(encoded,doc=>{doc.version=1;for(const photo of doc.photos)delete photo.review;for(const p of doc.photos)for(const s of [p.settings,p.committed,...p.undo,...p.redo])for(const k of ['underEye','redness','lip','blush','palette','localLayers','manualSelection','manualLiquify','manualRepair','advancedTone'])delete s[k];});
 legacy.writeUInt32LE(1,8);
 const out=await P.decode(legacy);assert.equal(out.version,P.VERSION);assert.equal(out.photos[0].settings.palette,'natural');assert.deepEqual(out.photos[0].settings.localLayers,[]);assert.deepEqual(out.photos[0].source.bytes,input.photos[0].source.bytes);assert.equal(out.photos[0].sourceRevision,input.photos[0].sourceRevision);
 const next=await P.encode(out);assert.equal(P.inspectHeader(next).version,P.VERSION);
});
test('source-bound local layers round-trip and reject cross-photo or nonfinite masks',async()=>{
 const input=fixture(),p=input.photos[0];p.settings.localLayers=[{id:'layer-1',name:'局部提亮',enabled:true,opacity:.6,sourceRevision:p.sourceRevision,adjustments:{exposure:15,contrast:0,saturation:0,temperature:0},mask:{kind:'radial',cx:.5,cy:.4,rx:.3,ry:.2,feather:.8}}];
 assert.deepEqual((await P.decode(await P.encode(input))).photos[0].settings.localLayers,p.settings.localLayers);
 p.settings.localLayers[0].sourceRevision='another-photo';await assert.rejects(P.encode(input),/source revision/);
 p.settings.localLayers[0].sourceRevision=p.sourceRevision;p.settings.localLayers[0].mask.cx=NaN;await assert.rejects(P.encode(input),/cx/);
});


test('v2 projects preserve face colors and local layers while adding independent empty manual state',async()=>{
 const input=fixture(),p=input.photos[0];p.settings.underEye=17;p.settings.palette='peach';p.settings.localLayers=[{id:'layer-v2',name:'Saved local color',enabled:true,opacity:.6,sourceRevision:p.sourceRevision,adjustments:{exposure:12,contrast:0,saturation:0,temperature:0},mask:{kind:'radial',cx:.5,cy:.4,rx:.3,ry:.2,feather:.8}}];p.undo=[settings({redness:9})];p.redo=[settings({lip:3})];
 const encoded=await P.encode(input),legacy=rebuild(encoded,doc=>{doc.version=2;for(const photo of doc.photos)delete photo.review;for(const photo of doc.photos)for(const state of [photo.settings,photo.committed,...photo.undo,...photo.redo])for(const key of ['manualSelection','manualLiquify','manualRepair','advancedTone'])delete state[key];});legacy.writeUInt32LE(2,8);
 const out=await P.decode(legacy);assert.equal(out.version,P.VERSION);assert.deepEqual(out.photos[0].source.bytes,p.source.bytes);assert.deepEqual(out.photos[0].settings.localLayers,p.settings.localLayers);assert.equal(out.photos[0].settings.underEye,17);assert.equal(out.photos[0].settings.palette,'peach');assert.equal(out.photos[0].undo[0].redness,9);assert.equal(out.photos[0].redo[0].lip,3);
 for(const state of [out.photos[0].settings,out.photos[0].committed,...out.photos[0].undo,...out.photos[0].redo]){assert.equal(state.manualSelection,null);assert.deepEqual(state.manualLiquify,[]);assert.deepEqual(state.manualRepair,[]);}
 out.photos[0].settings.manualRepair.push('test mutation');assert.deepEqual(out.photos[0].committed.manualRepair,[]);
});
