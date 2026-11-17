'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),from=path.join(root,'node_modules/@mediapipe/tasks-vision'),to=path.join(root,'assets/vision');
fs.mkdirSync(to,{recursive:true});
fs.copyFileSync(path.join(from,'vision_bundle.mjs'),path.join(to,'vision_bundle.mjs'));
fs.cpSync(path.join(from,'wasm'),path.join(to,'wasm'),{recursive:true});
const manifest={version:require(path.join(from,'package.json')).version,source:'https://www.npmjs.com/package/@mediapipe/tasks-vision',files:[]};
function walk(dir){for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else manifest.files.push({path:path.relative(root,p),bytes:fs.statSync(p).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}}
walk(to);walk(path.join(root,'assets/models'));
fs.writeFileSync(path.join(root,'docs/offline-assets.json'),JSON.stringify(manifest,null,2));
console.log('Vendored offline model/runtime assets:',manifest.files.length);
