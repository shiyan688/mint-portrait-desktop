'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib');
const P = require('../src/project-document.cjs');
const { createRecoveryStore, MAX_BYTES, FILES } = require('../recovery-store.cjs');
const pause = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const diskFull = () => Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c >>> 1 ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const body = Buffer.concat([Buffer.from(type), bytes]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(bytes.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out; }
function png() { const h = Buffer.alloc(13); h.writeUInt32BE(2); h.writeUInt32BE(1, 4); h[8] = 8; h[9] = 6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(Buffer.from([0,30,60,90,255,80,90,110,255]))), chunk('IEND', Buffer.alloc(0))]); }
async function sample(exposure = 0) {
  const settings = { ...P.DEFAULT_SETTINGS, exposure, spots: [] };
  return Buffer.from(await P.encode({ version: P.VERSION, currentId: 'synthetic-photo', photos: [{ id: 'synthetic-photo', name: 'authored-synthetic.png', sourceRevision: 'synthetic:source-0', source: { bytes: png(), mime: 'image/png', width: 2, height: 1 }, selected: true, settings, committed: settings, undo: [{ ...P.DEFAULT_SETTINGS, spots: [] }], redo: [], revision: 1, preset: null, imageAssets: [], learnedCache: [] }] }));
}
async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-recovery-test-')), root = path.join(base, 'owned-recovery');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const store = createRecoveryStore({ root, ...options });
  const file = slot => path.join(root, FILES[slot]);
  return { base, root, store, file };
}
async function enabled(t, options) { const f = await fixture(t, options); await f.store.configure({ enabled: true, budgetMiB: 128 }); return f; }
async function contents(f, slot) { return fs.readFile(f.file(slot)); }
async function assertNoTemps(f) { assert.deepEqual((await fs.readdir(f.root)).filter(n => n.endsWith('.tmp')), []); }

