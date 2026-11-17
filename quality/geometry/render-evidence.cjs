'use strict';
// Private informational QA from already-reviewed public NASA material, not bundled app art.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),sharp=require('sharp'),G=require('../../src/geometry.cjs'),P=require('../../src/project-document.cjs'),Core=require('../../export-render-core.cjs'),{createExportRenderer}=require('../../export-renderer.cjs');
const base=path.resolve(__dirname,'../..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),raw=im=>sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}});
const label=(text,w=330,h=34)=>Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#172720"/><text x="10" y="23" font-family="sans-serif" font-size="14" fill="white">${text}</text></svg>`);
(async()=>{
 const f=path.join(base,'quality/manual-tools-qa/fixtures/05_mukai'),meta=JSON.parse(fs.readFileSync(f+'.json')),image={width:meta.width,height:meta.height,data:new Uint8ClampedArray(zlib.gunzipSync(fs.readFileSync(f+'.rgba.gz')))},sourceHash=hash(image.data),revision='geometry-public-fixture:0';
 const settings={...P.DEFAULT_SETTINGS,spots:[],localLayers:[],manualLiquify:[],manualRepair:[],exposure:3};
 const edits=Core.processPixels(image,settings,{landmarks:[],sourceRevision:revision}),crop={...G.defaults(),crop:{x:.22,y:.08,w:.6,h:.76}},turn={...crop,quarterTurns:1},flip={...turn,flipX:true};
 const cases=[{name:'Original / unchanged',out:image,recipe:null},{name:'Crop after +3 exposure',out:G.apply(edits,crop),recipe:crop},{name:'Same crop / clockwise90',out:G.apply(edits,turn),recipe:turn},{name:'Same crop / rotate + flip',out:G.apply(edits,flip),recipe:flip}];
 const panels=[],report=[];
 for(let i=0;i<cases.length;i++){const c=cases[i],png=await raw(c.out).png().toBuffer();panels.push({input:await raw(c.out).resize(330,440,{fit:'contain',background:'#101a15'}).png().toBuffer(),left:i*330,top:34},{input:label(c.name),left:i*330,top:0},{input:label(`${c.out.width} x ${c.out.height} px`),left:i*330,top:474});report.push({label:c.name,width:c.out.width,height:c.out.height,recipe:c.recipe,rgbaSha256:hash(c.out.data),pngSha256:hash(png)});}
 await sharp({create:{width:1320,height:508,channels:4,background:'#101a15'}}).composite(panels).jpeg({quality:88,chromaSubsampling:'4:2:0'}).toFile(path.join(__dirname,'portrait-geometry-contact.jpg'));
 const bytes=await raw(image).png().toBuffer(),sourceBytesHash=hash(bytes),service=createExportRenderer();let native;
 try{native=await service.render({requestId:'public-geometry-export',bytes,sourceRevision:revision,settings:{...settings,framing:flip},analysis:{landmarks:[],sourceRevision:revision},mode:'original',format:'png',quality:.95});}finally{service.dispose();}
 const nativePixels=await sharp(Buffer.from(native.bytes)).ensureAlpha().raw().toBuffer();if(!nativePixels.equals(Buffer.from(cases[3].out.data)))throw Error('Native final geometry pixels differ');
 if(hash(image.data)!==sourceHash||hash(bytes)!==sourceBytesHash)throw Error('Fixture changed');
 fs.writeFileSync(path.join(__dirname,'visual-evidence.json'),JSON.stringify({scope:'Actual authored shared geometry and native PNG export. Public NASA fixture, private informational QA only. Contact sheet is not a UI screenshot.',sourceCoreSha256:hash(fs.readFileSync(path.join(base,'src/geometry.cjs'))),sourceRgbaSha256:sourceHash,sourceUnchanged:true,sourceBytesUnchanged:true,cases:report,native:{width:native.width,height:native.height,processingWidth:native.processingWidth,processingHeight:native.processingHeight,scaled:native.scaled,framed:native.framed,encodedSha256:hash(native.bytes),byteExactToSharedCore:true}},null,2)+'\n');
 console.log(JSON.stringify({contact:path.join(__dirname,'portrait-geometry-contact.jpg'),nativeWidth:native.width,nativeHeight:native.height,pixelExact:true,sourceUnchanged:true}));
})();
