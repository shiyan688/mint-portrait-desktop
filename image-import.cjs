'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const Guard = require('./image-import-guards.cjs');
const ERROR_TEXT = Object.freeze({ IMAGE_IMPORT_CANCELLED: 'Image import cancelled.', IMAGE_IMPORT_LIMIT: 'Image exceeds the safe import limits.',
  IMAGE_IMPORT_ANIMATED: 'Animated or multi-frame images are not supported.', IMAGE_IMPORT_FORMAT: 'Choose a JPEG, PNG or WebP image.',
  IMAGE_IMPORT_TIMEOUT: 'Image import took too long and was stopped.', IMAGE_IMPORT_CLOSED: 'Image import service is closed.',
  IMAGE_IMPORT_INVALID: 'The image or import request is invalid.', IMAGE_IMPORT_READ: 'The selected file could not be read safely.',
  IMAGE_IMPORT_DECODE: 'The image is malformed, truncated, or unsupported.' });
function importError(code = 'IMAGE_IMPORT_INVALID') {
  if (!Object.hasOwn(ERROR_TEXT, code)) code = 'IMAGE_IMPORT_INVALID';
  const e = new Error(ERROR_TEXT[code]); e.code = code; if (code === 'IMAGE_IMPORT_CANCELLED') e.name = 'AbortError'; return e;
}
function ownRecord(value, keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw importError();
  const names = Reflect.ownKeys(value); if (names.length !== keys.length) throw importError();
  const out = Object.create(null);
  for (const key of names) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !d?.enumerable || !Object.hasOwn(d, 'value')) throw importError();
    out[key] = d.value;
  }
  return out;
}
function identifiers(value) {
  const r = ownRecord(value, ['requestId', 'sourceRevision']);
  for (const key of ['requestId', 'sourceRevision']) if (typeof r[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(r[key])) throw importError();
  return Object.freeze({ requestId: r.requestId, sourceRevision: r.sourceRevision });
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs; }
async function readChosenFile(filePath, current) {
  // This is intentionally private; no renderer path-reading entry point exists.
  let handle;
  try {
    current(); const before = await fs.promises.lstat(filePath, { bigint: true }); current();
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > BigInt(Guard.LIMITS.maxEncodedBytes)) throw importError('IMAGE_IMPORT_LIMIT');
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)); current();
    const opened = await handle.stat({ bigint: true }); current();
    if (!opened.isFile() || !sameFile(before, opened)) throw importError('IMAGE_IMPORT_READ');
    const size = Number(opened.size), bytes = new Uint8Array(size); let offset = 0;
    while (offset < size) {
      current(); const part = await handle.read(bytes, offset, Math.min(65536, size - offset), offset); current();
      if (part.bytesRead <= 0) throw importError('IMAGE_IMPORT_READ'); offset += part.bytesRead;
    }
    const extra = new Uint8Array(1), finalByte = await handle.read(extra, 0, 1, size); current();
    const after = await handle.stat({ bigint: true }); current();
    if (finalByte.bytesRead !== 0 || !sameFile(opened, after)) throw importError('IMAGE_IMPORT_READ');
    return bytes;
  } catch (error) { if (error?.code?.startsWith('IMAGE_IMPORT_')) throw error; throw importError('IMAGE_IMPORT_READ'); }
  finally { if (handle) await handle.close().catch(() => {}); }
}
function safeLabel(filePath) {
  return path.basename(filePath).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 120) || 'Image';
}
function validateWorkerResult(value, header) {
  const r = ownRecord(value, ['ok', 'width', 'height', 'data', 'details']), p = Guard.sizePlan(header.width, header.height);
  if (r.ok !== true || r.width !== p.width || r.height !== p.height) throw importError();
  const d = ownRecord(r.details, ['encodedWidth', 'encodedHeight', 'sourceWidth', 'sourceHeight', 'resized', 'orientationApplied', 'color', 'alpha', 'metadataPreserved']);
  if (d.encodedWidth !== header.encodedWidth || d.encodedHeight !== header.encodedHeight || d.sourceWidth !== header.width || d.sourceHeight !== header.height || d.resized !== p.resized ||
      d.orientationApplied !== (header.orientation !== 1) || d.color !== '8-bit sRGB' || d.alpha !== 'straight' || d.metadataPreserved !== false) throw importError();
  return { width: r.width, height: r.height, data: r.data, details: Object.freeze({ ...d }) };
}
function createImageImportService({ dialog, getWindow, codec, inspectImage,
  workerFactory = (file, options) => new Worker(file, options),
  workerPath = path.join(__dirname, 'image-import-worker.cjs'), timeoutMs = Guard.LIMITS.workerTimeoutMs } = {}) {
  if (!dialog || typeof dialog.showOpenDialog !== 'function' || typeof getWindow !== 'function' ||
      !codec || typeof codec.createAsset !== 'function' || typeof inspectImage !== 'function' || typeof workerFactory !== 'function' ||
      typeof workerPath !== 'string' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > Guard.LIMITS.workerTimeoutMs) throw importError();
  let active = null, disposed = false;
  function terminate(job) {
    if (!job?.worker || job.terminated) return;
    job.terminated = true;
    try { Promise.resolve(job.worker.terminate()).catch(() => {}); } catch (_) {}
  }
  function cancel(requestId) {
    if (!active || (requestId !== undefined && active.request.requestId !== requestId)) return false;
    const job = active; job.cancelled = true; active = null; const error = importError('IMAGE_IMPORT_CANCELLED'); terminate(job); job.finishWorker?.(error); job.rejectCancel(error); return true;
  }
  async function importImage(payload) {
    // Validate synchronously before superseding an authorized request.
    const request = identifiers(payload); if (disposed) throw importError('IMAGE_IMPORT_CLOSED'); cancel();
    const job = { request, cancelled: false, worker: null, terminated: false, rejectCancel: null };
    const cancellation = new Promise((_, reject) => { job.rejectCancel = reject; });
    // This catch also handles cancellation during the small gap between awaits.
    cancellation.catch(() => {}); active = job;
    const current = () => { if (disposed || job.cancelled || active !== job) throw importError('IMAGE_IMPORT_CANCELLED'); };
    const wait = promise => Promise.race([promise, cancellation]);
    try {
      const options = { title: 'Import image layer', buttonLabel: 'Import', properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'JPEG, PNG and WebP', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] };
      const window = getWindow();
      const selected = await wait(window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)); current();
      if (selected?.canceled) return null;
      if (!Array.isArray(selected?.filePaths) || selected.filePaths.length !== 1 || typeof selected.filePaths[0] !== 'string' || !path.isAbsolute(selected.filePaths[0])) throw importError();
      const filePath = selected.filePaths[0], label = safeLabel(filePath);
      const bytes = await wait(readChosenFile(filePath, current)); current();
      const header = Guard.inspectEncoded(bytes, inspectImage);
      const decoded = await wait(new Promise((resolve, reject) => {
        let timer, settled = false;
        const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); terminate(job); error ? reject(error) : resolve(result); }; job.finishWorker = finish;
        try {
          current(); job.worker = workerFactory(workerPath, { workerData: { bytes }, transferList: [bytes.buffer], resourceLimits: { maxOldGenerationSizeMb: 256 } });
          job.worker.once('error', () => finish(importError('IMAGE_IMPORT_DECODE')));
          job.worker.once('exit', () => { if (!settled) finish(importError(job.cancelled ? 'IMAGE_IMPORT_CANCELLED' : 'IMAGE_IMPORT_DECODE')); });
          job.worker.once('message', result => {
            try {
              current();
              const status = result && typeof result === 'object' && Object.getOwnPropertyDescriptor(result, 'ok');
              if (!status || !Object.hasOwn(status, 'value')) throw importError();
              if (status.value !== true) {
                const failure = ownRecord(result, ['ok', 'code']);
                if (failure.ok !== false || typeof failure.code !== 'string') throw importError();
                throw importError(failure.code);
              }
              finish(null, validateWorkerResult(result, header));
            } catch (error) { finish(error); }
          });
          timer = setTimeout(() => finish(importError('IMAGE_IMPORT_TIMEOUT')), timeoutMs); timer.unref?.();
        } catch (error) { finish(error); }
      })); current();
      // Main creates the identity from captured raw pixels. No renderer/worker ID is accepted.
      const asset = await wait(codec.createAsset({ width: decoded.width, height: decoded.height, data: decoded.data })); current();
      return Object.freeze({ ...request, asset, label, details: decoded.details });
    } catch (error) { throw importError(error?.code); }
    finally { terminate(job); if (active === job) active = null; }
  }
  return Object.freeze({ importImage, cancel, isBusy: () => active !== null,
    dispose() { disposed = true; cancel(); } });
}
module.exports = Object.freeze({ LIMITS: Guard.LIMITS, createImageImportService });
