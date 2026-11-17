'use strict';

// Build metadata only. No packaging, downloads, compiler invocation or source
// checkpoint rewriting. CLI paths are fixed; the root argument is a test API.
const fs = require('node:fs');
const path = require('node:path');

const TARGETS = Object.freeze([
  'package.json', 'package-lock.json', 'installer/MintPortrait.nsi', 'installer/BUILD.md',
]);
const VERSION_TOKEN = '__RELEASE_VERSION__';
const CHANNEL_TOKEN = '__RELEASE_CHANNEL_LABEL__';
const NOTE_PATH = 'installer/payload/使用说明.txt';

function fail(label, message) { throw new Error(`${label}: ${message}`); }

function readFixedFile(root, relative, optional = false) {
  // Reject symlink traversal, including for writes through this helper.
  let current = path.resolve(root);
  for (const part of ['', ...relative.split('/')]) {
    if (part) current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(relative, 'symlinks are not supported');
    if (current === path.join(path.resolve(root), relative) && !stat.isFile()) {
      fail(relative, 'expected a regular file');
    }
  }
  const bytes = fs.readFileSync(current);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail(relative, 'expected valid UTF-8');
  return text;
}

// JSON.parse checks grammar; this small walker records exact value spans so
// updating a version preserves whitespace, key ordering and unrelated bytes.
// It also rejects duplicate keys, which JSON.parse alone would silently accept.
function parseJsonDocument(text, label) {
  let value;
  try { value = JSON.parse(text); }
  catch (error) { fail(label, `invalid JSON (${error.message})`); }
  let at = 0;
  const spans = new Map();
  const space = () => { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++; };
  const string = () => {
    const start = at++;
    while (text[at] !== '"') {
      if (text[at] === '\\') at++;
      at++;
    }
    at++;
    return JSON.parse(text.slice(start, at));
  };
  function walk(parts) {
    space();
    const start = at;
    if (text[at] === '{') {
      at++; space();
      const keys = new Set();
      while (text[at] !== '}') {
        const key = string();
        if (keys.has(key)) fail(label, `duplicate JSON key ${JSON.stringify([...parts, key])}`);
        keys.add(key);
        space(); at++; // colon, already checked by JSON.parse
        walk([...parts, key]); space();
        if (text[at] !== ',') break;
        at++; space();
      }
      at++;
    } else if (text[at] === '[') {
      at++; space();
      let index = 0;
      while (text[at] !== ']') {
        walk([...parts, index++]); space();
        if (text[at] !== ',') break;
        at++; space();
      }
      at++;
    } else if (text[at] === '"') {
      string();
    } else {
      while (at < text.length && !/[\x20\t\r\n,}\]]/.test(text[at])) at++;
    }
    spans.set(JSON.stringify(parts), { start, end: at });
  }
  walk([]);
  return { value, spans };
}

function validateVersion(version, label) {
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/.test(version)
      || version.split('.').some(part => Number(part) > 65535)) {
    fail(label, 'expected a canonical major.minor.patch version with each component in 0..65535 (no prerelease/build suffix)');
  }
  return version;
}

function validateReleaseConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
      || Object.getPrototypeOf(config) !== Object.prototype
      || Object.keys(config).sort().join(',') !== 'channel,schemaVersion,version') {
    fail('release-config.json', 'expected exactly schemaVersion, version and channel');
  }
  if (config.schemaVersion !== 1) fail('release-config.json', 'unsupported schemaVersion');
  validateVersion(config.version, 'release-config.json version');
  if (config.channel !== 'development') fail('release-config.json', 'only the development channel is supported');
  return Object.freeze({
    schemaVersion: 1,
    version: config.version,
    channel: config.channel,
    channelLabel: '开发候选版',
    windowsVersion: `${config.version}.0`,
  });
}

function loadReleaseConfig(root = path.resolve(__dirname, '..')) {
  const text = readFixedFile(root, 'release-config.json');
  const document = parseJsonDocument(text, 'release-config.json');
  const release = validateReleaseConfig(document.value);
  const schemaSpan = document.spans.get(JSON.stringify(['schemaVersion']));
  // Match prepare.py's integer-only schema rather than accepting 1.0 or 1e0.
  if (text.slice(schemaSpan.start, schemaSpan.end) !== '1') fail('release-config.json', 'schemaVersion must be the JSON integer 1');
  return release;
}

