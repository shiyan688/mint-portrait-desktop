'use strict';
// Independent adversarial review. Only synthetic data, temporary files, and VM
// source execution are used. No native browser, model, or private photo is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const Tone = require('../src/advanced-tone.cjs');
const { createCodec } = require('../src/preset-codec.cjs');
const { createPresetStore, LIMITS } = require('../preset-store.cjs');
const codec = createCodec({ advancedTone: Tone, levels: require('../src/levels.cjs') });
const ROOT = path.resolve(__dirname, '..');
const HEADER = 'MINT-PRESET-CATALOG/1\n';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const plain = x => JSON.parse(JSON.stringify(x));
const doc = (name = 'Independent') => codec.defaults(name);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = (n, name, kind = 'A') => `${kind} ${id(n)} ${Buffer.from(codec.stringify(doc(name))).toString('base64')}\n`;
async function fixture(t, overrides = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mint-preset-independent-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'catalog-root'), calls = { open: [], save: [], confirm: [] };
  const answers = { open: { canceled: true, filePaths: [] }, save: { canceled: true }, confirm: { response: 0 } };
  const dialog = {
    showOpenDialog: async (...a) => { calls.open.push(a); return typeof answers.open === 'function' ? answers.open() : answers.open; },
    showSaveDialog: async (...a) => { calls.save.push(a); return typeof answers.save === 'function' ? answers.save() : answers.save; },
    showMessageBox: async (...a) => { calls.confirm.push(a); return answers.confirm; }
  };
  const options = { root, dialog, getWindow: () => 'verified-window', codec, ...overrides };
  const store = createPresetStore(options);
  return { dir, root, file: path.join(root, 'catalog.mintpresets'), backup: path.join(root, 'catalog.previous.mintpresets'), calls, answers, options, store };
}
async function tree(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e));
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    out.push([e.name, e.isSymbolicLink() ? `link:${await fsp.readlink(p)}` : e.isDirectory() ? await tree(p) : sha(await fsp.readFile(p))]);
  }
  return out;
}
const withFs = overrides => Object.assign(Object.create(fsp), overrides);
const ioError = message => Object.assign(new Error(message), { code: 'EIO' });
function wrappedHandle(handle, overrides) {
  return new Proxy(handle, { get(target, key) { if (Object.hasOwn(overrides, key)) return overrides[key]; const v = Reflect.get(target, key, target); return typeof v === 'function' ? v.bind(target) : v; } });
}