test('default is disabled, status is transparent, and a disabled save creates nothing', async t => {
 const f = await fixture(t), bytes = await sample(); const s = await f.store.status();
 assert.equal(s.enabled, false); assert.equal(s.budgetMiB, 128); assert.deepEqual(s.budgetChoicesMiB, [64,128,256,512]); assert.equal(s.maxBytes, 512 * 1024 * 1024);
 assert.equal(s.rootPath, f.root); assert.equal(s.realRootPath, null); assert.equal(s.totalBytes, 0); assert.equal(s.slots.length, 2);
 assert.deepEqual(await f.store.save({ bytes }), { canceled: false, committed: false, skipped: 'disabled' });
 await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
});
test('preferences persist opt-in and size choice; disabling never deletes generations', async t => {
 const f = await enabled(t); const a = await sample(1); await f.store.save({ bytes: a });
 await f.store.configure({ enabled: false, budgetMiB: 64 }); const fresh = createRecoveryStore({ root: f.root });
 const s = await fresh.status(); assert.equal(s.enabled, false); assert.equal(s.budgetMiB, 64); assert.equal(s.realRootPath, f.root);
 assert.equal(s.slots[0].validation, 'header-only'); assert.equal(s.totalBytes, a.length); assert.ok(s.lastSavedAt);
 assert.deepEqual(await contents(f, 'latest'), a); assert.deepEqual(Buffer.from((await fresh.open({ slot: 'latest' })).bytes), a);
});
test('two fixed generations rotate exactly validated v7 originals and history', async t => {
 const f = await enabled(t), a = await sample(1), b = await sample(2), c = await sample(3);
 await fs.writeFile(path.join(f.base, 'original.png'), png());
 assert.equal((await f.store.save({ bytes: a })).backupCommitted, false);
 assert.equal((await f.store.save({ bytes: b })).backupCommitted, true); await f.store.save({ bytes: c });
 assert.deepEqual(await contents(f, 'latest'), c); assert.deepEqual(await contents(f, 'previous'), b);
 const opened = await f.store.open({ slot: 'previous' }); assert.equal(opened.fallback, true); assert.equal((await P.decode(opened.bytes)).photos[0].undo.length, 1);
 assert.deepEqual(await fs.readFile(path.join(f.base, 'original.png')), png());
 assert.deepEqual((await fs.readdir(f.root)).sort(), Object.values(FILES).sort());
 const status = await f.store.status(); assert.equal(status.totalBytes, b.length + c.length); assert.equal(status.slots[1].validation, 'verified');
});
test('caller buffers are copied before the first await, with no accessor execution', async t => {
 const entered = pause(), release = pause(); let blocking = true;
 const f = await enabled(t, { decode: async bytes => { if (blocking) { entered.release(); await release.promise; blocking = false; } return P.decode(bytes); } });
 const bytes = await sample(7), expected = Buffer.from(bytes), saving = f.store.save({ bytes }); bytes.fill(0);
 await entered.promise; release.release(); await saving; assert.deepEqual(await contents(f, 'latest'), expected);
 let getterRan = false; const payload = {}; Object.defineProperty(payload, 'bytes', { enumerable: true, get() { getterRan = true; throw new Error('Getter ran'); } });
 await assert.rejects(f.store.save(payload), { code: 'RECOVERY_REQUEST' }); assert.equal(getterRan, false);
 const typed = await sample(); Object.defineProperty(typed, 'buffer', { get() { getterRan = true; } });
 await assert.rejects(f.store.save({ bytes: typed }), { code: 'RECOVERY_REQUEST' }); assert.equal(getterRan, false);
});
test('strict request grammar rejects paths, hidden keys, prototypes, symbols, proxies and shared bytes', async t => {
 const f = await fixture(t), bytes = await sample();
 for (const payload of [{ bytes, path: '/tmp/not-authorized' }, Object.create({ bytes }), Object.assign({ bytes }, { [Symbol('x')]: 1 }), new Proxy({ bytes }, {}), { bytes: new Uint8Array(new SharedArrayBuffer(100)) }, { bytes: new (class extends Uint8Array {})(bytes) }]) await assert.rejects(f.store.save(payload));
 const hidden = { bytes }; Object.defineProperty(hidden, 'extra', { value: true }); await assert.rejects(f.store.save(hidden));
 await assert.rejects(f.store.configure({ enabled: true, budgetMiB: 1 })); await assert.rejects(f.store.configure({ enabled: true, budgetMiB: 128, root: '/tmp' }));
 await assert.rejects(f.store.open({ slot: '../latest' })); await assert.rejects(f.store.open({ slot: 'latest', bytes }));
 assert.throws(() => createRecoveryStore({ root: '/tmp/../escape' })); assert.throws(() => createRecoveryStore({ root: '/' }));
});
test('latest corruption yields a verified fallback candidate without bytes, never silent recovery', async t => {
 const f = await enabled(t), a = await sample(1), b = await sample(2); await f.store.save({ bytes: a }); await f.store.save({ bytes: b });
 const corrupt = Buffer.from(b); corrupt[corrupt.length - 1] ^= 1; await fs.writeFile(f.file('latest'), corrupt);
 const before = await f.store.status(); assert.equal(before.slots[0].validation, 'header-only', 'header-only is not a claim that payload hashes passed');
 const result = await f.store.open({ slot: 'latest' }); assert.equal(result.requiresFallbackChoice, true); assert.equal(result.canceled, true); assert.equal(result.fallbackCandidate.validation, 'verified'); assert.equal(Object.hasOwn(result, 'bytes'), false);
 assert.deepEqual(await contents(f, 'latest'), corrupt); assert.deepEqual(await contents(f, 'previous'), a);
 assert.equal((await f.store.status()).slots[0].validation, 'invalid');
 const chosen = await f.store.open({ slot: 'previous' }); assert.deepEqual(Buffer.from(chosen.bytes), a);
 await assert.rejects(f.store.save({ bytes: await sample(3) }), { code: 'RECOVERY_INVALID' });
 assert.deepEqual(await contents(f, 'previous'), a); assert.deepEqual(await contents(f, 'latest'), corrupt);
});
test('missing latest offers previous only as an explicit fallback candidate', async t => {
 const f = await enabled(t), a = await sample(1); await fs.writeFile(f.file('previous'), a);
 const result = await f.store.open({ slot: 'latest' }); assert.equal(result.requiresFallbackChoice, true); assert.equal(result.fallbackCandidate.slot, 'previous'); assert.equal(result.bytes, undefined);
 await f.store.save({ bytes: await sample(2) }); assert.deepEqual(await contents(f, 'previous'), a);
});
test('corrupt previous is not silently overwritten even with a good latest', async t => {
 const f = await enabled(t), a = await sample(); await f.store.save({ bytes: a }); const broken = Buffer.alloc(100, 7); await fs.writeFile(f.file('previous'), broken);
 await assert.rejects(f.store.save({ bytes: await sample(1) })); assert.deepEqual(await contents(f, 'latest'), a); assert.deepEqual(await contents(f, 'previous'), broken);
});
test('status reads at most one fixed header per slot and never decodes large files', async t => {
 let projectReadBytes = 0, decoded = 0;
 const watched = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (String(args[0]).endsWith('.mintproj')) { const read = h.read.bind(h); h.read = async (...args) => { const r = await read(...args); projectReadBytes += r.bytesRead; return r; }; } return h; } };
 const f = await enabled(t, { fs: watched, decode: async b => { decoded++; return P.decode(b); } }), bytes = await sample();
 await fs.writeFile(f.file('latest'), bytes); await fs.writeFile(f.file('previous'), bytes);
 const s = await f.store.status(); assert.equal(projectReadBytes, 128); assert.equal(decoded, 0); assert.equal(s.slots[0].validation, 'header-only');
});
test('oversized and malformed-header slots fail without whole-file reads or overwrite', async t => {
 const f = await enabled(t); const handle = await fs.open(f.file('latest'), 'w'); await handle.truncate(MAX_BYTES + 1); await handle.close();
 let reads = 0; const watched = { ...fs, open: async (...args) => { if (String(args[0]).endsWith('.mintproj')) reads++; return fs.open(...args); } };
 const s = createRecoveryStore({ root: f.root, fs: watched }); assert.equal((await s.status()).slots[0].available, false); assert.equal(reads, 0);
 await assert.rejects(s.save({ bytes: await sample() }), { code: 'RECOVERY_SIZE' }); assert.equal(reads, 0); assert.equal((await fs.stat(f.file('latest'))).size, MAX_BYTES + 1);
});
test('budget shrink retains older generations and refuses a newly oversized payload', async t => {
 const f = await enabled(t); const bytes = await sample(); await fs.writeFile(f.file('latest'), bytes);
 // Sparse file tests report retention/size without allocating or reading 65 MiB.
 const large = await fs.open(f.file('previous'), 'w'); await large.write(bytes.subarray(0,64)); await large.truncate(65 * 1024 * 1024); await large.close();
 await f.store.configure({ enabled: true, budgetMiB: 64 }); const s = await f.store.status(); assert.equal(s.slots[1].overBudget, true); assert.equal((await fs.stat(f.file('previous'))).size, 65 * 1024 * 1024);
 const tooLarge = new Uint8Array(64 * 1024 * 1024 + 1); await assert.rejects(f.store.save({ bytes: tooLarge }), { code: 'RECOVERY_BUDGET' }); assert.deepEqual(await contents(f, 'latest'), bytes);
});
test('malformed preferences fail closed, are not repaired silently, and preserve drafts', async t => {
 const f = await enabled(t), bytes = await sample(); await f.store.save({ bytes }); await fs.writeFile(f.file('preferences'), '{bad');
 const s = await f.store.status(); assert.equal(s.ready, false); assert.equal(s.enabled, false); assert.match(s.error, /设置/);
 await assert.rejects(f.store.save({ bytes }), { code: 'RECOVERY_SETTINGS' }); await assert.rejects(f.store.configure({ enabled: true, budgetMiB: 128 }));
 assert.equal(await fs.readFile(f.file('preferences'), 'utf8'), '{bad'); assert.deepEqual(await contents(f, 'latest'), bytes);
});
test('symlink and hardlink generations never read or overwrite an external original', async t => {
 const f = await enabled(t), bytes = await sample(), original = path.join(f.base, 'external-original'); await fs.writeFile(original, bytes);
 await fs.symlink(original, f.file('latest')); await assert.rejects(f.store.open({ slot: 'latest' })); await assert.rejects(f.store.save({ bytes })); assert.deepEqual(await fs.readFile(original), bytes);
 await fs.unlink(f.file('latest')); await fs.link(original, f.file('latest')); await assert.rejects(f.store.save({ bytes })); assert.equal((await f.store.status()).slots[0].available, false); assert.deepEqual(await fs.readFile(original), bytes);
});
test('symlink root and linked ancestor are rejected and storage loss is not silently recreated', async t => {
 const f = await fixture(t), other = path.join(f.base, 'other'); await fs.mkdir(other); await fs.symlink(other, f.root);
 await assert.rejects(f.store.configure({ enabled: true, budgetMiB: 128 })); assert.deepEqual(await fs.readdir(other), []);
 await fs.unlink(f.root); await fs.mkdir(f.root); const nested = createRecoveryStore({ root: path.join(f.base, 'alias', 'nested') }); await fs.symlink(other, path.join(f.base, 'alias'));
 await assert.rejects(nested.configure({ enabled: true, budgetMiB: 128 }));
 await f.store.configure({ enabled: true, budgetMiB: 128 }); const gone = path.join(f.base, 'moved-owned'); await fs.rename(f.root, gone);
 assert.equal((await f.store.status()).ready, false); await assert.rejects(f.store.save({ bytes: await sample() }), { code: 'RECOVERY_LOST' }); await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
});
test('disk full before backup commit leaves both previous generations unchanged', async t => {
 let broken = false;
 const failing = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (broken && args[1] === 'wx') h.write = async () => { throw diskFull(); }; return h; } };
 const f = await enabled(t, { fs: failing }), a = await sample(1), b = await sample(2); await f.store.save({ bytes: a }); await f.store.save({ bytes: b }); broken = true;
 await assert.rejects(f.store.save({ bytes: await sample(3) }), { code: 'ENOSPC' }); assert.deepEqual(await contents(f, 'latest'), b); assert.deepEqual(await contents(f, 'previous'), a); await assertNoTemps(f); assert.equal(f.store.isBusy(), false);
});
test('disk full after atomic backup retains a valid latest and backup; no unlink-copy fallback', async t => {
 let broken = false, attempts = 0;
 const failing = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (broken && args[1] === 'wx' && ++attempts === 2) h.sync = async () => { throw diskFull(); }; return h; } };
 const f = await enabled(t, { fs: failing }), a = await sample(1), b = await sample(2); await f.store.save({ bytes: a }); await f.store.save({ bytes: b }); broken = true;
 await assert.rejects(f.store.save({ bytes: await sample(3) }), e => e.code === 'ENOSPC' && e.backupCommitted === true && e.committed === false);
 assert.deepEqual(await contents(f, 'latest'), b); assert.deepEqual(await contents(f, 'previous'), b); await assertNoTemps(f);
});
test('locked rename never deletes the target or uses non-atomic copy', async t => {
 let broken = false;
 const failing = { ...fs, rename: async (...args) => { if (broken) throw Object.assign(new Error('Locked'), { code: 'EACCES' }); return fs.rename(...args); }, copyFile: async () => { throw new Error('Copy fallback forbidden'); } };
 const f = await enabled(t, { fs: failing }), a = await sample(1), b = await sample(2); await f.store.save({ bytes: a }); await f.store.save({ bytes: b }); broken = true;
 await assert.rejects(f.store.save({ bytes: await sample(3) }), { code: 'EACCES' }); assert.deepEqual(await contents(f, 'latest'), b); assert.deepEqual(await contents(f, 'previous'), a); await assertNoTemps(f);
});
test('short/lying writes and temporary corruption are detected before commit', async t => {
 let corrupt = false;
 const wrong = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (corrupt && args[1] === 'wx') { const write = h.write.bind(h); h.write = async (bytes, offset, count, pos) => { const changed = Buffer.from(bytes); changed[offset] ^= 1; return write(changed, offset, count, pos); }; } return h; } };
 const f = await enabled(t, { fs: wrong }), a = await sample(); await f.store.save({ bytes: a }); corrupt = true;
 await assert.rejects(f.store.save({ bytes: await sample(2) }), { code: 'RECOVERY_WRITE' }); assert.deepEqual(await contents(f, 'latest'), a); await assertNoTemps(f);
});
test('concurrent writer is rejected; cancellation during validation leaves prior state and clears quit guard', async t => {
 const entered = pause(), release = pause(); let block = false;
 const f = await enabled(t, { decode: async b => { if (block) { entered.release(); await release.promise; } return P.decode(b); } }), a = await sample(1); await f.store.save({ bytes: a }); block = true;
 const pending = f.store.save({ bytes: await sample(2) }); await entered.promise; assert.equal(f.store.isBusy(), true);
 await assert.rejects(f.store.save({ bytes: a }), { code: 'RECOVERY_BUSY' }); await assert.rejects(f.store.open({ slot: 'latest' }), { code: 'RECOVERY_BUSY' });
 assert.equal(f.store.cancel().requested, true); release.release(); assert.deepEqual(await pending, { canceled: true, committed: false, backupCommitted: false }); assert.equal(f.store.isBusy(), false); assert.deepEqual(await contents(f, 'latest'), a);
});
test('configure-disable cancels a pending save before commit, blocks replacement writers, and persists disabled', async t => {
 const entered = pause(), release = pause(); let block = false;
 const watched = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (block && args[1] === 'wx' && String(args[0]).includes(FILES.latest)) { const sync = h.sync.bind(h); h.sync = async () => { await sync(); entered.release(); await release.promise; }; } return h; } };
 const f = await enabled(t, { fs: watched }), bytes = await sample(); block = true;
 const pending = f.store.save({ bytes }); await entered.promise; const disabling = f.store.configure({ enabled: false, budgetMiB: 64 });
 assert.equal(f.store.isBusy(), true); await assert.rejects(f.store.save({ bytes }), { code: 'RECOVERY_BUSY' }); release.release();
 assert.equal((await pending).canceled, true); await disabling; assert.equal((await f.store.status()).enabled, false); assert.equal(f.store.isBusy(), false); await assert.rejects(fs.stat(f.file('latest')), { code: 'ENOENT' }); await assertNoTemps(f);
});
test('cancel after backup commit preserves the older latest without committing the new capture', async t => {
 let cancelBackup = false, store;
 const watched = { ...fs, link: async (...args) => { await fs.link(...args); if (cancelBackup && args[1].endsWith(FILES.previous)) store.cancel(); } };
 const f = await enabled(t, { fs: watched }); store = f.store; const a = await sample(1); await store.save({ bytes: a }); cancelBackup = true;
 const result = await store.save({ bytes: await sample(2) }); assert.equal(result.canceled, true); assert.equal(result.backupCommitted, true); assert.deepEqual(await contents(f, 'latest'), a); assert.deepEqual(await contents(f, 'previous'), a);
});
test('cancel arriving after commit reports committed truthfully, including quit race', async t => {
 let cancelCommit = false, store;
 const watched = { ...fs, link: async (...args) => { await fs.link(...args); if (cancelCommit && args[1].endsWith(FILES.latest)) store.cancel(); } };
 const f = await enabled(t, { fs: watched }); store = f.store; cancelCommit = true; const bytes = await sample(); const result = await store.save({ bytes });
 assert.equal(result.committed, true); assert.equal(result.canceled, false); assert.equal(result.cancelRequested, true); assert.equal(store.isBusy(), false); assert.deepEqual(await contents(f, 'latest'), bytes);
});
test('directory fsync failure remains a committed success with a durability warning', async t => {
 let broken = false, root;
 const watched = { ...fs, open: async (...args) => { if (broken && args[0] === root && args[1] === 'r') throw new Error('No directory sync'); return fs.open(...args); } };
 const f = await enabled(t, { fs: watched }); root = f.root; broken = true; const bytes = await sample(); const result = await f.store.save({ bytes });
 assert.equal(result.committed, true); assert.match(result.durabilityWarning, /持久性/); assert.deepEqual(await contents(f, 'latest'), bytes);
});
test('concurrent existing-file mutation is detected before replacement and retained', async t => {
 let mutate = false, latest, replacement;
 const watched = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (mutate && args[1] === 'wx' && String(args[0]).includes(FILES.latest)) { const sync = h.sync.bind(h); h.sync = async () => { await sync(); await fs.writeFile(latest, replacement); }; } return h; } };
 const f = await enabled(t, { fs: watched }), a = await sample(1); latest = f.file('latest'); replacement = await sample(9); await f.store.save({ bytes: a }); mutate = true;
 await assert.rejects(f.store.save({ bytes: await sample(2) }), { code: 'RECOVERY_CHANGED' }); assert.deepEqual(await contents(f, 'latest'), replacement); assert.deepEqual(await contents(f, 'previous'), a); await assertNoTemps(f);
});
test('racing creation at an absent destination uses no-replace commit and is not overwritten', async t => {
 let race = false, replacement;
 const watched = { ...fs, link: async (...args) => { if (race && args[1].endsWith(FILES.latest)) await fs.writeFile(args[1], replacement); return fs.link(...args); } };
 const f = await enabled(t, { fs: watched }); replacement = await sample(9); race = true;
 await assert.rejects(f.store.save({ bytes: await sample(2) }), { code: 'EEXIST' }); assert.deepEqual(await contents(f, 'latest'), replacement); await assertNoTemps(f);
});
test('source container hash failure is rejected before creating a draft', async t => {
 const f = await enabled(t), bytes = await sample(); bytes[bytes.length - 1] ^= 1;
 await assert.rejects(f.store.save({ bytes })); await assert.rejects(fs.stat(f.file('latest')), { code: 'ENOENT' }); await assertNoTemps(f);
});

