'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { EventEmitter } = require('node:events'), { Worker } = require('node:worker_threads'), zlib = require('node:zlib');
const ROOT = path.resolve(__dirname, '..');
const sharp = require(path.join(ROOT, 'node_modules/sharp')), Project = require(path.join(ROOT, 'src/project-document.cjs'));
const Overlay = require(require.resolve('../src/image-overlay.cjs'));
const codec = require('../src/image-assets.cjs').createCodec({ overlay: Overlay });
const Guard = require('../image-import-guards.cjs'), { decodeEncodedImage } = require('../image-import-decode.cjs'), { createImageImportService } = require('../image-import.cjs');
const directory = fs.mkdtempSync(path.join(__dirname, 'runtime-'));
const req = id => ({ requestId: id, sourceRevision: 'source:revision-1' });
const decode = bytes => decodeEncodedImage(bytes, { sharp, inspectImage: Project.inspectImage });
const rgba = Buffer.from([240, 40, 20, 255, 100, 150, 200, 128, 0, 80, 160, 0, 4, 5, 6, 255]);
let png, jpeg, webp, oriented, large, apng, animated;
function chunk(type, payload) { const b = Buffer.alloc(payload.length + 12); b.writeUInt32BE(payload.length); b.write(type, 4); payload.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + payload.length)), 8 + payload.length); return b; }
function chunks(bytes) { const out = []; for (let p = 8; p < bytes.length;) { const n = bytes.readUInt32BE(p); out.push({ type: bytes.toString('ascii', p + 4, p + 8), data: bytes.subarray(p + 8, p + 8 + n) }); p += n + 12; } return out; }
function makeApng(source) {
  const cs = chunks(source), ihdr = cs.find(c => c.type === 'IHDR').data, idat = Buffer.concat(cs.filter(c => c.type === 'IDAT').map(c => c.data));
  const ac = Buffer.alloc(8); ac.writeUInt32BE(2, 0);
  function fc(seq) { const out = Buffer.alloc(26); out.writeUInt32BE(seq); out.writeUInt32BE(2, 4); out.writeUInt32BE(2, 8); out.writeUInt16BE(1, 20); out.writeUInt16BE(10, 22); return out; }
  const fd = Buffer.alloc(idat.length + 4); fd.writeUInt32BE(2); idat.copy(fd, 4);
  return Buffer.concat([source.subarray(0, 8), chunk('IHDR', ihdr), chunk('acTL', ac), chunk('fcTL', fc(0)), chunk('IDAT', idat), chunk('fcTL', fc(1)), chunk('fdAT', fd), chunk('IEND', Buffer.alloc(0))]);
}
function save(name, bytes) { const f = path.join(directory, name); fs.writeFileSync(f, bytes); return f; }
function serviceFor(filePath, options = {}) {
  return createImageImportService({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }) }, getWindow: () => null,
    codec, inspectImage: Project.inspectImage, workerPath: path.join(directory, 'image-import-worker.cjs'), ...options });
}
test.before(async () => {
  sharp.cache(false); sharp.concurrency(1);
  png = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ef8d53' } }).jpeg().toBuffer();
  webp = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).webp({ lossless: true }).toBuffer();
  oriented = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ef8d53' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  large = await sharp({ create: { width: 2048, height: 1024, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 0.5 } } }).png().toBuffer();
  apng = makeApng(png);
  animated = await sharp(Buffer.concat([rgba, Buffer.from([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255])]), { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ lossless: true, delay: [100, 100], loop: 0 }).toBuffer();
  fs.mkdirSync(path.join(directory, 'src')); fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  for (const name of ['image-import-worker.cjs', 'image-import-decode.cjs', 'image-import-guards.cjs']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(directory, name));
  fs.copyFileSync(path.join(ROOT, 'src/project-document.cjs'), path.join(directory, 'src/project-document.cjs'));
});
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
test('real Sharp PNG/JPEG/WebP decode gives bounded 8-bit straight-alpha sRGB', async () => {
  for (const bytes of [png, jpeg, webp]) {
    const value = await decode(bytes); assert.equal(value.data.length, value.width * value.height * 4);
    assert.deepEqual(Object.keys(value), ['width', 'height', 'data', 'details']); assert.equal(value.details.metadataPreserved, false);
    assert.equal(value.details.color, '8-bit sRGB'); assert.equal(value.details.alpha, 'straight');
  }
  const p = await decode(png); assert.deepEqual(Array.from(p.data.subarray(0, 8)), Array.from(rgba.subarray(0, 8)));
  assert.equal(p.data[11], 0); assert.equal(p.width, 2); assert.equal(p.height, 2);
});
test('EXIF orientation is applied and encoded/oriented geometry is explicit', async () => {
  const p = await decode(oriented); assert.equal(p.width, 2); assert.equal(p.height, 3);
  assert.equal(p.details.encodedWidth, 3); assert.equal(p.details.encodedHeight, 2);
  assert.equal(p.details.sourceWidth, 2); assert.equal(p.details.sourceHeight, 3); assert.equal(p.details.orientationApplied, true);
  assert.equal(Object.keys(p).some(k => /exif|xmp|icc|path/i.test(k)), false);
});
test('working overlay only downsizes while preserving aspect and straight alpha', async () => {
  const p = await decode(large); assert.equal(p.width, 1024); assert.equal(p.height, 512); assert.equal(p.details.resized, true);
  assert.equal(p.data[3], 128); for (const [i, expected] of [100, 150, 200].entries()) assert.ok(Math.abs(p.data[i] - expected) <= 1);
  const one = await decode(await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer()); assert.equal(one.width, 1);
});
test('valid APNG, frame markers and animated WebP reject before native decoder creation', async () => {
  assert.ok((await sharp(animated, { animated: true }).metadata()).pages > 1);
  for (const bytes of [apng, animated]) {
    let called = false; await assert.rejects(decodeEncodedImage(bytes, { sharp() { called = true; throw Error('decoder should not run'); }, inspectImage: Project.inspectImage }), { code: 'IMAGE_IMPORT_ANIMATED' }); assert.equal(called, false);
  }
  for (const type of ['acTL', 'fcTL', 'fdAT']) {
    const injected = Buffer.concat([png.subarray(0, 33), chunk(type, Buffer.alloc(8)), png.subarray(33)]);
    assert.throws(() => Guard.inspectEncoded(injected, Project.inspectImage), { code: 'IMAGE_IMPORT_ANIMATED' });
  }
});
test('oversize edges/pixels, encoded bytes, malformed and truncated inputs fail before decode', async () => {
  for (const [width, height] of [[8193, 1], [6000, 5000]]) {
    const bad = Buffer.from(png); bad.writeUInt32BE(width, 16); bad.writeUInt32BE(height, 20);
    let called = false; await assert.rejects(decodeEncodedImage(bad, { sharp() { called = true; }, inspectImage: Project.inspectImage }), { code: 'IMAGE_IMPORT_LIMIT' }); assert.equal(called, false);
  }
  const bad = [png.subarray(0, png.length - 1), jpeg.subarray(0, jpeg.length - 2), webp.subarray(0, webp.length - 1), Buffer.concat([jpeg, jpeg]), Buffer.concat([png, Buffer.from([0])]), Buffer.from('GIF89a')];
  for (const bytes of bad) await assert.rejects(decode(bytes));
  assert.throws(() => Guard.inspectEncoded(new Uint8Array(32 * 1024 * 1024 + 1), Project.inspectImage), { code: 'IMAGE_IMPORT_LIMIT' });
  const corrupt = Buffer.from(png); corrupt[corrupt.length - 20] ^= 0xff; await assert.rejects(decode(corrupt));
});
test('compressed PNG metadata bomb is discarded or bounded before native parsing', async () => {
  const bomb = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024, 65));
  const textBomb = Buffer.concat([png.subarray(0, 33), chunk('zTXt', Buffer.concat([Buffer.from('comment\0\0'), bomb])), png.subarray(33)]);
  assert.equal((await decode(textBomb)).width, 2);
  const profileBomb = Buffer.concat([png.subarray(0, 33), chunk('iCCP', Buffer.concat([Buffer.from('profile\0\0'), bomb])), png.subarray(33)]);
  let called = false; await assert.rejects(decodeEncodedImage(profileBomb, { sharp() { called = true; }, inspectImage: Project.inspectImage }), { code: 'IMAGE_IMPORT_LIMIT' }); assert.equal(called, false);
});
test('native worker import returns verified raw identity with no path/original bytes and cleans worker', async () => {
  const file = save('synthetic-transparent.png', png), service = serviceFor(file); const result = await service.importImage(req('real-worker'));
  assert.equal(result.requestId, 'real-worker'); assert.equal(result.sourceRevision, 'source:revision-1'); assert.equal(result.label, 'synthetic-transparent.png');
  await codec.verify(result.asset); assert.equal(result.asset.width, 2); assert.equal(result.asset.height, 2);
  assert.equal(JSON.stringify(result).includes(directory), false); assert.equal(JSON.stringify(result).includes('filePaths'), false); assert.equal(service.isBusy(), false); service.dispose();
});
test('chooser cancellation, no caller paths, extra fields, symlinks and oversize files', async () => {
  const file = save('safe.png', png), never = () => { throw Error('Worker must not be created'); };
  const service = serviceFor(file, { workerFactory: never });
  await assert.rejects(service.importImage({ ...req('arbitrary'), path: file }));
  const cancelled = serviceFor(file, { dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, workerFactory: never }); assert.equal(await cancelled.importImage(req('cancel-dialog')), null);
  const link = path.join(directory, 'link.png'); fs.symlinkSync(file, link); await assert.rejects(serviceFor(link, { workerFactory: never }).importImage(req('link')));
  const huge = path.join(directory, 'huge.png'); fs.writeFileSync(huge, 'x'); fs.truncateSync(huge, 32 * 1024 * 1024 + 1); await assert.rejects(serviceFor(huge, { workerFactory: never }).importImage(req('huge')), { code: 'IMAGE_IMPORT_LIMIT' });
});
class MockWorker extends EventEmitter { terminated = 0; terminate() { this.terminated++; return Promise.resolve(0); } }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw Error('Test timed out waiting for worker'); }
test('cancel, replacement, timeout and quit terminate worker and reject stale results', async () => {
  const file = save('cancel-source.png', png), workers = [];
  const service = serviceFor(file, { workerFactory: () => { const w = new MockWorker(); workers.push(w); return w; } });
  const first = service.importImage(req('one')); const rejectedFirst = assert.rejects(first, { code: 'IMAGE_IMPORT_CANCELLED' }); await until(() => workers.length === 1);
  const second = service.importImage(req('two')); const rejectedSecond = assert.rejects(second, { code: 'IMAGE_IMPORT_CANCELLED' }); await rejectedFirst; await until(() => workers.length === 2); assert.equal(workers[0].terminated, 1);
  assert.equal(service.cancel('wrong'), false); assert.equal(service.cancel('two'), true); await rejectedSecond; assert.equal(workers[1].terminated, 1);
  workers[0].emit('message', { ok: true }); await tick(); assert.equal(service.isBusy(), false);
  const third = service.importImage(req('three')); const rejectedThird = assert.rejects(third, { code: 'IMAGE_IMPORT_CANCELLED' }); await until(() => workers.length === 3); service.dispose(); await rejectedThird; assert.equal(workers[2].terminated, 1);
  await assert.rejects(service.importImage(req('after-quit')), { code: 'IMAGE_IMPORT_CLOSED' });
  const timeout = serviceFor(file, { workerFactory: () => new MockWorker(), timeoutMs: 5 });
  const keepAlive = setTimeout(() => {}, 100); await assert.rejects(timeout.importImage(req('timeout')), { code: 'IMAGE_IMPORT_TIMEOUT' }); clearTimeout(keepAlive);
});
test('cancel while chooser is pending ignores its eventual selected file', async () => {
  let choose; const service = serviceFor('/never/read', { dialog: { showOpenDialog: () => new Promise(resolve => { choose = resolve; }) } });
  const pending = service.importImage(req('pending-dialog')), rejection = assert.rejects(pending, { code: 'IMAGE_IMPORT_CANCELLED' }); service.cancel(); await rejection;
  choose({ canceled: false, filePaths: ['/never/read'] }); await tick(); assert.equal(service.isBusy(), false);
});
test('real worker cancellation is terminating native execution, not renderer-only ignoring', async () => {
  const workers = []; const service = serviceFor(save('native-cancel.png', large), { workerFactory: (file, options) => { const w = new Worker(file, options); workers.push(w); return w; } });
  const pending = service.importImage(req('native-cancel')), rejection = assert.rejects(pending, { code: 'IMAGE_IMPORT_CANCELLED' }); await until(() => workers.length === 1); service.cancel(); await rejection;
  const code = await workers[0].terminate(); assert.ok(Number.isInteger(code) || code === undefined);
});
test('worker envelope getters, extra identities and forged geometry are rejected', async () => {
  const file = save('worker-forgery.png', png), valid = await decode(png); let getterRan = false;
  const unsafe = { ...valid }; Object.defineProperty(unsafe, 'ok', { enumerable: true, get() { getterRan = true; return true; } });
  for (const result of [unsafe, { ok: true, ...valid, id: 'renderer-claimed' }, { ok: true, ...valid, width: 99 }, { ok: true, ...valid, data: new Uint8Array(new SharedArrayBuffer(16)) }]) {
    const service = serviceFor(file, { workerFactory: () => { const w = new MockWorker(); setImmediate(() => w.emit('message', result)); return w; } });
    await assert.rejects(service.importImage(req('forged')), { code: 'IMAGE_IMPORT_INVALID' });
  }
  assert.equal(getterRan, false);
});
test('file replacement between lstat/open and file growth during read are rejected', async () => {
  const file = save('race.png', png), alternate = save('race-alternate.png', png), originalOpen = fs.promises.open;
  let workers = 0;
  try {
    fs.promises.open = async function (target, ...args) {
      if (target === file) { fs.renameSync(file, file + '.old'); fs.renameSync(alternate, file); }
      return originalOpen.call(this, target, ...args);
    };
    await assert.rejects(serviceFor(file, { workerFactory() { workers++; } }).importImage(req('replace-race')), { code: 'IMAGE_IMPORT_READ' });
  } finally { fs.promises.open = originalOpen; }
  try {
    fs.promises.open = async function (target, ...args) {
      const handle = await originalOpen.call(this, target, ...args);
      if (target === file) {
        const read = handle.read.bind(handle); let changed = false;
        handle.read = async (...params) => { const result = await read(...params); if (!changed) { changed = true; fs.appendFileSync(file, Buffer.from([1])); } return result; };
      }
      return handle;
    };
    await assert.rejects(serviceFor(file, { workerFactory() { workers++; } }).importImage(req('growth-race')), { code: 'IMAGE_IMPORT_READ' });
  } finally { fs.promises.open = originalOpen; }
  assert.equal(workers, 0);
});
test('actual Sharp-generated oversized PNG files are stopped before decoder invocation', async () => {
  for (const [width, height] of [[8193, 1], [6000, 4001]]) {
    const source = await sharp({ create: { width, height, channels: 3, background: '#22aa44' } }).png().toBuffer();
    let called = false; await assert.rejects(decodeEncodedImage(source, { sharp() { called = true; }, inspectImage: Project.inspectImage }), { code: 'IMAGE_IMPORT_LIMIT' }); assert.equal(called, false);
  }
});
test('real 16-bit PNG is converted to explicit 8-bit working RGBA', async () => {
  const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#12aaed' } }).toColourspace('rgb16').png().toBuffer();
  assert.equal((await sharp(source).metadata()).depth, 'ushort');
  const result = await decode(source); assert.equal(result.data.length, 16); assert.equal(result.details.color, '8-bit sRGB'); assert.deepEqual(Array.from(result.data.subarray(0, 4)), [18, 170, 237, 255]);
});
test('embedded Display P3 profile converts to sRGB before metadata is discarded', async () => {
  const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#88aa55' } }).withIccProfile('p3').png().toBuffer();
  assert.equal((await sharp(source).metadata()).hasProfile, true);
  const result = await decode(source); for (const [i, expected] of [136, 170, 85].entries()) assert.ok(Math.abs(result.data[i] - expected) <= 2);
  assert.equal(result.details.metadataPreserved, false);
});