// Codec checks are deliberately independent of the candidate author's suite.
// Prior v2 shared hash retained for historical restore: 30b4f98139e9fef2d4e3b6dffc2cf0d4594862039623fa02c3877cacfc6fe5ab.
// v3 reviewed for strict legacy migration, gains-only whitelist and missing-module refusal.
test('independent preset: frozen v3 codec bytes and APIs are the specified shared implementation', () => {
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'src/preset-codec.cjs'))), 'b03d59aab2fa6b32639ceb1ddc0d22e680adde21a2834aece6cea9e79645e5d6');
  assert.ok(Object.isFrozen(require('../src/preset-codec.cjs')) && Object.isFrozen(codec));
  assert.deepEqual(Object.keys(codec).sort(), ['colorOnly', 'defaults', 'hasPortraitEffect', 'parse', 'stringify', 'validate']);
});
test('independent preset: duplicate decoded keys and escaped poison keys reject at every level', () => {
  const source = codec.stringify(doc());
  const variants = [
    source.replace('"name":', '"name":"First","\\u006eame":'),
    source.replace('"exposure":0', '"exposure":0,"\\u0065xposure":1'),
    source.replace('"palette":"natural"', '"palette":"natural","pale\\u0074te":"rose"'),
    source.replace('"controls":', '"controls":{},"contro\\u006cs":'),
    source.replace('"name":', '"\\u005f_proto__":{},"name":'),
    source.replace('"name":', '"constr\\u0075ctor":{},"name":')
  ];
  for (const value of variants) assert.throws(() => codec.parse(value), TypeError);
  const r = doc(); r.controls.advancedTone = Tone.defaults();
  assert.throws(() => codec.parse(codec.stringify(r).replace('"strength":1', '"strength":1,"strengt\\u0068":0')), /Duplicate/);
});
test('independent preset: strict whitelist rejects photos, paths, masks, geometry and operational identifiers', () => {
  const blocked = ['photo', 'photos', 'image', 'bytes', 'path', 'filePath', 'source', 'id', 'timestamp', 'landmarks', 'mask', 'strokes', 'framing', 'geometry', 'reshape', 'slim', 'eyes', 'nose', 'jaw', '__proto__', 'constructor', 'prototype'];
  for (const key of blocked) for (const at of ['root', 'controls', 'basic', 'beauty', 'advancedTone']) {
    const value = doc(); value.controls.advancedTone = Tone.defaults();
    const target = at === 'root' ? value : at === 'controls' ? value.controls : value.controls[at];
    Object.defineProperty(target, key, { value: 'not allowed', enumerable: true, configurable: true });
    assert.throws(() => codec.validate(value), TypeError, `${at}.${key}`);
    assert.throws(() => codec.parse(JSON.stringify(value)), TypeError, `text ${at}.${key}`);
  }
});
test('independent preset: getters, toJSON, symbols, hidden fields, prototypes and sparse arrays never run hooks', () => {
  let called = 0;
  for (const at of ['name', 'basic', 'number', 'tone', 'array']) {
    const value = doc(); value.controls.advancedTone = Tone.defaults();
    const [object, key] = at === 'name' ? [value, 'name'] : at === 'basic' ? [value.controls, 'basic'] : at === 'number' ? [value.controls.basic, 'exposure'] : at === 'tone' ? [value.controls.advancedTone, 'enabled'] : [value.controls.advancedTone.curves.rgb, '0'];
    Object.defineProperty(object, key, { enumerable: true, configurable: true, get() { called++; throw new Error('getter ran'); } });
    assert.throws(() => codec.validate(value), TypeError); assert.throws(() => codec.stringify(value), TypeError);
  }
  for (const mutate of [v => Object.defineProperty(v, 'toJSON', { value() { called++; } }), v => Object.defineProperty(v, 'hidden', { value: 1 }), v => { v[Symbol('secret')] = 1; }, v => Object.setPrototypeOf(v, { inherited: true }), v => { delete v.controls.advancedTone.curves.rgb[1]; }]) {
    const value = doc(); value.controls.advancedTone = Tone.defaults(); mutate(value); assert.throws(() => codec.stringify(value), TypeError);
  }
  assert.equal(called, 0);
});
test('independent preset: byte, depth, graph, token-string and number limits fail closed', () => {
  const source = codec.stringify(doc()), padded = source + ' '.repeat(65536 - Buffer.byteLength(source));
  assert.equal(codec.parse(padded).name, 'Independent');
  assert.throws(() => codec.parse(padded + ' '), /byte limit/);
  assert.throws(() => codec.parse(' '.repeat(20000) + '"' + '漢'.repeat(16000) + '"'), /byte limit/);
  assert.throws(() => codec.parse('['.repeat(13) + '0' + ']'.repeat(13)), /nesting/);
  assert.throws(() => codec.parse('[' + Array(513).fill('0').join(',') + ']'), /node/);
  assert.throws(() => codec.parse('"' + 'a'.repeat(4097) + '"'), /string token/);
  assert.throws(() => codec.parse('0.' + '0'.repeat(129)), /number token/);
  const cyclic = doc(); cyclic.controls.advancedTone = {}; cyclic.controls.advancedTone.loop = cyclic.controls.advancedTone;
  assert.throws(() => codec.validate(cyclic), /nesting|node/);
});
test('independent preset: malformed Unicode, lossy numbers, alternate grammar and future formats reject', () => {
  const source = codec.stringify(doc());
  for (const text of ['\ufeff' + source, source + '{}', source.replace('"version":3', '"version":4'), source.replace('"exposure":0', '"exposure":1e999'), source.replace('"exposure":0', '"exposure":1e-999'), source.replace('"exposure":0', '"exposure":01'), source.replace('"exposure":0', '"exposure":+1'), source.replace('"exposure":0', '"exposure":NaN'), source.replace('Independent', '\\ud800'), source.replace('Independent', '\\udc00'), source.replace('Independent', 'bad\\u0085name'), source.replace('"name":', '/*x*/"name":')]) assert.throws(() => codec.parse(text), TypeError);
  for (const v of [null, {}, new String(source), Buffer.from(source)]) assert.throws(() => codec.parse(v), TypeError);
  const value = codec.parse(source.replace('"exposure":0', '"exposure":-0'));
  assert.equal(Object.is(value.controls.basic.exposure, -0), false);
});
test('independent preset: full recipes retain disabled tone, normalized names and independent ownership', () => {
  const value = doc('  色彩🙂  '); value.controls.beauty.lip = 73; value.controls.beauty.palette = 'rose'; value.controls.basic.temperature = -33;
  value.controls.advancedTone = Tone.defaults(); value.controls.advancedTone.enabled = false; value.controls.advancedTone.hsl[3].hue = 7;
  const before = codec.stringify(value), color = codec.colorOnly(value), parsed = codec.parse(before), second = codec.validate(value);
  assert.equal(color.name, '色彩🙂'); assert.equal(codec.hasPortraitEffect(value), true); assert.equal(codec.hasPortraitEffect(color), false);
  assert.equal(color.controls.beauty.palette, 'natural'); assert.equal(color.controls.basic.temperature, -33);
  assert.deepEqual(plain(color.controls.advancedTone), plain(value.controls.advancedTone));
  color.controls.advancedTone.hsl[3].hue = 8; parsed.controls.beauty.lip = 0; second.controls.basic.temperature = 8;
  assert.equal(codec.stringify(value), before); assert.equal(Object.getPrototypeOf(parsed), null); assert.equal(Object.getPrototypeOf(parsed.controls), null);
});
test('independent preset: the browser-realm codec agrees exactly without dependency or pixel execution', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/levels.cjs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/advanced-tone.cjs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/preset-codec.cjs'), 'utf8'), context);
  const value = doc('共享🙂'); value.controls.advancedTone = Tone.defaults(); value.controls.advancedTone.curves.blue = [0, .2, .53, .8, 1];
  context.input = codec.stringify(value);
  assert.equal(vm.runInContext('MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels}).stringify(MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels}).parse(input))', context), context.input);
  assert.equal(context.require, undefined); assert.equal(context.fetch, undefined);
});

