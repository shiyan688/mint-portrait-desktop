'use strict';
// Reproducible candidate evidence entry point. This runs only our Node tests
// and the opt-in local Sharp generator. It neither installs dependencies nor
// invokes a browser, network, model, production export, or private photo.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const result = spawnSync(process.execPath, ['--test', 'tests/light-balance-chroma-candidate.test.cjs'], {
  cwd: root,
  env: { ...process.env, MINT_CHROMA_EVIDENCE: '1' },
  stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`Candidate evidence interrupted by ${result.signal}`);
process.exitCode = result.status;
