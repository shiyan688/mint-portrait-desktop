'use strict';
// Privileged main-process module. Never pass renderer-owned configuration to this factory.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const WORKER = path.join(__dirname, 'backend', 'worker.py');
const ADAPTERS = new Set(['segface', 'birefnet', 'generative']);
const TASKS = new Set(['parse', 'retouch', 'matting', 'inpaint', 'restore']);
const HEADER_LIMIT = 65536;
const REFINEMENT_CORE=Object.freeze({kind:'classical-color-estimation',implementation:'pymatting',version:'1.1.16',method:'estimate_foreground_ml'});

class DesktopBackendError extends Error {
  constructor(code, message) { super(message); this.name = 'DesktopBackendError'; this.code = code; }
}
function error(code, message) { return new DesktopBackendError(code, message); }
function check(condition, code, message) { if (!condition) throw error(code, message); }
function integer(value, min, max, label) { check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', `Invalid ${label}.`); return value; }
function nonempty(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value; }
function sha(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function abortCheck(signal) { if (signal?.aborted) throw error('CANCELLED', 'Backend job was cancelled.'); }
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)); }
function frozenCopy(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozenCopy(child); Object.freeze(value); }
  return value;
}
function executionProfile(manifest) {
  const c=manifest.config, adapter=manifest.adapter;
  if(adapter==='birefnet'){
    const inputSize=c.inputSize??2048, precision=c.precision??'float32', threads=c.threads??4;
    check([512,1024,2048].includes(inputSize) && ['float32','float16','bfloat16'].includes(precision), 'INVALID_CONFIG', 'BiRefNet input size and precision must be explicit supported values.');
    integer(threads,1,8,'model threads');
    return {adapter,inputSize,precision:precision==='bfloat16'?'mixed-bfloat16':precision,threads,qualityProfile:inputSize===2048?'hr-2048':`diagnostic-${inputSize}`,
      ...(precision==='bfloat16'?{operatorPrecision:{deformConv2d:'float32',weights:'float32'}}:{})};
  }
  if(adapter==='segface'){
    const variant=c.variant??'mobilenet',threads=c.threads??2;
    check(['mobilenet','swin_base'].includes(variant),'INVALID_CONFIG','Unsupported parser variant.');integer(threads,1,8,'model threads');
    return {adapter,variant,inputSize:512,precision:'float32',threads,qualityProfile:'face-parsing-512'};
  }
  return {adapter};
}
function sameProfile(actual,expected){
  if(!expected || typeof expected!=='object')return actual===expected;
  return actual && typeof actual==='object' && !Array.isArray(actual) && Object.keys(actual).length===Object.keys(expected).length && Object.keys(expected).every(key=>sameProfile(actual[key],expected[key]));
}
function validRefinement(value){
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(REFINEMENT_CORE).every(key=>value[key]===REFINEMENT_CORE[key]) && Buffer.byteLength(JSON.stringify(value))<=4096;
}
function normalizeManifest(input, allowTestDoubles) {
  check(input && typeof input === 'object', 'INVALID_CONFIG', 'A model manifest is required.');
  const m = JSON.parse(JSON.stringify(input));
  check(nonempty(m.id) && nonempty(m.version) && ADAPTERS.has(m.adapter), 'INVALID_CONFIG', 'Model identity or adapter key is invalid.');
  check(m.kind === 'model' || (allowTestDoubles && m.kind === 'test-double'), 'INVALID_CONFIG', 'Only model manifests are enabled outside explicit tests.');
  check(Array.isArray(m.tasks) && m.tasks.length && m.tasks.every(t => TASKS.has(t)) && new Set(m.tasks).size === m.tasks.length,
    'INVALID_CONFIG', 'Manifest tasks must be explicit.');
  check(!m.tasks.includes('parse') || m.tasks.length === 1, 'INVALID_CONFIG', 'Parsing is a separate transport capability, never an image-edit task.');
  check(Array.isArray(m.devices) && m.devices.length && m.devices.every(d => ['cpu', 'cuda'].includes(d)) && new Set(m.devices).size === m.devices.length,
    'INVALID_CONFIG', 'Manifest devices must explicitly allow CPU and/or CUDA.');
  check(path.isAbsolute(m.modelRoot || '') && sha(m.weightsSha256), 'INVALID_CONFIG', 'A privileged absolute model root and weights SHA-256 are required.');
  check(typeof m.enabled === 'boolean' && m.config && typeof m.config === 'object' && !Array.isArray(m.config), 'INVALID_CONFIG', 'Explicit enabled flag and trusted config are required.');
  check(m.qualityStatus===undefined || ['not-evaluated','experimental','blocked'].includes(m.qualityStatus),'INVALID_CONFIG','Quality status must be explicit trusted review metadata.');
  check(m.disabledReason===undefined || (typeof m.disabledReason==='string' && m.disabledReason.trim()===m.disabledReason && m.disabledReason.length>0 && m.disabledReason.length<=512),'INVALID_CONFIG','Disabled reason must be bounded trusted display text.');
  check(m.config.foregroundRefinement===undefined || m.config.foregroundRefinement===false ||
    (m.config.foregroundRefinement==='pymatting-1.1.16' && m.adapter==='birefnet' && m.tasks.length===1 && m.tasks[0]==='matting'),
  'INVALID_CONFIG','Foreground color estimation is a separate explicitly opted-in BiRefNet matting capability.');
  check(m.license && nonempty(m.license.id) && ['approved', 'pending', 'blocked'].includes(m.license.status), 'INVALID_CONFIG', 'Explicit license review metadata is required.');
  let licenseUrl; try { licenseUrl = new URL(m.license.url); } catch { throw error('INVALID_CONFIG', 'License URL is invalid.'); }
  check(licenseUrl.protocol === 'https:' && !licenseUrl.username && !licenseUrl.password, 'INVALID_CONFIG', 'License URL must be HTTPS without credentials.');
  check(Array.isArray(m.assets) && m.assets.length > 0 && m.assets.length <= 512, 'INVALID_CONFIG', 'A bounded pinned asset list is required.');
  const names = new Set(), paths = new Set();
  for (const asset of m.assets) {
    check(nonempty(asset.name) && !names.has(asset.name) && typeof asset.relativePath === 'string' && asset.relativePath.length > 0 && asset.relativePath.length < 1024 &&
      !path.isAbsolute(asset.relativePath) && !asset.relativePath.includes('\\') && !asset.relativePath.includes('\0') && !asset.relativePath.split('/').some(p => !p || p === '.' || p === '..') &&
      !asset.relativePath.includes(':') && !paths.has(asset.relativePath) && sha(asset.sha256), 'INVALID_CONFIG', 'Asset names, safe relative paths and SHA-256 values must be unique and explicit.');
    names.add(asset.name); paths.add(asset.relativePath);
  }
  const weights = m.assets.find(a => a.name === m.weightsAsset);
  check(weights && weights.sha256 === m.weightsSha256, 'INVALID_CONFIG', 'weightsAsset must identify the exact weightsSha256 asset.');
  check(Array.isArray(m.requiredPackages) && m.requiredPackages.length <= 32 && m.requiredPackages.every(p => typeof p === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(p)),
    'INVALID_CONFIG', 'requiredPackages must be an explicit bounded list.');
  m.executionProfile=executionProfile(m);
  check(Buffer.byteLength(JSON.stringify(m)) < HEADER_LIMIT / 2, 'INVALID_CONFIG', 'Manifest exceeds header budget.');
  return frozenCopy(m);
}
async function verifyAssets(manifest, signal) {
  abortCheck(signal);
  let root;
  try { root = await fsp.realpath(manifest.modelRoot); }
  catch { throw error('ASSET_MISSING', 'Configured model asset directory is missing. Install the approved pinned assets first.'); }
  const approvedPaths = new Set();
  for (const asset of manifest.assets) {
    abortCheck(signal);
    const candidate = path.resolve(root, asset.relativePath);
    let actual, stat;
    try { actual = await fsp.realpath(candidate); stat = await fsp.stat(actual); }
    catch { throw error('ASSET_MISSING', `Missing required model asset: ${asset.name}.`); }
    check(inside(root, actual) && stat.isFile(), 'ASSET_PATH_INVALID', `Model asset leaves its configured root or is not a file: ${asset.name}.`);
    const hash = crypto.createHash('sha256');
    try { for await (const chunk of fs.createReadStream(actual, { signal })) hash.update(chunk); }
    catch (failure) { abortCheck(signal); throw error('ASSET_READ_FAILED', `Cannot read model asset: ${asset.name}.`); }
    check(hash.digest('hex') === asset.sha256, 'ASSET_HASH_MISMATCH', `SHA-256 mismatch for model asset: ${asset.name}. No inference was started.`);
    approvedPaths.add(actual);
  }
  if (manifest.config.sourceDir !== undefined) {
    check(typeof manifest.config.sourceDir === 'string' && path.isAbsolute(manifest.config.sourceDir), 'ASSET_PATH_INVALID', 'sourceDir must be a privileged absolute path.');
    let source; try { source = await fsp.realpath(manifest.config.sourceDir); } catch { throw error('ASSET_MISSING', 'Pinned source directory is missing.'); }
    check(inside(root, source), 'ASSET_PATH_INVALID', 'Source directory must be inside the approved model root.');
    async function walk(directory) {
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        check(!entry.isSymbolicLink(), 'ASSET_PATH_INVALID', 'Pinned source directories cannot contain symlinks.');
        if (entry.isDirectory()) { check(entry.name !== '__pycache__', 'ASSET_UNPINNED_CODE', 'Vendor source caches must be removed from the approved source tree.'); await walk(target); }
        else if (/\.(py|pyc|pyd|so|dll)$/i.test(entry.name)) check(approvedPaths.has(target), 'ASSET_UNPINNED_CODE', 'Every executable source file must be present in the pinned asset manifest.');
      }
    }
    await walk(source);
  }
  return { status: 'verified', count: manifest.assets.length };
}
function encodeFrame(header, payload, maxPayloadBytes) {
  check(payload.length <= maxPayloadBytes, 'PAYLOAD_TOO_LARGE', 'Backend payload exceeds the configured byte budget.');
  const json = Buffer.from(JSON.stringify({ ...header, payloadBytes: payload.length }), 'utf8');
  check(json.length <= HEADER_LIMIT, 'PAYLOAD_TOO_LARGE', 'Backend header exceeds its byte budget.');
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(json.length);
  return Buffer.concat([prefix, json, payload]);
}
function decodeFrame(bytes, maxPayloadBytes) {
  check(bytes.length >= 4, 'PROTOCOL_ERROR', 'Worker returned an incomplete frame.');
  const length = bytes.readUInt32BE(0);
  check(length > 0 && length <= HEADER_LIMIT && bytes.length >= 4 + length, 'PROTOCOL_ERROR', 'Worker header is invalid or incomplete.');
  let header; try { header = JSON.parse(bytes.subarray(4, 4 + length).toString('utf8')); } catch { throw error('PROTOCOL_ERROR', 'Worker header is not valid JSON.'); }
  check(header && Number.isSafeInteger(header.payloadBytes) && header.payloadBytes >= 0 && header.payloadBytes <= maxPayloadBytes && bytes.length === 4 + length + header.payloadBytes,
    'PROTOCOL_ERROR', 'Worker payload length is invalid; trailing or missing bytes are forbidden.');
  if (header.ok !== true) throw error(typeof header.error?.code === 'string' ? header.error.code : 'WORKER_FAILED', String(header.error?.message || 'Worker failed without a result.').slice(0, 1024));
  return { header, payload: bytes.subarray(4 + length) };
}
function contextSnapshot(context, maxPixels, maxPayloadBytes, parsing, rawMatting = false) {
  check(context && nonempty(context.jobId), 'INVALID_INPUT', 'An explicit job ID is required.');
  check(context.signal === undefined || context.signal instanceof AbortSignal, 'INVALID_INPUT', 'signal must be an AbortSignal.');
  abortCheck(context.signal);
  const size = context.originalSize, roi = context.roi, source = context.source;
  check(size && roi && source, 'INVALID_INPUT', 'Original size, ROI and source are required.');
  integer(size.width, 1, maxPixels, 'original width'); integer(size.height, 1, maxPixels, 'original height');
  check(size.width * size.height <= maxPixels, 'INVALID_INPUT', 'Original exceeds the configured pixel budget.');
  for (const key of ['x', 'y']) integer(roi[key], 0, maxPixels, `ROI ${key}`);
  integer(roi.width, 1, size.width, 'ROI width'); integer(roi.height, 1, size.height, 'ROI height');
  check(roi.x <= size.width - roi.width && roi.y <= size.height - roi.height && source.width === roi.width && source.height === roi.height,
    'INVALID_INPUT', 'ROI must be in bounds at original dimensions.');
  const pixels = roi.width * roi.height;
  check(source.format === 'rgba8' && source.alphaMode === 'straight' && source.colorSpace === 'srgb' &&
    (source.data instanceof Uint8Array || source.data instanceof Uint8ClampedArray) && source.data.buffer instanceof ArrayBuffer && source.data.length === pixels * 4,
    'INVALID_INPUT', 'Source must be exact, unshared, original-ROI straight-alpha sRGB RGBA8.');
  check(pixels * (parsing ? 4 : 8) <= maxPayloadBytes, 'PAYLOAD_TOO_LARGE', 'Input pixels exceed transport capacity.');
  let maskBytes = Buffer.alloc(0);
  let selection;
  if (parsing) {
    check(context.selection && ['detected-face', 'user-face-roi'].includes(context.selection.kind) &&
      ['faceId', 'revision'].every(key => nonempty(context.selection[key]) && context.selection[key].length <= 128),
    'INVALID_INPUT', 'Parsing requires an explicit bounded face-selection identity and revision.');
    selection = { kind: context.selection.kind, faceId: context.selection.faceId, revision: context.selection.revision };
  }
  if (!parsing) {
    maskBytes = Buffer.alloc(pixels * 4);
    if (rawMatting) {
      // An inference coverage mask, not edit strength or permission to modify source RGB/alpha.
      for (let p = 0; p < pixels; p++) maskBytes.writeFloatLE(1, p * 4);
    } else {
      const mask = context.mask;
      check(mask && mask.width === roi.width && mask.height === roi.height && mask.space === 'roi-original-pixels' && mask.encoding === 'unit-float32' &&
        mask.data instanceof Float32Array && mask.data.buffer instanceof ArrayBuffer && mask.data.length === pixels, 'INVALID_INPUT', 'Explicit original-ROI Float32 edit mask is required.');
      for (let p = 0; p < pixels; p++) { const value = mask.data[p]; check(Number.isFinite(value) && value >= 0 && value <= 1, 'INVALID_INPUT', 'Mask values must be finite in [0,1].'); maskBytes.writeFloatLE(value, p * 4); }
    }
  }
  return { jobId: context.jobId, task: parsing ? 'parse' : context.task,
    originalSize: { width: size.width, height: size.height }, roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height },
    source: Buffer.from(source.data), mask: maskBytes, selection, signal: context.signal };
}

