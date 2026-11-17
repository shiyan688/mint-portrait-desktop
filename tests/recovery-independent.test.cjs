'use strict';
// Independent adversarial recovery review. Synthetic fixtures only; no Electron,
// browser, network, inference model, or user photo is executed by these tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const P = require('../src/project-document.cjs');
const { createRecoveryStore, FILES } = require('../recovery-store.cjs');
const basePath = path.resolve(__dirname, '..');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function png() {
  const crc = b => { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, b) => { const type = Buffer.from(name), result = Buffer.alloc(b.length + 12); result.writeUInt32BE(b.length); type.copy(result, 4); b.copy(result, 8); result.writeUInt32BE(crc(Buffer.concat([type, b])), result.length - 4); return result; };
  const head = Buffer.alloc(13); head.writeUInt32BE(1); head.writeUInt32BE(1, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.from([0,17,73,129,255]))), chunk('IEND', Buffer.alloc(0))]);
}
async function project(exposure = 0) {
  const settings = { ...P.DEFAULT_SETTINGS, exposure, spots: [] };
  return Buffer.from(await P.encode({ version: 7, currentId: 'independent-synthetic', photos: [{ id: 'independent-synthetic', name: 'synthetic-one-pixel.png', sourceRevision: 'independent-source-v1', source: { bytes: png(), mime: 'image/png', width: 1, height: 1 }, selected: true, settings, committed: settings, undo: [{ ...P.DEFAULT_SETTINGS, spots: [] }], redo: [], revision: 2, preset: null, learnedCache: [] }] }));
}
async function fixture(t, options = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-independent-recovery-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'recovery-drafts'), store = createRecoveryStore({ root, ...options });
  return { parent, root, store, file: slot => path.join(root, FILES[slot]) };
}
async function enable(f) { await f.store.configure({ enabled: true, budgetMiB: 128 }); }

test('independent: failed removal of a newly linked temporary cannot strand the only draft as an unreadable hardlink', async t => {
  let failCleanup = false;
  const adapter = { ...fs, unlink: async p => { if (failCleanup && path.basename(p).startsWith('.' + FILES.latest)) throw Object.assign(new Error('Synthetic cleanup access denied'), { code: 'EACCES' }); return fs.unlink(p); } };
  const f = await fixture(t, { fs: adapter }); await enable(f); const bytes = await project(1); failCleanup = true;
  const result = await f.store.save({ bytes });
  assert.equal(result.committed, true);
  // A reported durable draft must remain recoverable through the public API,
  // not merely exist as payload bytes a user could manually repair on disk.
  const reopened = await f.store.open({ slot: 'latest' });
  assert.deepEqual(Buffer.from(reopened.bytes), bytes);
  const fresh = createRecoveryStore({ root: f.root });
  assert.equal((await fresh.status()).slots[0].retainedTemporaryLink, true);
  assert.deepEqual(Buffer.from((await fresh.open({ slot: 'latest' })).bytes), bytes);
  await fs.link(f.file('latest'), path.join(f.parent, 'untrusted-external-alias'));
  await assert.rejects(fresh.open({ slot: 'latest' }));
});

test('independent: a UUID-looking unrelated temp never legitimizes an external hardlink', async t => {
  const f = await fixture(t); await enable(f); const bytes = await project(4), original = path.join(f.parent, 'external-original');
  await fs.writeFile(original, bytes); await fs.link(original, f.file('latest'));
  const disguise = path.join(f.root, `.${FILES.latest}.12345678-1234-4321-8123-123456789abc.tmp`); await fs.writeFile(disguise, bytes);
  await assert.rejects(f.store.open({ slot: 'latest' })); await assert.rejects(f.store.save({ bytes }));
  assert.deepEqual(await fs.readFile(original), bytes); assert.deepEqual(await fs.readFile(disguise), bytes);
});

test('independent: an error reported after a successful link plus failed cleanup still reports the actual committed stage', async t => {
  let trigger = false;
  const adapter = { ...fs,
    link: async (a,b) => { await fs.link(a,b); if (trigger && b.endsWith(FILES.latest)) throw Object.assign(new Error('Synthetic link return error after successful commit'), { code: 'EIO' }); },
    unlink: async p => { if (trigger && path.basename(p).startsWith('.' + FILES.latest)) throw Object.assign(new Error('Synthetic cleanup denied'), { code: 'EACCES' }); return fs.unlink(p); }
  };
  const f = await fixture(t, { fs: adapter }); await enable(f); const bytes = await project(3); trigger = true;
  let result; try { result = await f.store.save({ bytes }); } catch (error) { result = error; }
  assert.deepEqual(await fs.readFile(f.file('latest')), bytes);
  assert.equal(result.committed, true, 'a verified committed inode is not an uncommitted save just because its known temporary alias cannot be removed');
  assert.deepEqual(Buffer.from((await createRecoveryStore({ root: f.root }).open({ slot: 'latest' })).bytes), bytes);
});

