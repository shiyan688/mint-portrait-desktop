'use strict';
// Static/package regression checks only. These are not Windows execution tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const installer = path.join(root, 'installer');
const source = fs.readFileSync(path.join(installer, 'MintPortrait.nsi'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(installer, 'payload-manifest.json'), 'utf8'));
const verify = fs.readFileSync(path.join(installer, 'generated/verify.nsh'), 'utf8');
const remove = fs.readFileSync(path.join(installer, 'generated/remove.nsh'), 'utf8');
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const normalized = p => p.replaceAll('\\', '/');

test('installer payload is a complete, exact, hash-verified file inventory', () => {
  const entries = new Set();
  for (const file of manifest) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!/[:\\*$"\r\n]/.test(file.path), 'Unsafe manifest path: ' + file.path);
    assert.ok(!path.posix.isAbsolute(file.path) && !file.path.split('/').includes('..'));
    assert.ok(!entries.has(file.path.toLowerCase()), 'Case-insensitive duplicate path');
    entries.add(file.path.toLowerCase());
    const local = path.join(installer, 'payload', file.path);
    const stat = fs.lstatSync(local);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, file.bytes, file.path + ': size');
    assert.equal(digest(local), file.sha256, file.path + ': digest');
  }
  function list(dir, prefix = '') {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
      assert.ok(!entry.isSymbolicLink(), 'Payload must not contain symlinks');
      const rel = prefix + entry.name;
      return entry.isDirectory() ? list(path.join(dir, entry.name), rel + '/') : [rel.toLowerCase()];
    });
  }
  assert.deepEqual(list(path.join(installer, 'payload')).sort(), [...entries].sort());
  for (const needed of ['mintportrait.exe', 'mintportrait.ico', 'resources/app.asar', 'license', 'licenses.chromium.html']) {
    assert.ok(entries.has(needed), 'Missing application/license file: ' + needed);
  }
  assert.ok(!entries.has('electron.exe') && !entries.has('resources/default_app.asar'));
  assert.equal(digest(path.join(installer, 'payload/resources/app.asar')),
    digest(path.join(root, 'dist/Mint Portrait-win32-x64/resources/app.asar')));
});

test('all payload files receive installed-byte integrity verification', () => {
  const actual = [...verify.matchAll(/Push "\$\{ROOT\}\\([^"\r\n]+)"\s+StdUtils::HashFile\s+Pop \$0\s+StrCmp \$0 "([a-f0-9]{64})" \+3\s+StrCpy \$Failure [^\r\n]+\s+Goto install_fail/g)]
    .map(m => ({path: normalized(m[1]), sha256: m[2]}));
  assert.deepEqual(actual, manifest.map(({path, sha256}) => ({path, sha256})));
  assert.equal((verify.match(/Push "SHA2-256"/g) || []).length, manifest.length);
});

test('uninstall removal is an exact compile-time allowlist, never wildcard or recursive', () => {
  const deleted = [...remove.matchAll(/^\s*Delete "\$\{ROOT\}\\([^"\r\n]+)"/gm)].map(m => normalized(m[1]));
  assert.deepEqual(deleted, manifest.map(f => f.path));
  assert.ok(!/RMDir\s+\/r\b/i.test(remove));
  assert.ok(!/^\s*Delete[^\r\n]*[?*]/m.test(remove));
  assert.equal((remove.match(/StrCpy \$DeleteFailed "1"/g) || []).length, manifest.length);
  const uninstallSection = source.split('Section "Uninstall"')[1];
  assert.ok(uninstallSection, 'Missing uninstall section');
  assert.ok(!/RMDir\s+\/r\b/i.test(uninstallSection));
  assert.ok(!/^\s*Delete[^\r\n]*[?*]/m.test(uninstallSection));
  assert.ok(!/(?:Delete|RMDir)[^\r\n]*\$(?:APPDATA|LOCALAPPDATA|DOCUMENTS|PROFILE)\b/.test(uninstallSection));
  assert.match(uninstallSection, /\$DeleteFailed == "1"[\s\S]*?Abort[\s\S]*?DeleteRegKey/);
});