function replaceJsonVersions(text, fields, release, label) {
  const { value, spans } = parseJsonDocument(text, label);
  const edits = fields.map(parts => {
    let current = value;
    for (const key of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current)
          || !Object.hasOwn(current, key)) fail(label, `missing version field ${JSON.stringify(parts)}`);
      current = current[key];
    }
    validateVersion(current, `${label} ${JSON.stringify(parts)}`);
    const span = spans.get(JSON.stringify(parts));
    return { ...span, value: JSON.stringify(release.version) };
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    // Equal logical values retain the original lexical form too.
    if (JSON.parse(text.slice(edit.start, edit.end)) !== release.version) {
      text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
    }
  }
  return text;
}

function replaceOneField(text, expression, replacement, label) {
  const matches = [...text.matchAll(expression)];
  if (matches.length !== 1) fail(label, `expected exactly one field, found ${matches.length}`);
  const match = matches[0];
  // Each expression separates an immutable prefix/value/suffix.
  return text.slice(0, match.index) + match[1] + replacement + match[3] + text.slice(match.index + match[0].length);
}

function synchronizeNsi(text, release) {
  const declarations = [
    [/^[ \t]*!define(?:[ \t]+\/[^\s]+)*[ \t]+VERSION(?:[ \t]|$)/gm, '!define VERSION'],
    [/^[ \t]*VIProductVersion(?:[ \t]|$)/gm, 'VIProductVersion'],
    [/^[ \t]*VIAddVersionKey[ \t]+[^\r\n]*"FileVersion"(?:[ \t]|$)/gm, 'FileVersion'],
    [/^[ \t]*VIAddVersionKey[ \t]+[^\r\n]*"ProductVersion"(?:[ \t]|$)/gm, 'ProductVersion'],
  ];
  for (const [expression, label] of declarations) {
    const count = [...text.matchAll(expression)].length;
    if (count !== 1) fail(`installer/MintPortrait.nsi ${label}`, `expected exactly one declaration, found ${count}`);
  }
  const fields = [
    [/^([ \t]*!define[ \t]+VERSION[ \t]+\")([^\"\r\n]*)(\"[ \t]*(?:;[^\r\n]*)?\r?$)/gm, release.version, '!define VERSION'],
    [/^([ \t]*VIProductVersion[ \t]+\")([^\"\r\n]*)(\"[ \t]*(?:;[^\r\n]*)?\r?$)/gm, release.windowsVersion, 'VIProductVersion'],
    [/^([ \t]*VIAddVersionKey[ \t]+\/LANG=2052[ \t]+\"FileVersion\"[ \t]+\")([^\"\r\n]*)(\"[ \t]*(?:;[^\r\n]*)?\r?$)/gm, release.windowsVersion, 'FileVersion'],
    [/^([ \t]*VIAddVersionKey[ \t]+\/LANG=2052[ \t]+\"ProductVersion\"[ \t]+\")([^\"\r\n]*)(\"[ \t]*(?:;[^\r\n]*)?\r?$)/gm, release.version, 'ProductVersion'],
  ];
  for (const [expression, replacement, label] of fields) {
    text = replaceOneField(text, expression, replacement, `installer/MintPortrait.nsi ${label}`);
  }
  return text;
}

function validateReleaseReadme(text, release, label = NOTE_PATH) {
  if (typeof text !== 'string') fail(label, 'expected text');
  const normalized = text.replace(/^\uFEFF/, '');
  if (/Setup\s*尚未生成|未生成或交付/.test(normalized)) {
    fail(label, 'installed release notes contain transient source-checkpoint status');
  }
  if (/__RELEASE_[A-Z_]+__/.test(normalized)) fail(label, 'unresolved release placeholder');
  const headers = [...normalized.matchAll(/^薄荷人像 Desktop[^\r\n]*$/gm)];
  const expectedHeader = `薄荷人像 Desktop ${release.version} · Windows x64 ${release.channelLabel}`;
  if (headers.length !== 1 || normalized.split(/\r?\n/, 1)[0] !== expectedHeader) {
    fail(label, 'release header version/channel mismatch or ambiguous header');
  }
  const statuses = [...normalized.matchAll(/^这是([^\r\n]*?)未签名([^\r\n，]*?)，/gm)];
  if (statuses.length !== 1 || statuses[0][1] !== release.version || statuses[0][2] !== release.channelLabel) {
    fail(label, 'current release status version/channel mismatch or ambiguous status');
  }
  return true;
}

function validateReleaseTemplate(source, release) {
  const templates = [...source.matchAll(/^readme\s*=\s*'''([\s\S]*?)'''/gm)];
  if (templates.length !== 1) fail('installer/prepare.py', 'expected exactly one plain readme template');
  const template = templates[0][1];
  const expectedHeader = `薄荷人像 Desktop ${VERSION_TOKEN} · Windows x64 ${CHANNEL_TOKEN}`;
  if (template.split(/\r?\n/, 1)[0] !== expectedHeader
      || !template.includes(`这是${VERSION_TOKEN}未签名${CHANNEL_TOKEN}，`)) {
    fail('installer/prepare.py', 'release header/status must derive from canonical placeholders');
  }
  return validateReleaseReadme(template.replaceAll(VERSION_TOKEN, release.version).replaceAll(CHANNEL_TOKEN, release.channelLabel), release, 'installer/prepare.py readme template');
}

function collectReleasePlan(root = path.resolve(__dirname, '..')) {
  const release = loadReleaseConfig(root);
  const source = readFixedFile(root, 'installer/prepare.py');
  validateReleaseTemplate(source, release);
  const targets = TARGETS.map(relative => {
    const before = readFixedFile(root, relative);
    let after;
    if (relative === 'package.json') after = replaceJsonVersions(before, [['version']], release, relative);
    else if (relative === 'package-lock.json') after = replaceJsonVersions(before, [['version'], ['packages', '', 'version']], release, relative);
    else if (relative.endsWith('.nsi')) after = synchronizeNsi(before, release);
    else {
      after = replaceOneField(before, /^(# Rebuilding the Windows setup programs \(installer )([^\r\n)]*)(\)\r?(?:\n|$))/g,
        release.version, `${relative} first version header`);
    }
    return Object.freeze({ path: relative, before, after, changed: after !== before });
  });
  return Object.freeze({ release, targets: Object.freeze(targets) });
}

function synchronizeRelease(root = path.resolve(__dirname, '..'), options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'write')
      || (Object.hasOwn(options, 'write') && typeof options.write !== 'boolean')) {
    fail('options', 'only a boolean write option is supported');
  }
  const write = options.write === true;
  const plan = collectReleasePlan(root);
  const changes = plan.targets.filter(target => target.changed);
  let payloadChecked = false;
  if (!write) {
    const readme = readFixedFile(root, NOTE_PATH, true);
    if (readme !== null) {
      validateReleaseReadme(readme, plan.release);
      payloadChecked = true;
    }
    if (changes.length) fail('release metadata', `out of sync: ${changes.map(target => target.path).join(', ')}; run node tools/sync-release.cjs --write, then prepare the fresh payload and run --check`);
  } else {
    // Validate every target before touching any file. Generated payload can be
    // from an earlier version here; --check validates it after prepare.py.
    for (const target of plan.targets) {
      if (readFixedFile(root, target.path) !== target.before) fail(target.path, 'changed during planning; no writes performed');
    }
    for (const target of changes) fs.writeFileSync(path.join(root, target.path), target.after, 'utf8');
  }
  return Object.freeze({ release: plan.release, mode: write ? 'write' : 'check', changed: Object.freeze(changes.map(target => target.path)), payloadChecked });
}

function parseArgs(args) {
  if (!Array.isArray(args) || args.length > 1 || (args.length === 1 && args[0] !== '--check' && args[0] !== '--write')) {
    fail('arguments', 'usage: node tools/sync-release.cjs [--check|--write] (default: read-only --check)');
  }
  return { write: args[0] === '--write' };
}

if (require.main === module) {
  try {
    const result = synchronizeRelease(path.resolve(__dirname, '..'), parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  TARGETS, loadReleaseConfig, validateReleaseConfig, validateReleaseReadme,
  validateReleaseTemplate, collectReleasePlan, synchronizeRelease, parseArgs,
};