function createDesktopBackend(configuration) {
  check(configuration && typeof configuration === 'object', 'INVALID_CONFIG', 'Privileged backend configuration is required.');
  const pythonPath = configuration.pythonPath;
  check(typeof pythonPath === 'string' && path.isAbsolute(pythonPath) && !pythonPath.includes('\0'), 'INVALID_CONFIG', 'Python executable must be an absolute privileged app-configured path.');
  const backendRoot = configuration.backendRoot ?? path.dirname(WORKER);
  check(typeof backendRoot === 'string' && path.isAbsolute(backendRoot) && !backendRoot.includes('\0'), 'INVALID_CONFIG', 'Backend root must be an absolute privileged app-configured directory.');
  const workerPath = path.join(backendRoot, 'worker.py');
  const maxConcurrent = integer(configuration.maxConcurrent ?? 1, 1, 2, 'maxConcurrent');
  const maxQueued = integer(configuration.maxQueued ?? 2, 0, 16, 'maxQueued');
  const timeoutMs = integer(configuration.timeoutMs ?? 120000, 50, 3600000, 'timeoutMs');
  const killGraceMs = integer(configuration.killGraceMs ?? 250, 10, 5000, 'killGraceMs');
  const maxPayloadBytes = integer(configuration.maxPayloadBytes ?? 134217728, 1024, 536870912, 'maxPayloadBytes');
  const maxPixels = integer(configuration.maxPixels ?? 16777216, 1, 67108864, 'maxPixels');
  const manifests = (configuration.manifests || []).map(m => normalizeManifest(m, configuration.allowTestDoubles === true));
  const registry = new Map();
  for (const m of manifests) { const key = JSON.stringify([m.id, m.version]); check(!registry.has(key), 'INVALID_CONFIG', 'Duplicate manifest ID/version. Devices belong in one manifest.'); registry.set(key, m); }
  let disposed = false;
  const active = new Set(), queue = [];
  const operations = new Set();
  const environment = {};
  for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'LD_LIBRARY_PATH']) if (process.env[key]) environment[key] = process.env[key];
  Object.assign(environment, { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' });

  async function operation(signal, run) {
    check(!disposed, 'BACKEND_CLOSED', 'Backend has been disposed.');
    abortCheck(signal);
    check(operations.size < maxConcurrent + maxQueued, 'QUEUE_FULL', 'Local inference operation limit is full, including asset verification. Wait or cancel an existing request.');
    const controller = new AbortController(), onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    operations.add(controller);
    try { return await run(controller.signal); }
    finally { operations.delete(controller); if (signal) signal.removeEventListener('abort', onAbort); }
  }

  function pump() {
    while (!disposed && active.size < maxConcurrent && queue.length) launch(queue.shift());
  }
  function schedule(header, payload, signal) {
    if (disposed) return Promise.reject(error('BACKEND_CLOSED', 'Backend has been disposed.'));
    try { abortCheck(signal); } catch (failure) { return Promise.reject(failure); }
    if (active.size >= maxConcurrent && queue.length >= maxQueued) return Promise.reject(error('QUEUE_FULL', 'Local inference queue is full. Wait for an active job or cancel it.'));
    const frame = encodeFrame(header, payload, maxPayloadBytes);
    return new Promise((resolve, reject) => {
      const item = { frame, signal, resolve, reject, done: false, child: null, onAbort: null, timer: null, killTimer: null };
      item.finish = (failure, value) => {
        if (item.done) return;
        item.done = true;
        if (signal && item.onAbort) signal.removeEventListener('abort', item.onAbort);
        if (failure) reject(failure); else resolve(value);
      };
      item.stop = failure => {
        item.finish(failure);
        const queued = queue.indexOf(item); if (queued !== -1) queue.splice(queued, 1);
        if (item.child && !item.killTimer) {
          item.child.kill('SIGTERM');
          item.killTimer = setTimeout(() => { if (active.has(item)) item.child.kill('SIGKILL'); }, killGraceMs);
          item.killTimer.unref?.();
        }
      };
      if (signal) { item.onAbort = () => item.stop(error('CANCELLED', 'Local worker cancelled.')); signal.addEventListener('abort', item.onAbort, { once: true }); }
      queue.push(item); pump();
    });
  }
  function launch(item) {
    if (item.done) return;
    active.add(item);
    let bytes = 0, stderrBytes = 0, streamFailure = null;
    const chunks = [];
    try {
      item.child = childProcess.spawn(pythonPath, ['-I', '-u', workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, cwd: backendRoot, env: { ...environment } });
    } catch { active.delete(item); item.finish(error('RUNTIME_UNAVAILABLE', 'Configured Python runtime could not be started. Install the approved local runtime.')); pump(); return; }
    const child = item.child;
    item.timer = setTimeout(() => item.stop(error('TIMEOUT', 'Local worker exceeded its configured deadline and was terminated.')), timeoutMs);
    child.on('error', () => { streamFailure = error('RUNTIME_UNAVAILABLE', 'Configured Python runtime is missing or could not start.'); item.finish(streamFailure); });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxPayloadBytes + HEADER_LIMIT + 4) { streamFailure = error('PAYLOAD_TOO_LARGE', 'Worker output exceeded the bounded protocol size.'); item.stop(streamFailure); }
      else if (!item.done) chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) { streamFailure = error('WORKER_LOG_LIMIT', 'Worker exceeded its bounded diagnostic output.'); item.stop(streamFailure); }
      // Do not retain raw third-party logs or image-derived content.
    });
    child.stdin.on('error', () => { if (!item.done) streamFailure = error('PROTOCOL_ERROR', 'Worker input stream closed before the request completed.'); });
    child.on('close', code => {
      clearTimeout(item.timer); clearTimeout(item.killTimer); active.delete(item);
      if (!item.done) {
        try {
          if (streamFailure) throw streamFailure;
          check(code === 0, 'WORKER_EXIT', `Local worker exited without a valid result (exit ${code}).`);
          item.finish(null, decodeFrame(Buffer.concat(chunks), maxPayloadBytes));
        } catch (failure) { item.finish(failure); }
      }
      pump(); // A slot remains occupied until the old process actually closes.
    });
    child.stdin.end(item.frame); item.frame = null;
  }
  function findManifest(id, version, device) {
    check(!disposed, 'BACKEND_CLOSED', 'Backend has been disposed.');
    check(['cpu', 'cuda'].includes(device), 'DEVICE_UNAVAILABLE', 'Select CPU or CUDA explicitly; automatic fallback is forbidden.');
    const manifest = registry.get(JSON.stringify([id, version]));
    check(manifest, 'MODEL_MISSING', 'Requested model ID/version is not configured.');
    check(manifest.devices.includes(device), 'DEVICE_UNAVAILABLE', 'Requested device is not allowed by this model manifest.');
    return manifest;
  }
  async function probeInternal(signal) {
    abortCheck(signal);
    let runtimeProbe;
    try {
      const result = await schedule({ protocol: 1, op: 'probe', requiredPackages: [...new Set(manifests.flatMap(m => m.requiredPackages))] }, Buffer.alloc(0), signal);
      check(result.payload.length === 0 && result.header.probe && typeof result.header.probe === 'object', 'PROTOCOL_ERROR', 'Invalid runtime probe response.');
      runtimeProbe = result.header.probe;
    } catch (failure) {
      if (['CANCELLED', 'QUEUE_FULL', 'BACKEND_CLOSED'].includes(failure.code)) throw failure;
      runtimeProbe = { runtime: { available: false, reason: failure.message }, devices: [{ kind: 'cpu', name: 'CPU', available: false, reason: 'Runtime unavailable.' }, { kind: 'cuda', name: 'CUDA', available: false, reason: 'Runtime unavailable.' }], packages: {}, adapters: {} };
    }
    check(Array.isArray(runtimeProbe.devices) && runtimeProbe.runtime && runtimeProbe.packages && runtimeProbe.adapters, 'PROTOCOL_ERROR', 'Runtime probe fields are missing.');
    const models = [];
    for (const manifest of manifests) {
      let assets;
      try { assets = await verifyAssets(manifest, signal); }
      catch (failure) { if (failure.code === 'CANCELLED') throw failure; assets = { status: 'unavailable', code: failure.code, reason: failure.message }; }
      const missing = manifest.requiredPackages.filter(p => !runtimeProbe.packages[p]);
      let status = 'ready', reason = 'Pinned assets, runtime, package metadata and execution configuration are ready; inference quality is not certified.';
      if (!runtimeProbe.runtime.available) { status = 'missing'; reason = runtimeProbe.runtime.reason || 'Approved Python runtime is unavailable.'; }
      else if (!runtimeProbe.adapters[manifest.adapter]) { status = 'missing'; reason = 'The allowlisted local adapter is not installed.'; }
      else if (assets.status !== 'verified') { status = 'missing'; reason = assets.reason; }
      else if (missing.length) { status = 'missing'; reason = `Missing approved runtime packages: ${missing.join(', ')}.`; }
      else if (manifest.license.status !== 'approved') { status = 'disabled'; reason = 'Model/code license review is not approved in trusted application configuration.'; }
      else if (manifest.qualityStatus==='blocked') { status = 'disabled'; reason = manifest.disabledReason || 'Model quality review is blocked in trusted application configuration.'; }
      else if (!manifest.enabled || manifest.config.executionApproved !== true) { status = 'disabled'; reason = manifest.disabledReason || 'Model execution is not enabled in trusted application configuration.'; }
      const devices = manifest.devices.map(kind => runtimeProbe.devices.find(d => d.kind === kind) || { kind, name: kind, available: false, reason: 'Device was not verified.' });
      models.push({ id: manifest.id, version: manifest.version, kind: manifest.kind, adapter: manifest.adapter, tasks: [...manifest.tasks],
        weightsSha256: manifest.weightsSha256, executionProfile:{...manifest.executionProfile}, license: { ...manifest.license }, qualityStatus:manifest.qualityStatus || 'not-evaluated',
        ...(manifest.disabledReason?{disabledReason:manifest.disabledReason}:{}), status, reason, assets, devices });
    }
    return { runtime: runtimeProbe.runtime, devices: runtimeProbe.devices, models };
  }
  function descriptor(manifest, model, deviceKind) {
    const device = model.devices.find(d => d.kind === deviceKind);
    return { id: manifest.id, version: manifest.version, weightsSha256: manifest.weightsSha256, kind: manifest.kind,
      tasks: [...manifest.tasks], device: { kind: deviceKind, name: device?.name || deviceKind }, license: { ...manifest.license },
      status: device?.available ? model.status : 'incompatible' };
  }
  async function execute(manifest, deviceKind, input) {
    abortCheck(input.signal);
    const report = await probeInternal(input.signal), model = report.models.find(m => m.id === manifest.id && m.version === manifest.version);
    check(model.status === 'ready', 'MODEL_UNAVAILABLE', model.reason);
    const selected = descriptor(manifest, model, deviceKind);
    check(selected.status === 'ready', 'DEVICE_UNAVAILABLE', model.devices.find(d => d.kind === deviceKind)?.reason || 'Selected device is unavailable; no CPU fallback was used.');
    const result = await schedule({ protocol: 1, op: 'infer', maxPixels, maxPayloadBytes, manifest,
      request: { jobId: input.jobId, task: input.task, model: selected, originalSize: input.originalSize, roi: input.roi, selection: input.selection, sourceBytes: input.source.length, maskBytes: input.mask.length } },
    Buffer.concat([input.source, input.mask]), input.signal);
    abortCheck(input.signal);
    const h = result.header, p = h.provenance, roi = input.roi;
    check(p && p.jobId === input.jobId && p.task === input.task && p.modelId === manifest.id && p.modelVersion === manifest.version &&
      p.weightsSha256 === manifest.weightsSha256 && p.kind === manifest.kind && p.device?.kind === selected.device.kind && p.device?.name === selected.device.name,
    'INVALID_PROVENANCE', 'Worker result does not match the requested job/model/weights/device.');
    check(sameProfile(p.executionProfile,manifest.executionProfile),'INVALID_PROVENANCE','Worker result does not match the configured model resolution/precision/variant/thread profile.');
    check(h.width === roi.width && h.height === roi.height, 'INVALID_OUTPUT', 'Worker output must match original ROI dimensions.');
    const pixels = roi.width * roi.height;
    if (input.task === 'parse') {
      check(h.foreground===undefined && p.foregroundRefinement===undefined,'INVALID_OUTPUT','Parsing cannot return a foreground-color plane.');
      check(p.selection && p.selection.kind === input.selection.kind && p.selection.faceId === input.selection.faceId && p.selection.revision === input.selection.revision,
        'INVALID_PROVENANCE', 'Parsing result belongs to a different face selection/revision.');
      check(h.kind === 'parsing' && Array.isArray(h.classes) && h.classes.length > 0 && h.classes.length <= 64 &&
        h.classes.every(nonempty) && new Set(h.classes).size === h.classes.length && result.payload.length === pixels * h.classes.length * 4,
      'INVALID_OUTPUT', 'Parsing requires explicit unique classes and original-ROI planar float32 probabilities.');
      const data = decodeProbabilities(result.payload);
      return { kind: 'parsing', width: roi.width, height: roi.height, classes: [...h.classes], layout: 'planar', encoding: 'unit-float32', space: 'roi-original-pixels', roi: { ...roi }, data, provenance: p };
    }
    if (input.task === 'matting') {
      const refine=manifest.config.foregroundRefinement==='pymatting-1.1.16', matteBytes=pixels*4;
      check(h.kind==='matte' && result.payload.length===matteBytes*(refine?2:1),'INVALID_OUTPUT','Matting must return an exact original-ROI matte and only its explicitly opted-in foreground plane.');
      const matteData=decodeProbabilities(result.payload.subarray(0,matteBytes));let foreground;
      if(refine){
        const f=h.foreground;
        check(f && h.matteBytes===matteBytes && f.payloadBytes===matteBytes && f.width===roi.width && f.height===roi.height && f.format==='rgba8' && f.alphaMode==='straight' && f.colorSpace==='srgb' && validRefinement(p.foregroundRefinement),
          'INVALID_OUTPUT','Foreground plane/refinement declaration does not match the approved original-ROI straight-sRGB contract.');
        const bytes=result.payload.subarray(matteBytes);
        check(p.foregroundRefinement.alphaDigest===crypto.createHash('sha256').update(result.payload.subarray(0,matteBytes)).digest('hex'),'INVALID_OUTPUT','Foreground refinement belongs to a different alpha plane.');
        check(p.foregroundRefinement.sourceDigest===crypto.createHash('sha256').update(input.source).digest('hex'),'INVALID_OUTPUT','Foreground refinement belongs to a different source image.');
        for(let i=0;i<pixels;i++){
          const offset=i*4;check(bytes[offset+3]===input.source[offset+3],'INVALID_OUTPUT','Foreground color estimation changed original alpha.');
          if(input.source[offset+3]<255 || matteData[i]===1)for(let c=0;c<3;c++)check(bytes[offset+c]===input.source[offset+c],'INVALID_OUTPUT','Foreground color estimation changed protected original RGB.');
        }
        foreground={width:roi.width,height:roi.height,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:new Uint8ClampedArray(bytes)};
      }else check(h.foreground===undefined && p.foregroundRefinement===undefined,'INVALID_OUTPUT','Unrequested foreground color estimation is forbidden.');
      return { matte: { width: roi.width, height: roi.height, space: 'roi-original-pixels', encoding: 'unit-float32', data: matteData }, ...(foreground?{foreground}:{}), provenance: p };
    }
    check(h.foreground===undefined && p.foregroundRefinement===undefined,'INVALID_OUTPUT','Color-edit tasks cannot disguise foreground color estimation.');
    check(h.kind === 'image' && result.payload.length === pixels * 4, 'INVALID_OUTPUT', 'Color model output must be original-ROI RGBA8.');
    for (let i = 3; i < result.payload.length; i += 4) check(result.payload[i] === input.source[i], 'INVALID_OUTPUT', 'Color model output changed original alpha.');
    return { image: { width: roi.width, height: roi.height, format: 'rgba8', alphaMode: 'straight', colorSpace: 'srgb', data: new Uint8ClampedArray(result.payload) }, provenance: p };
  }
  function decodeProbabilities(payload) {
    const data = new Float32Array(payload.length / 4);
    for (let i = 0; i < data.length; i++) { const value = payload.readFloatLE(i * 4); check(Number.isFinite(value) && value >= 0 && value <= 1, 'INVALID_OUTPUT', 'Model probabilities must be finite in [0,1].'); data[i] = value; }
    return data;
  }
  return Object.freeze({
    probe(signal) { return operation(signal, probeInternal); },
    async createAdapter(id, version, deviceKind) {
      const manifest = findManifest(id, version, deviceKind);
      check(!manifest.tasks.includes('parse'), 'INCOMPATIBLE_TASK', 'Parsing uses runParsing(), not an image-edit adapter.');
      const report = await operation(undefined, probeInternal), model = report.models.find(m => m.id === id && m.version === version);
      return { descriptor: descriptor(manifest, model, deviceKind), run(context) {
        check(manifest.tasks.includes(context.task), 'INCOMPATIBLE_TASK', 'Selected model cannot perform that task.');
        const input = contextSnapshot(context, maxPixels, maxPayloadBytes, false);
        return operation(context.signal, signal => execute(manifest, deviceKind, { ...input, signal }));
      } };
    },
    async runParsing(context) {
      const manifest = findManifest(context?.modelId, context?.modelVersion, context?.device);
      check(manifest.tasks.length === 1 && manifest.tasks[0] === 'parse', 'INCOMPATIBLE_TASK', 'Selected model is not a parser.');
      const input = contextSnapshot(context, maxPixels, maxPayloadBytes, true);
      return operation(context.signal, signal => execute(manifest, context.device, { ...input, signal }));
    },
    /** @returns {Promise<{matte: {width:number,height:number,roi:object,space:string,encoding:string,data:Float32Array},provenance:object}>} */
    async runMatting(context) {
      const manifest = findManifest(context?.modelId, context?.modelVersion, context?.device);
      check(manifest.tasks.includes('matting'), 'INCOMPATIBLE_TASK', 'Selected model is not a matting model.');
      const input = contextSnapshot({ ...context, task: 'matting' }, maxPixels, maxPayloadBytes, false, true);
      return operation(context.signal, async signal => {
        const result = await execute(manifest, context.device, { ...input, signal });
        return { matte: { ...result.matte, roi: { ...input.roi } }, ...(result.foreground?{foreground:result.foreground}:{}), provenance: result.provenance };
      });
    },
    cancelAll() { for (const controller of operations) controller.abort(); for (const item of [...queue, ...active]) item.stop(error('CANCELLED', 'Local backend work was cancelled.')); },
    dispose() { if (disposed) return; disposed = true; for (const controller of operations) controller.abort(); for (const item of [...queue, ...active]) item.stop(error('CANCELLED', 'Local backend was disposed.')); },
    diagnostics() { return { active: active.size, queued: queue.length, disposed }; }
  });
}
module.exports = { createDesktopBackend, DesktopBackendError };