test('storage accounting includes preferences and bounded crash remnants without deleting them', async t => {
 const f = await enabled(t), bytes = await sample(); await f.store.save({ bytes });
 const leftover = path.join(f.root, '.recovery-latest.mintproj.synthetic.tmp'); await fs.writeFile(leftover, 'crash remainder');
 const s = await f.store.status(); assert.equal(s.totalBytes, bytes.length); assert.equal(s.storageBytes, bytes.length + (await fs.stat(f.file('preferences'))).size + 15); assert.equal(s.storageComplete, true); assert.equal(s.otherEntryCount, 1);
 assert.equal(await fs.readFile(leftover, 'utf8'), 'crash remainder');
});
test('malformed preferences do not hide the real root or recoverable slot', async t => {
 const f = await enabled(t), bytes = await sample(); await f.store.save({ bytes }); await fs.writeFile(f.file('preferences'), '{}');
 const s = await f.store.status(); assert.equal(s.ready, false); assert.equal(s.realRootPath, f.root); assert.equal(s.slots[0].available, true); assert.deepEqual(Buffer.from((await f.store.open({ slot: 'latest' })).bytes), bytes);
});
test('a reported rename error after actual commit is reconciled, not falsely reported as canceled', async t => {
 let failAfter = false;
 const watched = { ...fs, rename: async (...args) => { await fs.rename(...args); if (failAfter && args[1].endsWith(FILES.latest)) throw new Error('Synthetic post-commit error'); } };
 const f = await enabled(t, { fs: watched }); await f.store.save({ bytes: await sample(1) }); failAfter = true; const bytes = await sample(2);
 const r = await f.store.save({ bytes }); assert.equal(r.committed, true); assert.match(r.durabilityWarning, /已核实/); assert.deepEqual(await contents(f, 'latest'), bytes); await assertNoTemps(f);
});
test('a reported no-replace link error after actual commit is reconciled and its extra link cleaned', async t => {
 let failAfter = false;
 const watched = { ...fs, link: async (...args) => { await fs.link(...args); if (failAfter && args[1].endsWith(FILES.latest)) throw new Error('Synthetic post-commit error'); } };
 const f = await enabled(t, { fs: watched }); failAfter = true; const bytes = await sample(2);
 const r = await f.store.save({ bytes }); assert.equal(r.committed, true); assert.match(r.durabilityWarning, /已核实/); assert.deepEqual(await contents(f, 'latest'), bytes); assert.equal((await fs.stat(f.file('latest'))).nlink, 1); await assertNoTemps(f);
});

