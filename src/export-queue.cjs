/* Sequential, memory-bounded export bookkeeping. Compressed source Blobs and
 * frozen edit snapshots survive a retry; decoded pixels/encoded bytes do not. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./straighten.cjs') : root.MintStraighten, typeof module === 'object' && module.exports ? require('./sharpness.cjs') : root.MintSharpness, typeof module === 'object' && module.exports ? require('./image-layer-session.cjs') : root.MintImageLayerSession, typeof module === 'object' && module.exports ? require('./image-layers.cjs') : root.MintImageLayers, typeof module === 'object' && module.exports ? require('./perspective.cjs') : root.MintPerspective, typeof module === 'object' && module.exports ? require('./geometry.cjs') : root.MintGeometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintExportQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Straighten, Sharpness, Images, ImageLayers, Perspective, Geometry) {
  'use strict';
  const success = state => state === 'saved' || state === 'downloaded';
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
  function perspectiveOutput(photo, options, output) {
    const recipe=Object.hasOwn(photo.settings,'perspective')?photo.settings.perspective:null;
    if(recipe===undefined)throw new Error('透视配方必须为完整记录或 null');
    if(recipe!==null&&(!Perspective||!Geometry))throw new Error('透视几何组件不可用，未保存结果');
    const active=recipe!==null&&Perspective.isActive(recipe);
    if(!active){if(Object.hasOwn(output,'perspectiveReceipt')||['perspectiveReceipt','perspective'].some(k=>Object.hasOwn(output.details||{},k)))throw new Error('未启用透视时收到额外透视结果');return null;}
    const canonical=Perspective.validate(recipe),ow=photo.originalWidth,oh=photo.originalHeight;
    if(![ow,oh].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('透视原图尺寸未确认');
    const scale=options.mode==='working'?Math.min(1,4096/Math.max(ow,oh),Math.sqrt(16000000/(ow*oh))):1;
    let w=Math.max(1,Math.round(ow*scale)),h=Math.max(1,Math.round(oh*scale));
    if(output.processingWidth!==w||output.processingHeight!==h||output.scaled!==(w!==ow||h!==oh))throw new Error('透视处理尺度与冻结导出模式不匹配');
    const framed=Geometry.plan(w,h,photo.settings.framing||null).outputSize;w=framed.width;h=framed.height;
    if(photo.settings.straighten!=null){if(!Straighten)throw new Error('调平组件不可用');const st=Straighten.plan(w,h,photo.settings.straighten).outputSize;w=st.width;h=st.height;}
    const plan=Perspective.plan(w,h,canonical),filter='linear-light-premultiplied-alpha-mip-anisotropic-bilinear';
    const expected={version:1,recipe:plan.recipe,inputWidth:w,inputHeight:h,outputWidth:plan.outputSize.width,outputHeight:plan.outputSize.height,kind:plan.kind,resampling:plan.kind==='resample'?filter:'none'};
    if(JSON.stringify(output.perspectiveReceipt)!==JSON.stringify(expected)||JSON.stringify(output.details?.perspectiveReceipt)!==JSON.stringify(expected)||output.details?.perspective!==(plan.kind==='resample'?filter:'exact-byte-copy'))throw new Error('透视结果与冻结配方/尺寸不匹配，未保存文件');
    const rotated=photo.settings.straighten?.angle%90!==0&&photo.settings.straighten?.angle!==undefined?'straighten-linear-light-premultiplied-alpha-bilinear':null;
    const perspectiveStage=plan.kind==='resample'?'perspective-'+filter:null,resized=output.outputResized===true||output.outputSizePlan?.resized===true;
    const nativeSampling=[output.scaled?'explicit-working-size-lanczos3':null,rotated,perspectiveStage,resized?(output.scaled?'final-output-lanczos3':'explicit-final-output-lanczos3'):null].filter(Boolean).join('+')||'none';
    const canvasSampling=[output.scaled?'canvas-working-source':null,rotated,perspectiveStage,resized?'canvas-high-quality-final':null].filter(Boolean).join('+')||'none';
    if(![nativeSampling,canvasSampling].includes(output.details?.resampling))throw new Error('透视重采样阶段与冻结几何/输出处理不匹配，未保存文件');
    return expected;
  }
  class ExportQueue {
    constructor(sources, options) {
      this.options = freeze(structuredClone(options)); this.running = false; this.cancelled = false; this.controller = null;
      this.items = sources.map((p, index) => ({ index, photo: { id: p.id, name: p.name, blob: p.blob, sourceRevision: p.sourceRevision || `${p.id}:source-0`, originalWidth: p.originalWidth, originalHeight: p.originalHeight, settings: freeze(structuredClone(p.settings)), learnedCache: new Map(p.learnedCache || []), imageAssets: (p.settings.imageLayers?.length || p.imageAssets?.length) ? (()=>{if(!Images)throw new Error('贴图素材组件不可用，未创建导出快照');return Images.select(p.imageAssets||[],p.settings);})() : Object.freeze([]) }, state: 'pending', error: '', attempts: 0, output: null, receipt: null }));
      if(this.items.some(item=>item.photo.imageAssets.length))Images.sessionPlan(this.items.map(item=>item.photo.imageAssets));
    }
    summary() { const counts = { total: this.items.length, saved: 0, downloaded: 0, failed: 0, cancelled: 0, pending: 0, rendering: 0, writing: 0 }; for (const item of this.items) counts[item.state]++; counts.success = counts.saved + counts.downloaded; counts.retryable = counts.total - counts.success; return counts; }
    cancel() { this.cancelled = true; this.controller?.abort(); }
    async run({ render, write, onChange = () => {}, retry = false }) {
      if (this.running) return this.summary();
      if (retry) { this.cancelled = false; for (const item of this.items) if (!success(item.state)) { item.state = 'pending'; item.error = ''; } }
      this.running = true;
      try {
        for (const item of this.items) {
          if (success(item.state)) continue;
          if (this.cancelled) { item.state = 'cancelled'; onChange(item, this.summary()); continue; }
          const controller = new AbortController(); this.controller = controller;
          let output = null;
          try {
            item.attempts++; item.error = ''; item.state = 'rendering'; onChange(item, this.summary());
            output = await render(item, controller.signal);
            if (this.cancelled || controller.signal.aborted) { item.state = 'cancelled'; continue; }
            if (!output?.bytes?.byteLength) throw new Error('输出为空，未保存文件');
            const perspective=perspectiveOutput(item.photo,this.options,output),perspectiveSampling=perspective?.kind==='resample'?'perspective-'+perspective.resampling:null;
            const imageRecipe=item.photo.settings.imageLayers||[];
            if(imageRecipe.length&&!ImageLayers)throw new Error('贴图组件不可用，未保存结果');
            const activeImages=imageRecipe.length>0&&ImageLayers.isActive(imageRecipe);
            const imageKey=activeImages?ImageLayers.canonicalRecipe(imageRecipe):null;
            if(activeImages){if(output.imageLayered!==true||output.imageLayerKey!==imageKey||output.details?.imageOverlay!=='premultiplied-srgb-mip-bilinear-edge4x4'||output.details?.imageLayerKey!==imageKey)throw new Error('贴图结果未匹配冻结图层，未保存文件');}
            else if(['imageLayered','imageLayerKey'].some(k=>Object.hasOwn(output,k))||['imageOverlay','imageLayerKey'].some(k=>Object.hasOwn(output.details||{},k)))throw new Error('未启用贴图时收到额外贴图结果');
            const sharpRecipe=Object.hasOwn(item.photo.settings,'sharpness')?item.photo.settings.sharpness:null;
            if(sharpRecipe!==null&&!Sharpness)throw new Error('锐化组件不可用，未保存结果。');
            const canonicalSharp=sharpRecipe===null?null:Sharpness.validate(sharpRecipe);
            const activeSharp=canonicalSharp?.amount>0;
            if(activeSharp){
              const matches=value=>{const r=Sharpness.validate(value);return r&&['version','amount','radius','threshold'].every(k=>r[k]===canonicalSharp[k]);};
              if(output.sharpened!==true||!matches(output.sharpnessRecipe)||output.details?.sharpness!=='classical-coverage-normalized-luminance-unsharp-detail'||!matches(output.details?.sharpnessRecipe))throw new Error('锐化结果缺少匹配的配方或传统算法说明，未保存文件。');
            }else if(['sharpened','sharpnessRecipe'].some(key=>Object.hasOwn(output,key))||output.details&&['sharpness','sharpnessRecipe'].some(key=>Object.hasOwn(output.details,key)))throw new Error('未启用锐化时收到额外锐化结果。');
            const recipe=item.photo.settings.straighten;
            if(recipe!=null&&!Straighten)throw new Error('角度校正组件不可用，未保存结果。');
            const active=recipe!=null&&Straighten.isActive(recipe);
            if(active){
              const canonical=Straighten.validate(recipe),algorithm=canonical.angle%90===0?'exact-quarter-turn-byte-copy':'linear-light-premultiplied-alpha-bilinear';
              const rotated=canonical.angle%90!==0?'straighten-linear-light-premultiplied-alpha-bilinear':null,resized=output.outputResized===true||output.outputSizePlan?.resized===true;
              const nativeSampling=[output.scaled?'explicit-working-size-lanczos3':null,rotated,perspectiveSampling,resized?(output.scaled?'final-output-lanczos3':'explicit-final-output-lanczos3'):null].filter(Boolean).join('+')||'none';
              const canvasSampling=[output.scaled?'canvas-working-source':null,rotated,perspectiveSampling,resized?'canvas-high-quality-final':null].filter(Boolean).join('+')||'none';
              if(output.straightened!==true||JSON.stringify(output.straightenRecipe)!==JSON.stringify(canonical)||
                !Number.isSafeInteger(output.straightenedWidth)||output.straightenedWidth<1||!Number.isSafeInteger(output.straightenedHeight)||output.straightenedHeight<1||
                output.details?.straighten!==algorithm||JSON.stringify(output.details?.straightenRecipe)!==JSON.stringify(canonical)||
                ![nativeSampling,canvasSampling].includes(output.details?.resampling))
                throw new Error('角度校正结果缺少匹配的配方或重采样说明，未保存文件。');
            }else if(['straightened','straightenRecipe','straightenedWidth','straightenedHeight'].some(key=>Object.hasOwn(output,key))||output.details&&['straighten','straightenRecipe'].some(key=>Object.hasOwn(output.details,key)))throw new Error('未启用校正时收到额外校正结果。');
            item.output = { width: output.width, height: output.height, processingWidth: output.processingWidth, processingHeight: output.processingHeight, framed: output.framed === true, originalWidth: output.originalWidth, originalHeight: output.originalHeight, scaled: output.scaled === true, outputResized: output.outputResized === true, compositionWidth: output.compositionWidth, compositionHeight: output.compositionHeight, ...(perspective?{perspectiveReceipt:structuredClone(perspective),details:structuredClone(output.details)}:{}), ...(activeImages?{imageLayered:true,imageLayerKey:imageKey,details:structuredClone(output.details)}:{}), ...(activeSharp?{sharpened:true,sharpnessRecipe:structuredClone(canonicalSharp),details:structuredClone(output.details)}:{}), ...(output.straightened === true ? {straightened:true,straightenRecipe:structuredClone(output.straightenRecipe),straightenedWidth:output.straightenedWidth,straightenedHeight:output.straightenedHeight,details:structuredClone(output.details)} : {}) }; 
            item.state = 'writing'; onChange(item, this.summary());
            // Writes are non-cancellable commits. A stop during this await must
            // count the file actually saved, never offer it again in retry.
            const receipt = await write(item, output);
            item.receipt = receipt || null; item.state = receipt?.downloaded ? 'downloaded' : 'saved';
            // Successful items never rerender on retry; release only their retained assets.
            item.photo.imageAssets=Object.freeze([]);
          } catch (error) {
            const interrupted = item.state !== 'writing' && (this.cancelled || controller.signal.aborted || error?.name === 'AbortError');
            item.state = interrupted ? 'cancelled' : 'failed'; item.error = interrupted ? '' : String(error?.message || error);
          } finally { output = null; this.controller = null; onChange(item, this.summary()); }
        }
      } finally { this.running = false; this.controller = null; onChange(null, this.summary()); }
      return this.summary();
    }
  }
  return { ExportQueue };
});
