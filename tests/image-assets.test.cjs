'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), vm = require('node:vm');
const overlayPath = require.resolve('../src/image-overlay.cjs');
const Overlay = require(overlayPath), Assets = require('../src/image-assets.cjs'), codec = Assets.createCodec({ overlay: Overlay });
const image = () => ({ width: 1, height: 1, data: new Uint8Array([20, 80, 120, 128]) });
test('frozen canonical codec roundtrip and explicit dimension-bound SHA-256 identity', async () => {
  const input = image(), a = await codec.createAsset(input);
  assert.deepEqual(Object.keys(a), ['id', 'version', 'width', 'height', 'data']); assert.ok(Object.isFrozen(a));
  const identity = Buffer.concat([Buffer.from('mint-rgba-asset-v1\0'), Buffer.from([1, 0, 0, 0, 1, 0, 0, 0]), Buffer.from(input.data)]);
  assert.equal(a.id, 'rgba-' + crypto.createHash('sha256').update(identity).digest('hex'));
  assert.deepEqual(codec.identityBytes(input), new Uint8Array(identity));
  assert.deepEqual(await codec.verify(a), a); assert.deepEqual(codec.toRaw(a).data, new Uint8ClampedArray(input.data));
  assert.deepEqual(await codec.fromRaw({ id: a.id, ...input }), a);
  assert.deepEqual(codec.toOverlayAsset(a), Overlay.encodeAsset(input));
  const data = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  assert.notEqual((await codec.createAsset({ width: 1, height: 2, data })).id, (await codec.createAsset({ width: 2, height: 1, data })).id);
});
test('verify/fromRaw reject content and dimension identity mismatches', async () => {
  const a = await codec.createAsset(image()), b = await codec.createAsset({ ...image(), data: new Uint8Array([1, 2, 3, 4]) });
  await assert.rejects(codec.verify({ ...b, id: a.id }), { code: 'IMAGE_ASSET_IDENTITY' });
  await assert.rejects(codec.fromRaw({ id: a.id, ...image(), data: new Uint8Array(4) }), { code: 'IMAGE_ASSET_IDENTITY' });
});
test('raw input and identity are captured synchronously before digest await', async () => {
  let release; const delayed = Assets.createCodec({ overlay: Overlay, digest: bytes => new Promise(resolve => { release = () => resolve(crypto.createHash('sha256').update(bytes).digest('hex')); }) });
  const input = image(), expected = await codec.createAsset(input), pending = delayed.createAsset(input);
  input.data.fill(255); input.width = 999; release(); assert.deepEqual(await pending, expected);
  let releaseVerify; const delayedVerify = Assets.createCodec({ overlay: Overlay, digest: bytes => new Promise(resolve => { releaseVerify = () => resolve(crypto.createHash('sha256').update(bytes).digest('hex')); }) });
  const mutable = { ...expected }, verifying = delayedVerify.verify(mutable); mutable.data = 'AAAAAA=='; releaseVerify(); assert.deepEqual(await verifying, expected);
});
test('reject unsafe records, arrays, getters, subclasses, mutable/shared/detached buffers', async () => {
  const a = await codec.createAsset(image()); let touched = false;
  for (const record of [{ ...a, path: '/private/file.png' }, { ...a, uri: 'file:///private' }, { ...a, version: 2 }, Object.create(a)]) assert.throws(() => codec.validate(record));
  const getter = { ...a }; Object.defineProperty(getter, 'data', { enumerable: true, get() { touched = true; return a.data; } }); assert.throws(() => codec.validate(getter)); assert.equal(touched, false);
  const hidden = { ...a }; Object.defineProperty(hidden, 'data', { value: a.data, enumerable: false }); assert.throws(() => codec.validate(hidden));
  const list = [a]; list.extra = 1; assert.throws(() => codec.validateTable(list)); assert.throws(() => codec.validateTable(new Array(1)));
  const getList = [a]; Object.defineProperty(getList, 0, { get() { touched = true; return a; } }); assert.throws(() => codec.validateTable(getList)); assert.equal(touched, false);
  class Bytes extends Uint8Array {} class List extends Array {} assert.throws(() => codec.validateTable(new List(a)));
  const values = [new Bytes(4), new Uint8Array(new SharedArrayBuffer(4)), new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 }))];
  const shadow = new Uint8Array(4); Object.defineProperty(shadow, 'buffer', { get() { touched = true; return new ArrayBuffer(4); } }); values.push(shadow);
  const detached = new Uint8Array(4); structuredClone(detached, { transfer: [detached.buffer] }); values.push(detached);
  class Storage extends ArrayBuffer {} values.push(new Uint8Array(new Storage(4)));
  for (const data of values) await assert.rejects(codec.createAsset({ ...image(), data })); assert.equal(touched, false);
});
test('reject malformed/noncanonical base64, conflicting duplicates and bounded limits', async () => {
  const a = await codec.createAsset(image());
  for (const data of ['AQIDBB==', 'AQIDBA=\n', 'AQIDBA', 'AQIDBA--', 'data:image/png;base64,AQIDBA==']) assert.throws(() => codec.validate({ ...a, data }));
  const second = await codec.createAsset({ ...image(), data: new Uint8Array(4) });
  assert.throws(() => codec.validateTable([a, { ...second, id: a.id }]), { code: 'IMAGE_ASSET_CONFLICT' });
  assert.ok(Object.isFrozen(codec.validateTable([a, a]))); assert.throws(() => codec.validateTable(Array(17).fill(a)));
  await assert.rejects(codec.createAsset({ width: 1025, height: 1, data: new Uint8Array(4100) }));
  const large = await codec.createAsset({ width: 1024, height: 1024, data: new Uint8Array(4194304) });
  assert.equal(codec.validateTable(Array(8).fill(large)).length, 8); assert.throws(() => codec.validateTable(Array(9).fill(large)), { code: 'IMAGE_ASSET_LIMIT' });
});
test('digest injection is strict and validates result type/length', async () => {
  for (const digest of [null, 5, {}]) assert.throws(() => Assets.createCodec({ overlay: Overlay, digest }));
  for (const result of ['F'.repeat(64), 'a'.repeat(63), new Uint8Array(31), new Uint8Array(new SharedArrayBuffer(32)), new ArrayBuffer(32), { length: 32 }])
    await assert.rejects(Assets.createCodec({ overlay: Overlay, digest: () => result }).createAsset(image()));
  const injection = Assets.createCodec({ overlay: Overlay, digest: bytes => new Uint8Array(crypto.createHash('sha256').update(bytes).digest()) });
  assert.deepEqual(await injection.createAsset(image()), await codec.createAsset(image()));
});
test('browser UMD and official WebCrypto match Node identity', async () => {
  const context = vm.createContext({ crypto: crypto.webcrypto });
  vm.runInContext(fs.readFileSync(overlayPath, 'utf8'), context); vm.runInContext(fs.readFileSync(require.resolve('../src/image-assets.cjs'), 'utf8'), context);
  const found = await vm.runInContext("MintImageAssets.createCodec({overlay:MintImageOverlay}).createAsset({width:1,height:1,data:new Uint8Array([20,80,120,128])})", context);
  assert.equal(found.id, (await codec.createAsset(image())).id); assert.equal(found.data, (await codec.createAsset(image())).data);
});
