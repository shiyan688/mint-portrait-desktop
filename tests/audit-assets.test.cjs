'use strict';
// Static package/asset checks; not a substitute for Electron or WASM execution.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('audit: all vendored inference assets match the offline manifest',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/offline-assets.json'),'utf8'));
 assert.ok(manifest.files.length>=8);
 for(const item of manifest.files){const bytes=fs.readFileSync(path.join(root,item.path));assert.equal(bytes.length,item.bytes,item.path);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path);}
});
test('audit: UI links only local scripts/styles and IDs are unique',()=>{
 const html=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
 const styles=[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m=>m[1]);
 for(const asset of scripts.concat(styles)){assert.ok(!/^(https?:|\/\/)/.test(asset),asset);assert.ok(fs.statSync(path.join(root,'src',asset)).isFile(),asset);}
 assert.match(html,/script-src 'self' 'wasm-unsafe-eval'/);assert.match(html,/connect-src 'self'/);assert.match(html,/object-src 'none'/);assert.match(html,/base-uri 'none'/);
});
