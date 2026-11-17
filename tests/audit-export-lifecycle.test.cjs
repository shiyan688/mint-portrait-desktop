'use strict';
// Electron lifecycle order is reproduced without launching a native browser.
// Image export itself uses the real native decoder and worker, not a fake success.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const sharp = require('sharp');
const Codec = require('../src/project-document.cjs');
const root = path.resolve(__dirname, '..');

async function harness(options = {}) {
  const ipc = new Map(), events = new Map(), app = new EventEmitter(), messages = [];
  const renderer = require('../export-renderer.cjs').createExportRenderer();
  const backend = { disposed: false, probe: async () => ({ ready: true }), dispose() { this.disposed = true; } };
  let window, response = 0;
  Object.assign(app, { setName() {}, requestSingleInstanceLock:()=>true, whenReady: () => Promise.resolve(), isPackaged: true, getVersion: () => '0.2.0', quit() {} });
  class BrowserWindow {
    constructor() {
      window = this; this.handlers = new Map();
      this.webContents = { mainFrame: { url: 'mint://app/src/index.html' }, setWindowOpenHandler() {}, on() {}, send() {} };
    }
    on(name, fn) { this.handlers.set(name, fn); }
    async loadURL() {}
    close() {}
  }
  const electron = {
    app, BrowserWindow,
    dialog: { showMessageBox: async (_window, message) => { messages.push(message); return { response }; }, showOpenDialog: async () => ({ canceled: false, filePaths: [options.directory] }) },
    ipcMain: { handle: (name, fn) => ipc.set(name, fn), on: (name, fn) => events.set(name, fn) },
    Menu: { setApplicationMenu() {}, buildFromTemplate: value => value },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }
  };
  const localRequire = createRequire(path.join(root, 'main.cjs'));
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === './export-renderer.cjs' ? { createExportRenderer: () => renderer } : name === './desktop-ai.cjs' ? { createDesktopAI: () => backend } : name === './desktop-core.cjs' && options.write ? { ...localRequire(name), writeUniqueImage: options.write } : localRequire(name),
    __dirname: root, process, Response, URL, Uint8Array, console
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const attemptClose = async () => { let prevented = false; app.emit('before-quit'); await window.handlers.get('close')({ preventDefault() { prevented = true; } }); return prevented; };
  return { app, renderer, backend, ipc, events, event, window, messages, attemptClose, respond: value => { response = value; } };
}

test('cancelled app.quit retains backend and actual export service; will-quit disposes both', async () => {
  const h = await harness();
  const bytes = new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 4, background: '#6789ab' } }).png().toBuffer());
  const request = id => ({ requestId: id, bytes, sourceRevision: 'p:source-0', settings: structuredClone(Codec.DEFAULT_SETTINGS), analysis: { sourceRevision: 'p:source-0', landmarks: [] }, mode: 'original', format: 'png', quality: .94 });
  try {
    await h.ipc.get('backend:probe')(h.event());
    assert.equal((await h.ipc.get('export:render')(h.event(), request('before-quit'))).width, 12);
    h.events.get('session:dirty')(h.event(), true);
    // Electron emits before-quit first, and then allows the close handler to cancel.
    h.app.emit('before-quit');
    let prevented = false;
    await h.window.handlers.get('close')({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.backend.disposed, false, 'Cancelling quit must preserve the backend');
    const result = await h.ipc.get('export:render')(h.event(), request('after-cancelled-quit'));
    assert.equal((await sharp(result.bytes).metadata()).width, 12);
    h.app.emit('will-quit');
    assert.equal(h.backend.disposed, true);
    await assert.rejects(h.ipc.get('export:render')(h.event(), request('after-will-quit')), /已关闭/);
  } finally { h.renderer.dispose(); }
});

test('clean project cannot quit during native rendering; queue cancellation then permits closing', async () => {
  const h = await harness();
  const bytes = new Uint8Array(await sharp({ create: { width: 2000, height: 2000, channels: 4, background: '#6789ab' } }).png().toBuffer());
  const request = { requestId: 'busy-render', bytes, sourceRevision: 'p:source-0', settings: structuredClone(Codec.DEFAULT_SETTINGS), mode: 'original', format: 'png', quality: .94 };
  try {
    h.events.get('session:dirty')(h.event(), false);
    const pending = h.ipc.get('export:render')(h.event(), request);
    const failure = assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(await h.attemptClose(), true);
    assert.match(h.messages.at(-1).message, /导出队列中停止/);
    assert.equal(await h.ipc.get('export:cancel-render')(h.event(), request.requestId), true);
    await failure;
    assert.equal(await h.attemptClose(), false);
  } finally { h.renderer.dispose(); }
});

test('clean project cannot quit during atomic file commit and may close after success or failure', async () => {
  const fsp = require('node:fs/promises'), os = require('node:os');
  const { writeUniqueImage } = require('../desktop-core.cjs');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mint-close-commit-'));
  const bytes = new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 4, background: '#6789ab' } }).png().toBuffer());
  const original = Buffer.from('never overwrite an existing original');
  await fsp.writeFile(path.join(directory, 'photo.png'), original);
  try {
    for (const fail of [false, true]) {
      let release;
      const wait = new Promise(resolve => { release = resolve; });
      const h = await harness({ directory, write: async (...args) => { await wait; if (fail) throw new Error('simulated full disk'); return writeUniqueImage(...args); } });
      try {
        const folder = await h.ipc.get('export:choose-folder')(h.event());
        const pending = h.ipc.get('export:write')(h.event(), { folderToken: folder.token, name: 'photo.png', bytes });
        const rejected = fail ? assert.rejects(pending, /simulated full disk/) : null;
        assert.equal(await h.attemptClose(), true);
        assert.match(h.messages.at(-1).message, /正在提交导出文件/);
        release();
        if (fail) await rejected;
        else {
          const receipt = await pending;
          assert.equal(receipt.filename, 'photo (1).png');
          assert.equal((await sharp(await fsp.readFile(path.join(directory, receipt.filename))).metadata()).width, 12);
        }
        assert.equal(await h.attemptClose(), false);
      } finally { release(); h.renderer.dispose(); }
    }
    assert.deepEqual(await fsp.readFile(path.join(directory, 'photo.png')), original);
    assert.deepEqual((await fsp.readdir(directory)).sort(), ['photo (1).png', 'photo.png']);
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
});
