'use strict';
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 try{
  const sharp=require('sharp'),core=require('./export-render-core.cjs');sharp.cache(false);sharp.concurrency(1);
  const r=workerData;const source=Buffer.from(r.bytes.buffer,r.bytes.byteOffset,r.bytes.byteLength);
  // Recheck immutable encoded-source dimensions and every geometry stage before
  // any decoder RGBA allocation. Tiny perspective/final outputs cannot rescue
  // an oversized source or upstream expanded plane. Plans are recomputed locally.
  {
   const Project=require('./src/project-document.cjs'),mime=source[0]===137?'image/png':source[0]===255?'image/jpeg':'image/webp';
   const sourceSize=Project.inspectImage(source,mime),seen=new Set();let retainedBytes=0;
   for(const value of [r.bytes,r.analysis?.mask?.data,r.textOverlay?.rgba,r.paintOverlay?.rgba])if(value&&ArrayBuffer.isView(value)&&!seen.has(value.buffer)){seen.add(value.buffer);retainedBytes+=value.buffer.byteLength;}
   const planned=core.sizePlan(sourceSize.width,sourceSize.height,r.mode,r.settings,r.outputSize,{sourceRevision:r.sourceRevision,retainedBytes,imageAssets:r.imageAssets||[]});
   if(!require('node:util').isDeepStrictEqual(planned,r.plan))throw new Error('导出几何计划与原图或配方不匹配。');
  }
  const decoder=sharp(source,{limitInputPixels:core.LIMITS.pixels,failOn:'error',animated:false});
  const meta=await decoder.metadata();
  if((meta.pages||1)!==1)throw new Error('此版本不支持多帧图片导出；不会只取第一帧。');
  if(!['jpeg','png','webp'].includes(meta.format))throw new Error('仅支持 JPEG / PNG / WebP 原图。');
  // Only transform an actual embedded profile. Sharp 0.35.5's forced ICC
  // conversion for untagged rgb16 PNG changes chromatic RGB (e.g. 18,170,237
  // becomes 0,173,243). Untagged RGB uses the decoder's standard RGB interpretation;
  // no missing gamma/profile is inferred and the source bytes are never rewritten.
  let image=decoder.autoOrient();
  if(meta.hasProfile)image=image.withIccProfile('srgb',{attach:false});
  image=image.toColourspace('srgb').ensureAlpha();
  if(r.plan.scaled)image=image.resize(r.plan.processingWidth,r.plan.processingHeight,{fit:'fill',kernel:'lanczos3'});
  const decoded=await image.raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
  if(decoded.info.width!==r.plan.processingWidth||decoded.info.height!==r.plan.processingHeight||decoded.info.channels!==4)throw new Error('原图尺寸或颜色解码结果不一致，已停止。');
  let pixels=core.processPixels({width:decoded.info.width,height:decoded.info.height,data:new Uint8ClampedArray(decoded.data.buffer,decoded.data.byteOffset,decoded.data.byteLength)},r.settings,r.analysis,r.textOverlay,{...(r.paintOverlay?{paintOverlay:r.paintOverlay}:{}),retainedBytes:r.bytes.buffer.byteLength,...(r.imageAssets?{imageAssets:r.imageAssets}:{})});
  if(pixels.width!==(r.plan.compositionWidth??r.plan.width)||pixels.height!==(r.plan.compositionHeight??r.plan.height))throw new Error('构图结果尺寸与导出计划不一致。');
  // Separate raw pipeline: Sharp permits only one resize per pipeline, and all
  // edits/padding/text must be complete before this explicit final-file stage.
  // Input is straight RGBA; Sharp 0.35.5 premultiplies for resize internally and
  // unpremultiplies before the returned uchar RGBA. Never rerasterize text here.
  if(r.plan.outputSizePlan?.resized){
   const resized=await sharp(Buffer.from(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength),{raw:{width:pixels.width,height:pixels.height,channels:4,premultiplied:false}})
    .resize(r.plan.width,r.plan.height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
   if(resized.info.width!==r.plan.width||resized.info.height!==r.plan.height||resized.info.channels!==4)throw new Error('最终缩小尺寸或颜色结果与导出计划不一致。');
   pixels={width:resized.info.width,height:resized.info.height,data:resized.data};
  }
  // Export privacy: hidden RGB is removed in the output only, never in originals.
  for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i+3]===0)pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=0;
  let encoder=sharp(Buffer.from(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength),{raw:{width:pixels.width,height:pixels.height,channels:4}}).withIccProfile('srgb');
  encoder=r.format==='jpeg'?encoder.flatten({background:'#ffffff'}).jpeg({quality:Math.round(r.quality*100),chromaSubsampling:'4:4:4'}):encoder.png({compressionLevel:6});
  const result=await encoder.toBuffer();if(result.length>core.LIMITS.outputBytes)throw new Error('输出文件超过 80 MB，请选择 JPEG 或较小工作尺寸；未写出不完整文件。');
  const bytes=new Uint8Array(result);
  parentPort.postMessage({ok:true,bytes,...r.plan,details:{codec:`sharp-${sharp.versions.sharp}`,color:'8-bit sRGB',embeddedProfile:'sRGB',sourceExifPreserved:false,sourceBytesUnchanged:true,...core.resamplingDetails(r.plan),framing:r.plan.framed?'integer-crop-quarter-turn-flip':'none',retouch:'classical-explicit-not-SOTA',localLayers:r.settings.localLayers.length,paintLayers:r.settings.paintLayers?.layers.filter(layer=>layer.enabled&&layer.recipe.strokes.some(stroke=>stroke.mode==='paint'&&stroke.opacity>0)).length||0,textLayers:r.settings.textLayers.filter(layer=>layer.enabled&&layer.recipe.text.length>0&&layer.recipe.opacity>0).length}},[bytes.buffer]);
 }catch(e){parentPort.postMessage({ok:false,error:e.message||String(e)});}
})();
