/**
 * Mint Portrait local-only browser pipeline.
 * Real MediaPipe CPU/WASM inference; deterministic edits run in dedicated workers.
 * No image, landmark or mask is uploaded. Models and WASM are bundled locally.
 */
import { FaceLandmarker, ImageSegmenter, FilesetResolver } from '../assets/vision/vision_bundle.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  exposure: 0, contrast: 0, saturation: 0, temperature: 0,
  smooth: 0, brighten: 0, warmth: 0, slim: 0, eyes: 0, nose: 0, jaw: 0,
  bgMode: 'original', bgBlur: 18, bgColor: '#e9eee9', bgFeather: 2,
  spots: Object.freeze([]), underEye: 0, redness: 0, lip: 0, blush: 0, palette: 'natural', localLayers: Object.freeze([]), manualSelection: null, manualLiquify: Object.freeze([]), manualRepair: Object.freeze([]), lightBalance: null, levels: null, advancedTone: null, sharpness: null, framing: null, straighten: null, perspective: null, canvasPadding: null, imageLayers: Object.freeze([]), textLayers: Object.freeze([]), paintLayers: null, redactions: null, faceAdjustments: null
});

/** Owned diagnostic-only recipe for neutral-patch sampling immediately before
 * LightBalance. Keeps healing, beauty and basic tone; never mutates photo/history.
 * Render with the same source-revision-bound analysis as the normal image. */
export function lightBalanceInputSettings(settings) {
  const retained = ['spots', 'smooth', 'brighten', 'warmth', 'underEye', 'redness', 'lip', 'blush', 'palette',
    'exposure', 'contrast', 'saturation', 'temperature'];
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const key of retained) if (Object.hasOwn(settings, key)) result[key] = structuredClone(settings[key]);
  if(settings.faceAdjustments!=null)result.faceAdjustments={...structuredClone(settings.faceAdjustments),faces:settings.faceAdjustments.faces.map(face=>({...structuredClone(face),reshape:{slim:0,eyes:0,nose:0,jaw:0}}))};
  return result;
}

const preset = (id, name, description, settings) => Object.freeze({
  id, name, description, settings: Object.freeze({ ...DEFAULT_SETTINGS, ...settings })
});
export const PRESETS = Object.freeze([
  preset('original', '原片', '保留真实质感，从零开始调整', {}),
  preset('natural', '自然通透', '轻柔提亮与肤质优化，保留细节', { exposure: 5, contrast: 3, saturation: 3, smooth: 28, brighten: 14, warmth: 3 }),
  preset('portrait', '精致人像', '适度修肤，轻微修饰脸部轮廓', { exposure: 4, contrast: 4, smooth: 42, brighten: 20, warmth: 4, slim: 12, eyes: 7, nose: 5, jaw: 6 }),
  preset('warm', '暖调胶片', '温暖肤色与柔和对比', { exposure: 3, contrast: -10, saturation: -7, temperature: 15, smooth: 18, warmth: 10 }),
  preset('clean', '清爽证件', '简洁浅灰背景，干净自然肤色', { exposure: 5, contrast: 4, saturation: -3, smooth: 26, brighten: 16, bgMode: 'color', bgColor: '#e9eee9', bgFeather: 2 }),
  preset('focus', '人像虚化', '保留人物，让背景退后一步', { exposure: 3, smooth: 20, brighten: 10, bgMode: 'blur', bgBlur: 24 })
]);