test('independent: replacement of the recovery directory before temporary open must not disclose snapshot bytes', async t => {
  let trigger = false, root, parked; const writes = [];
  const adapter = { ...fs, open: async (...args) => {
    if (trigger && args[1] === 'wx' && path.basename(args[0]).startsWith('.' + FILES.latest)) {
      trigger = false; await fs.rename(root, parked); await fs.mkdir(root);
    }
    const handle = await fs.open(...args);
    if (args[1] === 'wx') { const write = handle.write.bind(handle); handle.write = async (...a) => { writes.push({ file: args[0], payload: Buffer.from(a[0]) }); return write(...a); }; }
    return handle;
  } };
  const f = await fixture(t, { fs: adapter }); root = f.root; parked = path.join(f.parent, 'original-owned-directory');
  await enable(f); writes.length = 0; trigger = true;
  await assert.rejects(f.store.save({ bytes: await project(2) }));
  assert.equal(writes.length, 0, 'replaced directory received a complete private project before the identity check rejected the save');
});

test('independent: replacement root at read-open boundary never reads payload from the substituted directory', async t => {
  let trigger = false, root, parked, replacement, reads = 0;
  const adapter = { ...fs, open: async (...args) => {
    if (trigger && args[0].endsWith(FILES.latest)) { trigger = false; await fs.rename(root, parked); await fs.mkdir(root); await fs.writeFile(path.join(root, FILES.latest), replacement); }
    const handle = await fs.open(...args);
    if (args[0].endsWith(FILES.latest)) { const read = handle.read.bind(handle); handle.read = async (...a) => { const r = await read(...a); reads += r.bytesRead; return r; }; }
    return handle;
  } };
  const f = await fixture(t, { fs: adapter }); root = f.root; parked = path.join(f.parent, 'parked-root'); await enable(f); await f.store.save({ bytes: await project(1) });
  reads = 0; replacement = await project(9); trigger = true;
  await assert.rejects(f.store.open({ slot: 'latest' })); assert.equal(reads, 0);
});

test('independent: corrupt content with a valid header is not considered fully valid and cannot rotate over last good', async t => {
  const f = await fixture(t); await enable(f); const older = await project(1), newer = await project(2);
  await f.store.save({ bytes: older }); await f.store.save({ bytes: newer });
  const corrupt = Buffer.from(newer); corrupt[corrupt.length - 1] ^= 0x80; await fs.writeFile(f.file('latest'), corrupt);
  const fresh = createRecoveryStore({ root: f.root });
  assert.equal((await fresh.status()).slots[0].validation, 'header-only');
  const candidate = await fresh.open({ slot: 'latest' });
  assert.equal(candidate.requiresFallbackChoice, true); assert.equal(candidate.fallbackCandidate.validation, 'verified');
  assert.equal(Object.hasOwn(candidate, 'bytes'), false); assert.equal(Object.hasOwn(candidate.fallbackCandidate, 'bytes'), false);
  await assert.rejects(fresh.save({ bytes: await project(3) }));
  assert.deepEqual(await fs.readFile(f.file('previous')), older); assert.deepEqual(await fs.readFile(f.file('latest')), corrupt);
  assert.deepEqual(Buffer.from((await fresh.open({ slot: 'previous' })).bytes), older);
});

