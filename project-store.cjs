'use strict';
// Privileged local project I/O. Renderer data never selects a filesystem path.
const fsDefault = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const PROJECT_EXTENSION = '.mintproj';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const abortError = () => Object.assign(new Error('工程操作已取消。'), { name: 'AbortError' });
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function projectPath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== PROJECT_EXTENSION) throw new Error('请使用专用的 .mintproj 工程文件，不会覆盖原始照片。');
  return filePath;
}
function suggestedName(value) {
  const base = typeof value === 'string' ? value.replace(/[/\\:\x00-\x1f<>"|?*]/g, '_').replace(/\.+$/g, '').slice(0, 100) : '';
  let name = base.replace(/\.mintproj$/i, '').replace(/[. ]+$/g, '') || '薄荷人像工程';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name + PROJECT_EXTENSION;
}
function bytesView(value, maxBytes) {
  if (!(value instanceof Uint8Array) || value.byteLength < 64 || value.byteLength > maxBytes || value.buffer instanceof SharedArrayBuffer) throw new Error('工程数据无效或超出大小限制。');
  return value;
}
function identity(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.nlink].join(':'); }
async function readBounded(filePath, { fs = fsDefault, maxBytes, signal, inspectHeader } = {}) {
  checkAbort(signal);
  const link = await fs.lstat(filePath);
  if (!link.isFile() || link.isSymbolicLink()) throw new Error('工程必须是普通文件，不能是链接或目录。');
  if (!Number.isSafeInteger(link.size) || link.size < 64 || link.size > maxBytes) throw new Error('工程大小无效或超出限制；未读取文件内容。');
  const handle = await fs.open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || identity(before) !== identity(link)) throw new Error('工程文件在打开时已变化，请重新选择。');
    if (inspectHeader) {
      const header = Buffer.alloc(64); let got = 0;
      while (got < header.length) { const { bytesRead } = await handle.read(header, got, header.length - got, got); if (!bytesRead) throw new Error('工程头部不完整。'); got += bytesRead; }
      const framing = inspectHeader(header);
      if (framing.byteLength !== before.size || framing.byteLength > maxBytes) throw new Error('工程头部与实际文件长度不一致。');
    }
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < bytes.length) {
      checkAbort(signal);
      const { bytesRead } = await handle.read(bytes, position, Math.min(1024 * 1024, bytes.length - position), position);
      if (!bytesRead) throw new Error('工程文件不完整；原有会话保持不变。');
      position += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, position)).bytesRead) throw new Error('工程读取期间大小变化，请重试。');
    const after = await handle.stat();
    if (identity(after) !== identity(before)) throw new Error('工程读取期间发生变化，请重试。');
    checkAbort(signal);
    return { bytes, identity: identity(after), sha256: sha256(bytes) };
  } finally { await handle.close(); }
}
async function existingSnapshot(filePath, options) {
  try { return await readBounded(filePath, options); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(filePath, bytes, { fs = fsDefault, maxBytes, expected = null, signal, inspectHeader, randomUUID = crypto.randomUUID, platform = process.platform } = {}) {
  projectPath(filePath); bytesView(bytes, maxBytes); checkAbort(signal);
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle = null, committed = false, ownTemporary = false;
  try {
    handle = await fs.open(temporary, 'wx', 0o600); ownTemporary = true;
    let offset = 0;
    while (offset < bytes.byteLength) {
      checkAbort(signal);
      const { bytesWritten } = await handle.write(bytes, offset, Math.min(1024 * 1024, bytes.byteLength - offset), offset);
      if (!bytesWritten) throw new Error('工程写入未完成；旧工程未被覆盖。');
      offset += bytesWritten;
    }
    await handle.sync(); await handle.close(); handle = null;
    checkAbort(signal);
    const now = await existingSnapshot(filePath, { fs, maxBytes, signal, inspectHeader });
    if ((expected === null) !== (now === null) || expected && (expected.identity !== now.identity || expected.sha256 !== now.sha256)) throw new Error('目标工程已被其他操作修改；旧文件未覆盖，请另存为。');
    // Never unlink the destination or use non-atomic copy as a rename fallback.
    // New files use atomic no-replace linking, so a concurrently created target is safe.
    // Existing-file replacement is atomic but is not a cross-process compare-and-swap.
    let durabilityWarning = null;
    if (expected === null) {
      await fs.link(temporary, filePath); committed = true;
      try { await fs.unlink(temporary); } catch { durabilityWarning = '工程已保存，但同目录临时副本清理失败。'; }
    } else { await fs.rename(temporary, filePath); committed = true; }
    if (platform !== 'win32') {
      let dirHandle;
      try { dirHandle = await fs.open(directory, 'r'); await dirHandle.sync(); }
      catch { durabilityWarning = '工程已替换成功，但此文件系统无法确认目录刷新；断电持久性未经确认。'; }
      finally { if (dirHandle) await dirHandle.close().catch(() => {}); }
    }
    return { committed: true, durabilityWarning };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (ownTemporary && !committed) await fs.unlink(temporary).catch(() => {});
  }
}
function createProjectStore({ dialog, getWindow = () => undefined, decode, inspectHeader, maxBytes, fs = fsDefault, platform = process.platform } = {}) {
  if (!dialog || typeof decode !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 64) throw new TypeError('Project store requires trusted dialog, validator and byte limit.');
  let busy = false;
  async function exclusive(operation) { if (busy) throw new Error('已有工程操作正在进行。'); busy = true; try { return await operation(); } finally { busy = false; } }
  return Object.freeze({
    isBusy: () => busy,
    save(payload) { return exclusive(async () => {
      if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => !['bytes', 'suggestedName'].includes(k))) throw new Error('无效的工程保存请求。');
      // Freeze the request before asynchronous validation/dialog, preventing caller mutation.
      const bytes = Uint8Array.from(bytesView(payload.bytes, maxBytes));
      await decode(bytes);
      const chosen = await dialog.showSaveDialog(getWindow(), { title: '保存工程（包含原始照片、调整和蒙版）', defaultPath: suggestedName(payload.suggestedName), filters: [{ name: '薄荷人像工程', extensions: ['mintproj'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (chosen.canceled || !chosen.filePath) return { canceled: true };
      const filePath = projectPath(chosen.filePath);
      const expected = await existingSnapshot(filePath, { fs, maxBytes, inspectHeader });
      if (expected) {
        try { await decode(expected.bytes); }
        catch { throw new Error('目标不是可验证的薄荷工程，未覆盖。请另存为新 .mintproj 文件。'); }
      }
      const result = await atomicWrite(filePath, bytes, { fs, maxBytes, expected, platform, inspectHeader });
      return { canceled: false, displayName: path.basename(filePath), durabilityWarning: result.durabilityWarning };
    }); },
    open() { return exclusive(async () => {
      const chosen = await dialog.showOpenDialog(getWindow(), { title: '打开薄荷人像工程', properties: ['openFile'], filters: [{ name: '薄荷人像工程', extensions: ['mintproj'] }] });
      if (chosen.canceled || !chosen.filePaths?.length) return { canceled: true };
      if (chosen.filePaths.length !== 1) throw new Error('一次只能打开一个工程。');
      const filePath = projectPath(chosen.filePaths[0]);
      const result = await readBounded(filePath, { fs, maxBytes, inspectHeader });
      await decode(result.bytes);
      return { canceled: false, bytes: new Uint8Array(result.bytes), displayName: path.basename(filePath) };
    }); },
    confirmReplace() { return exclusive(async () => {
      const result = await dialog.showMessageBox(getWindow(), { type: 'question', title: '替换当前工程？', message: '当前会话有尚未保存到工程的内容。', detail: '取消后可先保存工程。打开另一工程不会改写任何原始照片。', buttons: ['取消，继续编辑', '放弃未保存内容并打开'], defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 1;
    }); }
  });
}
module.exports = { createProjectStore, readBounded, atomicWrite, suggestedName, PROJECT_EXTENSION };
