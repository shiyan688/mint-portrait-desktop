'use strict';
// Public NASA adult QA composites, actual previously recorded host-CPU detections.
// NativeCanvas is installed; no browser, Windows, new model or private photo involved.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),sharp=require('sharp');
const {Native,nativePath}=require('../text-qa/native-support.cjs');
const People=require('../../src/portrait-people.cjs'),Desktop=require('../../src/portrait-people-desktop.cjs'),Engine=require('../../src/portrait-engine.cjs');
const ROOT=process.env.MINT_MULTIFACE_QA_DIR||path.join(__dirname,'inputs'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function fixture(count=2){
 assert.ok(Native,'Installed NativeCanvas is required, never skipped');
 const bytes=new Uint8Array(fs.readFileSync(path.join(ROOT,`synthetic-${count}-adults-900.png`))),json=JSON.parse(fs.readFileSync(path.join(ROOT,`synthetic-${count}-adults-900.landmarks.json`),'utf8'));
 assert.equal(json.ok,true);assert.equal(json.faces.length,count);assert.equal(json.detector.modelSha256,People.DEFAULT_DETECTOR.modelSha256);
 const decoded=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const image={width:decoded.info.width,height:decoded.info.height,data:new Uint8ClampedArray(decoded.data)},canvas=Native.createCanvas(image.width,image.height),ctx=canvas.getContext('2d');
 const nativeImage=ctx.createImageData(image.width,image.height);nativeImage.data.set(image.data);ctx.putImageData(nativeImage,0,0);
 assert.equal(hash(ctx.getImageData(0,0,image.width,image.height).data),hash(image.data));
 const sourceRevision=`independent-${count}:source-0`,batch=People.createBatch({sourceRevision,batchId:`independent-${count}:batch-1`,detector:json.detector,detectionSize:json.detectionSize,landmarks:json.faces.map(f=>f.landmarks)});
 return {bytes,json,image,canvas,batch,sourceRevision,analysis:{sourceRevision,landmarks:json.faces.map(f=>f.landmarks),faceCount:count,originalSize:{width:image.width,height:image.height}}};
}
function activate(batch,phase,indices){const out=structuredClone(batch);for(const [i,f] of out.faces.entries())if(!indices||indices.includes(i)){if(phase==='beauty')Object.assign(f.beauty,{brighten:12+i*4,warmth:i%2?-14:15,underEye:10+i*3,lip:10+i*2,palette:['natural','peach','rose'][i%3]});else Object.assign(f.reshape,{eyes:14+i*5,nose:i%2?-15:15});}return out;}
function mergeIndependent(image,batch,phase){const expected=new Uint8ClampedArray(image.data),changed=[];for(const face of batch.faces){const controls=face[phase];if(!Object.entries(controls).some(([k,v])=>k!=='palette'&&v!==0)){changed.push(0);continue;}const direct=Engine[phase](image,controls,face.landmarks);let count=0;for(let i=0;i<expected.length;i+=4){if(image.data[i]===direct.data[i]&&image.data[i+1]===direct.data[i+1]&&image.data[i+2]===direct.data[i+2]&&image.data[i+3]===direct.data[i+3])continue;assert.equal(expected[i],image.data[i],'independent direct deltas overlap');assert.equal(expected[i+1],image.data[i+1]);assert.equal(expected[i+2],image.data[i+2]);assert.equal(expected[i+3],image.data[i+3]);expected.set(direct.data.subarray(i,i+4),i);count++;}changed.push(count);}return {data:expected,changed};}
function assertProtected(image,out,plan){let pixels=0;for(const face of plan.faces.filter(f=>!f.active)){const r=face.protectedBounds;for(let y=r.minY;y<=r.maxY;y++)for(let x=r.minX;x<=r.maxX;x++){const i=(y*image.width+x)*4;for(let c=0;c<4;c++)assert.equal(out.data[i+c],image.data[i+c],`inactive ${face.id} changed at ${x},${y}`);pixels++;}}return pixels;}
function png(image){const c=Native.createCanvas(image.width,image.height),ctx=c.getContext('2d'),p=ctx.createImageData(image.width,image.height);p.data.set(image.data);ctx.putImageData(p,0,0);return c.toBuffer('image/png');}
module.exports={fixture,activate,mergeIndependent,assertProtected,png,hash,People,Desktop,Engine,Native,nativePath,sharp,ROOT};
