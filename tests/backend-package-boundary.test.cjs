'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const packaging=require('../tools/package-win.cjs');
test('ASAR backend allowlist permits pure parser metadata/helpers but no Python, weights or environment',()=>{
 assert.deepEqual(packaging.BACKEND_FILES,['backend/catalog.cjs','backend/adapters/segface/mask.cjs','backend/adapters/segface/manifest.json']);
 for(const p of packaging.BACKEND_FILES)assert.doesNotMatch(p,/\.py$|models|\.venv/);
});
test('Windows package includes trusted render workers and exact native codec dependency allowlist',()=>{
 for(const p of ['export-renderer.cjs','export-render-worker.cjs','export-render-core.cjs','project-store.cjs'])assert.ok(packaging.APP_FILES.includes(p));
 assert.deepEqual(packaging.PROD_PACKAGES,['sharp','@img/colour','@img/sharp-win32-x64','detect-libc','semver']);
});
