'use strict';
// Privileged, opt-in recovery. Every path is host-owned; renderer requests contain data only.
const fsDefault = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const { types } = require('node:util');
const { readBounded } = require('./project-store.cjs');
const Project = require('./src/project-document.cjs');
const MiB = 1024 * 1024;
const MAX_BYTES = 512 * MiB;
const BUDGETS_MIB = Object.freeze([64, 128, 256, 512]);
const DEFAULT_BUDGET_MIB = 128;
const FILES = Object.freeze({ latest: 'recovery-latest.mintproj', previous: 'recovery-previous.mintproj', preferences: 'preferences.json' });
const DEFAULTS = Object.freeze({ version: 1, enabled: false, budgetMiB: DEFAULT_BUDGET_MIB });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':');
const fail = (message, code = 'RECOVERY_UNSAFE') => { throw Object.assign(new Error(message), { code }); };
const abort = signal => { if (signal?.aborted) fail('本地恢复草稿保存已取消。', 'ABORT_ERR'); };
function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('无效的恢复请求。', 'RECOVERY_REQUEST');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) fail('恢复请求不接受路径、访问器或额外字段。', 'RECOVERY_REQUEST');
  }
  for (const key of required) if (!Object.hasOwn(descriptors, key)) fail('恢复请求缺少必要字段。', 'RECOVERY_REQUEST');
  return value;
}
function snapshotBytes(payload) {
  record(payload, ['bytes']);
  const value = payload.bytes;
  if (!value || types.isProxy(value) || !(value instanceof Uint8Array) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(value))) fail('恢复草稿需要普通二进制工程数据。', 'RECOVERY_REQUEST');
  for (const key of ['buffer', 'byteOffset', 'byteLength', 'length', Symbol.iterator]) if (Object.hasOwn(value, key)) fail('恢复数据不接受自定义二进制访问器。', 'RECOVERY_REQUEST');
  if (!(value.buffer instanceof ArrayBuffer) || types.isSharedArrayBuffer(value.buffer) || types.isProxy(value.buffer) || Object.getPrototypeOf(value.buffer) !== ArrayBuffer.prototype || value.byteLength < 64 || value.byteLength > MAX_BYTES) fail('恢复工程无效或超过 512 MiB 上限。', 'RECOVERY_SIZE');
  // Do not use the caller's iterator, slice, subarray, or asynchronous view.
  return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
}
function settings(payload, persisted = false) {
  record(payload, persisted ? ['version', 'enabled', 'budgetMiB'] : ['enabled', 'budgetMiB']);
  if ((persisted && payload.version !== 1) || typeof payload.enabled !== 'boolean' || !BUDGETS_MIB.includes(payload.budgetMiB)) fail('无效的恢复设置。', 'RECOVERY_SETTINGS');
  return { version: 1, enabled: payload.enabled, budgetMiB: payload.budgetMiB };
}
function regular(stat, min, max, ownedPair = false) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 && !(ownedPair && stat.nlink === 2)) fail('恢复文件必须是单链接普通文件，不能是目录、符号链接或硬链接。');
  if (!Number.isSafeInteger(stat.size) || stat.size < min || stat.size > max) fail('恢复文件大小无效或超过读取上限；未读取内容。', 'RECOVERY_SIZE');
}
function createRecoveryStore({ root, decode = Project.decode, inspectHeader = Project.inspectHeader, fs = fsDefault, platform = process.platform } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root !== path.resolve(root) || root === path.parse(root).root || /\0/.test(root) || /^(?:\\\\|\/\/)/.test(root) || typeof decode !== 'function' || typeof inspectHeader !== 'function') throw new TypeError('Recovery store requires a fixed, absolute, local, host-owned root and trusted validators.');
  const paths = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, path.join(root, name)]));
  let rootIdentity = null, busy = null, configuring = false;
  const validation = new Map();
  async function rootInfo(create = false) {
    let stat;
    try { stat = await fs.lstat(root); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (rootIdentity !== null) fail('恢复目录已丢失；未创建替代目录或改写草稿。', 'RECOVERY_LOST');
      if (!create) return null;
      // No recursive mkdir: the host must already own and create the parent directory.
      const parent = await fs.realpath(path.dirname(root));
      if (parent !== path.dirname(root)) fail('恢复目录的父路径包含链接；未写入。');
      try { await fs.mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = await fs.lstat(root);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('恢复位置不是安全的本地目录。');
    const real = await fs.realpath(root);
    if (real !== root) fail('恢复路径包含链接或已移出指定位置。');
    const key = `${stat.dev}:${stat.ino}`;
    if (rootIdentity !== null && rootIdentity !== key) fail('恢复目录已被替换；请重新启动并检查本地位置。');
    rootIdentity = key;
    return { real, identity: key };
  }
  async function readable(file, stat, min, max) {
    if (stat.nlink !== 2) { regular(stat, min, max); return; }
    // A failed no-replace cleanup can leave the target plus its *own* UUID temp.
    // Permit only that provably local pair, including after restart; never arbitrary
    // hardlinks, links to originals, or nlink > 2. No links are deleted by a read.
    regular(stat, min, max, true);
    if (!Object.values(paths).includes(file)) fail('恢复临时文件存在意外硬链接。');
    await rootInfo();
    const prefix = `.${path.basename(file)}.`;
    let directory, matches = 0, count = 0, complete = true;
    try {
      directory = await fs.opendir(root);
      for await (const entry of directory) {
        if (++count > 256) { complete = false; break; }
        if (!entry.name.startsWith(prefix)) continue;
        const suffix = entry.name.slice(prefix.length);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(suffix)) continue;
        const alias = await fs.lstat(path.join(root, entry.name));
        if (alias.isFile() && !alias.isSymbolicLink() && alias.nlink === 2 && identity(alias) === identity(stat)) matches++;
      }
    } finally { if (directory) await directory.close().catch(() => {}); }
    if (!complete || matches !== 1 || identity(await fs.lstat(file)) !== identity(stat)) fail('恢复文件包含未验证的硬链接；未读取或改写。');
    await rootInfo();
  }
  async function statFile(file, min = 64, max = MAX_BYTES) {
    try { const stat = await fs.lstat(file); await readable(file, stat, min, max); return stat; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function openRead(file, stat) {
    await rootInfo();
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      await rootInfo();
      const opened = await handle.stat(), named = await fs.lstat(file);
      if (identity(opened) !== identity(stat) || identity(named) !== identity(stat)) fail('恢复文件在打开期间发生变化。', 'RECOVERY_CHANGED');
      await readable(file, opened, 0, MAX_BYTES);
      await rootInfo();
    } catch (error) { await handle.close(); throw error; }
    return handle;
  }
  async function fingerprint(file, { min = 64, max = MAX_BYTES, signal, collect = false } = {}) {
    abort(signal); const stat = await statFile(file, min, max); if (!stat) return null;
    const handle = await openRead(file, stat), hash = crypto.createHash('sha256');
    try {
      const bytes = collect ? Buffer.alloc(stat.size) : Buffer.alloc(Math.min(MiB, stat.size));
      let position = 0;
      while (position < stat.size) {
        abort(signal); const offset = collect ? position : 0;
        const { bytesRead } = await handle.read(bytes, offset, Math.min(MiB, stat.size - position), position);
        if (!bytesRead) fail('恢复文件不完整。', 'RECOVERY_CHANGED');
        hash.update(bytes.subarray(offset, offset + bytesRead)); position += bytesRead;
      }
      const extra = Buffer.alloc(1);
      if ((await handle.read(extra, 0, 1, position)).bytesRead || identity(await handle.stat()) !== identity(stat)) fail('恢复文件在读取期间发生变化。', 'RECOVERY_CHANGED');
      abort(signal); await rootInfo(); abort(signal);
      return { identity: identity(stat), fileKey: `${stat.dev}:${stat.ino}`, sha256: hash.digest('hex'), sizeBytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString(), ...(collect ? { bytes } : {}) };
    } finally { await handle.close(); }
  }
  async function prefs(create = false) {
    const location = await rootInfo(create);
    if (!location) return { value: { ...DEFAULTS }, expected: null };
    const current = await fingerprint(paths.preferences, { min: 2, max: 4096, collect: true });
    if (!current) return { value: { ...DEFAULTS }, expected: null };
    let value;
    try { value = settings(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(current.bytes)), true); }
    catch { fail('恢复设置文件无效；本地自动恢复保持关闭，未改写现有草稿。', 'RECOVERY_SETTINGS'); }
    return { value, expected: current };
  }
  // Reuse the project store's exact-size bounded read and SHA-256 snapshot; add recovery's
  // stricter single-link and no-follow checks around its descriptor identity checks.
  const safeReadFs = { ...fs,
    lstat: async file => { const stat = await fs.lstat(file); await readable(file, stat, 64, MAX_BYTES); return stat; },
    open: async (file, mode) => { if (mode !== 'r') fail('Unexpected recovery read mode.'); const stat = await fs.lstat(file); await readable(file, stat, 64, MAX_BYTES); return openRead(file, stat); }
  };
  async function verified(slot, signal) {
    await rootInfo(); abort(signal);
    let result;
    try { result = await readBounded(paths[slot], { fs: safeReadFs, maxBytes: MAX_BYTES, inspectHeader, signal }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try { await decode(result.bytes); }
    catch (error) { validation.set(slot, { identity: result.identity, state: 'invalid' }); fail(`恢复${slot === 'latest' ? '最新' : '上一代'}草稿未通过完整校验；原有文件保持不变。`, 'RECOVERY_INVALID'); }
    abort(signal); await rootInfo();
    const now = await statFile(paths[slot]);
    if (!now || identity(now) !== result.identity) fail('恢复草稿在校验期间发生变化。', 'RECOVERY_CHANGED');
    validation.set(slot, { identity: result.identity, state: 'verified' });
    return { ...result, sizeBytes: now.size, modifiedAt: new Date(now.mtimeMs).toISOString() };
  }
  async function slotStatus(slot, budgetMiB) {
    const base = { slot, fileName: FILES[slot], exists: false, available: false, validation: 'missing', sizeBytes: 0, modifiedAt: null, overBudget: false };
    let handle;
    try {
      const raw = await fs.lstat(paths[slot]);
      base.exists = true; base.sizeBytes = Number.isSafeInteger(raw.size) && raw.size >= 0 ? raw.size : null;
      base.modifiedAt = Number.isFinite(raw.mtimeMs) ? new Date(raw.mtimeMs).toISOString() : null;
      base.overBudget = raw.size > budgetMiB * MiB;
      await readable(paths[slot], raw, 64, MAX_BYTES); handle = await openRead(paths[slot], raw);
      if (raw.nlink === 2) base.retainedTemporaryLink = true;
      const header = Buffer.alloc(64); let got = 0;
      while (got < 64) { const r = await handle.read(header, got, 64 - got, got); if (!r.bytesRead) fail('恢复文件头部不完整。'); got += r.bytesRead; }
      const framing = inspectHeader(header);
      if (framing.byteLength !== raw.size || framing.byteLength > MAX_BYTES) fail('恢复文件头部长度不一致。');
      if (identity(await handle.stat()) !== identity(raw)) fail('恢复文件在状态检查期间发生变化。', 'RECOVERY_CHANGED');
      await rootInfo();
      const known = validation.get(slot);
      base.validation = known?.identity === identity(raw) ? known.state : 'header-only';
      base.available = base.validation !== 'invalid';
      return base;
    } catch (error) {
      if (error.code === 'ENOENT') return base;
      return { ...base, available: false, validation: error.code === 'RECOVERY_CHANGED' ? 'changed' : 'invalid', error: error.message };
    } finally { if (handle) await handle.close(); }
  }
  async function syncDirectory() {
    if (platform === 'win32') return '文件已提交；Windows 上的目录断电持久性未经确认。';
    let handle;
    try { await rootInfo(); handle = await fs.open(root, 'r'); const opened = await handle.stat(); if (`${opened.dev}:${opened.ino}` !== rootIdentity) fail('恢复目录在刷新时发生变化。'); await handle.sync(); return null; }
    catch { return '文件已提交，但此文件系统无法确认目录刷新；断电持久性未经确认。'; }
    finally { if (handle) await handle.close().catch(() => {}); }
  }
  async function atomic(file, bytes, expected, { signal, preferences = false, committed } = {}) {
    const min = preferences ? 2 : 64, max = preferences ? 4096 : MAX_BYTES;
    abort(signal); await rootInfo(true); abort(signal);
    const temporary = path.join(root, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
    let handle, owns = false, didCommit = false, warning = null;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); owns = true;
      // Opening a pathname can itself be the observed race boundary. Revalidate
      // before disclosing even the first project byte into the opened handle.
      await rootInfo(); abort(signal);
      const opened = await handle.stat(), named = await fs.lstat(temporary);
      regular(opened, 0, 0); regular(named, 0, 0);
      if (identity(opened) !== identity(named)) fail('恢复临时文件已被替换；未写入数据。', 'RECOVERY_CHANGED');
      await rootInfo(); abort(signal);
      let offset = 0;
      while (offset < bytes.length) { abort(signal); const r = await handle.write(bytes, offset, Math.min(MiB, bytes.length - offset), offset); if (!r.bytesWritten) fail('恢复草稿写入未完成。', 'RECOVERY_WRITE'); offset += r.bytesWritten; }
      await handle.sync(); await handle.close(); handle = null; abort(signal);
      // Verify the written bytes, not just a successful write/sync return value.
      const temporaryState = await fingerprint(temporary, { min, max, signal });
      if (!temporaryState || temporaryState.sizeBytes !== bytes.length || temporaryState.sha256 !== digest(bytes)) fail('恢复临时文件校验失败；旧草稿未被覆盖。', 'RECOVERY_WRITE');
      const now = await fingerprint(file, { min, max, signal });
      if ((expected === null) !== (now === null) || expected && (expected.identity !== now.identity || expected.sha256 !== now.sha256)) fail('恢复文件已被其他操作修改；未覆盖。', 'RECOVERY_CHANGED');
      await rootInfo(); abort(signal);
      // No unlink/copy fallback. This final rename is atomic, not a cross-process CAS.
      try {
        if (expected === null) await fs.link(temporary, file);
        else await fs.rename(temporary, file);
        didCommit = true;
      } catch (error) {
        // An unusual filesystem adapter may report failure after a successful rename.
        // Check the committed inode and exact bytes before describing this as a failure.
        let observed;
        try {
          const stat = await fs.lstat(file);
          // A successful no-replace link still has the temporary link until cleanup.
          if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === (expected === null ? 2 : 1) && `${stat.dev}:${stat.ino}` === temporaryState.fileKey) {
            // Verify the exact local pair before cleanup; cleanup can itself fail.
            observed = await fingerprint(file, { min, max });
          }
        } catch { error.commitUncertain = true; }
        if (observed?.fileKey === temporaryState.fileKey && observed.sha256 === temporaryState.sha256) {
          didCommit = true; warning = '文件操作报告异常，但已核实草稿提交成功；请检查本地存储状态。';
        } else throw error;
      }
      if (committed) committed();
      if (expected === null && owns) {
        try { await fs.unlink(temporary); } catch { warning = '草稿已提交，可从已核对的本地临时链接恢复；临时副本清理失败，请检查本地位置。'; }
      }
      const durable = await syncDirectory();
      return { committed: true, durabilityWarning: [warning, durable].filter(Boolean).join(' ') || null };
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (owns && !didCommit) await fs.unlink(temporary).catch(() => {});
    }
  }
  function exclusive(kind, operation, configuringAllowed = false) {
    if (busy || configuring && !configuringAllowed) return Promise.reject(Object.assign(new Error('已有本地恢复操作正在进行。'), { code: 'RECOVERY_BUSY' }));
    const token = { kind, controller: new AbortController(), committed: false, backupCommitted: false };
    busy = token;
    // Execute synchronously to the first await; save's request has already been copied.
    token.promise = (async () => { try { return await operation(token); } finally { if (busy === token) busy = null; } })();
    return token.promise;
  }
  async function storageUsage(location) {
    if (!location) return { storageBytes: 0, storageComplete: true, otherEntryCount: 0 };
    let directory, count = 0, total = 0, other = 0;
    try {
      directory = await fs.opendir(root);
      for await (const entry of directory) {
        // Bound metadata work, including unexpected crash remnants, without reading payloads.
        if (++count > 256) return { storageBytes: null, storageComplete: false, otherEntryCount: null };
        const stat = await fs.lstat(path.join(root, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size) || stat.size < 0) return { storageBytes: null, storageComplete: false, otherEntryCount: null };
        total += stat.size;
        if (!Object.values(FILES).includes(entry.name)) other++;
      }
      return { storageBytes: total, storageComplete: true, otherEntryCount: other };
    } catch { return { storageBytes: null, storageComplete: false, otherEntryCount: null }; }
    finally { if (directory) await directory.close().catch(() => {}); }
  }
  async function status() {
    let loaded = { value: { ...DEFAULTS } }, location, error = null;
    try { location = await rootInfo(); }
    catch (error) { return { enabled: false, budgetMiB: DEFAULT_BUDGET_MIB, budgetChoicesMiB: [...BUDGETS_MIB], maxBytes: MAX_BYTES, rootPath: root, realRootPath: null, totalBytes: null, storageBytes: null, storageComplete: false, otherEntryCount: null, lastSavedAt: null, slots: [], busy: !!busy || configuring, error: error.message, ready: false }; }
    try { loaded = await prefs(); } catch (failure) { error = failure.message; }
    const slots = location ? await Promise.all(['latest', 'previous'].map(slot => slotStatus(slot, loaded.value.budgetMiB))) : ['latest', 'previous'].map(slot => ({ slot, fileName: FILES[slot], exists: false, available: false, validation: 'missing', sizeBytes: 0, modifiedAt: null, overBudget: false }));
    return { enabled: loaded.value.enabled, budgetMiB: loaded.value.budgetMiB, budgetChoicesMiB: [...BUDGETS_MIB], maxBytes: MAX_BYTES, rootPath: root, realRootPath: location?.real || null, totalBytes: slots.every(s => s.sizeBytes !== null) ? slots.reduce((n, s) => n + s.sizeBytes, 0) : null, ...await storageUsage(location), lastSavedAt: slots[0].modifiedAt || slots[1].modifiedAt || null, slots, busy: !!busy || configuring, ready: error === null, ...(error ? { error } : {}) };
  }
  async function configure(payload) {
    const next = settings(payload);
    if (configuring || busy && (next.enabled || busy.kind !== 'save')) fail('已有本地恢复操作正在进行。', 'RECOVERY_BUSY');
    configuring = true;
    try {
      if (busy) { const pending = busy; pending.controller.abort(); await pending.promise.catch(() => {}); }
      return await exclusive('configure', async () => {
        const before = await prefs(true);
        const result = await atomic(paths.preferences, Buffer.from(JSON.stringify(next)), before.expected, { preferences: true });
        return { enabled: next.enabled, budgetMiB: next.budgetMiB, committed: true, durabilityWarning: result.durabilityWarning };
      }, true);
    } finally { configuring = false; }
  }
  function save(payload) {
    let bytes;
    try { if (busy || configuring) fail('已有本地恢复操作正在进行。', 'RECOVERY_BUSY'); bytes = snapshotBytes(payload); }
    catch (error) { return Promise.reject(error); }
    return exclusive('save', async token => {
      const signal = token.controller.signal;
      try {
        const loaded = await prefs(); abort(signal);
        if (!loaded.value.enabled) return { canceled: false, committed: false, skipped: 'disabled' };
        if (bytes.length > loaded.value.budgetMiB * MiB) fail('工程超过所选的每代恢复容量；已有草稿未改变。', 'RECOVERY_BUDGET');
        const frame = inspectHeader(bytes.subarray(0, 64));
        if (frame.byteLength !== bytes.length || frame.byteLength > MAX_BYTES) fail('恢复工程头部长度不一致。', 'RECOVERY_INVALID');
        await decode(bytes); abort(signal); await rootInfo(true); abort(signal);
        // A malformed existing file is not silently repaired or overwritten. In particular,
        // corrupt latest is never rotated over last-good previous.
        const latest = await verified('latest', signal);
        const previous = await verified('previous', signal);
        const previousExpected = previous ? { identity: previous.identity, sha256: previous.sha256 } : null;
        if (previous) previous.bytes = null; // Do not retain a second full old container while writing.
        const warnings = [];
        if (latest) {
          const backup = await atomic(paths.previous, latest.bytes, previousExpected, { signal, committed: () => { token.backupCommitted = true; } });
          if (backup.durabilityWarning) warnings.push(backup.durabilityWarning);
          validation.delete('previous');
        }
        abort(signal);
        const result = await atomic(paths.latest, bytes, latest, { signal, committed: () => { token.committed = true; } });
        validation.delete('latest'); if (result.durabilityWarning) warnings.push(result.durabilityWarning);
        return { canceled: false, committed: true, backupCommitted: token.backupCommitted, cancelRequested: signal.aborted, sizeBytes: bytes.length, durabilityWarning: [...new Set(warnings)].join(' ') || null };
      } catch (error) {
        if ((error.code === 'ABORT_ERR' || error.name === 'AbortError') && !token.committed) return { canceled: true, committed: false, backupCommitted: token.backupCommitted };
        error.backupCommitted = token.backupCommitted; error.committed = token.committed; throw error;
      }
    });
  }
  function open(payload) {
    let slot;
    try { record(payload, ['slot']); slot = payload.slot; if (!['latest', 'previous'].includes(slot)) fail('必须明确选择最新或上一代草稿。', 'RECOVERY_REQUEST'); }
    catch (error) { return Promise.reject(error); }
    return exclusive('open', async () => {
      await rootInfo();
      try {
        const chosen = await verified(slot);
        if (!chosen) fail('所选恢复草稿不存在。', 'RECOVERY_MISSING');
        return { canceled: false, slot, bytes: new Uint8Array(chosen.bytes), displayName: FILES[slot], sizeBytes: chosen.sizeBytes, modifiedAt: chosen.modifiedAt, fallback: slot === 'previous' };
      } catch (error) {
        if (slot !== 'latest') throw error;
        let previous;
        try { previous = await verified('previous'); } catch { /* No verified fallback, never return bytes. */ }
        if (!previous) throw error;
        return { canceled: true, requiresFallbackChoice: true, failedSlot: 'latest', error: error.message, fallbackCandidate: { slot: 'previous', displayName: FILES.previous, sizeBytes: previous.sizeBytes, modifiedAt: previous.modifiedAt, validation: 'verified' } };
      }
    });
  }
  return Object.freeze({ status, configure, save, open,
    isBusy: () => !!busy || configuring,
    cancel: () => { const requested = busy?.kind === 'save'; if (requested) busy.controller.abort(); return { requested, committed: requested ? busy.committed : false, backupCommitted: requested ? busy.backupCommitted : false }; }
  });
}
module.exports = { createRecoveryStore, MAX_BYTES, BUDGETS_MIB, DEFAULT_BUDGET_MIB, FILES };