async function mainHarness({ owns = true, dialogResult = { response: 0 } } = {}) {
  const handlers = new Map(), events = new Map(), appEvents = new Map(), calls = { quit: 0, ready: 0, windows: 0, cancel: 0, dispose: 0, recovery: [], messages: [], roots: [] };
  let window; const controls = { busy: false, dialogResult, errors: {} };
  const service = { isBusy: () => controls.busy, cancel: () => { calls.cancel++; return { requested: controls.busy }; }, status: async () => ({ ready: true }) };
  for (const name of ['save', 'open', 'configure']) service[name] = async payload => { calls.recovery.push({ name, payload }); if (controls.errors[name]) throw controls.errors[name]; return { ok: true }; };
  class BrowserWindow {
    constructor(options) { window = this; this.options = options; calls.windows++; this.handlers = new Map(); this.webContents = { mainFrame: { url: 'mint://app/src/index.html' }, setWindowOpenHandler() {}, on() {}, send() {} }; }
    on(name, fn) { this.handlers.set(name, fn); }
    async loadURL() {}
    async close() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; await this.handlers.get('close')(event); return event; }
    isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {}
  }
  const electron = {
    app: { setName() {}, requestSingleInstanceLock: () => owns, quit: () => calls.quit++, whenReady: () => { calls.ready++; return Promise.resolve(); }, getPath: () => '/host-user-data', getVersion: () => 'independent-test', on: (n, f) => appEvents.set(n, f), isPackaged: true },
    BrowserWindow,
    dialog: { showMessageBox: async (_window, options) => { calls.messages.push(options); return typeof controls.dialogResult === 'function' ? controls.dialogResult(options) : controls.dialogResult; } },
    ipcMain: { handle: (n, f) => handlers.set(n, f), on: (n, f) => events.set(n, f) },
    Menu: { setApplicationMenu() {}, buildFromTemplate: x => x }, protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }
  };
  const localRequire = createRequire(path.join(basePath, 'main.cjs'));
  const context = vm.createContext({ require: name => {
    if (name === 'electron') return electron;
    if (name === './recovery-store.cjs') return { createRecoveryStore: options => { calls.roots.push(options.root); return service; } };
    if (name === './desktop-ai.cjs') return { createDesktopAI: () => ({ probe: async () => ({}), dispose: () => calls.dispose++ }) };
    if (name === './export-renderer.cjs') return { createExportRenderer: () => ({ render: async () => ({}), isBusy: () => false, dispose: () => calls.dispose++ }) };
    return localRequire(name);
  }, __dirname: basePath, process, Response, URL, Uint8Array, console });
  vm.runInContext(await fs.readFile(path.join(basePath, 'main.cjs'), 'utf8'), context);
  await new Promise(r => setImmediate(r));
  const sender = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { handlers, events, appEvents, calls, controls, get window() { return window; }, sender, invoke: (name, payload) => handlers.get(name)(sender(), payload) };
}

test('independent main: losing the instance lock never registers IPC, waits for ready, or creates a window', async () => {
  const h = await mainHarness({ owns: false });
  assert.equal(h.calls.quit, 1); assert.equal(h.calls.ready, 0); assert.equal(h.calls.windows, 0);
  assert.equal(h.handlers.size, 0); assert.equal(h.events.size, 0); assert.equal(h.appEvents.size, 0);
});

test('independent main: every recovery channel validates sender, exact main frame and app URL before touching service', async () => {
  const h = await mainHarness();
  for (const [name, handler] of h.handlers) {
    if (!name.startsWith('recovery:')) continue;
    const frame = h.window.webContents.mainFrame;
    for (const bad of [{ sender: {}, senderFrame: frame }, { sender: h.window.webContents, senderFrame: { url: frame.url } }, { sender: h.window.webContents, senderFrame: null }]) await assert.rejects(handler(bad, {}), /Untrusted/);
    const original = frame.url; frame.url += '#attacker'; await assert.rejects(handler(h.sender(), {}), /Untrusted/); frame.url = original;
  }
  assert.equal(h.calls.roots.length, 0); assert.equal(h.calls.recovery.length, 0); assert.equal(h.calls.cancel, 0);
  await h.invoke('recovery:status'); assert.deepEqual(h.calls.roots, [path.join('/host-user-data', 'recovery-drafts')]);
});

test('independent main: a canceled quit keeps backend/export services and recovery work alive', async () => {
  const h = await mainHarness(); await h.invoke('backend:probe'); await h.invoke('export:render', {}); await h.invoke('recovery:status');
  h.events.get('session:dirty')(h.sender(), true);
  if (h.appEvents.has('before-quit')) await h.appEvents.get('before-quit')({ preventDefault() {} });
  assert.equal((await h.window.close()).prevented, true);
  assert.equal(h.calls.cancel, 0); assert.equal(h.calls.dispose, 0);
  await h.invoke('recovery:save', { bytes: new Uint8Array(64) }); assert.equal(h.calls.recovery.length, 1);
  await h.appEvents.get('will-quit')(); assert.equal(h.calls.cancel, 1); assert.equal(h.calls.dispose, 2);
});

test('independent main: busy close is prevented without auto-canceling the committed-stage operation', async () => {
  const h = await mainHarness(); await h.invoke('recovery:status'); h.controls.busy = true;
  assert.equal((await h.window.close()).prevented, true);
  assert.equal(h.calls.cancel, 0); assert.equal(h.calls.dispose, 0); assert.equal(h.calls.messages.length, 1);
  assert.match(h.calls.messages[0].message, /恢复草稿/);
});

