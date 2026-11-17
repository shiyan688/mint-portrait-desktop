'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const c=require('../desktop-core.cjs');
test('protocol permits only shipped source and asset files',()=>{
 assert.equal(c.assetPath('/app','mint://app/src/index.html').path,'/app/src/index.html');
 assert.equal(c.assetPath('/app','mint://app/src/portrait-engine.cjs').mime,'application/javascript');
 for(const url of ['https://evil.test/src/a.js','mint://evil/src/a.js','mint://app/main.cjs','mint://app/assets/%2e%2e%2fmain.cjs','mint://app/assets/%5c..%5cmain.cjs','mint://app/assets/%00a'])assert.throws(()=>c.assetPath('/app',url));
});
test('filenames cannot escape folder or overwrite Windows devices',()=>{
 assert.equal(c.safeExportName('../../hello.png'),'hello.png');
 assert.equal(c.safeExportName('C:\\images\\hello.jpg'),'hello.jpg');
 assert.equal(c.safeExportName('CON.png'),'_CON.png');
 assert.equal(c.safeExportName('photo:*?.png'),'photo___.png');
 assert.throws(()=>c.safeExportName('photo.exe'));
});
test('bytes must match image extension',()=>{
 assert.throws(()=>c.checkedImageBytes(new Uint8Array(20),'.png'));
 assert.throws(()=>c.checkedImageBytes(new Uint8Array([255,216,255,0,0,0,0,0]),'.png'));
 assert.equal(c.checkedImageBytes(new Uint8Array([255,216,255,0,0,0,0,0]),'.jpg').length,8);
});
test('exports are exclusive, collisions preserve existing originals',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mint-export-'));try{
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
 const one=await c.writeUniqueImage(dir,'test.png',bytes),two=await c.writeUniqueImage(dir,'test.png',bytes);
 assert.equal(one.filename,'test.png');assert.equal(two.filename,'test (1).png');assert.deepEqual(await fs.readFile(path.join(dir,'test.png')),Buffer.from(bytes));
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
