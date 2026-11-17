'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {writeUniqueImage}=require('../desktop-core.cjs');
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
async function sandbox(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mint-write-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
for(const failure of ['writeFile','sync'])test(`${failure} failure leaves no partial final file and preserves existing source`,()=>sandbox(async dir=>{
 await fs.writeFile(path.join(dir,'photo.png'),png);const open=fs.open;
 fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).includes('.mint-export-'))return {writeFile:failure==='writeFile'?async()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}:h.writeFile.bind(h),sync:failure==='sync'?async()=>{throw Object.assign(new Error('sync failed'),{code:'EIO'});}:h.sync.bind(h),close:h.close.bind(h)};return h;};
 try{await assert.rejects(writeUniqueImage(dir,'photo.png',png));}finally{fs.open=open;}
 assert.deepEqual(await fs.readdir(dir),['photo.png']);assert.deepEqual(await fs.readFile(path.join(dir,'photo.png')),png);
}));
test('filesystem without hard links fails closed with no partial output or copy fallback',()=>sandbox(async dir=>{
 const link=fs.link;fs.link=async()=>{throw Object.assign(new Error('not supported'),{code:'ENOTSUP'});};
 try{await assert.rejects(writeUniqueImage(dir,'photo.png',png),/not supported/);}finally{fs.link=link;}
 assert.deepEqual(await fs.readdir(dir),[]);
}));
test('directory durability failure reports committed output, never false rollback',()=>sandbox(async dir=>{
 if(process.platform==='win32')return;const open=fs.open;
 fs.open=async(...args)=>args[0]===dir?{sync:async()=>{throw new Error('directory fsync unavailable');},close:async()=>{}}:open(...args);
 let result;try{result=await writeUniqueImage(dir,'photo.png',png);}finally{fs.open=open;}
 assert.equal(result.filename,'photo.png');assert.match(result.durabilityWarning,/已保存/);assert.deepEqual(await fs.readFile(path.join(dir,'photo.png')),png);assert.deepEqual(await fs.readdir(dir),['photo.png']);
}));
test('postcommit temporary cleanup failure is a visible success warning',()=>sandbox(async dir=>{
 const unlink=fs.unlink;fs.unlink=async p=>{if(String(p).includes('.mint-export-'))throw new Error('locked temp');return unlink(p);};
 let result;try{result=await writeUniqueImage(dir,'photo.png',png);}finally{fs.unlink=unlink;}
 assert.equal(result.filename,'photo.png');assert.match(result.durabilityWarning,/已保存/);assert.deepEqual(await fs.readFile(path.join(dir,'photo.png')),png);assert.equal((await fs.readdir(dir)).filter(p=>p.startsWith('.mint-export-')).length,1);
}));
test('concurrent colliding writers never overwrite one another or leave temporary files',()=>sandbox(async dir=>{
 await fs.writeFile(path.join(dir,'photo.png'),png);const outputs=await Promise.all(Array.from({length:20},(_,i)=>writeUniqueImage(dir,'photo.png',Buffer.concat([png,Buffer.from([i])]))));
 assert.equal(new Set(outputs.map(r=>r.filename)).size,20);assert.deepEqual(await fs.readFile(path.join(dir,'photo.png')),png);
 for(let i=0;i<outputs.length;i++)assert.deepEqual(await fs.readFile(path.join(dir,outputs[i].filename)),Buffer.concat([png,Buffer.from([i])]));
 assert.equal((await fs.readdir(dir)).length,21);
}));
test('mutable renderer bytes are snapshotted before any disk await',()=>sandbox(async dir=>{
 const input=Buffer.from(png),pending=writeUniqueImage(dir,'photo.png',input);input.fill(255);await pending;assert.deepEqual(await fs.readFile(path.join(dir,'photo.png')),png);
}));
