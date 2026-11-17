'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const asar=await import('@electron/asar');
 const root=path.resolve(__dirname,'..'),dir=path.join(root,'dist/Mint Portrait-win32-x64'),archive=path.join(dir,'resources/app.asar');
 const files=['main.cjs','preload.cjs','desktop-core.cjs','project-store.cjs','preset-store.cjs','recovery-store.cjs','image-import.cjs','image-import-worker.cjs','image-import-decode.cjs','image-import-guards.cjs','desktop-ai.cjs','desktop-backend.cjs','export-renderer.cjs','export-render-worker.cjs','export-render-core.cjs','backend/catalog.cjs','backend/adapters/segface/mask.cjs','backend/adapters/segface/manifest.json'];
 function walk(p){for(const n of fs.readdirSync(p)){const f=path.join(p,n);if(fs.statSync(f).isDirectory())walk(f);else if(path.relative(root,f).replaceAll('\\','/')!=='assets/demo.png')files.push(path.relative(root,f));}}
 walk(path.join(root,'src'));walk(path.join(root,'assets'));
 const productionRoot=path.join(root,'.build/app-win32/node_modules');
 function walkProduction(p){for(const n of fs.readdirSync(p)){const f=path.join(p,n);if(fs.statSync(f).isDirectory())walkProduction(f);else files.push(path.relative(path.join(root,'.build/app-win32'),f));}}walkProduction(productionRoot);
 const checked=files.map(name=>{const actual=asar.extractFile(archive,name.replaceAll('\\','/')),expected=fs.readFileSync(path.join(name.startsWith('node_modules/')?path.join(root,'.build/app-win32'):root,name));if(!actual.equals(expected))throw new Error('Packaged content mismatch: '+name);return {path:name,bytes:actual.length,sha256:crypto.createHash('sha256').update(actual).digest('hex')};});
 const forbidden=asar.listPackage(archive).filter(name=>(/\/(quality|research|checkpoints|installer|tests|tools|docs)(\/|$)/.test(name)||name==='/assets/demo.png'));
 if(!fs.existsSync(path.join(dir,'resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node')))throw new Error('Native Sharp addon missing outside ASAR');
 if(forbidden.length)throw new Error('Non-app or private QA data packaged: '+forbidden.join(', '));
 const deployed=JSON.parse(asar.extractFile(archive,'package.json').toString()), source=require('../package.json');
 for(const key of ['name','productName','version','main','description','license'])if(deployed[key]!==source[key])throw new Error('Packaged manifest mismatch: '+key);
 const exe=fs.readFileSync(path.join(dir,'MintPortrait.exe')),pe=exe.readUInt32LE(0x3c),opt=pe+24;
 if(exe.toString('ascii',pe,pe+4)!=='PE\u0000\u0000'||exe.readUInt16LE(pe+4)!==0x8664||exe.readUInt16LE(opt)!==0x20b||exe.readUInt16LE(opt+68)!==2)throw new Error('Not a Windows x64 GUI PE32+ executable');
 const report={time:new Date().toISOString(),platform:'win32',arch:'x64',electron:require('../package.json').devDependencies.electron,exeBytes:exe.length,exeSha256:crypto.createHash('sha256').update(exe).digest('hex'),asarSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),filesChecked:checked.length,qaAssetsExcluded:forbidden.length===0,files:checked,windowsExecuted:false,browserInferenceExecuted:false};
 fs.writeFileSync(path.join(root,'docs/PACKAGE-VALIDATION.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({filesChecked:checked.length,exeSha256:report.exeSha256,windowsExecuted:false}));
})();