test('independent main: accepted close blocks all later recovery save, configure and open requests', async () => {
  const h = await mainHarness({ dialogResult: { response: 1 } });
  h.events.get('session:dirty')(h.sender(), true); await h.window.close();
  for (const name of ['save', 'configure', 'open']) await assert.rejects(h.invoke('recovery:' + name, {}), /关闭/);
  assert.equal(h.calls.recovery.length, 0); assert.equal(h.calls.roots.length, 0);
});

test('independent main: partial, committed and uncertain save failures cross IPC as bounded explicit data', async () => {
  const h = await mainHarness();
  for (const expected of [{ committed: false, backupCommitted: true, commitUncertain: false }, { committed: true, backupCommitted: true, commitUncertain: false }, { committed: null, backupCommitted: false, commitUncertain: true }]) {
    h.controls.errors.save = Object.assign(new Error('x'.repeat(3000)), { ...expected, code: 'y'.repeat(100) });
    const result = await h.invoke('recovery:save', { bytes: new Uint8Array(64) });
    assert.equal(result.failed, true); assert.equal(result.canceled, false); assert.equal(result.committed, expected.committed); assert.equal(result.backupCommitted, expected.backupCommitted); assert.equal(result.commitUncertain, expected.commitUncertain);
    assert.equal(result.error.length, 2000); assert.equal(result.code.length, 80);
  }
});

test('independent preload: recovery surface forwards only data and has no renderer path chooser', async () => {
  let desktop; const invoked = [];
  vm.runInNewContext(await fs.readFile(path.join(basePath, 'preload.cjs'), 'utf8'), { require: name => {
    assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'desktop'); desktop = api; } }, ipcRenderer: { invoke: (...args) => { invoked.push(args); return Promise.resolve(); }, send() {}, on() {}, removeListener() {} } };
  } });
  assert.equal(Object.isFrozen(desktop), true);
  const data = { bytes: new Uint8Array(64) }, configuration = { enabled: true, budgetMiB: 64 }, choice = { slot: 'previous' };
  await desktop.recoveryStatus(); await desktop.saveRecoveryDraft(data); await desktop.configureRecovery(configuration); await desktop.openRecoveryDraft(choice); await desktop.cancelRecoveryDraft();
  assert.deepEqual(invoked, [['recovery:status'], ['recovery:save', data], ['recovery:configure', configuration], ['recovery:open', choice], ['recovery:cancel']]);
});

let uiInfrastructure;
function uiSupport() {
  if (!uiInfrastructure) {
    // Reuse only the existing authored DOM/canvas doubles, not owner assertions.
    const syncFs = require('node:fs');
    let source = syncFs.readFileSync(path.join(__dirname, 'reference-compare-ui.test.cjs'), 'utf8');
    const boundary = source.indexOf('const pixels = canvas =>'); assert.ok(boundary > 0); source = source.slice(0, boundary);
    source = source.replace('  let app=fs.readFileSync', `  for (const [file,name] of [['recovery-controller.cjs','MintRecoveryController'],['preview-pixel-inspector.cjs','MintPreviewPixelInspector']]) { vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/',file),'utf8'),context); context.window[name]=context[name]; }\n  let app=fs.readFileSync`);
    source = source.replace('setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){}', 'setTimeout:(fn,delay)=>{const id=++timer;(calls.timers||(calls.timers=new Map())).set(id,{fn,delay});if(delay===0)queueMicrotask(()=>{if(calls.timers.has(id)){calls.timers.delete(id);fn();}});return id;},clearTimeout:id=>calls.timers?.delete(id)');
    source = source.replace('globalThis.audit={pinReference', 'globalThis.audit={recoveryController,recoveryCaptureState,captureRecovery,restoreRecovery,cancelRecovery,pinReference');
    uiInfrastructure = new Function('require', '__dirname', source + '\nreturn {ready,flush,until,snapshot,png};')(require, __dirname);
  }
  return uiInfrastructure;
}
async function uiReady(options = {}) {
  const disk = { ready: true, enabled: false, budgetMiB: 128, slots: [], rootPath: '/synthetic-owned/recovery-drafts', totalBytes: 0, storageBytes: 0, storageComplete: true, ...options.disk };
  const calls = { save: [], open: [], cancel: 0, settings: [] };
  const bridge = { recoveryStatus: async () => structuredClone(disk), saveRecoveryDraft: async payload => { calls.save.push(payload); return { committed: true, sizeBytes: payload.bytes.length }; }, configureRecovery: async next => { calls.settings.push(next); Object.assign(disk, next); return { ...next, committed: true }; }, openRecoveryDraft: async choice => { calls.open.push(choice); return { canceled: true }; }, cancelRecoveryDraft: async () => { calls.cancel++; return { requested: true }; }, ...options.bridge };
  const h = await uiSupport().ready({ ...options, bridge });
  // This harness intentionally never executes model initialization. Model failure
  // is a supported editing state, unlike its permanently pending test promise.
  h.api.set({ modelState: 'error' });
  return Object.assign(h, { recoveryCalls: calls, disk });
}
function matteFor(photo, value = .25) {
  return { id: 'synthetic-matte', kind: 'matting', photoId: photo.id, sourceRevision: photo.sourceRevision, originalSize: { width: 100, height: 80 }, bytes: 32000, result: { matte: { width: 100, height: 80, roi: { x: 0, y: 0, width: 100, height: 80 }, space: 'roi-original-pixels', encoding: 'unit-float32', data: new Float32Array(8000).fill(value) }, provenance: { kind: 'model', task: 'matting', modelId: 'synthetic-only-never-executed', modelVersion: '1', weightsSha256: 'd'.repeat(64), device: { kind: 'cpu' } } } };
}

