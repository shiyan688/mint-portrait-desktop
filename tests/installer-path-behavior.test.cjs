'use strict';
// Source-executing, native-API-mocked regression tests. NOT a Windows run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {runValidator, shellFolders} = require('./helpers/nsis-path-harness.cjs');
const source = fs.readFileSync(path.join(__dirname, '../installer/MintPortrait.nsi'), 'utf8');
const before = fs.readFileSync(path.join(__dirname, 'fixtures/installer-path-before-fix.nsh'), 'utf8');
const defaultPath = shellFolders.LOCALAPPDATA + '\\Programs\\MintPortrait';
const sentinels = {'0':'sentinel zero', '1':'sentinel one', '2':'sentinel two'};
const existingFolders = Object.fromEntries(Object.values(shellFolders).map(p => [p, {attrs:0x10}]));
const run = (input, options = {}) => runValidator(source, input, {files:existingFolders, ...options});

for (const functionName of ['CheckSafePath', 'un.CheckSafePath']) {
  test(functionName + ': old missing-directory behavior reproduces the reported warning', () => {
    const result = runValidator(before, defaultPath, {functionName, files:existingFolders});
    assert.equal(result.path, '', 'NSIS builtin clears output for a new path');
    assert.equal(result.failure, '请选择专用的程序文件夹，不要选择磁盘根目录。');
    assert.equal(result.nativeCalls[0].input, defaultPath, 'Input was captured before output, not a self-alias failure');
  });

  test(functionName + ': existing old path succeeds, ruling out unconditional self-alias corruption', () => {
    const result = runValidator(before, defaultPath, {functionName, files:{...existingFolders, [defaultPath]:{attrs:0x10}}});
    assert.equal(result.failure, '');
    assert.equal(result.path, defaultPath);
  });

  const accepted = [
    ['default new directory', defaultPath, defaultPath],
    ['new nested directory', 'D:\\Apps\\New\\MintPortrait', 'D:\\Apps\\New\\MintPortrait'],
    ['Unicode username and directory', 'C:\\Users\\小明\\AppData\\Local\\Programs\\薄荷人像', 'C:\\Users\\小明\\AppData\\Local\\Programs\\薄荷人像'],
    ['Unicode supplementary character', 'D:\\照片🟢\\薄荷人像', 'D:\\照片🟢\\薄荷人像'],
    ['single-character program folder', 'C:\\A', 'C:\\A'],
    ['two-character program folder', 'C:\\AB', 'C:\\AB'],
    ['trailing separator', defaultPath + '\\', defaultPath],
    ['multiple trailing separators', defaultPath + '\\\\', defaultPath],
    ['dot components', 'D:\\Apps\\.\\MintPortrait', 'D:\\Apps\\MintPortrait'],
    ['dot-dot inside drive', 'D:\\Apps\\Old\\..\\MintPortrait', 'D:\\Apps\\MintPortrait'],
    ['forward slash path', 'D:/Apps/MintPortrait/', 'D:\\Apps\\MintPortrait'],
  ];
  for (const [label, input, expected] of accepted) {
    test(functionName + ': accepts ' + label, () => {
      const result = run(input, {functionName});
      assert.equal(result.failure, '');
      assert.equal(result.path, expected);
      assert.equal(result.nativeCalls.filter(c => c.api === 'GetFullPathNameW').length, 1);
      assert.ok(!result.nativeCalls.some(c => c.api === 'NSIS.GetFullPathName'));
    });
  }

  const rejected = [
    ['empty', '', /安装文件夹/],
    ['drive root', 'C:\\', /磁盘根目录/],
    ['root with repeated separators', 'D:\\\\', /磁盘根目录/],
    ['forward slash root', 'D:/', /磁盘根目录/],
    ['dot-dot resolving to root', 'C:\\MintPortrait\\..', /磁盘根目录/],
    ['root relative', '\\Programs\\MintPortrait', /绝对路径/],
    ['relative', 'MintPortrait', /绝对路径/],
    ['drive relative', 'C:MintPortrait', /完整路径/],
    ['bare drive', 'C:', /完整路径/],
    ['UNC', '\\\\server\\share\\MintPortrait', /网络或设备路径/],
    ['extended device namespace', '\\\\?\\C:\\MintPortrait', /网络或设备路径/],
    ['device namespace', '\\\\.\\C:\\MintPortrait', /网络或设备路径/],
    ['forward-slash UNC', '//server/share/MintPortrait', /绝对路径/],
  ];
  for (const [label, input, expected] of rejected) {
    test(functionName + ': rejects ' + label + ' without erasing the input', () => {
      const result = run(input, {functionName, variables:sentinels});
      assert.match(result.failure, expected);
      assert.equal(result.path, input);
      for (const [name, expectedValue] of Object.entries(sentinels)) assert.equal(result.vars[name], expectedValue);
    });
  }

  for (const [name, input] of Object.entries(shellFolders)) {
    test(functionName + ': protects ' + name + ' including case, trailing slash and dot-dot aliases', () => {
      for (const variant of [input, input.toLowerCase(), input + '\\', input + '\\temporary\\..']) {
        const result = run(variant, {functionName});
        assert.match(result.failure, /系统或个人资料目录本身/, variant);
        assert.equal(result.path, variant);
      }
    });
  }

  for (const nativeReturn of [0, 1024, 2048]) {
    test(functionName + ': native error/overflow ' + nativeReturn + ' does not destroy the visible path', () => {
      const result = run(defaultPath, {functionName, nativeReturn});
      assert.match(result.failure, /无法解析.*路径过长/);
      assert.equal(result.path, defaultPath);
      assert.equal(result.nativeCalls.length, 1, 'Do not inspect or use an undefined output buffer');
    });
  }

  test(functionName + ': rejects target or ancestor reparse points, even when the leaf does not exist', () => {
    for (const linkedPath of [defaultPath, shellFolders.LOCALAPPDATA + '\\Programs', shellFolders.PROFILE]) {
      const result = run(defaultPath, {functionName, files:{...existingFolders, [linkedPath]:{attrs:0x410}}});
      assert.match(result.failure, /链接或重定向/);
      assert.equal(result.path, defaultPath);
      assert.ok(result.nativeCalls.some(c => c.api === 'GetFileAttributesW' && c.input === linkedPath));
    }
  });

  test(functionName + ': restores scratch registers on successful and rejected paths', () => {
    const variables = {'0':'sentinel zero', '1':'sentinel one', '2':'sentinel two'};
    for (const [input, extras] of [[defaultPath, {}], ['C:\\', {}], [defaultPath, {nativeReturn:0}]]) {
      const result = run(input, {functionName, variables, ...extras});
      for (const [name, expected] of Object.entries(variables)) assert.equal(result.vars[name], expected);
    }
  });
}

