/* Local deterministic pixel worker. No DOM, network requests or model synthesis. */
'use strict';
importScripts('./portrait-engine.cjs');
importScripts('./portrait-people.cjs', './portrait-people-desktop.cjs');
importScripts('./local-adjustments.cjs');
importScripts('./light-balance.cjs');
importScripts('./levels.cjs');
importScripts('./advanced-tone.cjs');
importScripts('./sharpness.cjs');
importScripts('./geometry.cjs');
importScripts('./straighten.cjs');
importScripts('./perspective.cjs');
importScripts('./canvas-padding.cjs');
importScripts('./image-overlay.cjs','./image-layers.cjs');
importScripts('./manual-tools.cjs');
importScripts('./manual-pipeline.cjs');
importScripts('./redact-core.cjs');
importScripts('./redaction-layers.cjs');

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = (value, low, high) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, low, high) : 0;


self.onmessage = ({ data: input }) => {
  try {
    const { width, height, settings: s, analysis } = input;
    if(s.textLayers?.length)throw new Error('文字栅格不能在纯像素工作线程中被静默跳过。');
    if(s.paintLayers!=null)throw new Error('绘画栅格不能在纯像素工作线程中被静默跳过。');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16777216 || input.buffer.byteLength !== width * height * 4) throw new RangeError('无效的图像数据。');
    // Plan every geometry stage before any source-space raster work. The
    // desktop cap is stricter than the shared core's outer 64-Mi-pixel ceiling.
    const cap = size => { if(size.width>16384||size.height>16384||size.width*size.height>16777216)throw new RangeError('校正后画布超过预览像素预算；不会自动缩小。'); return size; };
    cap({width,height});
    const perspectiveField=Object.getOwnPropertyDescriptor(s,'perspective');
    if(perspectiveField&&(!perspectiveField.enumerable||!Object.hasOwn(perspectiveField,'value')||perspectiveField.value===undefined)||!perspectiveField&&'perspective' in s)throw new TypeError('透视配方必须完整提供或明确设为 null。');
    const perspectiveRecipe=perspectiveField&&perspectiveField.value!==null?MintPerspective.validate(perspectiveField.value):null;
    const sharpnessRecipe=MintSharpness.validate(Object.hasOwn(s,'sharpness')?s.sharpness:null);
    const sharpnessPlan=sharpnessRecipe?.amount>0?MintSharpness.plan({width,height},sharpnessRecipe):null;
    const framed = cap(s.framing != null ? MintGeometry.plan(width,height,s.framing).outputSize : {width,height});
    const recipe = MintStraighten.validate(s.straighten);
    const straight = recipe.angle!==0 ? MintStraighten.plan(framed.width,framed.height,recipe) : null;
    const straightened = cap(straight ? straight.outputSize : framed);
    const perspective=perspectiveRecipe&&MintPerspective.isActive(perspectiveRecipe)?MintPerspective.plan(straightened.width,straightened.height,perspectiveRecipe,{limits:{maxPixels:16777216,maxEdge:16384}}):null;
    const perspectived=cap(perspective?perspective.renderedSize:straightened);
    const perspectiveReceipt=perspective?{version:1,recipe:perspective.recipe,inputWidth:straightened.width,inputHeight:straightened.height,outputWidth:perspectived.width,outputHeight:perspectived.height,kind:perspective.kind,resampling:perspective.kind==='resample'?'linear-light-premultiplied-alpha-mip-anisotropic-bilinear':'none'}:null;
    const padding = s.canvasPadding != null ? MintCanvasPadding.plan(perspectived.width,perspectived.height,s.canvasPadding,{maxPixels:16777216,maxEdge:16384}) : null;
    const final = padding ? padding.outputSize : perspectived;
    const imagePlan=MintImageLayers.plan(final.width,final.height,s.imageLayers||[],input.imageAssets||[]);
    const redactionContext = {sourceRevision:analysis?.sourceRevision,settings:s,sourceSize:{width,height}};
    const redactionPlan = s.redactions != null ? MintRedactionLayers.plan(final.width,final.height,s.redactions,redactionContext) : null;
    if(straight||perspective||sharpnessPlan||imagePlan.active){
      let retained=input.retainedBytes??0;
      if(!Number.isSafeInteger(retained)||retained<0)throw new RangeError('无效的保留缓冲区预算。');
      if(analysis?.mask?.data){const mask=analysis.mask.data;if(!ArrayBuffer.isView(mask)||!(mask.buffer instanceof ArrayBuffer))throw new Error('无效蒙版缓冲区。');retained+=mask.buffer.byteLength;}
      const total=input.buffer.byteLength+width*height*4+(s.framing!=null?framed.width*framed.height*4:0)+(straight?.estimates.extraBytes||0)+(perspective?.estimates.extraBytes||0)+(sharpnessPlan?.maxWorkingBytes||0)+
       (padding?final.width*final.height*4:0)+(redactionPlan?.extraBytes||0)+imagePlan.cumulativeExtraBytes+imagePlan.retainedAssetStringBytes+retained;
      if(total>512*1024*1024)throw new RangeError('图层/锐化/校正/透视的累计图像缓冲区超过 512 MiB。');
    }
    const peopleContext = {sourceRevision:analysis?.sourceRevision};
    if (s.faceAdjustments != null) {
      MintPortraitPeopleDesktop.validateCompatibility(s, peopleContext.sourceRevision);
      for(const phase of ['beauty','reshape'])MintPortraitPeopleDesktop.planSize(width,height,s.faceAdjustments,{...peopleContext,phase});
    }
    let image = { width, height, data: new Uint8ClampedArray(input.buffer) };
    if (s.manualLiquify?.length) MintManualPipeline.assertCompatible(s);
    if (s.learnedMatteId) {
      const cached=analysis?.learnedMatte,mask=analysis?.mask,p=cached?.provenance;
      if(typeof s.learnedMatteId!=='string'||cached?.cacheId!==s.learnedMatteId||
        typeof analysis.sourceRevision!=='string'||!analysis.sourceRevision||cached.sourceRevision!==analysis.sourceRevision||
        mask?.learnedMatteId!==s.learnedMatteId||mask.space!=='working-pixels'||mask.width!==width||mask.height!==height||
        !(mask.data instanceof Float32Array)||mask.data.length!==width*height||
        !cached.originalSize||!Number.isSafeInteger(cached.originalSize.width)||!Number.isSafeInteger(cached.originalSize.height)||
        cached.originalSize.width<1||cached.originalSize.height<1||cached.originalSize.width*cached.originalSize.height>16000000||
        p?.kind!=='model'||p.task!=='matting'||typeof p.modelId!=='string'||!p.modelId||!/^[a-f0-9]{64}$/.test(p.weightsSha256)) {
        throw new Error('学习模型蒙版缺失或与照片版本不符；不会回退到旧分割。');
      }
      for(const value of mask.data)if(!Number.isFinite(value)||value<0||value>1)throw new Error('学习模型蒙版包含无效概率。');
    }
    // Accept either the documented array of meshes or a single genuine 468/478-point mesh.
    const raw = analysis?.landmarks;
    const faces = Array.isArray(raw) && raw.length ? (raw[0]?.x !== undefined ? [raw] : raw).filter(face => Array.isArray(face) && face.length >= 468).slice(0, 5) : [];
    if (Array.isArray(s.spots) && s.spots.length) image = PortraitEngine.heal(image, { spots: s.spots, strength: 0.86 });
    // Union face coverage before a single beauty pass: overlapping/duplicate meshes
    // must not multiply the strength or brighten already-retouched pixels again.
    if (faces.length && (s.smooth || s.brighten || s.warmth || s.underEye || s.redness || s.lip || s.blush)) image = PortraitEngine.beauty(image, { smooth: s.smooth, brighten: s.brighten, warmth: s.warmth, underEye: s.underEye, redness: s.redness, lip: s.lip, blush: s.blush, palette: s.palette }, faces);
    if (s.faceAdjustments != null) image = MintPortraitPeopleDesktop.applyBeauty(image,s.faceAdjustments,peopleContext);
    image = MintLocalAdjustments.tone(image, s);
    if (s.lightBalance != null) image = MintLightBalance.apply(image, s.lightBalance);
    if (s.levels != null) image = MintLevels.apply(image, s.levels);
    if (s.advancedTone != null) image = MintAdvancedTone.apply(image, s.advancedTone);
    if (s.localLayers?.length) image = MintLocalAdjustments.apply(image, s.localLayers, { sourceRevision: analysis?.sourceRevision, originalSize: analysis?.originalSize });
    if (s.manualLiquify?.length || s.manualRepair?.length) {
      if (s.manualRepair?.length && typeof RepairBrushCore === 'undefined') importScripts('./repair-brush-core.cjs');
      image = MintManualPipeline.apply(image,s,{sourceRevision:analysis?.sourceRevision});
    }
    if (s.bgMode && s.bgMode !== 'original' && analysis?.mask) {
      image = PortraitEngine.background(image, { mode: s.bgMode, blur: s.bgBlur, color: s.bgColor,
        feather: s.learnedMatteId ? 0 : s.bgFeather, continuousAlpha: !!s.learnedMatteId, mask: analysis.mask });
    }
    // Background is composited before geometry, so the subject edge and background
    // receive the same local displacement rather than using a stale unwarped matte.
    if (s.slim || s.eyes || s.nose || s.jaw) for (const face of faces) image = PortraitEngine.reshape(image, { slim: s.slim, eyes: s.eyes, nose: s.nose, jaw: s.jaw }, face);
    if (s.faceAdjustments != null) image = MintPortraitPeopleDesktop.applyReshape({width:image.width,height:image.height,data:image.data},s.faceAdjustments,peopleContext);
    if(sharpnessPlan)image=MintSharpness.apply({width:image.width,height:image.height,data:image.data},sharpnessRecipe);
    // Framing, then canvas expansion are last; all masks, meshes and strokes keep source coordinates.
    // Keep transient liquify diagnostics outside the strict geometry pixel record.
    if (s.framing != null) image = MintGeometry.apply({width:image.width,height:image.height,data:image.data}, s.framing);
    if (straight) image = MintStraighten.apply({width:image.width,height:image.height,data:image.data}, recipe);
    if(perspective){
      image=MintPerspective.apply({width:image.width,height:image.height,data:image.data},perspectiveRecipe,{limits:{maxPixels:16777216,maxEdge:16384}});
      if(image.width!==perspectiveReceipt.outputWidth||image.height!==perspectiveReceipt.outputHeight)throw new Error('透视结果尺寸与计划不一致。');
    }
    // Strict padding raster input excludes transient manual-tool diagnostics.
    if (s.canvasPadding != null) image = MintCanvasPadding.apply({width:image.width,height:image.height,data:image.data}, s.canvasPadding, {maxPixels:16777216,maxEdge:16384});
    if(s.imageLayers?.length)image=MintImageLayers.apply({width:image.width,height:image.height,data:image.data},s.imageLayers,input.imageAssets||[]);
    // This worker refuses text above, so its last stage can safely be redaction.
    // The browser text path explicitly defers BOTH stages and composes them once.
    if (s.redactions != null) image = MintRedactionLayers.apply({width:image.width,height:image.height,data:new Uint8ClampedArray(image.data.buffer,image.data.byteOffset,image.data.byteLength)},s.redactions,redactionContext);
    self.postMessage({ width: image.width, height: image.height, buffer: image.data.buffer, ...(perspectiveReceipt?{perspectiveReceipt}:{}), ...(imagePlan.active?{imageLayered:true,imageLayerKey:MintImageLayers.canonicalRecipe(s.imageLayers)}:{}), ...(sharpnessPlan?{sharpened:true,sharpnessRecipe}:{}), ...(straight?{straightened:true,straightenRecipe:recipe,straightenedWidth:straightened.width,straightenedHeight:straightened.height}:{}) }, [image.data.buffer]);
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
