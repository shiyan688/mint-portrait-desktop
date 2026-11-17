'use strict';
// All writes are confined to disposable fixtures. No installer is compiled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sync = require('../tools/sync-release.cjs');
const root = path.resolve(__dirname, '..');
const VERSION = '0.2.7';
const NEXT_VERSION = '1.12.345';
const manifest = version => ({ schemaVersion: 1, version, channel: 'development' });
const note = version => `薄荷人像 Desktop ${version} · Windows x64 开发候选版\n\n这是${version}未签名开发候选版，仍不代表Windows或SOTA验收。\n`;
const template = "readme='''薄荷人像 Desktop __RELEASE_VERSION__ · Windows x64 __RELEASE_CHANNEL_LABEL__\n\n这是__RELEASE_VERSION__未签名__RELEASE_CHANNEL_LABEL__，仍不代表Windows或SOTA验收。\n工程写v__PROJECT_VERSION__并读取v1–__PROJECT_PREVIOUS__。\n'''\n";
const write = (base, relative, text) => {
  const file = path.join(base, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
};
const read = (base, relative) => fs.readFileSync(path.join(base, relative), 'utf8');
const replace = (base, relative, before, after) => write(base, relative, read(base, relative).replace(before, after));

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-release-sync-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  write(base, 'release-config.json', JSON.stringify(manifest(VERSION), null, 2) + '\n');
  write(base, 'package.json', '{\r\n  "version" : "0.2.7",\r\n  "name":"example", "nested":{"version":"2.8.0"}, "scripts":{"x":"do not run this"}\r\n}\r\n');
  write(base, 'package-lock.json', '{ "version":"0.2.7", "lockfileVersion":3, "packages": {"":{"name":"example", "version" : "0.2.7"}, "node_modules/a":{"version":"0.2.7"}}, "items":[true,null,1.5,"escaped\\\" text"] }\n');
  write(base, 'installer/MintPortrait.nsi', '!define PRODUCT "薄荷人像 Desktop 开发候选版"\r\n!define VERSION "0.2.7" ; retain comment\r\nVIProductVersion "0.2.7.0"\r\nVIAddVersionKey /LANG=2052 "FileVersion" "0.2.7.0"\r\nVIAddVersionKey /LANG=2052 "ProductVersion" "0.2.7"\r\n!define PRODUCT_ID "MintPortrait.Desktop"\r\nInstallDir "$LOCALAPPDATA\\Programs\\MintPortrait"\r\n');
  write(base, 'installer/BUILD.md', '# Rebuilding the Windows setup programs (installer 0.2.7)\n\nRetain every historical byte.\n## Unreleased 0.2.7 source checkpoint\nSetup尚未生成；未生成或交付。\n');
  write(base, 'installer/prepare.py', template);
  write(base, 'installer/payload/使用说明.txt', '\uFEFF' + note(VERSION));
  write(base, 'CHECKPOINT.md', 'Source checkpoint: Setup尚未生成；未生成或交付。\n');
  write(base, 'README.md', 'Historical source status: Setup尚未生成。\n');
  write(base, 'tools/sync-release.cjs', read(root, 'tools/sync-release.cjs'));
  return base;
}

function snapshot(base, names) {
  const result = {};
  function visit(relative) {
    const full = path.join(base, relative);
    const stat = fs.lstatSync(full, { bigint: true });
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(relative, name));
    } else {
      result[relative] = {
        bytes: fs.readFileSync(full).toString('hex'),
        mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), mode: String(stat.mode),
      };
    }
  }
  for (const name of names || ['']) visit(name);
  return result;
}