test('native setup is per-user and does not weaken system security or terminate applications', () => {
  assert.match(source, /^RequestExecutionLevel user$/m);
  assert.ok((source.match(/SetShellVarContext current/g) || []).length >= 2);
  assert.ok(!/\b(?:HKLM|HKCR)\b/.test(source));
  assert.ok(!/SetShellVarContext all/i.test(source));
  assert.ok(!/(?:ExecutionPolicy|--no-sandbox|\/WEAKSECURITY|_KillProcess|_CloseProcess)/i.test(source));
  assert.ok(!/^\s*(?:Exec|ExecWait|nsExec::|Reboot)\b/m.test(source));
  assert.match(source, /nsProcess::_FindProcess "MintPortrait\.exe"/);
  assert.match(source, /\$0 != 603/);
  assert.match(source, /"UninstallString"\s+'\$\\"\$INSTDIR\\Uninstall\.exe\$\\"'/);
});

test('online runtime has an exact official version pin and hash before extraction', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.electron;
  assert.ok(source.includes(`https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`));
  assert.match(source, /!define RUNTIME_SHA "ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47"/);
  const download = source.indexOf('INetC::get');
  const hash = source.indexOf('StdUtils::HashFile', download);
  const comparison = source.indexOf('$0 != "${RUNTIME_SHA}"', hash);
  const extract = source.indexOf('nsisunz::Unzip');
  assert.ok(download >= 0 && hash > download && comparison > hash && extract > comparison);
  assert.match(source.slice(comparison, extract), /Goto install_fail/);
  assert.match(source, /\/CONNECTTIMEOUT 30 \/RECEIVETIMEOUT 60/);
  assert.match(source, /!ifdef OFFLINE[\s\S]*?File \/r "payload\/\*"/);
});

test('directory-page callback is bound to the directory page, not the welcome page', () => {
  const callback = source.indexOf('!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave');
  assert.ok(callback >= 0);
  assert.match(source.slice(callback, callback + 140), /^!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave\s+!insertmacro MUI_PAGE_DIRECTORY/);
});

test('missing payload directories do not prevent retrying a partial uninstall', () => {
  const uninstall = source.split('Section "Uninstall"')[1];
  for (const name of ['resources', 'locales']) {
    const needle = `GetFileAttributesW(w "$INSTDIR\\${name}") i .r0'`;
    const position = uninstall.indexOf(needle);
    assert.ok(position >= 0, 'Missing reparse protection for ' + name);
    const guard = uninstall.slice(position + needle.length, position + needle.length + 130);
    assert.match(guard, /^\s*\$\{If\} \$0 != -1\s+IntOp \$0 \$0 & 0x400/,
      'INVALID_FILE_ATTRIBUTES must not be bitmasked as a real reparse-point flag');
  }
});

test('uninstall revalidates path, ownership, and app state when deletion actually begins', () => {
  let beforeDelete = source.split('Section "Uninstall"')[1].split('!insertmacro RemoveOwnedPayload')[0];
  const visited = new Set();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [, name] of [...beforeDelete.matchAll(/\bCall (un\.[A-Za-z0-9_.]+)/g)]) {
      if (visited.has(name)) continue;
      visited.add(name);
      const start = source.indexOf('Function ' + name + '\n');
      if (start < 0) continue;
      beforeDelete += '\n' + source.slice(start, source.indexOf('FunctionEnd', start));
      changed = true;
    }
    if (!changed) break;
  }
  assert.match(beforeDelete, /Call un\.CheckSafePath/);
  assert.match(beforeDelete, /ReadINIStr[^\r\n]+"Product"/);
  assert.match(beforeDelete, /ReadINIStr[^\r\n]+"Path"/);
  assert.match(beforeDelete, /nsProcess::_FindProcess "MintPortrait\.exe"/);
});

test('uninstaller and installation identity must be checked before committing the stage', () => {
  const write = source.indexOf('WriteUninstaller "$Stage\\Uninstall.exe"');
  const commit = source.indexOf('Rename "$Stage" "$INSTDIR"');
  assert.ok(write > 0 && commit > write);
  const preparation = source.slice(write, commit);
  assert.match(source.slice(write - 40, write), /ClearErrors\s*$/);
  assert.match(preparation, /WriteUninstaller[^\r\n]+\s+\$\{If\} \$\{Errors\}[\s\S]*?Goto install_fail/);
  assert.match(preparation, /ReadINIStr[^\r\n]+"Product"/);
  assert.match(preparation, /ReadINIStr[^\r\n]+"Path"/);
});

