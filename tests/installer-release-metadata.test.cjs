'use strict';
// Release metadata and preservation checks. This does not execute Windows code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const installer = read('installer/MintPortrait.nsi');
const prepare = read('installer/prepare.py');
const readme = read('installer/payload/使用说明.txt');
const currentProject = require('../src/project-document.cjs').VERSION;

test('application, lockfile, installer and generated readme identify the same release', () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.ok(installer.includes(`!define VERSION "${pkg.version}"`));
  assert.ok(installer.includes(`VIProductVersion "${pkg.version}.0"`));
  assert.ok(installer.includes(`"FileVersion" "${pkg.version}.0"`));
  assert.ok(installer.includes(`"ProductVersion" "${pkg.version}"`));
  assert.ok(prepare.includes('Desktop __RELEASE_VERSION__ ·'));
  assert.equal(JSON.parse(read('release-config.json')).version, pkg.version);
  assert.ok(readme.includes(`Desktop ${pkg.version} ·`));
  for (const text of [prepare, readme]) assert.doesNotMatch(text, /Setup\s*尚未生成|未生成或交付/, 'Installed release notes must not describe their own Setup as nonexistent');
  assert.ok(read('installer/BUILD.md').startsWith(`# Rebuilding the Windows setup programs (installer ${pkg.version})`));
});

test('development bundle leaves the existing product identity and per-user install path unchanged', () => {
  assert.ok(installer.includes('!define PRODUCT_ID "MintPortrait.Desktop"'));
  assert.ok(installer.includes('!define REGKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MintPortrait.Desktop"'));
  assert.ok(installer.includes('InstallDir "$LOCALAPPDATA\\Programs\\MintPortrait"'));
  assert.match(installer, /^RequestExecutionLevel user$/m);
  assert.match(installer, /请先在 Windows 设置 → 应用中卸载旧版/);
});

test('installed release notes disclose both new stages and project/preset migration', () => {
  for (const note of ['四角透视','编辑四角','应用透视','细节与锐化','任意角度调平','绘画与橡皮','逐人调整','最多5人、默认全零','不是身份跟踪','重新检测建立新全零批次','工程写v' + currentProject + '并读取v1–' + (currentProject - 1),'命名预设现为v3','兼容旧v1/v2','明暗与白平衡','马赛克与遮盖']) {
    assert.ok(prepare.includes(note) || (note.startsWith('工程写v') && prepare.includes('工程写v__PROJECT_VERSION__并读取v1–__PROJECT_PREVIOUS__')), note + ': source template');
    assert.ok(readme.includes(note), note + ': installed readme');
  }
});

test('installed release notes warn that coverage is not deletion of editable originals', () => {
  for (const note of ['马赛克不是可靠匿名化','不透明遮盖也不是安全删除','原图、工程内嵌原图、撤销历史和可选恢复草稿仍保留被覆盖内容','只分享逐张检查过的导出成品','PNG且不缩小','仍须打开实际输出确认覆盖完整']) {
    assert.ok(prepare.includes(note), note + ': source');
    assert.ok(readme.includes(note), note + ': installed readme');
  }
});

test('installed release notes retain unsigned/non-Windows/SOTA and user-file preservation limits', () => {
  for (const note of ['本安装包未签名','尚未实际Windows安装/运行/卸载验收','不等同SOTA','不绕过警告或组织策略','用户工程和AppData偏好/命名预设/恢复草稿']) {
    assert.ok(readme.includes(note), note);
  }
  assert.ok(read('installer/BUILD.md').includes('Retained 0.2.4 artifacts are not replaced.'));
});

test('release documentation has no contradictory stale current-project schema claim', () => {
  const pipeline='构图 → 调平 → 透视 → 留白 → 贴图 → 文字 → 绘画 → 马赛克/不透明遮盖 → 可选最终缩小 → 编码';
  assert.ok(prepare.includes("PIPELINE_ORDER='"+pipeline+"'"));
  assert.ok(readme.includes('顺序为'+pipeline+'。'));
  assert.ok(readme.includes('遮盖顺序是原有图像处理 → '+pipeline+'。'));
  assert.ok(!readme.includes('__PIPELINE_ORDER__'));
  assert.ok(prepare.includes('工程写v__PROJECT_VERSION__并读取v1–__PROJECT_PREVIOUS__'));
  for (const text of [readme]) {
    const claims = [...text.matchAll(/工程(?:当前|现已升级|写)\s*v(\d+)/g)].map(m => Number(m[1]));
    assert.ok(claims.length > 0);
    assert.ok(claims.every(version => version === currentProject), JSON.stringify(claims));
  }
});
