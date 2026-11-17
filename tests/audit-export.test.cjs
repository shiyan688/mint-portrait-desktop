'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{writeUniqueImage}=require('../desktop-core.cjs');
test('audit: concurrent exports with one name never overwrite a pre-existing file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mint-audit-concurrent-'));try{
  const original=Buffer.from('original file must remain byte-identical');await fs.writeFile(path.join(dir,'portrait.png'),original);
  const jobs=Array.from({length:20},(_,i)=>writeUniqueImage(dir,'portrait.png',new Uint8Array([137,80,78,71,13,10,26,10,i])));
  const results=await Promise.all(jobs);assert.equal(new Set(results.map(r=>r.filename)).size,20);assert.deepEqual(await fs.readFile(path.join(dir,'portrait.png')),original);
  assert.equal((await fs.readdir(dir)).length,21);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('audit: invalid encoded export never leaves a file behind',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mint-audit-invalid-'));try{
  await assert.rejects(writeUniqueImage(dir,'photo.png',new Uint8Array(20)),/format/);assert.deepEqual(await fs.readdir(dir),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
