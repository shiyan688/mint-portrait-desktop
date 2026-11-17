'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createProjectStore, readBounded, atomicWrite, suggestedName } = require('../project-store.cjs');
const LIMIT = 1024 * 1024;
const sample = value => { const b = Buffer.alloc(128, value); b.write('MINTPROJ'); return b; };
const validate = async b => { if (Buffer.from(b).subarray(0, 8).toString() !== 'MINTPROJ') throw new Error('Invalid project'); return {}; };
async function fixture(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-project-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
function dialogs(file, overrides = {}) { return { showSaveDialog: async () => ({ canceled: false, filePath: file }), showOpenDialog: async () => ({ canceled: false, filePaths: [file] }), showMessageBox: async () => ({ response: 0 }), ...overrides }; }
const store = (file, options = {}) => createProjectStore({ dialog: dialogs(file), decode: validate, maxBytes: LIMIT, ...options });
test('project save/open uses trusted dialogs and exact embedded container bytes', async t => {
 const dir = await fixture(t), file = path.join(dir, '工作工程.mintproj'), bytes = sample(21);
 const s = store(file); const saved = await s.save({ bytes, suggestedName: 'name' });
 assert.equal(saved.canceled, false); assert.equal(saved.displayName, '工作工程.mintproj');
 assert.deepEqual(await fs.readFile(file), bytes); const opened = await s.open(); assert.deepEqual(Buffer.from(opened.bytes), bytes);
 assert.deepEqual((await fs.readdir(dir)).sort(), ['工作工程.mintproj']);
});
test('project save replaces valid project atomically, never mutates source photo', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'), photo = path.join(dir, 'original.png');
 await fs.writeFile(target, sample(2)); await fs.writeFile(photo, 'original bytes');
 await store(target).save({ bytes: sample(9) }); assert.deepEqual(await fs.readFile(target), sample(9)); assert.equal(await fs.readFile(photo, 'utf8'), 'original bytes');
});
test('save cancellation leaves existing file untouched', async t => {
 const dir = await fixture(t), file = path.join(dir, 'doc.mintproj'); await fs.writeFile(file, sample(2));
 const s = store(file, { dialog: dialogs(file, { showSaveDialog: async () => ({ canceled: true }) }) });
 assert.deepEqual(await s.save({ bytes: sample(3) }), { canceled: true }); assert.deepEqual(await fs.readFile(file), sample(2));
});
test('invalid payload is rejected before dialog and renderer path cannot be supplied', async () => {
 let called = 0; const s = store('/tmp/not-used.mintproj', { dialog: { showSaveDialog: async () => { called++; } } });
 await assert.rejects(s.save({ bytes: sample(1), path: '/tmp/a' }), /无效/);
 await assert.rejects(s.save({ bytes: new Uint8Array(65) }), /Invalid/);
 await assert.rejects(s.save({ bytes: new Uint8Array(LIMIT + 1) }), /大小/);
 assert.equal(called, 0);
});
test('unrecognized existing target and image extension are never overwritten', async t => {
 const dir = await fixture(t), target = path.join(dir, 'unknown.mintproj'); await fs.writeFile(target, Buffer.alloc(128, 33));
 await assert.rejects(store(target).save({ bytes: sample(1) }), /不是可验证/); assert.equal((await fs.readFile(target))[0], 33);
 const photo = path.join(dir, 'original.jpg'); await fs.writeFile(photo, sample(4));
 await assert.rejects(store(photo).save({ bytes: sample(1) }), /不会覆盖/); assert.deepEqual(await fs.readFile(photo), sample(4));
});
test('oversized and symlink project files fail before contents are read', async t => {
 const dir = await fixture(t), file = path.join(dir, 'large.mintproj'); await fs.writeFile(file, Buffer.alloc(1025));
 let reads = 0; const watched = { ...fs, open: async (...args) => { reads++; return fs.open(...args); } };
 await assert.rejects(readBounded(file, { fs: watched, maxBytes: 1024 }), /大小/); assert.equal(reads, 0);
 const link = path.join(dir, 'link.mintproj'); await fs.symlink(file, link);
 await assert.rejects(readBounded(link, { fs: watched, maxBytes: LIMIT }), /链接/); assert.equal(reads, 0);
});
test('write/sync failure keeps old project and removes only own temporary file', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'); await fs.writeFile(target, sample(2));
 const expected = await readBounded(target, { maxBytes: LIMIT });
 const failing = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (args[1] === 'wx') h.sync = async () => { throw new Error('Disk full'); }; return h; } };
 await assert.rejects(atomicWrite(target, sample(3), { fs: failing, maxBytes: LIMIT, expected }), /Disk full/);
 assert.deepEqual(await fs.readFile(target), sample(2)); assert.deepEqual(await fs.readdir(dir), ['doc.mintproj']);
});
test('rename failure does not unlink old project or use destructive fallback', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'); await fs.writeFile(target, sample(2));
 const expected = await readBounded(target, { maxBytes: LIMIT }); const failing = { ...fs, rename: async () => { throw new Error('Locked target'); } };
 await assert.rejects(atomicWrite(target, sample(3), { fs: failing, maxBytes: LIMIT, expected }), /Locked target/);
 assert.deepEqual(await fs.readFile(target), sample(2)); assert.deepEqual(await fs.readdir(dir), ['doc.mintproj']);
});
test('concurrent changed target is detected and not overwritten', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'); await fs.writeFile(target, sample(2));
 const expected = await readBounded(target, { maxBytes: LIMIT }); await fs.writeFile(target, sample(7));
 await assert.rejects(atomicWrite(target, sample(3), { maxBytes: LIMIT, expected }), /其他操作修改/); assert.deepEqual(await fs.readFile(target), sample(7));
});
test('new-file commit cannot overwrite target created after final preflight', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj');
 const racing = { ...fs, link: async (...args) => { await fs.writeFile(target, sample(7)); return fs.link(...args); } };
 await assert.rejects(atomicWrite(target, sample(3), { fs: racing, maxBytes: LIMIT }), { code: 'EEXIST' }); assert.deepEqual(await fs.readFile(target), sample(7));
});
test('abort before commit keeps old target and cleans temporary', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'); await fs.writeFile(target, sample(2));
 const expected = await readBounded(target, { maxBytes: LIMIT }), ctrl = new AbortController();
 const canceling = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (args[1] === 'wx') { const sync = h.sync.bind(h); h.sync = async () => { await sync(); ctrl.abort(); }; } return h; } };
 await assert.rejects(atomicWrite(target, sample(3), { fs: canceling, maxBytes: LIMIT, expected, signal: ctrl.signal }), { name: 'AbortError' });
 assert.deepEqual(await fs.readFile(target), sample(2)); assert.deepEqual(await fs.readdir(dir), ['doc.mintproj']);
});
test('directory durability failure is reported as committed, never falsely rolled back', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj');
 const failing = { ...fs, open: async (...args) => { if (args[0] === dir) throw new Error('No directory fsync'); return fs.open(...args); } };
 const result = await atomicWrite(target, sample(3), { fs: failing, maxBytes: LIMIT, platform: 'linux' });
 assert.equal(result.committed, true); assert.match(result.durabilityWarning, /替换成功/); assert.deepEqual(await fs.readFile(target), sample(3));
});
test('busy guard rejects simultaneous project dialogs and resets after failure', async () => {
 let release; const waiting = new Promise(r => { release = r; });
 const s = store('/tmp/not-used.mintproj', { dialog: dialogs('', { showOpenDialog: async () => { await waiting; return { canceled: true }; } }) });
 const first = s.open(); await assert.rejects(s.save({ bytes: sample(1) }), /正在进行/); release(); assert.deepEqual(await first, { canceled: true }); assert.equal(await s.confirmReplace(), false);
});
test('save request bytes are frozen before awaiting native dialog', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'), bytes = sample(3);
 const s = store(target, { dialog: dialogs(target, { showSaveDialog: async () => { bytes.fill(9); return { filePath: target, canceled: false }; } }) });
 await s.save({ bytes }); assert.deepEqual(await fs.readFile(target), sample(3));
});
test('replace confirmation defaults to safe cancellation and exposes no file path', async () => {
 let options; const s = store('/tmp/a.mintproj', { dialog: dialogs('', { showMessageBox: async (_win, value) => { options = value; return { response: 1 }; } }) });
 assert.equal(await s.confirmReplace(), true); assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
 assert.equal(suggestedName('../../original.jpg'), '.._.._original.jpg.mintproj');
});
test('framing preflight rejects corrupt file after reading only fixed header', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'); await fs.writeFile(target, Buffer.alloc(20000, 5));
 let readBytes = 0; const watched = { ...fs, open: async (...args) => { const h = await fs.open(...args), read = h.read.bind(h); h.read = async (...args) => { const r = await read(...args); readBytes += r.bytesRead; return r; }; return h; } };
 await assert.rejects(readBounded(target, { fs: watched, maxBytes: LIMIT, inspectHeader: () => { throw new Error('Bad framing'); } }), /Bad framing/);
 assert.equal(readBytes, 64);
});
test('valid-looking framing cannot allocate a different size than selected file', async t => {
 const dir = await fixture(t), target = path.join(dir, 'doc.mintproj'); await fs.writeFile(target, sample(1));
 await assert.rejects(readBounded(target, { maxBytes: LIMIT, inspectHeader: () => ({ byteLength: 999 }) }), /长度不一致/);
});
