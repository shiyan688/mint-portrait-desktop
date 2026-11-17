'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const MAX_FILE_BYTES=80*1024*1024,MAX_IMPORT_BYTES=400*1024*1024;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript','.cjs':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.task':'application/octet-stream','.tflite':'application/octet-stream','.txt':'text/plain; charset=utf-8'};
function assetPath(root,url){
 const u=new URL(url);if(u.protocol!=='mint:'||u.hostname!=='app'||u.username||u.password||u.port)throw new Error('Unknown app origin');
 let rel;try{rel=decodeURIComponent(u.pathname)}catch{throw new Error('Invalid URL')}
 if(rel.includes('\\')||rel.includes('\0')||!/^\/(src|assets)\//.test(rel))throw new Error('Forbidden asset path');
 const p=path.resolve(root,'.'+rel),allowed=[path.resolve(root,'src')+path.sep,path.resolve(root,'assets')+path.sep];
 if(!allowed.some(x=>p.startsWith(x)))throw new Error('Forbidden asset path');
 return {path:p,mime:MIME[path.extname(p).toLowerCase()]||'application/octet-stream'};
}
function safeExportName(name){
 if(typeof name!=='string'||name.length>512)throw new Error('Invalid filename');
 let n=path.basename(name.replaceAll('\\','/')).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/[. ]+$/g,'');
 const ext=path.extname(n).toLowerCase();if(!['.jpg','.jpeg','.png'].includes(ext))throw new Error('Only JPEG or PNG export is supported');
 let stem=n.slice(0,-ext.length).trim().slice(0,100)||'portrait';
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))stem='_'+stem;
 return stem+ext;
}
function checkedImageBytes(bytes,ext){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<8||bytes.byteLength>MAX_FILE_BYTES)throw new Error('Invalid or oversized export');
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const png=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpg=b[0]===255&&b[1]===216&&b[2]===255;
 if(ext==='.png'?!png:!jpg)throw new Error('Image format does not match filename');
 return b;
}
async function writeUniqueImage(directory,name,bytes){
 name=safeExportName(name);const ext=path.extname(name),stem=name.slice(0,-ext.length),data=Buffer.from(checkedImageBytes(bytes,ext));
 const temporary=path.join(directory,`.mint-export-${crypto.randomUUID()}.tmp`);let handle,committed=false;
 try {
  handle=await fs.open(temporary,'wx');await handle.writeFile(data);await handle.sync();await handle.close();handle=null;
  for(let n=0;n<10000;n++){
   const candidate=n?`${stem} (${n})${ext}`:name,target=path.join(directory,candidate);
   try{await fs.link(temporary,target);committed=true;let durabilityWarning=null;
    try{await fs.unlink(temporary);}catch{durabilityWarning='图像已保存，但临时文件清理失败。';}
    // Directory fsync is not available on all Windows/filesystem combinations.
    if(process.platform!=='win32'){let dir;try{dir=await fs.open(directory,'r');await dir.sync();}catch{durabilityWarning='图像已保存，但文件夹持久化确认失败。';}finally{await dir?.close().catch(()=>{});}}
    return {filename:candidate,...(durabilityWarning?{durabilityWarning}:{})};
   }catch(e){if(e.code==='EEXIST')continue;throw e;}
  }
  throw new Error('Too many duplicate filenames');
 }finally{if(handle)await handle.close().catch(()=>{});if(!committed)await fs.unlink(temporary).catch(()=>{});}
}

module.exports={assetPath,safeExportName,checkedImageBytes,writeUniqueImage,MAX_FILE_BYTES,MAX_IMPORT_BYTES};
