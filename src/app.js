import * as Pipeline from './pipeline.js';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const defaults = () => ({ ...clone(Pipeline.DEFAULT_SETTINGS), spots: [] });
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));
const MAX_FILES = 100, MAX_BYTES = 400 * 1024 * 1024, MAX_FILE_BYTES = 80 * 1024 * 1024;
const photos = [];
let currentId = null, source = null, analysis = null, rendered = null;
let viewToken = 0, renderVersion = 0, renderTimer = null, renderController = null, pageDisposed = false;
let loadingPhoto = false, analyzingPhoto = false, renderingPhoto = false, importing = false;
let modelState = 'loading', modelError = '', analysisQueue = Promise.resolve();
let exportRunning = false, exportCancelled = false, exportController = null;
let exportQueue = null, exportFolder = null, exportBatchGuard = null;
let openingDialog = false, loadingDemo = false, lastNativeDirty = null;
let projectOperation = '', projectDisplayName = '', savedProjectFingerprint = null, recoveredProjectUnsaved = false;
let presetOperation = null;
let imagePanel = null;
let recoveryController = null, recoveryRestoreEpoch = 0, recoveryFallback = null;
const recoveryObjectIds = new WeakMap(); let recoveryObjectSequence = 0;
let compare = false, split = .5, originalHeld = false, zoom = 1, panX = 0, panY = 0, fitMode = true;
let tool = 'pan', brushSize = 18, pointer = null, toastTimer = null, dragDepth = 0;
let backendJob = null, activeMattePreview = null, activeDiagnosticOverlay = null;
let repairSample = null, repairMode = 'heal';
let manualDraft = null, manualOverlayCache = null, manualViewReady = false, renderedManualMode = false, manualViewStamp = null;
let matteDraft = null, activeCorrectedMatte = null, activeMatteInspection = null;
let toneHistogram = null, toneCurveGraphKey = null;
let whiteBalancePick = null;
let redactionDraft = null;
let paintDraft = null, paintPick = null, paintRasterCache = null, paintRendererService = null;
const redactionPointers = new Set();
let paddingDraft = null, straightenDraft = null, sharpnessDraft = null;
let perspectiveDraft = null;
let cropDraft = null, framedOriginalCache = null, requestedDisplayMode = null, renderedDisplayStamp = null;
const referenceCore = window.MintReferenceCompare;
let referenceSnapshot = null, referenceRequested = false, referenceSuspended = false, referencePointer = null, referenceRightCanvas = null;
let referenceViewState = referenceCore?.fitView() || { u: .5, v: .5, zoom: 1 };
let acceptedRender = null, renderPending = false, renderFailure = '';
const previewPixelCore = window.MintPreviewPixelInspector;
let previewPixelEnabled = false, previewPixelCache = null, previewPixelPointer = null, previewPixelFailedRender = null;
const bridge = window.desktop;
const backendPanel = window.MintBackendPanel?.mount(bridge, document, { onChange: () => updateBackendControls() });
const current = () => photos.find(p => p.id === currentId);
const selected = () => photos.filter(p => p.selected);
const reviewCore = window.MintPhotoReview;
const reviewDefaults = () => reviewCore ? reviewCore.defaults() : ({ version: 1, current: { rating: 0, flag: 'none', label: 'none' }, undo: [], redo: [] });
const reviewOf = p => p.review === undefined ? reviewDefaults() : p.review;
let reviewView = reviewCore ? reviewCore.viewDefaults() : { version: 1, minRating: 0, maxRating: 5, flag: 'all', label: 'all', hideRejected: false, sort: 'import' };
const locked = () => importing || exportRunning || loadingPhoto || openingDialog || loadingDemo || !!projectOperation || !!presetOperation || !!imagePanel?.importing;
const photoAvailable = () => !!source && !!current() && !locked();
const hasFaces = () => current()?.settings.faceAdjustments != null ? !!selectedPerson() : analysis?.faceCount === 1 && !!analysis?.landmarks?.length;
const faceColorReady = () => window.PortraitEngine?.beauty?.capabilities?.implementation === 'classical-face-color-v1' && ['underEye','redness','lip','blush'].every(key => window.PortraitEngine.beauty.capabilities.controls?.includes(key));
const hasMask = () => current()?.settings.learnedMatteId ? !!cachedResult(current(), current().settings.learnedMatteId, 'matting') : !!analysis?.mask;

function status(text) { $('globalStatus').textContent = text; }
function toast(text, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7500 : 4200);
}
function busy(text = '') { $('canvasBusyText').textContent = text; $('canvasBusy').hidden = !text; }
function updateBusy() {
  recoveryController?.observe();
  updateReferenceComparison();
  busy(presetOperation?.kind === 'apply' ? presetOperation.message : projectOperation ? (projectOperation === 'save' ? '正在保存项目…' : '正在验证项目与原图…') : loadingPhoto ? '正在读取照片…' : analyzingPhoto ? '正在本机分析人像…' : renderingPhoto ? '正在应用调整…' : '');
}
function isDirty(p) { return JSON.stringify(p.settings) !== JSON.stringify(defaults()); }
// Exported image copies are not project saves. This small fingerprint omits
// derived previews and export receipts, but includes every editable project field.
// Source Blobs and cache payloads are immutable; their revision/cache IDs bind them.
function projectFingerprint() {
  return JSON.stringify({ currentId, photos: photos.map(p => ({
    id: p.id, name: p.name, sourceRevision: sourceRevisionOf(p),
    source: [p.blob.size, p.blob.type, p.originalWidth, p.originalHeight],
    selected: p.selected, review: reviewOf(p), settings: p.settings, committed: p.committed,
    undo: p.undo, redo: p.redo, revision: p.revision, preset: p.preset || null,
    learnedCache: Array.from(p.learnedCache?.values() || [], entry => [entry.id, entry.kind, entry.sourceRevision, entry.bytes]),
    imageAssets:(p.imageAssets||[]).map(a=>[a.id,a.width,a.height]),
    latestMatteId: p.latestMatteId || null, lastSelectedMatteId: p.lastSelectedMatteId || null
  })) });
}
function hasUnsavedProjectChanges() { return recoveredProjectUnsaved || (savedProjectFingerprint === null ? photos.length > 0 : projectFingerprint() !== savedProjectFingerprint); }
function updateNativeDirty() {
  const dirty = !!perspectiveDraft || exportRunning || !!backendJob || !!projectOperation || !!presetOperation || !!imagePanel?.hasDraft || !!imagePanel?.importing || hasUnsavedProjectChanges();
  if (dirty === lastNativeDirty) return;
  lastNativeDirty = dirty;
  bridge?.setSessionDirty?.(dirty);
}
function historyCommit(p) {
  if (!p || JSON.stringify(p.committed) === JSON.stringify(p.settings)) return;
  p.undo.push(clone(p.committed)); if (p.undo.length > 40) p.undo.shift();
  p.redo.length = 0; p.committed = clone(p.settings); p.revision++;
  retainImageAssets(p);
  updateCards(); updateAvailability();
}
function changeSettings(changes, commit = true) {
  const p = current(); if (!p || !photoAvailable()) return;
  if (perspectiveActive(p.settings) && ['framing','straighten'].some(key=>Object.hasOwn(changes,key)&&JSON.stringify(changes[key])!==JSON.stringify(p.settings[key]))) {toast('请先重置透视，再调整上游裁剪、旋转或调平；已有编辑未改变。',true);return false;}
  if (tool === 'white-balance') setTool('pan');
  cancelCropDraft(); finishManualStroke(false); finishRedactionStroke(false); finishPaintStroke(false);
  const candidate = { ...p.settings, ...changes };
  try { imageAssetsFor(p,candidate); } catch(error) { toast(`贴图素材引用无效：${error.message||error}`,true); return false; }
  try { validatePeopleSettings(candidate,p); } catch(error) { toast(peopleError(error),true); updateControls(); return false; }
  if (candidate.paintLayers) { try { paintCore().validate(candidate.paintLayers, paintContext(p,candidate)); } catch(error) { toast(`未更改：${error.message || error}。请先撤销或清除绘画，再更改构图/形变。`,true); updateControls(); return false; } }
  if (candidate.redactions) { try { redactionCore().validate(candidate.redactions, redactionContext(p,candidate)); } catch(error) { toast(`未更改：${error.message || error}。请先撤销或清除遮盖，再更改构图/形变。`,true); updateControls(); return false; } }
  if (candidate.manualLiquify?.length && manualGeometryConflict(candidate)) { toast('手动推拉不能与原图定位的自动塑形或背景处理同时使用。请先将背景设为原始、自动塑形归零，或先撤销/清除手动推拉。', true); updateControls(); return; }
  Object.assign(p.settings, changes); p.preset = null;
  if (commit) historyCommit(p);
  updateControls(); scheduleRender(); return true;
}
function scheduleRender(delay = 70) {
  if(pageDisposed)return;
  finishRedactionStroke(false); finishPaintStroke(false); acceptedRender = null; renderPending = true; renderFailure = ''; cancelReferenceGesture(); clearPreviewPixelInspector();
  finishManualStroke(false); if (manualToolActive()) manualViewReady = false;
  clearTimeout(renderTimer); renderVersion++;
  clearToneHistogram('调整已改变，等待新的处理预览。');
  renderController?.abort();
  renderTimer = setTimeout(() => { renderTimer = null; renderCurrent(); }, delay);
  updateReferenceComparison();
  if (manualToolActive()) updateManualControls();
}
async function renderCurrent() {
  if(pageDisposed)return;
  clearTimeout(renderTimer); renderTimer = null; acceptedRender = null; renderPending = true; renderFailure = ''; cancelReferenceGesture(); clearPreviewPixelInspector();
  const p = current(); if (!p || !source || loadingPhoto || exportRunning || projectOperation || presetOperation) return;
  const token = viewToken, version = ++renderVersion, input = source, sourceRevision = sourceRevisionOf(p);
  const blob = p.blob, recipeKey = renderRecipeKey(p.settings);
  const whiteBalancePicking = tool === 'white-balance';
  const settings = perspectiveDraftCurrent() ? perspectiveInputSettings(p.settings) : whiteBalancePicking ? Pipeline.lightBalanceInputSettings(p.settings) : clone(p.settings), manualEditing = manualToolActive(), legacyPointEditing = tool === 'brush', sourceView = sourceViewActive(), displayMode = currentDisplayMode(), displayStamp = currentDisplayStamp();
  requestedDisplayMode = displayMode;
  if (manualEditing) manualViewReady = false;
  renderController?.abort(); const controller = new AbortController(); renderController = controller;
  renderingPhoto = true; clearToneHistogram('正在更新处理预览…'); updateBusy();
  try {
    const facts = factsForPhoto(p, analysis, input, (manualEditing || legacyPointEditing) ? { ...settings, learnedMatteId: null } : settings);
    const raster = await Pipeline.render(input, settings, facts, { signal: controller.signal, manualEditing: manualEditing || legacyPointEditing, sourceView, deferTextLayers:true, deferPaintLayers:true, deferRedactions:true, imageAssets:(manualEditing||legacyPointEditing||sourceView||whiteBalancePicking)?[]:imageAssetsFor(p,settings), ...((straightenActive(settings)||perspectiveActive(settings)||sharpnessActive(settings)||imageActive(settings))?{retainedBytes:straightenRetainedBytes(input,p)}:{}) });
    if (controller.signal.aborted || token !== viewToken || version !== renderVersion || p !== current() || blob !== p.blob || input !== source || sourceRevision !== sourceRevisionOf(p) || displayStamp !== currentDisplayStamp() || (recipeKey !== null && recipeKey !== renderRecipeKey(p.settings))) return;
    const rawSize = sourceView ? {width:input.width,height:input.height} : finalCanvasPlan(input.width,input.height,settings,true).outputSize;
    if (raster.width !== rawSize.width || raster.height !== rawSize.height) throw new Error('处理栅格尺寸与当前构图/留白不一致');
    requirePerspectiveReceipt(sourceView?null:finalCanvasPlan(input.width,input.height,settings,true).perspectiveReceipt,raster);
    if(!sourceView&&(straightenActive(settings)||perspectiveActive(settings))) {
      const live=()=>!controller.signal.aborted&&token===viewToken&&version===renderVersion&&p===current()&&blob===p.blob&&input===source&&sourceRevision===sourceRevisionOf(p)&&displayStamp===currentDisplayStamp()&&recipeKey===renderRecipeKey(p.settings);
      await prepareStraightenedOriginal(input,p,settings,controller.signal,live,raster);
      if(!live())return;
    }
    let canvas = raster;
    if(!sourceView && textActive(settings)){
      const live=()=>!controller.signal.aborted&&token===viewToken&&version===renderVersion&&p===current()&&blob===p.blob&&sourceRevision===sourceRevisionOf(p)&&displayStamp===currentDisplayStamp()&&recipeKey===renderRecipeKey(p.settings);
      const overlay=await prepareTextRaster(p,settings,exportMode(),controller.signal,live);
      canvas=await textRenderer().compositePreview(canvas,overlay,{signal:controller.signal,isCurrent:live});
      if(!live())return;
    }
    if(!sourceView && paintActive(settings)){
      const live=()=>!controller.signal.aborted&&token===viewToken&&version===renderVersion&&p===current()&&blob===p.blob&&sourceRevision===sourceRevisionOf(p)&&displayStamp===currentDisplayStamp()&&recipeKey===renderRecipeKey(p.settings);
      const overlay=await preparePaintRaster(p,settings,exportMode(),controller.signal,live);
      canvas=await paintRenderer().compositePreview(canvas,overlay,{signal:controller.signal,isCurrent:live});
      if(!live())return;
    }
    if(!sourceView) { canvas=applyRedactionCanvas(canvas,p,settings,{width:input.width,height:input.height},controller.signal); canvas=boundedDisplayPreview(canvas); }
    const size = previewDimensions();
    if (canvas.width !== size.width || canvas.height !== size.height) throw new Error('处理预览尺寸与当前构图不一致，未显示错位结果');
    renderedDisplayStamp = displayStamp; rendered = canvas; renderedManualMode = manualEditing; manualViewReady = manualEditing; manualViewStamp = manualEditing ? `${p.id}/${sourceRevision}` : null;
    acceptedRender = { photo: p, blob, input, canvas, sourceRevision, generation: version, viewToken: token, mode: displayMode, displayStamp, recipeKey, width: canvas.width, height: canvas.height };
    renderPending = false;
    if(perspectiveDraftCurrent())clearToneHistogram('四角输入视图，直方图暂停；应用或取消后恢复。');else updateToneHistogram(canvas, { token, version, photoId: p.id, sourceRevision, manualEditing, sourceView });
    drawPreview(); status(perspectiveDraftCurrent() ? '四角输入视图已就绪 · 点击所选角点 · 应用后才修改照片' : whiteBalancePicking ? '中性取样输入已就绪 · 点击应为灰/白色的非过曝区域 · Esc 取消' : manualEditing ? '手动编辑视图已就绪 · 完整原图坐标 · 构图/背景/自动塑形暂不显示' : legacyPointEditing ? '点修视图已就绪 · 完整原图坐标 · 构图/背景/自动塑形暂不显示' : sourceView ? '完整原图坐标视图已就绪 · 构图暂不显示' : '调整已应用 · 原图未修改');
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError' || token !== viewToken || version !== renderVersion) return;
    acceptedRender = null; renderFailure = String(error.message || error); clearPreviewPixelInspector();
    if (settings.learnedMatteId) { p.learnedError = `学习型蒙版处理失败：${error.message || error}。当前显示原图，没有回退。`; rendered = null; drawPreview(); }
    clearToneHistogram('处理尚未完成，直方图不可用。');
    toast(`处理失败：${error.message || error}。你可以撤销调整后重试。`, true); status('调整未完成，请重试或撤销');
  } finally {
    if (token === viewToken && version === renderVersion) { renderingPhoto = false; renderPending = false; updateBusy(); updateAvailability(); }
  }
}
// The working source, masks, strokes and analysis never change coordinate systems.
// Only the final view/export is framed. A mode+source+recipe stamp rejects late renders.
function geometryReady() { return ['defaults','validate','isActive','plan','apply','mapEdgePoint'].every(key => typeof window.MintGeometry?.[key] === 'function'); }
function framingPlan(width, height, recipe) {
  if (!recipe || (geometryReady() && !window.MintGeometry.isActive(recipe))) return { sourceSize: { width, height }, crop: { x: 0, y: 0, width, height }, outputSize: { width, height }, quarterTurns: 0, flipX: false, flipY: false };
  if (geometryReady()) return window.MintGeometry.plan(width, height, recipe || null);
  throw new Error('构图组件不可用，未忽略已有裁剪/旋转');
}
function planDimensions(plan) { return plan.outputSize; }
function framingOriginalSupported(p = current()) { return !!p && p.originalWidth <= 32768 && p.originalHeight <= 32768 && p.originalWidth * p.originalHeight <= 80000000; }
function sourceViewActive() {
  const p = current();
  return tool === 'white-balance' || manualToolActive() || tool === 'brush' || tool.startsWith('matte-') || !!(p && (
    (p.localInspect && selectedLocalLayer()) || (p.matteInspect && cachedResult(p, p.settings.learnedMatteId, 'matting')) ||
    ($('peopleInspect')?.checked && p.settings.faceAdjustments?.faces.length) || ($('learnedFaceBoxes').checked && analysis?.landmarks?.length) || (p.settings.diagnosticOverlay && cachedResult(p, p.settings.diagnosticParseId, 'parse'))));
}
function currentDisplayMode() { return perspectiveDraftCurrent() ? 'perspective-input' : tool === 'white-balance' ? 'white-balance-input' : manualToolActive() ? 'manual-source' : tool === 'brush' ? 'point-source' : sourceViewActive() ? 'source' : 'framed'; }
function currentDisplayStamp() { const p = current(); return p ? `${p.id}/${sourceRevisionOf(p)}/${currentDisplayMode()}/${JSON.stringify([p.settings.framing || null, p.settings.straighten || null, p.settings.perspective || null, p.settings.canvasPadding || null,p.settings.textLayers || [],p.settings.imageLayers || [],exportMode()])}` : ''; }
function sourceWorkingViewReady() { return !!rendered && renderedDisplayStamp === currentDisplayStamp() && sourceViewActive() && rendered.width === source?.width && rendered.height === source?.height; }
function paddingReady() { return ['defaults','validate','measure','plan','apply'].every(key => typeof window.MintCanvasPadding?.[key] === 'function'); }
function paddingPlan(width, height, recipe, render = false) {
  if (recipe == null) return { inputSize: {width,height}, outputSize: {width,height}, padding: {top:0,right:0,bottom:0,left:0} };
  if (!paddingReady()) throw new Error('边框组件不可用，未忽略已有留白');
  return render ? window.MintCanvasPadding.plan(width,height,recipe,{maxPixels:16777216,maxEdge:16384}) : window.MintCanvasPadding.measure(width,height,recipe);
}
function straightenReady() { return ['defaults','validate','isActive','plan','apply'].every(key=>typeof window.MintStraighten?.[key]==='function'); }
function straightenActive(settings=current()?.settings) { return settings?.straighten != null && settings.straighten.angle !== 0; }
function straightenPlan(width,height,recipe,render=false) {
  if(recipe==null)return {outputSize:{width,height},recipe:null};
  if(!straightenReady())throw new Error('调平组件不可用，未忽略已保存角度');
  const clean=window.MintStraighten.validate(recipe);
  if(clean.angle===0)return {outputSize:{width,height},recipe:null};
  const plan=window.MintStraighten.plan(width,height,clean),max=render?16777216:64000000;
  for(const size of [{width,height},plan.outputSize])if(size.width>16384||size.height>16384||size.width*size.height>max)throw new Error(`调平中间画布超过${render?'预览1677万':'原尺寸6400万'}像素/16384长边预算；缩小最终文件不能绕过此上限`);
  return plan;
}
function finalCanvasPlan(width, height, settings, render = false) {
  const framed = planDimensions(framingPlan(width,height,settings?.framing));
  const rotation=straightenPlan(framed.width,framed.height,settings?.straighten,render),straightened=rotation.outputSize;
  const perspective=perspectivePlan(straightened.width,straightened.height,settings?.perspective,render),perspected=perspective.outputSize;
  return {framed,straightened,perspected,perspectiveReceipt:perspective.receipt,straightenRecipe:rotation.recipe, ...paddingPlan(perspected.width,perspected.height,settings?.canvasPadding,render)};
}
// Additional operation-owned buffers, not a claim about process RSS or all open photos.
function straightenRetainedBytes(input,p=current(),extra=[]) {
  const canvases=new Set([rendered,framedOriginalCache?.canvas,referenceSnapshot?.canvas,referenceRightCanvas,$('previewCanvas'),...extra]);canvases.delete(input);
  let bytes=p?.blob?.size||0;
  for(const c of canvases)if(c&&Number.isInteger(c.width)&&Number.isInteger(c.height))bytes+=c.width*c.height*4;
  const buffers=new Set();for(const value of [analysis?.mask?.data,textRasterCache?.raster?.rgba,paintRasterCache?.raster?.rgba])if(ArrayBuffer.isView(value))buffers.add(value.buffer);
  for(const buffer of buffers)bytes+=buffer.byteLength;
  return bytes;
}
function originalGeometryKey(settings) { return JSON.stringify([settings.framing||null,settings.straighten||null,settings.perspective||null,settings.canvasPadding||null]); }
async function prepareStraightenedOriginal(input,p,settings,signal,isCurrent,processedCanvas) {
  if(!straightenActive(settings)&&!perspectiveActive(settings))return;
  const key=originalGeometryKey(settings),revision=sourceRevisionOf(p);
  if(framedOriginalCache?.source===input&&framedOriginalCache.photo===p&&framedOriginalCache.sourceRevision===revision&&framedOriginalCache.key===key)return;
  const clean={...defaults(),framing:clone(settings.framing),straighten:clone(settings.straighten),perspective:clone(settings.perspective??null),canvasPadding:clone(settings.canvasPadding)};
  const raster=await Pipeline.render(input,clean,{sourceRevision:revision,faceCount:0,landmarks:[],mask:null},{signal,retainedBytes:straightenRetainedBytes(input,p,[processedCanvas]),deferTextLayers:true,deferPaintLayers:true,deferRedactions:true});
  if(signal.aborted||!isCurrent())return;
  const expected=finalCanvasPlan(input.width,input.height,settings,true).outputSize;
  if(raster.width!==expected.width||raster.height!==expected.height)throw new Error('同构图原图尺寸不匹配，未显示错误对比');
  requirePerspectiveReceipt(finalCanvasPlan(input.width,input.height,settings,true).perspectiveReceipt,raster);
  const canvas=boundedDisplayPreview(raster);
  if(signal.aborted||!isCurrent())return;
  framedOriginalCache={source:input,photo:p,sourceRevision:revision,key,canvas};
}
function boundedPreviewSize(size) { const scale=Math.min(1,1280/Math.max(size.width,size.height));return {width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))}; }
function boundedDisplayPreview(raster) {
  const size=boundedPreviewSize(raster);if(size.width===raster.width&&size.height===raster.height)return raster;
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(raster,0,0,size.width,size.height);return canvas;
}
function previewDimensions() { return !source ? { width: 1, height: 1 } : sourceViewActive() ? { width: source.width, height: source.height } : boundedPreviewSize(finalCanvasPlan(source.width,source.height,perspectiveDraftCurrent()?perspectiveInputSettings(current().settings):current()?.settings,true).outputSize); }
function originalForView() {
  if(perspectiveDraftCurrent())return null;
  if (sourceViewActive() || (!current()?.settings.framing && !straightenActive() && !perspectiveActive() && !current()?.settings.canvasPadding)) return source;
  const key = originalGeometryKey(current().settings);
  if (framedOriginalCache?.source === source && framedOriginalCache.key === key && (!(straightenActive()||perspectiveActive()) || framedOriginalCache.photo === current() && framedOriginalCache.sourceRevision === sourceRevisionOf(current()))) return framedOriginalCache.canvas;
  // Arbitrary resampling is prepared asynchronously by the cancellable pixel worker.
  if (straightenActive()||perspectiveActive()) return null;
  if (current().settings.framing && !geometryReady()) throw new Error('构图组件不可用');
  if (current().settings.canvasPadding && !paddingReady()) throw new Error('边框组件不可用');
  const pixels = source.getContext('2d').getImageData(0, 0, source.width, source.height);
  let result = { width: source.width, height: source.height, data: pixels.data };
  if (current().settings.framing) result = window.MintGeometry.apply(result,current().settings.framing);
  if (current().settings.canvasPadding) result = window.MintCanvasPadding.apply(result,current().settings.canvasPadding,{maxPixels:16777216,maxEdge:16384});
  const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(result.width, result.height); image.data.set(result.data); ctx.putImageData(image, 0, 0);
  const bounded=boundedDisplayPreview(canvas);framedOriginalCache = { source, key, canvas:bounded }; return bounded;
}
function drawPreview() {
  refreshPreviewPixelReadout();
  if (!source) { updateReferenceComparison(); return; }
  if (cropDraft && (!cropDraftCurrent() || sourceViewActive())) cancelCropDraft();
  const mode = currentDisplayMode();
  if (requestedDisplayMode !== mode) { requestedDisplayMode = mode; renderedDisplayStamp = null; manualViewReady = false; scheduleRender(0); }
  const canvas = $('previewCanvas'), ctx = canvas.getContext('2d'); let size;
  try { size=previewDimensions(); } catch(error) { canvas.width=1;canvas.height=1;ctx.clearRect(0,0,1,1);status(`预览未显示：${error.message||error}`);return; }
  const manualEditing = manualToolActive() && !originalHeld, sourceView = sourceViewActive();
  let localOutline = tool !== 'white-balance' && !manualEditing && !!current()?.localInspect && !!selectedLocalLayer() && !originalHeld, diagnostic = tool !== 'white-balance' && !manualEditing && diagnosticViewActive() && !localOutline;
  const resized = canvas.width !== size.width || canvas.height !== size.height;
  if (resized) { canvas.width = size.width; canvas.height = size.height; }
  const original = originalForView(), accepted = renderedDisplayStamp === currentDisplayStamp() ? rendered : null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const visible=originalHeld || diagnostic || localOutline ? original : (accepted || original);
  if(visible)ctx.drawImage(visible,0,0);
  if (compare && original && !originalHeld && !sourceView && !cropDraft) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.round(canvas.width * split), canvas.height); ctx.clip();
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(original, 0, 0); ctx.restore();
  }
  if (diagnostic) {
    try { drawLearnedDiagnostics(ctx); }
    catch (error) { diagnostic = false; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0); const p = current(); if (p) p.learnedError = `诊断蒙版无法显示：${error.message || error}。当前显示原图，没有回退。`; $('learnedError').textContent = p?.learnedError || ''; $('learnedError').hidden = false; }
  }
  if (localOutline && !diagnostic) drawLocalOutline(ctx, current());
  if (manualEditing) drawManualOverlay(ctx);
  if (!sourceView && !originalHeld) { drawPaintDraft(ctx); drawRedactionDraft(ctx); }
  const inspectedPhoto = current();
  $('diagnosticBadge').textContent = tool === 'white-balance' ? '白平衡取样输入 · 修肤/基础调色后，明暗/色阶/曲线/局部/构图前 · 8位预览，非 RAW' : manualEditing ? '手动编辑 · 完整原图坐标 · 构图/背景/自动塑形暂不显示' : tool === 'brush' ? '点修 · 完整原图坐标 · 构图/背景/自动塑形暂不显示' : localOutline && !diagnostic ? '局部图层范围 · 完整原图坐标 · 构图暂不显示 · 边界不导出' : inspectedPhoto?.matteInspect ? `人物蒙版 · ${inspectedPhoto.matteInspectOriginal ? '模型原始' : '含手动修正'} · 完整原图坐标 · 构图暂不显示` : '人脸解析诊断 · 完整原图坐标 · 构图暂不显示 · 不导出';
  $('diagnosticBadge').hidden = !sourceView || originalHeld;
  for (const id of ['compareDivider','beforeTag','afterTag']) $(id).hidden = !compare || !original || originalHeld || sourceView || !!cropDraft;
  $('compareDivider').style.left = `${split * 100}%`;
  $('originalBadge').textContent = sourceView ? '完整原图 · 松开空格返回' : '原图 · 同构图/调平/留白，未加文字或遮盖 · 松开空格返回';
  $('originalBadge').hidden = !originalHeld || !original;
  drawCropOverlay();drawPerspectiveOverlay(ctx);
  if (resized && fitMode) fit(); else positionSurface();
  updateReferenceComparison();
}
function positionSurface() {
  if (!source) return;
  const surface = $('imageSurface'), size = previewDimensions();
  surface.style.width = `${size.width * zoom}px`; surface.style.height = `${size.height * zoom}px`;
  surface.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;
  $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
  $('zoomLabel').title = '预览像素缩放比；点击恢复适合画布';
  refreshPreviewPixelReadout();
}
function fit() {
  cancelWhiteBalancePointer();
  if (referenceComparisonVisible()) { fitReference(); return; }
  if (!source) return;
  finishManualStroke(false); finishMatteStroke(false);
  const size = previewDimensions();
  zoom = Math.min(($('viewport').clientWidth - 58) / size.width, ($('viewport').clientHeight - 42) / size.height, 1);
  zoom = Math.max(.05, zoom); panX = 0; panY = 0; fitMode = true; positionSurface();
}
function zoomBy(factor, center) {
  cancelWhiteBalancePointer();
  if (referenceComparisonVisible()) { zoomReference(factor, $('referenceCurrentPane'), center); return; }
  if (!photoAvailable()) return;
  finishManualStroke(false); finishMatteStroke(false);
  const old = zoom; zoom = Math.max(.05, Math.min(4, zoom * factor));
  if (center) {
    const rect = $('viewport').getBoundingClientRect();
    const x = center.x - rect.left - rect.width / 2, y = center.y - rect.top - rect.height / 2;
    panX = x - (x - panX) * zoom / old; panY = y - (y - panY) * zoom / old;
  } else { panX *= zoom / old; panY *= zoom / old; }
  fitMode = false; positionSurface();
}
function setCompare(value) {
  cancelPerspectiveDraft(); cancelStraightenDraft(); cancelSharpnessDraft();
  cancelReferenceGesture(); if (value) referenceRequested = false;
  if (value) cancelCropDraft();
  if (value && (manualToolActive() || redactionToolActive() || paintToolActive() || tool === 'brush' || tool === 'white-balance')) setTool('pan');
  compare = value; $('editView').classList.toggle('active', !value); $('compareView').classList.toggle('active', value);
  $('editView').setAttribute('aria-pressed', String(!value)); $('compareView').setAttribute('aria-pressed', String(value));
  drawPreview();
}
function setTool(value) {
  if(imagePanel?.placing||pointer?.kind==='image-position'){if(pointer?.kind==='image-position'){const id=pointer.id;pointer=null;try{if(viewport.hasPointerCapture?.(id))viewport.releasePointerCapture(id);}catch{}}imagePanel?.cancelPlacement();}
  finishRedactionStroke(false); finishPaintStroke(false);
  cancelReferenceGesture();
  cancelCropDraft();
  const wasManual = manualToolActive(), wasMode = currentDisplayMode();
  if (value.startsWith('paint-') && (!photoAvailable() || !paintReady() || backendJob)) return;
  if (value.startsWith('paint-') && current()?.settings.diagnosticOverlay && cachedResult(current(),current().settings.diagnosticParseId,'parse')) {toast('请先关闭人脸解析诊断叠层，再在最终画布绘画。');return;}
  if (value.startsWith('redact-') && (!photoAvailable() || !redactionReady() || backendJob)) return;
  if (value.startsWith('redact-') && current()?.settings.diagnosticOverlay && cachedResult(current(),current().settings.diagnosticParseId,'parse')) {toast('请先关闭人脸解析诊断叠层，再在最终画布遮盖；不会把诊断图当作导出结果。');return;}
  if (value === 'white-balance' && (!lightBalanceReady() || !photoAvailable() || analyzingPhoto || backendJob || typeof Pipeline.lightBalanceInputSettings !== 'function')) return;
  if(value==='white-balance' && !whiteBalanceFaceStageReady()){toast('已启用修肤，但还没有真实人脸结果。请先完成检测，或明确重置修肤后再取样。',true);return;}
  if (value !== 'white-balance') { whiteBalancePick = null; cancelWhiteBalancePointer(); }
  finishManualStroke(false);
  if (manualToolNames.includes(value) && (!photoAvailable() || !manualCoreReady() || backendJob)) return;
  if (value === 'brush' && current()?.settings.manualLiquify?.length) { toast('已有手动推拉，旧版点修不能准确定位原图。请使用“手动修复/克隆”；已有点修与历史保持不变。'); return; }
  if (value.startsWith('repair-') && !repairCoreReady()) return;
  if (value === 'repair-heal' || value === 'repair-clone') repairMode = value === 'repair-clone' ? 'clone' : 'heal';
  if (value.startsWith('liquify-') && current()?.settings.manualRepair?.length) { toast('请先完成推形，再修复；已有修复请先撤销或清除修复后推形。'); return; }
  if (value.startsWith('liquify-') && current() && manualGeometryConflict(current().settings)) { toast('先将背景设为原始，并把自动塑形归零，再使用手动推拉；不会自动替你清除已有参数。'); return; }
  if (matteDraft) finishMatteStroke(false);
  const p = current(), matteTool = value === 'matte-keep' || value === 'matte-remove';
  if (matteTool && (!p || !cachedResult(p, p.settings.learnedMatteId, 'matting') || backendJob)) return;
  if (manualToolNames.includes(value) || value === 'brush') { p.matteInspect = false; p.localInspect = false; $('learnedFaceBoxes').checked = false; setCompare(false); }
  if(value.startsWith('redact-')||value.startsWith('paint-')) { cancelTextPlacement(); originalHeld=false; p.matteInspect=false;p.localInspect=false;$('learnedFaceBoxes').checked=false;setCompare(false);referenceRequested=false; }
  if (value === 'white-balance') {
    cancelTextPlacement(); originalHeld = false; p.matteInspect = false; p.localInspect = false; $('learnedFaceBoxes').checked = false; setCompare(false);
    whiteBalancePick = {photo:p,blob:p.blob,source:source,sourceRevision:sourceRevisionOf(p),recipeKey:renderRecipeKey(p.settings)};
  }
  if (matteTool) { p.matteInspect = true; p.matteInspectOriginal = false; setCompare(false); }
  tool = value; $('panTool').classList.toggle('active', value === 'pan'); $('brushTool').classList.toggle('active', value === 'brush');
  $('healBtn').classList.toggle('active', value === 'brush');
  $('healBtn').innerHTML = icon('brush') + (value === 'brush' ? '点修画笔已开启' : '开启点修画笔');
  $('viewport').classList.toggle('brush-mode', value === 'brush');
  $('viewport').classList.toggle('mask-brush-mode', matteTool);
  $('viewport').classList.toggle('manual-tool-mode', manualToolActive());
  $('viewport').classList.toggle('redaction-tool-mode', redactionToolActive());
  $('viewport').classList.toggle('paint-tool-mode', paintToolActive());
  $('matteKeepTool').classList.toggle('active', value === 'matte-keep'); $('matteRemoveTool').classList.toggle('active', value === 'matte-remove');
  if (matteTool) { $('learnedMatteInspect').checked = true; $('learnedRawMatte').checked = false; }
  $('toolHint').textContent = value === 'brush' ? '完整原图坐标点修 · 等待预览就绪后点击瑕疵' : '拖拽平移 · 滚轮缩放 · 按住空格查看原图';
  if (matteTool) $('toolHint').textContent = `原图蒙版${value === 'matte-keep' ? '保留' : '去除'} · 拖拽绘制，松开应用`;
  if(paintToolActive())$('toolHint').textContent=tool==='paint-pick'?'点击已完成预览取绘画颜色 · 不含棋盘格':'独立绘画层 · 橡皮只擦本层 · 松开应用 · Esc取消';
  if(redactionToolActive())$('toolHint').textContent='最终画布遮盖 · 松开应用 · Esc取消 · 改构图前先清除遮盖';
  if (manualToolActive()) $('toolHint').textContent = value.startsWith('selection-') ? '拖动绘制选区 · 松开应用 · Esc 取消这一笔' : value === 'repair-sample' ? '点击干净的相近纹理取样 · 松开确认 · Esc 取消' : value.startsWith('repair-') ? '短笔涂抹小瑕疵 · 松开应用 · Esc 取消这一笔' : '拖动推拉 / 恢复 · 松开应用 · Esc 取消这一笔';
  $('viewport').classList.toggle('white-balance-mode', value === 'white-balance');
  if (value === 'white-balance') $('toolHint').textContent = '点击应为灰/白的非过曝小区域 · 不要选择皮肤 · Esc 取消 · 滚轮缩放';
  if (value !== 'brush' && !matteTool) $('brushCursor').hidden = true;
  if (wasManual !== manualToolActive() || wasMode !== currentDisplayMode()) { requestedDisplayMode = currentDisplayMode(); renderedDisplayStamp = null; manualViewReady = false; scheduleRender(0); }
  updateManualControls(); updateRedactionControls(); updatePaintControls(); updateFramingControls(); updateLightBalanceControls(); drawPreview();
}

// Crop drafts are bounded to one photo/source/settings snapshot and never enter
// settings, history, project archives, exports, masks or learned-result caches.
function cropDraftCurrent() { const p = current(); return !!cropDraft && !!p && cropDraft.photoId === p.id && cropDraft.sourceRevision === sourceRevisionOf(p) && cropDraft.baseKey === JSON.stringify(p.settings.framing || null); }
function cancelCropDraft() {
  cancelPerspectiveDraft(); cancelStraightenDraft(); cancelSharpnessDraft();
  if (!cropDraft) return;
  cropDraft = null;
  const id = pointer?.kind === 'crop' ? pointer.id : null;
  if (id !== null) { pointer = null; if ($('viewport').hasPointerCapture?.(id)) $('viewport').releasePointerCapture(id); }
  $('cropOverlay').hidden = true; $('viewport').classList.remove('crop-mode');
  updateFramingControls(); updateStraightenControls(); updatePerspectiveControls(); updatePaddingControls(); updateTextControls(); imagePanel?.update();
  $('viewport').classList.toggle('image-place-mode',!!imagePanel?.placing);
  if($('imageLayerBasisMode')){ $('imageLayerBasisMode').value=exportMode(); $('imageLayerBasisMode').disabled=locked(); }
}
function prepareFramingView() {
  paddingDraft=null;
  if(perspectiveActive()){toast('请先重置透视，再调整裁剪、旋转或翻转；已有编辑未改变。');return false;}
  if(straightenActive()){toast('请先重置任意角度调平，再调整裁剪/90°旋转/翻转；已有编辑与历史保留。');return false;}
  const p = current(); if (!p || !photoAvailable() || !geometryReady() || backendJob) return false;
  if (!framingOriginalSupported(p)) { toast('此归档原图超出构图数值操作上限（8000万像素、单边32768）；原图、已有构图和历史保留。', true); return false; }
  setTool('pan'); p.localInspect = false; p.matteInspect = false; $('learnedFaceBoxes').checked = false; originalHeld = false;
  if (sourceViewActive()) { toast('请先关闭人脸解析诊断，再调整裁剪与旋转。'); drawPreview(); return false; }
  setCompare(false); return true;
}
function startCropDraft() {
  if (!prepareFramingView()) return;
  const p = current(); historyCommit(p);
  const recipe = window.MintGeometry.validate(p.settings.framing || null);
  cropDraft = { photoId: p.id, sourceRevision: sourceRevisionOf(p), baseKey: JSON.stringify(p.settings.framing || null), baseRecipe: clone(recipe), recipe, valid: true };
  $('viewport').classList.add('crop-mode'); $('framingSection').open = true;
  updateFramingControls(); updateStraightenControls(); updatePerspectiveControls(); updatePaddingControls(); updateTextControls(); imagePanel?.update();
  if($('imageLayerBasisMode')){ $('imageLayerBasisMode').value=exportMode(); $('imageLayerBasisMode').disabled=locked(); } drawPreview(); status('拖动框选，或输入完整原图像素坐标；点击应用才会保存裁剪，Esc 取消');
}
function normalizedPixelCrop(p, x, y, width, height) { return { x: x / p.originalWidth, y: y / p.originalHeight, w: width / p.originalWidth, h: height / p.originalHeight }; }
function updateNumericCrop() {
  if (!cropDraftCurrent()) { cancelCropDraft(); return; }
  const p = current(), values = ['cropX','cropY','cropWidth','cropHeight'].map(id => $(id).value.trim() === '' ? NaN : Number($(id).value)), [x,y,width,height] = values;
  cropDraft.valid = values.every(Number.isInteger) && x >= 0 && y >= 0 && width >= 1 && height >= 1 && x + width <= p.originalWidth && y + height <= p.originalHeight;
  if (cropDraft.valid) cropDraft.recipe.crop = normalizedPixelCrop(p, x, y, width, height);
  $('applyCrop').disabled = !cropDraft.valid || !!pointer;
  $('cropDraftStatus').textContent = cropDraft.valid ? '草稿未保存。数值为完整原图的像素边界；应用后才改变构图。' : '请输入原图范围内的整数；宽、高至少为 1 像素。未改变照片。';
  drawCropOverlay();
}
function cropEdgeAt(event, clamp = false) {
  if (!cropDraftCurrent() || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  const rect = $('imageSurface').getBoundingClientRect(), p = current(); if (rect.width <= 0 || rect.height <= 0) return null;
  const layout = finalCanvasPlan(source.width,source.height,p.settings,true);
  let x = ((event.clientX - rect.left) / rect.width * layout.outputSize.width - layout.padding.left) / layout.framed.width, y = ((event.clientY - rect.top) / rect.height * layout.outputSize.height - layout.padding.top) / layout.framed.height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  const size = window.MintGeometry.plan(p.originalWidth, p.originalHeight, cropDraft.baseRecipe).outputSize;
  return { x: Math.max(0, Math.min(1, x)) * size.width, y: Math.max(0, Math.min(1, y)) * size.height };
}
function beginCropDrag(event) {
  if (!cropDraftCurrent() || originalHeld || pointer) return;
  const edge = cropEdgeAt(event); if (!edge) return;
  cropDraft.valid = false; pointer = { kind: 'crop', id: event.pointerId, start: edge };
  $('viewport').setPointerCapture(event.pointerId); event.preventDefault(); updateFramingControls();
}
function appendCropDrag(event) {
  if (!cropDraftCurrent()) { cancelCropDraft(); return; }
  if (pointer?.kind !== 'crop') return;
  const end = cropEdgeAt(event, true), start = pointer.start, p = current(); if (!end) return;
  if (Math.abs(end.x - start.x) < 1e-9 || Math.abs(end.y - start.y) < 1e-9) { cropDraft.valid = false; updateFramingControls(); drawCropOverlay(); return; }
  const corners = [{ x: start.x, y: start.y }, { x: end.x, y: start.y }, { x: start.x, y: end.y }, { x: end.x, y: end.y }].map(point => window.MintGeometry.mapEdgePoint(p.originalWidth, p.originalHeight, cropDraft.baseRecipe, point, 'inverse'));
  if (corners.some(point => !point)) return;
  const x = Math.max(0, Math.min(p.originalWidth - 1, Math.round(Math.min(...corners.map(point => point.x))))), y = Math.max(0, Math.min(p.originalHeight - 1, Math.round(Math.min(...corners.map(point => point.y)))));
  const right = Math.max(x + 1, Math.min(p.originalWidth, Math.round(Math.max(...corners.map(point => point.x))))), bottom = Math.max(y + 1, Math.min(p.originalHeight, Math.round(Math.max(...corners.map(point => point.y)))));
  cropDraft.recipe.crop = normalizedPixelCrop(p, x, y, right - x, bottom - y); cropDraft.valid = true;
  updateFramingControls(); drawCropOverlay();
}
function acceptCropDraft() {
  if (cropDraft && !cropDraftCurrent()) { cancelCropDraft(); return; }
  if (!photoAvailable() || !cropDraft || !cropDraft.valid || pointer) return;
  const recipe = window.MintGeometry.validate(cropDraft.recipe); cancelCropDraft();
  if(changeSettings({ framing: window.MintGeometry.isActive(recipe) ? recipe : null })===false)return; drawPreview();
  status('已应用裁剪 · 原图与原图坐标编辑未改变 · 可撤销');
}
function framingAction(action) {
  if (!prepareFramingView()) return;
  const p = current(), recipe = window.MintGeometry.validate(p.settings.framing || null);
  if (action === 'left' || action === 'right') { recipe.quarterTurns = (recipe.quarterTurns + (action === 'left' ? 3 : 1)) % 4; [recipe.flipX, recipe.flipY] = [recipe.flipY, recipe.flipX]; }
  else if (action === 'horizontal') recipe.flipX = !recipe.flipX;
  else if (action === 'vertical') recipe.flipY = !recipe.flipY;
  else if (action !== 'reset') return;
  if(changeSettings({ framing: action === 'reset' || !window.MintGeometry.isActive(recipe) ? null : recipe })===false)return; drawPreview();
  status(action === 'reset' ? '已重置构图 · 其他调整保留 · 可撤销' : '已调整构图 · 原图坐标编辑保留 · 可撤销');
}
function drawCropOverlay() {
  const box = $('cropOverlay'); box.hidden = true;
  if (!cropDraftCurrent() || !cropDraft.valid || originalHeld) return;
  const p = current(), base = window.MintGeometry.plan(p.originalWidth, p.originalHeight, cropDraft.baseRecipe), crop = window.MintGeometry.plan(p.originalWidth, p.originalHeight, cropDraft.recipe).crop;
  // Numeric edits may restore cropped-out pixels. Only the intersection can be
  // outlined in this accepted view; the new extent appears after Apply.
  const x = Math.max(base.crop.x, crop.x), y = Math.max(base.crop.y, crop.y), right = Math.min(base.crop.x + base.crop.width, crop.x + crop.width), bottom = Math.min(base.crop.y + base.crop.height, crop.y + crop.height);
  if (right <= x || bottom <= y) return;
  const corners = [{x,y},{x:right,y},{x,y:bottom},{x:right,y:bottom}].map(point => window.MintGeometry.mapEdgePoint(p.originalWidth, p.originalHeight, cropDraft.baseRecipe, point, 'forward'));
  if (corners.some(point => !point)) return;
  const left = Math.min(...corners.map(point => point.x)), top = Math.min(...corners.map(point => point.y));
  const layout = finalCanvasPlan(source.width,source.height,p.settings,true);
  box.style.left = `${(layout.padding.left + left / base.outputSize.width * layout.framed.width) / layout.outputSize.width * 100}%`; box.style.top = `${(layout.padding.top + top / base.outputSize.height * layout.framed.height) / layout.outputSize.height * 100}%`;
  box.style.width = `${(Math.max(...corners.map(point => point.x)) - left) / base.outputSize.width * layout.framed.width / layout.outputSize.width * 100}%`; box.style.height = `${(Math.max(...corners.map(point => point.y)) - top) / base.outputSize.height * layout.framed.height / layout.outputSize.height * 100}%`; box.hidden = false;
}
function updateFramingControls() {
  const p = current(), available = photoAvailable() && geometryReady() && framingOriginalSupported(p) && !backendJob && !straightenActive() && !perspectiveActive(), draft = cropDraftCurrent(), active = !!p?.settings.framing;
  for (const id of ['startCrop','rotateLeft','rotateRight','flipHorizontal','flipVertical','resetFraming']) $(id).disabled = !available || (id === 'resetFraming' && !active && !draft);
  $('startCrop').textContent = draft ? '重新框选裁剪' : '调整裁剪';
  $('cropDraftActions').hidden = !draft; $('cropDraftStatus').hidden = !draft;
  for (const id of ['cropX','cropY','cropWidth','cropHeight']) $(id).disabled = !available || !draft;
  $('applyCrop').disabled = !available || !draft || !cropDraft.valid || !!pointer;
  $('cancelCrop').disabled = !draft;
  $('framingStatus').textContent = !geometryReady() ? '构图组件不可用；裁剪/旋转已停用。' : !p ? '导入照片后可用；默认保留完整原图。' : perspectiveActive() ? '透视已启用。请先重置透视，再更改上游裁剪、旋转或翻转；历史仍可撤销。' : straightenActive() ? '任意角度调平已启用。请先重置调平，再更改裁剪、90°旋转或翻转；历史仍可撤销。' : sourceViewActive() ? '当前为完整原图坐标视图；离开源坐标工具后恢复构图。' : '非破坏性构图：先裁剪，再旋转，最后按当前画面翻转。';
  if (!p || !geometryReady()) { $('framingDimensions').textContent = ''; return; }
  if (!framingOriginalSupported(p)) {
    $('framingStatus').textContent = '归档原图超出构图数值操作上限（8000万像素、单边32768）；已有构图与原图保留，未改变历史。';
    $('framingDimensions').textContent = `原图 ${p.originalWidth} × ${p.originalHeight} px · 构图数值操作停用`;
    for (const id of ['cropX','cropY','cropWidth','cropHeight']) $(id).value = '';
    return;
  }
  const recipe = draft ? cropDraft.recipe : p.settings.framing, plan = window.MintGeometry.plan(p.originalWidth, p.originalHeight, recipe);
  if (!draft || cropDraft.valid) { for (const [id,key] of [['cropX','x'],['cropY','y'],['cropWidth','width'],['cropHeight','height']]) $(id).value = String(plan.crop[key]); }
  $('cropX').max = p.originalWidth - 1; $('cropY').max = p.originalHeight - 1; $('cropWidth').max = p.originalWidth; $('cropHeight').max = p.originalHeight;
  $('cropDraftStatus').textContent = draft && !cropDraft.valid ? '拖出有宽高的矩形，或输入有效原图像素坐标。未改变照片。' : '草稿未保存。可扩大数值范围恢复裁掉的像素；超出当前画面的部分在应用后显示。';
  const accepted = window.MintGeometry.plan(p.originalWidth, p.originalHeight, p.settings.framing).outputSize;
  $('framingDimensions').textContent = `原图 ${p.originalWidth} × ${p.originalHeight} → 构图 ${accepted.width} × ${accepted.height} px${draft ? ` · 草稿 ${plan.outputSize.width} × ${plan.outputSize.height}` : ''}`;
}
$('startCrop').addEventListener('click', startCropDraft);
$('applyCrop').addEventListener('click', acceptCropDraft);
$('cancelCrop').addEventListener('click', () => { cancelCropDraft(); drawPreview(); status('已取消裁剪草稿；照片未改变'); });
for (const id of ['cropX','cropY','cropWidth','cropHeight']) $(id).addEventListener('input', updateNumericCrop);
for (const [id, action] of [['rotateLeft','left'],['rotateRight','right'],['flipHorizontal','horizontal'],['flipVertical','vertical'],['resetFraming','reset']]) $(id).addEventListener('click', () => framingAction(action));


// Padding is an explicit final-canvas recipe. Unapplied form values are not image
// state, recovery data, presets, history or exports, and are bound to one revision.
const paddingFields = ['paddingTop','paddingRight','paddingBottom','paddingLeft','paddingColor','paddingOpacity'];
function paddingDraftCurrent() {
  const p=current(); return !!paddingDraft && !!p && paddingDraft.photo===p && paddingDraft.sourceRevision===sourceRevisionOf(p) && paddingDraft.revision===p.revision && paddingDraft.key===JSON.stringify([p.settings.framing||null,p.settings.straighten||null,p.settings.perspective||null,p.settings.canvasPadding||null]);
}
function paddingRecipeFromForm() {
  const recipe={version:1};
  for(const side of ['top','right','bottom','left']) { const text=$(`padding${side[0].toUpperCase()+side.slice(1)}`).value.trim(); const value=text===''?NaN:Number(text); if(!Number.isFinite(value)||value<0||value>50)throw new Error('每边留白需为 0–50% 的有限数值'); recipe[side]=value/100; }
  const opacity=$('paddingOpacity').value.trim(); recipe.opacity=opacity===''?NaN:Number(opacity)/100; recipe.color=$('paddingColor').value;
  return window.MintCanvasPadding.validate(recipe);
}
function straightenDraftCurrent() { const p=current();return !!straightenDraft&&!!p&&straightenDraft.photo===p&&straightenDraft.blob===p.blob&&straightenDraft.input===source&&straightenDraft.sourceRevision===sourceRevisionOf(p)&&straightenDraft.revision===p.revision&&straightenDraft.key===renderRecipeKey(p.settings); }
function cancelStraightenDraft() { if(!straightenDraft)return;straightenDraft=null;updateStraightenControls(); }
function straightenRecipeFromForm() {
  const raw=$('straightenAngle').value.trim(),recipe={version:1,angle:raw===''?NaN:Number(raw),mode:$('straightenMode').value};
  return window.MintStraighten.validate(recipe);
}
function updateStraightenControls() {
  if(straightenDraft&&!straightenDraftCurrent())straightenDraft=null;
  const p=current(),available=photoAvailable()&&straightenReady()&&!backendJob&&!cropDraft&&!sourceViewActive()&&!perspectiveActive();
  for(const id of ['straightenAngle','straightenMode'])$(id).disabled=!available;
  if(!straightenDraft){$('straightenAngle').value=String(p?.settings.straighten?.angle??0);$('straightenMode').value=p?.settings.straighten?.mode||'expand';}
  $('applyStraighten').disabled=!available||!straightenDraft;$('cancelStraighten').disabled=!straightenDraft;$('resetStraighten').disabled=!available||(!straightenActive()&&!straightenDraft);
  $('straightenStatus').textContent=!straightenReady()?'调平组件不可用；不会忽略已保存角度。':!p?'导入照片后可用。0°保持原样。':perspectiveActive()?'透视已启用。请先重置透视，再更改上游调平。':!available?'请返回普通查看并结束当前操作；已有调平保持不变。':straightenDraft?'角度输入尚未应用；点击应用才进入预览、历史和导出。':'正角度顺时针。任意角会重采样，可能轻微软化纹理；不属于无损旋转。';
  $('straightenDimensions').textContent='';
  if(p&&straightenReady())try{
    const recipe=straightenDraft?straightenRecipeFromForm():p.settings.straighten,candidate={...p.settings,straighten:recipe};
    if(source)finalCanvasPlan(source.width,source.height,candidate,true);
    let detail;try{const layout=finalCanvasPlan(p.originalWidth,p.originalHeight,candidate);detail=`原尺寸：构图 ${layout.framed.width} × ${layout.framed.height} → 调平 ${layout.straightened.width} × ${layout.straightened.height} px`;}catch(error){detail=`原尺寸不可处理：${error.message||error}；可检查明确选择的工作尺寸。`;}
    const active=recipe&&recipe.angle!==0;$('straightenDimensions').textContent=`${straightenDraft?'待应用 · ':''}${detail}${active&&recipe.angle%90===0?' · 精确90°倍数使用像素复制':active?' · 线性光预乘透明度双线性重采样':''}`;
  }catch(error){$('straightenDimensions').textContent=`未应用：${error.message||error}`;$('applyStraighten').disabled=true;}
}
function editStraightenForm() {
  const p=current();if(!photoAvailable()||!straightenReady()||backendJob||cropDraft||sourceViewActive()||perspectiveActive())return;
  if(!straightenDraftCurrent()){cancelSharpnessDraft();paddingDraft=null;cancelTextPlacement();finishPaintStroke(false);finishRedactionStroke(false);straightenDraft={photo:p,blob:p.blob,input:source,sourceRevision:sourceRevisionOf(p),revision:p.revision,key:renderRecipeKey(p.settings)};}
  updateStraightenControls();
}
function applyStraightenForm() {
  if(!straightenDraftCurrent()||!photoAvailable()||!straightenReady()||backendJob||cropDraft||sourceViewActive()||perspectiveActive())return;
  try{const recipe=straightenRecipeFromForm(),next=recipe.angle===0?null:recipe,p=current(),candidate={...p.settings,straighten:next};finalCanvasPlan(source.width,source.height,candidate,true);
    const same=JSON.stringify(next)===JSON.stringify(p.settings.straighten||null);
    if(same){straightenDraft=null;updateStraightenControls();status('角度未改变；没有新增历史');return;}
    if(typeof Pipeline.preflightRender!=='function')throw new Error('调平预算检查组件不可用，未修改照片。');
    Pipeline.preflightRender(source,candidate,factsForPhoto(p,analysis,source,candidate),{deferTextLayers:true,deferPaintLayers:true,deferRedactions:true,...((straightenActive(candidate)||sharpnessActive(candidate))?{retainedBytes:straightenRetainedBytes(source,p)}:{})});
    straightenDraft=null;if(changeSettings({straighten:next})===false)return;drawPreview();status('已应用调平 · 原件与原图坐标编辑保留 · 可撤销');
  }catch(error){toast(`调平未应用：${error.message||error}`,true);updateStraightenControls();}
}
for(const id of ['straightenAngle','straightenMode'])for(const event of ['input','change'])$(id).addEventListener(event,editStraightenForm);
$('applyStraighten').addEventListener('click',applyStraightenForm);
$('cancelStraighten').addEventListener('click',()=>{cancelStraightenDraft(); cancelSharpnessDraft();status('已取消调平输入，照片未改变');});
$('resetStraighten').addEventListener('click',()=>{if(!photoAvailable()||!straightenReady()||backendJob||cropDraft||sourceViewActive()||perspectiveActive())return;straightenDraft=null;if(changeSettings({straighten:null})===false)return;drawPreview();status('已重置调平 · 其他编辑保留 · 可撤销');});
function perspectiveReady(){return ['defaults','validate','isActive','plan','apply'].every(k=>typeof window.MintPerspective?.[k]==='function');}
function perspectiveActive(settings=current()?.settings){if(settings?.perspective==null)return false;if(!perspectiveReady())return true;return window.MintPerspective.isActive(settings.perspective);}
function perspectivePlan(width,height,recipe,render=false){
  if(recipe==null)return {outputSize:{width,height},receipt:null};
  if(!perspectiveReady())throw new Error('透视组件不可用，未忽略已保存四角');
  const clean=window.MintPerspective.validate(recipe);if(!window.MintPerspective.isActive(clean))return {outputSize:{width,height},receipt:null};
  const limit=render?16777216:64000000;
  if(width>16384||height>16384||width*height>limit)throw new Error('透视输入超出当前处理预算；缩小输出不能绕过源画布上限');
  const plan=window.MintPerspective.plan(width,height,clean);
  if(plan.outputSize.width*plan.outputSize.height>limit)throw new Error('透视输出超过当前像素预算');
  const receipt={version:1,recipe:plan.recipe,inputWidth:width,inputHeight:height,outputWidth:plan.outputSize.width,outputHeight:plan.outputSize.height,kind:plan.kind,resampling:plan.kind==='resample'?'linear-light-premultiplied-alpha-mip-anisotropic-bilinear':'none'};
  return {outputSize:plan.outputSize,receipt};
}
function requirePerspectiveReceipt(expected,result,details=false){
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v||{},k),actual=result?.perspectiveReceipt;
  if(expected ? !own(result,'perspectiveReceipt')||JSON.stringify(actual)!==JSON.stringify(expected) : own(result,'perspectiveReceipt'))throw new Error('透视处理回执与冻结配方/输入输出尺寸不匹配，未接受结果');
  if(details&&(expected ? !own(result?.details,'perspectiveReceipt')||JSON.stringify(result.details.perspectiveReceipt)!==JSON.stringify(expected)||result.details.perspective!==(expected.kind==='resample'?expected.resampling:'exact-byte-copy') : own(result?.details,'perspectiveReceipt')||own(result?.details,'perspective')))throw new Error('透视处理算法声明不匹配，未保存文件');
}
function perspectiveInputSettings(settings){return {...clone(settings),perspective:null,canvasPadding:null,imageLayers:[],textLayers:[],paintLayers:null,redactions:null};}
function perspectiveDraftCurrent(){const p=current();return !!perspectiveDraft&&!!p&&perspectiveDraft.photo===p&&perspectiveDraft.blob===p.blob&&perspectiveDraft.input===source&&perspectiveDraft.sourceRevision===sourceRevisionOf(p)&&perspectiveDraft.revision===p.revision&&perspectiveDraft.key===renderRecipeKey(p.settings)&&perspectiveDraft.basis===exportMode();}
function perspectiveInputReady(){return perspectiveDraftCurrent()&&!!acceptedRender&&acceptedRender.canvas===rendered&&acceptedRender.mode==='perspective-input'&&acceptedRender.displayStamp===currentDisplayStamp()&&!renderPending&&!renderFailure;}
function cancelPerspectivePointer(keep=false){
  if(pointer?.kind!=='perspective')return;const p=pointer;pointer=null;
  if(!keep&&perspectiveDraft===p.draft){perspectiveDraft.recipe=p.before;writePerspectiveForm();validatePerspectiveDraft();}
  try{if($('viewport').hasPointerCapture?.(p.id))$('viewport').releasePointerCapture(p.id);}catch{}
}
function cancelPerspectiveDraft(renderAgain=true){
  if(!perspectiveDraft)return;cancelPerspectivePointer(false);perspectiveDraft=null;updatePerspectiveControls();
  if(renderAgain&&source&&!pageDisposed)scheduleRender(0);
}
function writePerspectiveForm(){
  const recipe=perspectiveDraft?.recipe;if(!recipe)return;
  for(let i=0;i<4;i++)for(const axis of ['x','y'])$('perspective'+i+axis).value=String(recipe.quad[i][axis]*100);
  $('perspectiveWidth').value=String(recipe.outputFraction.width*100);$('perspectiveHeight').value=String(recipe.outputFraction.height*100);
}
function readPerspectiveForm(){
  const number=id=>{const raw=$(id).value.trim();return raw===''?NaN:Number(raw)/100;};
  return {version:1,quad:Array.from({length:4},(_,i)=>({x:number('perspective'+i+'x'),y:number('perspective'+i+'y')})),outputFraction:{width:number('perspectiveWidth'),height:number('perspectiveHeight')}};
}
function validatePerspectiveDraft(){
  if(!perspectiveDraftCurrent())return false;
  try{const clean=window.MintPerspective.validate(perspectiveDraft.recipe);finalCanvasPlan(source.width,source.height,{...current().settings,perspective:clean},true);perspectiveDraft.valid=true;perspectiveDraft.error='';return true;}
  catch(error){perspectiveDraft.valid=false;perspectiveDraft.error=error.message||String(error);return false;}
}
function updatePerspectiveControls(){
  if(!$('perspectiveSection'))return;
  if(perspectiveDraft&&!perspectiveDraftCurrent()){cancelPerspectivePointer(false);perspectiveDraft=null;}
  const p=current(),ready=perspectiveReady(),available=photoAvailable()&&ready&&!backendJob&&!sourceViewActive(),draft=!!perspectiveDraft;
  $('startPerspective').disabled=!available||draft;$('applyPerspective').disabled=!available||!draft||!perspectiveDraft.valid||!!pointer||!perspectiveInputReady();
  $('cancelPerspective').disabled=!draft;$('resetPerspective').disabled=!available||(!draft&&!perspectiveActive(p?.settings));
  $('perspectiveFields').hidden=!draft;for(const id of ['perspectiveCorner','perspectiveWidth','perspectiveHeight',...Array.from({length:4},(_,i)=>['perspective'+i+'x','perspective'+i+'y']).flat()])$(id).disabled=!available||!draft||!!pointer;
  $('perspectiveStatus').textContent=!ready?'透视组件不可用，已保存配方不会被忽略。':!p?'导入后可用；默认不改变画面。':draft?!perspectiveDraft.valid?`输入未应用：${perspectiveDraft.error}`:perspectiveInputReady()?'点击或拖动画面设置所选角点；数值也可编辑。应用前不进入历史。':'正在准备四角输入视图，请稍候；原件与已有编辑保留。':perspectiveActive(p.settings)?'四角矫正已应用；可撤销。请先重置透视，再更改上游裁剪或调平。':'手动选择一个凸四边形并展开为矩形；不是自动镜头校正。';
  $('perspectiveDimensions').textContent='';
  if(p&&ready)try{const settings=draft?{...p.settings,perspective:perspectiveDraft.recipe}:p.settings,mode=exportMode(),input=mode==='working'?outputDimensions(p.originalWidth,p.originalHeight):{width:p.originalWidth,height:p.originalHeight},layout=finalCanvasPlan(input.width,input.height,settings);$('perspectiveDimensions').textContent=`${draft?'待应用 · ':''}${mode==='working'?'工作尺寸':'原尺寸'}：调平后 ${layout.straightened.width} × ${layout.straightened.height} → 透视 ${layout.perspected.width} × ${layout.perspected.height} px（留白前）`;}catch(error){$('perspectiveDimensions').textContent=`该输出基础不可处理：${error.message||error}。未自动缩小。`;}
}
function startPerspectiveDraft(){
  if(!photoAvailable()||!perspectiveReady()||backendJob)return;setTool('pan');
  if(sourceViewActive()){toast('请先关闭源坐标诊断或范围检查，再编辑透视四角。');return;}
  cancelCropDraft();paddingDraft=null;cancelTextPlacement();imagePanel?.cancelPlacement();originalHeld=false;setCompare(false);referenceRequested=false;cancelReferenceGesture();
  const p=current();perspectiveDraft={photo:p,blob:p.blob,input:source,sourceRevision:sourceRevisionOf(p),revision:p.revision,key:renderRecipeKey(p.settings),basis:exportMode(),recipe:clone(p.settings.perspective??window.MintPerspective.defaults()),valid:true,error:''};
  $('perspectiveCorner').value='0';writePerspectiveForm();validatePerspectiveDraft();scheduleRender(0);updatePerspectiveControls();drawPreview();
}
function editPerspectiveForm(){if(!perspectiveDraftCurrent()||!photoAvailable()||pointer)return;perspectiveDraft.recipe=readPerspectiveForm();validatePerspectiveDraft();updatePerspectiveControls();drawPreview();}
function applyPerspectiveDraft(){
  if(!perspectiveDraftCurrent()||!perspectiveInputReady()||!photoAvailable()||pointer||backendJob||!validatePerspectiveDraft())return;
  try{
    const p=current(),recipe=window.MintPerspective.validate(perspectiveDraft.recipe),next=window.MintPerspective.isActive(recipe)?recipe:null,candidate={...p.settings,perspective:next};
    if(candidate.paintLayers)paintCore().validate(candidate.paintLayers,paintContext(p,candidate));if(candidate.redactions)redactionCore().validate(candidate.redactions,redactionContext(p,candidate));
    if(typeof Pipeline.preflightRender!=='function')throw new Error('透视预算检查不可用');
    Pipeline.preflightRender(source,candidate,factsForPhoto(p,analysis,source,candidate),{deferTextLayers:true,deferPaintLayers:true,deferRedactions:true,imageAssets:imageAssetsFor(p,candidate),retainedBytes:straightenRetainedBytes(source,p)});
    if(JSON.stringify(next)===JSON.stringify(p.settings.perspective||null)){cancelPerspectiveDraft();status('四角未改变，没有新增历史');return;}
    const draft=perspectiveDraft;cancelPerspectiveDraft(false);if(changeSettings({perspective:next})===false){perspectiveDraft=draft;updatePerspectiveControls();return;}
    status('已应用四角矫正 · 原图和原图坐标编辑保留 · 可撤销');
  }catch(error){toast(`透视未应用：${error.message||error}。已有绘画/遮盖不会被移动或删除。`,true);updatePerspectiveControls();}
}
function perspectivePoint(event,clamp=false){
  if(!perspectiveInputReady()||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return null;
  const rect=$('imageSurface').getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return null;let x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
  if(!clamp&&(x<0||y<0||x>1||y>1))return null;return {x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
}
function beginPerspectivePoint(event){
  if(pointer||originalHeld||!event.target.closest('#imageSurface'))return;const point=perspectivePoint(event);if(!point)return;
  const corner=Number($('perspectiveCorner').value);if(!Number.isInteger(corner)||corner<0||corner>3)return;
  pointer={kind:'perspective',id:event.pointerId,draft:perspectiveDraft,before:clone(perspectiveDraft.recipe),corner};$('viewport').setPointerCapture(event.pointerId);event.preventDefault();appendPerspectivePoint(event);
}
function appendPerspectivePoint(event){if(pointer?.kind!=='perspective'||pointer.id!==event.pointerId||pointer.draft!==perspectiveDraft)return;const point=perspectivePoint(event,true);if(!point)return;perspectiveDraft.recipe.quad[pointer.corner]=point;writePerspectiveForm();validatePerspectiveDraft();updatePerspectiveControls();drawPreview();}
function drawPerspectiveOverlay(ctx){
  if(!perspectiveInputReady()||originalHeld)return;const quad=perspectiveDraft.recipe.quad;if(quad.length!==4||quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;
  const w=ctx.canvas.width,h=ctx.canvas.height;ctx.save();ctx.strokeStyle=perspectiveDraft.valid?'#38d6b0':'#ff697d';ctx.lineWidth=Math.max(1,Math.min(w,h)/350);ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x*w,p.y*h):ctx.moveTo(p.x*w,p.y*h));ctx.closePath();ctx.stroke();
  for(let i=0;i<4;i++){const p=quad[i];ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(4,Math.min(w,h)/90),0,Math.PI*2);ctx.fillStyle=Number($('perspectiveCorner').value)===i?'#38d6b0':'#ffffff';ctx.fill();}ctx.restore();
}
$('startPerspective').addEventListener('click',startPerspectiveDraft);$('applyPerspective').addEventListener('click',applyPerspectiveDraft);
$('cancelPerspective').addEventListener('click',()=>{cancelPerspectiveDraft();status('已取消四角草稿，照片未改变');});
$('resetPerspective').addEventListener('click',()=>{if(!photoAvailable()||backendJob)return;try{const p=current(),candidate={...p.settings,perspective:null};if(candidate.paintLayers)paintCore().validate(candidate.paintLayers,paintContext(p,candidate));if(candidate.redactions)redactionCore().validate(candidate.redactions,redactionContext(p,candidate));cancelPerspectiveDraft();if(changeSettings({perspective:null})!==false)status('已重置透视 · 其他编辑保留 · 可撤销');}catch(error){toast(`透视未重置：${error.message||error}。已有绘画/遮盖未改变。`,true);}});
for(const id of ['perspectiveWidth','perspectiveHeight',...Array.from({length:4},(_,i)=>['perspective'+i+'x','perspective'+i+'y']).flat()])$(id).addEventListener('input',editPerspectiveForm);
$('perspectiveCorner').addEventListener('change',()=>drawPreview());

function updatePaddingControls() {
  if (paddingDraft && !paddingDraftCurrent()) paddingDraft=null;
  const p=current(),available=photoAvailable()&&paddingReady()&&!backendJob&&!cropDraft&&!sourceViewActive();
  for(const id of paddingFields)$(id).disabled=!available;
  if(!paddingDraft) {
    const recipe=p?.settings.canvasPadding || (paddingReady()?window.MintCanvasPadding.defaults():{top:0,right:0,bottom:0,left:0,color:'#ffffff',opacity:1});
    for(const side of ['top','right','bottom','left'])$(`padding${side[0].toUpperCase()+side.slice(1)}`).value=String(Number((recipe[side]*100).toFixed(8)));
    $('paddingColor').value=recipe.color; $('paddingOpacity').value=String(Number((recipe.opacity*100).toFixed(8)));
  }
  $('applyPadding').disabled=!available||!paddingDraft;
  $('cancelPadding').disabled=!paddingDraft;
  $('resetPadding').disabled=!available||(!p?.settings.canvasPadding&&!paddingDraft);
  $('paddingStatus').textContent=!paddingReady()?'边框组件不可用；不会忽略已保存的留白。':!p?'导入照片后可用。默认不扩展画布。':!available?'请返回普通查看并结束当前操作后调整留白；已保存设置保留。':paddingDraft?'输入尚未应用；只有点击应用才进入历史与导出。':'先完成全部编辑和裁剪/旋转，最后增加留白；原画面像素不缩放。';
  $('paddingDimensions').textContent='';
  if(p&&paddingReady())try {
    const recipe=paddingDraft?paddingRecipeFromForm():p.settings.canvasPadding;
    const layout=finalCanvasPlan(p.originalWidth,p.originalHeight,{...p.settings,canvasPadding:recipe});
    const framed=layout.straightened,plan=layout;
    const {width,height}=plan.outputSize;
    const limit=width>16384||height>16384||width*height>64000000;
    $('paddingDimensions').textContent=`${paddingDraft?'输入预估':'已应用'}：构图 ${framed.width} × ${framed.height} → ${width} × ${height} px${limit?' · 原尺寸输出超限，可减小留白或选择工作尺寸':''}`;
  } catch(error) { $('paddingDimensions').textContent=`输入未应用：${error.message||error}`; $('applyPadding').disabled=true; }
}
function editPaddingForm() {
  const p=current();if(!photoAvailable()||!paddingReady()||backendJob||cropDraft||sourceViewActive())return;
  paddingDraft={photo:p,sourceRevision:sourceRevisionOf(p),revision:p.revision,key:JSON.stringify([p.settings.framing||null,p.settings.straighten||null,p.settings.perspective||null,p.settings.canvasPadding||null])};updatePaddingControls();
}
function applyPaddingForm() {
  if(!paddingDraftCurrent()||!photoAvailable()||!paddingReady()||backendJob||cropDraft||sourceViewActive())return;
  try { const recipe=paddingRecipeFromForm();finalCanvasPlan(source.width,source.height,{...current().settings,canvasPadding:recipe},true);
    paddingDraft=null;if(changeSettings({canvasPadding:['top','right','bottom','left'].some(k=>recipe[k]>0)?recipe:null})===false)return;drawPreview();status('已应用边框与留白 · 原画面未缩放 · 可撤销');
  } catch(error) {toast(`留白未应用：${error.message||error}`,true);updatePaddingControls();}
}
for(const id of paddingFields)for(const event of ['input','change'])$(id).addEventListener(event,editPaddingForm);
$('applyPadding').addEventListener('click',applyPaddingForm);
$('cancelPadding').addEventListener('click',()=>{paddingDraft=null;updatePaddingControls();status('已取消留白输入，照片未改变');});
$('resetPadding').addEventListener('click',()=>{if(!photoAvailable()||!paddingReady()||backendJob||cropDraft||sourceViewActive())return;paddingDraft=null;if(changeSettings({canvasPadding:null})===false)return;drawPreview();status('已移除留白 · 构图和其他调整保留 · 可撤销');});

// Final-canvas conventional redaction. Pink draft paths are guides, never export pixels.
function redactionReady(){return ['validate','geometryKey','plan','apply','isActive'].every(k=>typeof window.MintRedactionLayers?.[k]==='function');}
function redactionCore(){if(!redactionReady())throw new Error('遮盖组件不可用，不会忽略已保存的遮盖');return window.MintRedactionLayers;}
function redactionToolActive(){return tool==='redact-mosaic'||tool==='redact-cover';}
function redactionContext(p,settings=p.settings,size={width:source?.width,height:source?.height},signal){return {sourceRevision:sourceRevisionOf(p),settings,sourceSize:size,shouldCancel:()=>!!signal?.aborted};}
function redactionFrameReady(){const p=current(),f=acceptedRender;return photoAvailable()&&redactionReady()&&!pageDisposed&&!backendJob&&!renderingPhoto&&!renderPending&&!sourceViewActive()&&!originalHeld&&!compare&&!referenceComparisonVisible()&&!cropDraft&&!!f&&f.photo===p&&f.blob===p.blob&&f.input===source&&f.sourceRevision===sourceRevisionOf(p)&&f.recipeKey===renderRecipeKey(p.settings)&&f.generation===renderVersion&&f.viewToken===viewToken&&f.canvas===rendered&&f.displayStamp===currentDisplayStamp();}
function applyRedactionCanvas(canvas,p,settings,size,signal){
  if(!settings.redactions)return canvas;
  const core=redactionCore(),context=redactionContext(p,settings,size,signal);core.plan(canvas.width,canvas.height,settings.redactions,context);
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),input={width:canvas.width,height:canvas.height,data:pixels.data};
  const result=core.apply(input,settings.redactions,context);if(signal?.aborted)throw new DOMException('遮盖已取消','AbortError');if(result===input)return canvas;
  const out=document.createElement('canvas');out.width=result.width;out.height=result.height;const ctx=out.getContext('2d'),im=ctx.createImageData(out.width,out.height);im.data.set(result.data);ctx.putImageData(im,0,0);return out;
}
function redactionPoint(event,clamp=false){return manualPoint(event,clamp);}
function beginRedactionStroke(event){
  if(!redactionToolActive()||!redactionFrameReady()||pointer||redactionPointers.size>1)return false;
  const p=current(),point=redactionPoint(event);if(!point)return false;
  try{
    const radius=Number($('redactRadius').value)/100,blockSize=Number($('redactBlock').value)/100,color=$('redactColor').value;
    const recipe=window.MintRedact.createProfile('desktop').validate({version:1,mode:tool==='redact-cover'?'cover':'mosaic',blockSize,color,strokes:[{radius,points:[point]}]});
    const selection=$('redactUseSelection').checked&&p.settings.manualSelection?clone(p.settings.manualSelection):null;
    if(selection&&straightenActive(p.settings)&&p.settings.straighten.angle%90!==0)throw new Error('非90°调平暂不支持选区绘画/遮盖，请先重置调平或明确取消使用选区');
    const wrapper=p.settings.redactions?clone(p.settings.redactions):{version:1,sourceRevision:sourceRevisionOf(p),geometryKey:redactionCore().geometryKey(p.settings),layers:[]};
    const active=wrapper.layers.find(l=>l.id===p.redactionLayerId),same=active&&active.enabled&&active.recipe.mode===recipe.mode&&active.recipe.color===recipe.color&&active.recipe.blockSize===recipe.blockSize&&JSON.stringify(active.selection)===JSON.stringify(selection);
    const id=same?active.id:`cover-${crypto.randomUUID()}`;
    if(!same)wrapper.layers.push({id,name:recipe.mode==='cover'?'不透明遮盖':'马赛克',enabled:true,recipe:clone(recipe),selection});else active.recipe.strokes.push(clone(recipe.strokes[0]));
    redactionCore().validate(wrapper,redactionContext(p));
    redactionDraft={photo:p,blob:p.blob,frame:acceptedRender,recipeKey:renderRecipeKey(p.settings),sourceRevision:sourceRevisionOf(p),wrapper,id,points:wrapper.layers.find(l=>l.id===id).recipe.strokes.at(-1).points,radius,capped:false};
    pointer={id:event.pointerId,kind:'redaction'};$('viewport').setPointerCapture(event.pointerId);event.preventDefault();drawPreview();return true;
  }catch(error){toast(`未开始遮盖：${error.message||error}`,true);return false;}
}
function appendRedactionStroke(event,finalPoint=false){
  const d=redactionDraft;if(!d)return;if(!redactionFrameReady()||d.frame!==acceptedRender||d.photo!==current()||d.recipeKey!==renderRecipeKey(current().settings)){finishRedactionStroke(false); finishPaintStroke(false);return;}
  const point=redactionPoint(event,true);if(!point)return;const last=d.points.at(-1),distance=Math.hypot((point.x-last.x)*rendered.width,(point.y-last.y)*rendered.height);
  if(!distance||(!finalPoint&&distance<Math.max(1,d.radius*Math.min(rendered.width,rendered.height)*.12)))return;
  if(d.points.length>=512){if(!d.capped){d.capped=true;toast('这一笔最多512点，松开后继续下一笔。');}return;}d.points.push(point);drawPreview();
}
function finishRedactionStroke(commit=false){
  const d=redactionDraft;if(!d)return;redactionDraft=null;const id=pointer?.kind==='redaction'?pointer.id:null;if(pointer?.kind==='redaction')pointer=null;
  if(id!==null&&$('viewport').hasPointerCapture?.(id))$('viewport').releasePointerCapture(id);
  if(!commit||!redactionFrameReady()||d.frame!==acceptedRender||d.photo!==current()||d.blob!==current().blob||d.sourceRevision!==sourceRevisionOf(current())||d.recipeKey!==renderRecipeKey(current().settings)){drawPreview();return;}
  try{
    const p=current(),candidate={...p.settings,redactions:d.wrapper},validated=redactionCore().validate(d.wrapper,redactionContext(p,candidate));
    const previewSize=finalCanvasPlan(source.width,source.height,candidate,true).outputSize;
    redactionCore().plan(previewSize.width,previewSize.height,validated,redactionContext(p,candidate));
    exportDimensions({...p,settings:candidate},exportMode()); // Original-size recipe budget, not just the small preview.
    p.redactionLayerId=d.id;changeSettings({redactions:clone(validated)});status('遮盖笔触已应用 · 原图未修改 · 可撤销 · 导出副本后请再次核对');
  }catch(error){toast(`这一笔未应用：${error.message||error}`,true);}drawPreview();
}
function drawRedactionDraft(ctx){const d=redactionDraft;if(!d||d.photo!==current()||d.frame!==acceptedRender)return;ctx.save();ctx.strokeStyle='#ff6fae';ctx.fillStyle='#ff6fae';ctx.globalAlpha=.65;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=2*d.radius*Math.min(ctx.canvas.width,ctx.canvas.height);ctx.beginPath();d.points.forEach((p,i)=>i?ctx.lineTo(p.x*(ctx.canvas.width-1),p.y*(ctx.canvas.height-1)):ctx.moveTo(p.x*(ctx.canvas.width-1),p.y*(ctx.canvas.height-1)));if(d.points.length===1){const p=d.points[0];ctx.arc(p.x*(ctx.canvas.width-1),p.y*(ctx.canvas.height-1),ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();ctx.restore();}
function updateRedactionControls(){
  if(!$('redactionSection'))return;const p=current(),layers=p?.settings.redactions?.layers||[],available=photoAvailable()&&redactionReady()&&!backendJob;
  for(const [id,name]of[['redactMosaicTool','redact-mosaic'],['redactCoverTool','redact-cover']]){$(id).disabled=!available;$(id).classList.toggle('active',tool===name);$(id).setAttribute('aria-pressed',String(tool===name));}
  for(const id of ['redactRadius','redactBlock','redactColor','redactUseSelection','redactNewLayer','redactDone'])$(id).disabled=!available;
  const list=$('redactLayerList'),key=JSON.stringify([p?.id,layers,p?.redactionLayerId]);if(list.dataset.signature!==key){list.dataset.signature=key;list.textContent='';const n=document.createElement('option');n.value='';n.textContent='下一笔新建层';list.append(n);for(const l of layers){const o=document.createElement('option');o.value=l.id;o.textContent=`${l.enabled?'●':'○'} ${l.name} · ${l.recipe.strokes.length}笔`;list.append(o);}list.value=p?.redactionLayerId||'';}
  const layer=layers.find(l=>l.id===p?.redactionLayerId);list.disabled=!available||!layers.length;for(const id of ['redactToggleLayer','redactRemoveLayer'])$(id).disabled=!available||!layer;$('redactClear').disabled=!available||!layers.length;
  $('redactStatus').textContent=!p?'导入照片后可用。':!redactionReady()?'遮盖组件缺失，不会静默忽略已存笔触。':sourceViewActive()?'原图坐标检查中不显示最终遮盖；先关闭诊断叠层，再点遮盖画笔返回最终画布。':`${layers.length}/8层 · ${layers.reduce((n,l)=>n+l.recipe.strokes.length,0)}/64笔 · ${redactionToolActive()?(redactionFrameReady()?'拖动绘制，松开应用；粉色是临时引导，不导出。':'等待最终画布完成，再开始绘制。'):'每笔可撤销；与照片绑定，不随参数同步或预设转移。'}`;
}
for(const [id,name]of[['redactMosaicTool','redact-mosaic'],['redactCoverTool','redact-cover']])$(id).addEventListener('click',()=>setTool(tool===name?'pan':name));
$('redactDone').addEventListener('click',()=>setTool('pan'));
$('redactNewLayer').addEventListener('click',()=>{finishRedactionStroke(false); finishPaintStroke(false);if(current())current().redactionLayerId=null;updateRedactionControls();});
$('redactLayerList').addEventListener('change',()=>{finishRedactionStroke(false); finishPaintStroke(false);const p=current();if(!p||!photoAvailable())return;p.redactionLayerId=$('redactLayerList').value;const l=p.settings.redactions?.layers.find(l=>l.id===p.redactionLayerId);if(l){$('redactColor').value=l.recipe.color;$('redactBlock').value=String(l.recipe.blockSize*100);$('redactUseSelection').checked=!!l.selection;}updateRedactionControls();});
for(const id of ['redactRadius','redactBlock','redactColor','redactUseSelection'])$(id).addEventListener('input',()=>finishRedactionStroke(false));
for(const [id,action]of[['redactToggleLayer','toggle'],['redactRemoveLayer','remove'],['redactClear','clear']])$(id).addEventListener('click',()=>{finishRedactionStroke(false); finishPaintStroke(false);const p=current();if(!p||!photoAvailable()||!p.settings.redactions)return;const r=clone(p.settings.redactions),layer=r.layers.find(l=>l.id===p.redactionLayerId);if(action==='clear')r.layers=[];else if(!layer)return;else if(action==='toggle')layer.enabled=!layer.enabled;else r.layers=r.layers.filter(l=>l!==layer);changeSettings({redactions:r.layers.length?r:null});});

// Independent transparent drawing layers. Guides never become export pixels.
function paintReady(){return ['validate','geometryKey','plan','isActive','canonicalRecipe'].every(k=>typeof window.MintPaintLayers?.[k]==='function')&&!!window.MintPaintLayerRenderer?.create&&!!window.MintPaintLayer?.createProfile;}
function paintCore(){if(!paintReady())throw new Error('绘画组件不可用，不会忽略已保存笔迹');return window.MintPaintLayers;}
function paintActive(settings){return settings?.paintLayers!=null?paintCore().isActive(settings.paintLayers):false;}
function paintToolActive(){return ['paint-brush','paint-erase','paint-pick'].includes(tool);}
function paintContext(p,settings=p.settings,size={width:source?.width,height:source?.height}){return {sourceRevision:sourceRevisionOf(p),settings,sourceSize:size};}
function paintFrameReady(){return paintReady()&&redactionFrameReady();}
function paintRenderer(){if(!paintReady())throw new Error('绘画栅格组件不可用');return paintRendererService ||= window.MintPaintLayerRenderer.create({document,crypto,layersCore:window.MintPaintLayers});}
function paintRasterKey(p,layers,width,height,mode){return JSON.stringify([sourceRevisionOf(p),paintCore().canonicalRecipe(layers),width,height,mode]);}
async function preparePaintRaster(p,settings,mode,signal,isCurrent){
  if(!paintActive(settings))return null;
  const dims=exportDimensions({...p,settings},mode),key=paintRasterKey(p,settings.paintLayers,dims.width,dims.height,mode);
  if(signal?.aborted||isCurrent?.()===false)throw new DOMException('绘画任务已取消或过期','AbortError');
  if(paintRasterCache?.blob===p.blob&&paintRasterCache.key===key)return paintRasterCache.raster;
  const raster=await paintRenderer().raster({layers:settings.paintLayers,context:paintContext(p,settings,{width:dims.processingWidth,height:dims.processingHeight}),width:dims.width,height:dims.height,signal,isCurrent});
  if(signal?.aborted||isCurrent?.()===false)throw new DOMException('绘画任务已取消或过期','AbortError');
  paintRasterCache={blob:p.blob,key,raster};return raster;
}
function beginPaintStroke(event){
  if(!paintToolActive()||!paintFrameReady()||pointer||redactionPointers.size>1)return false;
  const p=current(),point=manualPoint(event);if(!point)return false;
  if(tool==='paint-pick'){paintPick={photo:p,frame:acceptedRender,point};pointer={id:event.pointerId,kind:'paint-pick'};$('viewport').setPointerCapture(event.pointerId);event.preventDefault();return true;}
  try{
    const stroke={mode:tool==='paint-erase'?'erase':'paint',color:$('paintColor').value,width:Number($('paintWidth').value)/100,opacity:Number($('paintOpacity').value)/100,points:[point]};
    const recipe=window.MintPaintLayer.createProfile('desktop').validate({version:1,strokes:[stroke]});
    const wrapper=p.settings.paintLayers?clone(p.settings.paintLayers):{version:1,sourceRevision:sourceRevisionOf(p),geometryKey:paintCore().geometryKey(p.settings),layers:[]};
    const active=wrapper.layers.find(l=>l.id===p.paintLayerId);
    // Existing layers keep the visible locked snapshot. Current selection is
    // captured only when the user explicitly chooses a new layer.
    const selection=active?clone(active.selection):$('paintUseSelection').checked&&p.settings.manualSelection?clone(p.settings.manualSelection):null;
    if(selection&&straightenActive(p.settings)&&p.settings.straighten.angle%90!==0)throw new Error('非90°调平暂不支持选区绘画/遮盖，请先重置调平或明确取消使用选区');
    if(stroke.mode==='erase'&&(!active||!active.enabled||!window.MintPaintLayer.hasPaint(active.recipe)))throw new Error('请先选择一个有笔迹且显示的绘画层；橡皮不会擦照片或其他图层');
    if(active&&!active.enabled)throw new Error('当前绘画层已隐藏，请显示它或新建层');
    const id=active?active.id:`paint-${crypto.randomUUID()}`;
    if(!active)wrapper.layers.push({id,name:`绘画 ${wrapper.layers.length+1}`,enabled:true,recipe:clone(recipe),selection});else active.recipe.strokes.push(clone(recipe.strokes[0]));
    paintCore().validate(wrapper,paintContext(p));
    paintDraft={photo:p,blob:p.blob,frame:acceptedRender,recipeKey:renderRecipeKey(p.settings),sourceRevision:sourceRevisionOf(p),wrapper,id,points:wrapper.layers.find(l=>l.id===id).recipe.strokes.at(-1).points,width:stroke.width,mode:stroke.mode,capped:false};
    pointer={id:event.pointerId,kind:'paint'};$('viewport').setPointerCapture(event.pointerId);event.preventDefault();drawPreview();return true;
  }catch(error){toast(`未开始绘画：${error.message||error}`,true);return false;}
}
function appendPaintStroke(event,finalPoint=false){
  const d=paintDraft;if(!d)return;if(!paintFrameReady()||d.frame!==acceptedRender||d.photo!==current()||d.recipeKey!==renderRecipeKey(current().settings)){finishPaintStroke(false);return;}
  const point=manualPoint(event,true);if(!point)return;const last=d.points.at(-1),distance=Math.hypot((point.x-last.x)*rendered.width,(point.y-last.y)*rendered.height);
  if(!distance||(!finalPoint&&distance<Math.max(.6,d.width*Math.min(rendered.width,rendered.height)*.04)))return;
  if(d.points.length>=1024){if(!d.capped){d.capped=true;toast('这一笔最多1024点，松开后继续下一笔。');}return;}d.points.push(point);drawPreview();
}
function finishPaintStroke(commit=false,event=null){
  const d=paintDraft,pick=paintPick;paintDraft=null;paintPick=null;const id=['paint','paint-pick'].includes(pointer?.kind)?pointer.id:null;if(id!==null)pointer=null;
  if(id!==null&&$('viewport').hasPointerCapture?.(id))$('viewport').releasePointerCapture(id);
  if(pick){if(commit&&paintFrameReady()&&pick.frame===acceptedRender&&pick.photo===current())try{const {point}=pick,x=Math.round(point.x*(rendered.width-1)),y=Math.round(point.y*(rendered.height-1)),rgba=rendered.getContext('2d').getImageData(x,y,1,1).data;if(!rgba[3])throw new Error('完全透明处没有可见颜色，请选择非透明像素');$('paintColor').value='#'+[...rgba.slice(0,3)].map(n=>n.toString(16).padStart(2,'0')).join('');status(`已取绘画颜色 ${$('paintColor').value} · 取自已接受预览，不含棋盘格 · 照片未变`);}catch(error){toast(`未取色：${error.message||error}`,true);}return;}
  if(!d)return;
  if(!commit||!paintFrameReady()||d.frame!==acceptedRender||d.photo!==current()||d.blob!==current().blob||d.sourceRevision!==sourceRevisionOf(current())||d.recipeKey!==renderRecipeKey(current().settings)){drawPreview();return;}
  try{
    const p=current(),candidate={...p.settings,paintLayers:d.wrapper},validated=paintCore().validate(d.wrapper,paintContext(p,candidate));
    const previewSize=finalCanvasPlan(source.width,source.height,candidate,true).outputSize;paintCore().plan(previewSize.width,previewSize.height,validated,paintContext(p,candidate));
    exportDimensions({...p,settings:candidate},exportMode());
    p.paintLayerId=d.id;if(changeSettings({paintLayers:clone(validated)})===false)return;status(d.mode==='erase'?'已擦除当前绘画层笔迹 · 底图和其他层未变 · 可撤销':'笔迹已应用到独立层 · 原图未修改 · 可撤销');
  }catch(error){toast(`这一笔未应用：${error.message||error}`,true);}drawPreview();
}
function drawPaintDraft(ctx){const d=paintDraft;if(!d||d.photo!==current()||d.frame!==acceptedRender)return;ctx.save();ctx.strokeStyle=d.mode==='erase'?'#ffb16c':'#3be6cb';ctx.fillStyle=ctx.strokeStyle;ctx.globalAlpha=.55;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=d.width*Math.min(ctx.canvas.width,ctx.canvas.height);ctx.beginPath();d.points.forEach((p,i)=>i?ctx.lineTo(p.x*(ctx.canvas.width-1),p.y*(ctx.canvas.height-1)):ctx.moveTo(p.x*(ctx.canvas.width-1),p.y*(ctx.canvas.height-1)));if(d.points.length===1){const p=d.points[0];ctx.arc(p.x*(ctx.canvas.width-1),p.y*(ctx.canvas.height-1),ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();ctx.restore();}
function updatePaintControls(){
  if(!$('paintSection'))return;const p=current(),layers=p?.settings.paintLayers?.layers||[],available=photoAvailable()&&paintReady()&&!backendJob;
  if(paintRasterCache&&(paintRasterCache.blob!==p?.blob||!layers.length||!paintReady()))paintRasterCache=null;
  for(const [id,name]of[['paintBrushTool','paint-brush'],['paintEraseTool','paint-erase'],['paintPickTool','paint-pick']]){$(id).disabled=!available;$(id).classList.toggle('active',tool===name);$(id).setAttribute('aria-pressed',String(tool===name));}
  for(const id of ['paintWidth','paintOpacity','paintColor','paintUseSelection','paintNewLayer','paintDone'])$(id).disabled=!available;
  const list=$('paintLayerList'),key=JSON.stringify([p?.id,layers,p?.paintLayerId]);if(list.dataset.signature!==key){list.dataset.signature=key;list.textContent='';const n=document.createElement('option');n.value='';n.textContent='下一笔新建层';list.append(n);for(const l of layers){const o=document.createElement('option');o.value=l.id;o.textContent=`${l.enabled?'●':'○'} ${l.name} · ${l.recipe.strokes.length}笔`;list.append(o);}list.value=p?.paintLayerId||'';}
  const layer=layers.find(l=>l.id===p?.paintLayerId);$('paintUseSelection').disabled=!available||!!layer;if(layer)$('paintUseSelection').checked=!!layer.selection;list.disabled=!available||!layers.length;for(const id of ['paintToggleLayer','paintRemoveLayer','paintLayerUp','paintLayerDown'])$(id).disabled=!available||!layer;$('paintClear').disabled=!available||!layers.length;
  $('paintStatus').textContent=!p?'导入照片后可用。':!paintReady()?'绘画组件缺失，不会静默忽略已存笔迹。':sourceViewActive()?'原图检查视图不显示最终绘画；请关闭诊断叠层后绘制。':`${layers.length}/4层 · ${layers.reduce((n,l)=>n+l.recipe.strokes.length,0)}/128笔 · ${layer?(layer.selection?'本层选区快照已锁定':'本层无选区限制'):'新层捕获当前选区'} · ${paintToolActive()?(paintFrameReady()?'拖动绘制，松开应用；青绿/橙色仅是临时引导。':'等待最终画布完成。'):'橡皮只擦当前绘画层；选区快照、原图和其他图层保持不变。'}`;
}
for(const [id,name]of[['paintBrushTool','paint-brush'],['paintEraseTool','paint-erase'],['paintPickTool','paint-pick']])$(id).addEventListener('click',()=>setTool(tool===name?'pan':name));
$('paintDone').addEventListener('click',()=>setTool('pan'));
$('paintNewLayer').addEventListener('click',()=>{finishPaintStroke(false);if(current())current().paintLayerId=null;$('paintUseSelection').checked=true;updatePaintControls();});
$('paintLayerList').addEventListener('change',()=>{finishPaintStroke(false);const p=current();if(!p||!photoAvailable())return;p.paintLayerId=$('paintLayerList').value;const l=p.settings.paintLayers?.layers.find(l=>l.id===p.paintLayerId);if(l){$('paintUseSelection').checked=!!l.selection;}updatePaintControls();});
for(const id of ['paintWidth','paintOpacity','paintColor','paintUseSelection'])$(id).addEventListener('input',()=>finishPaintStroke(false));
for(const [id,action]of[['paintToggleLayer','toggle'],['paintRemoveLayer','remove'],['paintClear','clear'],['paintLayerUp','up'],['paintLayerDown','down']])$(id).addEventListener('click',()=>{finishPaintStroke(false);const p=current();if(!p||!photoAvailable()||!p.settings.paintLayers)return;const r=clone(p.settings.paintLayers),layer=r.layers.find(l=>l.id===p.paintLayerId);if(action==='clear')r.layers=[];else if(!layer)return;else if(action==='toggle')layer.enabled=!layer.enabled;else if(action==='remove')r.layers=r.layers.filter(l=>l!==layer);else{const i=r.layers.indexOf(layer),j=i+(action==='up'?1:-1);if(j<0||j>=r.layers.length)return;[r.layers[i],r.layers[j]]=[r.layers[j],r.layers[i]];}try{const candidate={...p.settings,paintLayers:r.layers.length?r:null};exportDimensions({...p,settings:candidate},exportMode());changeSettings({paintLayers:candidate.paintLayers});}catch(error){toast(`绘画层未更改：${error.message||error}`,true);updatePaintControls();}});

// Manual tools are non-destructive source-coordinate commands. Draft strokes live
// only here; pointerup is the only commit path. The preview overlay is never an export input.
const manualToolNames = ['selection-brush', 'selection-lasso', 'liquify-push', 'liquify-restore', 'repair-heal', 'repair-clone', 'repair-sample'];
const manualToolActive = () => manualToolNames.includes(tool);
const manualWorkingViewReady = () => manualViewReady && renderedManualMode && sourceWorkingViewReady() && !!rendered && !!current() && manualViewStamp === `${current().id}/${sourceRevisionOf(current())}`;
function manualGeometryConflict(settings) {
  if (!window.MintManualPipeline?.assertCompatible) return true;
  try { if(settings.faceAdjustments!=null&&(!peopleReady()||window.MintPortraitPeopleDesktop.hasEffect(settings.faceAdjustments,'reshape')))return true; window.MintManualPipeline.assertCompatible({ ...settings, manualLiquify: settings.manualLiquify?.length ? settings.manualLiquify : [{}] }); return false; } catch { return true; }
}
const repairCoreReady = () => window.RepairBrushCore?.capabilities?.implementation === 'immutable-texture-patch-v1' && ['validate','resolveSource','apply'].every(key => typeof window.RepairBrushCore[key] === 'function');
function repairSampleFor(p = current()) { return repairSample && p && repairSample.photoId === p.id && repairSample.sourceRevision === sourceRevisionOf(p) && repairSample.geometry === JSON.stringify(p.settings.manualLiquify || []) ? repairSample.point : null; }
const manualCoreReady = () => typeof window.MintManualPipeline?.assertCompatible === 'function' && ['validateSelection','rasterizeSelection','validateLiquifyCommands','liquify'].every(key => typeof window.MintManualTools?.[key] === 'function');
function manualPoint(event, clampOutside = false) {
  const p = current(); if (!p || !source) return null;
  const rect = $('imageSurface').getBoundingClientRect();
  if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
  if (!clampOutside && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
function selectionRecipe(p, mode = 'add') {
  return p.settings.manualSelection ? clone(p.settings.manualSelection) : { version: 1, sourceRevision: sourceRevisionOf(p), base: mode === 'subtract' ? 'all' : 'none', inverted: false, feather: Number($('selectionFeather').value || 0) / 100, commands: [] };
}
function selectionWithDraft(draft) {
  const recipe = clone(draft.recipe), command = clone(draft.command);
  // Commands operate before the recipe inversion; the visible add/subtract choice does not.
  if (recipe.inverted) command.mode = command.mode === 'add' ? 'subtract' : 'add';
  recipe.commands.push(command); return recipe;
}
// Liquify preserves alpha at destination coordinates. Warping an already cut-out
// silhouette would clip RGB against the unchanged alpha: fail closed, never flatten.
function requireOpaqueManualLiquifyView() {
  if (!manualWorkingViewReady()) throw new Error('请等待当前手动编辑视图完成后再推拉。');
  const pixels = rendered.getContext('2d').getImageData(0, 0, rendered.width, rendered.height);
  if (!pixels?.data || pixels.data.length !== rendered.width * rendered.height * 4) throw new Error('无法验证图像透明度，未应用笔触。');
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] !== 255) throw new Error('图像包含透明或半透明像素。请使用不透明原图，先推形再抠图；不会自动铺底。');
}
function beginManualStroke(event) {
  const p = current();
  if (!p || !photoAvailable() || !manualCoreReady() || !manualWorkingViewReady() || originalHeld || pointer || backendJob || (tool.startsWith('liquify-') && (p.settings.manualRepair?.length || manualGeometryConflict(p.settings)))) return false;
  const point = manualPoint(event); if (!point) return false;
  if (tool.startsWith('liquify-')) {
    try { requireOpaqueManualLiquifyView(); } catch (error) { toast(`未开始手动推拉：${error.message || error}`, true); return false; }
  }
  if (tool.startsWith('repair-') && !repairCoreReady()) return false;
  if (tool === 'repair-sample') { manualDraft = { photoId: p.id, sourceRevision: sourceRevisionOf(p), kind: 'sample', command: { points: [point] } }; pointer = { id: event.pointerId, kind: 'manual' }; $('viewport').setPointerCapture(event.pointerId); event.preventDefault(); drawPreview(); return true; }
  const revision = sourceRevisionOf(p), selection = tool.startsWith('selection-');
  const mode = $('selectionMode').value === 'subtract' ? 'subtract' : 'add';
  let command, recipe = null, image = null;
  if (tool === 'repair-heal' || tool === 'repair-clone') {
    const sample = repairSampleFor(p); if (!sample) { toast('请先点击“选择取样点”，在干净、相近纹理处取样，再涂抹小瑕疵。'); return false; }
    if ((p.settings.manualRepair || []).length >= 64) { toast('最多64笔涂抹修复，请撤销或清除修复后继续。', true); return false; }
    command = { version: 1, type: 'repair-stroke', mode: tool === 'repair-clone' ? 'clone' : 'heal', sourceRevision: revision, radius: Number($('repairRadius').value) / 100, hardness: Number($('repairHardness').value) / 100, strength: Number($('repairStrength').value) / 100, points: [point], source: clone(sample), sampleMode: 'manual', selection: p.settings.manualSelection ? clone(p.settings.manualSelection) : null };
    try { const pixels = rendered.getContext('2d').getImageData(0, 0, rendered.width, rendered.height); image = { width: rendered.width, height: rendered.height, data: new Uint8ClampedArray(pixels.data) }; window.RepairBrushCore.validate(command, { sourceRevision: revision, manualTools: window.MintManualTools }); }
    catch (error) { toast(`未开始修复：${error.message || error}`, true); return false; }
  } else if (selection) {
    recipe = selectionRecipe(p, mode);
    if (recipe.commands.length >= 64) { toast('当前选区最多64笔，请清除选区或撤销后继续。', true); return false; }
    command = { kind: tool === 'selection-lasso' ? 'lasso' : 'brush', mode, points: [point] };
    if (command.kind === 'brush') command.radius = Number($('selectionRadius').value) / 100;
  } else {
    if ((p.settings.manualLiquify || []).length >= 64) { toast('最多64笔手动推拉，请撤销或清除推拉后继续。', true); return false; }
    command = { kind: tool === 'liquify-restore' ? 'restore' : 'push', sourceRevision: revision, radius: Number($('liquifyRadius').value) / 100, strength: Number($('liquifyStrength').value) / 100, points: [point], selection: p.settings.manualSelection ? clone(p.settings.manualSelection) : null };
  }
  try { window.MintManualTools.validateSelection(recipe || command.selection || null, { sourceRevision: revision }); }
  catch (error) { toast(`原图版本或选区不匹配，未开始这一笔：${error.message || error}`, true); return false; }
  manualDraft = { photoId: p.id, sourceRevision: revision, kind: selection ? 'selection' : image ? 'repair' : 'liquify', recipe, command, image, capped: false };
  pointer = { id: event.pointerId, kind: 'manual' }; $('viewport').setPointerCapture(event.pointerId);
  $('brushCursor').hidden = true; event.preventDefault(); drawPreview(); return true;
}
function appendManualStroke(event, finalPoint = false) {
  const draft = manualDraft, p = current(); if (!draft || !p) return;
  if (p.id !== draft.photoId || sourceRevisionOf(p) !== draft.sourceRevision || !photoAvailable()) { finishManualStroke(false); return; }
  const point = manualPoint(event, true); if (!point) return;
  if (draft.kind === 'sample') { draft.command.points = [point]; drawPreview(); return; }
  const points = draft.command.points, previous = points.at(-1);
  const distance = Math.hypot((point.x - previous.x) * source.width, (point.y - previous.y) * source.height);
  if (distance === 0 || (!finalPoint && distance < Math.max(1, (draft.command.radius || .008) * Math.min(source.width, source.height) * .12))) return;
  if (points.length >= 512) { if (!draft.capped) { draft.capped = true; toast('这一笔已达到512个采样点，松开应用后可继续下一笔。'); } return; }
  points.push(point); drawPreview();
}
function finishManualStroke(commit = false) {
  const draft = manualDraft; if (!draft) return;
  manualDraft = null;
  const pointerId = pointer?.kind === 'manual' ? pointer.id : null;
  if (pointer?.kind === 'manual') pointer = null;
  if (pointerId !== null && $('viewport').hasPointerCapture?.(pointerId)) $('viewport').releasePointerCapture(pointerId);
  const p = current();
  if (!commit || !p || !photoAvailable() || draft.photoId !== p.id || draft.sourceRevision !== sourceRevisionOf(p)) { drawPreview(); return; }
  try {
    if (draft.kind === 'sample') {
      repairSample = { photoId: p.id, sourceRevision: sourceRevisionOf(p), geometry: JSON.stringify(p.settings.manualLiquify || []), point: clone(draft.command.points[0]) };
      setTool(`repair-${repairMode}`); status('已选择纹理取样点 · 现在短笔涂抹小瑕疵 · 取样点本身不改变照片');
    } else if (draft.kind === 'repair') {
      const mask = draft.command.selection ? window.MintManualTools.rasterizeSelection(draft.image.width, draft.image.height, draft.command.selection, { sourceRevision: draft.sourceRevision }) : null;
      const options = { sourceRevision: draft.sourceRevision, manualTools: window.MintManualTools, selection: mask ? { width: draft.image.width, height: draft.image.height, data: mask, sourceRevision: draft.sourceRevision, space: 'original-pixels' } : null };
      const command = window.RepairBrushCore.resolveSource(draft.image, draft.command, options);
      window.RepairBrushCore.apply(draft.image, command, options); // Preflight real donor/target/color support before history changes.
      changeSettings({ manualRepair: [...(p.settings.manualRepair || []), clone(command)] }); status(`已应用一笔${command.mode === 'clone' ? '仿制图章' : '纹理修复'} · 可撤销`);
    } else if (draft.kind === 'selection') {
      if (draft.command.kind === 'lasso' && draft.command.points.length < 3) { status('套索至少需要三个不同的点；未改变选区'); drawPreview(); return; }
      const recipe = selectionWithDraft(draft);
      window.MintManualTools.validateSelection(recipe, { sourceRevision: draft.sourceRevision });
      changeSettings({ manualSelection: recipe }); status('选区已更新 · 只限制后续笔触，不改变已有笔触 · 可撤销');
    } else {
      if (draft.command.kind === 'push' && draft.command.points.length < 2) { status('拖动才能推拉；未应用笔触'); drawPreview(); return; }
      requireOpaqueManualLiquifyView(); // Recheck the accepted view before committing history.
      const commands = [...(p.settings.manualLiquify || []), clone(draft.command)];
      window.MintManualTools.validateLiquifyCommands(commands, { sourceRevision: draft.sourceRevision });
      changeSettings({ manualLiquify: commands }); status(`已应用手动${draft.command.kind === 'restore' ? '恢复' : '推拉'} · 可撤销`);
    }
  } catch (error) { toast(`这一笔未应用：${error.message || error}`, true); }
  drawPreview();
}
function editSelection(action) {
  finishManualStroke(false);
  const p = current(); if (!p || !photoAvailable() || !manualCoreReady()) return;
  let recipe = p.settings.manualSelection ? clone(p.settings.manualSelection) : null;
  if (action === 'clear') recipe = null;
  if (action === 'empty') recipe = { version: 1, sourceRevision: sourceRevisionOf(p), base: 'none', inverted: false, feather: 0, commands: [] };
  if (action === 'invert') { recipe = recipe || { version: 1, sourceRevision: sourceRevisionOf(p), base: 'all', inverted: false, feather: 0, commands: [] }; recipe.inverted = !recipe.inverted; }
  if (action === 'feather') { if (!recipe) return; recipe.feather = Number($('selectionFeather').value) / 100; }
  try { window.MintManualTools.validateSelection(recipe, { sourceRevision: sourceRevisionOf(p) }); changeSettings({ manualSelection: recipe }); }
  catch (error) { toast(`选区未更改：${error.message || error}`, true); }
  drawPreview();
}
function updateManualControls() {
  const p = current(), available = photoAvailable() && manualCoreReady() && !backendJob, recipe = p?.settings.manualSelection;
  const buttons = { selectionBrushTool: 'selection-brush', selectionLassoTool: 'selection-lasso', liquifyPushTool: 'liquify-push', liquifyRestoreTool: 'liquify-restore', repairHealTool: 'repair-heal', repairCloneTool: 'repair-clone', repairSampleTool: 'repair-sample' };
  for (const [id, name] of Object.entries(buttons)) { $(id).disabled = !available || (name.startsWith('repair-') && !repairCoreReady()) || (name.startsWith('liquify-') && (!!p?.settings.manualRepair?.length || (p && manualGeometryConflict(p.settings)))); $(id).title = name.startsWith('liquify-') && p?.settings.manualRepair?.length ? '已有修复：先撤销或清除修复，再进行推拉' : name.startsWith('liquify-') && p && manualGeometryConflict(p.settings) ? '先将背景设为原始，并把自动塑形归零' : ''; $(id).classList.toggle('active', tool === name); $(id).setAttribute('aria-pressed', String(tool === name)); }
  for (const id of ['selectionMode','selectionRadius','selectionInvert','selectionClear','selectionEmpty','liquifyRadius','liquifyStrength']) $(id).disabled = !available;
  $('selectionToLayer').disabled = !available || !recipe || (p?.settings.localLayers?.length || 0) >= 8 || !!p?.settings.manualLiquify?.length || !!p?.settings.manualRepair?.length;
  $('selectionToLayer').title = p?.settings.manualLiquify?.length || p?.settings.manualRepair?.length ? '先建局部调色层，再推形与修复；已有手动笔触请先撤销或清除' : '';
  $('selectionFeather').disabled = !available || !recipe;
  $('selectionFeather').value = recipe ? recipe.feather * 100 : 0;
  const sample = repairSampleFor(p);
  $('repairSampleStatus').textContent = !repairCoreReady() ? '纹理修复组件不可用，修复工具已停用。' : sample ? `取样点 X ${(sample.x * 100).toFixed(1)}% / Y ${(sample.y * 100).toFixed(1)}% · 每笔重新从此处取样。` : '先点击“选择取样点”，在干净、相近纹理处取样；然后短笔涂抹小瑕疵。';
  for (const id of ['repairRadius','repairHardness','repairStrength']) $(id).disabled = !available || !repairCoreReady();
  $('clearRepairSample').disabled = !available || !sample; $('clearRepair').disabled = !available || !p?.settings.manualRepair?.length; $('repairCount').textContent = `(${p?.settings.manualRepair?.length || 0})`;
  $('manualDone').disabled = !manualToolActive();
  $('clearLiquify').disabled = !available || !p?.settings.manualLiquify?.length || !!p?.settings.manualRepair?.length;
  $('liquifyCount').textContent = `(${p?.settings.manualLiquify?.length || 0})`;
  for (const [id, output] of [['selectionRadius','selectionRadiusValue'],['selectionFeather','selectionFeatherValue'],['liquifyRadius','liquifyRadiusValue'],['liquifyStrength','liquifyStrengthValue'],['repairRadius','repairRadiusValue'],['repairHardness','repairHardnessValue'],['repairStrength','repairStrengthValue']]) { $(output).textContent = `${Number($(id).value || 0).toFixed(['liquifyStrength','repairHardness','repairStrength'].includes(id) ? 0 : 1)}%`; rangeStyle($(id)); }
  $('manualSelectionStatus').textContent = !manualCoreReady() ? '手动工具核心未加载，功能已停用。' : !p ? '导入照片后可使用；不需要检测到人脸。' : !recipe ? '没有选区限制：后续笔触可作用于全图。' : `选区已启用 · ${recipe.commands.length} 笔${recipe.inverted ? ' · 已反选' : ''}${recipe.base === 'none' && !recipe.inverted && !recipe.commands.length ? ' · 全图受保护（空选区）' : ''}。只限制之后的推拉与修复。`;
  $('manualViewStatus').textContent = manualToolActive() ? manualWorkingViewReady() ? '手动编辑视图：完整原图坐标，保留调色、局部图层和手动笔触；暂不显示构图、背景处理与自动塑形。' : '正在准备未自动塑形的手动编辑视图，请稍候。' : '关闭工具时恢复最终构图，包括背景处理和自动塑形。';
}
function drawManualOverlay(ctx) {
  const p = current(); if (!p || !manualToolActive() || originalHeld || !manualCoreReady()) return;
  let recipe = p.settings.manualSelection || null;
  if (manualDraft?.kind === 'selection' && (manualDraft.command.kind !== 'lasso' || manualDraft.command.points.length >= 3)) recipe = selectionWithDraft(manualDraft);
  if (recipe) {
    try {
      const key = `${sourceRevisionOf(p)}/${source.width}/${source.height}/${JSON.stringify(recipe)}`;
      if (manualOverlayCache?.key !== key) {
        const mask = window.MintManualTools.rasterizeSelection(source.width, source.height, recipe, { sourceRevision: sourceRevisionOf(p) });
        const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
        const context = canvas.getContext('2d'), rgba = context.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < mask.length; i++) { rgba.data[i * 4] = 76; rgba.data[i * 4 + 1] = 221; rgba.data[i * 4 + 2] = 216; rgba.data[i * 4 + 3] = Math.round(mask[i] * 67); }
        context.putImageData(rgba, 0, 0); manualOverlayCache = { key, canvas };
      }
      ctx.drawImage(manualOverlayCache.canvas, 0, 0);
    } catch (error) { $('manualSelectionStatus').textContent = `选区无法显示，笔触会拒绝应用：${error.message || error}`; }
  }
  const sample = repairSampleFor(p);
  if (sample && tool.startsWith('repair-')) { const x = sample.x * (source.width - 1), y = sample.y * (source.height - 1), r = Math.max(4, 5 / zoom); ctx.save(); ctx.strokeStyle = '#ffe2a3'; ctx.lineWidth = Math.max(1, 1.5 / zoom); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.moveTo(x-r*1.8,y); ctx.lineTo(x+r*1.8,y); ctx.moveTo(x,y-r*1.8); ctx.lineTo(x,y+r*1.8); ctx.stroke(); ctx.restore(); }
  if (manualDraft) {
    const command = manualDraft.command, points = command.points;
    ctx.save(); ctx.beginPath(); ctx.moveTo(points[0].x * (source.width - 1), points[0].y * (source.height - 1));
    for (const point of points.slice(1)) ctx.lineTo(point.x * (source.width - 1), point.y * (source.height - 1));
    if (command.kind === 'lasso' && points.length >= 3) ctx.closePath();
    ctx.strokeStyle = manualDraft.kind === 'selection' ? '#8cfff4' : '#ffe2a3'; ctx.lineWidth = Math.max(1, 1.5 / zoom); ctx.stroke();
    const last = points.at(-1); ctx.beginPath(); ctx.arc(last.x * (source.width - 1), last.y * (source.height - 1), (command.radius || .004) * Math.min(source.width, source.height), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

// Results belong to immutable source revisions, never to resized preview pixels.
const LEARNED_CACHE_LIMIT = 256 * 1024 * 1024;
const sourceRevisionOf = p => p.sourceRevision || `${p.id}:source-0`;
function cacheFor(p) { if (!p.learnedCache) p.learnedCache = new Map(); return p.learnedCache; }
function cachedResult(p, id, kind) {
  if (!p || !id) return null;
  const entry = p.learnedCache?.get(id);
  if (!entry || entry.kind !== kind || entry.photoId !== p.id || entry.sourceRevision !== sourceRevisionOf(p) || entry.originalSize.width !== p.originalWidth || entry.originalSize.height !== p.originalHeight) return null;
  return entry;
}
function learnedCacheBytes() { let bytes = 0; for (const p of photos) for (const entry of p.learnedCache?.values() || []) bytes += entry.bytes; return bytes; }
function requireLearnedHelpers() { if (!window.MintLearnedAnalysis) throw new Error('原图坐标校验组件不可用。任务已停止，没有回退。'); return window.MintLearnedAnalysis; }
function factsForPhoto(p, facts, canvas, settings = p.settings) {
  if (settings.faceAdjustments || settings.paintLayers || settings.redactions || settings.localLayers?.length || settings.manualSelection || settings.manualLiquify?.length || settings.manualRepair?.length) facts = { ...(facts || {}), sourceRevision: sourceRevisionOf(p), originalSize: { width: p.originalWidth, height: p.originalHeight } };
  const id = settings.learnedMatteId; if (!id) return facts;
  const cached = cachedResult(p, id, 'matting');
  if (!cached) throw new Error('已启用的学习型人物蒙版缺失或不属于此原图版本。任务已停止，请重新生成或明确关闭该蒙版。');
  const original = correctedOriginalMatte(p, cached, settings), strokeSignature = JSON.stringify(settings.learnedMatteStrokes || []);
  let mask;
  if (canvas.width === original.width && canvas.height === original.height) mask = { width: original.width, height: original.height, data: original.data, maxValue: 1, space: 'working-pixels', encoding: 'unit-float32' };
  else {
    if (!activeMattePreview || activeMattePreview.id !== id || activeMattePreview.strokeSignature !== strokeSignature || activeMattePreview.mask.width !== canvas.width || activeMattePreview.mask.height !== canvas.height) {
      activeMattePreview = { id, strokeSignature, mask: requireLearnedHelpers().resampleMask(original, canvas.width, canvas.height) };
    }
    mask = activeMattePreview.mask;
  }
  return { ...(facts || { landmarks: [], faceCount: 0 }), mask: { ...mask, learnedMatteId: id }, sourceRevision: sourceRevisionOf(p), learnedMatte: { cacheId: id, sourceRevision: cached.sourceRevision, originalSize: { ...cached.originalSize }, provenance: cached.result.provenance, correction: original.correction || null } };
}
function correctedOriginalMatte(p, entry, settings = p.settings) {
  const strokes = settings.learnedMatteStrokes || [];
  if (!strokes.length) return entry.result.matte;
  const signature = `${entry.id}/${entry.sourceRevision}/${JSON.stringify(strokes)}`;
  if (activeCorrectedMatte?.signature !== signature) {
    const helpers = requireLearnedHelpers(); if (!helpers.applyMaskStrokes) throw new Error('原图蒙版修正组件不可用，已停止，不会忽略修正或回退。');
    activeCorrectedMatte = { signature, mask: helpers.applyMaskStrokes(entry.result.matte, entry.originalSize, strokes) };
  }
  return activeCorrectedMatte.mask;
}
function originalPoint(event, p = current()) {
  if (!p || !source) return null;
  const rect = $('imageSurface').getBoundingClientRect();
  if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
  return { x: Math.max(0, Math.min(p.originalWidth - 1, (event.clientX - rect.left) / rect.width * p.originalWidth)), y: Math.max(0, Math.min(p.originalHeight - 1, (event.clientY - rect.top) / rect.height * p.originalHeight)) };
}
function beginMatteStroke(event) {
  const p = current(), entry = cachedResult(p, p?.settings.learnedMatteId, 'matting');
  if (!p || !photoAvailable() || backendJob || !entry || originalHeld) return false;
  if ((p.settings.learnedMatteStrokes || []).length >= 64) { toast('最多保留64笔蒙版修正；请撤销或清除修正后继续。', true); return false; }
  const point = originalPoint(event, p); if (!point) return false;
  const radiusPx = Number($('matteRadius').value), hardness = Number($('matteHardness').value) / 100, opacity = Number($('matteOpacity').value) / 100;
  if (!Number.isFinite(radiusPx) || radiusPx < 1 || radiusPx > 256 || !Number.isFinite(hardness) || hardness < 0 || hardness > 1 || !Number.isFinite(opacity) || opacity <= 0 || opacity > 1) return false;
  matteDraft = { photoId: p.id, sourceRevision: sourceRevisionOf(p), matteId: entry.id, stroke: { mode: tool === 'matte-keep' ? 'keep' : 'remove', points: [point], radiusPx, hardness, opacity }, capped: false };
  p.matteInspect = true; p.matteInspectOriginal = false; $('learnedMatteInspect').checked = true; $('learnedRawMatte').checked = false;
  pointer = { id: event.pointerId, kind: 'matte' }; $('viewport').setPointerCapture(event.pointerId);
  drawPreview(); return true;
}
function appendMatteStroke(event) {
  const draft = matteDraft, p = current(); if (!draft || !p) return;
  if (draft.photoId !== p.id || draft.sourceRevision !== sourceRevisionOf(p) || draft.matteId !== p.settings.learnedMatteId) { finishManualStroke(false); finishMatteStroke(false); return; }
  const point = originalPoint(event, p); if (!point) return;
  const points = draft.stroke.points, previous = points[points.length - 1];
  if (Math.hypot(point.x - previous.x, point.y - previous.y) < Math.max(.5, draft.stroke.radiusPx * .15)) return;
  if (points.length >= 512) { if (!draft.capped) { draft.capped = true; toast('这一笔已达到512个采样点。松开鼠标应用，再开始下一笔。'); } return; }
  points.push(point); drawPreview();
}
function finishMatteStroke(commit = true) {
  const draft = matteDraft; if (!draft) return;
  matteDraft = null; if (pointer?.kind === 'matte') pointer = null;
  const p = current();
  if (!commit || !p || p.id !== draft.photoId || sourceRevisionOf(p) !== draft.sourceRevision || p.settings.learnedMatteId !== draft.matteId || !cachedResult(p, draft.matteId, 'matting')) { drawPreview(); return; }
  const strokes = [...(p.settings.learnedMatteStrokes || []), clone(draft.stroke)];
  if (strokes.length > 64) { drawPreview(); return; }
  try {
    const entry = cachedResult(p, draft.matteId, 'matting');
    const mask = requireLearnedHelpers().applyMaskStrokes(entry.result.matte, entry.originalSize, strokes);
    activeCorrectedMatte = { signature: `${entry.id}/${entry.sourceRevision}/${JSON.stringify(strokes)}`, mask };
  } catch (error) { p.learnedError = `这笔蒙版修正未应用：${error.message || error}`; updateBackendControls(); drawPreview(); return; }
  activeMattePreview = null; activeMatteInspection = null;
  p.learnedError = ''; changeSettings({ learnedMatteStrokes: strokes }); drawPreview();
  status(`已应用第 ${strokes.length} 笔原图蒙版${draft.stroke.mode === 'keep' ? '保留' : '去除'}修正 · 可撤销`);
}
function drawMatteInspection(ctx, p) {
  const entry = p.matteInspect && cachedResult(p, p.settings.learnedMatteId, 'matting'); if (!entry || !source) return;
  const strokes = p.settings.learnedMatteStrokes || [], raw = !!p.matteInspectOriginal;
  const key = `${entry.id}/${raw ? 'raw' : JSON.stringify(strokes)}/${source.width}/${source.height}`;
  if (activeMatteInspection?.key !== key) {
    const original = raw ? entry.result.matte : correctedOriginalMatte(p, entry);
    const mask = requireLearnedHelpers().resampleMask(original, source.width, source.height);
    const overlay = document.createElement('canvas'); overlay.width = source.width; overlay.height = source.height;
    const c = overlay.getContext('2d'), rgba = c.createImageData(source.width, source.height);
    for (let pixel = 0; pixel < mask.data.length; pixel++) {
      const alpha = mask.data[pixel], index = pixel * 4;
      rgba.data[index] = Math.round(245 * (1 - alpha) + 66 * alpha); rgba.data[index + 1] = Math.round(133 * (1 - alpha) + 224 * alpha); rgba.data[index + 2] = Math.round(70 * (1 - alpha) + 176 * alpha); rgba.data[index + 3] = 110;
    }
    c.putImageData(rgba, 0, 0); activeMatteInspection = { key, canvas: overlay };
  }
  ctx.drawImage(activeMatteInspection.canvas, 0, 0);
  if (matteDraft?.photoId === p.id && matteDraft.matteId === entry.id) {
    const { points, radiusPx, mode } = matteDraft.stroke, sx = source.width / p.originalWidth, sy = source.height / p.originalHeight;
    ctx.save(); ctx.strokeStyle = mode === 'keep' ? '#c3ffe8aa' : '#ffb391bb'; ctx.lineWidth = 2 * radiusPx * sx; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    points.forEach((point, index) => { if (!index) ctx.moveTo(point.x * sx, point.y * sy); else ctx.lineTo(point.x * sx, point.y * sy); });
    if (points.length === 1) ctx.lineTo(points[0].x * sx + .01, points[0].y * sy);
    ctx.stroke(); ctx.restore();
  }
}

function updateBackendControls() {
  const p = current(), available = photoAvailable(), parse = backendPanel?.getSelection('parse'), matte = backendPanel?.getSelection('matting');
  const faceSelect = $('learnedFaceSelect'); if (!faceSelect) return;
  const faces = analysis?.landmarks || [], signature = `${p?.id || ''}/${viewToken}/${faces.length}`;
  if (faceSelect.dataset.signature !== signature) {
    faceSelect.dataset.signature = signature; faceSelect.textContent = '';
    if (p) p.faceChoice = faces.length === 1 ? 0 : null;
    if (faces.length !== 1) { const option = document.createElement('option'); option.value = ''; option.textContent = faces.length ? `检测到 ${faces.length} 张，请选择` : '等待检测人脸'; faceSelect.append(option); }
    faces.forEach((face, index) => {
      const xs = face.map(point => point.x), center = xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length);
      const option = document.createElement('option'); option.value = String(index); option.textContent = `人脸 ${index + 1} · 横向 ${Math.round(center * 100)}%`; faceSelect.append(option);
    });
    faceSelect.value = p?.faceChoice === null || p?.faceChoice === undefined ? '' : String(p.faceChoice);
  }
  const working = !!backendJob;
  faceSelect.disabled = !available || !faces.length || analyzingPhoto || working;
  $('learnedFaceBoxes').disabled = !available || !faces.length;
  $('learnedParseBtn').disabled = !available || working || analyzingPhoto || !parse?.ready || !bridge?.parseFaceMasks || p?.faceChoice === null || p?.faceChoice === undefined;
  $('learnedMatteBtn').disabled = !available || working || !matte?.ready || !bridge?.matteImage;
  const diagnostic = cachedResult(p, p?.settings.diagnosticParseId, 'parse');
  $('learnedOverlay').disabled = !available || !diagnostic;
  $('learnedOverlay').checked = !!diagnostic && !!p.settings.diagnosticOverlay && !p.matteInspect;
  $('learnedOverlayKind').disabled = !available || !diagnostic;
  if (p) $('learnedOverlayKind').value = p.settings.diagnosticLayer || 'skin';
  const activeMatte = cachedResult(p, p?.settings.learnedMatteId, 'matting');
  const latestMatte = cachedResult(p, p?.lastSelectedMatteId || p?.latestMatteId, 'matting');
  if (activeMatte) p.lastSelectedMatteId = activeMatte.id;
  if (!activeMatte && (tool === 'matte-keep' || tool === 'matte-remove')) setTool('pan');
  for (const id of ['matteKeepTool','matteRemoveTool','matteRadius','matteHardness','matteOpacity','learnedMatteInspect']) $(id).disabled = !available || working || !activeMatte;
  const maxRadius = p ? Math.max(1, Math.min(256, Math.floor(Math.min(p.originalWidth || 1, p.originalHeight || 1) / 2))) : 256;
  $('matteRadius').max = String(maxRadius);
  if (!Number.isFinite(Number($('matteRadius').value)) || Number($('matteRadius').value) < 1 || Number($('matteRadius').value) > maxRadius) $('matteRadius').value = String(Math.min(24, maxRadius));
  $('matteRadiusValue').textContent = `${$('matteRadius').value} px`;
  for (const id of ['matteRadius','matteHardness','matteOpacity']) rangeStyle($(id));
  $('learnedMatteInspect').checked = !!p?.matteInspect && !!activeMatte; $('learnedRawMatte').checked = !!p?.matteInspectOriginal;
  $('learnedRawMatte').disabled = !available || working || !activeMatte || !p?.matteInspect;
  $('clearMatteStrokes').disabled = !available || working || !activeMatte || !p?.settings.learnedMatteStrokes?.length;
  $('matteStrokeCount').textContent = `(${p?.settings.learnedMatteStrokes?.length || 0})`;
  $('learnedMatteEnabled').checked = !!p?.settings.learnedMatteId;
  $('learnedMatteEnabled').disabled = !available || working || (!p?.settings.learnedMatteId && !latestMatte);
  $('learnedSelectionSummary').textContent = `设备 ${parse?.device?.toUpperCase() || '未检查'} · 人脸解析：${parse?.ready ? parse.modelId : '不可用'} · 人物抠图：${matte?.ready ? matte.modelId : '不可用'}`;
  $('learnedMatteNote').textContent = p?.settings.learnedMatteId ? activeMatte ? `已使用原尺寸学习型人物蒙版（${activeMatte.originalSize.width} × ${activeMatte.originalSize.height}）。仅在背景模式非“原始”时生效；保留连续 alpha，不使用旧羽化。` : '已启用的学习型蒙版缺失。预览与导出会明确失败，不会使用旧蒙版。' : '只有显式运行成功才替换背景蒙版；失败不会改用其他模型。人物蒙版用于背景处理，不修改原图。';
  if (p?.settings.learnedMatteId && $('control-bgFeather')) { $('control-bgFeather').disabled = true; $('control-bgFeather').title = '学习型人物蒙版保留原始连续 alpha，不使用旧羽化'; }
  $('learnedProgress').hidden = !working;
  $('learnedError').hidden = !p?.learnedError; $('learnedError').textContent = p?.learnedError || '';
  const entries = [diagnostic, activeMatte].filter(Boolean);
  $('learnedProvenance').textContent = entries.map(entry => `${entry.kind === 'parse' ? '解析诊断' : '人物蒙版'}：${entry.result.provenance.modelId} / ${entry.result.provenance.modelVersion} · ${entry.result.provenance.device.kind.toUpperCase()} · SHA-256 ${entry.result.provenance.weightsSha256} · 原图 ${entry.originalSize.width}×${entry.originalSize.height}`).join('\n');
  if (activeMatte) $('learnedProvenance').textContent += `\n手动蒙版修正：${p.settings.learnedMatteStrokes?.length || 0} 笔 · 原图像素单位 · 非学习模型结果`;
}
function showBackendProgress(job, phase) {
  if (backendJob !== job) return;
  job.phase = phase; const elapsed = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
  $('learnedProgressText').textContent = `${phase}${elapsed ? ` · 已用 ${elapsed} 秒` : ''}`;
  $('learnedProgress').hidden = false;
}
function cancelBackendJob(reason = '用户取消') {
  const job = backendJob; if (!job) return;
  job.cancelled = true; job.controller.abort(); clearInterval(job.timer); backendJob = null;
  if (job.sent && bridge?.cancelBackend) {
    Promise.resolve(bridge.cancelBackend(job.id)).catch(error => {
      const p = photos.find(photo => photo.id === job.photoId);
      if (p && currentId === p.id) { p.learnedError = `已丢弃任务结果，但后端停止请求失败：${error.message || error}。不会应用迟到结果。`; updateBackendControls(); }
    });
  }
  status(`${reason}：该任务的结果已作废，不会应用迟到结果。`); updateAvailability();
}
async function runLearnedTask(kind) {
  cancelCropDraft();
  const p = current(); if (!p || !photoAvailable() || backendJob) return;
  finishManualStroke(false); finishMatteStroke(false);
  const helpers = requireLearnedHelpers(), selection = backendPanel?.getSelection(kind);
  if (!selection?.ready) { p.learnedError = '所选模型/设备不可用。请重新检查本地模型；不会自动换用其他算法。'; updateBackendControls(); return; }
  const method = kind === 'parse' ? bridge?.parseFaceMasks : bridge?.matteImage;
  if (typeof method !== 'function') { p.learnedError = '此桌面服务没有接入所选模型任务。没有运行模型，也没有回退。'; updateBackendControls(); return; }
  const faceIndex = p.faceChoice;
  if (kind === 'parse' && (!Number.isInteger(faceIndex) || !analysis?.landmarks?.[faceIndex])) { p.learnedError = '请明确选择要解析的人脸。'; updateBackendControls(); return; }
  const landmarks = kind === 'parse' ? clone(analysis.landmarks[faceIndex]) : null;
  const job = { id: crypto.randomUUID(), photoId: p.id, sourceRevision: sourceRevisionOf(p), token: viewToken, kind, selection: { ...selection }, controller: new AbortController(), cancelled: false, sent: false, startedAt: Date.now(), phase: '正在读取原尺寸图像' };
  backendJob = job; p.learnedError = ''; updateAvailability(); showBackendProgress(job, job.phase);
  job.timer = setInterval(() => showBackendProgress(job, job.phase), 1000);
  const live = () => !job.cancelled && backendJob === job && currentId === p.id && viewToken === job.token && photos.includes(p) && sourceRevisionOf(p) === job.sourceRevision;
  try {
    if (!Pipeline.decodeOriginalImage) throw new Error('缺少原尺寸解码器；已停止，不会以缩略图代替原图。');
    const decoded = await Pipeline.decodeOriginalImage(p.blob, { signal: job.controller.signal }); if (!live()) return;
    const width = decoded.originalWidth, height = decoded.originalHeight;
    if (decoded.scaled || decoded.canvas.width !== width || decoded.canvas.height !== height || width !== p.originalWidth || height !== p.originalHeight || Math.max(width, height) > 4096 || width * height > 16000000) throw new Error('原尺寸图像超出4096长边/1600万像素限制或与当前照片不匹配；已停止，没有缩小原图。');
    const originalSize = { width, height };
    const roi = kind === 'parse' ? helpers.faceROI(landmarks, originalSize) : { x: 0, y: 0, width, height };
    if (kind === 'parse' && roi.width * roi.height > 1048576) throw new Error('人脸原尺寸区域超过1048576像素；已停止，没有缩小或裁掉脸部。');
    const expectedBytes = roi.width * roi.height * (kind === 'parse' ? 8 : 4);
    if (learnedCacheBytes() + expectedBytes > LEARNED_CACHE_LIMIT) throw new Error('原尺寸蒙版缓存已接近256 MB上限。请移除不需要的照片后重试；不会丢弃撤销所需蒙版。');
    const request = { requestId: job.id, modelId: selection.modelId, modelVersion: selection.modelVersion, device: selection.device, originalSize, roi, source: helpers.crop(decoded.canvas, roi) };
    if (kind === 'parse') request.selection = { kind: 'detected-face', faceId: `${p.id}:face-${faceIndex}`, revision: job.sourceRevision };
    if (!live()) return;
    showBackendProgress(job, `正在 ${selection.device.toUpperCase()} 运行 ${kind === 'parse' ? 'SegFace 解析' : 'BiRefNet 人物抠图'}`);
    job.sent = true;
    const result = await method(request); if (!live()) return;
    if (kind === 'parse') helpers.validateParse(result, request); else helpers.validateMatte(result, request);
    if (result.provenance.weightsSha256 !== selection.weightsSha256) throw new Error('返回权重指纹与所选模型不一致，结果已拒绝。');
    const bytes = kind === 'parse' ? result.skin.byteLength + result.protected.byteLength : result.matte.data.byteLength;
    if (learnedCacheBytes() + bytes > LEARNED_CACHE_LIMIT) throw new Error('蒙版缓存超过256 MB上限，结果未应用；请移除不需要的照片后重试。');
    const entry = { id: job.id, kind, photoId: p.id, sourceRevision: job.sourceRevision, originalSize, result, bytes };
    cacheFor(p).set(job.id, entry);
    if (kind === 'parse') { p.matteInspect = false; p.matteInspectOriginal = false; if (tool.startsWith('matte-')) setTool('pan'); Object.assign(p.settings, { diagnosticParseId: job.id, diagnosticOverlay: true, diagnosticLayer: 'skin' }); setCompare(false); }
    else { p.latestMatteId = job.id; p.lastSelectedMatteId = job.id; p.settings.learnedMatteId = job.id; p.settings.learnedMatteStrokes = []; activeMattePreview = null; activeCorrectedMatte = null; activeMatteInspection = null; }
    historyCommit(p); updateControls(); scheduleRender(0); drawPreview();
    status(kind === 'parse' ? 'SegFace 诊断蒙版已生成 · 原图叠加预览，不是学习型修肤，也不导出叠加层' : 'BiRefNet 原尺寸人物蒙版已缓存并启用 · 选择背景模式使用');
  } catch (error) {
    if (!live() || job.controller.signal.aborted || error?.name === 'AbortError') return;
    p.learnedError = `${kind === 'parse' ? '人脸解析' : '人物抠图'}失败：${error.message || error}。没有应用新结果，也没有自动回退。`;
    status('学习模型任务失败 · 原有调整与蒙版未改变');
  } finally {
    clearInterval(job.timer);
    if (backendJob === job) { backendJob = null; updateControls(); drawPreview(); }
  }
}
function diagnosticViewActive() {
  const p = current(); return !!p && !originalHeld && (($('peopleInspect')?.checked && !!p.settings.faceAdjustments?.faces.length) || (p.matteInspect && !!cachedResult(p, p.settings.learnedMatteId, 'matting')) || ($('learnedFaceBoxes')?.checked && !!analysis?.landmarks?.length) || (!!p.settings.diagnosticOverlay && !!cachedResult(p, p.settings.diagnosticParseId, 'parse')));
}
function drawLearnedDiagnostics(ctx) {
  const p = current(); if (!p || !source || originalHeld) return;
  if (p.matteInspect && cachedResult(p, p.settings.learnedMatteId, 'matting')) { drawMatteInspection(ctx, p); return; }
  const entry = p.settings.diagnosticOverlay && cachedResult(p, p.settings.diagnosticParseId, 'parse');
  if (entry) {
    const layer = p.settings.diagnosticLayer === 'protected' ? 'protected' : 'skin';
    const key = `${entry.id}/${layer}/${source.width}/${source.height}`;
    if (activeDiagnosticOverlay?.key !== key) {
      const roi = entry.result.roi, w = Math.max(1, Math.round(roi.width / entry.originalSize.width * source.width)), h = Math.max(1, Math.round(roi.height / entry.originalSize.height * source.height));
      const mask = requireLearnedHelpers().resampleMask({ width: roi.width, height: roi.height, data: entry.result[layer] }, w, h);
      const overlay = document.createElement('canvas'); overlay.width = w; overlay.height = h;
      const c = overlay.getContext('2d'), rgba = c.createImageData(w, h), color = layer === 'skin' ? [76,230,183] : [255,168,78];
      for (let pixel = 0; pixel < mask.data.length; pixel++) { const index = pixel * 4; rgba.data[index] = color[0]; rgba.data[index + 1] = color[1]; rgba.data[index + 2] = color[2]; rgba.data[index + 3] = Math.round(mask.data[pixel] * 150); }
      c.putImageData(rgba, 0, 0); activeDiagnosticOverlay = { key, canvas: overlay };
    }
    const roi = entry.result.roi;
    ctx.drawImage(activeDiagnosticOverlay.canvas, roi.x / entry.originalSize.width * source.width, roi.y / entry.originalSize.height * source.height, roi.width / entry.originalSize.width * source.width, roi.height / entry.originalSize.height * source.height);
  }
  drawPeopleBoxes(ctx,p);
  if ($('learnedFaceBoxes').checked) {
    ctx.save(); ctx.lineWidth = Math.max(1, 1.5 / zoom); ctx.font = `${Math.max(12, 12 / zoom)}px sans-serif`;
    (analysis?.landmarks || []).forEach((face, index) => {
      const xs = face.map(point => point.x), ys = face.map(point => point.y), x = Math.min(...xs) * source.width, y = Math.min(...ys) * source.height, w = (Math.max(...xs) - Math.min(...xs)) * source.width, h = (Math.max(...ys) - Math.min(...ys)) * source.height;
      ctx.strokeStyle = index === p.faceChoice ? '#d8ff94' : '#7be7c0'; ctx.fillStyle = ctx.strokeStyle; ctx.strokeRect(x, y, w, h); ctx.fillText(String(index + 1), x + 4 / zoom, Math.max(15 / zoom, y - 5 / zoom));
    }); ctx.restore();
  }
}

// Local adjustment layers are normalized to this photo's immutable original.
// Editing their outline deliberately shows original geometry, not a warped face.
function selectedLocalLayer() { const p = current(); return p?.settings.localLayers?.find(layer => layer.id === p.localLayerId) || p?.settings.localLayers?.[0] || null; }
function changeLocalLayer(changes, commit = true) {
  const p = current(), layer = selectedLocalLayer(); if (!p || !layer || !photoAvailable()) return;
  const layers = clone(p.settings.localLayers); Object.assign(layers.find(item => item.id === layer.id), changes);
  changeSettings({ localLayers: layers }, commit); drawPreview();
}
function addLocalLayer(kind = 'radial') {
  const p = current(); if (!p || !photoAvailable()) return;
  const layers = clone(p.settings.localLayers || []); if (layers.length >= 8) { toast('最多8个局部图层，可删除不需要的图层或撤销。'); return; }
  const layer = { id: crypto.randomUUID(), name: `局部调整 ${layers.length + 1}`, enabled: true, opacity: 1, sourceRevision: sourceRevisionOf(p), adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 }, mask: kind === 'linear' ? { kind: 'linear', x0: .25, y0: .5, x1: .75, y1: .5, reverse: false } : { kind: 'radial', cx: .5, cy: .5, rx: .25, ry: .25, feather: .65 } };
  layers.push(layer); p.localLayerId = layer.id; p.localInspect = true; p.matteInspect = false; $('learnedFaceBoxes').checked = false; setTool('pan'); setCompare(false); changeSettings({ localLayers: layers }); drawPreview();
  status('已添加原图坐标局部图层 · 调整面板可编辑位置与效果 · 可撤销');
}
function removeLocalLayer() {
  const p = current(), layer = selectedLocalLayer(); if (!p || !layer || !photoAvailable()) return;
  const layers = p.settings.localLayers.filter(item => item.id !== layer.id); p.localLayerId = layers.at(-1)?.id || null; if (!layers.length) p.localInspect = false;
  changeSettings({ localLayers: layers }); drawPreview();
}
function moveLocalLayer(direction) {
  const p = current(), layer = selectedLocalLayer(); if (!p || !layer || !photoAvailable()) return;
  const layers = clone(p.settings.localLayers), index = layers.findIndex(item => item.id === layer.id), target = index + direction;
  if (target < 0 || target >= layers.length) return;
  [layers[index], layers[target]] = [layers[target], layers[index]]; changeSettings({ localLayers: layers });
}
function updateLocalControls() {
  const p = current(), layer = selectedLocalLayer(), available = photoAvailable(), layers = p?.settings.localLayers || [];
  if (layer && p) p.localLayerId = layer.id;
  const list = $('localLayerList'), signature = JSON.stringify([p?.id, p?.localLayerId, layers.map(item => [item.id,item.name,item.enabled])]);
  if (list.dataset.signature !== signature) {
    list.textContent = ''; list.dataset.signature = signature;
    for (const item of layers) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'local-layer-row'; button.dataset.localId = item.id; button.textContent = `${item.enabled ? '●' : '○'} ${item.name}`; button.setAttribute('aria-pressed', String(item.id === layer?.id));
      button.addEventListener('click', () => { if (!photoAvailable()) return; current().localLayerId = item.id; updateLocalControls(); drawPreview(); }); list.append(button);
    }
  }
  for (const button of Array.from(list.children || [])) button.disabled = !available;
  $('localEmpty').hidden = !!layers.length; $('localLayerEditor').hidden = !layer;
  $('addRadialLayer').disabled = !available || layers.length >= 8; $('addLinearLayer').disabled = !available || layers.length >= 8;
  $('localInspect').checked = !!p?.localInspect; $('localInspect').disabled = !available || !layer;
  $('removeLocalLayer').disabled = !available || !layer;
  const index = layers.findIndex(item => item.id === layer?.id); $('localLayerUp').disabled = !available || index <= 0; $('localLayerDown').disabled = !available || index < 0 || index >= layers.length - 1;
  for (const id of ['localLayerName','localEnabled','localOpacity','localKind','localReverse','localExposure','localContrast','localSaturation','localTemperature','localCx','localCy','localRx','localRy','localFeather','localX0','localY0','localX1','localY1']) $(id).disabled = !available || !layer;
  if (!layer) return;
  $('localLayerName').value = layer.name; $('localEnabled').checked = layer.enabled; $('localOpacity').value = Math.round(layer.opacity * 100); $('localOpacityValue').textContent = `${Math.round(layer.opacity * 100)}%`; rangeStyle($('localOpacity'));
  $('localSelectionSummary').hidden = layer.mask.kind !== 'selection'; $('localSelectionSummary').textContent = layer.mask.kind === 'selection' ? `原图绑定的选区快照 · ${layer.mask.selection.commands.length} 笔 · 后续修改选区不会改变本层。可编辑调色和强度；范围需新建图层。` : ''; $('localKind').disabled = !available || layer.mask.kind === 'selection';
  $('localKind').value = layer.mask.kind; $('localRadialFields').hidden = layer.mask.kind !== 'radial'; $('localLinearFields').hidden = layer.mask.kind !== 'linear'; $('localReverse').checked = !!layer.mask.reverse;
  for (const key of ['exposure','contrast','saturation','temperature']) { const id = `local${key[0].toUpperCase()}${key.slice(1)}`; $(id).value = layer.adjustments[key]; $(`${id}Value`).textContent = key === 'exposure' ? `${(layer.adjustments[key] / 50).toFixed(2)} EV` : layer.adjustments[key]; rangeStyle($(id)); }
  for (const key of ['cx','cy','rx','ry','feather','x0','y0','x1','y1']) { const id = `local${key[0].toUpperCase()}${key.slice(1)}`; $(id).value = Math.round((layer.mask[key] || 0) * 1000) / 10; }
}
function drawLocalOutline(ctx, p) {
  const layer = selectedLocalLayer(); if (!p?.localInspect || !layer || !source || originalHeld) return;
  const mask = layer.mask;
  if (mask.kind === 'selection') {
    try { const data = window.MintManualTools.rasterizeSelection(source.width, source.height, mask.selection, { sourceRevision: sourceRevisionOf(p) }), overlay = document.createElement('canvas'); overlay.width = source.width; overlay.height = source.height; const context = overlay.getContext('2d'), rgba = context.createImageData(source.width, source.height); for (let i = 0; i < data.length; i++) { rgba.data[i*4] = 215; rgba.data[i*4+1] = 233; rgba.data[i*4+2] = 164; rgba.data[i*4+3] = Math.round(data[i] * 85); } context.putImageData(rgba, 0, 0); ctx.drawImage(overlay, 0, 0); } catch (error) { toast(`选区图层范围不可用：${error.message || error}`, true); }
    return;
  }
  ctx.save(); ctx.lineWidth = Math.max(1, 1.5 / zoom); ctx.strokeStyle = '#d7e9a4'; ctx.fillStyle = '#d7e9a4';
  ctx.beginPath();
  if (mask.kind === 'radial') { ctx.ellipse(mask.cx * source.width, mask.cy * source.height, mask.rx * source.width, mask.ry * source.height, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(mask.cx * source.width, mask.cy * source.height, Math.max(2, 3 / zoom), 0, 2 * Math.PI); ctx.fill(); }
  else { const x0 = mask.x0 * source.width, y0 = mask.y0 * source.height, x1 = mask.x1 * source.width, y1 = mask.y1 * source.height; ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke(); for (const [x,y] of [[x0,y0],[x1,y1]]) { ctx.beginPath(); ctx.arc(x,y,Math.max(3,4 / zoom),0,2*Math.PI); ctx.stroke(); } }
  ctx.restore();
}
$('addRadialLayer').addEventListener('click', () => addLocalLayer('radial')); $('addLinearLayer').addEventListener('click', () => addLocalLayer('linear'));
$('removeLocalLayer').addEventListener('click', removeLocalLayer); $('localLayerUp').addEventListener('click', () => moveLocalLayer(-1)); $('localLayerDown').addEventListener('click', () => moveLocalLayer(1));
$('localInspect').addEventListener('change', event => { const p = current(); if (!p || !photoAvailable()) return; p.localInspect = event.target.checked; if (p.localInspect) { p.matteInspect = false; setCompare(false); setTool('pan'); } drawPreview(); });
$('localLayerName').addEventListener('change', event => changeLocalLayer({ name: event.target.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,80) || '局部调整' }));
$('localEnabled').addEventListener('change', event => changeLocalLayer({ enabled: event.target.checked }));
$('localOpacity').addEventListener('input', event => changeLocalLayer({ opacity: Number(event.target.value) / 100 }, false));
$('localOpacity').addEventListener('change', () => { if (photoAvailable()) historyCommit(current()); });
$('localKind').addEventListener('change', event => changeLocalLayer({ mask: event.target.value === 'linear' ? { kind:'linear',x0:.25,y0:.5,x1:.75,y1:.5,reverse:false } : { kind:'radial',cx:.5,cy:.5,rx:.25,ry:.25,feather:.65 } }));
$('localReverse').addEventListener('change', event => { const layer = selectedLocalLayer(); if (layer?.mask.kind === 'linear') changeLocalLayer({ mask: { ...layer.mask, reverse: event.target.checked } }); });
for (const key of ['exposure','contrast','saturation','temperature']) {
  const input = $(`local${key[0].toUpperCase()}${key.slice(1)}`);
  input.addEventListener('input', event => { const layer = selectedLocalLayer(); if (layer) changeLocalLayer({ adjustments: { ...layer.adjustments, [key]: Number(event.target.value) } }, false); });
  input.addEventListener('change', () => { if (photoAvailable()) historyCommit(current()); });
}
for (const key of ['cx','cy','rx','ry','feather','x0','y0','x1','y1']) {
  const input = $(`local${key[0].toUpperCase()}${key.slice(1)}`);
  input.addEventListener('change', event => { const layer = selectedLocalLayer(); if (!layer || !(key in layer.mask)) return; const value = Number(event.target.value) / 100, min = ['rx','ry'].includes(key) ? .005 : key === 'feather' ? .05 : 0; if (!Number.isFinite(value) || value < min || value > 1) { updateLocalControls(); toast('请输入范围内的百分比。', true); return; } const mask = { ...layer.mask, [key]: value }; if (mask.kind === 'linear' && Math.hypot(mask.x1-mask.x0,mask.y1-mask.y0) < .005) { updateLocalControls(); toast('渐变起点与终点需分开至少0.5%。', true); return; } changeLocalLayer({ mask }); });
}

// Neutral-patch sampling reads the exact pre-stage preview, never final text,
// masks or comparison pixels. The transient session is photo/recipe-bound and
// stores no coordinates in the persisted light-balance recipe.
function lightBalanceReady() { return ['defaults','validate','isActive','apply','deriveWhiteBalance'].every(k=>typeof window.MintLightBalance?.[k]==='function'); }
function whiteBalanceFaceStageReady(){const s=current()?.settings;return !s||!['smooth','brighten','warmth','underEye','redness','lip','blush'].some(k=>Number(s[k]||0)!==0)||hasFaces();}
function whiteBalanceSessionCurrent() {
  const p=current(), a=whiteBalancePick;
  return !!a && a.photo===p && a.blob===p?.blob && a.source===source && a.sourceRevision===sourceRevisionOf(p) && a.recipeKey===renderRecipeKey(p.settings);
}
function whiteBalanceFrameReady() {
  const a=acceptedRender,p=current();
  return !pageDisposed && tool==='white-balance' && whiteBalanceSessionCurrent() && whiteBalanceFaceStageReady() && photoAvailable() && !renderingPhoto && !renderPending && !analyzingPhoto && !backendJob && !originalHeld && !compare && !!a && a.photo===p && a.blob===p.blob && a.input===source && a.canvas===rendered && a.mode==='white-balance-input' && a.displayStamp===currentDisplayStamp() && a.recipeKey===renderRecipeKey(p.settings) && a.sourceRevision===sourceRevisionOf(p) && a.generation===renderVersion && a.viewToken===viewToken;
}
function cancelWhiteBalancePointer() {
  if(pointer?.kind!=='white-balance')return;
  const id=pointer.id;pointer=null;
  if($('viewport').hasPointerCapture?.(id))$('viewport').releasePointerCapture(id);
}
function updateLightBalanceControls() {
  if(!$('lightBalanceStatus'))return;
  if(tool==='white-balance'&&!whiteBalanceSessionCurrent()){setTool('pan');return;}
  const ready=lightBalanceReady(),p=current(),saved=p?.settings.lightBalance;
  let recipe=null,error='';
  if(ready){try{recipe=window.MintLightBalance.validate(clone(saved??window.MintLightBalance.defaults()));}catch(e){error=String(e.message||e);}}
  const available=ready&&!!recipe&&photoAvailable();
  for(const [id,key] of [['shadowAmount','shadows'],['highlightAmount','highlights']]){const input=$(id);input.disabled=!available;if(recipe){input.value=recipe[key];$(id+'Value').textContent=recipe[key];}}
  $('pickWhiteBalance').disabled=!available||!whiteBalanceFaceStageReady()||analyzingPhoto||!!backendJob||typeof Pipeline.lightBalanceInputSettings!=='function';
  $('pickWhiteBalance').classList.toggle('active',tool==='white-balance');$('pickWhiteBalance').setAttribute('aria-pressed',String(tool==='white-balance'));
  $('cancelWhiteBalance').hidden=tool!=='white-balance';
  $('resetWhiteBalance').disabled=!available||!recipe||['r','g','b'].every(k=>recipe.whiteBalance[k]===1);
  $('resetLightBalance').disabled=!ready||!photoAvailable()||saved==null;
  $('whiteBalanceGains').textContent=recipe?`R ${recipe.whiteBalance.r.toFixed(3)} · G ${recipe.whiteBalance.g.toFixed(3)} · B ${recipe.whiteBalance.b.toFixed(3)}`:'—';
  $('lightBalanceStatus').textContent=!ready?'明暗/白平衡核心不可用，已停用，不会忽略已有参数。':error?`参数无效：${error}。可重置后重试。`:!p?'导入照片后可用；默认不改变图像。':!whiteBalanceFaceStageReady()?'已启用修肤但尚无人脸结果，白平衡取样已暂停；请完成检测或明确重置修肤。':tool==='white-balance'?(whiteBalanceFrameReady()?'点击应为灰/白色的小区域。选取完成前不修改照片。':'正在准备白平衡前的输入预览，请稍候…'):saved&&window.MintLightBalance.isActive(recipe)?'已应用 · 可撤销 · 预览/原尺寸导出共用像素算法。':'中性设置 · 原图不修改。';
}
function editLightBalance(edit,commit=true){
  if(!photoAvailable()||!lightBalanceReady())return false;
  try{const recipe=clone(current().settings.lightBalance??window.MintLightBalance.defaults());edit(recipe);const clean=window.MintLightBalance.validate(recipe);changeSettings({lightBalance:clean},commit);return true;}
  catch(e){toast(`明暗/白平衡未更改：${e.message||e}`,true);updateLightBalanceControls();return false;}
}
function beginWhiteBalancePoint(event){
  if(!event.target.closest('#imageSurface')||!whiteBalanceFrameReady())return;
  const r=$('imageSurface').getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>1||y>1)return;
  pointer={kind:'white-balance',id:event.pointerId,x,y,clientX:event.clientX,clientY:event.clientY,cancelled:false,frame:acceptedRender};
  $('viewport').setPointerCapture(event.pointerId);event.preventDefault();
}
function finishWhiteBalancePoint(event){
  const point=pointer,valid=event.type==='pointerup'&&!point.cancelled&&Math.hypot(event.clientX-point.clientX,event.clientY-point.clientY)<=6&&point.frame===acceptedRender&&whiteBalanceFrameReady();
  cancelWhiteBalancePointer();if(!valid)return;
  try{
    const c=point.frame.canvas,data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const gain=window.MintLightBalance.deriveWhiteBalance({width:c.width,height:c.height,data},{x:point.x,y:point.y});
    if(point.frame!==acceptedRender||!whiteBalanceFrameReady())return;
    setTool('pan');editLightBalance(recipe=>{recipe.whiteBalance=gain;});
    status('已按所选中性区域设置白平衡 · 可撤销；8位预览取样，不恢复已丢失的高光。');
  }catch(e){toast(`未取样：${e.message||e}。请选择均匀、未过曝的灰/白区域。`,true);updateLightBalanceControls();}
}
for(const [id,key] of [['shadowAmount','shadows'],['highlightAmount','highlights']]){
  $(id).addEventListener('input',()=>editLightBalance(r=>{r[key]=Number($(id).value);},false));
  $(id).addEventListener('change',()=>{if(photoAvailable())historyCommit(current());});
}
$('pickWhiteBalance').addEventListener('click',()=>setTool(tool==='white-balance'?'pan':'white-balance'));
$('cancelWhiteBalance').addEventListener('click',()=>{if(tool==='white-balance')setTool('pan');});
$('resetWhiteBalance').addEventListener('click',()=>editLightBalance(r=>{r.whiteBalance={r:1,g:1,b:1};}));
$('resetLightBalance').addEventListener('click',()=>{if(photoAvailable()&&lightBalanceReady())changeSettings({lightBalance:null});});

// Sharpening is a deliberate, cancellable form draft. A drag does not silently
// become an image/history/export edit; Apply binds it to this source revision.
function sharpnessReady(){return ['defaults','validate','isActive','plan','apply'].every(k=>typeof window.MintSharpness?.[k]==='function');}
function sharpnessActive(settings=current()?.settings){if(settings?.sharpness==null)return false;if(!sharpnessReady())throw new Error('锐化组件不可用，未忽略已保存参数');return window.MintSharpness.isActive(settings.sharpness);}
function sharpnessDraftCurrent(){const p=current();return !!sharpnessDraft&&!!p&&sharpnessDraft.photo===p&&sharpnessDraft.blob===p.blob&&sharpnessDraft.input===source&&sharpnessDraft.sourceRevision===sourceRevisionOf(p)&&sharpnessDraft.revision===p.revision&&sharpnessDraft.key===renderRecipeKey(p.settings);}
function sharpnessAvailable(){return photoAvailable()&&sharpnessReady()&&!backendJob&&!cropDraft&&!sourceViewActive();}
function sharpnessRecipeFromForm(){const recipe={version:1};for(const key of ['amount','radius','threshold']){const raw=$('sharpness'+key[0].toUpperCase()+key.slice(1)).value.trim();recipe[key]=raw===''?NaN:Number(raw);}return window.MintSharpness.validate(recipe);}
function cancelSharpnessDraft(){if(!sharpnessDraft)return;sharpnessDraft=null;updateSharpnessControls();}
function updateSharpnessControls(){
  if(!$('sharpnessSection'))return;
  if(sharpnessDraft&&!sharpnessDraftCurrent())sharpnessDraft=null;
  const p=current(),ready=sharpnessReady(),available=sharpnessAvailable();let saved=null,error='';
  if(ready)try{saved=window.MintSharpness.validate(p?.settings.sharpness??window.MintSharpness.defaults());}catch(e){error=String(e.message||e);}
  for(const key of ['amount','radius','threshold']){const id='sharpness'+key[0].toUpperCase()+key.slice(1),input=$(id);input.disabled=!available;if(!sharpnessDraft)input.value=String(saved?.[key]??({amount:0,radius:1,threshold:3})[key]);$(id+'Value').textContent=input.value+(key==='amount'?'%':key==='radius'?' px':'');}
  $('applySharpness').disabled=!available||!sharpnessDraft;$('cancelSharpness').disabled=!sharpnessDraft;$('resetSharpness').disabled=!available||(p?.settings.sharpness==null&&!sharpnessDraft);
  $('sharpnessStatus').textContent=!ready?'锐化组件不可用；不会忽略已存参数。':error?`已存参数无效：${error}`:!p?'导入照片后可用，默认强度0不改变图片。':!available?'请返回普通查看并结束当前工具；已应用锐化保留。':sharpnessDraft?'输入尚未应用。点“应用锐化”后预览、保存与导出才会改变。':saved?.amount>0?'已应用 · 可撤销 · 只增强现有细节，不恢复丢失信息。':'已关闭 · 原图不改变。';
  $('sharpnessBudget').textContent='';
  if(p&&ready)try{const recipe=sharpnessDraft?sharpnessRecipeFromForm():saved;if(recipe?.amount>0){const plan=window.MintSharpness.plan({width:source.width,height:source.height},recipe);let original='';try{window.MintSharpness.plan({width:p.originalWidth,height:p.originalHeight},recipe);original='原尺寸可进入锐化尺寸预算';}catch(e){original='原尺寸超出锐化预算；导出可明确选择工作尺寸，不自动缩小';}$('sharpnessBudget').textContent=`预览最大估算 ${(plan.maxTotalBytes/1048576).toFixed(1)} MiB（不含画布/历史） · ${original}。`;}}catch(e){$('sharpnessBudget').textContent=`未应用：${e.message||e}`;$('applySharpness').disabled=true;}
}
function editSharpnessForm(){
  if(!sharpnessAvailable())return;if(compare)setCompare(false);const p=current();
  if(!sharpnessDraftCurrent()){cancelStraightenDraft();paddingDraft=null;cancelTextPlacement();finishPaintStroke(false);finishRedactionStroke(false);sharpnessDraft={photo:p,blob:p.blob,input:source,sourceRevision:sourceRevisionOf(p),revision:p.revision,key:renderRecipeKey(p.settings)};}
  updateSharpnessControls();
}
function applySharpnessForm(){
  if(!sharpnessDraftCurrent()||!sharpnessAvailable())return;
  try{const recipe=sharpnessRecipeFromForm(),p=current(),candidate={...p.settings,sharpness:recipe},draft=sharpnessDraft;
    if(JSON.stringify(recipe)===JSON.stringify(p.settings.sharpness??window.MintSharpness.defaults())){sharpnessDraft=null;updateSharpnessControls();status('锐化未改变；没有新增历史');return;}
    if(typeof Pipeline.preflightRender!=='function')throw new Error('锐化预算检查组件不可用');
    Pipeline.preflightRender(source,candidate,factsForPhoto(p,analysis,source,candidate),{deferTextLayers:true,deferPaintLayers:true,deferRedactions:true,retainedBytes:straightenRetainedBytes(source,p)});
    if(changeSettings({sharpness:recipe})!==true){sharpnessDraft=draft;updateSharpnessControls();return;}
    sharpnessDraft=null;updateSharpnessControls();status('已应用受控锐化 · 原件保留 · 可撤销');
  }catch(e){toast(`锐化未更改：${e.message||e}`,true);updateSharpnessControls();}
}
for(const id of ['sharpnessAmount','sharpnessRadius','sharpnessThreshold'])for(const event of ['input','change'])$(id).addEventListener(event,editSharpnessForm);
$('applySharpness').addEventListener('click',applySharpnessForm);
$('cancelSharpness').addEventListener('click',()=>{cancelSharpnessDraft();status('已取消锐化输入，图片未改变');});
$('resetSharpness').addEventListener('click',()=>{if(!sharpnessAvailable())return;sharpnessDraft=null;changeSettings({sharpness:null});updateSharpnessControls();});

// Levels operate on display-referred 8-bit sRGB code values, before curves/HSL.
// The selected channel is UI state only. Never mutate saved recipes until the
// shared core has validated every endpoint, gamma and strength value.
const levelsChannels = ['rgb', 'red', 'green', 'blue'];
const levelsFields = [['InputBlack','inputBlack'], ['Gamma','gamma'], ['InputWhite','inputWhite'], ['OutputBlack','outputBlack'], ['OutputWhite','outputWhite']];
const levelsCoreReady = () => ['defaults','validate','isActive','apply','buildLuts'].every(key => typeof window.MintLevels?.[key] === 'function');
const levelsChannel = () => levelsChannels.includes($('levelsChannel').value) ? $('levelsChannel').value : 'rgb';
function editLevels(edit, commit = true) {
  if (!photoAvailable() || !levelsCoreReady()) return false;
  try {
    const p = current(), recipe = clone(p.settings.levels ?? window.MintLevels.defaults());
    edit(recipe);
    const validated = window.MintLevels.validate(recipe);
    if (JSON.stringify(validated) === JSON.stringify(p.settings.levels)) { if (commit) historyCommit(p); return true; }
    changeSettings({ levels: validated }, commit);
    return true;
  } catch (error) { toast(`色阶未更改：${error.message || error}`, true); updateLevelsControls(); return false; }
}
function updateLevelsControls() {
  const ready = levelsCoreReady(), saved = current()?.settings.levels;
  let recipe = null, active = false, error = '';
  if (ready) {
    try { recipe = window.MintLevels.validate(clone(saved ?? window.MintLevels.defaults())); active = window.MintLevels.isActive(recipe); }
    catch (failure) { error = String(failure.message || failure); }
  }
  const available = ready && !!recipe && photoAvailable();
  for (const id of ['levelsChannel','levelsStrength','resetLevelsChannel', ...levelsFields.map(([name]) => `levels${name}`)]) $(id).disabled = !available;
  // An invalid imported/in-memory recipe is visible and can be explicitly reset,
  // but cannot silently turn into a neutral recipe while rendering or editing.
  $('resetLevels').disabled = !ready || !photoAvailable() || !saved;
  $('levelsStatus').textContent = !ready ? '色阶核心不可用，控制已停用；不会忽略已有色阶。' : error ? `色阶参数无效，未更改照片：${error}。可全部重置后重试。` : !current() ? '导入照片后可用；默认不改变图像。' : !saved ? '尚未添加色阶 · 默认不改变图像。' : active ? '色阶已应用 · 预览与导出使用同一算法。' : '当前色阶为中性或强度为0 · 不改变图像。';
  if (!recipe) return;
  $('levelsChannel').value = levelsChannel();
  const values = recipe.channels[levelsChannel()];
  const limits = { inputBlack: [0, values.inputWhite - 1], inputWhite: [values.inputBlack + 1, 255], gamma: [.1, 10], outputBlack: [0, values.outputWhite], outputWhite: [values.outputBlack, 255] };
  for (const [name, key] of levelsFields) {
    const input = $(`levels${name}`), [min, max] = limits[key];
    input.min = min; input.max = max; input.value = values[key];
    $(`levels${name}Value`).textContent = String(values[key]);
    input.setAttribute('aria-valuetext', `${values[key]}${key === 'gamma' ? '' : ' / 255'}`);
    if (max > min) rangeStyle(input); else input.style.setProperty('--fill', '50%');
  }
  const strength = $('levelsStrength'); strength.value = recipe.strength * 100;
  $('levelsStrengthValue').textContent = `${Number((recipe.strength * 100).toFixed(6))}%`; rangeStyle(strength);
}
$('levelsChannel').addEventListener('change', updateLevelsControls);
for (const [name, key] of levelsFields) {
  const apply = (event, commit) => editLevels(recipe => { recipe.channels[levelsChannel()][key] = Number(event.target.value); }, commit);
  $(`levels${name}`).addEventListener('input', event => apply(event, false));
  $(`levels${name}`).addEventListener('change', event => apply(event, true));
}
$('levelsStrength').addEventListener('input', event => editLevels(recipe => { recipe.strength = Number(event.target.value) / 100; }, false));
$('levelsStrength').addEventListener('change', event => editLevels(recipe => { recipe.strength = Number(event.target.value) / 100; }));
$('resetLevelsChannel').addEventListener('click', () => { if (current()?.settings.levels) editLevels(recipe => { recipe.channels[levelsChannel()] = clone(window.MintLevels.defaults().channels[levelsChannel()]); }); });
$('resetLevels').addEventListener('click', () => { if (photoAvailable() && levelsCoreReady() && current().settings.levels !== null) changeSettings({ levels: null }); });

// Global display-referred tone recipes are ordinary settings, not source-bound masks.
// All curve/HSL edits share the renderer/export core. This UI never synthesizes an
// effect when that core is missing, and the graph samples the actual curve code.
const toneChannels = ['rgb', 'red', 'green', 'blue'];
const toneNodes = [0, .25, .5, .75, 1];
const toneChannelNames = { rgb: 'RGB 总体', red: '红色', green: '绿色', blue: '蓝色', luma: '亮度码值' };
const toneColors = { rgb: '#b7ead4', red: '#f39491', green: '#9bd9a8', blue: '#8fbafa', luma: '#dce4cc' };
const toneCoreReady = () => ['defaults', 'validate', 'isActive', 'apply', 'histogram'].every(key => typeof window.MintAdvancedTone?.[key] === 'function');
const toneChannel = () => toneChannels.includes($('toneCurveChannel').value) ? $('toneCurveChannel').value : 'rgb';
const toneBand = () => Math.max(0, Math.min(7, Math.trunc(Number($('toneHslBand').value) || 0)));
function editAdvancedTone(edit, commit = true) {
  if (!photoAvailable() || !toneCoreReady()) return;
  try {
    const recipe = clone(current().settings.advancedTone || window.MintAdvancedTone.defaults());
    edit(recipe);
    const validated = window.MintAdvancedTone.validate(recipe);
    changeSettings({ advancedTone: validated }, commit);
  } catch (error) { toast(`高级调色未更改：${error.message || error}`, true); updateAdvancedToneControls(); }
}
function drawToneCurve(recipe) {
  const canvas = $('toneCurveGraph'), channel = toneChannel(), key = JSON.stringify([channel, recipe?.curveMode, recipe?.curves[channel]]);
  if (toneCurveGraphKey === key) return;
  toneCurveGraphKey = null;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!recipe || !toneCoreReady()) return;
  const graphRecipe = window.MintAdvancedTone.defaults();
  graphRecipe.curveMode = recipe.curveMode; graphRecipe.curves.rgb = [...recipe.curves[channel]];
  const data = new Uint8ClampedArray(256 * 4);
  for (let x = 0; x < 256; x++) { data[x * 4] = x; data[x * 4 + 1] = x; data[x * 4 + 2] = x; data[x * 4 + 3] = 255; }
  const points = window.MintAdvancedTone.apply({ width: 256, height: 1, data }, graphRecipe).data;
  const pad = 16, width = canvas.width - 2 * pad, height = canvas.height - 2 * pad;
  ctx.lineWidth = 1; ctx.strokeStyle = '#3c5143';
  for (const v of toneNodes) { ctx.beginPath(); ctx.moveTo(pad + v * width, pad); ctx.lineTo(pad + v * width, pad + height); ctx.moveTo(pad, pad + v * height); ctx.lineTo(pad + width, pad + v * height); ctx.stroke(); }
  ctx.strokeStyle = '#6b8071'; ctx.beginPath(); ctx.moveTo(pad, pad + height); ctx.lineTo(pad + width, pad); ctx.stroke();
  ctx.strokeStyle = toneColors[channel]; ctx.lineWidth = 2.5; ctx.beginPath();
  for (let x = 0; x < 256; x++) { const px = pad + x / 255 * width, py = pad + (1 - points[x * 4] / 255) * height; if (x) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.stroke(); ctx.fillStyle = toneColors[channel];
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(pad + toneNodes[i] * width, pad + (1 - recipe.curves[channel][i]) * height, 4, 0, 2 * Math.PI); ctx.fill(); }
  canvas.setAttribute('aria-label', `${toneChannelNames[channel]}曲线，横轴输入、纵轴输出；输出节点 ${recipe.curves[channel].map(v => `${Math.round(v * 100)}%`).join('、')}。图线显示通道曲线本身，不含整体强度或 HSL。`);
  toneCurveGraphKey = key;
}
function updateAdvancedToneControls() {
  const ready = toneCoreReady(), available = ready && photoAvailable(), saved = current()?.settings.advancedTone;
  const recipe = ready ? (saved || window.MintAdvancedTone.defaults()) : null;
  const ids = ['advancedToneEnabled','advancedToneStrength','toneCurveChannel','toneCurveMode','toneHslBand','toneHslHue','toneHslSaturation','toneHslLuminance','resetAdvancedTone','resetToneChannel','resetToneCurves','resetToneBand','resetToneHsl', ...toneNodes.map((_, i) => `toneCurveNode${i}`)];
  for (const id of ids) $(id).disabled = !available;
  $('advancedToneStatus').textContent = !ready ? '高级调色核心不可用，曲线、HSL 与直方图已停用。' : !current() ? '导入照片后可用；默认不改变图像。' : !saved ? '尚未添加高级调色 · 默认不改变图像。' : !recipe.enabled ? '高级调色已关闭 · 参数保留，暂不作用于图像。' : window.MintAdvancedTone.isActive(recipe) ? '高级调色已启用 · 预览与导出使用同一算法。' : '当前高级调色为中性或强度为0 · 不改变图像。';
  if (!recipe) { drawToneCurve(null); clearToneHistogram(); return; }
  $('toneCurveChannel').value = toneChannel(); $('toneHslBand').value = String(toneBand());
  $('advancedToneEnabled').checked = recipe.enabled; $('advancedToneStrength').value = recipe.strength * 100;
  $('advancedToneStrengthValue').textContent = `${Math.round(recipe.strength * 100)}%`; rangeStyle($('advancedToneStrength'));
  $('toneCurveMode').value = recipe.curveMode;
  const values = recipe.curves[toneChannel()];
  for (let i = 0; i < 5; i++) {
    const input = $(`toneCurveNode${i}`);
    input.min = recipe.curveMode === 'monotone' && i > 0 ? values[i - 1] * 100 : 0;
    input.max = recipe.curveMode === 'monotone' && i < 4 ? values[i + 1] * 100 : 100;
    input.value = values[i] * 100; input.setAttribute('aria-valuetext', `输入 ${toneNodes[i] * 100}%，输出 ${Math.round(values[i] * 100)}%`);
    $(`toneCurveNode${i}Value`).textContent = `${Math.round(values[i] * 100)}%`;
    if (Number(input.max) > Number(input.min)) rangeStyle(input); else input.style.setProperty('--fill', '50%');
  }
  $('toneCurveModeNote').textContent = recipe.curveMode === 'free' ? '自由模式允许输出反转，可能产生强烈色调变化。切回单调模式前，四个通道均须按输出值递增；不会偷偷重排节点。' : '单调模式下，输出值不能跨越相邻节点；自由模式允许色调反转。图线显示通道曲线本身，不含整体强度或 HSL。';
  const band = recipe.hsl[toneBand()];
  for (const [name, key] of [['Hue','hue'],['Saturation','saturation'],['Luminance','luminance']]) {
    const input = $(`toneHsl${name}`); input.value = band[key]; rangeStyle(input);
    $(`toneHsl${name}Value`).textContent = `${band[key] > 0 ? '+' : ''}${band[key]}${key === 'hue' ? '°' : ''}`;
  }
  try { drawToneCurve(recipe); }
  catch (error) { $('advancedToneStatus').textContent = `曲线图无法生成：${error.message || error}。`; }
}
function clearToneHistogram(message = '等待处理后的预览。') {
  toneHistogram = null;
  const canvas = $('toneHistogramGraph'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('toneHistogramSummary').textContent = toneCoreReady() ? message : '直方图组件不可用。';
  $('toneHistogramEndpoints').textContent = '';
  canvas.setAttribute('aria-label', $('toneHistogramSummary').textContent);
}
function toneHistogramStampCurrent(stamp, canvas) {
  return !!current() && stamp.token === viewToken && stamp.version === renderVersion && stamp.photoId === currentId && stamp.sourceRevision === sourceRevisionOf(current()) && rendered === canvas;
}
function updateToneHistogram(canvas, stamp) {
  if (!toneHistogramStampCurrent(stamp, canvas)) return false;
  if (!toneCoreReady()) { clearToneHistogram('直方图组件不可用。'); return false; }
  try {
    // Read the accepted render, never previewCanvas (which contains compare/overlays).
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const result = window.MintAdvancedTone.histogram({ width: canvas.width, height: canvas.height, data: pixels.data }, { maxSamples: 262144 });
    if (!toneHistogramStampCurrent(stamp, canvas)) return false;
    toneHistogram = { ...result, stamp: { ...stamp } };
    const graph = $('toneHistogramGraph'), ctx = graph.getContext('2d'), pad = 8, width = graph.width - 2 * pad, height = graph.height - 2 * pad;
    ctx.clearRect(0, 0, graph.width, graph.height);
    const max = Math.max(1, ...Object.values(result.bins).map(bins => bins.reduce((highest, value) => Math.max(highest, value), 0)));
    for (const channel of ['red','green','blue','luma']) {
      ctx.strokeStyle = toneColors[channel]; ctx.lineWidth = channel === 'luma' ? 2 : 1.4; ctx.beginPath();
      for (let x = 0; x < 256; x++) { const px = pad + x / 255 * width, py = pad + height - result.bins[channel][x] / max * height; if (x) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    }
    const view = stamp.manualEditing ? '手动编辑视图' : stamp.sourceView ? '完整原图坐标处理预览' : '处理后预览';
    $('toneHistogramSummary').textContent = `${view} · ${canvas.width} × ${canvas.height} · ${result.approximate ? '分层采样近似' : '全部预览像素'} ${result.sampledPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()} · 有效 alpha 权重 ${result.effectiveSamples.toFixed(1)}${result.visibleSamples === 0 ? ' · 没有可见像素' : ''}。`;
    $('toneHistogramEndpoints').textContent = ['red','green','blue','luma'].map(channel => `${toneChannelNames[channel]}：0码值 ${(result.endpoints[channel].blackFraction * 100).toFixed(2)}% · 255码值 ${(result.endpoints[channel].whiteFraction * 100).toFixed(2)}%`).join('\n');
    graph.setAttribute('aria-label', `${$('toneHistogramSummary').textContent} ${$('toneHistogramEndpoints').textContent}`);
    return true;
  } catch (error) { if (toneHistogramStampCurrent(stamp, canvas)) clearToneHistogram(`无法读取预览直方图：${error.message || error}`); return false; }
}
$('advancedToneEnabled').addEventListener('change', event => editAdvancedTone(recipe => { recipe.enabled = event.target.checked; }));
$('advancedToneStrength').addEventListener('input', event => editAdvancedTone(recipe => { recipe.strength = Number(event.target.value) / 100; }, false));
$('toneCurveChannel').addEventListener('change', updateAdvancedToneControls);
$('toneHslBand').addEventListener('change', updateAdvancedToneControls);
$('toneCurveMode').addEventListener('change', event => {
  const mode = event.target.value;
  if (mode === 'monotone' && current()?.settings.advancedTone && toneChannels.some(channel => current().settings.advancedTone.curves[channel].some((value, i, all) => i > 0 && value < all[i - 1]))) {
    toast('无法切回单调模式：有通道包含反转。请先调整节点或重置全部曲线；现有曲线未改变。', true); updateAdvancedToneControls(); return;
  }
  editAdvancedTone(recipe => { recipe.curveMode = mode; });
});
for (let i = 0; i < 5; i++) $(`toneCurveNode${i}`).addEventListener('input', event => editAdvancedTone(recipe => { recipe.curves[toneChannel()][i] = Number(event.target.value) / 100; }, false));
for (const [name, key] of [['Hue','hue'],['Saturation','saturation'],['Luminance','luminance']]) $(`toneHsl${name}`).addEventListener('input', event => editAdvancedTone(recipe => { recipe.hsl[toneBand()][key] = Number(event.target.value); }, false));
for (const id of ['advancedToneStrength','toneHslHue','toneHslSaturation','toneHslLuminance', ...toneNodes.map((_, i) => `toneCurveNode${i}`)]) $(id).addEventListener('change', () => { if (photoAvailable() && toneCoreReady()) historyCommit(current()); });
$('resetToneChannel').addEventListener('click', () => editAdvancedTone(recipe => { recipe.curves[toneChannel()] = [...toneNodes]; }));
$('resetToneCurves').addEventListener('click', () => editAdvancedTone(recipe => { for (const channel of toneChannels) recipe.curves[channel] = [...toneNodes]; }));
$('resetToneBand').addEventListener('click', () => editAdvancedTone(recipe => { recipe.hsl[toneBand()] = { hue: 0, saturation: 0, luminance: 0 }; }));
$('resetToneHsl').addEventListener('click', () => editAdvancedTone(recipe => { recipe.hsl = window.MintAdvancedTone.defaults().hsl; }));
$('resetAdvancedTone').addEventListener('click', () => { if (photoAvailable() && toneCoreReady()) changeSettings({ advancedTone: null }); });

// Explicit per-detection-batch face controls. Face numbers are not identity tracking.
let peoplePending = null;
const peopleOpaqueSources = new WeakMap();
const peopleBeautyKeys = ['smooth','brighten','warmth','underEye','redness','lip','blush'];
const peopleShapeKeys = ['slim','eyes','nose','jaw'];
const peopleKeys = [...peopleBeautyKeys,...peopleShapeKeys,'palette'];
function peopleReady(){return !!window.MintPortraitPeople?.createBatch && !!window.MintPortraitPeopleDesktop?.validateCompatibility;}
function selectedPerson(p=current()){
  const batch=p?.settings.faceAdjustments,choice=p?.peopleChoice;
  return batch && choice?.batchId===batch.batchId ? batch.faces.find(face=>face.id===choice.id)||null : null;
}
function peopleEffects(batch){return batch!=null && (window.MintPortraitPeopleDesktop.hasEffect(batch,'beauty')||window.MintPortraitPeopleDesktop.hasEffect(batch,'reshape'));}
function peopleError(error){return `逐人调整未更改：${error.message||error}。人物靠近时请减小影响范围；不会裁掉影响区域或修改邻人。`;}
function validatePeopleSettings(settings,p=current(),size=source){
  if(settings.faceAdjustments==null)return;
  if(!peopleReady())throw new Error('逐人修饰组件不可用');
  const api=window.MintPortraitPeopleDesktop,revision=sourceRevisionOf(p);
  api.validateCompatibility(settings,revision);
  if(size)for(const phase of ['beauty','reshape'])api.planSize(size.width,size.height,settings.faceAdjustments,{sourceRevision:revision,phase});
  if(size===source&&api.hasEffect(settings.faceAdjustments,'reshape')){
    if(!peopleOpaqueSources.has(source)){const pixels=source.getContext('2d').getImageData(0,0,source.width,source.height);let opaque=true;for(let i=3;i<pixels.data.length;i+=4)if(pixels.data[i]!==255){opaque=false;break;}peopleOpaqueSources.set(source,opaque);}
    if(!peopleOpaqueSources.get(source))throw new Error('逐人塑形不支持透明或半透明原图，请保留不透明原图后重新抠图');
  }
}
function peopleSliderValue(key,settings=current()?.settings){
  if(!settings?.faceAdjustments||!peopleKeys.includes(key))return settings?.[key];
  const face=selectedPerson();return face ? (peopleShapeKeys.includes(key)?face.reshape[key]:face.beauty[key]) : key==='palette'?'natural':0;
}
function setAdjustment(key,value,commit=true){
  const p=current();if(!p||!photoAvailable())return false;
  if(!p.settings.faceAdjustments||!peopleKeys.includes(key))return changeSettings({[key]:value},commit);
  const face=selectedPerson();if(!face){toast('请先明确选择本次检测中的人物。',true);updateControls();return false;}
  const batch=clone(p.settings.faceAdjustments),target=batch.faces.find(item=>item.id===face.id);
  (peopleShapeKeys.includes(key)?target.reshape:target.beauty)[key]=value;
  const changed=changeSettings({faceAdjustments:batch},commit);
  if(changed){$('peopleInspect').checked=false;drawPreview();}return changed;
}
function updatePeopleControls(){
  if(!$('peopleEnable'))return;
  const p=current(),batch=p?.settings.faceAdjustments,available=photoAvailable()&&!analyzingPhoto&&!backendJob,ready=peopleReady();
  const select=$('peopleFaceSelect'),signature=batch?JSON.stringify([batch.batchId,batch.faces.map(f=>f.id)]):'';
  if(select.dataset.signature!==signature){
    select.dataset.signature=signature;select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='先选择人物，不自动匹配身份';select.append(empty);
    for(const [i,face]of(batch?.faces||[]).entries()){const o=document.createElement('option');o.value=face.id;o.textContent=`人物 ${i+1}`;select.append(o);}
    if(p&&p.peopleChoice?.batchId!==batch?.batchId)p.peopleChoice=null;
  }
  select.value=selectedPerson(p)?.id||'';select.disabled=!available||!batch||!ready;
  $('peopleEnable').disabled=!available||!ready||!!batch||modelState!=='ready';
  $('peopleRedetect').disabled=!available||!ready||!batch||modelState!=='ready';
  $('peopleCancel').disabled=!peoplePending||peoplePending.cancelled;
  $('peopleDisable').disabled=!available||!batch;
  $('peopleResetFace').disabled=!available||!selectedPerson(p);
  $('peopleInspect').disabled=!available||!batch||!batch.faces.length;
  if(!batch)$('peopleInspect').checked=false;
  $('peopleStatus').textContent=!p?'导入照片后，先检测并选择人物。':!ready?'逐人组件不可用，未启用替代效果。':batch?`本批次 ${batch.faces.length} 人 · ${selectedPerson(p)?`当前：人物 ${batch.faces.indexOf(selectedPerson(p))+1}`:'尚未选人，修肤和塑形暂停调节'}。编号仅属于此检测批次；重新检测不会继承参数。`:(analysis?.faceCount>1?'检测到多人，请启用逐人模式后明确选人。旧工程已有全局效果保留，但不自动分配给人物。':'旧版全局模式。启用逐人后，各人物从零开始，其他调色和手动历史保留。');
}
async function enablePeople(redetect=false){
  const p=current();if(!p||!photoAvailable()||analyzingPhoto||backendJob||!peopleReady()||modelState!=='ready')return;
  const batch=p.settings.faceAdjustments;
  if(redetect?!batch:!!batch)return;
  if((batch&&peopleEffects(batch))||[...peopleBeautyKeys,...peopleShapeKeys].some(k=>p.settings[k]!==0)){
    if(!window.confirm('这会建立全新人物批次并将人像参数归零，不会按编号猜测同一人。其他调整保留，本次更改可以撤销。继续吗？'))return;
  }
  const token=viewToken,input=source,blob=p.blob,key=JSON.stringify(p.settings),revision=sourceRevisionOf(p),editRevision=p.revision;
  const job={photo:p,cancelled:false};peoplePending=job;updatePeopleControls();
  try{
    if(redetect||!analysis?.detector)await analyzeCurrent(token);
    if(job.cancelled||pageDisposed||p!==current()||token!==viewToken||input!==source||blob!==p.blob||revision!==sourceRevisionOf(p)||editRevision!==p.revision||key!==JSON.stringify(p.settings)||!photoAvailable())return;
    if(!analysis?.landmarks?.length||!analysis.detector||!analysis.detectionSize)throw new Error('没有本次照片的完整人脸检测结果，原参数保留');
    const next=window.MintPortraitPeople.createBatch({sourceRevision:sourceRevisionOf(p),batchId:`faces:${crypto.randomUUID()}`,detector:clone(analysis.detector),detectionSize:clone(analysis.detectionSize),landmarks:clone(analysis.landmarks)});
    const changes={faceAdjustments:next};for(const k of [...peopleBeautyKeys,...peopleShapeKeys])changes[k]=0;
    if(changeSettings(changes)!==true)return;
    p.peopleChoice=null;$('peopleInspect').checked=true;$('learnedFaceBoxes').checked=false;setTool('pan');updateControls();drawPreview();
    status(`已建立 ${next.faces.length} 人的新批次，请明确选人。所有人物参数为零。`);
  }catch(error){toast(peopleError(error),true);}
  finally{if(peoplePending===job)peoplePending=null;updatePeopleControls();}
}
function cancelPeopleDetection(){if(peoplePending){peoplePending.cancelled=true;status('已取消人物批次更新，正在等待本地检测退出；旧人物与参数保留。');updatePeopleControls();}}
$('peopleCancel').addEventListener('click',cancelPeopleDetection);
$('peopleEnable').addEventListener('click',()=>enablePeople(false));
$('peopleRedetect').addEventListener('click',()=>enablePeople(true));
$('peopleFaceSelect').addEventListener('change',event=>{const p=current(),batch=p?.settings.faceAdjustments;if(!batch||!photoAvailable())return;const id=event.target.value;historyCommit(p);p.peopleChoice=batch.faces.some(f=>f.id===id)?{batchId:batch.batchId,id}:null;updateControls();drawPreview();});
$('peopleInspect').addEventListener('change',()=>{if($('peopleInspect').checked){$('learnedFaceBoxes').checked=false;setTool('pan');}drawPreview();updateAvailability();});
$('peopleResetFace').addEventListener('click',()=>{const p=current(),face=selectedPerson();if(!face||!photoAvailable())return;const batch=clone(p.settings.faceAdjustments),target=batch.faces.find(f=>f.id===face.id);target.beauty=window.MintPortraitPeople.defaultsBeauty();target.reshape=window.MintPortraitPeople.defaultsReshape();changeSettings({faceAdjustments:batch});});
$('peopleDisable').addEventListener('click',()=>{const p=current(),batch=p?.settings.faceAdjustments;if(!batch||!photoAvailable())return;if(peopleEffects(batch)&&!window.confirm('停用逐人模式会移除本批次的人像修饰，可撤销。其他照片和调整不变。继续吗？'))return;if(changeSettings({faceAdjustments:null})===true){p.peopleChoice=null;$('peopleInspect').checked=false;updateControls();drawPreview();}});
function drawPeopleBoxes(ctx,p){
  if(!$('peopleInspect').checked||!p.settings.faceAdjustments)return;
  ctx.save();ctx.lineWidth=Math.max(1,1.5/zoom);ctx.font=`${Math.max(12,12/zoom)}px sans-serif`;
  p.settings.faceAdjustments.faces.forEach((face,i)=>{const xs=face.landmarks.map(v=>v.x),ys=face.landmarks.map(v=>v.y),x=Math.min(...xs)*source.width,y=Math.min(...ys)*source.height,w=(Math.max(...xs)-Math.min(...xs))*source.width,h=(Math.max(...ys)-Math.min(...ys))*source.height;ctx.strokeStyle=selectedPerson(p)?.id===face.id?'#d8ff94':'#7be7c0';ctx.fillStyle=ctx.strokeStyle;ctx.strokeRect(x,y,w,h);ctx.fillText(`人物 ${i+1}`,x+4/zoom,Math.max(15/zoom,y-5/zoom));});ctx.restore();
}

const controls = [
  ['exposure', '曝光 EV', -100, 100, 'colorControls', 'color'], ['contrast', '对比度', -100, 100, 'colorControls', 'color'],
  ['saturation', '饱和度', -100, 100, 'colorControls', 'color'], ['temperature', '色温', -100, 100, 'colorControls', 'color'],
  ['smooth', '柔肤', 0, 100, 'skinControls', 'face'], ['brighten', '肤色提亮', 0, 100, 'skinControls', 'face'], ['warmth', '肤色冷暖', -100, 100, 'skinControls', 'face'],
  ['underEye', '眼下轻提亮', 0, 100, 'faceColorControls', 'face-color'], ['redness', '局部减红', 0, 100, 'faceColorControls', 'face-color'], ['lip', '唇色', 0, 100, 'faceColorControls', 'face-color'], ['blush', '面颊气色', 0, 100, 'faceColorControls', 'face-color'],
  ['slim', '瘦脸', 0, 100, 'shapeControls', 'face'], ['eyes', '眼睛放大', 0, 100, 'shapeControls', 'face'], ['nose', '鼻翼收窄', -100, 100, 'shapeControls', 'face'], ['jaw', '下颌收窄', -100, 100, 'shapeControls', 'face']
];
function rangeMarkup(key, label, min, max) {
  return `<div class="control" data-control="${key}"><div class="control-label"><label for="control-${key}">${label}</label><output for="control-${key}" id="value-${key}">0</output></div><input type="range" id="control-${key}" data-setting="${key}" min="${min}" max="${max}" step="1" value="0"></div>`;
}
function rangeStyle(input) { input.style.setProperty('--fill', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`); }
for (const [key, label, min, max, container] of controls) $(container).insertAdjacentHTML('beforeend', rangeMarkup(key, label, min, max));
$('skinControls').insertAdjacentHTML('beforeend', '<p class="control-note">仅作用于检测到的人脸区域，适量保留真实肤质。</p>');
$('shapeControls').insertAdjacentHTML('beforeend', '<p class="control-note">基于真实人脸关键点进行局部形变。鼻翼与下颌负值为加宽。</p>');
$('parameters').addEventListener('input', event => {
  const key = event.target.dataset.setting;
  if (!key) return;
  setAdjustment(key, ['bgColor','palette'].includes(key) ? event.target.value : Number(event.target.value), false);
});
$('parameters').addEventListener('change', event => { if (event.target.dataset.setting && current() && photoAvailable()) { historyCommit(current()); updateControls(); } });
$('parameters').addEventListener('dblclick', event => {
  const control = event.target.closest('[data-control]'); if (!control || !photoAvailable()) return;
  const key = control.dataset.control; setAdjustment(key, defaults()[key] ?? 0);
});

function imageActive(settings=current()?.settings){const rows=settings?.imageLayers||[];if(!rows.length)return false;if(!window.MintImageLayers)throw new Error('贴图组件不可用');return window.MintImageLayers.isActive(rows);}
function imageAssetTable(p){const table=p?.imageAssets||[];if(!table.length)return Object.freeze([]);if(!window.MintImageLayers)throw new Error('贴图素材组件不可用');return window.MintImageLayers.validateAssets(table);}
function imageAssetsFor(p,settings=p?.settings){if(!settings?.imageLayers?.length)return Object.freeze([]);if(!window.MintImageLayerSession)throw new Error('贴图素材组件不可用，不会忽略图层');return window.MintImageLayerSession.select(p?.imageAssets||[],settings);}
function retainImageAssets(p){if(!p?.imageAssets?.length)return;const states=[p.settings,p.committed,...p.undo,...p.redo];if(p.exportedSettings)states.push(JSON.parse(p.exportedSettings));p.imageAssets=window.MintImageLayerSession.retain(p.imageAssets,states);}
function imageLayerPlan(p,settings,width,height){const assets=imageAssetsFor(p,settings);if(!settings?.imageLayers?.length&&!assets.length)return null;if(!window.MintImageLayers)throw new Error('贴图组件不可用');return window.MintImageLayers.plan(width,height,settings.imageLayers,assets);}
function commitImageLayers(layers,asset){const p=current();if(!p||!photoAvailable())return false;const old=p.imageAssets||Object.freeze([]);const table=asset?window.MintImageLayerSession.append(old,asset):old;window.MintImageLayerSession.sessionPlan(photos.map(other=>other===p?table:other.imageAssets||[]));const candidate={...p.settings,imageLayers:layers};exportDimensions({...p,settings:candidate,imageAssets:table},exportMode());const prior={settings:clone(p.settings),committed:clone(p.committed),undo:clone(p.undo),redo:clone(p.redo),revision:p.revision,preset:p.preset,imageAssets:old};p.imageAssets=table;try{const ok=changeSettings({imageLayers:clone(layers)});if(ok!==true){Object.assign(p,prior);return false;}status('本地图片层已应用 · 可重编/撤销 · 原图未改');return true;}catch(error){Object.assign(p,prior);renderController?.abort();throw error;}}
function mountImagePanel(){if(!window.MintImageLayerPanel||!window.MintImageAssets||!window.MintImageOverlay||!window.MintImageLayers||!window.MintImageLayerSession)return;const codec=window.MintImageAssets.createCodec({overlay:window.MintImageOverlay});imagePanel=window.MintImageLayerPanel.mount({document,bridge,overlay:window.MintImageOverlay,layers:window.MintImageLayers,codec,getContext:()=>({photo:current(),available:photoAvailable()&&!backendJob&&!cropDraft&&!sourceViewActive()&&!pageDisposed}),commit:commitImageLayers,onState:()=>updateAvailability(),notify:toast,onBegin:()=>{historyCommit(current());setTool('pan');},onPlace:()=>{setTool('pan');setCompare(false);referenceRequested=false;cancelTextPlacement();updateReferenceComparison();}});}
$('imageLayerBasisMode')?.addEventListener('change',()=>{if(locked())return;$('exportMode').value=$('imageLayerBasisMode').value==='working'?'working':'original';finalOutputBasisChanged();});

// Editable final-canvas text. Form drafts never become history or export until Apply.
let textDraft = null, textPlacing = false, textRasterCache = null, textRendererService = null;
const textFieldIds = ['textContent','textEnabled','textX','textY','textSize','textWidth','textRotation','textAlign','textFont','textBold','textItalic','textLineHeight','textColor','textOpacity','textOutline','textOutlineColor','textShadow'];
function textReady() { return !!window.MintTextOverlay?.validate && !!window.MintTextLayers?.validate && !!window.MintTextLayerRenderer?.create; }
function textLayersOf(p = current()) { return p?.settings.textLayers || []; }
function textActive(settings = current()?.settings) {
  const layers=settings?.textLayers || []; if(!layers.length)return false;
  if(!window.MintTextLayers?.isActive)throw new Error('文字组件不可用，未忽略已有文字');
  return window.MintTextLayers.isActive(layers);
}
function textRenderer() {
  if(!textReady())throw new Error('文字栅格组件不可用');
  return textRendererService ||= window.MintTextLayerRenderer.create({document,crypto,textCore:window.MintTextOverlay,layersCore:window.MintTextLayers});
}
function textRasterKey(p,layers,width,height,mode) { return JSON.stringify([sourceRevisionOf(p),window.MintTextLayers.canonicalRecipe(layers),width,height,mode]); }
async function prepareTextRaster(p,settings,mode,signal,isCurrent) {
  if(!textActive(settings))return null;
  const dims=exportDimensions({...p,settings},mode);
  if(dims.width*dims.height>16000000||Math.max(dims.width,dims.height)>16384)throw new Error('文字最终画布上限1600万像素/长边16384，请明确选择工作尺寸或缩小构图/留白');
  const key=textRasterKey(p,settings.textLayers,dims.width,dims.height,mode);
  if(signal?.aborted||isCurrent?.()===false)throw new DOMException('文字任务已取消或过期','AbortError');
  if(textRasterCache?.blob===p.blob&&textRasterCache.key===key)return textRasterCache.raster;
  const raster=await textRenderer().raster({layers:settings.textLayers,width:dims.width,height:dims.height,signal,isCurrent});
  if(signal?.aborted||isCurrent?.()===false)throw new DOMException('文字任务已取消或过期','AbortError');
  textRasterCache={blob:p.blob,key,raster};return raster;
}
function selectedTextLayer() { const p=current(),layers=textLayersOf(p);return layers.find(l=>l.id===p?.textLayerId)||layers.at(-1)||null; }
function textDraftCurrent() {const p=current();return !!textDraft&&textDraft.photo===p&&textDraft.blob===p?.blob&&textDraft.sourceRevision===sourceRevisionOf(p)&&textDraft.revision===p?.revision&&textDraft.key===JSON.stringify(p?.settings);}
function textEditable() {return photoAvailable()&&textReady()&&!backendJob&&!cropDraft&&!sourceViewActive();}
function textRecipeFromForm() {
  const n=id=>{const v=$(id).value;if(typeof v!=='string'||!v.trim())throw new Error('文字数值不能为空');return Number(v);};
  return window.MintTextOverlay.validate({version:1,text:$('textContent').value,x:n('textX')/100,y:n('textY')/100,size:n('textSize')/100,boxWidth:n('textWidth')/100,rotation:n('textRotation'),align:$('textAlign').value,fontFamily:$('textFont').value,bold:$('textBold').checked,italic:$('textItalic').checked,lineHeight:n('textLineHeight'),color:$('textColor').value,opacity:n('textOpacity')/100,outlineWidth:n('textOutline')/100,outlineColor:$('textOutlineColor').value,shadow:$('textShadow').checked});
}
function setTextForm(r,enabled=true){
  $('textContent').value=r.text;$('textEnabled').checked=enabled;
  for(const [id,key,scale]of[['textX','x',100],['textY','y',100],['textSize','size',100],['textWidth','boxWidth',100],['textRotation','rotation',1],['textLineHeight','lineHeight',1],['textOpacity','opacity',100],['textOutline','outlineWidth',100]])$(id).value=String(r[key]*scale);
  for(const [id,key]of[['textAlign','align'],['textFont','fontFamily'],['textColor','color'],['textOutlineColor','outlineColor']])$(id).value=r[key];
  for(const [id,key]of[['textBold','bold'],['textItalic','italic'],['textShadow','shadow']])$(id).checked=r[key];
}
function beginTextDraft(newLayer=false){
  if(!textEditable())return false;const p=current(),layer=newLayer?null:selectedTextLayer();if(!layer&&textLayersOf(p).length>=8)return false;
  if(!textDraftCurrent()||newLayer)textDraft={photo:p,blob:p.blob,sourceRevision:sourceRevisionOf(p),revision:p.revision,key:JSON.stringify(p.settings),id:layer?.id||`text-${crypto.randomUUID()}`};
  return true;
}
function cancelTextPlacement(){textPlacing=false;if(pointer?.kind==='text-position'){try{viewport.releasePointerCapture(pointer.id);}catch{}pointer=null;}$('viewport').classList.remove('text-place-mode');}
function updateTextControls(){
  if(!$('textSection'))return;if(textRasterCache&&(textRasterCache.blob!==current()?.blob||!textLayersOf().length||!textReady()))textRasterCache=null;if(textDraft&&!textDraftCurrent()){textDraft=null;cancelTextPlacement();toast('照片或其他调整已改变，尚未应用的文字输入已取消；已应用文字保留。');}
  const p=current(),layers=textLayersOf(p),layer=selectedTextLayer(),available=textEditable();
  if(layer&&p)p.textLayerId=layer.id;
  const list=$('textLayerList'),signature=JSON.stringify([p?.id,p?.textLayerId,layers,textDraft?.id||null]);
  if(list.dataset.signature!==signature){list.dataset.signature=signature;list.textContent='';for(const l of layers){const o=document.createElement('option');o.value=l.id;o.textContent=`${l.enabled?'●':'○'} ${Array.from(l.recipe.text.replace(/\n/g,' ')).slice(0,24).join('')||'空文字'}`;list.append(o);}if(textDraft&&!layers.some(l=>l.id===textDraft.id)){const o=document.createElement('option');o.value=textDraft.id;o.textContent='新文字 · 尚未应用';list.append(o);}list.value=textDraft?.id||layer?.id||'';}
  if(!textDraft&&textReady())setTextForm(layer?.recipe||window.MintTextOverlay.defaults(),layer?.enabled??true);
  list.disabled=!available||!!textDraft||!layers.length;$('addTextLayer').disabled=!available||layers.length>=8;
  for(const id of textFieldIds)$(id).disabled=!available||(!layer&&!textDraft);
  const index=layers.findIndex(l=>l.id===layer?.id);$('removeTextLayer').disabled=!available||!layer||!!textDraft;
  $('textLayerUp').disabled=!available||!!textDraft||index<0||index>=layers.length-1;$('textLayerDown').disabled=!available||!!textDraft||index<=0;
  $('cancelText').disabled=!textDraft&&!textPlacing;$('applyText').disabled=!available||!textDraft;$('placeText').disabled=!available||(!layer&&!textDraft);
  $('textBasisMode').value=exportMode();$('textBasisMode').disabled=!photoAvailable()||!!backendJob||!!cropDraft;
  let note=!p?'导入照片后可用。':!textReady()?'文字组件未就绪，不会跳过已存文字。':sourceViewActive()?'原图坐标工具中暂不显示文字；返回平移后可编辑。':textDraft?'尚未应用：保存、恢复草稿与导出不包含当前输入。':layers.length?`${layers.length}/8 个可编辑文字层 · 从下到上合成 · 原图未修改。`:'默认不添加文字。点击“新增文字”开始。';
  if(textPlacing)note='请在画布点选文字中心，松开确认位置输入；Esc或取消退出，最后点击应用。';
  $('textStatus').textContent=note;
  try{const d=p?exportDimensions(p,exportMode()):null;$('textBasisNote').textContent=d?`当前排字基准：${exportMode()==='original'?'原尺寸':'工作尺寸'} ${d.width} × ${d.height} px。预览缩小这份最终栅格，不按缩略图重新换行。${d.width*d.height>16000000?' 此尺寸超过文字1600万像素上限，请明确选择工作尺寸或缩小构图。':''}`:'';}catch(e){$('textBasisNote').textContent=String(e.message||e);}
}
function editTextInput(){if(!beginTextDraft())return;updateTextControls();}
function applyTextDraft(){
  if(!textEditable()||!textDraftCurrent())return;
  try{const p=current(),recipe=textRecipeFromForm(),layer={id:textDraft.id,enabled:$('textEnabled').checked,recipe},layers=clone(textLayersOf(p)),index=layers.findIndex(l=>l.id===layer.id);if(index>=0)layers[index]=layer;else layers.push(layer);
    const validated=window.MintTextLayers.validate(layers),candidate={...p.settings,textLayers:validated};if(textActive(candidate)){const d=exportDimensions({...p,settings:candidate},exportMode());if(d.width*d.height>16000000||Math.max(d.width,d.height)>16384)throw new Error('文字画布超过1600万像素/16384边长，请先选择工作尺寸或缩小构图');}
    p.textLayerId=layer.id;textDraft=null;cancelTextPlacement();changeSettings({textLayers:clone(validated)});status('文字已应用 · 可重新编辑/撤销 · 字体取自本机');
  }catch(e){toast(`文字未应用：${e.message||e}`,true);}
}
$('addTextLayer').addEventListener('click',()=>{if(!beginTextDraft(true))return;setTextForm(window.MintTextOverlay.defaults());updateTextControls();$('textContent').focus();});
for(const id of textFieldIds)for(const event of ['input','change'])$(id).addEventListener(event,editTextInput);
$('textLayerList').addEventListener('change',()=>{if(!textEditable()||textDraft)return;current().textLayerId=$('textLayerList').value;updateTextControls();});
$('applyText').addEventListener('click',applyTextDraft);
$('cancelText').addEventListener('click',()=>{textDraft=null;cancelTextPlacement();updateTextControls();});
$('removeTextLayer').addEventListener('click',()=>{const layer=selectedTextLayer();if(!textEditable()||textDraft||!layer)return;changeSettings({textLayers:textLayersOf().filter(l=>l.id!==layer.id)});});
for(const [id,delta]of[['textLayerUp',1],['textLayerDown',-1]])$(id).addEventListener('click',()=>{if(!textEditable()||textDraft)return;const layers=clone(textLayersOf()),index=layers.findIndex(l=>l.id===selectedTextLayer()?.id),target=index+delta;if(index<0||target<0||target>=layers.length)return;[layers[index],layers[target]]=[layers[target],layers[index]];changeSettings({textLayers:layers});});
$('placeText').addEventListener('click',()=>{if(!textEditable()||!beginTextDraft())return;setTool('pan');setCompare(false);referenceRequested=false;textPlacing=true;$('viewport').classList.add('text-place-mode');updateTextControls();updateReferenceComparison();});
$('textBasisMode').addEventListener('change',()=>{if(!photoAvailable())return;$('exportMode').value=$('textBasisMode').value==='working'?'working':'original';finalOutputBasisChanged();});

function updateControls() {
  const p = current(), settings = p?.settings || defaults();
  for (const [key,,min,max] of controls) {
    const input = $(`control-${key}`); const shape=settings.faceAdjustments && peopleShapeKeys.includes(key); input.min=shape && ['nose','jaw'].includes(key)?-50:min; input.max=shape?(['slim','eyes'].includes(key)?60:50):max; input.value = peopleSliderValue(key,settings) ?? 0;
    const value = Number(input.value); $(`value-${key}`).textContent = key === 'exposure' ? `${value > 0 ? '+' : ''}${(value / 50).toFixed(2)}` : `${value > 0 ? '+' : ''}${value}`;
    rangeStyle(input);
  }
  $('facePalette').value = peopleSliderValue('palette',settings) || 'natural';
  const mode = settings.bgMode || 'original';
  document.querySelectorAll('[data-bg]').forEach(button => button.classList.toggle('active', button.dataset.bg === mode));
  const extra = $('backgroundExtra');
  if (extra.dataset.mode !== mode) {
    extra.dataset.mode = mode;
    extra.innerHTML = (mode === 'color' ? '<label class="color-row" for="backgroundColor">背景颜色 <span class="color-value" id="colorValue"></span><input type="color" id="backgroundColor" data-setting="bgColor"></label>' : '') + (mode === 'blur' ? rangeMarkup('bgBlur', '虚化强度', 0, 50) : '') + (mode !== 'original' ? rangeMarkup('bgFeather', '边缘羽化', 0, 20) : '');
  }
  for (const key of ['bgBlur', 'bgFeather']) {
    const input = $(`control-${key}`); if (!input) continue;
    input.value = settings[key]; $(`value-${key}`).textContent = settings[key]; rangeStyle(input);
  }
  if ($('backgroundColor')) { $('backgroundColor').value = settings.bgColor; $('colorValue').textContent = settings.bgColor.toUpperCase(); }
  $('backgroundNote').textContent = ({ original: '保留原始背景，不修改人物边缘。', blur: '使用本地人物分割。发丝与复杂边缘可能需要保留原背景。', color: '替换人物以外的区域；纯色背景会输出为不透明图像。', transparent: '导出 PNG 保留透明背景；JPG 会将透明区域填充为白色。' })[mode];
  $('spotCount').textContent = `(${settings.spots?.length || 0})`;
  document.querySelectorAll('.preset').forEach(button => button.classList.toggle('active', p?.preset === button.dataset.preset));
  updateLocalControls(); updateAvailability();
}
function updateAvailability() {
  updateReferenceComparison(); updatePeopleControls();
  const available = photoAvailable(), p = current(), face = available && hasFaces() && !analyzingPhoto, mask = available && hasMask() && !analyzingPhoto;
  if (tool === 'brush' && p?.settings.manualLiquify?.length) setTool('pan');
  for (const [key, , , , , capability] of controls) {
    const enabled = p?.settings.manualLiquify?.length && ['slim','eyes','nose','jaw'].includes(key) ? false : capability === 'face-color' ? face && faceColorReady() : capability === 'face' ? face : available;
    $(`control-${key}`).disabled = !enabled; $(`control-${key}`).closest('.control').classList.toggle('disabled', !enabled);
  }
  $('facePalette').disabled = !face || !faceColorReady();
  $('faceColorStatus').textContent = !faceColorReady() ? '局部色彩核心不可用，已停用控制，不会伪装可用效果。' : !hasFaces() ? '等待检测到人脸后可用；默认强度为0，不自动改变肤色或脸型。' : '普通局部色彩修饰，不是学习型精修。建议从低强度开始，检查眼下、唇边与面颊。';
  document.querySelectorAll('[data-bg]').forEach(button => { button.disabled = !available || (button.dataset.bg !== 'original' && (!mask || !!p?.settings.manualLiquify?.length)); });
  for (const key of ['bgBlur', 'bgFeather']) if ($(`control-${key}`)) $(`control-${key}`).disabled = !mask;
  if ($('backgroundColor')) $('backgroundColor').disabled = !mask;
  document.querySelectorAll('.preset').forEach(button => { button.disabled = !available; });
  for (const id of ['importBtn','welcomeImport','stripImport','fileInput']) $(id).disabled = importing || exportRunning || openingDialog || loadingDemo || !!projectOperation || !!presetOperation || !!imagePanel?.importing;
  for (const id of ['fitBtn','zoomOut','zoomIn','zoomLabel','compareView','brushTool','healBtn','resetBtn']) $(id).disabled = !available;
  for (const id of ['brushTool','healBtn']) { $(id).disabled = !available || !!p?.settings.manualLiquify?.length; $(id).title = p?.settings.manualLiquify?.length ? '已有手动推拉，请使用手动修复/克隆；旧点修与历史保留' : '旧版单点柔化 · 完整原图坐标'; }
  $('undoBtn').disabled = !available || !p?.undo.length;
  $('redoBtn').disabled = !available || !p?.redo.length;
  $('clearSpots').disabled = !available || !p?.settings.spots?.length;
  $('exportBtn').disabled = !photos.length || locked() || analyzingPhoto || !!backendJob;
  $('copyBtn').disabled = !available || photos.length < 2;
  $('removeBtn').disabled = !selected().length || locked();
  $('selectAll').disabled = !photos.length || locked();
  $('selectAll').checked = !!photos.length && selected().length === photos.length;
  $('selectAll').indeterminate = selected().length > 0 && selected().length < photos.length;
  document.querySelectorAll('.photo-select').forEach(box => { box.disabled = locked(); });
  $('queueCount').textContent = `${photos.length} 张照片${selected().length ? ` · 已选 ${selected().length}` : ''}`;
  $('photoCount').textContent = photos.length;
  $('filmstripEmpty').hidden = photos.length > 0;
  updateBackendControls(); updateLocalControls(); updateManualControls(); updateRedactionControls(); updatePaintControls(); updateLightBalanceControls(); updateLevelsControls(); updateAdvancedToneControls(); updateSharpnessControls(); updateFramingControls(); updateStraightenControls(); updatePerspectiveControls(); updatePaddingControls(); updateTextControls(); imagePanel?.update();
  if($('imageLayerBasisMode')){ $('imageLayerBasisMode').value=exportMode(); $('imageLayerBasisMode').disabled=locked(); }
  const projectDirty = hasUnsavedProjectChanges(), projectReady = !locked() && !analyzingPhoto && !renderingPhoto && !backendJob;
  $('saveProjectBtn').disabled = !bridge?.saveProject || !window.MintProjectDocument || !projectReady || (!photos.length && savedProjectFingerprint === null && !recoveredProjectUnsaved);
  $('openProjectBtn').disabled = !bridge?.openProject || !window.MintProjectDocument || !projectReady;
  $('projectStatus').textContent = projectOperation ? (projectOperation === 'save' ? '正在保存项目…' : '正在验证项目…') : projectDirty ? '项目有未保存的更改' : projectDisplayName ? `已保存：${projectDisplayName}` : '尚未保存项目';
  $('projectStatus').title = projectDisplayName;
  $('projectStatus').classList.toggle('unsaved', projectDirty);
  $('sessionTitle').textContent = projectDisplayName ? `${projectDirty ? '● ' : ''}${projectDisplayName}` : photos.length ? `未保存项目 / ${photos.length} 张照片` : '人像修图工作台';
  updateNativeDirty(); updateNamedPresetControls(); updateReviewControls(); recoveryController?.observe();
}
function updateFaceStatus() {
  $('faceDot').className = 'face-dot';
  let title = '等待导入人像', detail = '人脸与人物分割均在本地运行';
  if (current()) {
    if (loadingPhoto) title = '正在读取照片';
    else if (modelState === 'error') { title = '人像模型不可用'; detail = '仍可使用调色与手动点修'; $('faceDot').classList.add('error'); }
    else if (modelState === 'loading') { title = '正在加载人像模型'; detail = '可先调色，模型就绪后自动分析'; }
    else if (analyzingPhoto) { title = '正在检测人脸与人物'; detail = '基于本地模型，不上传照片'; }
    else if (analysis) {
      title = analysis.faceCount ? `检测到 ${analysis.faceCount} 张人脸` : '未检测到可用人脸';
      detail = analysis.mask ? '人物分割可用 · 可调整背景' : '未得到人物蒙版 · 保留原背景';
      $('faceDot').classList.add(analysis.faceCount ? 'ready' : 'error');
    } else { title = '人像分析暂不可用'; detail = '仍可使用调色与手动点修'; $('faceDot').classList.add('error'); }
  }
  $('faceStatusTitle').textContent = title; $('faceStatusDetail').textContent = detail;
}
function outputDimensions(w, h) { const ratio = Math.min(1, 4096 / Math.max(w, h), Math.sqrt(16000000 / (w * h))); const width = Math.max(1, Math.round(w * ratio)), height = Math.max(1, Math.min(Math.round(h * ratio), Math.floor(16000000 / width))); return { width, height, scaled: width !== w || height !== h }; }
async function analyzeCurrent(token = viewToken) {
  if (!source || modelState !== 'ready' || token !== viewToken || exportRunning || projectOperation || presetOperation) return;
  const input = source;
  analyzingPhoto = true; updateBusy(); updateFaceStatus(); updateAvailability();
  analysisQueue = analysisQueue.catch(() => {}).then(async () => {
    if (token !== viewToken || exportRunning) return;
    try {
      const result = await Pipeline.analyze(input);
      if (token !== viewToken || input !== source) return;
      analysis = result;
    } catch (error) {
      if (token !== viewToken) return;
      analysis = null; toast(`这张照片的人像分析失败：${error.message || error}。调色和点修仍可使用。`, true);
    } finally {
      if (token === viewToken) { analyzingPhoto = false; updateFaceStatus(); updateControls(); updateBusy(); scheduleRender(0); }
    }
  });
  return analysisQueue;
}
async function activatePhoto(id) {
  if (tool === 'white-balance') setTool('pan');
  cancelCropDraft();
  if (exportRunning || importing || projectOperation || presetOperation || (id === currentId && source)) return;
  if (current()) historyCommit(current());
  const p = photos.find(item => item.id === id); if (!p) return;
  finishManualStroke(false); finishMatteStroke(false); cancelBackendJob('切换照片'); activeCorrectedMatte = null; activeMatteInspection = null; activeMattePreview = null; activeDiagnosticOverlay = null; $('learnedFaceBoxes').checked = false;
  cancelReferenceGesture(); acceptedRender = null; renderPending = true; renderFailure = ''; clearPreviewPixelInspector();
  const token = ++viewToken; renderVersion++; renderController?.abort(); clearTimeout(renderTimer);
  clearToneHistogram('正在切换照片，等待新的处理预览。');
  currentId = id; source = null; analysis = null; rendered = null; requestedDisplayMode = null; renderedDisplayStamp = null; framedOriginalCache = null; manualViewReady = false; manualOverlayCache = null; renderedManualMode = false; manualViewStamp = null; repairSample = null; originalHeld = false;
  loadingPhoto = true; analyzingPhoto = false; renderingPhoto = false;
  $('imageSurface').hidden = true; $('welcome').hidden = true; $('viewport').classList.add('has-image');
  $('activeFileName').textContent = p.name; $('activeFileName').title = p.name; $('originalBadge').hidden = true;
  updateCards(); updateControls(); updateFaceStatus(); updateBusy();
  try {
    const result = await Pipeline.decodeImage(p.blob, 1280);
    if (token !== viewToken) return;
    source = result.canvas; p.originalWidth = result.originalWidth; p.originalHeight = result.originalHeight;
    p.output = outputDimensions(result.originalWidth, result.originalHeight);
    $('imageDimensions').textContent = `${p.originalWidth} × ${p.originalHeight} px`;
    $('reductionNotice').textContent = p.output.scaled ? `原图 ${p.originalWidth} × ${p.originalHeight} · 可选工作尺寸 ${p.output.width} × ${p.output.height}` : '导出默认原尺寸';
    $('imageSurface').hidden = false; loadingPhoto = false;
    drawPreview(); fit(); updateControls(); updateFaceStatus(); updateBusy();
    status('照片已载入 · 预览最长边 1280，导出重新计算');
    if (modelState === 'ready') analyzeCurrent(token); else scheduleRender(0);
  } catch (error) {
    if (token !== viewToken) return;
    loadingPhoto = false; renderPending = false; renderFailure = String(error.message || error); updateBusy(); updateAvailability(); updateFaceStatus();
    toast(`无法打开 ${p.name}：${error.message || error}`, true); status('读取失败，可移除该照片后重新导入');
  }
}
// Review metadata is deliberately separate from the pixel recipe and history.
// Query changes presentation only: import order and hidden selections survive.
function queryPhotoReview() {
  if (reviewCore) return reviewCore.query(photos.map(p => ({ id: p.id, name: p.name, review: reviewOf(p), selected: p.selected })), reviewView);
  // A missing optional review script must not break legacy pixel-only workflows.
  // Existing review metadata is never acted on without the real validator.
  const ids = photos.map(p => p.id), selection = selected().map(p => p.id);
  return { orderedIds: ids, visibleIds: ids.slice(), selectedIds: selection, visibleSelectedIds: selection.slice(), hiddenSelectedIds: [], rejectedSelectedIds: [], counts: { total: ids.length, visible: ids.length, hidden: 0, selected: selection.length, visibleSelected: selection.length, hiddenSelected: 0, rejected: 0, rejectedSelected: 0 } };
}
function reviewTargets(scope = $('reviewScope')?.value || 'current') { return scope === 'selected' ? selected() : scope === 'current' && current() ? [current()] : []; }
function reviewBusy() { return locked() || !!pointer || !!manualDraft || !!matteDraft || !!cropDraft || !!backendJob; }
function reviewText(value) {
  return `${value.rating ? '★'.repeat(value.rating) : '未评级'} · ${({none:'未标记',pick:'精选',reject:'拒绝'})[value.flag]} · ${({none:'无色',red:'红',yellow:'黄',green:'绿',blue:'蓝',purple:'紫'})[value.label]}`;
}
function initialReviewOnly(state) {
  // Recognize only our exact neutral initialization when the optional UI core is
  // absent. This is not a replacement validator/editor and accepts no history.
  const fields = (value, keys) => {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const own = Reflect.ownKeys(value); if (own.length !== keys.length || keys.some(key => !own.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return keys.every(key => descriptors[key].enumerable && Object.prototype.hasOwnProperty.call(descriptors[key], 'value')) ? descriptors : null;
  };
  const empty = value => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).length === 1 && Object.getOwnPropertyDescriptor(value, 'length')?.value === 0;
  try { const s = fields(state, ['version','current','undo','redo']); if (!s) return false; const c = fields(s.current.value, ['rating','flag','label']); return !!c && s.version.value === 1 && c.rating.value === 0 && c.flag.value === 'none' && c.label.value === 'none' && empty(s.undo.value) && empty(s.redo.value); }
  catch { return false; }
}
function batchScopeCounts(targets, query) {
  if (!reviewCore && photos.some(p => p.review !== undefined && !initialReviewOnly(p.review))) throw new Error('选片组件不可用，无法安全核对隐藏或拒绝照片');
  const visible = new Set((query || queryPhotoReview()).visibleIds);
  return { total: targets.length, hidden: targets.filter(p => !visible.has(p.id)).length, rejected: targets.filter(p => reviewOf(p).current.flag === 'reject').length };
}
function batchScopeText(targets, query) {
  const c = batchScopeCounts(targets, query);
  return `${c.total} 张 · 筛选隐藏 ${c.hidden} 张 · 已标拒绝 ${c.rejected} 张（可能重叠）`;
}
function freezeBatchScope(targets) {
  if (!targets.length || targets.length > MAX_FILES || new Set(targets).size !== targets.length || targets.some(p => !photos.includes(p))) throw new Error('操作范围已失效');
  const counts = batchScopeCounts(targets);
  return { targets: targets.slice(), counts, currentId, view: JSON.stringify(reviewView), session: photos.map(p => ({ p, id: p.id, selected: p.selected, review: JSON.stringify(reviewOf(p)), revision: p.revision, sourceRevision: sourceRevisionOf(p), blob: p.blob, settings: JSON.stringify(p.settings) })) };
}
function batchScopeLive(frozen, checkSettings = false) {
  return !!frozen && frozen.currentId === currentId && frozen.view === JSON.stringify(reviewView) && photos.length === frozen.session.length && frozen.session.every((f, i) => photos[i] === f.p && f.p.id === f.id && f.p.selected === f.selected && f.p.revision === f.revision && JSON.stringify(reviewOf(f.p)) === f.review && sourceRevisionOf(f.p) === f.sourceRevision && f.p.blob === f.blob && (!checkSettings || JSON.stringify(f.p.settings) === f.settings));
}
function assertBatchScope(frozen, checkSettings = false) { if (!batchScopeLive(frozen, checkSettings)) throw new Error('照片范围、选中项、评级或编辑状态已改变，操作已停止；请重新检查范围'); }
function approveBatchScope(targets, action, confirmRisk = true) {
  try {
    const frozen = freezeBatchScope(targets), c = frozen.counts;
    if (confirmRisk && (c.hidden || c.rejected)) {
      if (typeof window.confirm !== 'function') throw new Error('确认窗口不可用，未执行操作');
      const accepted = window.confirm(`${action}：共 ${c.total} 张。\n其中筛选隐藏 ${c.hidden} 张，已标拒绝 ${c.rejected} 张（两者可能重叠）。\n筛选不会取消选中，也不会从“全部”范围中排除照片。\n${action === '移除工作区引用' ? '仅移除本项目中的照片引用，不删除磁盘原图。\n' : ''}仍按此完整范围继续吗？`);
      if (accepted !== true) { status(`${action}已取消 · 所有照片保持不变`); return null; }
    }
    assertBatchScope(frozen, true); return frozen;
  } catch (error) { toast(`${action}未执行：${error.message || error}`, true); return null; }
}
function preflightBatchRevisions(targets) {
  if (targets.some(p => !Number.isSafeInteger(p.revision) || p.revision < 0 || p.revision === Number.MAX_SAFE_INTEGER)) throw new Error('照片编辑版本已达安全上限，未修改任何照片');
}
function applyPhotoReview(patch, history = '', scope = $('reviewScope')?.value || 'current') {
  if (!reviewCore || reviewBusy()) return;
  const targets = reviewTargets(scope); if (!targets.length) return;
  try {
    preflightBatchRevisions(targets);
    const staged = targets.map(p => ({ p, review: history ? reviewCore[history](reviewOf(p)) : reviewCore.edit(reviewOf(p), patch) }));
    const frozen = approveBatchScope(targets, history === 'undo' ? '撤销选片标记' : history === 'redo' ? '重做选片标记' : '更新选片标记', scope === 'selected');
    if (!frozen) return;
    assertBatchScope(frozen);
    const changed = staged.filter(item => JSON.stringify(item.review) !== JSON.stringify(reviewOf(item.p)));
    // Complete candidate validation/allocation before any per-photo commit.
    for (const item of changed) { item.p.review = item.review; item.p.revision++; }
    updateCards(); status(`已${history === 'undo' ? '撤销' : history === 'redo' ? '重做' : '更新'} ${changed.length} 张选片标记 · 像素与原图未改变`);
  } catch (error) { toast(`选片标记未修改：${error.message || error}`, true); }
}
function setReviewView(patch) {
  if (!reviewCore || locked()) return;
  try { reviewView = reviewCore.validateView({ ...reviewView, ...patch }); updateCards(); }
  catch (error) { toast(`筛选未改变：${error.message || error}`, true); updateReviewControls(); }
}
function navigateReview(direction) {
  if (reviewBusy()) return;
  try { const ids = queryPhotoReview().visibleIds; if (!ids.length) return; const at = ids.indexOf(currentId); const next = at < 0 ? (direction > 0 ? 0 : ids.length - 1) : at + direction; if (next >= 0 && next < ids.length) activatePhoto(ids[next]); }
  catch (error) { toast(`无法切换照片：${error.message || error}`, true); }
}
function selectVisiblePhotos() {
  if (!reviewCore || locked()) return;
  try { const visible = new Set(queryPhotoReview().visibleIds); for (const p of photos) p.selected = visible.has(p.id); updateCards(); status(`已用可见 ${visible.size} 张替换选择 · 隐藏照片已取消选择`); }
  catch (error) { toast(`选择未改变：${error.message || error}`, true); }
}
function updateReviewControls() {
  if (!$('photoReview')) return;
  let query, error = '';
  try { query = queryPhotoReview(); } catch (e) { error = e.message || String(e); }
  const ready = !!reviewCore && !!query, disabled = !ready || reviewBusy(), targets = ready ? reviewTargets() : [], value = ready && current() ? reviewOf(current()).current : reviewDefaults().current;
  if ($('reviewScope')) $('reviewScope').disabled = disabled || !photos.length;
  for (const id of ['reviewRating','reviewFlag','reviewLabel']) if ($(id)) $(id).disabled = disabled || !targets.length;
  for (const [id, field] of [['reviewRating','rating'],['reviewFlag','flag'],['reviewLabel','label']]) if ($(id)) {
    const values = targets.map(p => reviewOf(p).current[field]);
    $(id).value = values.length && values.every(v => v === values[0]) ? String(values[0]) : 'mixed';
  }
  if ($('reviewUndo')) $('reviewUndo').disabled = disabled || !targets.some(p => reviewOf(p).undo.length);
  if ($('reviewRedo')) $('reviewRedo').disabled = disabled || !targets.some(p => reviewOf(p).redo.length);
  for (const [id, field] of [['reviewMin','minRating'],['reviewMax','maxRating'],['reviewFilterFlag','flag'],['reviewFilterLabel','label'],['reviewSort','sort']]) if ($(id)) { $(id).value = String(reviewView[field]); $(id).disabled = !ready || locked(); }
  if ($('reviewHideRejected')) { $('reviewHideRejected').checked = reviewView.hideRejected; $('reviewHideRejected').disabled = !ready || locked(); }
  for (const id of ['resetReviewFilters','selectVisible']) if ($(id)) $(id).disabled = !ready || locked() || !photos.length;
  const ids = query?.visibleIds || [], at = ids.indexOf(currentId);
  if ($('reviewPrevious')) $('reviewPrevious').disabled = disabled || !ids.length || at === 0;
  if ($('reviewNext')) $('reviewNext').disabled = disabled || !ids.length || at === ids.length - 1;
  if ($('reviewCurrent')) $('reviewCurrent').textContent = !ready ? `选片功能不可用${error ? `：${error}` : ''}` : current() ? `当前：${reviewText(value)}` : '导入照片后可评级与标记';
  const hiddenCurrent = !!current() && !!query && !ids.includes(currentId);
  if ($('reviewHiddenCurrent')) { $('reviewHiddenCurrent').hidden = !hiddenCurrent; $('reviewHiddenCurrent').textContent = '当前预览被筛选隐藏；预览仍保留，上/下一张只浏览可见照片。'; }
  if ($('reviewCounts')) $('reviewCounts').textContent = query ? `可见 ${query.counts.visible}/${query.counts.total} · 全局已选 ${query.counts.selected} · 隐藏已选 ${query.counts.hiddenSelected} · 拒绝已选 ${query.counts.rejectedSelected}` : '无法安全核对选片范围';
  if ($('reviewScopeNotice')) $('reviewScopeNotice').textContent = scopeReviewNotice(targets, query);
  if ($('filmstripFilteredEmpty')) { $('filmstripFilteredEmpty').hidden = !photos.length || ids.length > 0; $('filmstripFilteredEmpty').textContent = ready ? '筛选无结果。原图与选中项均保留；可清除筛选。' : '选片数据不可用，未自动显示不完整结果。'; }
  const visible = new Set(ids), order = new Map((query?.orderedIds || []).map((id, i) => [id, i]));
  for (const p of photos) {
    const card = document.querySelector(`[data-photo-id="${p.id}"]`); if (!card) continue;
    card.hidden = !visible.has(p.id); card.style.order = String(order.get(p.id) ?? 0);
    const badge = card.querySelector('.photo-review-badge'); if (!badge) continue;
    if (!ready) { badge.textContent = '选片不可用'; continue; }
    const r = reviewOf(p).current; badge.textContent = `${r.rating ? `${r.rating}★` : '·'} ${r.flag === 'pick' ? '精选' : r.flag === 'reject' ? '拒绝' : ''}`.trim(); badge.dataset.label = r.label;
    badge.title = reviewText(r); card.setAttribute('aria-label', `编辑 ${p.name}；${reviewText(r)}`);
    card.classList.toggle('photo-rejected', r.flag === 'reject');
  }
}
function scopeReviewNotice(targets, query) {
  try { return `${$('reviewScope')?.value === 'selected' ? '标记全局选中' : '标记当前'}：${batchScopeText(targets, query)}。仅修改项目中的选片元数据。`; }
  catch { return '无法核对操作范围，批量操作已停用。'; }
}
function updateCards() {
  for (const p of photos) {
    const card = document.querySelector(`[data-photo-id="${p.id}"]`); if (!card) continue;
    card.classList.toggle('current', currentId === p.id); card.setAttribute('aria-current', String(currentId === p.id));
    card.querySelector('input').checked = p.selected; card.querySelector('.photo-edited').hidden = !isDirty(p);
  }
  updateAvailability();
}
function createPhotoCard(p) {
  const card = document.createElement('div'); card.className = 'photo-card'; card.dataset.photoId = p.id; card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `编辑 ${p.name}`); card.title = p.name;
  const image = document.createElement('img'); image.src = p.thumb; image.alt = ''; image.draggable = false;
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'photo-select'; checkbox.checked = p.selected; checkbox.setAttribute('aria-label', `选择 ${p.name}`);
  checkbox.addEventListener('click', event => event.stopPropagation());
  checkbox.addEventListener('change', () => { if (locked()) { checkbox.checked = p.selected; return; } p.selected = checkbox.checked; updateAvailability(); });
  const name = document.createElement('span'); name.className = 'photo-name'; name.textContent = p.name;
  const edited = document.createElement('span'); edited.className = 'photo-edited'; edited.hidden = true;
  const reviewBadge = document.createElement('span'); reviewBadge.className = 'photo-review-badge';
  card.append(image, checkbox, name, edited, reviewBadge);
  card.addEventListener('click', () => { if (!locked()) activatePhoto(p.id); });
  card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === card) { event.preventDefault(); if (!locked()) activatePhoto(p.id); } });
  return card;
}
function appendPhotoCard(p) { $('filmstrip').append(createPhotoCard(p)); }
async function makeThumb(canvas) {
  const thumb = document.createElement('canvas'); const ratio = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
  thumb.width = Math.round(canvas.width * ratio); thumb.height = Math.round(canvas.height * ratio); thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return new Promise((resolve, reject) => thumb.toBlob(blob => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('无法生成缩略图')), 'image/jpeg', .8));
}
function projectReady() {
  if (locked() || analyzingPhoto || renderingPhoto || backendJob) {
    toast('请等待当前读取、分析或导出完成后再保存或打开项目。'); return false;
  }
  if (!window.MintProjectDocument) { toast('项目读写组件不可用，当前会话未改变。', true); return false; }
  return true;
}
function sourceMime(p) {
  if (/^image\/(jpeg|png|webp)$/.test(p.blob.type)) return p.blob.type;
  return /\.png$/i.test(p.name) ? 'image/png' : /\.webp$/i.test(p.name) ? 'image/webp' : 'image/jpeg';
}
function recoveryBinaryBytes(value) {
  if (!value || typeof value !== 'object') return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return Object.values(value).reduce((total, item) => total + recoveryBinaryBytes(item), 0);
}
async function projectSnapshot({ signal, assertCurrent = () => {}, budgetBytes = Infinity } = {}) {
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('项目快照已取消'), { name: 'AbortError' }); assertCurrent(); };
  check();
  // Preflight without copying source/cache data. The real encoded size is checked
  // again later because headers, recipes and histories consume capacity too.
  const list = photos.slice();
  const lowerBound = list.reduce((total, p) => total + p.blob.size + (p.imageAssets||[]).reduce((n,a)=>n+a.width*a.height*4,0) + Array.from(p.learnedCache?.values() || []).reduce((n, entry) => n + recoveryBinaryBytes(entry), 0), 0);
  if (lowerBound > budgetBytes) throw new Error('原图与缓存已超过每代恢复容量；未分配大型快照，原有草稿未覆盖。');
  // Everything mutable is cloned synchronously BEFORE the first Blob await.
  // Blob references are immutable and stay paired with these exact identities.
  const snapshot = { version: window.MintProjectDocument.VERSION || 17, currentId, photos: [] };
  const frozen = list.map(p => {
    const blob = p.blob;
    const item = {
      id: p.id, name: p.name, sourceRevision: sourceRevisionOf(p),
      source: { mime: sourceMime(p), width: p.originalWidth, height: p.originalHeight },
      selected: p.selected, review: clone(reviewOf(p)), settings: clone(p.settings), committed: clone(p.committed),
      undo: clone(p.undo), redo: clone(p.redo), revision: p.revision, preset: p.preset || null,
      learnedCache: clone(Array.from(p.learnedCache?.values() || [])), imageAssets: imageAssetTable(p)
    };
    if (p.latestMatteId) item.latestMatteId = p.latestMatteId;
    if (p.lastSelectedMatteId) item.lastSelectedMatteId = p.lastSelectedMatteId;
    if (p.exportedSettings) item.exportedSettings = JSON.parse(p.exportedSettings);
    return { blob, item };
  });
  for (const { blob, item } of frozen) {
    check(); const bytes = await blob.arrayBuffer(); check();
    item.source.bytes = new Uint8Array(bytes); snapshot.photos.push(item);
  }
  check(); return snapshot;
}
function finishProjectOperation() {
  projectOperation = ''; updateAvailability(); updateBusy();
  if (source && manualToolActive()) setTool(tool);
  if (source) {
    if (modelState === 'ready' && !analysis) analyzeCurrent(); else scheduleRender(0);
  }
}
async function saveProject() {
  if(tool==='white-balance')setTool('pan');
  cancelCropDraft();
  if (!bridge?.saveProject) { toast('项目存档请使用桌面版；照片导出不是项目存档。', true); return; }
  if (!projectReady() || (!photos.length && savedProjectFingerprint === null && !recoveredProjectUnsaved)) return;
  finishManualStroke(false); finishMatteStroke(false); pointer = null; historyCommit(current());
  cancelReferenceGesture();
  projectOperation = 'save'; clearTimeout(renderTimer); renderController?.abort(); renderVersion++;
  updateAvailability(); updateBusy();
  const fingerprint = projectFingerprint();
  try {
    const snapshot = await projectSnapshot();
    const bytes = await window.MintProjectDocument.encode(snapshot);
    const suggestedName = projectDisplayName || `${(photos[0]?.name || '薄荷项目').replace(/\.[^.]+$/, '')}.mintproj`;
    const result = await bridge.saveProject({ bytes, suggestedName });
    if (!result || result.canceled) { status('已取消保存项目 · 当前会话保留'); return; }
    projectDisplayName = result.displayName || suggestedName;
    // The baseline identifies exactly what was written, not whatever state might
    // exist after asynchronous I/O. Any subsequent change therefore stays dirty.
    savedProjectFingerprint = fingerprint; recoveredProjectUnsaved = false;
    const changed = hasUnsavedProjectChanges();
    status((changed ? '项目已保存，但会话仍有新的未保存更改' : `项目已保存：${projectDisplayName}`) + (paddingDraftCurrent() ? ' · 留白输入尚未应用，未写入项目' : '') + (textDraftCurrent() ? ' · 文字输入尚未应用，未写入项目' : ''));
    toast(result.durabilityWarning ? `项目已写入，但持久化确认有警告：${result.durabilityWarning}` : changed ? '项目已保存；较新的更改尚未保存。' : ((paddingDraftCurrent()||textDraftCurrent()) ? '项目已保存；尚未应用的文字或留白输入未写入，请应用后再次保存。' : '项目已保存，原图、调整与撤销记录可重新打开。'), !!result.durabilityWarning);
  } catch (error) {
    toast(`项目保存失败：${error.message || error}。当前会话保留，请重试。`, true);
    status('项目保存失败 · 未清除未保存状态');
  } finally { finishProjectOperation(); }
}
async function stageProject(snapshot, { assertCurrent = () => {} } = {}) {
  const staged = { photos: [], cards: [], currentId: snapshot.currentId, preview: null };
  try {
    for (const item of snapshot.photos) {
      assertCurrent();
      const blob = new Blob([item.source.bytes], { type: item.source.mime });
      const decoded = await Pipeline.decodeImage(blob, item.id === snapshot.currentId ? 1280 : 320);
      assertCurrent();
      if (decoded.originalWidth !== item.source.width || decoded.originalHeight !== item.source.height) throw new Error(`${item.name}：原图实际尺寸与项目记录不一致`);
      const p = { id: item.id, name: item.name, blob, thumb: await makeThumb(decoded.canvas) };
      // Register each allocated URL immediately, including if later setup fails.
      staged.photos.push(p); assertCurrent();
      Object.assign(p, {
        sourceRevision: item.sourceRevision, originalWidth: item.source.width, originalHeight: item.source.height,
        output: outputDimensions(item.source.width, item.source.height), selected: item.selected,
        review: clone(item.review === undefined ? reviewDefaults() : item.review), settings: clone(item.settings), committed: clone(item.committed), undo: clone(item.undo), redo: clone(item.redo),
        revision: item.revision, preset: item.preset || null, imageAssets: imageAssetTable({imageAssets:item.imageAssets||[]}), learnedCache: new Map(item.learnedCache.map(entry => [entry.id, entry])),
        latestMatteId: item.latestMatteId, lastSelectedMatteId: item.lastSelectedMatteId,
        exportedSettings: item.exportedSettings ? JSON.stringify(item.exportedSettings) : undefined
      });
      staged.cards.push(createPhotoCard(p));
      if (item.id === snapshot.currentId) staged.preview = decoded.canvas;
    }
    if (staged.photos.length && !staged.preview) throw new Error('项目缺少有效的当前照片');
    return staged;
  } catch (error) { discardStagedProject(staged); throw error; }
}
function discardStagedProject(staged) {
  if (!staged) return;
  for (const card of staged.cards) card.remove();
  for (const p of staged.photos) URL.revokeObjectURL(p.thumb);
}
function installStagedProject(staged, displayName, { recovered = false } = {}) {
  // Stage every fallible read before the swap, and retain the prior session and
  // URLs until all view updates succeed. A renderer/DOM failure can roll back too.
  const oldPhotos = photos.slice(), oldCards = Array.from(document.querySelectorAll('.photo-card'));
  const previous = { currentId, source, analysis, rendered, originalHeld, compare, split, zoom, panX, panY, fitMode, tool,
    repairSample, repairMode, manualOverlayCache, manualViewReady, renderedManualMode, manualViewStamp, requestedDisplayMode, renderedDisplayStamp, framedOriginalCache,
    activeCorrectedMatte, activeMatteInspection, activeMattePreview, activeDiagnosticOverlay, projectDisplayName, savedProjectFingerprint, recoveredProjectUnsaved,
    faceBoxes: $('learnedFaceBoxes').checked };
  const showRestoredView = () => {
    const p = current(), visible = !!p && !!source;
    $('welcome').hidden = visible; $('imageSurface').hidden = !visible; $('viewport').classList.toggle('has-image', visible);
    $('activeFileName').textContent = p?.name || '尚未导入照片'; $('activeFileName').title = p?.name || '';
    $('imageDimensions').textContent = p ? `${p.originalWidth} × ${p.originalHeight} px` : '';
    $('reductionNotice').textContent = p?.output?.scaled ? `原图 ${p.originalWidth} × ${p.originalHeight} · 可选工作尺寸 ${p.output.width} × ${p.output.height}` : p ? '导出默认原尺寸' : '';
    if (visible) { drawPreview(); positionSurface(); }
    updateCards(); updateControls(); updateFaceStatus();
  };
  try {
    for (const card of staged.cards) $('filmstrip').append(card);
    finishManualStroke(false); finishMatteStroke(false); pointer = null; clearSessionView();
    photos.splice(0, photos.length, ...staged.photos);
    currentId = staged.currentId; source = staged.preview;
    for (const card of oldCards) card.remove();
    projectDisplayName = recovered ? '' : displayName || '薄荷项目.mintproj';
    $('learnedFaceBoxes').checked = false; setTool('pan');
    if (source) fit(); showRestoredView();
    recoveredProjectUnsaved = recovered; savedProjectFingerprint = recovered ? null : projectFingerprint(); updateAvailability();
  } catch (error) {
    photos.splice(0, photos.length, ...oldPhotos);
    ({ currentId, source, analysis, rendered, originalHeld, compare, split, zoom, panX, panY, fitMode, tool,
      repairSample, repairMode, manualOverlayCache, manualViewReady, renderedManualMode, manualViewStamp, requestedDisplayMode, renderedDisplayStamp, framedOriginalCache,
      activeCorrectedMatte, activeMatteInspection, activeMattePreview, activeDiagnosticOverlay, projectDisplayName, savedProjectFingerprint, recoveredProjectUnsaved } = previous);
    for (const card of staged.cards) card.remove();
    for (const card of oldCards) $('filmstrip').append(card);
    $('learnedFaceBoxes').checked = previous.faceBoxes;
    try { setTool(tool); showRestoredView(); } catch { /* Data and old URLs are retained even if the view itself is unavailable. */ }
    throw error;
  }
  // Only a committed replacement clears the reference. Staging/cancel/rollback do not.
  clearReference();
  for (const old of oldPhotos) URL.revokeObjectURL(old.thumb);
}
async function openProject() {
  if(tool==='white-balance')setTool('pan');
  cancelCropDraft();
  if (!bridge?.openProject) { toast('项目存档请使用桌面版。', true); return; }
  if (!projectReady()) return;
  cancelReferenceGesture();
  projectOperation = 'open'; clearTimeout(renderTimer); renderController?.abort(); renderVersion++;
  updateAvailability(); updateBusy();
  let staged = null, adopted = false;
  try {
    await recoveryController?.suspend();
    const result = await bridge.openProject();
    if (!result || result.canceled) { status('已取消打开项目 · 当前会话保留'); return; }
    const snapshot = await window.MintProjectDocument.decode(result.bytes);
    staged = await stageProject(snapshot);
    if (hasUnsavedProjectChanges()) {
      if (typeof bridge.confirmReplaceProject !== 'function') throw new Error('缺少可信的替换确认，未替换当前会话');
      const confirmed = await bridge.confirmReplaceProject();
      if (confirmed !== true) { status('未替换当前会话 · 原有更改保留'); return; }
    }
    installStagedProject(staged, result.displayName); staged = null; adopted = true;
    status(`项目已打开：${projectDisplayName}`);
    toast('项目已恢复。已验证的学习蒙版可继续使用；新模型任务仍需本地模型可用。');
  } catch (error) {
    toast(`无法打开项目：${error.message || error}。原有会话未替换。`, true);
    status('项目打开失败 · 原有会话保留');
  } finally { discardStagedProject(staged); finishProjectOperation(); recoveryController?.resume({ newSession: adopted }); }
}

function recoveryCaptureReason() {
  if (locked() || analyzingPhoto || renderingPhoto || renderPending || backendJob || modelState === 'loading') return '请等待导入、模型、项目或渲染工作完成。';
  if (pointer || referencePointer || manualDraft || matteDraft || cropDraft || photos.some(p => JSON.stringify(p.settings) !== JSON.stringify(p.committed))) return '请先提交滑杆调整并结束笔画、拖动或裁剪草稿。';
  return '';
}
function recoveryCaptureState() {
  const reason = recoveryCaptureReason();
  if (reason || !photos.length) return { fingerprint: null, empty: !photos.length, safe: !reason, reason };
  const identity = value => { if (!recoveryObjectIds.has(value)) recoveryObjectIds.set(value, ++recoveryObjectSequence); return recoveryObjectIds.get(value); };
  // Cache entries are treated as immutable by the editor. Bind entry and plane
  // identities plus non-binary metadata, not merely public IDs and byte counts.
  // Do not serialize hundreds of megabytes of Float32 values on UI updates.
  const cacheIdentity = value => {
    if (!value || typeof value !== 'object') return value;
    if (ArrayBuffer.isView(value)) return { binary: identity(value), buffer: identity(value.buffer), offset: value.byteOffset, length: value.byteLength };
    if (value instanceof ArrayBuffer) return { binary: identity(value), length: value.byteLength };
    if (Array.isArray(value)) return ['array', identity(value), value.map(cacheIdentity)];
    return ['object', identity(value), Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cacheIdentity(item)]))];
  };
  const fingerprint = projectFingerprint() + JSON.stringify(photos.map(p => [identity(p), identity(p.blob), Array.from(p.learnedCache?.values() || [], entry => [identity(entry), cacheIdentity(entry)])]));
  return { fingerprint, empty: false, safe: true, reason: '' };
}
function assertRecoveryCacheBytes(snapshot) {
  const changed = () => { throw Object.assign(new Error('恢复快照期间缓存字节已改变'), { name: 'AbortError' }); };
  const compareBytes = (saved, live) => {
    if (!saved || typeof saved !== 'object') return;
    if (ArrayBuffer.isView(saved) || saved instanceof ArrayBuffer) {
      if (!live || saved.byteLength !== live.byteLength) changed();
      let a, b;
      try {
        a = ArrayBuffer.isView(saved) ? new Uint8Array(saved.buffer, saved.byteOffset, saved.byteLength) : new Uint8Array(saved);
        b = ArrayBuffer.isView(live) ? new Uint8Array(live.buffer, live.byteOffset, live.byteLength) : live instanceof ArrayBuffer ? new Uint8Array(live) : null;
      } catch { changed(); }
      if (!b || a.length !== b.length) changed();
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed();
      return;
    }
    for (const key of Object.keys(saved)) compareBytes(saved[key], live?.[key]);
  };
  // One byte comparison at the final capture boundary, never on observer/UI
  // updates. This also rejects detached or mutated typed planes during awaits.
  snapshot.photos.forEach((photo, i) => compareBytes(photo.learnedCache, Array.from(photos[i]?.learnedCache?.values() || [])));
}
async function captureRecovery(options) {
  const snapshot = await projectSnapshot(options); options.assertCurrent();
  if (window.MintProjectDocument.encodeParts) {
    const encoded = await window.MintProjectDocument.encodeParts(snapshot); options.assertCurrent(); assertRecoveryCacheBytes(snapshot);
    if (encoded.byteLength > options.budgetBytes) throw new Error('完整恢复草稿超过每代容量（含调整与历史）；原有草稿未覆盖。');
    const bytes = new Uint8Array(encoded.byteLength); let offset = 0;
    for (const part of encoded.parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  }
  const bytes = await window.MintProjectDocument.encode(snapshot); options.assertCurrent(); assertRecoveryCacheBytes(snapshot); return bytes;
}
function recoverySize(bytes) { return Number.isFinite(bytes) ? `${(bytes / 1048576).toFixed(2)} MiB` : '未知'; }
function updateRecoveryControls(state = recoveryController?.getState()) {
  if (!state) { $('recoveryBtn').disabled = true; $('recoverySummary').textContent = '本地恢复仅在桌面版可用'; return; }
  $('recoveryBtn').disabled = false;
  $('recoveryEnabled').checked = state.enabled; $('recoveryBudget').value = String(state.budgetMiB);
  $('recoveryEnabled').disabled = state.configuring || projectOperation === 'recovery';
  $('recoveryBudget').disabled = state.configuring || state.busy || projectOperation === 'recovery';
  $('recoveryLocation').textContent = state.disk?.realRootPath || state.disk?.rootPath || '尚未读取';
  $('recoveryStorage').textContent = `每代上限 ${state.budgetMiB} MiB；两代通常最多 ${state.budgetMiB * 2} MiB。写入时另需一份临时文件；保留的旧大文件可超过新上限。当前两代合计：${recoverySize(state.disk?.totalBytes)}；目录实际占用（含设置与残留临时文件）：${state.disk?.storageComplete ? recoverySize(state.disk.storageBytes) : '未知 / 未完整统计'}。`;
  $('recoveryHold').hidden = !state.hold;
  $('recoveryStart').disabled = !state.ready || state.configuring || state.busy || !!projectOperation;
  // Do not compute a project fingerprint for a disabled button, especially
  // while recovery is off or protecting a previous session's drafts.
  $('recoverySaveNow').disabled = !state.ready || !state.enabled || state.hold || state.suspended || state.busy || state.configuring || !photos.length || !!recoveryCaptureReason();
  $('recoveryCancel').disabled = !state.busy && projectOperation !== 'recovery';
  $('recoveryRefresh').disabled = state.configuring || !!projectOperation;
  const phase = projectOperation === 'recovery' ? '正在验证恢复草稿…' : state.busy ? state.phase === 'write' ? '正在写入恢复草稿；可以继续编辑' : '正在准备稳定快照；可以继续编辑' : state.hold ? '已有草稿受保护，等待明确选择' : state.enabled ? state.pending ? '稳定 30 秒后自动记录' : '本地恢复已开启' : '本地恢复已关闭';
  $('recoverySummary').textContent = phase;
  $('recoveryMessage').textContent = state.error || recoveryFallback?.error || state.notice || phase;
  $('recoveryMessage').classList.toggle('error', !!state.error || !!recoveryFallback);
  for (const slot of ['latest', 'previous']) {
    const item = state.disk?.slots?.find(s => s.slot === slot), label = slot === 'latest' ? '最新一代' : '上一代';
    const validation = ({ 'header-only': '仅检查文件头，恢复时完整验证', verified: '已完整验证', invalid: '无效', changed: '检查时发生变化', missing: '不存在' })[item?.validation] || '未检查';
    $(`recovery-${slot}`).textContent = item?.exists ? `${label} · ${item.modifiedAt || '时间未知'} · ${recoverySize(item.sizeBytes)} · ${validation}${item.overBudget ? ' · 大于当前容量，仍保留' : ''}${item.error ? ` · ${item.error}` : ''}` : `${label}：暂无草稿`;
    $(`recoveryRestore-${slot}`).disabled = !item?.exists || !!projectOperation || state.busy || state.configuring;
  }
  $('recoveryFallback').hidden = !recoveryFallback;
  $('recoveryFallback').textContent = recoveryFallback ? `最新一代无法恢复：${recoveryFallback.error}。上一代（${recoveryFallback.fallbackCandidate?.modifiedAt || '时间未知'}）已通过完整验证；如需使用，请明确点击“恢复上一代”。不会自动载入。` : '';
}
async function restoreRecovery(slot) {
  if (!recoveryController || !['latest', 'previous'].includes(slot) || !projectReady()) return;
  // Unlike manual Open, do not discard an unfinished edit merely to stage a draft.
  if (pointer || referencePointer || manualDraft || matteDraft || cropDraft || photos.some(p => JSON.stringify(p.settings) !== JSON.stringify(p.committed))) { toast('请先提交或取消当前笔画、裁剪与滑杆调整，再恢复草稿。'); return; }
  const token = ++recoveryRestoreEpoch;
  const assertCurrent = () => { if (token !== recoveryRestoreEpoch) throw Object.assign(new Error('已取消恢复'), { name: 'AbortError' }); };
  projectOperation = 'recovery'; clearTimeout(renderTimer); renderController?.abort(); renderVersion++;
  updateAvailability(); updateBusy(); let staged = null, adopted = false;
  try {
    await recoveryController.suspend(); assertCurrent();
    const result = await bridge.openRecoveryDraft({ slot }); assertCurrent();
    if (result?.requiresFallbackChoice) { recoveryFallback = result; return; }
    if (!result || result.canceled) return;
    const snapshot = await window.MintProjectDocument.decode(result.bytes); assertCurrent();
    staged = await stageProject(snapshot, { assertCurrent }); assertCurrent();
    if (hasUnsavedProjectChanges()) {
      if (typeof bridge.confirmReplaceProject !== 'function') throw new Error('缺少可信的替换确认，未替换当前会话');
      const confirmed = await bridge.confirmReplaceProject(); assertCurrent();
      if (confirmed !== true) { status('未替换当前会话 · 原有更改与恢复草稿保留'); return; }
    }
    installStagedProject(staged, '', { recovered: true }); staged = null; adopted = true; recoveryFallback = null;
    status('已恢复为未保存项目 · 请正式保存为 .mintproj'); toast('恢复草稿已载入。它不是正式存档，请保存项目到你选择的位置。');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(`无法恢复草稿：${error.message || error}。原有会话未替换。`, true);
    else status('已取消恢复 · 原有会话保留');
  } finally {
    discardStagedProject(staged); finishProjectOperation(); recoveryController.resume({ adopted });
    await recoveryController.refresh(); updateRecoveryControls();
  }
}
async function cancelRecovery() {
  if (projectOperation === 'recovery') { recoveryRestoreEpoch++; status('正在取消恢复 · 原有会话保留'); }
  await recoveryController?.cancel(); updateRecoveryControls();
}

async function importFiles(items, demo = false) {
  cancelCropDraft();
  if (locked() || !items?.length) return;
  importing = true; updateAvailability(); let added = 0, failures = [], firstId = null;
  let bytesUsed = photos.reduce((sum, p) => sum + p.blob.size, 0);
  try {
    for (const item of Array.from(items)) {
      if (photos.length >= MAX_FILES) { failures.push('单次会话最多 100 张照片'); break; }
      const name = item.name || '未命名照片.png';
      if (reviewCore) { try { reviewCore.query([{ id: 'import-check', name, review: reviewDefaults(), selected: true }], reviewCore.viewDefaults()); } catch (error) { failures.push(`${name}：文件名不能安全用于项目，未导入`); continue; } }
      if (!/\.(jpe?g|png|webp)$/i.test(name) && !/^image\/(jpeg|png|webp)$/.test(item.type || '')) { failures.push(`${name}：仅支持 JPG / PNG / WebP`); continue; }
      const blob = item instanceof Blob ? item : new Blob([item.bytes], { type: /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg' });
      if (blob.size > MAX_FILE_BYTES) { failures.push(`${name}：单个文件请小于 80 MB`); continue; }
      if (bytesUsed + blob.size > MAX_BYTES) { failures.push('本次会话文件总量超过 400 MB，请分批处理'); break; }
      status(`正在导入 ${name}…`); await nextFrame();
      try {
        const decoded = await Pipeline.decodeImage(blob, 320);
        const thumb = await makeThumb(decoded.canvas);
        const p = { id: crypto.randomUUID(), name, blob, thumb, selected: true, review: reviewDefaults(), settings: defaults(), committed: defaults(), undo: [], redo: [], revision: 0, preset: null, originalWidth: decoded.originalWidth, originalHeight: decoded.originalHeight, output: outputDimensions(decoded.originalWidth, decoded.originalHeight), demo };
        p.sourceRevision = `${p.id}:source-0`; p.learnedCache = new Map(); p.imageAssets = Object.freeze([]);
        photos.push(p); bytesUsed += blob.size; appendPhotoCard(p); added++; firstId ||= p.id;
      } catch (error) { failures.push(`${name}：${error.message || '图片无法读取'}`); }
    }
  } finally { importing = false; updateAvailability(); }
  if (firstId) await activatePhoto(firstId);
  status(`已导入 ${added} 张照片${failures.length ? ` · ${failures.length} 项未导入` : ''}`);
  if (failures.length) toast(failures.slice(0, 3).join('；'), true);
  else if (added > 1) toast(`已导入 ${added} 张照片。勾选照片可批量同步参数与导出。`);
}
async function openImages() {
  cancelCropDraft();
  if (locked()) return;
  if (!bridge?.openImages) { $('fileInput').click(); return; }
  openingDialog = true; updateAvailability();
  try {
    const items = await bridge.openImages(); openingDialog = false;
    if (items?.length) await importFiles(items);
  } catch (error) { toast(`导入失败：${error.message || error}`, true); }
  finally { openingDialog = false; updateAvailability(); }
}
function undo() {
  finishRedactionStroke(false); finishPaintStroke(false);
  if (tool === 'white-balance') setTool('pan');
  cancelCropDraft();
  finishManualStroke(false); finishMatteStroke(false);
  const p = current(); if (!p || !photoAvailable()) return; historyCommit(p);
  if (!p.undo.length) return;
  p.redo.push(clone(p.settings)); p.settings = p.undo.pop(); p.committed = clone(p.settings); p.preset = null; p.revision++;
  retainImageAssets(p);
  updateControls(); updateCards(); scheduleRender(0); status('已撤销上一步调整');
}
function redo() {
  finishRedactionStroke(false); finishPaintStroke(false);
  if (tool === 'white-balance') setTool('pan');
  cancelCropDraft();
  finishManualStroke(false); finishMatteStroke(false);
  const p = current(); if (!p || !photoAvailable() || !p.redo.length) return;
  p.undo.push(clone(p.settings)); p.settings = p.redo.pop(); p.committed = clone(p.settings); p.preset = null; p.revision++;
  retainImageAssets(p);
  updateControls(); updateCards(); scheduleRender(0); status('已重做调整');
}
function clearSessionView() {
  imagePanel?.cancel();
  finishRedactionStroke(false); finishPaintStroke(false);redactionPointers.clear();
  if (tool === 'white-balance') setTool('pan');
  textRasterCache=null;paintRasterCache=null;textDraft=null;cancelTextPlacement();
  cancelReferenceGesture(); acceptedRender = null; renderPending = false; renderFailure = ''; clearPreviewPixelInspector();
  cancelCropDraft();
  finishManualStroke(false); finishMatteStroke(false); cancelBackendJob('结束当前预览'); activeCorrectedMatte = null; activeMatteInspection = null; activeMattePreview = null; activeDiagnosticOverlay = null; $('diagnosticBadge').hidden = true;
  viewToken++; renderVersion++; renderController?.abort(); clearTimeout(renderTimer);
  clearToneHistogram('等待处理后的预览。');
  currentId = null; source = null; rendered = null; analysis = null; requestedDisplayMode = null; renderedDisplayStamp = null; framedOriginalCache = null; manualViewReady = false; manualOverlayCache = null; renderedManualMode = false; manualViewStamp = null; repairSample = null; loadingPhoto = false; analyzingPhoto = false; renderingPhoto = false; originalHeld = false;
  $('previewCanvas').width = 1; $('previewCanvas').height = 1;
  $('welcome').hidden = false; $('imageSurface').hidden = true; $('viewport').classList.remove('has-image');
  $('activeFileName').textContent = '尚未导入照片'; $('activeFileName').title = '';
  $('imageDimensions').textContent = ''; $('reductionNotice').textContent = ''; $('zoomLabel').textContent = '适合';
  $('originalBadge').hidden = true; updateFaceStatus(); updateControls(); updateBusy(); status('准备就绪');
}
function removeSelected() {
  cancelCropDraft();
  if (locked()) return;
  const remove = selected(); if (!remove.length) return;
  if (!approveBatchScope(remove, '移除工作区引用')) return;
  const removedCurrent = remove.some(p => p.id === currentId);
  if (referenceSnapshot && remove.some(p => p.id === referenceSnapshot.photoId)) clearReference();
  if (remove.some(p => p.id === backendJob?.photoId)) cancelBackendJob('移除照片');
  for (const p of remove) { URL.revokeObjectURL(p.thumb); document.querySelector(`[data-photo-id="${p.id}"]`)?.remove(); photos.splice(photos.indexOf(p), 1); }
  if (removedCurrent) { clearSessionView(); if (photos.length) activatePhoto(photos[0].id); }
  updateCards(); toast(`已从会话移除 ${remove.length} 张照片，磁盘原图未删除。`);
}

// Named adjustment presets are a separate library, not project/photo recipes.
// Only the four portable control groups cross this boundary. No image-derived
// coordinates, source IDs, masks, strokes, framing or cache entries are copied.
const namedPresetCodec = (() => {
  try { return window.MintAdjustmentPreset?.createCodec({ advancedTone: window.MintAdvancedTone, levels: window.MintLevels, ...(window.MintLightBalance ? {lightBalance:window.MintLightBalance} : {}) }); }
  catch { return null; }
})();
const presetBasicKeys = ['exposure','contrast','saturation','temperature'];
const presetBeautyKeys = ['smooth','brighten','warmth','underEye','redness','lip','blush','palette'];
let presetCatalog = { items: [], trash: [] }, presetCatalogReady = false, presetCatalogError = '';
let selectedPresetId = '', presetDraft = null, presetDraftOrigin = '', presetNotice = '';
function presetBridgeReady() { return ['listPresets','savePreset','removePreset','restorePreset','importPreset','exportPreset','recoverPresetBackup'].every(key => typeof bridge?.[key] === 'function'); }
function selectedNamedPreset() { return presetCatalog.items.find(item => item.id === selectedPresetId); }
function presetTargets(scope) { return scope === 'current' ? (current() ? [current()] : []) : scope === 'selected' ? selected() : scope === 'all' ? photos.slice() : []; }
function presetDocumentFromPhoto(p, name) {
  if (!namedPresetCodec || !p) throw new Error('请先导入照片，并确认预设组件可用');
  const doc = namedPresetCodec.defaults(name);
  for (const key of presetBasicKeys) doc.controls.basic[key] = p.settings[key] ?? 0;
  const person=p.settings.faceAdjustments?selectedPerson(p):null;
  if(p.settings.faceAdjustments&&!person)throw new Error('保存人像预设前请明确选择人物；配方不保存任何人脸坐标或编号');
  for (const key of presetBeautyKeys) doc.controls.beauty[key] = (person?person.beauty[key]:p.settings[key]) ?? (key === 'palette' ? 'natural' : 0);
  doc.controls.advancedTone = clone(p.settings.advancedTone ?? null);
  doc.controls.levels = clone(p.settings.levels ?? null);
  doc.controls.lightBalance = clone(p.settings.lightBalance ?? null);
  return namedPresetCodec.validate(doc);
}
function stagedPresetDocument() {
  if (!namedPresetCodec || !presetDraft) throw new Error('请先读取当前照片的参数，或选择 / 导入一个预设');
  return namedPresetCodec.validate({ ...presetDraft, name: $('namedPresetName').value });
}
function stageNamedPreset(document, origin) {
  const clean = namedPresetCodec.validate(document);
  presetDraft = clean; presetDraftOrigin = origin; $('namedPresetName').value = clean.name;
  presetNotice = '仅准备配方，尚未应用到照片。'; updateNamedPresetControls();
}
function renderNamedPresetLists() {
  const select = $('namedPresetList'), placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '选择已保存的预设'; select.replaceChildren(placeholder);
  for (const item of presetCatalog.items) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.document.name; select.append(option); }
  if (!selectedNamedPreset()) selectedPresetId = '';
  select.value = selectedPresetId;
  const trash = $('namedPresetTrash'), empty = document.createElement('option');
  const prior = trash.value; empty.value = ''; empty.textContent = `已移除（${presetCatalog.trash.length}/20）`; trash.replaceChildren(empty);
  for (const item of presetCatalog.trash) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.document.name; trash.append(option); }
  trash.value = presetCatalog.trash.some(item => item.id === prior) ? prior : '';
}
function acceptPresetCatalog(value) {
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.trash) || value.items.length > 100 || value.trash.length > 20) throw new Error('预设库返回了无效目录');
  const ids = new Set();
  const items = list => list.map(item => { if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('预设库编号无效'); ids.add(item.id); return { id: item.id, document: namedPresetCodec.validate(item.document) }; });
  const catalog = { items: items(value.items), trash: items(value.trash) };
  presetCatalog = catalog; presetCatalogReady = true; presetCatalogError = ''; renderNamedPresetLists();
  return presetWriteWarning(value);
}
function presetWriteWarning(result) { return typeof result?.durabilityWarning === 'string' && result.durabilityWarning ? ` 警告：${result.durabilityWarning}` : ''; }
function updateNamedPresetControls() {
  if (!$('namedPresets')) return;
  const capable = !!namedPresetCodec && presetBridgeReady(), idle = !locked() && !analyzingPhoto && !backendJob;
  const ready = capable && presetCatalogReady && !presetCatalogError, chosen = !!selectedNamedPreset();
  const disable = (id, value) => { $(id).disabled = value; };
  for (const id of ['namedPresetList','namedPresetTrash']) disable(id, !ready || !idle);
  for (const id of ['namedPresetName','namedPresetScope','namedPresetMode']) disable(id, !capable || !idle);
  disable('captureNamedPreset', !capable || !idle || !current() || !source);
  disable('clearNamedPreset', !capable || !idle || !presetDraft);
  disable('saveNamedPreset', !ready || !idle || !presetDraft || presetCatalog.items.length >= 100);
  disable('updateNamedPreset', !ready || !idle || !presetDraft || !chosen);
  disable('importNamedPreset', !capable || !idle);
  disable('exportNamedPreset', !ready || !idle || !chosen);
  disable('removeNamedPreset', !ready || !idle || !chosen || presetCatalog.trash.length >= 20);
  disable('restoreNamedPreset', !ready || !idle || !presetCatalog.trash.some(item => item.id === $('namedPresetTrash').value) || presetCatalog.items.length >= 100);
  disable('reloadNamedPresets', !capable || !idle);
  disable('recoverNamedPresets', !capable || !idle);
  disable('applyNamedPreset', !capable || !idle || !presetDraft || !presetTargets($('namedPresetScope').value).length);
  $('cancelNamedPreset').hidden = presetOperation?.kind !== 'apply';
  disable('cancelNamedPreset', !presetOperation || presetOperation.cancelled);
  $('recoverNamedPresets').hidden = !presetCatalogError;
  $('namedPresetStatus').textContent = !namedPresetCodec ? '预设组件不可用；照片编辑仍可使用。' : !presetBridgeReady() ? '本地预设库仅在桌面版可用；不会在浏览器中另存一份。' : presetOperation ? presetOperation.message : presetCatalogError ? `预设库未就绪：${presetCatalogError}。可重新读取或恢复上次备份。` : presetNotice || `本机保存 ${presetCatalog.items.length}/100 个预设。`;
  $('namedPresetDraft').textContent = presetDraft ? `${presetDraftOrigin} · ${namedPresetCodec.hasPortraitEffect(presetDraft) ? '含人像修饰，完整应用需逐图检测到真实人脸' : '人像修饰为零，完整应用会清零这些参数'}。两种模式都包含明暗/白平衡、色阶与曲线/HSL；仅调色模式保留目标原有修肤。` : '读取当前照片的参数，或选择 / 导入配方。名称可编辑；保存不会应用照片。';
}
function beginPresetOperation(kind, message) {
  if (!namedPresetCodec || !presetBridgeReady() || locked() || analyzingPhoto || backendJob) return null;
  cancelCropDraft(); finishManualStroke(false); finishRedactionStroke(false); finishPaintStroke(false); finishMatteStroke(false);
  if (pointer && $('viewport').hasPointerCapture?.(pointer.id)) $('viewport').releasePointerCapture(pointer.id);
  pointer = null; $('viewport').classList.remove('dragging');
  cancelReferenceGesture();
  const operation = { kind, message, cancelled: false }; presetOperation = operation;
  clearTimeout(renderTimer); renderController?.abort(); renderVersion++; renderingPhoto = false;
  updateAvailability(); updateBusy(); return operation;
}
function finishPresetOperation(operation) {
  if (presetOperation !== operation) return;
  presetOperation = null; updateAvailability(); updateBusy();
  if (source) scheduleRender(0);
}
async function loadNamedPresets() {
  const operation = beginPresetOperation('list', '正在读取本机预设库…'); if (!operation) { updateNamedPresetControls(); return; }
  try { presetNotice = acceptPresetCatalog(await bridge.listPresets()); }
  catch (error) { presetCatalogError = error.message || String(error); }
  finally { finishPresetOperation(operation); }
}
async function saveNamedPreset(update = false) {
  if (!presetCatalogReady || presetCatalogError) return;
  let document, id;
  try { document = stagedPresetDocument(); id = update ? selectedNamedPreset()?.id : undefined; if (update && !id) throw new Error('请先选择要更新的预设'); }
  catch (error) { toast(error.message || String(error), true); return; }
  const operation = beginPresetOperation('save', update ? '正在明确更新选中预设…' : '正在另存新预设…'); if (!operation) return;
  try {
    const payload = { document }; if (id) payload.id = id;
    const result = await bridge.savePreset(payload);
    if (!result || typeof result.id !== 'string') throw new Error('保存结果无法确认，请重新读取预设库后检查');
    const clean = namedPresetCodec.validate(result.document);
    selectedPresetId = result.id;
    const warning = acceptPresetCatalog(await bridge.listPresets()) || presetWriteWarning(result);
    stageNamedPreset(clean, '已保存配方'); presetNotice = (update ? '已更新选中预设；照片未改变。' : '已另存新预设；照片未改变。') + warning;
  } catch (error) { presetCatalogError = error.message || String(error); toast(`预设保存未完成：${presetCatalogError}。请重新读取后检查，不会自动重试。`, true); }
  finally { finishPresetOperation(operation); }
}
async function importNamedPreset() {
  const operation = beginPresetOperation('import', '请选择预设文件…'); if (!operation) return;
  try { const document = await bridge.importPreset(); if (document === null) { presetNotice = '已取消导入；暂存配方与照片未改变。'; return; } const clean = namedPresetCodec.validate(document); selectedPresetId = ''; $('namedPresetList').value = ''; stageNamedPreset(clean, '导入暂存（未保存）'); }
  catch (error) { toast(`未导入预设：${error.message || error}。照片与原暂存配方未改变。`, true); }
  finally { finishPresetOperation(operation); }
}
async function exportNamedPreset() {
  const item = selectedNamedPreset(); if (!item) return;
  const document = namedPresetCodec.validate(item.document), operation = beginPresetOperation('export', '请选择预设导出位置…'); if (!operation) return;
  try { const result = await bridge.exportPreset(document); presetNotice = result ? `已导出「${document.name}」的调节配方，不含照片、源文件路径字段或蒙版。${presetWriteWarning(result)}` : '已取消导出；照片与预设未改变。'; }
  catch (error) { toast(`预设未导出：${error.message || error}`, true); }
  finally { finishPresetOperation(operation); }
}
async function removeNamedPreset() {
  const item = selectedNamedPreset(); if (!item || presetCatalogError) return;
  const operation = beginPresetOperation('remove', '正在移到可恢复的已移除列表…'); if (!operation) return;
  try { const warning = acceptPresetCatalog(await bridge.removePreset(item.id)); selectedPresetId = ''; presetNotice = '已移除，可在下方选择并恢复；照片未改变。' + warning; }
  catch (error) { presetCatalogError = error.message || String(error); }
  finally { finishPresetOperation(operation); }
}
async function restoreNamedPreset() {
  const id = $('namedPresetTrash').value; if (!presetCatalog.trash.some(item => item.id === id) || presetCatalogError) return;
  const operation = beginPresetOperation('restore', '正在恢复预设…'); if (!operation) return;
  try { const warning = acceptPresetCatalog(await bridge.restorePreset(id)); selectedPresetId = id; renderNamedPresetLists(); stageNamedPreset(selectedNamedPreset().document, '已恢复配方'); presetNotice = '已恢复预设；照片未改变。' + warning; }
  catch (error) { presetCatalogError = error.message || String(error); }
  finally { finishPresetOperation(operation); }
}
async function recoverNamedPresets() {
  const operation = beginPresetOperation('recover', '请在桌面对话框确认恢复上次备份…'); if (!operation) return;
  try { const catalog = await bridge.recoverPresetBackup(); if (catalog !== null) { const warning = acceptPresetCatalog(catalog); presetNotice = '已恢复上次预设库备份；照片与暂存配方未改变。' + warning; } }
  catch (error) { presetCatalogError = error.message || String(error); }
  finally { finishPresetOperation(operation); }
}
function presetFaceMeshReady(facts) {
  // Match the real beauty core's MediaPipe topology and minimum face bounds.
  // Never turn a face count, face rectangle or another photo's mesh into a face.
  const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  return !!facts && Array.isArray(facts.landmarks) && facts.landmarks.length > 0 && facts.landmarks.length <= 5 && facts.faceCount === facts.landmarks.length && facts.landmarks.every(mesh => {
    if (!Array.isArray(mesh) || ![468,478].includes(mesh.length) || !Array.from(mesh).every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 3 && Math.abs(p.y) <= 3)) return false;
    const xs = oval.map(i => Math.min(1, Math.max(0, mesh[i].x))), ys = oval.map(i => Math.min(1, Math.max(0, mesh[i].y)));
    return Math.max(...xs) - Math.min(...xs) >= .03 && Math.max(...ys) - Math.min(...ys) >= .03;
  });
}
function cancelNamedPresetApplication() {
  if (presetOperation?.kind !== 'apply') return;
  presetOperation.cancelled = true;
  presetOperation.message = '已取消；等待当前本机分析退出，迟到结果不会应用。'; updateNamedPresetControls();
}
async function applyNamedPreset() {
  let document;
  try { document = stagedPresetDocument(); } catch (error) { toast(error.message || String(error), true); return; }
  const scope = $('namedPresetScope').value, mode = $('namedPresetMode').value;
  if (!['full','color'].includes(mode)) return;
  const targets = presetTargets(scope).slice(); if (!targets.length || targets.length > MAX_FILES) return;
  const personTarget=mode==='full'&&targets.length===1&&targets[0]===current()&&targets[0].settings.faceAdjustments!=null;
  const personTargetId=personTarget?selectedPerson(targets[0])?.id:null;
  if(mode==='full'&&targets.some(p=>p.settings.faceAdjustments!=null)&&(!personTarget||!personTargetId)){toast('逐人模式的人像配方仅应用于当前明确所选的人物。批量请选“仅调色”，不会跨照片复制人物坐标。',true);return;}
  const needsFace = mode === 'full' && namedPresetCodec.hasPortraitEffect(document);
  if (needsFace && !personTarget && modelState !== 'ready') { toast('完整应用需要已就绪的人脸模型。没有应用任何照片；可明确选择“仅调色”保留各照片原有修肤。', true); return; }
  if (needsFace && !faceColorReady()) { toast('人像修饰核心不可用，未应用任何照片。', true); return; }
  if (locked() || analyzingPhoto || backendJob) return;
  try { preflightBatchRevisions(targets); } catch (error) { toast(error.message, true); return; }
  const scopeGuard = approveBatchScope(targets, '应用调整预设'); if (!scopeGuard) return;
  const operation = beginPresetOperation('apply', `正在检查 ${targets.length} 张照片…`); if (!operation) return;
  const token = viewToken, activeId = currentId, activeSource = source;
  const frozen = targets.map(p => ({ p, id: p.id, blob: p.blob, sourceRevision: sourceRevisionOf(p), revision: p.revision, settings: clone(p.settings), settingsKey: JSON.stringify(p.settings), committedKey: JSON.stringify(p.committed), historyKey: JSON.stringify([p.undo,p.redo]), width: p.originalWidth, height: p.originalHeight, selected: p.selected }));
  const live = (deep = false) => batchScopeLive(scopeGuard) && presetOperation === operation && !operation.cancelled && token === viewToken && currentId === activeId && source === activeSource && frozen.every(f => photos.includes(f.p) && f.p.id === f.id && f.p.blob === f.blob && sourceRevisionOf(f.p) === f.sourceRevision && f.p.revision === f.revision && f.p.originalWidth === f.width && f.p.originalHeight === f.height && f.p.selected === f.selected && (!deep || (JSON.stringify(f.p.settings) === f.settingsKey && JSON.stringify(f.p.committed) === f.committedKey && JSON.stringify([f.p.undo,f.p.redo]) === f.historyKey)));
  const assertLive = (deep = false) => { if (!live(deep)) throw new Error(operation.cancelled ? '已取消' : '照片、原图版本或编辑状态已改变'); };
  let currentFacts = null, applied = 0, committed = false;
  try {
    for (let i = 0; i < frozen.length; i++) {
      assertLive(); const f = frozen[i]; operation.message = `${needsFace ? '逐图检测真实人脸' : '检查调色配方'} ${i + 1}/${frozen.length}：${f.p.name}`; updateNamedPresetControls();
      if (needsFace && !f.settings.faceAdjustments) {
        // Decode every target's own immutable original Blob at the existing
        // 1280 preview limit. Reuse the serialized queue, never another face.
        const decoded = await Pipeline.decodeImage(f.blob, 1280); assertLive();
        if (decoded.originalWidth !== f.width || decoded.originalHeight !== f.height) throw new Error(`「${f.p.name}」原图尺寸已改变`);
        const pending = analysisQueue.catch(() => {}).then(() => { assertLive(); return Pipeline.analyze(decoded.canvas); });
        analysisQueue = pending.catch(() => {});
        const facts = await pending; assertLive();
        if(facts?.faceCount>1)throw new Error(`「${f.p.name}」检测到多人，请逐张启用逐人模式并明确选择人物；或选择仅调色`);
        if (!presetFaceMeshReady(facts)) throw new Error(`「${f.p.name}」未检测到可用的真实人脸网格`);
        if (f.id === activeId) currentFacts = facts;
      } else { await nextFrame(); assertLive(); }
    }
    // Allocate complete history/candidate records before the atomic synchronous
    // commit. Nothing below awaits or invokes UI until every photo is changed.
    const commits = frozen.map(f => {
      const settings = { ...f.settings, ...document.controls.basic, lightBalance: clone(document.controls.lightBalance ?? null), levels: clone(document.controls.levels), advancedTone: clone(document.controls.advancedTone) };
      if (mode === 'full') {
        if(settings.faceAdjustments){
          if(selectedPerson(f.p)?.id!==personTargetId)throw new Error('当前人物选择已改变，预设未应用');
          settings.faceAdjustments=clone(settings.faceAdjustments);
          const person=settings.faceAdjustments.faces.find(face=>face.id===personTargetId);if(!person)throw new Error('所选人物已过期');
          person.beauty=clone(document.controls.beauty);
        }else Object.assign(settings,document.controls.beauty);
      }
      if(settings.faceAdjustments){
        window.MintPortraitPeopleDesktop.validateCompatibility(settings,sourceRevisionOf(f.p));
        if(mode==='full')validatePeopleSettings(settings,f.p,source);
      }
      if (JSON.stringify(settings) === f.settingsKey) return null;
      return { p: f.p, settings, committed: clone(settings), undo: [...f.p.undo, clone(f.settings)].slice(-40), revision: f.revision + 1 };
    }).filter(Boolean);
    assertLive(true);
    for (const commit of commits) { const p = commit.p; p.settings = commit.settings; p.committed = commit.committed; p.undo = commit.undo; p.redo = []; p.revision = commit.revision; p.preset = null; }
    applied = commits.length; committed = true;
    if (currentFacts) analysis = analysis ? { ...analysis, landmarks: currentFacts.landmarks, faceCount: currentFacts.faceCount } : currentFacts;
    presetNotice = `已检查 ${targets.length} 张，${applied} 张参数已${mode === 'color' ? '仅调色' : '完整'}应用；每张可单独撤销。`;
    status(presetNotice); updateControls(); updateCards(); updateFaceStatus();
  } catch (error) {
    presetNotice = committed ? `已应用 ${applied} 张照片，但预览更新失败：${error.message || error}。参数可逐张撤销，请重新选择照片检查。` : `未应用任何照片：${error.message || error}。${operation.cancelled ? '' : '可调整范围，或明确选择仅调色后重试。'}`;
    toast(presetNotice, !operation.cancelled);
  } finally { finishPresetOperation(operation); }
}
$('namedPresetList')?.addEventListener('change', () => {
  if (locked()) return;
  const item = presetCatalog.items.find(item => item.id === $('namedPresetList').value); selectedPresetId = item?.id || '';
  if (item) stageNamedPreset(item.document, '已保存配方'); else updateNamedPresetControls();
});
$('namedPresetTrash')?.addEventListener('change', updateNamedPresetControls);
for (const id of ['namedPresetScope','namedPresetMode']) $(id)?.addEventListener('change', updateNamedPresetControls);
$('captureNamedPreset')?.addEventListener('click', () => {
  if (!photoAvailable() || analyzingPhoto || backendJob || !namedPresetCodec) return;
  try { stageNamedPreset(presetDocumentFromPhoto(current(), $('namedPresetName').value.trim() || '我的调整'), '来自当前照片（未保存）'); }
  catch (error) { toast(`无法准备预设：${error.message || error}`, true); }
});
$('clearNamedPreset')?.addEventListener('click', () => { if (locked()) return; selectedPresetId = ''; presetDraft = null; presetDraftOrigin = ''; $('namedPresetName').value = ''; $('namedPresetList').value = ''; presetNotice = '已清除暂存配方；照片和已保存的预设未改变。'; updateNamedPresetControls(); });
$('saveNamedPreset')?.addEventListener('click', () => saveNamedPreset(false));
$('updateNamedPreset')?.addEventListener('click', () => saveNamedPreset(true));
$('importNamedPreset')?.addEventListener('click', importNamedPreset);
$('exportNamedPreset')?.addEventListener('click', exportNamedPreset);
$('removeNamedPreset')?.addEventListener('click', removeNamedPreset);
$('restoreNamedPreset')?.addEventListener('click', restoreNamedPreset);
$('reloadNamedPresets')?.addEventListener('click', loadNamedPresets);
$('recoverNamedPresets')?.addEventListener('click', recoverNamedPresets);
$('applyNamedPreset')?.addEventListener('click', applyNamedPreset);
$('cancelNamedPreset')?.addEventListener('click', cancelNamedPresetApplication);

for (const preset of Pipeline.PRESETS) {
  const button = document.createElement('button'); button.className = 'preset'; button.dataset.preset = preset.id;
  button.innerHTML = `<span class="preset-swatch" aria-hidden="true"></span><span><strong></strong><small></small></span>${icon('check')}`;
  button.querySelector('strong').textContent = preset.name; button.querySelector('small').textContent = preset.description;
  button.title = `${preset.description} · 重置色阶与高级调色，保留手动笔触与局部图层`; button.disabled = true;
  button.addEventListener('click', () => {
    const p = current(); if (!p || !photoAvailable()) return;
    cancelCropDraft();
    const settings = { ...clone(p.settings), ...clone(preset.settings), levels: null, advancedTone: null, spots: clone(p.settings.spots) };
    if(p.settings.faceAdjustments){
      const person=selectedPerson(p);if(!person){toast('请先选定人物后应用人像风格，未更改任何参数。',true);return;}
      settings.faceAdjustments=clone(p.settings.faceAdjustments);const target=settings.faceAdjustments.faces.find(face=>face.id===person.id);
      for(const key of peopleBeautyKeys){target.beauty[key]=preset.settings[key]??0;settings[key]=0;}target.beauty.palette=preset.settings.palette||'natural';
      for(const key of peopleShapeKeys){target.reshape[key]=preset.settings[key]??0;settings[key]=0;}
    }
    if (p.settings.localLayers) settings.localLayers = clone(p.settings.localLayers); else delete settings.localLayers;
    for (const key of ['sharpness','paintLayers','redactions','framing','straighten','perspective','canvasPadding','textLayers','imageLayers','manualSelection','manualLiquify','manualRepair','learnedMatteId','learnedMatteStrokes','diagnosticParseId','diagnosticOverlay','diagnosticLayer']) { if (key in p.settings) settings[key] = p.settings[key]; }
    if(p.settings.redactions||p.settings.paintLayers) for(const key of ['slim','eyes','nose','jaw']) settings[key]=p.settings[key];
    if (!hasFaces()) for (const [key, , , , , capability] of controls) if (capability === 'face' || capability === 'face-color') settings[key] = p.settings[key];
    if (!hasMask()) for (const key of ['bgMode','bgBlur','bgColor','bgFeather']) settings[key] = p.settings[key];
    if (p.settings.manualLiquify?.length) { for (const key of ['slim','eyes','nose','jaw','bgMode','bgColor','bgBlur','bgFeather']) settings[key] = p.settings[key]; toast('已保留手动推拉；预设中的自动塑形与背景处理未应用，避免原图定位错位。'); }
    if(changeSettings(settings)!==true)return; p.preset = preset.id; updateControls(); scheduleRender(0);
    status(`已应用「${preset.name}」${hasFaces() ? '' : ' · 当前仅应用可用的调色参数'}`);
  });
  $('presets').append(button);
}

function exportMode() { return $('exportMode').value === 'working' ? 'working' : 'original'; }
function finalOutputBasisChanged(){cancelPerspectiveDraft(false);refreshExportPlan();updateAvailability();if(source&&current())scheduleRender(0);}
function exportOutputRecipe() {
  const mode=$('exportOutputMode')?.value||'unchanged';
  if(mode==='unchanged')return {version:1,mode:'unchanged',longEdge:null};
  if(mode!=='long-edge'||!window.MintExportSize)throw new Error('最终尺寸组件或模式不可用，未开始缩放');
  const raw=$('exportLongEdge').value;
  if(!/^\d+$/.test(raw))throw new Error('目标长边必须是1–16384的整数');
  const longEdge=Number(raw);if(!Number.isSafeInteger(longEdge)||longEdge<1||longEdge>16384)throw new Error('目标长边必须是1–16384的整数');
  return window.MintExportSize.validate({version:1,mode:'long-edge',longEdge});
}
function exportFinalDimensions(p, mode, recipe) {
  const dimensions=exportDimensions(p,mode);
  if(!recipe)return dimensions;
  if(!window.MintExportSize){if(recipe.version===1&&recipe.mode==='unchanged'&&recipe.longEdge===null&&Object.keys(recipe).length===3)return dimensions;throw new Error('最终尺寸组件不可用，未缩放');}
  const clean=window.MintExportSize.validate(recipe);if(clean.mode==='unchanged')return dimensions;
  if(clean.longEdge>Math.max(dimensions.width,dimensions.height))throw new Error(`目标长边${clean.longEdge}超过此照片合成长边${Math.max(dimensions.width,dimensions.height)}；不允许放大，请降低目标长边`);
  const plan=window.MintExportSize.plan(dimensions.width,dimensions.height,clean);
  return {...dimensions,width:plan.output.width,height:plan.output.height,compositionWidth:dimensions.width,compositionHeight:dimensions.height,outputResized:plan.resized};
}

function exportDimensions(p, mode = exportMode()) {
  const processing = mode === 'working' ? outputDimensions(p.originalWidth, p.originalHeight) : { width: p.originalWidth, height: p.originalHeight, scaled: false };
  const sharpened=sharpnessActive(p.settings);if(sharpened)window.MintSharpness.plan({width:processing.width,height:processing.height},p.settings.sharpness);
  const layout = finalCanvasPlan(processing.width,processing.height,p.settings);
  const final = layout.outputSize;
  const imagePlan=imageLayerPlan(p,p.settings,final.width,final.height);
  if(p.settings.paintLayers) paintCore().plan(final.width,final.height,p.settings.paintLayers,paintContext(p,p.settings,{width:processing.width,height:processing.height}));
  if(p.settings.redactions) redactionCore().plan(final.width,final.height,p.settings.redactions,redactionContext(p,p.settings,{width:processing.width,height:processing.height}));
  return { ...final, ...(layout.perspectiveReceipt?{perspectiveReceipt:layout.perspectiveReceipt}:{}), ...(imagePlan?.active?{imageLayered:true,imageLayerKey:window.MintImageLayers.canonicalRecipe(p.settings.imageLayers)}:{}), ...(sharpened?{sharpened:true,sharpnessRecipe:clone(p.settings.sharpness)}:{}), ...(straightenActive(p.settings)?{straightened:true,straightenRecipe:clone(p.settings.straighten),straightenedWidth:layout.straightened.width,straightenedHeight:layout.straightened.height}:{}), padded: Object.values(layout.padding).some(n=>n>0), processingWidth: processing.width, processingHeight: processing.height, originalWidth: p.originalWidth, originalHeight: p.originalHeight, scaled: processing.scaled, framed: !!p.settings.framing && !!window.MintGeometry?.isActive(p.settings.framing) };
}
function exportLimit(p, mode) {
  const w = p.originalWidth, h = p.originalHeight;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return '原图尺寸尚未确认';
  if (bridge?.renderExport && (Math.max(w, h) > 16384 || w * h > 64000000)) return '本地导出可读取的原图最多6400万像素、长边16384（两种输出模式均适用）；请导入较小原图';
  try { const final = exportDimensions(p,mode), maxPixels = textActive(p.settings) ? 16000000 : bridge?.renderExport ? 64000000 : 16777216; if (final.width > 16384 || final.height > 16384 || final.width * final.height > maxPixels) return `留白后的最终画布超出${textActive(p.settings) ? '文字1600万' : bridge?.renderExport ? '6400万' : '1677万'}像素或16384长边上限；请减小留白或明确选择工作尺寸，不会自动缩小`; } catch (error) { return String(error.message || error); }
  if(p.settings.faceAdjustments!=null){
    try{
      if(!peopleReady())throw new Error('逐人修饰组件不可用');
      const processing=mode==='working'?outputDimensions(w,h):{width:w,height:h};
      window.MintPortraitPeopleDesktop.validateCompatibility(p.settings,sourceRevisionOf(p));
      for(const phase of ['beauty','reshape'])window.MintPortraitPeopleDesktop.planSize(processing.width,processing.height,p.settings.faceAdjustments,{sourceRevision:sourceRevisionOf(p),phase});
    }catch(error){const detail=error.code==='LIMIT'&&peopleEffects(p.settings.faceAdjustments)?'逐人效果处理上限1600万像素、长边16384':String(error.message||error);return `逐人处理上限/兼容性：${detail}；可明确选择工作尺寸或调整人物参数，不会自动缩小`; }
  }
  if (mode === 'working') return '';
  if (!bridge?.renderExport && (Math.max(w, h) > 16384 || w * h > 16000000)) return '浏览器原尺寸模式最多1600万像素、长边16384；请明确选择工作尺寸或桌面版';
  const s = p.settings;
  const portrait = ['smooth','brighten','warmth','slim','eyes','nose','jaw','underEye','redness','lip','blush'].some(k => Number(s[k] || 0) !== 0) || (s.spots?.length || 0) > 0 || (s.bgMode && s.bgMode !== 'original') || !!s.learnedMatteId || !!s.manualLiquify?.length || !!s.manualRepair?.length || !!s.localLayers?.some(layer => layer.mask?.kind === 'selection');
  return w * h > 16000000 && portrait ? '此照片启用了人像、手工工具、选区图层、点修或背景效果，原尺寸裁剪前处理上限1600万像素；关闭这些效果或明确选择工作尺寸' : '';
}
function refreshExportPlan() {
  const mode = exportMode(), list = exportList();
  if($('exportLongEdge'))$('exportLongEdge').disabled=exportRunning||$('exportOutputMode').value!=='long-edge';
  let outputRecipe,outputError='';try{outputRecipe=exportOutputRecipe();}catch(error){outputError=String(error.message||error);}
  $('exportModeNote').textContent = mode === 'original' ? (bridge?.renderExport ? '原像素尺度：先按完整原图处理，再裁剪/旋转和留白扩边。最终画布也必须满足6400万像素/16384长边上限。调色/普通局部图层最多6400万像素；人像/手工工具/选区图层/点修/背景最多1600万像素；长边最多16384。小裁剪不能绕过处理上限，不自动缩小。' : '浏览器原像素尺度：裁剪前最多1600万像素、长边16384。按构图输出；超限逐项报错，不自动缩小。') : `工作尺寸：你正在选择等比缩小，完整原图先缩小到最长边4096且最多1600万像素，再按构图与留白输出；留白可能使输出长边大于4096，但不会缩放原有画面。原图与项目不变。${bridge?.renderExport ? '桌面可读取的原图仍限6400万像素/16384长边。' : ''}`;
  const lines = list.map(p => { const limit = exportLimit(p, mode); let d; try { if(outputError)throw new Error(outputError);d = exportFinalDimensions(p, mode,outputRecipe); } catch (error) { return `${p.name} · ${p.originalWidth} × ${p.originalHeight} · 未生成输出计划 · ${limit || String(error.message || error)}`; } return `${p.name} · ${p.originalWidth} × ${p.originalHeight} → ${d.width} × ${d.height} px${d.scaled ? ' · 工作基准' : ''}${d.outputResized ? ` · 最后缩小（合成${d.compositionWidth}×${d.compositionHeight}）` : ''}${limit ? ` · ${limit}` : ''}`; });
  $('exportPlan').textContent = (lines.length ? lines.join('\n') : '当前范围没有照片。') + (paddingDraftCurrent() ? '\n注意：尚未应用的留白输入不会进入此次导出。' : '') + (textDraftCurrent() ? '\n注意：尚未应用的文字输入不会进入此次导出。' : '') + (imagePanel?.hasDraft ? '\n注意：尚未应用的贴图输入不会进入此次导出。' : '');
  try { if ($('exportScopeCounts')) $('exportScopeCounts').textContent = `本次范围：${batchScopeText(list)}。全部包含被筛选隐藏的照片。`; } catch (error) { if ($('exportScopeCounts')) $('exportScopeCounts').textContent = `无法核对范围：${error.message}`; }
}
function openExport() {
  if (tool === 'white-balance') setTool('pan');
  cancelCropDraft();
  if (!photos.length || locked() || analyzingPhoto || backendJob) return;
  finishRedactionStroke(false); finishPaintStroke(false); finishManualStroke(false); finishMatteStroke(false); historyCommit(current());
  $('exportScope').value = selected().length ? 'selected' : 'current';
  if (!$('exportMode').value) $('exportMode').value = 'original';
  $('exportTitle').textContent = bridge?.writeExport ? '导出你的作品' : '下载你的作品';
  $('exportDestination').textContent = exportFolder ? `上一队列保存至：${exportFolder.displayPath}` : bridge?.writeExport ? '选择新建导出后，请指定保存文件夹。' : '浏览器预览版：逐张发起下载，无法确认文件已保存。可能需要允许自动下载。';
  $('startExport').querySelector('span').textContent = bridge?.writeExport ? '新建导出' : '新建下载';
  $('exportProgress').hidden = !exportQueue; $('cancelExport').textContent = '关闭'; $('closeExport').disabled = false;
  for (const id of ['exportScope','exportFormat','exportMode','exportOutputMode','exportLongEdge','exportQuality','startExport']) $(id).disabled = false;
  $('exportQuality').disabled = $('exportFormat').value === 'png';
  refreshExportPlan(); updateExportQueue(); $('exportDialog').showModal();
}
function exportList() { return $('exportScope').value === 'all' ? photos : $('exportScope').value === 'current' ? [current()].filter(Boolean) : selected(); }
function fileName(name, format, sequence) { const base = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 110) || 'portrait'; return `${base}_薄荷_${String(sequence + 1).padStart(2, '0')}.${format === 'png' ? 'png' : 'jpg'}`; }
function setExportProgress(done, total, text) { const value = total ? Math.round(done / total * 100) : 0; $('exportProgressText').textContent = text; $('exportProgressPercent').textContent = `${value}%`; $('exportProgressBar').value = value; }
function exportSummaryText() {
  if (!exportQueue) return '';
  const s = exportQueue.summary(), warnings = exportQueue.items.filter(item => item.receipt?.durabilityWarning).length;
  return `${exportQueue.cancelled ? '已停止，' : ''}${bridge?.writeExport ? '已导出' : '已发起下载'} ${s.success} 张${s.failed ? `，${s.failed} 张失败` : ''}${s.cancelled + s.pending ? `，${s.cancelled + s.pending} 张未完成` : ''}${warnings ? `；${warnings} 张已保存但有持久化/清理警告，请查看明细` : ''}`;
}
function updateExportQueue() {
  const list = $('exportQueueList'); list.textContent = '';
  if (!exportQueue) { $('retryExport').hidden = true; return; }
  const labels = { pending: '等待', rendering: '正在处理', writing: bridge?.writeExport ? '正在保存（不可中断）' : '正在发起下载', saved: '已保存', downloaded: '已发起下载，未验证落盘', failed: '失败', cancelled: '未完成' };
  for (const item of exportQueue.items) {
    const row = document.createElement('li'); row.className = `export-queue-item state-${item.state}${item.receipt?.durabilityWarning ? ' export-warning' : ''}`;
    const title = document.createElement('strong'); title.textContent = item.photo.name;
    const state = document.createElement('span'); state.className = 'export-file-state'; state.textContent = item.receipt?.durabilityWarning ? '已保存 · 有警告' : labels[item.state];
    const details = document.createElement('small'); let d = item.output;
    if (!d) { try { d = exportFinalDimensions(item.photo, exportQueue.options.mode,exportQueue.options.outputSize); } catch { d = { width: '未计算', height: '未计算' }; } }
    details.textContent = `${item.photo.originalWidth} × ${item.photo.originalHeight} → ${d.width} × ${d.height} px · ${exportQueue.options.mode === 'original' ? '原像素处理' : '工作尺寸处理'}${d.outputResized ? ' · 最后缩小' : ''}${d.sharpened ? (item.output?' · 受控锐化已应用':' · 将应用受控锐化') : ''}${item.receipt?.filename ? ` · ${item.receipt.filename}` : ''}${item.error ? `\n${item.error}` : ''}${item.receipt?.durabilityWarning ? `\n${item.receipt.durabilityWarning} 已计入成功，不会在重试时重复保存。` : ''}`;
    row.append(title, state, details); list.append(row);
  }
  const s = exportQueue.summary(), active = exportQueue.items.find(item => ['rendering','writing'].includes(item.state));
  setExportProgress(s.success + s.failed, s.total, active ? `${labels[active.state]} ${active.index + 1}/${s.total} · ${active.photo.name}` : exportSummaryText());
  $('retryExport').hidden = exportRunning || !s.retryable; $('retryExport').disabled = exportRunning;
  $('exportQueueMeta').textContent = `本队列已冻结：${s.total} 张${exportBatchGuard ? ` · 本次确认隐藏 ${exportBatchGuard.counts.hidden} / 拒绝 ${exportBatchGuard.counts.rejected}` : ''} · ${exportQueue.options.mode === 'original' ? '原尺寸' : '工作尺寸'} · ${exportQueue.options.format.toUpperCase()} · 重试使用创建时的参数，不重复成功项。`;
}
async function renderExportItem(item, signal) {
  assertBatchScope(exportBatchGuard);
  const p = item.photo, { mode, format, quality, outputSize } = exportQueue.options, limit = exportLimit(p, mode);
  if (limit) throw new Error(limit);
  const dimensions=exportDimensions(p,mode),finalDimensions=exportFinalDimensions(p,mode,outputSize);
  let decoded = null, facts = null, low = null, bytes = null;
  const cancelled = () => { if (signal.aborted) { const e = new Error('已取消'); e.name = 'AbortError'; throw e; } };
  const requiredFaces = ['smooth','brighten','warmth','slim','eyes','nose','jaw','underEye','redness','lip','blush'].some(k => Number(p.settings[k] || 0) !== 0);
  const requiredMask = p.settings.bgMode !== 'original' && !p.settings.learnedMatteId;
  try {
    cancelled();
    if (requiredFaces || requiredMask) {
      if (modelState !== 'ready') throw new Error('所需本地人像定位/分割模型未就绪；未跳过效果，请等待模型或关闭相应调整');
      low = await Pipeline.decodeImage(p.blob, 1280); cancelled(); facts = await Pipeline.analyze(low.canvas); low = null; cancelled();
      if (requiredFaces && (!facts?.faceCount || !facts?.landmarks?.length)) throw new Error('未检测到所需人脸；未跳过已设置的人像效果');
      if (requiredMask && !facts?.mask) throw new Error('未获得所需人物蒙版；未跳过已设置的背景效果');
    }
    facts = factsForPhoto(p, facts, { width: dimensions.processingWidth, height: dimensions.processingHeight }, p.settings);
    facts = { ...(facts || {}), sourceRevision: sourceRevisionOf(p), originalSize: { width: p.originalWidth, height: p.originalHeight } };
    if (bridge?.renderExport) {
      const requestId = crypto.randomUUID();
      const cancel = () => { Promise.resolve(bridge.cancelExportRender?.(requestId)).catch(() => {}); };
      bytes = new Uint8Array(await p.blob.arrayBuffer()); cancelled();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        let textOverlay=null;
        if(textActive(p.settings)){
          const key=textRasterKey(p,p.settings.textLayers,dimensions.width,dimensions.height,mode),prepared=textRasterCache?.blob===p.blob&&textRasterCache.key===key?textRasterCache.raster:null;
          const reuse=prepared?{preparedRaster:prepared,preparedRecipeHash:await textRenderer().hashBytes(new TextEncoder().encode(window.MintTextLayers.canonicalRecipe(p.settings.textLayers)),{signal,isCurrent:()=>!signal.aborted})}:{};cancelled();
          textOverlay=await textRenderer().envelope({requestId,sourceRevision:sourceRevisionOf(p),sourceBytes:bytes,layers:p.settings.textLayers,width:dimensions.width,height:dimensions.height,mode,signal,isCurrent:()=>!signal.aborted,...reuse});cancelled();
        }
        let paintOverlay=null;
        if(paintActive(p.settings)){
          const key=paintRasterKey(p,p.settings.paintLayers,dimensions.width,dimensions.height,mode),prepared=paintRasterCache?.blob===p.blob&&paintRasterCache.key===key?paintRasterCache.raster:null;
          const reuse=prepared?{preparedRaster:prepared,preparedRecipeHash:await paintRenderer().hashBytes(new TextEncoder().encode(paintCore().canonicalRecipe(p.settings.paintLayers)),{signal,isCurrent:()=>!signal.aborted})}:{};cancelled();
          paintOverlay=await paintRenderer().envelope({requestId,sourceRevision:sourceRevisionOf(p),sourceBytes:bytes,layers:p.settings.paintLayers,context:paintContext(p,p.settings,{width:dimensions.processingWidth,height:dimensions.processingHeight}),width:dimensions.width,height:dimensions.height,mode,signal,isCurrent:()=>!signal.aborted,...reuse});cancelled();
        }
        const result = await bridge.renderExport({ requestId, bytes, imageAssets:imageAssetsFor(p,p.settings), ...(textOverlay?{textOverlay}:{}), ...(paintOverlay?{paintOverlay}:{}), ...(outputSize?.mode==='long-edge'?{outputSize}:{}), sourceRevision: sourceRevisionOf(p), settings: p.settings, analysis: facts, mode, format, quality });
        if (result?.width !== finalDimensions.width || result?.height !== finalDimensions.height || result?.originalWidth !== p.originalWidth || result?.originalHeight !== p.originalHeight || result?.processingWidth !== dimensions.processingWidth || result?.processingHeight !== dimensions.processingHeight || result?.scaled !== dimensions.scaled || result?.framed !== dimensions.framed) throw new Error('本地输出尺寸与队列声明不匹配；未保存文件，也没有接受缩小输出');
        if(dimensions.straightened ? result?.straightened!==true || JSON.stringify(result.straightenRecipe)!==JSON.stringify(dimensions.straightenRecipe) || result.straightenedWidth!==dimensions.straightenedWidth || result.straightenedHeight!==dimensions.straightenedHeight : ['straightened','straightenRecipe','straightenedWidth','straightenedHeight'].some(key=>Object.prototype.hasOwnProperty.call(result||{},key)))throw new Error('本地调平状态与队列声明不匹配；未保存文件');
        if(dimensions.sharpened ? result?.sharpened!==true || JSON.stringify(result.sharpnessRecipe)!==JSON.stringify(dimensions.sharpnessRecipe) || result.details?.sharpness!=='classical-coverage-normalized-luminance-unsharp-detail' || JSON.stringify(result.details.sharpnessRecipe)!==JSON.stringify(dimensions.sharpnessRecipe) : ['sharpened','sharpnessRecipe'].some(key=>Object.prototype.hasOwnProperty.call(result||{},key)) || ['sharpness','sharpnessRecipe'].some(key=>Object.prototype.hasOwnProperty.call(result?.details||{},key)))throw new Error('本地锐化状态与队列声明不匹配；未保存文件');
        requirePerspectiveReceipt(dimensions.perspectiveReceipt||null,result,true);
        if(dimensions.imageLayered ? result?.imageLayered!==true || result.imageLayerKey!==dimensions.imageLayerKey || result.details?.imageOverlay!=='premultiplied-srgb-mip-bilinear-edge4x4' || result.details.imageLayerKey!==dimensions.imageLayerKey : ['imageLayered','imageLayerKey'].some(k=>Object.hasOwn(result||{},k)) || ['imageOverlay','imageLayerKey'].some(k=>Object.hasOwn(result?.details||{},k)))throw new Error('本地贴图状态与冻结配方不匹配，未保存文件');
        if(outputSize?.mode==='long-edge'&&(result.compositionWidth!==dimensions.width||result.compositionHeight!==dimensions.height||result.outputSizePlan?.resized!==finalDimensions.outputResized))throw new Error('最后缩放的合成尺寸或执行状态与队列不匹配；未保存文件');
        return {...result,outputResized:finalDimensions.outputResized===true};
      }
      finally { signal.removeEventListener('abort', cancel); bytes = null; }
    }
    decoded = Pipeline.decodeExportImage ? await Pipeline.decodeExportImage(p.blob, { mode, signal }) : mode === 'original' && Pipeline.decodeOriginalImage ? await Pipeline.decodeOriginalImage(p.blob, { signal }) : await Pipeline.decodeImage(p.blob, mode === 'original' ? 16384 : 4096, { signal });
    cancelled();
    if (decoded.originalWidth !== p.originalWidth || decoded.originalHeight !== p.originalHeight || (mode === 'original' && (decoded.scaled || decoded.canvas.width !== p.originalWidth || decoded.canvas.height !== p.originalHeight))) throw new Error('原图或输出尺寸不匹配；已停止，没有缩小或回退');
    if (mode === 'working' && (decoded.canvas.width !== dimensions.processingWidth || decoded.canvas.height !== dimensions.processingHeight)) throw new Error('工作尺寸与预告尺寸不匹配，未保存文件');
    let canvas = await Pipeline.render(decoded.canvas, p.settings, facts, { signal, deferTextLayers:true, deferPaintLayers:true, deferRedactions:true, imageAssets:imageAssetsFor(p,p.settings), ...((straightenActive(p.settings)||perspectiveActive(p.settings)||sharpnessActive(p.settings)||imageActive(p.settings))?{retainedBytes:straightenRetainedBytes(decoded.canvas,p)}:{}) }); cancelled();
    requirePerspectiveReceipt(dimensions.perspectiveReceipt||null,canvas);
    if(textActive(p.settings)){const overlay=await prepareTextRaster(p,p.settings,mode,signal,()=>!signal.aborted);canvas=await textRenderer().compositePreview(canvas,overlay,{signal,isCurrent:()=>!signal.aborted});cancelled();}
    if(paintActive(p.settings)){const overlay=await preparePaintRaster(p,p.settings,mode,signal,()=>!signal.aborted);canvas=await paintRenderer().compositePreview(canvas,overlay,{signal,isCurrent:()=>!signal.aborted});cancelled();}
    canvas=applyRedactionCanvas(canvas,p,p.settings,{width:decoded.canvas.width,height:decoded.canvas.height},signal);cancelled();
    if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) throw new Error('最终构图尺寸与预告不匹配，未保存文件');
    if(outputSize?.mode==='long-edge'){if(!window.MintExportResize)throw new Error('最终尺寸组件不可用，未保存文件');canvas=window.MintExportResize.applyCanvas(canvas,outputSize,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},{signal});cancelled();}
    if(canvas.width!==finalDimensions.width||canvas.height!==finalDimensions.height)throw new Error('最终文件尺寸不匹配，未保存文件');
    bytes = await Pipeline.encode(canvas, format, quality); cancelled();
    const details=dimensions.straightened?{straighten:p.settings.straighten.angle%90===0?'exact-quarter-turn-byte-copy':'linear-light-premultiplied-alpha-bilinear',straightenRecipe:clone(p.settings.straighten),resampling:[dimensions.scaled?'canvas-working-source':null,p.settings.straighten.angle%90!==0?'straighten-linear-light-premultiplied-alpha-bilinear':null,finalDimensions.outputResized?'canvas-high-quality-final':null].filter(Boolean).join('+')||'none'}:null;
    const sharpDetails=dimensions.sharpened?{sharpness:'classical-coverage-normalized-luminance-unsharp-detail',sharpnessRecipe:clone(p.settings.sharpness)}:null;
    const imageDetails=dimensions.imageLayered?{imageOverlay:'premultiplied-srgb-mip-bilinear-edge4x4',imageLayerKey:dimensions.imageLayerKey}:null;
    const perspectiveDetails=dimensions.perspectiveReceipt?{perspectiveReceipt:dimensions.perspectiveReceipt,perspective:dimensions.perspectiveReceipt.kind==='resample'?dimensions.perspectiveReceipt.resampling:'exact-byte-copy',resampling:[dimensions.scaled?'canvas-working-source':null,dimensions.straightened&&p.settings.straighten.angle%90!==0?'straighten-linear-light-premultiplied-alpha-bilinear':null,dimensions.perspectiveReceipt.kind==='resample'?'perspective-'+dimensions.perspectiveReceipt.resampling:null,finalDimensions.outputResized?'canvas-high-quality-final':null].filter(Boolean).join('+')||'none'}:null;
    return { bytes, ...finalDimensions, ...(details||sharpDetails||imageDetails||perspectiveDetails?{details:{...details,...sharpDetails,...imageDetails,...perspectiveDetails}}:{}) };
  } finally { low = null; decoded = null; facts = null; bytes = null; activeMattePreview = null; activeCorrectedMatte = null; }
}
async function writeExportItem(item, output) {
  assertBatchScope(exportBatchGuard);
  const { format } = exportQueue.options, name = fileName(item.photo.name, format, item.index);
  if (exportFolder) {
    const receipt = await bridge.writeExport({ folderToken: exportFolder.token, name, bytes: output.bytes });
    const p = photos.find(p => p.id === item.photo.id && sourceRevisionOf(p) === item.photo.sourceRevision);
    if (p) p.exportedSettings = JSON.stringify(item.photo.settings);
    return receipt || { filename: name };
  }
  const url = URL.createObjectURL(new Blob([output.bytes], { type: format === 'png' ? 'image/png' : 'image/jpeg' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { downloaded: true, filename: name };
}
async function startExport(event, retry = false) {
  if(pageDisposed)return;
  cancelCropDraft();
  event?.preventDefault(); if (locked() || analyzingPhoto || backendJob) return;
  finishRedactionStroke(false); finishPaintStroke(false); finishManualStroke(false); finishMatteStroke(false); historyCommit(current());
  if (!window.MintExportQueue?.ExportQueue) { toast('导出队列组件不可用，未开始导出。', true); return; }
  if (!retry) {
    const targets = exportList(); if (!targets.length) { toast('请先选择至少一张照片。', true); return; }
    const approved = approveBatchScope(targets, '导出照片副本'); if (!approved) return;
    let outputSize;try{outputSize=exportOutputRecipe();}catch(error){toast(String(error.message||error),true);return;}
    exportBatchGuard = approved;
    exportQueue = new window.MintExportQueue.ExportQueue(targets, { mode: exportMode(), format: $('exportFormat').value, quality: Number($('exportQuality').value) / 100, outputSize }); exportFolder = null;
  } else {
    if (!exportQueue?.summary().retryable) return;
    const pending = exportQueue.items.filter(item => !['saved','downloaded'].includes(item.state)), targets = pending.map(item => photos.find(p => p.id === item.photo.id && p.blob === item.photo.blob && sourceRevisionOf(p) === item.photo.sourceRevision));
    if (targets.some(p => !p)) { toast('重试范围中的照片已改变或移除，未重试。请重新创建导出队列。', true); return; }
    const approved = approveBatchScope(targets, '重试原队列照片副本'); if (!approved) return;
    exportBatchGuard = approved;
  }
  exportRunning = true; exportCancelled = false; renderController?.abort(); clearTimeout(renderTimer); renderingPhoto = false;
  updateAvailability(); updateBusy();
  $('closeExport').disabled = true; for (const id of ['exportScope','exportFormat','exportMode','exportOutputMode','exportLongEdge','exportQuality','startExport','retryExport']) $(id).disabled = true;
  $('cancelExport').textContent = '停止导出'; $('exportProgress').hidden = false; updateExportQueue();
  try {
    if (bridge?.writeExport && !exportFolder) {
      if (!bridge.chooseExportFolder) throw new Error('保存文件夹选择器不可用');
      exportFolder = await bridge.chooseExportFolder();
      if (!exportFolder || exportCancelled) { exportQueue.cancel(); await exportQueue.run({ render: renderExportItem, write: writeExportItem, onChange: updateExportQueue }); return; }
    }
    assertBatchScope(exportBatchGuard);
    $('exportDestination').textContent = exportFolder ? `保存至：${exportFolder.displayPath}` : '浏览器只确认下载已发起，无法验证文件落盘。';
    await exportQueue.run({ render: renderExportItem, write: writeExportItem, onChange: updateExportQueue, retry });
  } catch (error) {
    for (const item of exportQueue.items) if (!['saved','downloaded'].includes(item.state)) { item.state = 'failed'; item.error = String(error.message || error); }
  } finally {
    exportController = null; exportRunning = false; $('closeExport').disabled = false; $('cancelExport').textContent = '关闭';
    for (const id of ['exportScope','exportFormat','exportMode','exportOutputMode','exportLongEdge','exportQuality','startExport','retryExport']) $(id).disabled = false;
    $('exportQuality').disabled = $('exportFormat').value === 'png';if($('exportLongEdge'))$('exportLongEdge').disabled=$('exportOutputMode').value!=='long-edge'; updateExportQueue();
    const message = exportSummaryText(); status(message); toast(message, !!exportQueue.summary().failed || exportQueue.items.some(item => item.receipt?.durabilityWarning));
    updateAvailability(); scheduleRender(0);
  }
}
function cancelExport() {
  if (!exportRunning) { $('exportDialog').close(); return; }
  exportCancelled = true; exportQueue?.cancel(); $('cancelExport').textContent = '正在停止…';
  $('exportProgressText').textContent = '正在停止；正在保存的文件提交完成后计入成功，已保存项不会在重试时重复。';
}
$('exportForm').addEventListener('submit', startExport);
$('retryExport').addEventListener('click', event => startExport(event, true));
$('exportDialog').addEventListener('cancel', event => { if (exportRunning) { event.preventDefault(); cancelExport(); } });
$('cancelExport').addEventListener('click', cancelExport);
$('closeExport').addEventListener('click', () => { if (!exportRunning) $('exportDialog').close(); });
for (const id of ['exportMode','exportScope']) $(id).addEventListener('change',()=>{if(id==='exportMode')finalOutputBasisChanged();else refreshExportPlan();});
$('exportFormat').addEventListener('change', () => { $('exportQuality').disabled = $('exportFormat').value === 'png'; });
$('exportQuality').addEventListener('input', () => { $('exportQualityValue').textContent = `${$('exportQuality').value}%`; rangeStyle($('exportQuality')); });

$('saveProjectBtn').addEventListener('click', saveProject);
$('openProjectBtn').addEventListener('click', openProject);
$('recoveryBtn').addEventListener('click', () => { $('recoveryDialog').showModal(); recoveryController?.refresh(); });
$('closeRecovery').addEventListener('click', () => $('recoveryDialog').close());
$('recoveryEnabled').addEventListener('change', () => recoveryController?.configure({ enabled: $('recoveryEnabled').checked === true, budgetMiB: Number($('recoveryBudget').value) }));
$('recoveryBudget').addEventListener('change', () => recoveryController?.configure({ enabled: recoveryController.getState().enabled, budgetMiB: Number($('recoveryBudget').value) }));
$('recoveryStart').addEventListener('click', () => recoveryController?.beginCycle());
$('recoverySaveNow').addEventListener('click', () => recoveryController?.saveNow());
$('recoveryCancel').addEventListener('click', cancelRecovery);
$('recoveryRefresh').addEventListener('click', () => recoveryController?.refresh());
for (const slot of ['latest', 'previous']) $(`recoveryRestore-${slot}`).addEventListener('click', () => restoreRecovery(slot));
for (const id of ['importBtn','welcomeImport','stripImport']) $(id).addEventListener('click', openImages);
$('fileInput').addEventListener('change', async event => { await importFiles(event.target.files); event.target.value = ''; });
$('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo);
$('resetBtn').addEventListener('click', () => { cancelCropDraft(); finishManualStroke(false); const p = current(); if (!p || !photoAvailable()) return; p.settings = defaults(); p.preset = null; historyCommit(p); updateControls(); scheduleRender(0); status('已恢复原始参数，可撤销'); });
for (const [id, field] of [['reviewRating','rating'],['reviewFlag','flag'],['reviewLabel','label']]) $(id)?.addEventListener('change', event => {
  if (event.target.value !== 'mixed') applyPhotoReview({ [field]: field === 'rating' ? Number(event.target.value) : event.target.value });
});
$('reviewScope')?.addEventListener('change', updateReviewControls);
$('reviewUndo')?.addEventListener('click', () => applyPhotoReview(null, 'undo'));
$('reviewRedo')?.addEventListener('click', () => applyPhotoReview(null, 'redo'));
for (const [id, field] of [['reviewMin','minRating'],['reviewMax','maxRating'],['reviewFilterFlag','flag'],['reviewFilterLabel','label'],['reviewSort','sort']]) $(id)?.addEventListener('change', event => setReviewView({ [field]: ['minRating','maxRating'].includes(field) ? Number(event.target.value) : event.target.value }));
$('reviewHideRejected')?.addEventListener('change', event => setReviewView({ hideRejected: event.target.checked }));
$('resetReviewFilters')?.addEventListener('click', () => { if (reviewCore && !locked()) { reviewView = reviewCore.viewDefaults(); updateCards(); } });
$('selectVisible')?.addEventListener('click', selectVisiblePhotos);
$('reviewPrevious')?.addEventListener('click', () => navigateReview(-1));
$('reviewNext')?.addEventListener('click', () => navigateReview(1));
$('selectAll').addEventListener('change', event => { if (locked()) return; for (const p of photos) p.selected = event.target.checked; updateCards(); });
$('removeBtn').addEventListener('click', removeSelected);
$('exportBtn').addEventListener('click', openExport);
$('copyBtn').addEventListener('click', () => { if (photoAvailable() && photos.length > 1) { historyCommit(current()); $('syncDialog').showModal(); } });
for (const id of ['closeSync','cancelSync']) $(id).addEventListener('click', () => $('syncDialog').close());
$('applySync').addEventListener('click', () => {
  const p = current(); if (!p || !photoAvailable()) return;
  cancelCropDraft();
  const targets = ($('syncScope').value === 'all' ? photos : selected()).filter(other => other.id !== p.id);
  if (!targets.length) { toast('没有其他选中的照片，请选择“其他全部照片”或先勾选照片。', true); return; }
  try { preflightBatchRevisions(targets); } catch (error) { toast(error.message, true); return; }
  if (!approveBatchScope(targets, '同步调整参数')) return;
  let commits;
  try { commits=targets.map(other=>{
    const previous = other.settings, spots = clone(previous.spots), candidate = { ...clone(p.settings), spots };
    if (previous.localLayers) candidate.localLayers = clone(previous.localLayers); else delete candidate.localLayers;
    for (const key of ['faceAdjustments','paintLayers','redactions','framing','straighten','perspective','canvasPadding','textLayers','imageLayers','manualSelection','manualLiquify','manualRepair','learnedMatteId','learnedMatteStrokes','diagnosticParseId','diagnosticOverlay','diagnosticLayer']) { if (key in previous) candidate[key] = previous[key]; else delete candidate[key]; }
    if (previous.redactions||previous.paintLayers) for(const key of ['slim','eyes','nose','jaw']) candidate[key]=previous[key];
    if (previous.manualLiquify?.length) for (const key of ['slim','eyes','nose','jaw','bgMode','bgColor','bgBlur','bgFeather']) candidate[key] = previous[key];
    if(p.settings.faceAdjustments||previous.faceAdjustments)for(const key of peopleKeys)candidate[key]=previous[key];
    if(candidate.faceAdjustments)window.MintPortraitPeopleDesktop.validateCompatibility(candidate,sourceRevisionOf(other));
    if(candidate.paintLayers)paintCore().validate(candidate.paintLayers,paintContext(other,candidate));
    if(candidate.redactions)redactionCore().validate(candidate.redactions,redactionContext(other,candidate));
    const checked=candidate;
    return {other,settings:checked};
  }); }catch(error){toast(`同步未应用任何照片：${error.message||error}`,true);return;}
  for(const {other,settings}of commits){other.settings=settings;other.preset=p.preset;historyCommit(other);}
  $('syncDialog').close(); updateCards(); toast(`参数已同步到 ${targets.length} 张照片（含锐化，导出预算逐张检查）；人物批次/逐人参数、构图、选区、手动笔触、点修、局部图层与学习模型蒙版未跨照片复制。已有手动推拉的照片保留其自动塑形/背景参数，避免坐标冲突。每张照片都可以撤销。`);
});
$('helpBtn').addEventListener('click', () => $('helpDialog').showModal()); $('closeHelp').addEventListener('click', () => $('helpDialog').close());
$('editView').addEventListener('click', () => { setReferenceCompare(false); setCompare(false); }); $('compareView').addEventListener('click', () => setCompare(true));
$('fitBtn').addEventListener('click', fit); $('zoomLabel').addEventListener('click', fit);
$('zoomIn').addEventListener('click', () => zoomBy(1.2)); $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
$('panTool').addEventListener('click', () => setTool('pan')); $('brushTool').addEventListener('click', () => setTool(tool === 'brush' ? 'pan' : 'brush'));
$('healBtn').addEventListener('click', () => setTool(tool === 'brush' ? 'pan' : 'brush'));
$('brushSize').addEventListener('input', () => { brushSize = Number($('brushSize').value); $('brushSizeValue').textContent = `${(brushSize / 10).toFixed(1)}%`; rangeStyle($('brushSize')); });
$('clearSpots').addEventListener('click', () => changeSettings({ spots: [] }));
$('backgroundModes').addEventListener('click', event => { const button = event.target.closest('[data-bg]'); if (button && !button.disabled) changeSettings({ bgMode: button.dataset.bg }); });



for (const [id, name] of Object.entries({ selectionBrushTool: 'selection-brush', selectionLassoTool: 'selection-lasso', liquifyPushTool: 'liquify-push', liquifyRestoreTool: 'liquify-restore', repairHealTool: 'repair-heal', repairCloneTool: 'repair-clone', repairSampleTool: 'repair-sample' })) $(id).addEventListener('click', () => setTool(tool === name ? 'pan' : name));
$('clearRepairSample').addEventListener('click', () => { finishManualStroke(false); repairSample = null; updateManualControls(); drawPreview(); });
$('clearRepair').addEventListener('click', () => { finishManualStroke(false); changeSettings({ manualRepair: [] }); });
$('manualDone').addEventListener('click', () => setTool('pan'));
$('selectionToLayer').addEventListener('click', () => {
  finishManualStroke(false); const p = current(); if (!p || !photoAvailable() || !p.settings.manualSelection || !manualCoreReady()) return;
  if (p.settings.manualLiquify?.length || p.settings.manualRepair?.length) { toast('先建局部调色层，再推形与修复；请先撤销或清除手动笔触，避免范围错位。'); return; }
  const layers = clone(p.settings.localLayers || []); if (layers.length >= 8) return;
  try { const selection = window.MintManualTools.validateSelection(p.settings.manualSelection, { sourceRevision: sourceRevisionOf(p) });
    const layer = { id: crypto.randomUUID(), sourceRevision: sourceRevisionOf(p), name: `选区调整 ${layers.length + 1}`, enabled: true, opacity: 1, mask: { kind: 'selection', selection }, adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 } };
    layers.push(layer); p.localLayerId = layer.id; p.localInspect = false; setTool('pan'); changeSettings({ localLayers: layers }); $('localSection').open = true; status('已建立独立选区调整层 · 调整曝光、对比、饱和或色温 · 可撤销');
  } catch (error) { toast(`未建立图层：${error.message || error}`, true); }
});
$('selectionInvert').addEventListener('click', () => editSelection('invert'));
$('selectionClear').addEventListener('click', () => editSelection('clear'));
$('selectionEmpty').addEventListener('click', () => editSelection('empty'));
$('selectionMode').addEventListener('change', () => finishManualStroke(false));
for (const [id, output] of [['selectionRadius','selectionRadiusValue'],['selectionFeather','selectionFeatherValue'],['liquifyRadius','liquifyRadiusValue'],['liquifyStrength','liquifyStrengthValue'],['repairRadius','repairRadiusValue'],['repairHardness','repairHardnessValue'],['repairStrength','repairStrengthValue']]) $(id).addEventListener('input', () => { finishManualStroke(false); $(output).textContent = `${Number($(id).value).toFixed(['liquifyStrength','repairHardness','repairStrength'].includes(id) ? 0 : 1)}%`; rangeStyle($(id)); });
$('selectionFeather').addEventListener('change', () => editSelection('feather'));
$('clearLiquify').addEventListener('click', () => { if (current()?.settings.manualRepair?.length) { toast('请先撤销或清除修复，再改变推拉形变。'); return; } finishManualStroke(false); changeSettings({ manualLiquify: [] }); });

$('learnedConfigure').addEventListener('click', () => $('backendBtn').click());
$('learnedParseBtn').addEventListener('click', () => runLearnedTask('parse').catch(error => { const p = current(); if (p) { p.learnedError = String(error.message || error); updateBackendControls(); } }));
$('learnedMatteBtn').addEventListener('click', () => runLearnedTask('matting').catch(error => { const p = current(); if (p) { p.learnedError = String(error.message || error); updateBackendControls(); } }));
$('learnedCancel').addEventListener('click', () => cancelBackendJob());
$('learnedFaceSelect').addEventListener('change', event => { if (current()) current().faceChoice = event.target.value === '' ? null : Number(event.target.value); updateBackendControls(); drawPreview(); });
$('learnedFaceBoxes').addEventListener('change', () => { if ($('learnedFaceBoxes').checked) setCompare(false); drawPreview(); });
$('learnedOverlay').addEventListener('change', event => { if (event.target.checked && current()) { current().matteInspect = false; if (tool.startsWith('matte-')) setTool('pan'); } changeSettings({ diagnosticOverlay: event.target.checked }); if (event.target.checked) setCompare(false); drawPreview(); });
$('learnedOverlayKind').addEventListener('change', event => { changeSettings({ diagnosticLayer: event.target.value }); activeDiagnosticOverlay = null; drawPreview(); });
$('learnedMatteEnabled').addEventListener('change', event => {
  const p = current(); if (!p) return;
  finishManualStroke(false); finishMatteStroke(false); const id = event.target.checked ? (p.lastSelectedMatteId || p.latestMatteId) : null;
  if (id && !cachedResult(p, id, 'matting')) { p.learnedError = '原图对应的学习型蒙版缺失，不能启用。'; updateBackendControls(); return; }
  changeSettings({ learnedMatteId: id }); activeMattePreview = null;
});

$('learnedMatteInspect').addEventListener('change', event => { const p = current(); if (!p) return; p.matteInspect = event.target.checked; if (p.matteInspect) setCompare(false); else if (tool.startsWith('matte-')) setTool('pan'); updateBackendControls(); drawPreview(); });
$('learnedRawMatte').addEventListener('change', event => { const p = current(); if (!p) return; finishManualStroke(false); finishMatteStroke(false); p.matteInspectOriginal = event.target.checked; if (event.target.checked && tool.startsWith('matte-')) setTool('pan'); activeMatteInspection = null; drawPreview(); });
$('matteKeepTool').addEventListener('click', () => setTool(tool === 'matte-keep' ? 'pan' : 'matte-keep'));
$('matteRemoveTool').addEventListener('click', () => setTool(tool === 'matte-remove' ? 'pan' : 'matte-remove'));
$('clearMatteStrokes').addEventListener('click', () => { finishManualStroke(false); finishMatteStroke(false); activeCorrectedMatte = null; activeMattePreview = null; activeMatteInspection = null; changeSettings({ learnedMatteStrokes: [] }); drawPreview(); });
for (const [id, suffix] of [['matteRadius',' px'],['matteHardness','%'],['matteOpacity','%']]) $(id).addEventListener('input', () => { $(`${id}Value`).textContent = `${$(id).value}${suffix}`; rangeStyle($(id)); });
// View-only inspector: one bounded getImageData result for one accepted render.
// Never retain previewCanvas, originals, reference snapshots or overlay pixels.
function previewPixelReason(verifyRecipe = false) {
  if (!previewPixelCore || !['boundedSize', 'mapPoint', 'samplePixel'].every(key => typeof previewPixelCore[key] === 'function')) return '像素检查组件不可用。';
  if (!current() || !source) return '请先载入照片。';
  if (locked() || analyzingPhoto || renderingPhoto || renderPending || backendJob) return '等待当前处理预览完成…';
  if (compare || originalHeld || referenceComparisonVisible() || referenceRequested || tool !== 'pan' || sourceViewActive() || currentDisplayMode() !== 'framed' || cropDraft || manualDraft || matteDraft || current().matteInspect || current().localInspect || current().settings.diagnosticOverlay || $('learnedFaceBoxes').checked || (pointer && pointer.kind !== 'pan')) return '仅在普通平移的当前结果视图读取；请退出对比、原图、裁剪或检查视图。';
  if (!freshAcceptedRender(verifyRecipe)) return renderFailure ? '当前处理失败，像素读数不可用。' : '等待与当前配方一致的新处理预览…';
  return '';
}
function writePreviewPixelReadout(text) {
  const output = $('previewPixelReadout');
  if (output && output.textContent !== text) output.textContent = text;
}
function clearPreviewPixelInspector(message = '等待当前处理预览完成…') {
  previewPixelCache = null; previewPixelFailedRender = null; previewPixelPointer = null;
  try { writePreviewPixelReadout(previewPixelEnabled ? message : ''); } catch { /* View-only DOM failure must not block editing. */ }
}
function failPreviewPixelInspector() {
  previewPixelCache = null; previewPixelFailedRender = acceptedRender; previewPixelPointer = null;
  try { writePreviewPixelReadout('无法读取当前预览像素；编辑仍可继续。可关闭后重新开启检查。'); } catch { /* No toast loop. */ }
}
function syncPreviewPixelInspector() {
  try {
    const toggle = $('previewPixelToggle'), detail = $('previewPixelDetails');
    if (!toggle || !detail) return;
    toggle.checked = previewPixelEnabled; detail.hidden = !previewPixelEnabled;
    if (!previewPixelEnabled) { clearPreviewPixelInspector(); return; }
    const reason = previewPixelReason(true);
    if (reason) { clearPreviewPixelInspector(reason); return; }
    const accepted = acceptedRender;
    if (previewPixelFailedRender === accepted) return;
    if (previewPixelCache?.accepted !== accepted) {
      // Release the previous array before allocating, including across photos.
      clearPreviewPixelInspector();
      const size = previewPixelCore.boundedSize(accepted.width, accepted.height);
      if (accepted.canvas.width !== size.width || accepted.canvas.height !== size.height) throw Error('Preview dimensions changed');
      const ctx = accepted.canvas.getContext('2d');
      if (!ctx) throw Error('Preview context unavailable');
      const pixels = ctx.getImageData(0, 0, size.width, size.height, { colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' });
      // Keep only this native array, not a second ImageData/Canvas copy.
      const image = { width: size.width, height: size.height, data: pixels.data };
      previewPixelCore.samplePixel(image, 0, 0); // Validate owned bounded RGBA8 storage.
      if (!previewPixelEnabled || acceptedRender !== accepted || previewPixelReason(true) || accepted.canvas.width !== size.width || accepted.canvas.height !== size.height) { clearPreviewPixelInspector(); return; }
      previewPixelCache = { accepted, image };
    }
    refreshPreviewPixelReadout();
  } catch { failPreviewPixelInspector(); }
}
function rememberPreviewPixelPointer(event) {
  // Event coordinates and DOM rectangles become plain own-data records before
  // crossing the pure-helper boundary. No canvas readback in pointer handlers.
  if (!previewPixelEnabled) return;
  try { previewPixelPointer = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? { x: event.clientX, y: event.clientY } : null; }
  catch { previewPixelPointer = null; }
}
function refreshPreviewPixelReadout() {
  try {
    if (!previewPixelEnabled) return;
    const reason = previewPixelReason(false);
    if (reason) { clearPreviewPixelInspector(reason); return; }
    if (previewPixelFailedRender === acceptedRender) return;
    if (!previewPixelCache || previewPixelCache.accepted !== acceptedRender) { clearPreviewPixelInspector(); return; }
    const hint = `${current().name} · 当前结果 · 将指针移到可见图像内。`;
    if (!previewPixelPointer) { writePreviewPixelReadout(hint); return; }
    const ownRect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const image = previewPixelCache.image;
    const point = previewPixelCore.mapPoint(previewPixelPointer, ownRect($('imageSurface')), ownRect($('viewport')), { width: image.width, height: image.height });
    if (!point) { writePreviewPixelReadout(hint); return; }
    const value = previewPixelCore.samplePixel(image, point.x, point.y);
    const rgb = value.alphaMode === 'transparent' ? 'RGB —（完全透明，不显示隐藏颜色）' : `R ${value.r} · G ${value.g} · B ${value.b}`;
    const alpha = value.alphaMode === 'partial' ? ' · 半透明：RGB 未与棋盘格合成' : '';
    const endpoints = [value.zeroChannels.length ? `${value.zeroChannels.join('/')} = 0` : '', value.fullChannels.length ? `${value.fullChannels.join('/')} = 255` : ''].filter(Boolean).join('；');
    writePreviewPixelReadout(`${current().name} · 当前结果 · x ${value.x} · y ${value.y} · ${rgb} · A ${value.a}${alpha}${endpoints ? ` · 码值端点：${endpoints}` : ''}`);
  } catch { failPreviewPixelInspector(); }
}
$('previewPixelToggle')?.addEventListener('change', event => {
  previewPixelEnabled = event.target.checked === true;
  clearPreviewPixelInspector(); syncPreviewPixelInspector();
});

// Reference view state is deliberately outside photos, project snapshots and history.
// The accepted-render record is a capability for the exact finished bitmap, not a
// display stamp: review revisions are irrelevant, but recipes and identities are not.
function renderRecipeKey(settings) { try { return referenceCore ? referenceCore.recipeKey(settings) : JSON.stringify(settings); } catch { return null; } }
function freshAcceptedRender(verifyRecipe = true) {
  const p = current(), a = acceptedRender;
  if (verifyRecipe && a && a.recipeKey !== null && a.recipeKey !== renderRecipeKey(p?.settings)) { acceptedRender = null; clearPreviewPixelInspector(); return false; }
  return !!a && !!p && !!source && a.photo === p && a.blob === p.blob && a.input === source && a.canvas === rendered &&
    a.sourceRevision === sourceRevisionOf(p) && a.generation === renderVersion && a.viewToken === viewToken &&
    a.mode === 'framed' && currentDisplayMode() === 'framed' && a.displayStamp === currentDisplayStamp() && renderedDisplayStamp === a.displayStamp &&
    a.recipeKey !== null && a.width === rendered.width && a.height === rendered.height &&
    !renderPending && !renderingPhoto && !renderFailure && !renderController?.signal.aborted;
}
function referenceCaptureReason(verifyRecipe = true) {
  if (!referenceCore) return '参考组件不可用。';
  if (!current() || !source) return '请先载入照片。';
  if (locked() || analyzingPhoto || renderingPhoto || renderPending || backendJob) return '请等待读取、分析、处理或其他操作完成。';
  if (pointer || referencePointer || manualDraft || matteDraft || cropDraft) return '请先结束拖动或编辑草稿。';
  if (compare) return '请先退出原图 / 调整后对比，再固定处理参考。';
  if (originalHeld) return '请先松开空格，返回处理预览。';
  if (currentDisplayMode() !== 'framed' || sourceViewActive() || tool !== 'pan' || current()?.matteInspect || current()?.localInspect || current()?.settings.diagnosticOverlay || $('learnedFaceBoxes').checked) return '请先退出手动、点修、蒙版与诊断检查；不会自动改动检查设置。';
  if (!freshAcceptedRender(verifyRecipe)) return renderFailure ? `当前处理失败：${renderFailure}` : '请等待与当前完整配方一致的新处理预览。';
  try { referenceCore.boundedSize(rendered.width, rendered.height); } catch (error) { return error.message; }
  return '';
}
function cancelReferenceGesture() {
  const active = referencePointer; referencePointer = null;
  if (active) {
    active.pane.classList.remove('dragging');
    try { if (active.pane.hasPointerCapture?.(active.id)) active.pane.releasePointerCapture(active.id); } catch { /* Already lost or removed. */ }
  }
}
function clearReference() {
  cancelReferenceGesture();
  const old = referenceSnapshot; referenceSnapshot = null; referenceRequested = false; referenceSuspended = false;
  $('referencePixels')?.replaceChildren(); $('referenceCurrentPixels')?.replaceChildren(); referenceRightCanvas = null;
  referenceCore?.dispose(old); referenceViewState = referenceCore?.fitView() || { u: .5, v: .5, zoom: 1 };
  updateReferenceComparison();
}
function pinReference() {
  cancelStraightenDraft(); cancelSharpnessDraft();
  // Starting a replace cancels comparison navigation, but cannot turn an active
  // pointer into capture permission: assess the busy reason before releasing it.
  const reason = referenceCaptureReason(); cancelReferenceGesture();
  if (reason) { toast(reason, true); updateReferenceComparison(); return false; }
  const accepted = acceptedRender, previous = { snapshot: referenceSnapshot, view: referenceViewState, requested: referenceRequested, suspended: referenceSuspended, compare }; let candidate = null;
  try {
    candidate = referenceCore.capture(rendered, { ...accepted, photoId: accepted.photo.id, name: accepted.photo.name, originalWidth: accepted.photo.originalWidth, originalHeight: accepted.photo.originalHeight, workingWidth: accepted.input.width, workingHeight: accepted.input.height }, () => document.createElement('canvas'), () => acceptedRender === accepted && !referenceCaptureReason());
    if (acceptedRender !== accepted || referenceCaptureReason()) throw new Error('当前预览已改变，旧参考保持不变');
    candidate.canvas.setAttribute('aria-label', '冻结参考像素');
    // The only replacement peak is old + candidate RGBA (<=12.5 MiB); right uses
    // the existing accepted canvas. No original decode or ImageData allocation.
    $('referencePixels').replaceChildren(candidate.canvas);
    referenceSnapshot = candidate;
    referenceViewState = referenceCore.fitView(); referenceRequested = true; referenceSuspended = false;
    compare = false; updateReferenceComparison(); drawPreview();
    // Revalidate after the mount too, immediately before the replacement commit.
    if (acceptedRender !== accepted || referenceCaptureReason()) throw new Error('挂载期间预览已改变，旧参考保持不变');
    // Commit only after all fallible mount, label and draw work succeeded.
    referenceCore.dispose(previous.snapshot); candidate = null; return true;
  } catch (error) {
    referenceSnapshot = previous.snapshot; referenceViewState = previous.view; referenceRequested = previous.requested; referenceSuspended = previous.suspended; compare = previous.compare;
    try { $('referencePixels').replaceChildren(...(previous.snapshot ? [previous.snapshot.canvas] : [])); } catch { /* Retain the old bitmap even if the DOM is unavailable. */ }
    referenceCore?.dispose(candidate);
    try { updateReferenceComparison(); } catch { /* Preserve reference state for a later redraw. */ }
    toast(`固定参考失败：${error.message || error}。已有参考未改变。`, true); return false;
  }
}
function setReferenceCompare(value) {
  cancelStraightenDraft(); cancelSharpnessDraft();
  finishRedactionStroke(false); finishPaintStroke(false); if(value&&(redactionToolActive()||paintToolActive()))setTool('pan');
  cancelReferenceGesture();
  if (value && !referenceSnapshot) { toast('请先固定一个已完成的处理预览。'); return; }
  if(value && tool==='white-balance')setTool('pan');
  referenceRequested = !!value; if (value) compare = false;
  updateReferenceComparison(); drawPreview();
}
function referenceComparisonVisible() { return !!referenceCore && !!referenceSnapshot && referenceRequested && !referenceSuspended; }
function referencePaneInfo(pane) {
  const left = pane.id === 'referencePane', canvas = left ? referenceSnapshot?.canvas : referenceRightCanvas;
  const host = $(left ? 'referencePixels' : 'referenceCurrentPixels'), rect = host.getBoundingClientRect();
  return { canvas, host, rect, image: { width: canvas?.width || 0, height: canvas?.height || 0 }, pane: { width: rect.width, height: rect.height } };
}
function positionReferencePanes() {
  if (!referenceComparisonVisible()) return;
  for (const id of ['referencePane','referenceCurrentPane']) {
    const info = referencePaneInfo($(id)); if (!info.canvas) continue;
    const l = referenceCore.layout(referenceViewState, info.image, info.pane);
    info.canvas.style.width = `${l.width}px`; info.canvas.style.height = `${l.height}px`; info.canvas.style.left = `${l.left}px`; info.canvas.style.top = `${l.top}px`;
  }
  $('referenceZoom').textContent = `适合 ×${referenceViewState.zoom.toFixed(2)}`;
  $('zoomLabel').textContent = `适合 ×${referenceViewState.zoom.toFixed(2)}`;
  $('zoomLabel').title = '参考对比：相对两侧各自适合画布的倍率，不是原图像素比例';
}
function fitReference() { cancelReferenceGesture(); if (!referenceCore) return; referenceViewState = referenceCore.fitView(); positionReferencePanes(); }
function zoomReference(factor, pane = $('referenceCurrentPane'), center) {
  if (!referenceComparisonVisible() || locked() || backendJob) return;
  cancelReferenceGesture(); let info = referencePaneInfo(pane);
  if (!info.canvas) info = referencePaneInfo($('referencePane'));
  if (!info.canvas) return;
  referenceViewState = referenceCore.zoomAt(referenceViewState, factor, center ? { x: center.x - info.rect.left, y: center.y - info.rect.top } : null, info.image, info.pane);
  positionReferencePanes();
}
function updateReferenceComparison() {
  if (!$('referenceView')) { syncPreviewPixelInspector(); return; }
  const unsafe = !!cropDraft || currentDisplayMode() !== 'framed' || tool !== 'pan' || !!current()?.localInspect || !!current()?.matteInspect || !!current()?.settings.diagnosticOverlay || !!$('learnedFaceBoxes').checked;
  const resume = referenceRequested && referenceSnapshot && referenceSuspended && !unsafe;
  referenceSuspended = unsafe;
  if (unsafe) cancelReferenceGesture();
  if (resume && source) scheduleRender(0); // A source-coordinate/crop inspection must finish a new framed render.
  const visible = referenceComparisonVisible(), reason = referenceCaptureReason(false);
  $('referenceCompare').hidden = !visible; $('viewport').classList.toggle('reference-active', visible);
  $('pinReference').hidden = !!referenceSnapshot; $('pinReference').disabled = !!reason; $('pinReference').title = reason || '仅固定当前已完成的处理预览';
  $('replaceReference').hidden = !referenceSnapshot; $('replaceReference').disabled = !!reason; $('replaceReference').title = reason || '替换当前冻结参考';
  $('clearReference').disabled = !referenceSnapshot; $('referenceView').disabled = !referenceSnapshot;
  $('referenceView').classList.toggle('active', referenceRequested); $('referenceView').setAttribute('aria-pressed', String(referenceRequested));
  $('editView').classList.toggle('active', !compare && !referenceRequested); $('editView').setAttribute('aria-pressed', String(!compare && !referenceRequested));
  $('compareView').classList.toggle('active', compare); $('compareView').setAttribute('aria-pressed', String(compare));
  $('referenceStatus').textContent = referenceRequested && unsafe ? '参考对比已暂停：退出当前编辑 / 检查后，等待新的完整构图预览；冻结参考保留。' : referenceSnapshot ? '参考只在本次会话保留，不会自动刷新；不是第二张照片实时处理。' : '仅本次会话；参考不会自动刷新，不是第二张照片实时处理。';
  $('referenceMetadata').textContent = referenceSnapshot ? `${referenceSnapshot.name} · ${new Date(referenceSnapshot.capturedAt).toLocaleTimeString()} · ${referenceSnapshot.width} × ${referenceSnapshot.height} 预览像素` : '';
  $('referenceMetadata').title = referenceSnapshot ? `${referenceSnapshot.name} · ${referenceSnapshot.capturedAt} · ${referenceSnapshot.width} × ${referenceSnapshot.height} 预览像素` : '';
  $('referenceCurrentName').textContent = current()?.name || '尚未选择照片';
  let next = null, message = '';
  if (visible) {
    if (loadingPhoto) message = '正在读取当前照片…';
    else if (renderFailure) message = `当前预览失败：${renderFailure}。请重试或撤销。`;
    else if (!source) message = '当前照片未就绪，未显示旧照片。';
    else if (locked() || backendJob || analyzingPhoto || renderingPhoto || renderPending) message = '当前照片正在处理，请稍候…';
    else if (!freshAcceptedRender(false)) message = '等待当前完整配方的新处理预览…';
    else { try { next = originalHeld ? originalForView() : rendered; } catch (error) { message = `当前原图预览失败：${error.message || error}`; } }
  }
  if (referenceRightCanvas !== next) { cancelReferenceGesture(); $('referenceCurrentPixels').replaceChildren(...(next ? [next] : [])); referenceRightCanvas = next; }
  $('referenceCurrentStatus').textContent = message; $('referenceCurrentStatus').hidden = !message;
  $('referenceCurrentName').textContent += visible && originalHeld && next ? ' · 原图（松开空格返回）' : '';
  if (visible) { $('brushCursor').hidden = true; positionReferencePanes(); }
  syncPreviewPixelInspector();
}

$('pinReference').addEventListener('click', pinReference);
$('replaceReference').addEventListener('click', pinReference);
$('clearReference').addEventListener('click', clearReference);
$('referenceView').addEventListener('click', () => setReferenceCompare(!referenceRequested));
$('referenceFit').addEventListener('click', fitReference);
for (const id of ['referencePane','referenceCurrentPane']) {
  const pane = $(id);
  pane.addEventListener('wheel', event => {
    if (!referenceComparisonVisible()) return;
    event.preventDefault(); event.stopPropagation();
    zoomReference(Math.exp(-Math.max(-1000, Math.min(1000, Number.isFinite(event.deltaY) ? event.deltaY : 0)) * .0015), pane, { x: event.clientX, y: event.clientY });
  }, { passive: false });
  pane.addEventListener('pointerdown', event => {
    event.stopPropagation();
    if (referencePointer) { cancelReferenceGesture(); return; }
    if (!referenceComparisonVisible() || locked() || backendJob || event.button !== 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const info = referencePaneInfo(pane);
    if (!info.canvas || !referenceCore.layout(referenceViewState, info.image, info.pane).valid) return;
    pane.focus({ preventScroll: true }); event.preventDefault();
    referencePointer = { id: event.pointerId, pane, x: event.clientX, y: event.clientY, view: { ...referenceViewState }, image: info.image, size: info.pane };
    try { pane.setPointerCapture(event.pointerId); pane.classList.add('dragging'); } catch { cancelReferenceGesture(); }
  });
  pane.addEventListener('pointermove', event => {
    if (!referencePointer) return;
    event.stopPropagation();
    if (referencePointer.id !== event.pointerId || referencePointer.pane !== pane || !referenceComparisonVisible() || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) { cancelReferenceGesture(); return; }
    referenceViewState = referenceCore.pan(referencePointer.view, { x: event.clientX - referencePointer.x, y: event.clientY - referencePointer.y }, referencePointer.image, referencePointer.size);
    positionReferencePanes();
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) pane.addEventListener(name, event => { event.stopPropagation(); cancelReferenceGesture(); });
  new ResizeObserver(() => { cancelReferenceGesture(); positionReferencePanes(); }).observe(pane);
}
const viewport = $('viewport');
// Losing capture is not the same as lifting a finger. Track actual releases
// even outside the viewport after a multi-pointer gesture cancels drawing.
for(const name of ['pointerup','pointercancel'])window.addEventListener(name,event=>redactionPointers.delete(event.pointerId),true);
viewport.addEventListener('wheel', event => { if (referenceComparisonVisible() || !photoAvailable()) return; event.preventDefault(); rememberPreviewPixelPointer(event); zoomBy(Math.exp(-event.deltaY * .0015), { x: event.clientX, y: event.clientY }); }, { passive: false });
viewport.addEventListener('pointerdown', event => {
  if(redactionToolActive() || paintToolActive() || redactionPointers.size) { redactionPointers.add(event.pointerId); if(redactionPointers.size>1) {finishRedactionStroke(false); finishPaintStroke(false);return;} }
  if (pointer?.kind==='white-balance' && event.pointerId!==pointer.id) { cancelWhiteBalancePointer(); return; }
  if (referenceComparisonVisible() || !photoAvailable() || event.button !== 0 || pointer) return;
  viewport.focus({ preventScroll: true });
  if(imagePanel?.placing){
    if(originalHeld||!event.target.closest('#imageSurface'))return;const rect=$('imageSurface').getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;const token=imagePanel.placementToken();
    if(token&&Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1){pointer={id:event.pointerId,kind:'image-position',x,y,token};viewport.setPointerCapture(event.pointerId);event.preventDefault();}return;
  }
  if(textPlacing){
    if(!textEditable()||!textDraftCurrent()||originalHeld||!event.target.closest('#imageSurface'))return;
    const rect=$('imageSurface').getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
    if(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1){pointer={id:event.pointerId,kind:'text-position',x,y,draft:textDraft};viewport.setPointerCapture(event.pointerId);event.preventDefault();}return;
  }
  if(perspectiveDraft){beginPerspectivePoint(event);return;}
  if (tool === 'white-balance') { beginWhiteBalancePoint(event); return; }
  if(paintToolActive()){ if(event.target.closest('#imageSurface'))beginPaintStroke(event); return; }
  if(redactionToolActive()){ if(event.target.closest('#imageSurface'))beginRedactionStroke(event); return; }
  if (cropDraft) { if (event.target.closest('#imageSurface')) beginCropDrag(event); return; }
  if (manualToolActive()) { if (event.target.closest('#imageSurface')) beginManualStroke(event); return; }
  if (event.target.closest('#compareDivider')) { pointer = { id: event.pointerId, kind: 'compare' }; viewport.setPointerCapture(event.pointerId); event.preventDefault(); return; }
  if ((tool === 'matte-keep' || tool === 'matte-remove') && event.target.closest('#imageSurface')) { beginMatteStroke(event); return; }
  if (tool === 'brush' && !originalHeld && event.target.closest('#imageSurface')) {
    if (current()?.settings.manualLiquify?.length) { toast('已有手动推拉，请改用“手动修复/克隆”；未添加旧版点修。'); setTool('pan'); return; }
    if (!sourceWorkingViewReady()) { status('正在准备完整原图坐标视图，请稍候再点修'); return; }
    if (diagnosticViewActive() || current()?.localInspect) { toast('请关闭局部图层范围、诊断蒙版与人脸编号后进行点修。'); return; }
    const rect = $('imageSurface').getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    if (compare && x < split) { toast('请在“调整后”一侧点修，或切换到编辑视图。'); return; }
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      const p = current(); if (p.settings.spots.length >= 64) { toast('最多支持 64 个点修位置，可撤销或清除点修。', true); return; }
      changeSettings({ spots: [...p.settings.spots, { x, y, r: brushSize / 1000 }] });
    }
    return;
  }
  pointer = { id: event.pointerId, kind: 'pan', x: event.clientX, y: event.clientY, panX, panY };
  viewport.setPointerCapture(event.pointerId); viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', event => {
  rememberPreviewPixelPointer(event);
  if (pointer?.id === event.pointerId) {
    if (pointer.kind === 'white-balance') { if (Math.hypot(event.clientX-pointer.clientX,event.clientY-pointer.clientY)>6) pointer.cancelled=true; }
    else if (pointer.kind === 'perspective') { appendPerspectivePoint(event); }
    else if (pointer.kind === 'paint') { appendPaintStroke(event); }
    else if (pointer.kind === 'redaction') { appendRedactionStroke(event); }
    else if (pointer.kind === 'crop') { appendCropDrag(event); }
    else if (pointer.kind === 'manual') { appendManualStroke(event); }
    else if (pointer.kind === 'matte') { appendMatteStroke(event); }
    else if (pointer.kind === 'compare') { const rect = $('imageSurface').getBoundingClientRect(); split = Math.max(.02, Math.min(.98, (event.clientX - rect.left) / rect.width)); drawPreview(); }
    else { panX = pointer.panX + event.clientX - pointer.x; panY = pointer.panY + event.clientY - pointer.y; fitMode = false; positionSurface(); }
  }
  refreshPreviewPixelReadout();
  if ((tool === 'brush' || tool === 'matte-keep' || tool === 'matte-remove' || manualToolActive()) && photoAvailable() && !originalHeld && !pointer) {
    const rect = $('imageSurface').getBoundingClientRect(), stage = viewport.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    $('brushCursor').hidden = !inside;
    if (inside) { const diameter = manualToolActive() ? 2 * Number($(tool.startsWith('selection-') ? 'selectionRadius' : tool.startsWith('repair-') ? 'repairRadius' : 'liquifyRadius').value) / 100 * Math.min(source.width, source.height) * zoom : tool.startsWith('matte-') ? 2 * Number($('matteRadius').value) / current().originalWidth * source.width * zoom : 2 * brushSize / 1000 * Math.min(source.width, source.height) * zoom; $('brushCursor').style.width = `${diameter}px`; $('brushCursor').style.height = `${diameter}px`; $('brushCursor').style.left = `${event.clientX - stage.left}px`; $('brushCursor').style.top = `${event.clientY - stage.top}px`; }
  }
});
function endPointer(event) { if(pointer?.kind==='perspective'&&event.pointerId===pointer.id){if(event.type==='pointerup')appendPerspectivePoint(event);cancelPerspectivePointer(event.type==='pointerup');updatePerspectiveControls();drawPreview();return;} if(pointer?.kind==='image-position'&&event.pointerId===pointer.id){const point=pointer;pointer=null;if(event.type==='pointerup')imagePanel?.place(point.x,point.y,point.token);else imagePanel?.cancelPlacement();return;} if(event.type!=='lostpointercapture')redactionPointers.delete(event.pointerId); if(['paint','paint-pick'].includes(pointer?.kind)&&event.pointerId===pointer.id){if(event.type==='pointerup'&&pointer.kind==='paint')appendPaintStroke(event,true);finishPaintStroke(event.type==='pointerup',event);return;} if(pointer?.kind==='redaction'&&event.pointerId===pointer.id){if(event.type==='pointerup')appendRedactionStroke(event,true);finishRedactionStroke(event.type==='pointerup');return;} if(pointer?.kind==='white-balance'&&event.pointerId===pointer.id){finishWhiteBalancePoint(event);return;} if(pointer?.kind==='text-position'&&event.pointerId===pointer.id){const point=pointer;pointer=null;if(event.type==='pointerup'&&textDraftCurrent()&&point.draft===textDraft&&textEditable()){ $('textX').value=String(point.x*100);$('textY').value=String(point.y*100); }cancelTextPlacement();updateTextControls();return;} if (event.type !== 'pointerup') { previewPixelPointer = null; refreshPreviewPixelReadout(); } if (pointer?.kind === 'crop' && event.pointerId === pointer.id) { if (event.type === 'pointerup') { appendCropDrag(event); const id = pointer.id; pointer = null; if (viewport.hasPointerCapture?.(id)) viewport.releasePointerCapture(id); updateFramingControls(); } else cancelCropDraft(); return; } if (!pointer || event.pointerId === pointer.id) { if (pointer?.kind === 'manual') { if (event.type === 'pointerup') appendManualStroke(event, true); finishManualStroke(event.type === 'pointerup'); } if (pointer?.kind === 'matte') { if (event.type === 'pointerup') appendMatteStroke(event); finishMatteStroke(event.type === 'pointerup'); } pointer = null; viewport.classList.remove('dragging'); } }
viewport.addEventListener('pointerup', endPointer); viewport.addEventListener('pointercancel', endPointer); viewport.addEventListener('lostpointercapture', endPointer); viewport.addEventListener('pointerleave', () => { $('brushCursor').hidden = true; previewPixelPointer = null; refreshPreviewPixelReadout(); });
window.addEventListener('dragenter', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth++; if (!locked()) $('dropOverlay').hidden = false; });
window.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = locked() ? 'none' : 'copy'; });
window.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true; if (!locked()) importFiles(event.dataTransfer.files); });
function isTyping(target) { return target instanceof HTMLElement && (target.matches('input,select,textarea') || target.isContentEditable); }
window.addEventListener('keydown', event => { if(event.key==='Escape'&&imagePanel?.placing){event.preventDefault();if(pointer?.kind==='image-position'){const id=pointer.id;pointer=null;try{viewport.releasePointerCapture(id);}catch{}}imagePanel.cancelPlacement();return;} if(event.key==='Escape'&&textPlacing){event.preventDefault();cancelTextPlacement();updateTextControls();return;}
  if (event.key === 'Escape') { cancelPeopleDetection(); cancelReferenceGesture(); cancelNamedPresetApplication(); cancelCropDraft(); finishRedactionStroke(false); finishPaintStroke(false); finishManualStroke(false); finishMatteStroke(false); originalHeld = false; drawPreview(); if (!$('exportDialog').open && !$('syncDialog').open && !$('helpDialog').open && !$('backendDialog').open && !$('recoveryDialog').open) setTool('pan'); return; }
  if ($('exportDialog').open || $('syncDialog').open || $('helpDialog').open || $('backendDialog').open || $('recoveryDialog').open || event.isComposing) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
  if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); event.shiftKey ? openProject() : openImages(); return; }
  if (isTyping(event.target)) return;
  if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); openExport(); return; }
  if (!photoAvailable()) return;
  if (!mod && !event.altKey && !event.shiftKey && !event.repeat && !event.isComposing && !reviewBusy() && reviewCore) {
    const key = event.key.toLowerCase();
    if (/^[0-5]$/.test(key) || ['p','u','x'].includes(key)) { event.preventDefault(); applyPhotoReview(/^[0-5]$/.test(key) ? { rating: Number(key) } : { flag: ({ p: 'pick', u: 'none', x: 'reject' })[key] }, '', 'current'); return; }
    if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); navigateReview(key === 'arrowright' ? 1 : -1); return; }
  }
  if (event.code === 'Space') { event.preventDefault();if(perspectiveDraft){status('四角输入视图不显示原图对比；请先应用或取消草稿。');return;} cancelWhiteBalancePointer(); if (!originalHeld) { if((straightenActive()||perspectiveActive())&&!sourceViewActive()&&!originalForView()){status('同构图原图仍在准备，未显示错位对比。');return;} cancelCropDraft(); finishRedactionStroke(false); finishPaintStroke(false); finishManualStroke(false); finishMatteStroke(false); originalHeld = true; $('brushCursor').hidden = true; drawPreview(); } }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2); }
  else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.2); }
  else if (event.key.toLowerCase() === 'f' && !mod && !event.altKey && !event.shiftKey) { event.preventDefault(); fit(); }
});
window.addEventListener('keyup', event => { if (event.code === 'Space' && originalHeld) { originalHeld = false; drawPreview(); } });
window.addEventListener('blur', () => { finishRedactionStroke(false); finishPaintStroke(false);redactionPointers.clear();cancelTextPlacement(); previewPixelPointer = null; refreshPreviewPixelReadout(); cancelReferenceGesture(); cancelCropDraft(); finishManualStroke(false); finishMatteStroke(false); if (originalHeld) { originalHeld = false; drawPreview(); } pointer = null; viewport.classList.remove('dragging'); });
new ResizeObserver(() => { cancelReferenceGesture(); if (referenceComparisonVisible()) positionReferencePanes(); else if (source && fitMode) fit(); refreshPreviewPixelReadout(); }).observe(viewport);
bridge?.onMenuAction?.(action => { if (action === 'save-project') saveProject(); else if (action === 'open-project') openProject(); else if (action === 'import') openImages(); else if (action === 'export') openExport(); else if (action === 'undo') undo(); else if (action === 'redo') redo(); });
window.addEventListener('beforeunload', event => { if (!bridge?.setSessionDirty && (exportRunning || !!backendJob || !!projectOperation || !!presetOperation || !!imagePanel?.hasDraft || !!imagePanel?.importing || hasUnsavedProjectChanges())) { event.preventDefault(); event.returnValue = ''; } });

window.addEventListener('pagehide', () => { cancelPerspectiveDraft(false); imagePanel?.dispose(); sharpnessDraft=null; straightenDraft=null; finishRedactionStroke(false); finishPaintStroke(false);redactionPointers.clear();pageDisposed=true;viewToken++;renderVersion++;clearTimeout(renderTimer);renderTimer=null;renderController?.abort();renderController=null;acceptedRender=null;renderPending=false;renderingPhoto=false;exportCancelled=true;exportController?.abort();exportQueue?.cancel();textRasterCache=null;paintRasterCache=null;textDraft=null;cancelTextPlacement(); recoveryRestoreEpoch++; recoveryController?.dispose(); previewPixelEnabled = false; clearPreviewPixelInspector(); clearReference(); });
if (window.MintRecoveryController && window.MintProjectDocument && ['recoveryStatus','configureRecovery','saveRecoveryDraft','openRecoveryDraft','cancelRecoveryDraft'].every(key => typeof bridge?.[key] === 'function')) {
  recoveryController = window.MintRecoveryController.create({ bridge, readState: recoveryCaptureState, capture: captureRecovery, onChange: updateRecoveryControls });
  recoveryController.initialize();
}
updateRecoveryControls();
mountImagePanel();
updateControls(); updateFaceStatus(); rangeStyle($('brushSize')); rangeStyle($('exportQuality'));
if (namedPresetCodec && presetBridgeReady()) loadNamedPresets();
(async () => {
  try {
    await Pipeline.initModels(message => { $('modelMessage').textContent = typeof message === 'string' ? message : '正在加载本地人像模型…'; });
    modelState = 'ready'; $('modelBanner').className = 'model-banner ready'; $('modelBanner').querySelector('.small-spinner')?.remove();
    $('modelMessage').textContent = '基线人脸定位与分割已就绪 · 学习模型需单独检查'; updateFaceStatus(); updateAvailability();
    if (source && !exportRunning) analyzeCurrent();
  } catch (error) {
    modelState = 'error'; modelError = error.message || String(error);
    $('modelBanner').className = 'model-banner error'; $('modelBanner').querySelector('.small-spinner')?.remove();
    $('modelMessage').textContent = `基线定位/分割加载失败：${modelError}。基础调色与手动点修仍可使用。`;
    $('modelBanner').title = modelError; updateFaceStatus(); updateAvailability();
  }
})();

for(const id of ['exportOutputMode','exportLongEdge'])$(id)?.addEventListener(id==='exportLongEdge'?'input':'change',()=>{if(!exportRunning)refreshExportPlan();});
