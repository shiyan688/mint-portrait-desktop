'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=[];
for(const p of fs.readdirSync(root)){if(/\.(cjs|mjs)$/.test(p))files.push(p);}
function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(cjs|mjs|js)$/.test(p))files.push(p);}}
walk('src');walk('backend');
for(const file of files){const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr||'Syntax check failed: '+file);process.exit(r.status||1);}}
console.log('Syntax checked '+files.length+' JavaScript application files. No application launch or model inference claimed.');
