'use strict';
// Independent source/stage/ASAR audit. No Windows, Electron, NSIS or native
// Windows codec is executed by this file. Existing installer tests cover the
// source-executing, native-API-mocked 0.1.1 directory-path regression.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { builtinModules } = require('node:module');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.build/app-win32');
const archives = [
  'dist/Mint Portrait-win32-x64/resources/app.asar',
  'installer/payload/resources/app.asar'
];
const packaging = require('../tools/package-win.cjs');
const importModules = ['image-import.cjs', 'image-import-worker.cjs', 'image-import-decode.cjs', 'image-import-guards.cjs'];
const imageModules = ['image-overlay.cjs', 'image-assets.cjs', 'image-layers.cjs', 'image-layer-session.cjs', 'image-layer-panel.cjs'];
const forbidden = /(?:^|\/)(?:tests?|fixtures?|quality|research|checkpoints|installer|tools|docs|\.venv)(?:\/|$)|(?:^|\/)demo\.png$/i;
const read = (base, name) => fs.readFileSync(path.join(base, name));
const text = name => read(root, name).toString('utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function files(base, prefix = '') {
  return fs.readdirSync(path.join(base, prefix), { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Unexpected staged symlink: ' + prefix + entry.name);
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(base, name + '/') : [name];
  }).sort();
}
async function contexts() {
  const asar = await import('@electron/asar');
  return archives.map(name => {
    const archive = path.join(root, name);
    assert.ok(fs.existsSync(archive), 'Build current package/payload before auditing: ' + name);
    return { asar, archive, name, read: member => asar.extractFile(archive, member) };
  });
}

test('release allowlist contains every image import worker module and bounded UI/core module', () => {
  const verifier = text('tools/verify-package.cjs');
  for (const name of importModules) {
    assert.ok(packaging.APP_FILES.includes(name), name);
    assert.ok(verifier.includes("'" + name + "'"), 'Main package verifier must check ' + name);
  }
  for (const name of imageModules) assert.ok(fs.existsSync(path.join(stage, 'src', name)), name);
  assert.deepEqual(packaging.CONTENT_DIRS, ['src', 'assets']);
});

test('staged runtime bytes match source, including import, UI, project16 and color fix', () => {
  const members = [...packaging.APP_FILES, ...packaging.BACKEND_FILES,
    ...files(root, 'src/'), ...files(root, 'assets/').filter(name => name !== 'assets/demo.png')];
  for (const name of members) assert.deepEqual(read(stage, name), read(root, name), 'Stale stage: ' + name);
});

