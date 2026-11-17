'use strict';
// Expected-failure controls run only in disposable child-process memory.
// No production source is changed, and no successful acceptance is mistaken for proof.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-perspective-controls-'));
const controls = [
  { name: 'missing-v17-field-accepted', files: ['src/project-document.cjs'], from: 'ctx.requirePerspective = snapshot.version >= 17;', to: 'ctx.requirePerspective = false;', suite: 'tests/perspective-project.test.cjs' },
  { name: 'legacy-active-perspective-accepted', files: ['src/project-document.cjs'], from: 'ctx.legacyPerspective = snapshot.version < 17;', to: 'ctx.legacyPerspective = false;', suite: 'tests/perspective-project.test.cjs' },
  { name: 'active-perspective-omitted-from-binding', files: ['src/redaction-layers.cjs'], from: 'if (Perspective.isActive(recipe)) out.perspective = recipe;', to: 'if (false) out.perspective = recipe;', suite: 'tests/perspective-selection.test.cjs' },
  { name: 'captured-selection-guards-removed', files: ['src/redaction-layers.cjs', 'src/paint-layers.cjs'], from: 'if (s.perspective && r.layers.some(l => l.selection !== null))', to: 'if (false)', suite: 'tests/perspective-selection.test.cjs' }
];
const results = [];
try {
  const preload = path.join(dir, 'mutate-in-memory.cjs');
  fs.writeFileSync(preload, `const Module = require('node:module'), path = require('node:path');\nconst control = JSON.parse(process.env.MINT_MUTATION_CONTROL), root = process.env.MINT_MUTATION_ROOT, original = Module.prototype._compile;\nModule.prototype._compile = function (source, filename, ...rest) { if (control.files.some(f => filename === path.join(root, f))) { if (!source.includes(control.from)) throw Error('Mutation target missing'); source = source.replace(control.from, control.to); } return original.call(this, source, filename, ...rest); };\n`);
  for (const control of controls) {
    for (const file of control.files) assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(control.from), 'Exact mutation target exists: ' + control.name);
    const out = cp.spawnSync(process.execPath, ['--require', preload, '--test', '--test-reporter=tap', control.suite], { cwd: root, encoding: 'utf8', env: { ...process.env, MINT_MUTATION_CONTROL: JSON.stringify(control), MINT_MUTATION_ROOT: root }, maxBuffer: 8 * 1024 * 1024 });
    const failed = [...out.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]);
    assert.equal(out.signal, null); assert.equal(out.status, 1, 'Broken production variant must fail'); assert.ok(failed.length, 'Must be an assertion failure, not a test-loader crash');
    results.push({ control: control.name, expectedExitCode: 1, actualExitCode: out.status, failingTests: failed.length, sampleFailures: failed.slice(0, 4) });
  }
  fs.writeFileSync(path.join(__dirname, 'project-selection-mutation-results.json'), JSON.stringify({ scope: 'In-memory expected-failure controls; production files remain untouched.', controls: results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