test('volume/root loss during a pending write fails closed and retains the valid old files', async t => {
 let lose = false, root, moved;
 const watched = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (lose && args[1] === 'wx') { const sync = h.sync.bind(h); h.sync = async () => { await sync(); lose = false; await fs.rename(root, moved); }; } return h; } };
 const f = await enabled(t, { fs: watched }); root = f.root; moved = path.join(f.base, 'disconnected-volume'); const a = await sample(1); await f.store.save({ bytes: a }); lose = true;
 await assert.rejects(f.store.save({ bytes: await sample(2) })); assert.equal(f.store.isBusy(), false);
 assert.deepEqual(await fs.readFile(path.join(moved, FILES.latest)), a); await assert.rejects(fs.stat(root), { code: 'ENOENT' });
 assert.equal((await f.store.status()).ready, false);
});
test('configure-disable arriving after current commit does not falsely claim the draft was canceled', async t => {
 const entered = pause(), release = pause(); let hold = false, root;
 const watched = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (hold && args[0] === root && args[1] === 'r') { const sync = h.sync.bind(h); h.sync = async () => { await sync(); hold = false; entered.release(); await release.promise; }; } return h; } };
 const f = await enabled(t, { fs: watched }); root = f.root; hold = true; const bytes = await sample(); const pending = f.store.save({ bytes }); await entered.promise;
 const disabling = f.store.configure({ enabled: false, budgetMiB: 64 }); assert.equal(f.store.isBusy(), true); release.release();
 const saved = await pending; assert.equal(saved.committed, true); assert.equal(saved.canceled, false); assert.equal(saved.cancelRequested, true); await disabling;
 assert.equal((await f.store.status()).enabled, false); assert.deepEqual(await contents(f, 'latest'), bytes); assert.equal(f.store.isBusy(), false);
});
test('directory accounting has a finite entry bound and refuses to call unknown usage zero', async t => {
 const f = await enabled(t); await Promise.all(Array.from({ length: 257 }, (_, i) => fs.writeFile(path.join(f.root, `synthetic-remnant-${i}`), 'x')));
 const s = await f.store.status(); assert.equal(s.storageComplete, false); assert.equal(s.storageBytes, null); assert.equal(s.otherEntryCount, null);
});

