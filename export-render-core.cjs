'use strict';
const People=require('./src/portrait-people-desktop.cjs'),Portrait=require('./src/portrait-engine.cjs'),Local=require('./src/local-adjustments.cjs'),Project=require('./src/project-document.cjs'),Manual=require('./src/manual-tools.cjs'),ManualPipeline=require('./src/manual-pipeline.cjs'),LightBalance=require('./src/light-balance.cjs'),Levels=require('./src/levels.cjs'),AdvancedTone=require('./src/advanced-tone.cjs'),Sharpness=require('./src/sharpness.cjs'),Geometry=require('./src/geometry.cjs'),Straighten=require('./src/straighten.cjs'),Perspective=require('./src/perspective.cjs'),Padding=require('./src/canvas-padding.cjs'),ImageLayers=require('./src/image-layers.cjs'),TextLayers=require('./src/text-layers.cjs'),PaintLayers=require('./src/paint-layers.cjs'),Redactions=require('./src/redaction-layers.cjs'),ExportSize=require('./src/export-size.cjs'),crypto=require('node:crypto');
const LIMITS=Object.freeze({sourceBytes:80*1024*1024,outputBytes:80*1024*1024,pixels:64000000,edge:16384,portraitPixels:16000000,workingEdge:4096,geometryBytes:512*1024*1024});
const PERSPECTIVE_FILTER='linear-light-premultiplied-alpha-mip-anisotropic-bilinear';
const PERSPECTIVE_RECEIPT_FIELDS=['version','recipe','inputWidth','inputHeight','outputWidth','outputHeight','kind','resampling'];
function perspectiveRecipeOf(settings){
 const d=Object.getOwnPropertyDescriptor(settings,'perspective');
 if(!d){check(!('perspective' in settings),'透视配方必须是自有数据字段。');return null;}
 check(d.enumerable&&Object.hasOwn(d,'value')&&d.value!==undefined,'透视配方必须完整提供或明确设为 null。');
 return d.value===null?null:Perspective.validate(d.value);
}
function perspectiveReceiptOf(plan){
 return Object.freeze({version:1,recipe:plan.recipe,inputWidth:plan.sourceSize.width,inputHeight:plan.sourceSize.height,
  outputWidth:plan.renderedSize.width,outputHeight:plan.renderedSize.height,kind:plan.kind,resampling:plan.kind==='resample'?PERSPECTIVE_FILTER:'none'});
}
function validatePerspectiveReceipt(value,expected){
 const r=record(value,PERSPECTIVE_RECEIPT_FIELDS,PERSPECTIVE_RECEIPT_FIELDS,'透视回执');
 check(r.version===1,'无效的透视回执版本。');
 const recipe=Perspective.validate(r.recipe);
 check(Perspective.isActive(recipe),'未启用透视时不允许透视回执。');
 for(const key of ['inputWidth','inputHeight','outputWidth','outputHeight'])check(Number.isSafeInteger(r[key])&&r[key]>0&&r[key]<=LIMITS.edge,'无效的透视阶段尺寸。');
 check(['identity','copy','resample'].includes(r.kind)&&r.resampling===(r.kind==='resample'?PERSPECTIVE_FILTER:'none'),'无效的透视采样回执。');
 if(expected)for(const key of PERSPECTIVE_RECEIPT_FIELDS)check(key==='recipe'?JSON.stringify(recipe)===JSON.stringify(expected.recipe):r[key]===expected[key],`透视回执字段不匹配：${key}`);
 return Object.freeze({...r,recipe});
}
const SHARPNESS_ALGORITHM='classical-coverage-normalized-luminance-unsharp-detail';
const TEXT_OVERLAY_FIELDS=['version','requestId','sourceRevision','sourceHash','recipeHash','mode','width','height','rgba'];
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
let imageAssetCodec;
function assetsCodec(){return imageAssetCodec ||= require('./src/image-assets.cjs').createCodec({overlay:require('./src/image-overlay.cjs')});}
function verifiedImageAssets(value){const codec=assetsCodec(),records=codec.validateTable(value);for(const a of records){const raw=codec.toRaw(a);check(a.id==='rgba-'+sha256(codec.identityBytes(raw)),'贴图内容与绑定哈希不一致。');}return records;}
const textLayers=settings=>Object.hasOwn(settings,'textLayers')?settings.textLayers:[];
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer=Object.getOwnPropertyDescriptor(typedPrototype,'buffer').get;
const typedLength=Object.getOwnPropertyDescriptor(typedPrototype,'length').get;
const typedOffset=Object.getOwnPropertyDescriptor(typedPrototype,'byteOffset').get;
const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,bufferResizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const FACE_KEYS=['smooth','brighten','warmth','underEye','redness','lip','blush','slim','eyes','nose','jaw'];
function check(ok,message){if(!ok)throw new Error(message);}
// libvips' PNG decoder does not expose APNG frame count: metadata.pages may be
// absent even for genuine multi-frame PNGs. Inspect validated chunks explicitly.
function record(value,fields,required,label){
 check(value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),`无效的 ${label} 对象。`);
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  const d=Object.getOwnPropertyDescriptor(value,key);
  check(typeof key==='string'&&fields.includes(key)&&d.enumerable&&Object.hasOwn(d,'value'),`无效或不安全的 ${label} 字段。`);out[key]=d.value;
 }
 for(const key of required)check(Object.hasOwn(out,key),`缺少 ${label} 字段：${key}`);
 return out;
}
function validateRasterOverlay(value,expected,copy=true,label='文字'){
 const r=record(value,TEXT_OVERLAY_FIELDS,TEXT_OVERLAY_FIELDS,label+'覆盖层');
 check(r.version===1,'无效的'+label+'覆盖层版本。');
 for(const key of ['requestId','sourceRevision'])check(typeof r[key]==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(r[key]),`无效的${label}覆盖层 ${key}。`);
 for(const key of ['sourceHash','recipeHash'])check(typeof r[key]==='string'&&/^[a-f0-9]{64}$/.test(r[key]),`无效的${label}覆盖层 ${key}。`);
 check(r.mode==='original'||r.mode==='working','无效的'+label+'覆盖层模式。');
 check(Number.isSafeInteger(r.width)&&Number.isSafeInteger(r.height)&&r.width>0&&r.height>0&&r.width<=TextLayers.LIMITS.maxEdge&&r.height<=TextLayers.LIMITS.maxEdge&&r.width*r.height<=TextLayers.LIMITS.maxPixels,label+'最终画布限 1600 万像素、单边 16384；不会自动缩小。');
 for(const key of Object.keys(expected))check(r[key]===expected[key],`${label}覆盖层 ${key} 不匹配或已过期。`);
 const valueBytes=r.rgba;
 check(valueBytes&&Object.getPrototypeOf(valueBytes)===Uint8Array.prototype,label+'覆盖层必须是普通 Uint8Array RGBA。');
 for(const key of ['length','buffer','byteLength','byteOffset'])check(!Object.hasOwn(valueBytes,key),label+'覆盖层包含不安全字节属性。');
 check(Object.getOwnPropertySymbols(valueBytes).length===0,label+'覆盖层包含不安全字节属性。');
 const buffer=typedBuffer.call(valueBytes),length=typedLength.call(valueBytes);
 check(buffer instanceof ArrayBuffer&&Object.getPrototypeOf(buffer)===ArrayBuffer.prototype,label+'覆盖层不允许共享或自定义缓冲区。');
 check(length===r.width*r.height*4,label+'覆盖层 RGBA 长度不匹配。');
 check((!bufferResizable||!bufferResizable.call(buffer))&&bufferLength.call(buffer)<=TextLayers.LIMITS.maxPixels*4,label+'覆盖层缓冲区必须固定且不超过64MB。');
 const view=new Uint8Array(buffer,typedOffset.call(valueBytes),length);
 return {...r,rgba:copy?new Uint8Array(view):view};
}
function isAnimatedPng(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let offset=8;offset<=bytes.length-12;){
  const length=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(type==='acTL'||type==='fcTL'||type==='fdAT')return true;
  if(type==='IEND')return false;
  offset+=length+12;
 }
 return false;
}
function imageSize(width,height){check(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=LIMITS.edge&&height<=LIMITS.edge&&width*height<=LIMITS.pixels,'原尺寸导出限 6400 万像素、单边 16384 像素；未缩小或覆盖原图。');return{width,height};}
function sizePlan(width,height,mode,settings,outputSize,context){
 const perspectiveRecipe=perspectiveRecipeOf(settings);
 imageSize(width,height);check(mode==='original'||mode==='working','请选择明确的导出尺寸模式。');
 // Validate supplied zero recipes too, but never apply the sharpening core's
 // stricter dimension cap to the legacy inactive 64MP export path. An active
 // source is capped before crop/final downsize. Explicit working mode keeps
 // its existing deliberate processing-size choice, never a silent reduction.
 const sharpnessRecipe=Sharpness.validate(Object.hasOwn(settings,'sharpness')?settings.sharpness:null);
 const scale=mode==='working'?Math.min(1,LIMITS.workingEdge/Math.max(width,height),Math.sqrt(LIMITS.portraitPixels/(width*height))):1;
 const output={width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
 if(output.width*output.height>LIMITS.portraitPixels&&mode==='working')output.height=Math.floor(LIMITS.portraitPixels/output.width);
 const sharpen=sharpnessRecipe?.amount>0?Sharpness.plan({width:output.width,height:output.height},sharpnessRecipe):null;
 const complex=FACE_KEYS.some(k=>settings[k]!==0)||(settings.spots?.length>0)||(settings.bgMode!=='original')||settings.learnedMatteId||settings.manualLiquify?.length||settings.manualRepair?.length||settings.localLayers?.some(l=>l.mask.kind==='selection');
 check(!complex||output.width*output.height<=LIMITS.portraitPixels,'当前人像修饰、手工工具、点修或背景处理限 1600 万像素。请关闭这些效果保留原尺寸，或明确选择工作尺寸导出；不会自动降采样。');
 if(settings.faceAdjustments!=null){
  const revision=context?.sourceRevision??Object.getOwnPropertyDescriptor(settings.faceAdjustments,'sourceRevision')?.value;
  People.validateCompatibility(settings,revision);
  for(const phase of ['beauty','reshape'])People.planSize(output.width,output.height,settings.faceAdjustments,{sourceRevision:revision,phase});
 }
 const framed = settings.framing != null ? Geometry.plan(output.width,output.height,settings.framing).outputSize : output;
 imageSize(framed.width,framed.height);
 const recipe=Straighten.validate(settings.straighten);
 const straight=recipe.angle!==0?Straighten.plan(framed.width,framed.height,recipe):null;
 const straightened=straight?straight.outputSize:framed;
 imageSize(straightened.width,straightened.height);
 const perspective=perspectiveRecipe&&Perspective.isActive(perspectiveRecipe)?Perspective.plan(straightened.width,straightened.height,perspectiveRecipe,{limits:{maxPixels:LIMITS.pixels,maxEdge:LIMITS.edge}}):null;
 const perspectived=perspective?perspective.renderedSize:straightened;
 imageSize(perspectived.width,perspectived.height);
 // Borders never influence the chosen processing size. Reject over-budget final
 // canvases rather than secretly downsampling the source to accommodate them.
 const padding = settings.canvasPadding != null ? Padding.plan(perspectived.width,perspectived.height,settings.canvasPadding,{maxPixels:LIMITS.pixels,maxEdge:LIMITS.edge}) : null;
 const final = padding ? padding.outputSize : perspectived;
 const imagePlan=ImageLayers.plan(final.width,final.height,settings.imageLayers||[],context?.imageAssets||[]);
 const activeText=TextLayers.isActive(textLayers(settings));
 check(!activeText||(final.width<=TextLayers.LIMITS.maxEdge&&final.height<=TextLayers.LIMITS.maxEdge&&final.width*final.height<=TextLayers.LIMITS.maxPixels),'文字最终画布限 1600 万像素、单边 16384；请减小留白或明确选择工作尺寸，不会自动缩小。');
 // Plan the actual final redaction raster before output downsizing. Selection
 // masks use the processing-source coordinates, not the immutable encoded size.
 // Non-selected redaction may follow a crop from a legitimate 64MP source.
 const paintPlan=settings.paintLayers!=null?PaintLayers.plan(final.width,final.height,settings.paintLayers,{sourceRevision:context?.sourceRevision??Object.getOwnPropertyDescriptor(settings.paintLayers,'sourceRevision')?.value,settings,sourceSize:output}):null;
 const redactionPlan=settings.redactions!=null?Redactions.plan(final.width,final.height,settings.redactions,{sourceRevision:context?.sourceRevision??Object.getOwnPropertyDescriptor(settings.redactions,'sourceRevision')?.value,settings,sourceSize:output}):null;
 const outputSizePlan=arguments.length>=5&&!(context&&outputSize===undefined)?ExportSize.plan(final.width,final.height,outputSize):null;
 const plan={...final,padded:final.width!==perspectived.width||final.height!==perspectived.height,processingWidth:output.width,processingHeight:output.height,originalWidth:width,originalHeight:height,scaled:output.width!==width||output.height!==height,framed:settings.framing!=null&&Geometry.isActive(settings.framing)};
 if(straight||perspective||sharpen||imagePlan.active){
  // Sum retained buffers conservatively: source + edited pre-frame RGBA, allocated framing,
  // straighten/table, padding, final overlay composites and independent layer
  // scratch. Encoded source/analysis/overlay backing copies enter via context.
  const retained=context?.retainedBytes??0;
  check(Number.isSafeInteger(retained)&&retained>=0,'无效的保留缓冲区预算。');
  const bytes=output.width*output.height*8+(settings.framing!=null?framed.width*framed.height*4:0)+(straight?.estimates.extraBytes||0)+(perspective?.estimates.extraBytes||0)+(sharpen?.maxWorkingBytes||0)+
   (padding?final.width*final.height*4:0)+
   (activeText?final.width*final.height*4:0)+(paintPlan?.active?final.width*final.height*4:0)+(paintPlan?.extraBytes||0)+(redactionPlan?.extraBytes||0)+(outputSizePlan?.resized?outputSizePlan.allocation.outputBytes:0)+imagePlan.cumulativeExtraBytes+imagePlan.retainedAssetStringBytes*3+retained;
  check(bytes<=LIMITS.geometryBytes,'图层/锐化/校正/透视的累计图像缓冲区超过 512 MiB；不会自动缩小。');
  if(straight)Object.assign(plan,{straightened:true,straightenRecipe:recipe,straightenedWidth:straightened.width,straightenedHeight:straightened.height});
  if(sharpen)Object.assign(plan,{sharpened:true,sharpnessRecipe});
  if(perspective)Object.assign(plan,{perspectiveReceipt:perspectiveReceiptOf(perspective)});
 }
 if(imagePlan.active)Object.assign(plan,{imageLayered:true,imageLayerKey:ImageLayers.canonicalRecipe(settings.imageLayers)});
 // Output sizing is deliberately last. It cannot relax any source, processing,
 // expanded-canvas or text budget above. Omission and explicit reset retain the
 // exact legacy plan shape; a long-edge request records all three dimensions.
 if(outputSizePlan&&outputSizePlan.recipe.mode!=='unchanged')return{...plan,...outputSizePlan.output,compositionWidth:final.width,compositionHeight:final.height,outputSizePlan};
 return plan;
}
function validateRequest(input){
 input=record(input,['requestId','bytes','sourceRevision','settings','analysis','mode','format','quality','textOverlay','paintOverlay','outputSize','imageAssets'],['requestId','bytes','sourceRevision','settings','mode','format','quality'],'导出请求');
 check(typeof input.requestId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(input.requestId),'无效的导出任务标识。');
 check(input.bytes instanceof Uint8Array&&(Object.getPrototypeOf(input.bytes)===Uint8Array.prototype||(Buffer.isBuffer(input.bytes)&&Object.getPrototypeOf(input.bytes)===Buffer.prototype)),'原图必须是普通字节缓冲区。');
 for(const key of ['length','buffer','byteLength','byteOffset'])check(!Object.hasOwn(input.bytes,key),'原图包含不安全字节属性。');
 check(Object.getOwnPropertySymbols(input.bytes).length===0,'原图包含不安全字节属性。');
 const sourceBuffer=typedBuffer.call(input.bytes),sourceLength=typedLength.call(input.bytes);
 check(sourceBuffer instanceof ArrayBuffer&&Object.getPrototypeOf(sourceBuffer)===ArrayBuffer.prototype&&sourceLength>0&&sourceLength<=LIMITS.sourceBytes,'原图文件为空、共享缓冲区或超过 80 MB。');
 check((!bufferResizable||!bufferResizable.call(sourceBuffer))&&bufferLength.call(sourceBuffer)<=LIMITS.sourceBytes,'原图缓冲区必须固定且不超过80MB。');
 check(['original','working'].includes(input.mode)&&['png','jpeg'].includes(input.format),'无效的导出格式或尺寸。');
 check(typeof input.quality==='number'&&Number.isFinite(input.quality)&&input.quality>=.1&&input.quality<=1,'无效的 JPEG 质量。');
 // Inspect a read-only view first. No source clone, pixel allocation or worker
 // creation is allowed until active source and accumulated memory preflight pass.
 const sourceView=new Uint8Array(sourceBuffer,typedOffset.call(input.bytes),sourceLength);const signature=Buffer.from(sourceView.buffer,sourceView.byteOffset,Math.min(12,sourceView.length));
 const mime=signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':signature[0]===255&&signature[1]===216?'image/jpeg':signature.toString('ascii',0,4)==='RIFF'&&signature.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 check(mime,'仅支持 JPEG / PNG / WebP 原图。');const source=Project.inspectImage(sourceView,mime);imageSize(source.width,source.height);
 check(mime!=='image/png'||!isAnimatedPng(sourceView),'此版本不支持动画 PNG/APNG 导出；不会只取第一帧。');
 const settings=Project.validateSettings(input.settings,{width:source.width,height:source.height},input.sourceRevision);
 const suppliedAssets=Object.hasOwn(input,'imageAssets')?input.imageAssets:[];
 const imageAssets=ImageLayers.validateAssets(suppliedAssets);
 const assetRefs=ImageLayers.referencedAssetIds(settings.imageLayers||[]);
 check(imageAssets.length===assetRefs.length&&imageAssets.every(a=>assetRefs.includes(a.id)),'贴图资产必须与本照片的图层引用精确对应。');
 const hasOutputSize=Object.hasOwn(input,'outputSize');
 const outputSize=hasOutputSize?ExportSize.validate(input.outputSize):undefined;
 const maskData=Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(input.analysis||{},'mask')?.value||{},'data')?.value;
 const retainedBuffers=new Set([sourceBuffer]);
 // Charge the eventual owned compressed-source copy before creating it.
 let retainedBytes=bufferLength.call(sourceBuffer)+sourceLength;
 for(const value of [Object.getOwnPropertyDescriptor(input.textOverlay||{},'rgba')?.value,Object.getOwnPropertyDescriptor(input.paintOverlay||{},'rgba')?.value,maskData])if(value&&ArrayBuffer.isView(value)){
  const buffer=typedBuffer.call(value);
  check(buffer instanceof ArrayBuffer&&Object.getPrototypeOf(buffer)===ArrayBuffer.prototype,'无效的保留缓冲区。');
  if(!retainedBuffers.has(buffer)){retainedBuffers.add(buffer);retainedBytes+=bufferLength.call(buffer);}
  // Owned overlay copies are transferred; analysis has both its owned main
  // copy and its worker structured-clone copy live beside the caller plane.
  retainedBytes+=Object.getOwnPropertyDescriptor(typedPrototype,'byteLength').get.call(value)*(value===maskData?2:1);
 }
 const plan=sizePlan(source.width,source.height,input.mode,settings,outputSize,{sourceRevision:input.sourceRevision,retainedBytes,imageAssets});
 if(imageAssets.length)verifiedImageAssets(imageAssets);
 const bytes=new Uint8Array(sourceView);
 const activeText=TextLayers.isActive(settings.textLayers),hasOverlay=Object.hasOwn(input,'textOverlay');
 check(activeText===hasOverlay,activeText?'活动文字缺少覆盖层；已停止导出。':'无活动文字时不允许额外覆盖层。');
 // Hash the owned encoded source bytes in main. Renderer hashes are assertions,
 // not trusted source identity or proof that a raster contains particular glyphs.
 const textOverlay=activeText?validateRasterOverlay(input.textOverlay,{requestId:input.requestId,sourceRevision:input.sourceRevision,sourceHash:sha256(bytes),recipeHash:sha256(TextLayers.canonicalRecipe(settings.textLayers)),mode:input.mode,width:plan.compositionWidth??plan.width,height:plan.compositionHeight??plan.height}):null;
 const activePaint=PaintLayers.isActive(settings.paintLayers),hasPaintOverlay=Object.hasOwn(input,'paintOverlay');
 check(activePaint===hasPaintOverlay,activePaint?'活动绘画缺少覆盖层；已停止导出。':'无活动绘画时不允许额外绘画覆盖层。');
 const paintOverlay=activePaint?validateRasterOverlay(input.paintOverlay,{requestId:input.requestId,sourceRevision:input.sourceRevision,sourceHash:sha256(bytes),recipeHash:sha256(PaintLayers.canonicalRecipe(settings.paintLayers)),mode:input.mode,width:plan.compositionWidth??plan.width,height:plan.compositionHeight??plan.height},true,'绘画'):null;
 const raw=input.analysis||{},analysis={landmarks:[],faceCount:0,sourceRevision:input.sourceRevision,originalSize:{width:source.width,height:source.height}};
 if(raw.sourceRevision!==undefined)check(raw.sourceRevision===input.sourceRevision,'分析结果不属于此原图版本。');
 if(raw.landmarks!==undefined){check(Array.isArray(raw.landmarks)&&raw.landmarks.length<=5,'人脸数量无效。');analysis.landmarks=raw.landmarks.map(face=>{check(Array.isArray(face)&&face.length>=468&&face.length<=478,'无效的人脸关键点。');return face.map(p=>{check(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=3&&Math.abs(p.y)<=3,'无效的人脸坐标。');return{x:p.x,y:p.y,z:Number.isFinite(p.z)?p.z:0};});});analysis.faceCount=analysis.landmarks.length;}
 if(FACE_KEYS.some(k=>settings[k]!==0))check(analysis.faceCount>0,'未检测到人脸，所选人像效果不能可靠导出。请关闭这些效果或换片；不会静默跳过。');
 if(settings.bgMode!=='original'){
  const mask=raw.mask;check(mask&&Number.isSafeInteger(mask.width)&&Number.isSafeInteger(mask.height)&&mask.width>0&&mask.height>0&&mask.width*mask.height<=LIMITS.portraitPixels,'缺少有效人物蒙版，已停止导出。');
  check((mask.data instanceof Float32Array||mask.data instanceof Uint8Array)&&mask.data.buffer instanceof ArrayBuffer&&mask.data.length===mask.width*mask.height,'蒙版数据长度无效。');
  const max=mask.data instanceof Float32Array?1:255;for(const n of mask.data)check(Number.isFinite(n)&&n>=0&&n<=max,'蒙版包含无效值。');
  analysis.mask={width:mask.width,height:mask.height,data:new mask.data.constructor(mask.data),maxValue:max};
  if(settings.learnedMatteId){
   const c=raw.learnedMatte,p=c?.provenance;check(c?.cacheId===settings.learnedMatteId&&c.sourceRevision===input.sourceRevision&&c.originalSize?.width===source.width&&c.originalSize?.height===source.height&&raw.mask.learnedMatteId===settings.learnedMatteId&&mask.width===plan.processingWidth&&mask.height===plan.processingHeight&&mask.data instanceof Float32Array&&p?.kind==='model'&&p.task==='matting'&&typeof p.modelId==='string'&&/^[a-f0-9]{64}$/.test(p.weightsSha256),'学习型蒙版缺失或原图版本不符；不会回退。');
   analysis.learnedMatte={cacheId:c.cacheId,sourceRevision:c.sourceRevision,originalSize:{width:source.width,height:source.height},provenance:{kind:'model',task:'matting',modelId:p.modelId,weightsSha256:p.weightsSha256}};
  }
 }
 return{requestId:input.requestId,sourceRevision:input.sourceRevision,bytes,settings,analysis,...(imageAssets.length?{imageAssets}:{}),mode:input.mode,format:input.format,quality:input.quality,plan,...(textOverlay?{textOverlay}:{}),...(paintOverlay?{paintOverlay}:{}),...(hasOutputSize?{outputSize:ExportSize.validate(input.outputSize)}:{})};
}
function processPixels(image,settings,analysis,textOverlay,options={}){
 options=record(options,['shouldCancel','paintOverlay','retainedBytes','imageAssets'],[],'像素处理选项');
 if(options.shouldCancel!==undefined)check(typeof options.shouldCancel==='function','Invalid cancellation callback.');
 const perspectiveRecipe=perspectiveRecipeOf(settings),perspectiveActive=!!(perspectiveRecipe&&Perspective.isActive(perspectiveRecipe));
 const imageAssets=options.imageAssets?verifiedImageAssets(options.imageAssets):[];
 const redactionContext={sourceRevision:analysis.sourceRevision,settings,sourceSize:{width:image.width,height:image.height},...(options.shouldCancel?{shouldCancel:options.shouldCancel}:{})};
 // Direct pure replay has the same preflight as native export, even without text.
 const sharpnessRecipe=Sharpness.validate(Object.hasOwn(settings,'sharpness')?settings.sharpness:null);
 if(perspectiveActive||Straighten.isActive(settings.straighten)||sharpnessRecipe?.amount>0||ImageLayers.isActive(settings.imageLayers||[])){
  const seen=new Set();let retained=options.retainedBytes??0;
  check(Number.isSafeInteger(retained)&&retained>=0,'无效的保留缓冲区预算。');
  for(const value of [image.data,analysis.mask?.data,textOverlay?.rgba,options.paintOverlay?.rgba])if(value&&ArrayBuffer.isView(value)){
   const buffer=typedBuffer.call(value);if(!seen.has(buffer)){seen.add(buffer);retained+=bufferLength.call(buffer);}
  }
  // Base planning already charges original plus edited processing planes. Count any extra
  // retained backing storage instead, including small views of large buffers.
  retained-=image.width*image.height*4;
  sizePlan(image.width,image.height,'original',settings,undefined,{sourceRevision:analysis.sourceRevision,retainedBytes:retained,imageAssets});
 }
 if(settings.paintLayers!=null){
  PaintLayers.validate(settings.paintLayers,redactionContext);
  sizePlan(image.width,image.height,'original',settings,undefined,{sourceRevision:analysis.sourceRevision,imageAssets});
 }
 if(settings.redactions!=null){
  Redactions.validate(settings.redactions,redactionContext);
  sizePlan(image.width,image.height,'original',settings,undefined,{sourceRevision:analysis.sourceRevision,imageAssets});
 }
 const layers=textLayers(settings),activeText=TextLayers.isActive(layers);
 check(activeText?textOverlay!==undefined:textOverlay===undefined,activeText?'活动文字缺少覆盖层；已停止导出。':'无活动文字时不允许额外覆盖层。');
 let validatedText=null;
 if(activeText){
  const planned=sizePlan(image.width,image.height,'original',settings,undefined,{sourceRevision:analysis.sourceRevision,imageAssets});
  validatedText=validateRasterOverlay(textOverlay,{sourceRevision:analysis.sourceRevision,recipeHash:sha256(TextLayers.canonicalRecipe(layers)),width:planned.width,height:planned.height},false);
 }
 const activePaint=PaintLayers.isActive(settings.paintLayers??null),paintOverlay=options.paintOverlay;
 check(activePaint?paintOverlay!==undefined:paintOverlay===undefined,activePaint?'活动绘画缺少覆盖层；已停止导出。':'无活动绘画时不允许额外绘画覆盖层。');
 let validatedPaint=null;
 if(activePaint){
  const planned=sizePlan(image.width,image.height,'original',settings,undefined,{sourceRevision:analysis.sourceRevision,imageAssets});
  validatedPaint=validateRasterOverlay(paintOverlay,{sourceRevision:analysis.sourceRevision,recipeHash:sha256(PaintLayers.canonicalRecipe(settings.paintLayers)),width:planned.width,height:planned.height},false,'绘画');
 }
 if(options.shouldCancel?.()){const error=new Error('Image processing cancelled');error.name='AbortError';throw error;}
 ManualPipeline.assertCompatible(settings);
 const peopleContext={sourceRevision:analysis.sourceRevision,...(options.shouldCancel?{shouldCancel:options.shouldCancel}:{})};
 if(settings.faceAdjustments!=null){People.validateCompatibility(settings,analysis.sourceRevision);for(const phase of ['beauty','reshape'])People.planSize(image.width,image.height,settings.faceAdjustments,{...peopleContext,phase});}
 let out=image;
 if(settings.spots.length)out=Portrait.heal(out,{spots:settings.spots,strength:.86});
 const faces=analysis.landmarks;
 if(faces.length&&['smooth','brighten','warmth','underEye','redness','lip','blush'].some(k=>settings[k]))out=Portrait.beauty(out,settings,faces);
 if(settings.faceAdjustments!=null)out=People.applyBeauty({width:out.width,height:out.height,data:out.data},settings.faceAdjustments,peopleContext);
 out=Local.tone(out,settings);
 if(settings.lightBalance!=null)out=LightBalance.apply(out,settings.lightBalance);
 if(settings.levels!=null)out=Levels.apply(out,settings.levels);
 if(settings.advancedTone!=null)out=AdvancedTone.apply(out,settings.advancedTone);
 if(settings.localLayers.length)out=Local.apply(out,settings.localLayers,analysis);
 if(settings.manualLiquify?.length||settings.manualRepair?.length)out=ManualPipeline.apply(out,settings,{sourceRevision:analysis.sourceRevision,imageAssets});
 if(settings.bgMode!=='original')out=Portrait.background(out,{mode:settings.bgMode,blur:settings.bgBlur,color:settings.bgColor,feather:settings.learnedMatteId?0:settings.bgFeather,continuousAlpha:!!settings.learnedMatteId,mask:analysis.mask});
 if(['slim','eyes','nose','jaw'].some(k=>settings[k]))for(const face of faces)out=Portrait.reshape(out,settings,face);
 if(settings.faceAdjustments!=null)out=People.applyReshape({width:out.width,height:out.height,data:out.data},settings.faceAdjustments,peopleContext);
 // Sharpen source-space edits only, never later padding, text or paint.
 // Strict shared records exclude transient manual-tool diagnostics.
 if(sharpnessRecipe?.amount>0)out=Sharpness.apply({width:out.width,height:out.height,data:out.data},sharpnessRecipe,options.shouldCancel?{shouldCancel:options.shouldCancel}:undefined);
 // Liquify may return transient diagnostics. The framing core takes only pixels,
 // not tool metadata; retain its strict record validation. No raster copy is needed.
 if(settings.framing!=null)out=Geometry.apply({width:out.width,height:out.height,data:out.data},settings.framing);
 if(Straighten.isActive(settings.straighten))out=Straighten.apply({width:out.width,height:out.height,data:out.data},settings.straighten,options.shouldCancel?{shouldCancel:options.shouldCancel}:undefined);
 if(perspectiveActive)out=Perspective.apply({width:out.width,height:out.height,data:out.data},perspectiveRecipe,{limits:{maxPixels:LIMITS.pixels,maxEdge:LIMITS.edge},...(options.shouldCancel?{shouldCancel:options.shouldCancel}:{})});
 // Expansion follows all image edits; text is composited afterwards. Keep diagnostics outside this core's exact raster record,
 // including when framing is disabled and manual liquify produced diagnostics.
 if(settings.canvasPadding!=null)out=Padding.apply({width:out.width,height:out.height,data:out.data},settings.canvasPadding,{maxPixels:LIMITS.pixels,maxEdge:LIMITS.edge});
 if(settings.imageLayers?.length)out=ImageLayers.apply({width:out.width,height:out.height,data:out.data},settings.imageLayers,imageAssets,options.shouldCancel?{shouldCancel:options.shouldCancel}:undefined);
 if(validatedText)out=TextLayers.composite({width:out.width,height:out.height,data:out.data},{width:validatedText.width,height:validatedText.height,rgba:validatedText.rgba});
 if(validatedPaint)out=TextLayers.composite({width:out.width,height:out.height,data:out.data},{width:validatedPaint.width,height:validatedPaint.height,rgba:validatedPaint.rgba},options.shouldCancel?{shouldCancel:options.shouldCancel}:undefined);
 // No later editing stage can expose pixels underneath the final-canvas cover.
 // Strip transient diagnostics and Buffer subclasses without mutating their bytes.
 if(settings.redactions!=null)out=Redactions.apply({width:out.width,height:out.height,data:new Uint8ClampedArray(out.data.buffer,out.data.byteOffset,out.data.byteLength)},settings.redactions,redactionContext);
 if(options.shouldCancel?.()){const error=new Error('Image processing cancelled');error.name='AbortError';throw error;}
 return out;
}
function resamplingDetails(plan){
 const stages=[];
 if(plan.scaled)stages.push('explicit-working-size-lanczos3');
 if(plan.straightened&&plan.straightenRecipe.angle%90!==0)stages.push('straighten-linear-light-premultiplied-alpha-bilinear');
 if(plan.perspectiveReceipt?.kind==='resample')stages.push('perspective-'+PERSPECTIVE_FILTER);
 if(plan.outputSizePlan?.resized)stages.push(plan.scaled?'final-output-lanczos3':'explicit-final-output-lanczos3');
 return {resampling:stages.length?stages.join('+'):'none',...(plan.perspectiveReceipt?{perspective:plan.perspectiveReceipt.kind==='resample'?PERSPECTIVE_FILTER:'exact-byte-copy',perspectiveReceipt:plan.perspectiveReceipt}:{}),...(plan.imageLayered?{imageOverlay:'premultiplied-srgb-mip-bilinear-edge4x4',imageLayerKey:plan.imageLayerKey}:{}),...(plan.straightened?{straighten:plan.straightenRecipe.angle%90===0?'exact-quarter-turn-byte-copy':'linear-light-premultiplied-alpha-bilinear',straightenRecipe:plan.straightenRecipe}:{}),...(plan.sharpened?{sharpness:SHARPNESS_ALGORITHM,sharpnessRecipe:plan.sharpnessRecipe}:{})};
}
module.exports={PERSPECTIVE_FILTER,perspectiveRecipeOf,perspectiveReceiptOf,validatePerspectiveReceipt,LIMITS,SHARPNESS_ALGORITHM,FACE_KEYS,imageSize,sizePlan,validateRequest,processPixels,resamplingDetails};
