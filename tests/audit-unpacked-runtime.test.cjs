'use strict';
// Independent generated-package checks. These do not execute NSIS or native Windows code.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), installer = path.join(root, 'installer');
const read = name => fs.readFileSync(path.join(installer, name), 'utf8');
const manifest = JSON.parse(read('payload-manifest.json'));
const ancestors = new Set();
for (const item of manifest) {
  let parent = path.posix.dirname(item.path);
  while (parent !== '.') { ancestors.add(parent); parent = path.posix.dirname(parent); }
}

test('uninstaller guards every traversed payload ancestor shallow-first before any deletion', () => {
  const source = read('MintPortrait.nsi'), guards = read('generated/directory-guards.nsh');
  const uninstall = source.split('Section "Uninstall"')[1];
  const invoke = uninstall.indexOf('!insertmacro ValidateOwnedPayloadDirectories "$INSTDIR"');
  assert.ok(invoke >= 0, 'Directory guard macro must run in uninstall');
  assert.ok(invoke < uninstall.indexOf('!insertmacro RemoveOwnedPayload'), 'All directory guards must precede removal');
  assert.ok(!/^\s*(?:Delete|RMDir)\b/m.test(uninstall.slice(0, invoke)), 'Guard before any delete, not only before nested deletes');
  assert.ok(!/^\s*(?:Delete|RMDir)\b/m.test(guards), 'Directory checks must not mutate filesystem');
  const entries = [...guards.matchAll(/GetFileAttributesW\(w "\$\{ROOT\}\\([^"]+)"\) i \.r0 \?e'/g)];
  assert.equal(entries.length, ancestors.size, 'Exactly one check per payload ancestor');
  const checked = new Set();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], directory = entry[1].replaceAll('\\', '/');
    assert.ok(ancestors.has(directory), 'Unexpected guard target ' + directory);
    const parent = path.posix.dirname(directory);
    assert.ok(parent === '.' || checked.has(parent), 'A redirected parent must be rejected before resolving its child: ' + directory);
    assert.ok(!checked.has(directory)); checked.add(directory);
    const body = guards.slice(entry.index + entry[0].length, entries[index + 1]?.index ?? guards.length);
    assert.match(body, /Pop \$1\s+\$\{If\} \$0 == -1/, 'Read error code only if INVALID_FILE_ATTRIBUTES');
    assert.match(body, /\$\{If\} \$1 != 2\s+\$\{AndIf\} \$1 != 3[\s\S]*?Abort/, 'Only already-missing paths may be ignored');
    assert.match(body, /\$\{Else\}\s+IntOp \$0 \$0 & 0x400\s+\$\{If\} \$0 != 0[\s\S]*?Abort/, 'Reparse points must abort without deleting anything');
  }
  assert.deepEqual([...checked].sort(), [...ancestors].sort());
});

test('packaged Sharp addon and both dependent DLLs are real x64 PE files, hashed and removed by exact path', () => {
  const remove = read('generated/remove.nsh'), verify = read('generated/verify.nsh');
  const prefix = 'resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/';
  for (const name of ['sharp-win32-x64-0.35.5.node', 'libvips-cpp-8.18.7.dll', 'libvips-42.dll']) {
    const relative = prefix + name, record = manifest.find(item => item.path === relative);
    assert.ok(record, 'Missing native dependency ' + relative);
    const bytes = fs.readFileSync(path.join(installer, 'payload', relative));
    assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
    const pe = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.subarray(pe, pe + 4).toString(), 'PE\u0000\u0000');
    assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Native dependency must target x64');
    assert.equal(bytes.length, record.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256);
    const nsisPath = relative.replaceAll('/', '\\');
    assert.ok(remove.includes('Delete "${ROOT}\\' + nsisPath + '"'));
    assert.ok(verify.includes(record.sha256));
  }
});