const local = path => new URL(path, import.meta.url).href;
const MAX_EDGE = 4096;
const MAX_PIXELS = 16000000;
const MAX_RENDER_PIXELS = 16777216;
const MAX_RENDER_EDGE = 16384;
const PERSPECTIVE_FILTER = 'linear-light-premultiplied-alpha-mip-anisotropic-bilinear';
const PERSPECTIVE_RECEIPT_FIELDS = ['version','recipe','inputWidth','inputHeight','outputWidth','outputHeight','kind','resampling'];
function perspectiveRecipeOf(settings) {
  const d=Object.getOwnPropertyDescriptor(settings,'perspective');
  if(!d){if('perspective' in settings)throw new TypeError('透视配方必须是自有数据字段。');return null;}
  if(!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)throw new TypeError('透视配方必须完整提供或明确设为 null。');
  if(d.value===null)return null;
  if(!globalThis.MintPerspective?.validate)throw new Error('四角透视组件不可用，未跳过透视。');
  return globalThis.MintPerspective.validate(d.value);
}
function perspectiveReceiptOf(plan) {
  return Object.freeze({version:1,recipe:plan.recipe,inputWidth:plan.sourceSize.width,inputHeight:plan.sourceSize.height,
    outputWidth:plan.renderedSize.width,outputHeight:plan.renderedSize.height,kind:plan.kind,resampling:plan.kind==='resample'?PERSPECTIVE_FILTER:'none'});
}
function validatePerspectiveReceipt(result,expected) {
  const field=Object.getOwnPropertyDescriptor(result,'perspectiveReceipt');
  if(!expected){if(field)throw new Error('未启用透视时收到额外透视结果。');return;}
  if(!field?.enumerable||!Object.hasOwn(field,'value'))throw new Error('处理结果缺少透视回执。');
  const actual=field.value;
  if(!actual||typeof actual!=='object'||Array.isArray(actual)||![Object.prototype,null].includes(Object.getPrototypeOf(actual))||Reflect.ownKeys(actual).length!==PERSPECTIVE_RECEIPT_FIELDS.length)throw new Error('无效的透视回执。');
  for(const key of PERSPECTIVE_RECEIPT_FIELDS){
    const d=Object.getOwnPropertyDescriptor(actual,key);
    if(!d?.enumerable||!Object.hasOwn(d,'value'))throw new Error('无效的透视回执字段。');
    const value=key==='recipe'?globalThis.MintPerspective.validate(d.value):d.value;
    if(JSON.stringify(value)!==JSON.stringify(expected[key]))throw new Error('处理结果的透视配方或阶段尺寸与快照不一致。');
  }
}

let models = null;
let modelPromise = null;
let analysisQueue = Promise.resolve();
const progressListeners = new Set();

function progress(message) {
  for (const listener of progressListeners) {
    try { listener(message); } catch { /* UI progress must not invalidate initialization. */ }
  }
}

/** Initialize exactly one pair of local models. Failures remain retryable. */
export async function initModels(onProgress) {
  if (typeof onProgress === 'function') progressListeners.add(onProgress);
  if (models) {
    try { onProgress?.('离线人像模型已就绪'); } finally { progressListeners.delete(onProgress); }
    return { ready: true, delegate: 'CPU', maxFaces: 5 };
  }
  if (!modelPromise) {
    modelPromise = (async () => {
      let face = null;
      let segmenter = null;
      try {
        progress('正在载入本地推理引擎…');
        const fileset = await FilesetResolver.forVisionTasks(local('../assets/vision/wasm'));
        progress('正在载入人脸关键点模型…');
        face = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: local('../assets/models/face_landmarker.task'), delegate: 'CPU' },
          runningMode: 'IMAGE', numFaces: 5,
          minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
          outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false
        });
        progress('正在载入人物分割模型…');
        segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: local('../assets/models/selfie_segmenter.tflite'), delegate: 'CPU' },
          runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false
        });
        models = { face, segmenter };
        progress('离线人像模型已就绪');
        return { ready: true, delegate: 'CPU', maxFaces: 5 };
      } catch (error) {
        face?.close();
        segmenter?.close();
        models = null;
        throw new Error(`本地模型初始化失败：${error?.message || error}`);
      }
    })();
    modelPromise.catch(() => { modelPromise = null; });
  }
  try { return await modelPromise; }
  finally { progressListeners.delete(onProgress); }
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function contextOf(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建图像画布，请重启应用后重试。');
  return context;
}
function validateCanvas(canvas, rendered = false) {
  if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 || canvas.height < 1 || canvas.width * canvas.height > (rendered ? MAX_RENDER_PIXELS : MAX_PIXELS) || (rendered && Math.max(canvas.width, canvas.height) > MAX_RENDER_EDGE)) {
    throw new RangeError(rendered ? '输出画布尺寸无效；最多 16777216 像素、单边 16384 像素，未自动缩小。' : '图像尺寸无效，工作图像长边最多 4096 像素且总像素不超过 1600 万。');
  }
}