test('independent UI: all photo metadata, histories and learned planes freeze before the first Blob await', async () => {
  const h = await uiReady(), a = h.activate(), b = h.photo('second');
  const matte = matteFor(b); b.learnedCache.set(matte.id, matte); b.undo.push(structuredClone(P.DEFAULT_SETTINGS)); b.redo.push({ ...structuredClone(P.DEFAULT_SETTINGS), contrast: 7 });
  const initialSource = Buffer.from(await a.blob.arrayBuffer()), original = { name: b.name, revision: b.revision, sourceRevision: b.sourceRevision, blob: b.blob };
  const gate = defer(); a.blob.arrayBuffer = () => gate.promise;
  const pending = h.api.projectSnapshot();
  b.name = 'changed.png'; b.settings.exposure = 12; b.committed.exposure = 12; b.undo[0].contrast = 31; b.redo[0].contrast = 99; b.sourceRevision = 'new-source'; b.blob = new Blob([uiSupport().png(10,10)], { type: 'image/png' }); matte.result.matte.data.fill(.75);
  gate.resolve(initialSource.buffer.slice(initialSource.byteOffset, initialSource.byteOffset + initialSource.byteLength));
  const snapshot = await pending, captured = snapshot.photos[1];
  assert.equal(captured.name, original.name); assert.equal(captured.sourceRevision, original.sourceRevision); assert.equal(captured.settings.exposure, 0); assert.equal(captured.committed.exposure, 0);
  assert.equal(captured.undo[0].contrast, 0); assert.equal(captured.redo[0].contrast, 7); assert.equal(captured.learnedCache[0].result.matte.data[0], .25);
  assert.deepEqual(Buffer.from(captured.source.bytes), Buffer.from(await original.blob.arrayBuffer()));
  const decoded = await P.decode(await P.encode(structuredClone(snapshot))); assert.equal(decoded.photos[1].learnedCache[0].result.matte.data[7999], .25);
});

test('independent UI: source/cache capacity fails before Blob reads or mutable deep-clone allocation', async () => {
  const h = await uiReady(), p = h.activate(); let reads = 0, clones = 0;
  p.blob.arrayBuffer = () => { reads++; throw new Error('Should never read oversized input'); };
  const nativeClone = h.context.structuredClone; h.context.structuredClone = v => { clones++; return nativeClone(v); };
  await assert.rejects(h.api.projectSnapshot({ budgetBytes: 1 }), /容量/);
  assert.equal(reads, 0); assert.equal(clones, 0);
});

test('independent UI: encoded metadata overflow is caught before allocating a contiguous project buffer', async () => {
  const h = await uiReady({ codec: { encodeParts: async () => ({ byteLength: 65 * 1024 * 1024, parts: [] }) } }); h.activate();
  await assert.rejects(h.api.captureRecovery({ assertCurrent() {}, budgetBytes: 64 * 1024 * 1024 }), /容量/);
  assert.equal(h.recoveryCalls.save.length, 0);
});

test('independent UI: opt-out never reads a Blob or serializes a project even when Save now is invoked', async () => {
  const h = await uiReady(), p = h.activate(); let reads = 0; p.blob.arrayBuffer = () => { reads++; throw new Error('Disabled recovery read source'); };
  h.api.recoveryController.observe(); await h.api.recoveryController.saveNow(); await h.api.recoveryController.refresh();
  assert.equal(reads, 0); assert.equal(h.calls.encoded.length, 0); assert.equal(h.recoveryCalls.save.length, 0);
});