// Host storage checks use actual temporary filesystem operations, not an in-memory store.
test('independent preset: empty store, opaque IDs, durable updates, owned results and normalized duplicate names', async t => {
  const h = await fixture(t); assert.deepEqual(await h.store.list(), { items: [], trash: [] });
  const a = await h.store.save({ document: doc(' Café ') }); assert.match(a.id, /^[a-f0-9-]{36}$/);
  const b = await h.store.save({ document: doc('Second') }); const saved = await fsp.readFile(h.file);
  await assert.rejects(h.store.save({ document: doc('CAFE\u0301') }), /同名/); assert.deepEqual(await fsp.readFile(h.file), saved);
  const updated = doc('Changed'); updated.controls.basic.exposure = 9;
  await h.store.save({ id: a.id, document: updated }); updated.controls.basic.exposure = -9;
  const fresh = createPresetStore(h.options), got = await fresh.list(); assert.equal(got.items[0].document.controls.basic.exposure, 9); assert.equal(got.items[1].id, b.id);
  got.items[0].document.controls.basic.exposure = 99; assert.equal((await fresh.list()).items[0].document.controls.basic.exposure, 9);
  assert.match((await fsp.readFile(h.file, 'utf8')), /^MINT-PRESET-CATALOG\/1\nA /);
  assert.deepEqual(await fsp.readFile(h.backup), saved);
});
test('independent preset: traversal IDs, renderer paths and hostile save descriptors leave the store unchanged', async t => {
  const h = await fixture(t); const a = await h.store.save({ document: doc() }), before = await tree(h.dir); let invoked = 0;
  for (const bad of ['../escape', '/tmp/absolute', '..\\escape', 'file:///tmp/a', id(0) + '\n', a.id.toUpperCase(), null, {}, '']) {
    await assert.rejects(h.store.remove(bad)); await assert.rejects(h.store.restore(bad)); await assert.rejects(h.store.save({ id: bad, document: doc('Bad') }));
  }
  for (const extra of ['path', 'filePath', 'root', 'directory', 'target']) await assert.rejects(h.store.save({ document: doc('Bad'), [extra]: path.join(h.dir, 'escape') }));
  const payload = {}; Object.defineProperty(payload, 'document', { enumerable: true, get() { invoked++; return doc(); } });
  await assert.rejects(h.store.save(payload)); assert.equal(invoked, 0); assert.deepEqual(await tree(h.dir), before);
});
test('independent preset: malformed catalogs never silently reset or overwrite either saved copy', async t => {
  const h = await fixture(t); const a = await h.store.save({ document: doc() }); await h.store.save({ document: doc('Other') });
  const valid = await fsp.readFile(h.file), raw = line(1, 'Unique');
  const variants = [Buffer.from('{}'), Buffer.from(HEADER + '\n'), Buffer.from(HEADER + raw + raw), Buffer.from(HEADER + line(1, 'One') + line(2, 'oNe')), Buffer.from(HEADER + 'A ' + id(1) + ' ====\n'), Buffer.from(HEADER + 'A ' + id(1) + ' e30=\n'), Buffer.from(HEADER + 'A ' + id(1) + ' e31=\n'), Buffer.from(HEADER + raw.trimEnd()), Buffer.from([0xef, 0xbb, 0xbf, ...valid]), Buffer.from([0xff, ...valid])];
  for (const malformed of variants) {
    await fsp.writeFile(h.file, malformed); const before = await tree(h.dir);
    await assert.rejects(h.store.list(), undefined, `accepted malformed catalog: ${malformed.toString('utf8').slice(0, 100)}`); await assert.rejects(h.store.save({ document: doc('New') })); await assert.rejects(h.store.remove(a.id)); await assert.rejects(h.store.restore(id(3)));
    assert.deepEqual(await tree(h.dir), before);
  }
});
test('independent preset: catalog 100 active/20 retained and 512KiB limits stop changes, never purge history', async t => {
  const h = await fixture(t); await fsp.mkdir(h.root);
  const capacity = HEADER + Array.from({ length: 100 }, (_, n) => line(n + 1, 'Active' + n)).join('') + Array.from({ length: 20 }, (_, n) => line(n + 101, 'Trash' + n, 'T')).join('');
  await fsp.writeFile(h.file, capacity); assert.equal((await h.store.list()).items.length, 100); const before = await tree(h.dir);
  await assert.rejects(h.store.save({ document: doc('Overflow') }), /100/); await assert.rejects(h.store.remove(id(1)), /已满/); await assert.rejects(h.store.restore(id(101))); assert.deepEqual(await tree(h.dir), before);
  for (const tooMuch of [capacity + line(121, 'Over'), HEADER + Array.from({ length: 101 }, (_, n) => line(n + 1, 'Active' + n)).join(''), HEADER + Array.from({ length: 21 }, (_, n) => line(n + 1, 'Trash' + n, 'T')).join(''), 'x'.repeat(LIMITS.maxBytes + 1)]) { await fsp.writeFile(h.file, tooMuch); await assert.rejects(h.store.list()); }
});
test('independent preset: remove is reversible and restoration conflicts preserve the retained recipe', async t => {
  const h = await fixture(t); const a = await h.store.save({ document: doc('Restore me') });
  const removed = await h.store.remove(a.id); assert.equal(removed.items.length, 0); assert.equal(removed.trash[0].id, a.id);
  await h.store.save({ document: doc('restore ME') }); const before = await tree(h.dir); await assert.rejects(h.store.restore(a.id), /同名/); assert.deepEqual(await tree(h.dir), before);
  const other = (await h.store.list()).items[0]; await h.store.save({ id: other.id, document: doc('Renamed') });
  const restored = await h.store.restore(a.id); assert.equal(restored.trash.length, 0); assert.ok(restored.items.some(x => x.id === a.id && x.document.name === 'Restore me'));
});
test('independent preset: missing main with a valid backup fails closed instead of creating an empty catalog', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('One') }); await h.store.save({ document: doc('Two') }); await fsp.unlink(h.file);
  const before = await tree(h.dir); await assert.rejects(h.store.list(), /恢复/); await assert.rejects(h.store.save({ document: doc('New') }), /恢复/); assert.deepEqual(await tree(h.dir), before);
});
test('independent preset: direct root/catalog/backup symlinks cannot redirect store mutations', async t => {
  const h = await fixture(t), outside = path.join(h.dir, 'outside'); await fsp.mkdir(outside); await fsp.writeFile(path.join(outside, 'sentinel'), 'unchanged');
  await fsp.symlink(outside, h.root, 'dir'); const first = await tree(h.dir); await assert.rejects(h.store.save({ document: doc() })); assert.deepEqual(await tree(h.dir), first); await fsp.unlink(h.root);
  await fsp.mkdir(h.root); const target = path.join(outside, 'valid'); await fsp.writeFile(target, HEADER + line(1, 'Outside'));
  await fsp.symlink(target, h.file); const second = await tree(h.dir); await assert.rejects(h.store.list()); await assert.rejects(h.store.save({ document: doc() })); assert.deepEqual(await tree(h.dir), second); await fsp.unlink(h.file);
  await h.store.save({ document: doc() }); await fsp.symlink(target, h.backup); const third = await tree(h.dir); await assert.rejects(h.store.save({ document: doc('More') })); assert.deepEqual(await tree(h.dir), third);
});
test('independent preset: native cancellation reads and writes no files and clears the busy flag', async t => {
  let touched = 0; const poisonFs = withFs(Object.fromEntries(['lstat', 'open', 'mkdir', 'rename', 'unlink'].map(k => [k, async () => { touched++; throw new Error('I/O after cancel'); }])));
  const h = await fixture(t, { fsImpl: poisonFs });
  assert.equal(await h.store.open(), null); assert.equal(await h.store.export(doc()), null); assert.equal(touched, 0); assert.equal(h.store.isBusy(), false);
  assert.equal(h.calls.open[0][0], 'verified-window'); assert.equal(h.calls.save[0][0], 'verified-window');
});
test('independent preset: import uses only one exact native-selected path and never commits to the catalog', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('Keep') });
  const selected = path.join(h.dir, 'selected.mintpreset.json'), ignored = path.join(h.dir, 'ignored.mintpreset.json');
  await fsp.writeFile(selected, codec.stringify(doc('Selected'))); await fsp.writeFile(ignored, codec.stringify(doc('Ignored')));
  h.answers.open = { canceled: false, filePaths: [selected] }; const before = await tree(h.dir);
  assert.equal((await h.store.open(ignored)).name, 'Selected'); assert.deepEqual(await tree(h.dir), before);
  h.answers.open = { canceled: false, filePaths: [selected, ignored] }; await assert.rejects(h.store.open());
  h.answers.open = { canceled: false, filePaths: [ignored.replace('.mintpreset.json', '.png')] }; await assert.rejects(h.store.open(), /mintpreset/);
});
test('independent preset: malformed, non-UTF8, BOM, oversize and symlink imports preserve existing recipes', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('Keep') });
  const incoming = path.join(h.dir, 'incoming.mintpreset.json'); h.answers.open = { canceled: false, filePaths: [incoming] };
  const canonical = codec.stringify(doc('Candidate'));
  for (const bytes of [Buffer.from('{}'), Buffer.from(canonical.replace('"name":', '"name":"First","\\u006eame":')), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(canonical)]), Buffer.from([0xff]), Buffer.alloc(65537, 0x20), Buffer.alloc(0)]) {
    await fsp.writeFile(incoming, bytes); const before = await tree(h.dir); await assert.rejects(h.store.open()); assert.deepEqual(await tree(h.dir), before);
  }
  await fsp.unlink(incoming); await fsp.symlink(h.file, incoming); const before = await tree(h.dir); await assert.rejects(h.store.open()); assert.deepEqual(await tree(h.dir), before);
});
test('independent preset: growing same-inode import is rejected without reading beyond the byte cap', async t => {
  const h = await fixture(t); const incoming = path.join(h.dir, 'growing.mintpreset.json'); await fsp.writeFile(incoming, codec.stringify(doc()));
  let consumed = 0, grew = false;
  const boundedFs = withFs({ open: async (p, flags, mode) => {
    const handle = await fsp.open(p, flags, mode); if (p !== incoming) return handle;
    return wrappedHandle(handle, {
      stat: async () => { const s = await handle.stat(); if (!grew) { grew = true; await fsp.appendFile(incoming, Buffer.alloc(128 * 1024, 0x20)); } return s; },
      readFile: async (...a) => { const b = await handle.readFile(...a); consumed += b.length; return b; },
      read: async (...a) => { const result = await handle.read(...a); consumed += result.bytesRead; return result; }
    });
  } });
  const store = createPresetStore({ ...h.options, fsImpl: boundedFs }); h.answers.open = { canceled: false, filePaths: [incoming] };
  await assert.rejects(store.open()); assert.ok(grew); assert.ok(consumed <= LIMITS.maxDocumentBytes + 1, `read ${consumed} bytes before enforcing a ${LIMITS.maxDocumentBytes}-byte cap`);
});
test('independent preset: export preserves native exact path and prevents photo suffix or symlink replacement', async t => {
  const h = await fixture(t); const target = path.join(h.dir, 'native-selected.mintpreset.json'), photo = path.join(h.dir, 'original.png'); await fsp.writeFile(photo, 'private-original');
  h.answers.save = { canceled: false, filePath: target }; const result = await h.store.export(doc('../Only a label')); assert.equal(result.name, path.basename(target)); assert.equal(codec.parse(await fsp.readFile(target, 'utf8')).name, '../Only a label');
  assert.ok(!h.calls.save[0][1].defaultPath.includes('/')); assert.equal(result.bytes, (await fsp.stat(target)).size);
  h.answers.save = { canceled: false, filePath: photo }; const before = await tree(h.dir); await assert.rejects(h.store.export(doc()), /mintpreset/); assert.deepEqual(await tree(h.dir), before);
  const link = path.join(h.dir, 'link.mintpreset.json'); await fsp.symlink(photo, link); h.answers.save = { canceled: false, filePath: link }; await assert.rejects(h.store.export(doc())); assert.equal(await fsp.readFile(photo, 'utf8'), 'private-original');
});
test('independent preset: failed temporary write, fsync and catalog rename preserve the prior main bytes', async t => {
  for (const fault of ['write', 'sync', 'backup-rename', 'main-rename']) {
    const h = await fixture(t); await h.store.save({ document: doc('First') }); await h.store.save({ document: doc('Second') }); const prior = await fsp.readFile(h.file);
    const failing = withFs({
      open: async (p, flags, mode) => { const handle = await fsp.open(p, flags, mode); if (!path.basename(p).startsWith('.mint-preset-')) return handle; return wrappedHandle(handle, { ...(fault === 'write' ? { writeFile: async bytes => { await handle.writeFile(bytes.subarray(0, 7)); throw ioError('injected write failure'); } } : {}), ...(fault === 'sync' ? { sync: async () => { throw ioError('injected sync failure'); } } : {}) }); },
      rename: async (from, to) => { if ((fault === 'main-rename' && to === h.file) || (fault === 'backup-rename' && to === h.backup)) throw ioError('injected rename failure'); return fsp.rename(from, to); }
    });
    const store = createPresetStore({ ...h.options, fsImpl: failing }); await assert.rejects(store.save({ document: doc('Not committed') }), /injected/); assert.equal(store.isBusy(), false); assert.deepEqual(await fsp.readFile(h.file), prior); assert.deepEqual((await h.store.list()).items.map(x => x.document.name), ['First', 'Second']); assert.equal((await fsp.readdir(h.root)).some(n => n.endsWith('.tmp')), false);
  }
});
test('independent preset: failed export write or rename preserves a pre-existing selected file', async t => {
  for (const fault of ['write', 'rename']) {
    const h = await fixture(t), target = path.join(h.dir, 'existing.mintpreset.json'); await fsp.writeFile(target, codec.stringify(doc('Original'))); h.answers.save = { canceled: false, filePath: target }; const before = await tree(h.dir);
    const fail = withFs({ open: async (p, flags, mode) => { const handle = await fsp.open(p, flags, mode); return flags === 'wx' && fault === 'write' ? wrappedHandle(handle, { writeFile: async () => { throw ioError('injected export write'); } }) : handle; }, rename: async (a, b) => { if (fault === 'rename' && b === target) throw ioError('injected export rename'); return fsp.rename(a, b); } });
    await assert.rejects(createPresetStore({ ...h.options, fsImpl: fail }).export(doc('New')), /injected/); assert.deepEqual(await tree(h.dir), before);
  }
});
test('independent preset: concurrent operations fail before I/O and cancellation unlocks future operations', async t => {
  const h = await fixture(t); let release; h.answers.open = () => new Promise(resolve => { release = resolve; });
  const pending = h.store.open(); assert.equal(h.store.isBusy(), true);
  for (const operation of [() => h.store.list(), () => h.store.save({ document: doc() }), () => h.store.remove(id(1)), () => h.store.restore(id(1)), () => h.store.export(doc()), () => h.store.recoverBackup(), () => h.store.open()]) await assert.rejects(operation(), /进行中/);
  assert.equal(h.calls.open.length, 1); assert.equal(h.calls.save.length, 0); assert.deepEqual(await tree(h.root), []);
  release({ canceled: true, filePaths: [] }); assert.equal(await pending, null); assert.equal(h.store.isBusy(), false); assert.equal((await h.store.save({ document: doc('After cancel') })).document.name, 'After cancel');
});
test('independent preset: backup recovery cancel changes nothing; confirmed recovery preserves corrupt current bytes', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('First') }); await h.store.save({ document: doc('Second') }); const backup = await fsp.readFile(h.backup); await fsp.writeFile(h.file, 'CORRUPT CURRENT BYTES');
  const before = await tree(h.dir); assert.equal(await h.store.recoverBackup(), null); assert.deepEqual(await tree(h.dir), before);
  h.answers.confirm = { response: 1 }; const result = await h.store.recoverBackup(); assert.deepEqual(result.items.map(x => x.document.name), ['First']); assert.deepEqual(await fsp.readFile(h.file), backup); assert.deepEqual(await fsp.readFile(h.backup), backup);
  const preserved = (await fsp.readdir(h.root)).filter(n => n.startsWith('catalog-before-recovery-')); assert.equal(preserved.length, 1); assert.equal(await fsp.readFile(path.join(h.root, preserved[0]), 'utf8'), 'CORRUPT CURRENT BYTES'); assert.equal((await h.store.list()).items.length, 1);
});
test('independent preset: failed recovery commit restores the original main and corrupt backups never prompt', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('First') }); await h.store.save({ document: doc('Second') }); await fsp.writeFile(h.file, 'CORRUPT BUT RECOVERABLE'); const before = await tree(h.dir); h.answers.confirm = { response: 1 };
  const failing = withFs({ link: async (a, b) => { if (b === h.file) throw ioError('injected recovery commit'); return fsp.link(a, b); }, rename: async (a, b) => { if (path.basename(a).startsWith('.mint-preset-') && b === h.file) throw ioError('injected recovery commit'); return fsp.rename(a, b); } });
  await assert.rejects(createPresetStore({ ...h.options, fsImpl: failing }).recoverBackup(), /injected/); assert.deepEqual(await tree(h.dir), before);
  const prompts = h.calls.confirm.length; await fsp.writeFile(h.backup, '{}'); await assert.rejects(h.store.recoverBackup()); assert.equal(h.calls.confirm.length, prompts);
});