test('CheckEmptyDestination accepts new and existing empty directories', () => {
  for (const exists of [false, true]) {
    const files = {...existingFolders};
    if (exists) files[defaultPath] = {attrs:0x10, entries:[]};
    const result = run(defaultPath, {functionName:'CheckEmptyDestination', files});
    assert.equal(result.failure, '');
    assert.equal(result.path, defaultPath);
    assert.equal(result.openFindHandles, 0);
  }
});

test('CheckEmptyDestination still rejects files and nonempty folders', () => {
  for (const [entry, message] of [[{attrs:0}, /是文件，不是文件夹/], [{attrs:0x10, entries:['photo.jpg']}, /目标文件夹不是空的/]]) {
    const result = run(defaultPath, {functionName:'CheckEmptyDestination', files:{...existingFolders, [defaultPath]:entry}});
    assert.match(result.failure, message);
    assert.equal(result.openFindHandles, 0);
  }
});

test('behavior harness rejects unknown validator instructions rather than silently skipping them', () => {
  const changed = source.replace('StrCpy $PathInput "$INSTDIR"', 'ImaginaryInstruction $PathInput "$INSTDIR"');
  assert.notEqual(changed, source, 'Mutation must touch the actual validator');
  assert.throws(() => runValidator(changed, defaultPath), /Unsupported NSIS instruction/);
});


test('directory validation is read-only: leaving/cancelling cannot create or remove files', () => {
  const disallowed = /^(CreateDirectory|SetOutPath|Delete|RMDir|Rename|CopyFiles|WriteINIStr|WriteRegStr|FileOpen|Exec|ExecWait)$/;
  const scenarios = [
    [defaultPath, {}],
    [defaultPath, {files:{...existingFolders, [defaultPath]:{attrs:0x10, entries:[]}}}],
    [defaultPath, {files:{...existingFolders, [defaultPath]:{attrs:0x10, entries:['photo.jpg']}}}],
    ['C:\\', {}],
    [defaultPath, {nativeReturn:0}],
    [defaultPath, {files:{...existingFolders, [shellFolders.PROFILE]:{attrs:0x410}}}],
  ];
  for (const [input, extras] of scenarios) {
    const result = run(input, {functionName:'CheckEmptyDestination', ...extras});
    assert.ok(!result.trace.some(step => disallowed.test(step.command)));
    assert.ok(result.nativeCalls.every(call => ['GetFullPathNameW', 'GetFileAttributesW'].includes(call.api)));
    assert.equal(result.openFindHandles, 0);
  }
});