test('current canonical release and read-only plan agree without changing target bytes', () => {
  const names = ['release-config.json', ...sync.TARGETS, 'installer/prepare.py', 'installer/payload/使用说明.txt'];
  const present = names.filter(name => fs.existsSync(path.join(root, name)));
  const before = snapshot(root, present);
  const current = sync.loadReleaseConfig(root);
  const stored = JSON.parse(read(root, 'release-config.json'));
  assert.equal(current.version, stored.version);
  assert.equal(current.channel, 'development');
  assert.equal(current.channelLabel, '开发候选版');
  assert.equal(current.windowsVersion, `${stored.version}.0`);
  assert.equal(Object.isFrozen(current), true);
  assert.ok(sync.collectReleasePlan(root).targets.every(target => target.before === target.after));
  assert.deepEqual(sync.synchronizeRelease(root).changed, []);
  assert.deepEqual(snapshot(root, present), before);
});

test('no-argument and explicit --check CLI are read-only, including timestamps and file set', t => {
  const base = fixture(t);
  const before = snapshot(base);
  for (const args of [[], ['--check']]) {
    const child = spawnSync(process.execPath, [path.join(base, 'tools/sync-release.cjs'), ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.mode, 'check');
    assert.equal(result.payloadChecked, true);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(snapshot(base), before);
  }
});

test('strict release schema rejects unsupported fields, channel, types and Windows-incompatible versions', () => {
  for (const invalid of [null, [], Object.create(null), {}, { ...manifest(VERSION), command: 'run' },
    { ...manifest(VERSION), path: '../package.json' }, { ...manifest(VERSION), schemaVersion: true },
    { ...manifest(VERSION), schemaVersion: '1' }, { ...manifest(VERSION), schemaVersion: 2 },
    { ...manifest(VERSION), channel: 'production' }, { ...manifest(VERSION), channel: [] }]) {
    assert.throws(() => sync.validateReleaseConfig(invalid), /release-config.json/);
  }
  for (const version of [null, 1, [], '', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03',
    '-1.2.3', '1.2.3-beta.1', '1.2.3+build', '65536.0.0', '0.65536.0', '0.0.65536',
    '999999999999.0.0', '1.2.3\n', ' 1.2.3', '1.2.3;run']) {
    assert.throws(() => sync.validateReleaseConfig(manifest(version)), /canonical major.minor.patch/);
  }
  assert.equal(sync.validateReleaseConfig(manifest('65535.65535.65535')).windowsVersion, '65535.65535.65535.0');
  assert.equal(sync.validateReleaseConfig(manifest('0.0.0')).version, '0.0.0');
});

test('malformed or duplicate-key JSON is rejected, even with escaped or identical keys', t => {
  const base = fixture(t);
  const valid = read(base, 'release-config.json');
  for (const content of [valid + '{}', valid.replace('"channel"', '"extra":true,"channel"'),
    valid.replace('"schemaVersion": 1', '"schemaVersion": 1.0'), valid.replace('"schemaVersion": 1', '"schemaVersion": 1e0'),
    '{"schemaVersion":1,"version":"0.2.7","version":"0.2.7","channel":"development"}',
    '{"schemaVersion":1,"version":"0.2.7","ver\\u0073ion":"0.2.8","channel":"development"}']) {
    write(base, 'release-config.json', content);
    const before = snapshot(base);
    assert.throws(() => sync.synchronizeRelease(base, { write: true }), /release-config.json/);
    assert.deepEqual(snapshot(base), before);
  }
  write(base, 'release-config.json', valid);
  replace(base, 'package-lock.json', '"version":"0.2.7"', '"version":"0.2.7","version":"0.2.7"');
  assert.throws(() => sync.collectReleasePlan(base), /duplicate JSON key/);
});

test('each tracked version field independently detects drift without writes', t => {
  const base = fixture(t);
  const driftCases = [
    ['package.json', '"version" : "0.2.7"', '"version" : "0.2.6"'],
    ['package-lock.json', '"version":"0.2.7"', '"version":"0.2.6"'],
    ['package-lock.json', '"version" : "0.2.7"', '"version" : "0.2.6"'],
    ['installer/MintPortrait.nsi', '!define VERSION "0.2.7"', '!define VERSION "0.2.6"'],
    ['installer/MintPortrait.nsi', 'VIProductVersion "0.2.7.0"', 'VIProductVersion "0.2.6.0"'],
    ['installer/MintPortrait.nsi', '"FileVersion" "0.2.7.0"', '"FileVersion" "0.2.6.0"'],
    ['installer/MintPortrait.nsi', '"ProductVersion" "0.2.7"', '"ProductVersion" "0.2.6"'],
    ['installer/BUILD.md', '(installer 0.2.7)', '(installer 0.2.6)'],
  ];
  for (const [file, from, to] of driftCases) {
    const original = read(base, file);
    replace(base, file, from, to);
    const before = snapshot(base);
    assert.throws(() => sync.synchronizeRelease(base), /out of sync/, file);
    assert.deepEqual(snapshot(base), before);
    write(base, file, original);
  }
});

test('missing or ambiguous fields abort before any metadata update', t => {
  const base = fixture(t);
  write(base, 'release-config.json', JSON.stringify(manifest(NEXT_VERSION)));
  const cases = [
    ['package.json', '"version" : "0.2.7"', '"other" : "0.2.7"'],
    ['package.json', '"version" : "0.2.7"', '"version" : 27'],
    ['package-lock.json', '"version" : "0.2.7"', '"other" : "0.2.7"'],
    ['installer/MintPortrait.nsi', '!define VERSION "0.2.7"', '!define OTHER "0.2.7"'],
    ['installer/MintPortrait.nsi', '!define VERSION "0.2.7"', '!define VERSION "0.2.7"\n!define /redef VERSION "0.2.8"'],
    ['installer/MintPortrait.nsi', 'VIProductVersion "0.2.7.0"', 'VIProductVersion "0.2.7.0"\nVIProductVersion "0.2.7.0"'],
    ['installer/MintPortrait.nsi', '"FileVersion" "0.2.7.0"', '"FileVersion" "0.2.7.0"\nVIAddVersionKey /LANG=1033 "FileVersion" "0.2.7.0"'],
    ['installer/BUILD.md', '# Rebuilding', '# Not rebuilding'],
  ];
  for (const [file, from, to] of cases) {
    const original = read(base, file);
    replace(base, file, from, to);
    const before = snapshot(base);
    assert.throws(() => sync.synchronizeRelease(base, { write: true }), /missing|expected|canonical/);
    assert.deepEqual(snapshot(base), before);
    write(base, file, original);
  }
});

test('controlled --write updates only declared metadata and preserves historical and unrelated bytes', t => {
  const base = fixture(t);
  const old = Object.fromEntries(sync.TARGETS.map(file => [file, read(base, file)]));
  const untouched = snapshot(base, ['installer/prepare.py', 'installer/payload/使用说明.txt', 'CHECKPOINT.md', 'README.md']);
  write(base, 'release-config.json', JSON.stringify(manifest(NEXT_VERSION)));
  const child = spawnSync(process.execPath, [path.join(base, 'tools/sync-release.cjs'), '--write'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(result.changed, sync.TARGETS);
  assert.equal(result.payloadChecked, false, 'old generated payload is intentionally deferred');
  assert.equal(read(base, 'package.json'), old['package.json'].replace('"version" : "0.2.7"', `"version" : "${NEXT_VERSION}"`));
  assert.equal(read(base, 'package-lock.json'), old['package-lock.json'].replace('"version":"0.2.7"', `"version":"${NEXT_VERSION}"`).replace('"version" : "0.2.7"', `"version" : "${NEXT_VERSION}"`));
  assert.equal(read(base, 'installer/MintPortrait.nsi'), old['installer/MintPortrait.nsi'].replaceAll(VERSION, NEXT_VERSION));
  assert.equal(read(base, 'installer/BUILD.md'), old['installer/BUILD.md'].replace('(installer 0.2.7)', `(installer ${NEXT_VERSION})`));
  assert.deepEqual(snapshot(base, Object.keys(untouched)), untouched);
  assert.throws(() => sync.synchronizeRelease(base), /header version\/channel mismatch/);
  write(base, 'installer/payload/使用说明.txt', '\uFEFF' + note(NEXT_VERSION));
  assert.equal(sync.synchronizeRelease(base).payloadChecked, true);
  const before = snapshot(base);
  assert.deepEqual(sync.synchronizeRelease(base, { write: true }).changed, []);
  assert.deepEqual(snapshot(base), before, 'no-op write preserves timestamps as well as bytes');
});

test('installed notes reject stale version, channel, ambiguity, unresolved tokens and transient checkpoint status', () => {
  const current = sync.validateReleaseConfig(manifest(VERSION));
  for (const content of [note('0.2.6'), note(VERSION).replaceAll('开发候选版', '正式版'),
    note(VERSION).replace('这是0.2.7', '这是0.2.6'), note(VERSION) + note(VERSION),
    note(VERSION) + 'Setup尚未生成', note(VERSION) + 'Setup 尚未生成', note(VERSION) + '未生成或交付',
    note(VERSION) + '__RELEASE_VERSION__']) {
    assert.throws(() => sync.validateReleaseReadme(content, current), /mismatch|ambiguous|checkpoint|placeholder/);
  }
  assert.equal(sync.validateReleaseReadme('\uFEFF' + note(VERSION), current), true);
  assert.equal(sync.validateReleaseReadme(note(VERSION).replaceAll('\n', '\r\n'), current), true);
});

test('template must derive current version/channel and cannot embed checkpoint status', t => {
  const base = fixture(t);
  for (const bad of [template.replaceAll('__RELEASE_VERSION__', VERSION),
    template.replaceAll('__RELEASE_CHANNEL_LABEL__', '开发候选版'), template + template,
    template.replace("'''\n", "Setup尚未生成'''\n"), template.replace("'''\n", "未生成或交付'''\n")]) {
    write(base, 'installer/prepare.py', bad);
    const before = snapshot(base);
    assert.throws(() => sync.synchronizeRelease(base, { write: true }), /template|placeholders|checkpoint/);
    assert.deepEqual(snapshot(base), before);
  }
});

test('source-only checkout can check without a payload; historical status is not treated as an installed note', t => {
  const base = fixture(t);
  fs.rmSync(path.join(base, 'installer/payload'), { recursive: true });
  const before = snapshot(base);
  assert.equal(sync.synchronizeRelease(base).payloadChecked, false);
  assert.deepEqual(snapshot(base), before);
});

test('unsupported CLI and API arguments fail without writes or arbitrary paths', t => {
  const base = fixture(t);
  for (const args of [['--help'], ['--root', base], ['--write', '--check'], ['--check', '--check'], ['--version=1.2.3'], ['--write=true']]) {
    const before = snapshot(base);
    const child = spawnSync(process.execPath, [path.join(base, 'tools/sync-release.cjs'), ...args], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /usage:/);
    assert.deepEqual(snapshot(base), before);
  }
  for (const options of [null, [], true, { write: 'yes' }, { root: base }, { write: true, command: 'run' }]) {
    assert.throws(() => sync.synchronizeRelease(base, options), /only a boolean write option/);
  }
});

test('linked targets and invalid UTF-8 are rejected before writing outside fixed metadata', t => {
  const base = fixture(t);
  const original = read(base, 'package.json');
  const target = path.join(base, 'package.json');
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(base, 'README.md'), target);
  const history = read(base, 'README.md');
  assert.throws(() => sync.synchronizeRelease(base, { write: true }), /symlinks/);
  assert.equal(read(base, 'README.md'), history);
  fs.unlinkSync(target);
  fs.writeFileSync(target, Buffer.concat([Buffer.from(original), Buffer.from([0xff])]));
  assert.throws(() => sync.synchronizeRelease(base, { write: true }), /valid UTF-8/);
});