test('independent preset: a concurrently created new export target is not overwritten at commit', async t => {
  const h = await fixture(t), target = path.join(h.dir, 'racing.mintpreset.json'); h.answers.save = { canceled: false, filePath: target };
  let raced = false;
  const racing = withFs({ link: async (from, to) => { if (to === target) { raced = true; await fsp.writeFile(target, 'external newly created bytes', { flag: 'wx' }); } return fsp.link(from, to); } });
  await assert.rejects(createPresetStore({ ...h.options, fsImpl: racing }).export(doc())); assert.ok(raced); assert.equal(await fsp.readFile(target, 'utf8'), 'external newly created bytes'); assert.equal((await fsp.readdir(h.dir)).some(n => n.endsWith('.tmp')), false);
});
test('independent preset: externally changed existing catalog is not replaced using a stale snapshot', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('Before') }); const external = Buffer.from(HEADER + line(99, 'External change')); let changed = false;
  const racing = withFs({ open: async (p, flags, mode) => { const handle = await fsp.open(p, flags, mode); if (!changed && flags === 'wx') { changed = true; await fsp.writeFile(h.file, external); } return handle; } });
  await assert.rejects(createPresetStore({ ...h.options, fsImpl: racing }).save({ document: doc('Do not overwrite') }), /改变/); assert.ok(changed); assert.deepEqual(await fsp.readFile(h.file), external); assert.equal((await h.store.list()).items[0].document.name, 'External change');
});
test('independent preset: existing non-preset export contents are not silently overwritten', async t => {
  const h = await fixture(t), target = path.join(h.dir, 'unrelated.mintpreset.json'); h.answers.save = { canceled: false, filePath: target };
  for (const bytes of [Buffer.from('unrelated contents'), Buffer.from('{}'), Buffer.from([0xff]), Buffer.alloc(0)]) { await fsp.writeFile(target, bytes); const before = await tree(h.dir); await assert.rejects(h.store.export(doc())); assert.deepEqual(await tree(h.dir), before); }
});
test('independent preset: failed exclusive-link commit removes its temporary file without creating a catalog', async t => {
  const h = await fixture(t); const failing = withFs({ link: async () => { throw ioError('injected link failure'); } });
  const store = createPresetStore({ ...h.options, fsImpl: failing }); await assert.rejects(store.save({ document: doc() }), /injected/); assert.equal(store.isBusy(), false); assert.deepEqual(await tree(h.root), []); assert.deepEqual(await h.store.list(), { items: [], trash: [] });
});
test('independent preset: directory durability failure reports a warning after successful commit', async t => {
  const h = await fixture(t); const failing = withFs({ open: async (p, flags, mode) => { const handle = await fsp.open(p, flags, mode); return p === h.root && flags === 'r' ? wrappedHandle(handle, { sync: async () => { throw ioError('directory fsync unsupported'); } }) : handle; } });
  const result = await createPresetStore({ ...h.options, fsImpl: failing }).save({ document: doc('Committed') }); assert.equal((await h.store.list()).items[0].document.name, 'Committed');
  if (process.platform !== 'win32') assert.match(result.durabilityWarning, /刷新|持久/);
});
test('independent preset: successful backup recovery propagates directory durability warnings', async t => {
  const h = await fixture(t); await h.store.save({ document: doc('First') }); await h.store.save({ document: doc('Second') }); h.answers.confirm = { response: 1 };
  const failing = withFs({ open: async (p, flags, mode) => { const handle = await fsp.open(p, flags, mode); return p === h.root && flags === 'r' ? wrappedHandle(handle, { sync: async () => { throw ioError('directory fsync unsupported'); } }) : handle; } });
  const result = await createPresetStore({ ...h.options, fsImpl: failing }).recoverBackup(); assert.deepEqual(result.items.map(x => x.document.name), ['First']); assert.equal((await h.store.list()).items[0].document.name, 'First');
  if (process.platform !== 'win32') assert.match(result.durabilityWarning, /刷新|持久/);
});
test('independent preset: native export suggestions preserve all 48 Unicode codepoints without splitting surrogates', async t => {
  const h = await fixture(t);
  for (const name of ['a' + '🙂'.repeat(47), '🙂'.repeat(48), 'x' + '🙂'.repeat(46) + '/']) {
    const expected = name.replace('/', '_'); assert.equal([...name].length, 48);
    assert.equal(await h.store.export(doc(name)), null);
    const suggested = h.calls.save.at(-1)[1].defaultPath;
    assert.equal(Buffer.from(suggested, 'utf8').toString('utf8'), suggested, 'suggestion contains a lone surrogate');
    assert.equal(suggested, expected + '.mintpreset.json');
    assert.equal([...suggested.slice(0, -'.mintpreset.json'.length)].length, 48);
  }
  assert.deepEqual(await tree(h.dir), []);
});
test('independent preset: export names sanitize reserved Windows devices and never authorize relative dialog paths', async t => {
  const h = await fixture(t); for (const name of ['CON', 'nul', 'COM1', 'LPT9', 'aux.txt']) { assert.equal(await h.store.export(doc(name)), null); assert.match(h.calls.save.at(-1)[1].defaultPath, /^_/); }
  h.answers.open = { canceled: false, filePaths: ['relative.mintpreset.json'] }; await assert.rejects(h.store.open());
  h.answers.save = { canceled: false, filePath: 'relative.mintpreset.json' }; await assert.rejects(h.store.export(doc())); assert.deepEqual(await tree(h.dir), []);
});