test('failed no-replace cleanup remains recoverable after restart only through its verified local UUID pair', async t => {
 let failCleanup = false;
 const watched = { ...fs, unlink: async file => { if (failCleanup && path.basename(file).startsWith(`.${FILES.latest}.`)) throw Object.assign(new Error('Cleanup denied'), { code: 'EACCES' }); return fs.unlink(file); } };
 const f = await enabled(t, { fs: watched }), bytes = await sample(); failCleanup = true; const saved = await f.store.save({ bytes });
 assert.equal(saved.committed, true); assert.match(saved.durabilityWarning, /清理失败/); assert.equal((await fs.stat(f.file('latest'))).nlink, 2);
 const fresh = createRecoveryStore({ root: f.root }); assert.equal((await fresh.status()).slots[0].retainedTemporaryLink, true); assert.deepEqual(Buffer.from((await fresh.open({ slot: 'latest' })).bytes), bytes);
 // A third link to any external location destroys the exact-owned-pair proof.
 await fs.link(f.file('latest'), path.join(f.base, 'outside-original')); await assert.rejects(fresh.open({ slot: 'latest' }));
});
test('plausibly named but non-owned hardlinks remain rejected', async t => {
 const f = await enabled(t), bytes = await sample(); await fs.writeFile(f.file('latest'), bytes);
 await fs.link(f.file('latest'), path.join(f.root, `.${FILES.latest}.not-a-generated-uuid.tmp`));
 await assert.rejects(f.store.open({ slot: 'latest' })); await assert.rejects(f.store.save({ bytes }));
});
test('a root replaced while opening the temporary receives no project bytes', async t => {
 let change = false, root, moved, writes = 0;
 const watched = { ...fs, open: async (...args) => { if (change && args[1] === 'wx') { change = false; await fs.rename(root, moved); await fs.mkdir(root); } const h = await fs.open(...args); if (args[1] === 'wx') { const write = h.write.bind(h); h.write = async (...a) => { writes++; return write(...a); }; } return h; } };
 const f = await enabled(t, { fs: watched }); root = f.root; moved = path.join(f.base, 'prior-owned'); writes = 0; change = true;
 await assert.rejects(f.store.save({ bytes: await sample() })); assert.equal(writes, 0); assert.deepEqual(await fs.readdir(f.root), []);
});

