'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const repo=path.resolve(__dirname,'../../..'),old=process.argv[3]&&path.resolve(process.argv[3]);
if(!process.argv[2]||!old)throw Error('Usage: node reproduce-shipped.cjs <0.2.7 app.asar> <restored source24 root>');
const sharp=require(path.join(repo,'node_modules/sharp')),Canvas=require('@napi-rs/canvas');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const asar=await import(pathToFileURL(path.join(repo,'node_modules/@electron/asar/lib/asar.js')));
 const archive=path.resolve(process.argv[2]);
 if(sha(fs.readFileSync(archive))!=='087c84b326e2a5a00a5541832f33fb9dd9b06975d35ea19d344123b8eef4d591')throw Error('Expected exact shipped0.2.7 ASAR');
 const proofs=[];for(const name of ['export-render-core.cjs','export-render-worker.cjs','export-renderer.cjs','src/project-document.cjs']){const shipped=asar.extractFile(archive,name),restored=fs.readFileSync(path.join(old,name));if(!shipped.equals(restored))throw Error('Not shipped bytes: '+name);proofs.push({name,sha256:sha(shipped)});}
 const service=require(path.join(old,'export-renderer.cjs')).createExportRenderer(),Project=require(path.join(old,'src/project-document.cjs'));
 const cases=[];
 for(const hex of ['#12aaed','#808080','#e63223','#122328','#f4dcc8']){
  for(const depth of [8,16]){
   const stem=hex.slice(1)+'-'+depth,filename=path.join(__dirname,stem+'-input.png');
   let build=sharp({create:{width:16,height:12,channels:3,background:hex}});if(depth===16)build=build.toColourspace('rgb16');
   const source=await build.png().toBuffer();fs.writeFileSync(filename,source);const meta=await sharp(source).metadata();
   const img=await Canvas.loadImage(source),c=Canvas.createCanvas(16,12);c.getContext('2d').drawImage(img,0,0);const imported=Array.from(c.getContext('2d').getImageData(0,0,1,1).data);
   const expected=Array.from((await sharp(source).autoOrient().toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer()).subarray(0,4));
   const request={requestId:'color-'+stem,sourceRevision:'source-color',bytes:new Uint8Array(source),settings:structuredClone(Project.DEFAULT_SETTINGS),mode:'original',format:'png',quality:.94};
   const out=await service.render(request),pixels=await sharp(out.bytes).ensureAlpha().raw().toBuffer();fs.writeFileSync(path.join(__dirname,stem+'-shipped-export.png'),out.bytes);
   cases.push({color:hex,depth,hasProfile:meta.hasProfile,space:meta.space,inputSha256:sha(source),nativeSkiaDecode:imported,referenceDecode:expected,shippedNativeExport:Array.from(pixels.subarray(0,4)),originalBytesUnchanged:sha(source)===sha(fs.readFileSync(filename))});
  }
 }
 service.dispose();fs.writeFileSync(path.join(__dirname,'shipped-results.json'),JSON.stringify({source:'Exact four modules extracted from shipped0.2.7 ASAR and matched restored checkpoint24',runtime:'Linux Node24/Sharp0.35.5 worker; NativeCanvas Skia reference. Not Chromium/Windows import UI.',proofs,cases},null,2)+'\n');console.log(JSON.stringify(cases,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