async function mainHarness() {
  const nativeHostPath = path.join(os.tmpdir(), 'verified-preset-user-data');
  const handlers = new Map(), calls = []; let window;
  const store = Object.fromEntries(['list', 'save', 'remove', 'restore', 'open', 'export', 'recoverBackup'].map(method => [method, async (...args) => { calls.push({ method, args }); return method; }])); store.isBusy = () => false;
  class BrowserWindow { constructor(options) { this.options = options; window = this; this.webContents = { mainFrame: { url: 'mint://app/src/index.html' }, setWindowOpenHandler() {}, on() {}, send() {} }; } on() {} async loadURL() {} }
  const electron = { app: { setName() {}, requestSingleInstanceLock:()=>true, whenReady: () => Promise.resolve(), getPath: () => nativeHostPath, getVersion: () => 'test', on() {}, quit() {}, isPackaged: true }, BrowserWindow, dialog: {}, ipcMain: { handle: (n, f) => handlers.set(n, f), on() {} }, Menu: { setApplicationMenu() {}, buildFromTemplate: x => x }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session: { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } } };
  const rootedRequire = createRequire(path.join(ROOT, 'main.cjs'));
  const context = vm.createContext({ require: n => n === 'electron' ? electron : n === './src/preset-codec.cjs' ? { createCodec: options => { assert.equal(options.advancedTone, Tone); return codec; } } : n === './preset-store.cjs' ? { createPresetStore: options => { assert.equal(options.root, path.join(nativeHostPath, 'adjustment-presets')); return store; } } : rootedRequire(n), __dirname: ROOT, process, Response, URL, Uint8Array, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8'), context); await new Promise(resolve => setImmediate(resolve));
  return { handlers, calls, window, event: () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) };
}
test('independent preset: all seven real main bridge handlers reject wrong webContents, subframe and navigated URL', async () => {
  const h = await mainHarness(), preset = [...h.handlers.entries()].filter(([k]) => k.startsWith('presets:')); assert.equal(preset.length, 7);
  for (const [, invoke] of preset) {
    await assert.rejects(invoke({ sender: {}, senderFrame: h.window.webContents.mainFrame }), /Untrusted/);
    await assert.rejects(invoke({ sender: h.window.webContents, senderFrame: { url: 'mint://app/src/index.html' } }), /Untrusted/);
    h.window.webContents.mainFrame.url = 'mint://app/src/other.html'; await assert.rejects(invoke(h.event()), /Untrusted/); h.window.webContents.mainFrame.url = 'mint://app/src/index.html';
  }
  assert.equal(h.calls.length, 0);
  assert.equal(await h.handlers.get('presets:open')(h.event(), '/renderer/path'), 'open'); assert.equal(h.calls[0].args.length, 0);
  const payload = { document: doc() }; assert.equal(await h.handlers.get('presets:save')(h.event(), payload), 'save'); assert.equal(h.calls[1].args[0], payload);
});
test('independent preset: real preload exposes explicit operations and no arbitrary IPC or renderer-selected import path', async () => {
  let desktop; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'preload.cjs'), 'utf8'), { require: n => { assert.equal(n, 'electron'); return { contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'desktop'); desktop = value; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); }, send() {}, on() {}, removeListener() {} } }; } });
  assert.ok(Object.isFrozen(desktop)); await desktop.importPreset('/ignored/renderer/path'); await desktop.recoverPresetBackup('/ignored'); assert.deepEqual(calls, [['presets:open'], ['presets:recover']]);
  assert.equal(desktop.invoke, undefined); assert.equal(desktop.readFile, undefined); assert.equal(desktop.writeFile, undefined);
});