test('a valid-looking UUID alias with a different inode cannot disguise an external hardlink', async t => {
 const f = await enabled(t), bytes = await sample(), external = path.join(f.base, 'outside-source'); await fs.writeFile(external, bytes); await fs.link(external, f.file('latest'));
 await fs.writeFile(path.join(f.root, `.${FILES.latest}.12345678-1234-4234-8234-123456789abc.tmp`), bytes);
 await assert.rejects(f.store.open({ slot: 'latest' })); await assert.rejects(f.store.save({ bytes })); assert.deepEqual(await fs.readFile(external), bytes);
});

test('observed root replacement at a read-open boundary reads no generation bytes', async t => {
 let swap = false, root, moved, target, readBytes = 0;
 const watched = { ...fs, open: async (...args) => {
   if (swap && args[0] === target) { swap = false; await fs.rename(root, moved); await fs.mkdir(root); await fs.copyFile(path.join(moved, FILES.latest), target); }
   const h = await fs.open(...args); if (args[0] === target) { const read = h.read.bind(h); h.read = async (...a) => { const r = await read(...a); readBytes += r.bytesRead; return r; }; } return h;
 } };
 const f = await enabled(t, { fs: watched }); root = f.root; moved = path.join(f.base, 'previous-owned-root'); target = f.file('latest'); await f.store.save({ bytes: await sample() }); readBytes = 0; swap = true;
 await assert.rejects(f.store.open({ slot: 'latest' })); assert.equal(readBytes, 0);
});