/** Browser decoder applies embedded orientation. Working files are bounded to 16 MP. */
export async function decodeImage(fileOrBlob, maxEdge = MAX_EDGE, options = {}) {
  if (!(fileOrBlob instanceof Blob) || !fileOrBlob.size) throw new TypeError('请选择有效的图像文件。');
  const edge = Number.isFinite(maxEdge) ? Math.max(1, Math.min(options.exportOriginal ? 16384 : MAX_EDGE, Math.round(maxEdge))) : MAX_EDGE;
  let bitmap = null;
  let source = null;
  let objectURL = null;
  try {
    try {
      bitmap = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image', premultiplyAlpha: 'default', colorSpaceConversion: 'default' });
      source = bitmap;
    } catch {
      objectURL = URL.createObjectURL(fileOrBlob);
      source = new Image();
      source.src = objectURL;
      await source.decode();
    }
    const originalWidth = source.naturalWidth || source.width;
    const originalHeight = source.naturalHeight || source.height;
    if (!originalWidth || !originalHeight) throw new Error('图像没有可读取的像素。');
    if (options.signal?.aborted) throw new DOMException('已取消图像读取。', 'AbortError');
    if (options.exactOriginal && (Math.max(originalWidth, originalHeight) > (options.exportOriginal ? 16384 : MAX_EDGE) || originalWidth * originalHeight > MAX_PIXELS)) {
      throw new RangeError('学习模型模式需要原始像素。本候选版仅支持长边不超过 4096 像素、总像素不超过 1600 万的原图；不会把缩略图冒充原图。');
    }
    const scale = Math.min(1, edge / Math.max(originalWidth, originalHeight), Math.sqrt(MAX_PIXELS / (originalWidth * originalHeight)));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.min(Math.round(originalHeight * scale), Math.floor(MAX_PIXELS / width)));
    const canvas = canvasOf(width, height);
    const context = contextOf(canvas);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return { canvas, width, height, originalWidth, originalHeight, scaled: width !== originalWidth || height !== originalHeight };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(`无法读取此图像。请使用 JPG、PNG 或 WebP 文件。${error?.message ? `（${error.message}）` : ''}`);
  } finally {
    bitmap?.close();
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}

/** Exact original working pixels, never the 1280px preview. Oversized input is
 * rejected explicitly until the full-resolution tiled document backend exists. */
export function decodeOriginalImage(fileOrBlob, options = {}) {
  return decodeImage(fileOrBlob, MAX_EDGE, { exactOriginal: true, signal: options.signal });
}

/** Explicit export sizing. Original never silently resizes; model ROI limits are separate. */
export function decodeExportImage(fileOrBlob, options = {}) {
  if (!['original','working'].includes(options.mode)) throw new Error('请选择原尺寸或工作尺寸导出。');
  return decodeImage(fileOrBlob, options.mode === 'original' ? 16384 : MAX_EDGE,
    { exactOriginal: options.mode === 'original', exportOriginal: options.mode === 'original', signal: options.signal });
}

const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Run actual inference, serialized because Tasks graphs are not reentrant.
 * landmarks is an array of detected face meshes; no detection means [].
 * A person may be segmented even when no face is visible.
 */