test('final uninstall metadata cleanup retains a recoverable path on registry failure', () => {
  const uninstall = source.split('Section "Uninstall"')[1];
  const exeRemoval = uninstall.indexOf('Delete "$INSTDIR\\Uninstall.exe"');
  const markerRemoval = uninstall.indexOf('Delete "$INSTDIR\\.mint-portrait-install.ini"');
  assert.ok(exeRemoval > 0 && markerRemoval > exeRemoval);
  assert.match(uninstall.slice(0, exeRemoval), /CopyFiles \/SILENT "\$INSTDIR\\Uninstall\.exe" "\$PLUGINSDIR\\uninstall-backup\.exe"/);
  assert.match(uninstall.slice(0, exeRemoval), /CopyFiles \/SILENT "\$INSTDIR\\\.mint-portrait-install\.ini" "\$PLUGINSDIR\\install-marker-backup\.ini"/);
  const registry = uninstall.slice(uninstall.indexOf('DeleteRegKey HKCU "${REGKEY}"'));
  assert.match(registry, /^DeleteRegKey[^\r\n]+\s+\$\{If\} \$\{Errors\}/);
  assert.match(registry, /CopyFiles \/SILENT "\$PLUGINSDIR\\uninstall-backup\.exe" "\$INSTDIR\\Uninstall\.exe"/);
  assert.match(registry, /CopyFiles \/SILENT "\$PLUGINSDIR\\install-marker-backup\.ini" "\$INSTDIR\\\.mint-portrait-install\.ini"/);
  assert.match(registry, /SetErrorLevel 2\s+Abort/);
});

test('fresh-only install revalidates its empty safe destination around slow operations', () => {
  assert.match(source, /ReadRegStr \$0 HKCU "\$\{REGKEY\}" "InstallLocation"[\s\S]*?Abort/);
  const section = source.slice(source.indexOf('Section "薄荷人像（必需）"'), source.indexOf('Section "创建桌面快捷方式"'));
  assert.ok((section.match(/Call CheckEmptyDestination/g) || []).length >= 3);
  assert.match(source, /!insertmacro SafePathFunction ""/);
  assert.match(source, /!insertmacro SafePathFunction "un\."/);
  assert.match(source, /GetFileAttributesW\(w "\$Probe"\)[\s\S]*?0x400/);
  assert.match(source, /FindFirst \$Handle \$Entry "\$INSTDIR\\\*"/);
  const commit = section.indexOf('Rename "$Stage" "$INSTDIR"');
  const verified = section.indexOf('!insertmacro VerifyPayload "$Stage"');
  assert.ok(verified > 0 && commit > verified);
  assert.match(section.slice(verified, commit), /SetOutPath "\$TEMP"/);
  assert.ok(!/RMDir\s+\/r[^\r\n]*\$INSTDIR/.test(source));
});

test('unsigned test-build and Windows validation limitations are explicit', () => {
  assert.ok(source.includes('本版本未签名'));
  assert.ok(source.includes('尚未进行 Windows 真机验收'));
  assert.ok(source.includes('遇到系统安全拦截请停止并反馈，不绕过警告'));
  const notes = fs.readFileSync(path.join(installer, 'payload/使用说明.txt'), 'utf8');
  assert.ok(notes.includes('尚未实际Windows安装/运行/卸载验收'));
});

test('rebuilding the application cannot recursively embed the installer workspace', () => {
  const packaging = require('../tools/package-win.cjs');
  assert.deepEqual(packaging.CONTENT_DIRS, ['src', 'assets']);
  for (const p of [...packaging.APP_FILES, ...packaging.BACKEND_FILES]) {
    assert.ok(!p.startsWith('installer/') && !p.startsWith('dist/') && !p.startsWith('quality/') && !p.startsWith('.build/'));
    assert.ok(!p.endsWith('.exe') && !p.includes('..'));
  }
  assert.ok(packaging.APP_FILES.includes('main.cjs'));

});
