'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sharp=require('sharp'),Project=require('../src/project-document.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function exportPNG(source){const service=createExportRenderer();try{return await service.render({requestId:'color-regression',sourceRevision:'source-color',bytes:new Uint8Array(source),settings:structuredClone(Project.DEFAULT_SETTINGS),mode:'original',format:'png',quality:.94});}finally{service.dispose();}}
for(const depth of [8,16])for(const color of ['#12aaed','#808080','#e63223','#122328','#f4dcc8'])test(`untagged ${depth}-bit PNG ${color} stays the declared 8-bit RGB at neutral actual native export`,async()=>{
 let s=sharp({create:{width:16,height:12,channels:3,background:color}});if(depth===16)s=s.toColourspace('rgb16');const bytes=await s.png().toBuffer(),before=hash(bytes),meta=await sharp(bytes).metadata();
 assert.equal(meta.hasProfile,false);assert.equal(meta.depth,depth===16?'ushort':'uchar');const out=await exportPNG(bytes),rgba=await sharp(out.bytes).ensureAlpha().raw().toBuffer();
 const expected=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16),255];for(let i=0;i<rgba.length;i+=4)assert.deepEqual([...rgba.subarray(i,i+4)],expected);
 assert.equal(hash(bytes),before);assert.equal(out.details.color,'8-bit sRGB');const info=await sharp(out.bytes).metadata();assert.equal(info.depth,'uchar');assert.equal(info.hasProfile,true);assert.equal(info.exif,undefined);
});
test('negative control reproduces the forced-ICC failure rather than accepting both color paths',async()=>{
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#12aaed'}}).toColourspace('rgb16').png().toBuffer();
 const old=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer();
 assert.deepEqual([...old.subarray(0,4)],[0,173,243,255]);assert.notDeepEqual([...old.subarray(0,4)],[18,170,237,255]);
 const fixed=await exportPNG(bytes);assert.deepEqual([...(await sharp(fixed.bytes).raw().toBuffer()).subarray(0,4)],[18,170,237,255]);
});
for(const profile of ['srgb','p3'])for(const format of ['png','jpeg'])test(`embedded ${profile} ${format} still follows its declared profile`,async()=>{
 let s=sharp({create:{width:16,height:12,channels:3,background:'#88aa55'}}).withIccProfile(profile);const source=await s[format]().toBuffer();assert.equal((await sharp(source).metadata()).hasProfile,true);
 const reference=await sharp(source).autoOrient().withIccProfile('srgb',{attach:false}).toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer();
 const out=await exportPNG(source),actual=await sharp(out.bytes).ensureAlpha().raw().toBuffer();assert.deepEqual(actual,reference);for(const[i,v]of[136,170,85].entries())assert.ok(Math.abs(actual[i]-v)<=3);
});
test('8-bit partial transparency survives color conversion while fully hidden exported RGB is sanitized',async()=>{
 const raw=Buffer.from([18,170,237,128,230,50,35,255,244,220,200,0]);const source=await sharp(raw,{raw:{width:3,height:1,channels:4}}).png().toBuffer();
 const before=Buffer.from(source),out=await exportPNG(source),pixels=await sharp(out.bytes).ensureAlpha().raw().toBuffer();assert.deepEqual([...pixels],[18,170,237,128,230,50,35,255,0,0,0,0]);assert.deepEqual(source,before);
});

for(const space of ['cmyk','b-w','grey16'])test(`untagged ${space} control does not change the prior neutral conversion`,async()=>{
 let make=sharp({create:{width:12,height:8,channels:3,background:'#e63223'}}).toColourspace(space);const source=await make[space==='cmyk'?'jpeg':'png']().toBuffer();assert.equal((await sharp(source).metadata()).hasProfile,false);
 const prior=await sharp(source).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer();const out=await exportPNG(source),actual=await sharp(out.bytes).ensureAlpha().raw().toBuffer();assert.deepEqual(actual,prior);
});