test('independent UI: prior drafts hold automatic capture until an explicit start decision', async () => {
  const h = await uiReady({ disk: { enabled: true, slots: [{ slot: 'latest', exists: true, validation: 'header-only' }] } }); h.activate();
  h.api.recoveryController.observe(); await h.api.recoveryController.saveNow(); await h.api.recoveryController.refresh();
  assert.equal(h.api.recoveryController.getState().hold, true); assert.equal(h.recoveryCalls.save.length, 0);
  h.api.recoveryController.beginCycle(); await h.api.recoveryController.saveNow();
  assert.equal(h.recoveryCalls.save.length, 1); assert.equal(h.api.hasUnsavedProjectChanges(), true); assert.equal(h.calls.saved.length, 0);
});

test('independent UI: canceled replacement leaves current unsaved work, original bytes and reference intact', async () => {
  const bytes = await P.encode(uiSupport().snapshot('recovery-candidate', { exposure: 21 }));
  const h = await uiReady({ disk: { slots: [{ slot: 'latest', exists: true }] }, bridge: { openRecoveryDraft: async () => ({ bytes }), confirmReplaceProject: async () => false } }), p = h.activate();
  await h.api.renderCurrent(); await uiSupport().flush(); assert.equal(h.api.pinReference(), true);
  const reference = h.api.get().referenceSnapshot, original = p.blob, before = h.api.projectFingerprint();
  await h.api.restoreRecovery('latest');
  assert.equal(h.api.photos[0], p); assert.equal(h.api.photos[0].blob, original); assert.equal(h.api.projectFingerprint(), before); assert.equal(h.api.get().referenceSnapshot, reference); assert.equal(h.api.hasUnsavedProjectChanges(), true);
  assert.equal(h.recoveryCalls.save.length, 0); assert.equal(h.calls.saved.length, 0);
});

test('independent UI: approved recovery is formally unsaved until explicit manual project save succeeds', async () => {
  const bytes = await P.encode(uiSupport().snapshot('restored-explicit', { exposure: 15 }));
  const h = await uiReady({ bridge: { openRecoveryDraft: async () => ({ bytes }) } }); h.activate();
  await h.api.restoreRecovery('latest'); await uiSupport().flush();
  assert.equal(h.api.photos[0].id, 'restored-explicit'); assert.equal(h.api.photos[0].settings.exposure, 15); assert.equal(h.api.get().savedProjectFingerprint, null); assert.equal(h.api.get().projectDisplayName, ''); assert.equal(h.api.hasUnsavedProjectChanges(), true); assert.equal(h.calls.dirty.at(-1), true);
  assert.equal(h.calls.model, 0); assert.equal(h.calls.saved.length, 0);
  await h.api.saveProject(); await uiSupport().flush(); assert.equal(h.calls.saved.length, 1); assert.equal(h.api.hasUnsavedProjectChanges(), false);
});

test('independent UI: fallback information never auto-adopts previous bytes or confirms replacement', async () => {
  const h = await uiReady({ bridge: { openRecoveryDraft: async () => ({ canceled: true, requiresFallbackChoice: true, error: 'synthetic corrupt latest', fallbackCandidate: { slot: 'previous', validation: 'verified', modifiedAt: 'synthetic date' } }) } }), p = h.activate(), before = h.api.projectFingerprint();
  await h.api.restoreRecovery('latest');
  assert.equal(h.api.photos[0], p); assert.equal(h.api.projectFingerprint(), before); assert.equal(h.calls.confirm, 0); assert.equal(h.calls.decoded.length, 0); assert.match(h.get('recoveryFallback').textContent, /明确点击/);
});

test('independent UI: late restore result after Cancel is discarded without touching current project', async () => {
  const gate = defer(), bytes = await P.encode(uiSupport().snapshot('too-late'));
  let requested = false; const h = await uiReady({ bridge: { openRecoveryDraft: async () => { requested = true; return gate.promise; } } }), p = h.activate(), before = h.api.projectFingerprint();
  const task = h.api.restoreRecovery('latest'); await uiSupport().until(() => requested);
  await h.api.cancelRecovery(); gate.resolve({ bytes }); await task;
  assert.equal(h.api.photos[0], p); assert.equal(h.api.projectFingerprint(), before); assert.equal(h.calls.confirm, 0); assert.equal(h.calls.decoded.length, 0); assert.equal(h.api.get().projectOperation, '');
});