export async function analyze(canvas) {
  validateCanvas(canvas);
  await initModels();
  const perform = async () => {
    const scale = Math.min(1, 1280 / Math.max(canvas.width, canvas.height));
    let input = canvas;
    if (scale < 1) {
      input = canvasOf(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
      const context = contextOf(input);
      context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, 0, 0, input.width, input.height);
    }
    await yieldUI();
    const result = models.face.detect(input);
    const landmarks = (result.faceLandmarks || []).map(face => face.map(point => ({ x: point.x, y: point.y, z: point.z || 0 })));
    await yieldUI();
    let mask = null;
    models.segmenter.segment(input, result => {
      const confidenceMasks = result.confidenceMasks;
      if (!confidenceMasks?.length) throw new Error('人物分割模型没有返回置信度蒙版。');
      const labels = models.segmenter.getLabels();
      const labelIndex = labels.findIndex(label => /^(person|selfie|foreground|human)$/i.test(label.trim()));
      // Bundled SelfieSegmenter has exactly one person-probability output.
      // Multi-class models must provide an explicit person label, never a guessed mask.
      const personIndex = labelIndex >= 0 ? labelIndex : confidenceMasks.length === 1 ? 0 : -1;
      if (personIndex < 0 || personIndex >= confidenceMasks.length) throw new Error('人物分割模型缺少可识别的人物类别。');
      const person = confidenceMasks[personIndex];
      const data = new Float32Array(person.getAsFloat32Array());
      for (let i = 0; i < data.length; i++) {
        if (!Number.isFinite(data[i])) throw new Error('人物分割模型返回了无效置信度。');
        data[i] = Math.min(1, Math.max(0, data[i]));
      }
      mask = { width: person.width, height: person.height, data, maxValue: 1 };
      // Callback-owned MPMasks are released by MediaPipe on callback return.
    });
    if (!mask) throw new Error('未能完成本地人物分割。');
    return { landmarks, mask, faceCount: landmarks.length, detectionSize: {width:input.width,height:input.height}, detector: {id:'mediapipe-face-landmarker', modelSha256:'64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', topology:'MediaPipe478'} };
  };
  const pending = analysisQueue.then(perform, perform);
  analysisQueue = pending.catch(() => {});
  return pending;
}

let nextRenderId = 0;
const renderQueue = [];
const renderJobs = new Map();
const MAX_WORKERS = 2;
let activeWorkers = 0;
const abortError = () => new DOMException('已取消图像处理。', 'AbortError');

