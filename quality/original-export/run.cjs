'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {createExportRenderer}=require('../../export-renderer.cjs'),P=require('../../src/project-document.cjs'),Local=require('../../src/local-adjustments.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const input=process.argv[2];if(!input)throw new Error('Provide an already-reviewed public QA image path.');
 const source=await fs.readFile(input),originalHash=hash(source),revision='public-qa:source-0';
 const settings={...P.DEFAULT_SETTINGS,spots:[],localLayers:[{id:'manual-exposure',name:'Manual local exposure',enabled:true,opacity:.8,sourceRevision:revision,adjustments:{exposure:14,contrast:0,saturation:0,temperature:0},mask:{kind:'radial',cx:.48,cy:.25,rx:.15,ry:.14,feather:.9}}]};
 const service=createExportRenderer(),start=performance.now();
 let result;try{result=await service.render({requestId:'fullres-public-qa',bytes:source,sourceRevision:revision,settings,analysis:{sourceRevision:revision,landmarks:[]},mode:'original',format:'png',quality:.95});}finally{service.dispose();}
 const seconds=(performance.now()-start)/1000;await fs.writeFile(path.join(__dirname,'edited-original-size.png'),result.bytes);
 const decoded=await sharp(source).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const output=await sharp(result.bytes).raw().toBuffer();let changed=0,outsideDifferent=0,alphaDifferent=0;
 for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){
  const i=(y*result.width+x)*4,w=Local.weight(settings.localLayers[0].mask,(x+.5)/result.width,(y+.5)/result.height);let different=false;
  for(let c=0;c<3;c++)if(decoded.data[i+c]!==output[i+c])different=true;
  if(different){changed++;if(w===0)outsideDifferent++;}if(decoded.data[i+3]!==output[i+3])alphaDifferent++;
 }
 if(outsideDifferent||alphaDifferent)throw new Error(`Preservation regression ${outsideDifferent}/${alphaDifferent}`);
 const tileWidth=432,tileHeight=Math.round(result.height/result.width*tileWidth),header=68;
 const first=await sharp(source).autoOrient().resize(tileWidth,tileHeight).png().toBuffer(),second=await sharp(result.bytes).resize(tileWidth,tileHeight).png().toBuffer();
 const label=Buffer.from(`<svg width="${tileWidth*2}" height="${header}"><rect width="100%" height="100%" fill="#eff3ef"/><g font-family="sans-serif" font-size="17" fill="#173c30"><text x="12" y="25">PUBLIC NASA SOURCE</text><text x="${tileWidth+12}" y="25">NATIVE ORIGINAL-SIZE EXPORT</text><text x="12" y="51">${result.width} x ${result.height}, immutable source</text><text x="${tileWidth+12}" y="51">Manual soft local exposure, not AI retouch</text></g></svg>`);
 await sharp({create:{width:tileWidth*2,height:tileHeight+header,channels:3,background:'#eff3ef'}}).composite([{input:label,left:0,top:0},{input:first,left:0,top:header},{input:second,left:tileWidth,top:header}]).jpeg({quality:92}).toFile(path.join(__dirname,'public-fullres-comparison.jpg'));
 const report={date:new Date().toISOString(),inputBasename:path.basename(input),sourceSha256:originalHash,sourceFileUnchanged:hash(await fs.readFile(input))===originalHash,inputBytes:source.length,width:result.width,height:result.height,outputBytes:result.bytes.length,outputSha256:hash(result.bytes),outputScaled:result.scaled,seconds,changedPixels:changed,outsideMaskChangedPixels:outsideDifferent,alphaChangedPixels:alphaDifferent,details:result.details,scope:'Private informational public-photo QA only, not marketing, model training, SOTA or beauty acceptance. Original picture credit and rights: NASA/JSC, https://www.nasa.gov/nasa-brand-center/images-and-media/.',windowsExecuted:false,browserExecuted:false,cudaExecuted:false};
 await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})();