function syntheticFace() {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  oval.forEach((p, i) => { const a = i * 2 * Math.PI / oval.length; points[p] = { x: .5 + .31 * Math.sin(a), y: .5 - .43 * Math.cos(a) }; });
  return points;
}
test('independent preset: full parsed recipe gives byte-exact beauty→basic→advanced native/worker replay without models', () => {
  const Portrait = require('../src/portrait-engine.cjs'), Local = require('../src/local-adjustments.cjs'), Core = require('../export-render-core.cjs'), Project = require('../src/project-document.cjs');
  const value = doc('Full replay'); Object.assign(value.controls.basic, { exposure: 8, contrast: -6, saturation: 11, temperature: -4 }); Object.assign(value.controls.beauty, { smooth: 27, brighten: 35, warmth: 12, underEye: 14, redness: 19, lip: 8, blush: 11, palette: 'rose' }); value.controls.advancedTone = Tone.defaults(); value.controls.advancedTone.curves.rgb = [0, .22, .55, .8, 1]; value.controls.advancedTone.hsl[1] = { hue: 4, saturation: -6, luminance: 3 };
  const parsed = codec.parse(codec.stringify(value)), settings = { ...Project.DEFAULT_SETTINGS, spots: [], localLayers: [], manualLiquify: [], manualRepair: [], ...parsed.controls.basic, ...parsed.controls.beauty, advancedTone: parsed.controls.advancedTone };
  const image = { width: 89, height: 103, data: new Uint8ClampedArray(89 * 103 * 4) };
  for (let n = 0; n < 89 * 103; n++) image.data.set([150 + n % 41, 108 + n % 23, 85 + n % 17, n % 31 ? 255 : 0], n * 4);
  const before = image.data.slice(), face = syntheticFace(), analysis = { landmarks: [face], sourceRevision: 'synthetic-preset:0' };
  const expected = Tone.apply(Local.tone(Portrait.beauty(image, settings, [face]), settings), parsed.controls.advancedTone), actual = Core.processPixels(image, settings, analysis);
  assert.deepEqual(actual.data, expected.data); assert.notDeepEqual(actual.data, before); assert.deepEqual(image.data, before);
  let result; const context = vm.createContext({ input: Array.from(image.data), width: image.width, height: image.height, settingsJSON: JSON.stringify(settings), analysisJSON: JSON.stringify(analysis), self: { postMessage: value => { result = value; } } });
  context.importScripts = (...names) => { for (const n of names) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', n), 'utf8'), context); };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/pixel-worker.js'), 'utf8'), context); vm.runInContext('self.onmessage({data:{width,height,buffer:Uint8ClampedArray.from(input).buffer,settings:JSON.parse(settingsJSON),analysis:JSON.parse(analysisJSON)}})', context);
  assert.equal(result.error, undefined); assert.deepEqual(new Uint8ClampedArray(result.buffer), expected.data);
  for (let n = 0; n < before.length; n += 4) { assert.equal(actual.data[n + 3], before[n + 3]); if (!before[n + 3]) assert.deepEqual(actual.data.subarray(n, n + 4), before.subarray(n, n + 4)); }
});