function settle(job, error, result) {
  if (job.settled) return;
  job.settled = true;
  if (job.started) activeWorkers--;
  job.worker?.terminate();
  job.signal?.removeEventListener('abort', job.abort);
  renderJobs.delete(job.id);
  if (error) job.reject(error); else job.resolve(result);
  queueMicrotask(drainRenders);
}
function drainRenders() {
  while (activeWorkers < MAX_WORKERS && renderQueue.length) {
    // A transformed comparison cannot overlap another geometry job. Existing
    // workers finish first; normal inactive jobs retain the legacy two slots.
    if(activeWorkers && ((renderQueue[0].perspectiveMetadata || renderQueue[0].straightenMetadata || renderQueue[0].sharpnessMetadata || renderQueue[0].imageOverlayMetadata) || [...renderJobs.values()].some(j=>j.started&&!j.settled&&(j.perspectiveMetadata || j.straightenMetadata || j.sharpnessMetadata || j.imageOverlayMetadata)))) break;
    const job = renderQueue.shift();
    if (job.settled) continue;
    if (job.signal?.aborted) { settle(job, abortError()); continue; }
    job.started = true;
    activeWorkers++;
    try {
      // Read pixels only when a worker slot is available, avoiding copies for cancelled queued jobs.
      const image = contextOf(job.canvas).getImageData(0, 0, job.canvas.width, job.canvas.height);
      const worker = new Worker(local('./pixel-worker.js'), { name: `portrait-pixels-${job.id}` });
      job.worker = worker;
      worker.onmessage = ({ data }) => {
        if (job.settled) return;
        if (data.error) { settle(job, new Error(data.error)); return; }
        try {
          if (data.width !== job.expectedSize.width || data.height !== job.expectedSize.height || data.buffer?.byteLength !== data.width * data.height * 4) throw new Error('处理结果尺寸与构图计划不一致。');
          for(const key of ['straightened','straightenRecipe','straightenedWidth','straightenedHeight']){
            const expected=job.straightenMetadata;
            if(Object.hasOwn(data,key)!==Object.hasOwn(expected||{},key)||JSON.stringify(data[key])!==JSON.stringify(expected?.[key]))throw new Error('处理结果的校正角度与快照不一致。');
          }
          validatePerspectiveReceipt(data,job.perspectiveMetadata?.perspectiveReceipt);
          const sharpExpected=job.sharpnessMetadata;
          if(sharpExpected){
            if(data.sharpened!==true||!Object.hasOwn(data,'sharpnessRecipe'))throw new Error('处理结果缺少锐化配方。');
            const actual=globalThis.MintSharpness.validate(data.sharpnessRecipe);
            if(!actual||['version','amount','radius','threshold'].some(key=>actual[key]!==sharpExpected.sharpnessRecipe[key]))throw new Error('处理结果的锐化配方与快照不一致。');
          }else if(['sharpened','sharpnessRecipe'].some(key=>Object.hasOwn(data,key)))throw new Error('未启用锐化时收到额外锐化结果。');
          const expectedImages=job.imageOverlayMetadata;
          for(const key of ['imageLayered','imageLayerKey'])if(Object.hasOwn(data,key)!==Object.hasOwn(expectedImages||{},key)||data[key]!==expectedImages?.[key])throw new Error('贴图结果与任务快照不一致。');
          const output = canvasOf(data.width, data.height);
          contextOf(output).putImageData(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height), 0, 0);
          if(job.perspectiveMetadata)Object.defineProperty(output,'perspectiveReceipt',{value:job.perspectiveMetadata.perspectiveReceipt,enumerable:true});
          settle(job, null, output);
        } catch (error) { settle(job, error); }
      };
      worker.onerror = event => settle(job, new Error(`离线图像处理失败：${event.message || '无法启动像素工作线程。'}`));
      worker.onmessageerror = () => settle(job, new Error('无法读取像素工作线程的结果。'));
      worker.postMessage({
        width: image.width, height: image.height, buffer: image.data.buffer,
        settings: job.settings, imageAssets:job.imageAssets, analysis: job.analysis, retainedBytes: job.retainedBytes
      }, [image.data.buffer]);
    } catch (error) { settle(job, error); }
  }
}

/** Metadata-only admission shared by transactional UI Apply and render. Reads
 * dimensions and retained byte counts only: no Canvas/readback/worker/RGBA work. */