for (const mutation of ['same-size source replacement', 'history edit', 'cache replacement', 'cache plane replacement', 'cache metadata edit', 'cache in-place mutation', 'cache buffer detachment']) test(`independent UI: unobserved ${mutation} during capture cannot commit stale bytes`, async () => {
  const h = await uiReady({ disk: { enabled: true } }), p = h.activate();
  if (mutation.startsWith('cache')) { const entry = matteFor(p); p.learnedCache.set(entry.id, entry); }
  const original = await p.blob.arrayBuffer(), gate = defer(); let reading = false;
  p.blob.arrayBuffer = () => { reading = true; return gate.promise; };
  const pending = h.api.recoveryController.saveNow(); await uiSupport().until(() => reading);
  if (mutation === 'same-size source replacement') p.blob = new Blob([original], { type: p.blob.type });
  if (mutation === 'history edit') p.undo.push({ ...structuredClone(P.DEFAULT_SETTINGS), exposure: 2 });
  if (mutation === 'cache replacement') p.learnedCache.set('synthetic-matte', matteFor(p, .75));
  if (mutation === 'cache plane replacement') p.learnedCache.get('synthetic-matte').result.matte.data = new Float32Array(8000).fill(.75);
  if (mutation === 'cache metadata edit') p.learnedCache.get('synthetic-matte').result.provenance.modelVersion = 'changed';
  if (mutation === 'cache in-place mutation') p.learnedCache.get('synthetic-matte').result.matte.data.fill(.75);
  if (mutation === 'cache buffer detachment') { const buffer = p.learnedCache.get('synthetic-matte').result.matte.data.buffer; structuredClone(buffer, { transfer: [buffer] }); }
  gate.resolve(original); await pending;
  assert.equal(h.recoveryCalls.save.length, 0, 'late capture retained an invalid live-state binding');
});

const Recovery = require('../src/recovery-controller.cjs');
async function scheduler(options = {}) {
  const timers = new Map(), calls = { captures: 0, saves: 0, canceled: 0 }; let sequence = 0;
  const doc = { fingerprint: 'A', empty: false, safe: true };
  const disk = { ready: true, enabled: true, budgetMiB: 128, slots: [] };
  const bridge = { recoveryStatus: async () => ({ ...disk }), saveRecoveryDraft: async () => { calls.saves++; return { committed: true }; }, cancelRecoveryDraft: async () => { calls.canceled++; return { requested: true }; }, configureRecovery: async next => { Object.assign(disk,next); return { ...next, committed: true }; }, ...options.bridge };
  const controller = Recovery.create({ bridge, readState: () => ({ ...doc }), capture: async ctx => { calls.captures++; return options.capture ? options.capture(ctx) : new Uint8Array(64); }, setTimer: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  await controller.initialize(); return { timers, calls, doc, disk, bridge, controller, async fire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } await uiSupport().flush(); } };
}

test('independent scheduler: every edit restarts a 30-second debounce and one failed stable point has no timer retry', async () => {
  const h = await scheduler({ bridge: { saveRecoveryDraft: async () => ({ failed: true, committed: false, error: 'synthetic disk full' }) } });
  const first = [...h.timers.keys()][0]; assert.equal(h.timers.get(first).delay, 30000);
  h.doc.fingerprint = 'B'; h.controller.observe(); assert.equal(h.timers.has(first), false); assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 30000);
  await h.controller.saveNow(); h.controller.observe(); await h.controller.refresh(); await h.fire(); assert.equal(h.calls.captures, 1); assert.equal(h.timers.size, 0);
  await h.controller.saveNow(); assert.equal(h.calls.captures, 2);
});

test('independent scheduler: ambiguous IPC failure holds every later fingerprint until a fresh explicit cycle', async () => {
  const h = await scheduler({ bridge: { saveRecoveryDraft: async () => { throw new Error('synthetic IPC disconnected'); } } });
  const result = await h.controller.saveNow(); assert.equal(result.committed, null); assert.equal(result.commitUncertain, true); assert.equal(h.controller.getState().hold, true);
  for (const fingerprint of ['B','C','D']) { h.doc.fingerprint = fingerprint; h.controller.observe(); await h.controller.refresh(); await h.fire(); }
  assert.equal(h.calls.captures, 1); assert.equal(h.timers.size, 0);
});

test('independent scheduler: late confirmed commit after an edit is stale, not silently relabeled as the new state', async () => {
  const gate = defer(); let writing = false;
  const h = await scheduler({ bridge: { saveRecoveryDraft: async () => { writing = true; return gate.promise; } } });
  const task = h.controller.saveNow(); await uiSupport().until(() => writing); h.doc.fingerprint = 'B'; h.controller.observe(); gate.resolve({ committed: true, cancelRequested: true }); await task;
  const result = h.controller.getState(); assert.equal(result.lastCommit.fingerprint, 'A'); assert.equal(result.lastCommit.stale, true); assert.match(result.notice, /较新更改仍未记录/); assert.equal(h.calls.canceled, 1);
});