test('portable and installer ASAR contain the exact staged file set and current runtime bytes', async () => {
  const expected = files(stage);
  for (const context of await contexts()) {
    const actual = context.asar.listPackage(context.archive).map(name => name.replace(/^\//, ''))
      .filter(name => !context.asar.statFile(context.archive, name).files).sort();
    assert.deepEqual(actual, expected, context.name + ': missing or unexpected member');
    for (const name of expected) {
      if (name === 'package.json') continue; // Packager deliberately prunes scripts/devDependencies.
      assert.deepEqual(context.read(name), read(stage, name), context.name + ': stale bytes: ' + name);
    }
  }
  assert.equal(sha(read(root, archives[0])), sha(read(root, archives[1])), 'Portable/payload ASAR drift');
});

test('stage and both ASAR inventories exclude QA, tests, fixtures and legacy demo image', async () => {
  assert.deepEqual(files(stage).filter(name => forbidden.test(name)), []);
  for (const context of await contexts()) {
    assert.deepEqual(context.asar.listPackage(context.archive).filter(name => forbidden.test(name)), [], context.name);
  }
});

test('image import launches a colocated Node worker with packaged dependency closure, not fixture paths', async () => {
  assert.match(text('image-import.cjs'), /workerPath\s*=\s*path\.join\(__dirname,\s*'image-import-worker\.cjs'\)/);
  assert.match(text('image-import.cjs'), /new Worker\(file, options\)/);
  const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
  const needed = [...packaging.APP_FILES.filter(name => /\.cjs$/.test(name)), ...files(root, 'src/').filter(name => /\.(?:cjs|js)$/.test(name))];
  for (const context of await contexts()) {
    const inventory = new Set(context.asar.listPackage(context.archive).map(name => name.replace(/^\//, '')));
    for (const name of needed) {
      const source = context.read(name).toString('utf8');
      // Literal CommonJS references cover this app's image-import dependency
      // graph. Bundled vendor loaders are checked separately, not guessed here.
      for (const match of source.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)) {
        const target = match[2];
        assert.ok(!forbidden.test(target), name + ' references private/QA content: ' + target);
        if (target.startsWith('.')) {
          const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
          assert.ok(!relative.startsWith('../') && inventory.has(relative), name + ': missing local dependency ' + target);
        } else if (target !== 'electron' && !builtins.has(target.replace(/^node:/, ''))) {
          const packageName = target.startsWith('@') ? target.split('/').slice(0, 2).join('/') : target.split('/')[0];
          assert.ok(inventory.has('node_modules/' + packageName + '/package.json'), name + ': missing package ' + packageName);
        }
      }
      assert.doesNotMatch(source, /(?:["'`])(?:[^"'`\r\n]*\/)?(?:quality|tests|fixtures)\//, name + ': runtime fixture reference');
    }
  }
});

test('Sharp package, required JavaScript dependencies and x64 native codec/DLLs are present and unpacked', async () => {
  const dependencies = ['sharp', '@img/colour', '@img/sharp-win32-x64', 'detect-libc', 'semver'];
  assert.deepEqual(packaging.PROD_PACKAGES, dependencies);
  for (const context of await contexts()) {
    for (const name of dependencies) {
      const manifest = JSON.parse(context.read('node_modules/' + name + '/package.json'));
      for (const dependency of Object.keys(manifest.dependencies || {})) assert.ok(dependencies.includes(dependency), 'Unpackaged dependency: ' + dependency);
      if (manifest.main) assert.ok(context.read(path.posix.normalize('node_modules/' + name + '/' + manifest.main)).length > 0);
      if (name === 'sharp' || name === '@img/sharp-win32-x64') assert.equal(manifest.version, '0.35.5');
    }
    for (const name of ['sharp-win32-x64-0.35.5.node', 'libvips-cpp-8.18.7.dll', 'libvips-42.dll']) {
      const member = 'node_modules/@img/sharp-win32-x64/lib/' + name;
      assert.equal(context.asar.statFile(context.archive, member).unpacked, true, member);
      const bytes = fs.readFileSync(context.archive + '.unpacked/' + member);
      assert.deepEqual(bytes, read(stage, member), context.name + ': native bytes');
      assert.equal(bytes.toString('ascii', 0, 2), 'MZ');
      const pe = bytes.readUInt32LE(0x3c);
      assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0');
      assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, name + ': x64 machine');
    }
  }
});

test('packaged HTML loads image dependencies in order before app and initializes their browser globals', async () => {
  for (const context of await contexts()) {
    const html = context.read('src/index.html').toString('utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
    let previous = -1;
    for (const name of [...imageModules, 'app.js']) {
      assert.equal(scripts.filter(item => item === name).length, 1, name + ' must load exactly once');
      assert.ok(scripts.indexOf(name) > previous, name + ': dependency order');
      previous = scripts.indexOf(name);
    }
    for (const name of scripts) assert.ok(context.read('src/' + name).length > 0, 'Missing script: ' + name);
    const browser = vm.createContext({});
    for (const name of imageModules) vm.runInContext(context.read('src/' + name).toString('utf8'), browser, { filename: name, timeout: 3000 });
    for (const name of ['MintImageOverlay', 'MintImageAssets', 'MintImageLayers', 'MintImageLayerSession', 'MintImageLayerPanel']) {
      assert.equal(typeof browser[name], 'object', name);
    }
    assert.equal(typeof browser.MintImageLayerPanel.mount, 'function');
    assert.equal(typeof browser.MintImageAssets.createCodec, 'function');
  }
});

test('current version/project schema agree in source, stage, both ASARs and installed README', async () => {
  const release = JSON.parse(text('release-config.json'));
  const source = JSON.parse(text('package.json'));
  const lock = JSON.parse(text('package-lock.json'));
  const Project = require('../src/project-document.cjs');
  assert.equal(source.version, release.version);
  assert.equal(lock.version, source.version);
  assert.equal(lock.packages[''].version, source.version);
  const manifests = [JSON.parse(read(stage, 'package.json'))];
  for (const context of await contexts()) {
    manifests.push(JSON.parse(context.read('package.json')));
    const moduleContext = vm.createContext({ module: { exports: {} } });
    vm.runInContext(context.read('src/project-document.cjs').toString('utf8'), moduleContext, { timeout: 3000 });
    assert.equal(moduleContext.module.exports.VERSION, Project.VERSION, context.name + ': schema version');
  }
  for (const manifest of manifests) {
    for (const key of ['name', 'productName', 'version', 'main', 'description', 'license']) assert.equal(manifest[key], source[key], key);
    assert.deepEqual(manifest.dependencies, source.dependencies);
  }
  const readme = text('installer/payload/使用说明.txt');
  assert.ok(readme.includes('Desktop ' + source.version + ' ·'));
  assert.ok(readme.includes('工程写v' + Project.VERSION + '并读取v1–' + (Project.VERSION - 1)));
  for (const note of ['本地图片贴图', '无ICC的16位PNG导出偏色修补', '尚未实际Windows安装/运行/卸载验收', '不等同SOTA']) assert.ok(readme.includes(note), note);
  assert.doesNotMatch(readme, /__(?:RELEASE|PROJECT)_[A-Z_]+__/);
});

test('both packaged decode paths contain the untagged-PNG profile guard', async () => {
  for (const context of await contexts()) {
    for (const name of ['image-import-decode.cjs', 'export-render-worker.cjs']) {
      const source = context.read(name).toString('utf8');
      assert.match(source, /if\s*\(meta\.hasProfile\)\s*image\s*=\s*image\.withIccProfile\('srgb'/, name);
      assert.match(source, /image\s*=\s*image\.toColourspace\('srgb'\)\.ensureAlpha\(\)/, name);
    }
  }
});