test('recovery keeps a rehashed v15 layout byte-exact and migrates image state only when opened by the codec', async t => {
  const f = await enabled(t), current = await sample(12), frame = P.inspectHeader(current);
  const doc = JSON.parse(current.subarray(64, 64 + frame.metadataBytes).toString('utf8'));
  doc.version = 15;
  for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const settings of [photo.settings, photo.committed, ...photo.undo, ...photo.redo]) delete settings.imageLayers;
  }
  const json = Buffer.from(JSON.stringify(doc)), header = Buffer.from(current.subarray(0, 64));
  const payload = Buffer.from(current.subarray(64 + frame.metadataBytes));
  header.writeUInt32LE(15, 8); header.writeUInt32LE(json.length, 16); header.writeUInt32LE(64 + json.length + payload.length, 24);
  require('node:crypto').createHash('sha256').update(json).digest().copy(header, 32);
  const legacy = Buffer.concat([header, json, payload]);
  assert.equal(P.inspectHeader(legacy).version, 15);
  assert.equal(Object.hasOwn(doc.photos[0], 'imageAssets'), false);
  assert.equal(Object.hasOwn(doc.photos[0].settings, 'imageLayers'), false);
  await f.store.save({ bytes: legacy });
  const opened = Buffer.from((await f.store.open({ slot: 'latest' })).bytes);
  assert.deepEqual(opened, legacy);
  const restored = await P.decode(opened);
  assert.equal(restored.version, P.VERSION); assert.deepEqual(restored.photos[0].imageAssets, []);
  for (const settings of [restored.photos[0].settings, restored.photos[0].committed, ...restored.photos[0].undo, ...restored.photos[0].redo]) assert.deepEqual(settings.imageLayers, []);
  assert.deepEqual(restored.photos[0].source.bytes, new Uint8Array(png()));
  assert.equal(restored.photos[0].settings.exposure, 12);
  assert.deepEqual(await contents(f, 'latest'), legacy);
});