test('independent scheduler: newer status wins over a late stale status response', async () => {
  const h = await scheduler(), old = defer(); let first = true;
  h.bridge.recoveryStatus = async () => first ? (first = false, old.promise) : ({ ready: true, enabled: false, budgetMiB: 64, slots: [] });
  const a = h.controller.refresh(); await h.controller.refresh(); old.resolve({ ready: true, enabled: true, budgetMiB: 512, slots: [] }); await a;
  assert.equal(h.controller.getState().enabled, false); assert.equal(h.controller.getState().budgetMiB, 64); assert.equal(h.timers.size, 0);
});

test('independent scheduler: repeated save requests never queue a second capture, disable waits then prevents all new jobs', async () => {
  const gate = defer(); const h = await scheduler({ capture: () => gate.promise });
  const first = h.controller.saveNow(); await uiSupport().flush(); await h.controller.saveNow(); await h.fire(); assert.equal(h.calls.captures, 1);
  const disable = h.controller.configure({ enabled: false, budgetMiB: 64 }); await uiSupport().flush();
  assert.equal(h.disk.enabled, true, 'disable must wait for the active capture to settle'); assert.equal(h.calls.canceled, 1);
  gate.resolve(new Uint8Array(64)); await Promise.all([first, disable]);
  assert.equal(h.calls.saves, 0); assert.equal(h.controller.getState().enabled, false); assert.equal(h.controller.getState().budgetMiB, 64);
  h.doc.fingerprint = 'later'; h.controller.observe(); await h.controller.saveNow(); await h.fire(); assert.equal(h.calls.captures, 1);
});

for (const outcome of ['canceled','failed','uncertain']) test(`independent scheduler: ${outcome} new capture discloses an already committed backup stage`, async () => {
  const result = { committed: outcome === 'uncertain' ? null : false, backupCommitted: true, canceled: outcome === 'canceled', failed: outcome !== 'canceled', commitUncertain: outcome === 'uncertain', error: outcome === 'failed' ? 'synthetic disk full' : undefined };
  const h = await scheduler({ bridge: { saveRecoveryDraft: async () => result } }); await h.controller.saveNow();
  const state = h.controller.getState(); assert.equal(state.lastAttempt.backupCommitted, true); assert.equal(state.lastCommit, null);
  assert.match(state.error || state.notice, /上一代备份.*更新/);
  if (outcome === 'uncertain') { assert.match(state.error, /不确定/); assert.equal(state.hold, true); }
});

test('independent scheduler: a late cancellation receipt preserves its confirmed backup stage after an IPC exception', async () => {
  const saveGate = defer(), cancelGate = defer(); let writing = false, cancelRequested = false;
  const h = await scheduler({ bridge: {
    saveRecoveryDraft: async () => { writing = true; await saveGate.promise; throw new Error('synthetic IPC lost after backup'); },
    cancelRecoveryDraft: async () => { cancelRequested = true; return cancelGate.promise; }
  } });
  const save = h.controller.saveNow(); await uiSupport().until(() => writing);
  const cancel = h.controller.cancel(); await uiSupport().until(() => cancelRequested);
  saveGate.resolve(); await uiSupport().flush(); cancelGate.resolve({ requested: true, committed: false, backupCommitted: true }); await Promise.all([save,cancel]);
  const state = h.controller.getState(); assert.equal(state.lastAttempt.committed, null); assert.equal(state.lastAttempt.commitUncertain, true);
  assert.equal(state.lastAttempt.backupCommitted, true); assert.match(state.error || state.notice, /上一代备份.*更新/);
});

for (const blocked of ['pointer','manualDraft','matteDraft','cropDraft','backendJob','loadingPhoto','analyzingPhoto','renderingPhoto','renderPending','exportRunning','projectOperation','presetOperation','uncommitted controls']) test(`independent UI: ${blocked} prevents recovery capture without discarding live work`, async () => {
  const h = await uiReady({ disk: { enabled: true } }), p = h.activate(), before = p.blob; let read = false;
  p.blob.arrayBuffer = () => { read = true; throw new Error('Unsafe source read'); };
  if (blocked === 'uncommitted controls') p.settings.exposure = 3;
  else h.api.set({ [blocked]: ['pointer','manualDraft','matteDraft','cropDraft','backendJob','presetOperation'].includes(blocked) ? { photoId: p.id, kind: 'synthetic' } : blocked === 'projectOperation' ? 'synthetic operation' : true });
  await h.api.recoveryController.saveNow(); assert.equal(read, false); assert.equal(h.recoveryCalls.save.length, 0); assert.equal(p.blob, before); assert.equal(h.api.photos[0], p);
  if (blocked === 'uncommitted controls') assert.equal(p.settings.exposure, 3);
});