export function preflightRender(canvas, settings = DEFAULT_SETTINGS, analysis = null, options = {}) {
  validateCanvas(canvas);
  if (options?.manualEditing === true && settings.faceAdjustments!=null) settings={...settings,faceAdjustments:{...settings.faceAdjustments,faces:settings.faceAdjustments.faces.map(face=>({...face,reshape:{slim:0,eyes:0,nose:0,jaw:0}}))}};
  if (options?.manualEditing === true) settings = { ...settings, bgMode:'original', learnedMatteId:null, slim:0, eyes:0, nose:0, jaw:0, sharpness:null, framing:null, straighten:null, perspective:null, canvasPadding:null, imageLayers:[], textLayers:[], paintLayers:null, redactions:null };
  else if (options?.sourceView === true) settings = { ...settings, sharpness:null, framing:null, straighten:null, perspective:null, canvasPadding:null, imageLayers:[], textLayers:[], paintLayers:null, redactions:null };
  const perspectiveRecipe=perspectiveRecipeOf(settings);
  // Admission applies to the original preview plane too: a crop or one-pixel
  // perspective output must not hide an oversized source edge before readback.
  if(perspectiveRecipe&&globalThis.MintPerspective.isActive(perspectiveRecipe))validateCanvas(canvas,true);
  const sharpCore = globalThis.MintSharpness;
  const suppliedSharpness=Object.hasOwn(settings,'sharpness')?settings.sharpness:null;
  if(suppliedSharpness!==null&&!sharpCore?.validate)throw new Error('锐化组件不可用，未跳过锐化。');
  const sharpnessRecipe=suppliedSharpness===null?null:sharpCore.validate(suppliedSharpness);
  // Disabled recipes are still validated, but do not invoke the capped core planner.
  const sharpnessPlan=sharpnessRecipe?.amount>0?sharpCore.plan({width:canvas.width,height:canvas.height},sharpnessRecipe):null;
  const sharpnessMetadata=sharpnessPlan?{sharpened:true,sharpnessRecipe}:null;
  let activeText = false;
  if(settings.textLayers?.length){
    if(!globalThis.MintTextLayers?.validate)throw new Error('文字组件不可用，未忽略已有文字。');
    const layers=globalThis.MintTextLayers.validate(settings.textLayers);
    activeText = globalThis.MintTextLayers.isActive(layers);
    if(activeText&&options?.deferTextLayers!==true)throw new Error('文字必须由同一字体栅格阶段完成，不能只导出底图。');
    // Caller explicitly owns the final-canvas text stage and must publish only its completed composite.
    settings={...settings,textLayers:[]};
  }
  let expectedSize = {width:canvas.width,height:canvas.height};
  if (settings.framing != null) {
    if (!globalThis.MintGeometry?.plan) throw new Error('裁剪/旋转组件不可用，未跳过构图。');
    expectedSize = globalThis.MintGeometry.plan(canvas.width, canvas.height, settings.framing).outputSize;
  }
  const framedSize = expectedSize;
  const core = globalThis.MintStraighten;
  if(settings.straighten!=null&&!core?.validate)throw new Error('角度校正组件不可用，未跳过校正。');
  const recipe = settings.straighten!=null ? core.validate(settings.straighten) : null;
  const straight = recipe?.angle ? core.plan(expectedSize.width,expectedSize.height,recipe) : null;
  if(straight)expectedSize=straight.outputSize;
  validateCanvas(expectedSize,true);
  const straightenMetadata=straight?{straightened:true,straightenRecipe:recipe,straightenedWidth:expectedSize.width,straightenedHeight:expectedSize.height}:null;
  const perspective=perspectiveRecipe&&globalThis.MintPerspective.isActive(perspectiveRecipe)?globalThis.MintPerspective.plan(expectedSize.width,expectedSize.height,perspectiveRecipe,{limits:{maxPixels:MAX_RENDER_PIXELS,maxEdge:MAX_RENDER_EDGE}}):null;
  const perspectiveMetadata=perspective?Object.freeze({perspectiveReceipt:perspectiveReceiptOf(perspective)}):null;
  if(perspective)expectedSize=perspective.renderedSize;
  validateCanvas(expectedSize,true);
  let paddingPlan=null,paintPlan=null,redactionPlan=null;
  if (settings.canvasPadding != null) {
    if (!globalThis.MintCanvasPadding?.plan) throw new Error('画布扩边组件不可用，未跳过扩边。');
    paddingPlan = globalThis.MintCanvasPadding.plan(expectedSize.width, expectedSize.height, settings.canvasPadding, {maxPixels:MAX_RENDER_PIXELS,maxEdge:MAX_RENDER_EDGE});
    expectedSize=paddingPlan.outputSize;
  }
  const imageLayers=Object.hasOwn(settings,'imageLayers')?settings.imageLayers:[];
  let imagePlan=null,imageOverlayMetadata=null;
  if(imageLayers.length || options?.imageAssets?.length){
    if(!globalThis.MintImageLayers?.plan)throw new Error('贴图组件不可用，未忽略已有贴图。');
    imagePlan=globalThis.MintImageLayers.plan(expectedSize.width,expectedSize.height,imageLayers,options?.imageAssets||[]);
    if(imagePlan.active)imageOverlayMetadata={imageLayered:true,imageLayerKey:globalThis.MintImageLayers.canonicalRecipe(imageLayers)};
  }
  let activePaint = false;
  if (settings.paintLayers != null) {
    const paint = globalThis.MintPaintLayers;
    if (!paint?.validate || !paint?.plan) throw new Error('绘画组件不可用，未忽略已有笔迹。');
    const context = {sourceRevision:analysis?.sourceRevision,settings,sourceSize:{width:canvas.width,height:canvas.height}};
    const value = paint.validate(settings.paintLayers, context);
    paintPlan=paint.plan(expectedSize.width, expectedSize.height, value, context);
    activePaint = paint.isActive(value);
    if (activePaint && options?.deferPaintLayers !== true) throw new Error('绘画必须完成独立图层栅格合成，不能只导出底图。');
    settings = {...settings,paintLayers:null};
  }
  if (settings.redactions != null) {
    const redaction = globalThis.MintRedactionLayers;
    if (!redaction?.validate || !redaction?.plan) throw new Error('遮挡组件不可用，未忽略已有遮挡。');
    const context = {sourceRevision:analysis?.sourceRevision,settings,sourceSize:{width:canvas.width,height:canvas.height}};
    const value = redaction.validate(settings.redactions, context);
    // Validate actual composition cost even when the caller owns final compositing.
    redactionPlan=redaction.plan(expectedSize.width, expectedSize.height, value, context);
    if ((activeText || activePaint) && redaction.isActive(value) && options?.deferRedactions !== true) throw new Error('文字后必须完成遮挡；请显式接管两个最终合成阶段。');
    // Defer only on an explicit flag. The normal no-text worker applies redaction.
    settings = {...settings,redactions:options?.deferRedactions === true ? null : value};
  }
  if (settings.learnedMatteId) {
    const cached = analysis?.learnedMatte, mask = analysis?.mask;
    if (typeof settings.learnedMatteId !== 'string' || cached?.cacheId !== settings.learnedMatteId ||
        !analysis.sourceRevision || cached.sourceRevision !== analysis.sourceRevision ||
        mask?.learnedMatteId !== settings.learnedMatteId || mask.space !== 'working-pixels' ||
        mask.width !== canvas.width || mask.height !== canvas.height || !(mask.data instanceof Float32Array)) {
      throw new Error('所选学习模型蒙版缺失、过期或尺寸不匹配；已停止处理，不会回退到旧分割。');
    }
  }
  let managedGeometryBytes=null;
  if(straight||perspective||sharpnessPlan||imagePlan?.active){
    let retained=options?.retainedBytes??0;
    if(!Number.isSafeInteger(retained)||retained<0)throw new RangeError('无效的保留缓冲区预算。');
    if(analysis?.mask?.data){const mask=analysis.mask.data;if(!ArrayBuffer.isView(mask)||!(mask.buffer instanceof ArrayBuffer))throw new Error('无效蒙版缓冲区。');retained+=mask.buffer.byteLength*3;}
    // Input Canvas, transferred readback and edited pre-frame plane; output bytes, Canvas,
    // ImageData and a retained comparison surface are conservatively charged.
    const finalBytes=expectedSize.width*expectedSize.height*4;
    const bytes=canvas.width*canvas.height*12+(settings.framing!=null?framedSize.width*framedSize.height*4:0)+(straight?.estimates.extraBytes||0)+(perspective?.estimates.extraBytes||0)+(sharpnessPlan?.maxWorkingBytes||0)+
      (paddingPlan?finalBytes:0)+finalBytes*3+
      (activeText?finalBytes*3:0)+(activePaint?finalBytes*3:0)+(paintPlan?.extraBytes||0)+(redactionPlan?.extraBytes||0)+(imagePlan?.cumulativeExtraBytes||0)+(imagePlan?.retainedAssetStringBytes||0)*2+retained;
    if(bytes>512*1024*1024)throw new RangeError('图层/锐化/校正/透视的累计图像缓冲区超过 512 MiB；不会自动缩小。');
    managedGeometryBytes=bytes;
  }
  const signal = options?.signal;
  if (signal?.aborted) throw abortError();
  return {expectedSize:{...expectedSize},straightenMetadata,perspectiveMetadata,...(sharpnessMetadata?{sharpnessMetadata}:{}),
    imageAssets:imagePlan?.assets||[],imageOverlayMetadata,settings:structuredClone({...DEFAULT_SETTINGS,...settings,...(sharpnessRecipe?{sharpness:sharpnessRecipe}:{}),...(recipe?{straighten:recipe}:{}),perspective:perspectiveRecipe}),managedGeometryBytes};
}

/** Render asynchronously without mutating canvas, settings or cached analysis. */
export async function render(canvas, settings = DEFAULT_SETTINGS, analysis = null, options = {}) {
  const planned=preflightRender(canvas,settings,analysis,options),signal=options?.signal;
  return new Promise((resolve, reject) => {
    const id = ++nextRenderId;
    const job = { id, canvas, expectedSize:planned.expectedSize, straightenMetadata:planned.straightenMetadata, perspectiveMetadata:planned.perspectiveMetadata, sharpnessMetadata:planned.sharpnessMetadata, imageOverlayMetadata:planned.imageOverlayMetadata, imageAssets:planned.imageAssets, settings:planned.settings, retainedBytes:options?.retainedBytes??0, analysis:structuredClone(analysis), signal, resolve, reject, settled:false, started:false };
    job.abort = () => settle(job, abortError());
    renderJobs.set(id, job);
    signal?.addEventListener('abort', job.abort, { once: true });
    renderQueue.push(job);
    drainRenders();
  });
}

/** Cancel both running and queued pixel jobs. Models and cached analysis are retained. */
export function cancelRenders() {
  for (const job of [...renderJobs.values()]) settle(job, abortError());
  renderQueue.length = 0;
}

/** PNG preserves alpha. JPEG deliberately flattens transparency onto white. */
export async function encode(canvas, format = 'jpeg', quality = 0.94) {
  validateCanvas(canvas, true);
  const type = String(format).toLowerCase().replace(/^image\//, '');
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(type)) throw new RangeError('支持的导出格式为 JPG、PNG 和 WebP。');
  const mime = type === 'jpg' ? 'image/jpeg' : `image/${type}`;
  const q = typeof quality === 'number' && Number.isFinite(quality) ? Math.max(0, Math.min(1, quality)) : 0.94;
  let source = canvas;
  if (mime === 'image/jpeg') {
    source = canvasOf(canvas.width, canvas.height);
    const context = contextOf(source);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, source.width, source.height);
    context.drawImage(canvas, 0, 0);
  } else {
    // Export sanitization only: do not retain a recoverable removed background
    // in hidden RGB under fully transparent pixels. Immutable source, cached
    // alpha and partial-alpha edge colors are not changed.
    const pixels = contextOf(canvas).getImageData(0, 0, canvas.width, canvas.height);
    let changed = false;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] === 0 && (pixels.data[i] || pixels.data[i + 1] || pixels.data[i + 2])) {
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0; changed = true;
      }
    }
    if (changed) { source = canvasOf(canvas.width, canvas.height); contextOf(source).putImageData(pixels, 0, 0); }
  }
  const blob = await new Promise((resolve, reject) => source.toBlob(value => value ? resolve(value) : reject(new Error('图像编码失败，请重试。')), mime, q));
  if (blob.type !== mime) throw new Error('此设备不支持所选导出格式。');
  return new Uint8Array(await blob.arrayBuffer());
}
