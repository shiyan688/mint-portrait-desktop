'use strict';
// Privileged bridge only. Renderers can select listed IDs/devices, never paths,
// executable arguments, Python modules, assets, credentials or remote endpoints.
const path = require('node:path');
const crypto = require('node:crypto');
const { createDesktopBackend } = require('./desktop-backend.cjs');
const { manifestsFor } = require('./backend/catalog.cjs');
const { CLASSES, makeConservativeSkinMasks } = require('./backend/adapters/segface/mask.cjs');
const MAX_PIXELS = 16777216;

/**
 * @typedef {{x:number,y:number,width:number,height:number}} OriginalROI
 * @typedef {{width:number,height:number,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:Uint8Array|Uint8ClampedArray}} RGBAImage
 * @typedef {{requestId:string,modelId:string,modelVersion:string,device:'cpu'|'cuda',originalSize:{width:number,height:number},roi:OriginalROI,source:RGBAImage}} ModelRequest
 * @typedef {ModelRequest & {selection:{kind:'detected-face'|'user-face-roi',faceId:string,revision:string}}} FaceRequest
 * @typedef {{matte:{width:number,height:number,roi:OriginalROI,space:'roi-original-pixels',encoding:'unit-float32',data:Float32Array},foreground?:RGBAImage,provenance:object}} MattingResult
 * @typedef {{kind:'face-masks',width:number,height:number,roi:OriginalROI,skin:Float32Array,protected:Float32Array,provenance:object}} FaceMasksResult
 */

function assert(condition, message) { if (!condition) throw new Error(message); }
function boundedText(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value; }
function sameROI(a, b) { return a && ['x','y','width','height'].every(key => a[key] === b[key]); }
function checkProbabilities(data, length) {
  assert(data instanceof Float32Array && data.buffer instanceof ArrayBuffer && data.length === length, 'Invalid original-ROI probability buffer');
  for (const value of data) assert(Number.isFinite(value) && value >= 0 && value <= 1, 'Invalid model probability');
}
function alphaDigest(data) {
  const hash=crypto.createHash('sha256'), block=Buffer.allocUnsafe(16384);
  for(let start=0;start<data.length;start+=4096){const count=Math.min(4096,data.length-start);for(let i=0;i<count;i++)block.writeFloatLE(data[start+i],i*4);hash.update(block.subarray(0,count*4));}
  return hash.digest('hex');
}

function createDesktopAI({ root, platform = process.platform, packaged = false, resourcesPath = root,
  backendFactory = createDesktopBackend, catalog = manifestsFor }) {
  const backendRoot = packaged ? path.join(resourcesPath, 'backend') : path.join(root, 'backend');
  const pythonPath = packaged ? path.join(backendRoot, 'python', 'python.exe') :
    path.join(backendRoot, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const backend = backendFactory({ pythonPath, backendRoot, manifests: catalog(backendRoot), maxConcurrent: 1,
    maxQueued: 2, timeoutMs: 180000, maxPayloadBytes: 134217728, maxPixels: 16777216 });
  const jobs = new Map();
  let disposed = false;
  const requireOpen = () => { if (disposed) throw new Error('本地模型服务已关闭。'); };
  function requestObject(value, matting = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model request');
    const allowed = new Set(['requestId','modelId','modelVersion','device','originalSize','roi','source',...(matting ? [] : ['selection'])]);
    if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Unexpected model request field');
    if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.requestId)) throw new Error('Invalid request ID');
    if (!['cpu','cuda'].includes(value.device)) throw new Error('请选择明确的 CPU 或 CUDA 设备。');
    for (const name of ['modelId','modelVersion']) assert(boundedText(value[name],200), 'Invalid model identity');
    const size=value.originalSize, roi=value.roi, source=value.source;
    assert(size && Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height) && size.width>0 && size.height>0 && size.width*size.height<=MAX_PIXELS, 'Invalid original image dimensions');
    assert(roi && ['x','y','width','height'].every(key=>Number.isSafeInteger(roi[key])) && roi.x>=0 && roi.y>=0 && roi.width>0 && roi.height>0 &&
      roi.width<=size.width && roi.height<=size.height && roi.x<=size.width-roi.width && roi.y<=size.height-roi.height, 'Invalid original-pixel ROI');
    assert(source && source.width===roi.width && source.height===roi.height && source.format==='rgba8' && source.alphaMode==='straight' && source.colorSpace==='srgb' &&
      (source.data instanceof Uint8Array || source.data instanceof Uint8ClampedArray) && source.data.buffer instanceof ArrayBuffer && source.data.length===roi.width*roi.height*4,
    'Invalid straight-alpha sRGB original-ROI RGBA8 source');
    let selection;
    if(!matting){
      assert(value.selection && ['detected-face','user-face-roi'].includes(value.selection.kind), '必须提供明确的人脸区域来源。');
      for(const name of ['faceId','revision']) assert(boundedText(value.selection[name],128), 'Invalid face selection');
      selection={kind:value.selection.kind,faceId:value.selection.faceId,revision:value.selection.revision};
    }
    return {requestId:value.requestId,modelId:value.modelId,modelVersion:value.modelVersion,device:value.device,
      originalSize:{width:size.width,height:size.height},roi:{x:roi.x,y:roi.y,width:roi.width,height:roi.height},
      source:{width:source.width,height:source.height,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:new Uint8ClampedArray(source.data)},selection};
  }
  function checkedProvenance(result, context, matting) {
    const p=result?.provenance;
    assert(p && p.jobId===context.jobId && p.task===(matting?'matting':'parse') && p.modelId===context.modelId && p.modelVersion===context.modelVersion &&
      /^[a-f0-9]{64}$/.test(p.weightsSha256) && ['model','test-double'].includes(p.kind) && p.device?.kind===context.device && boundedText(p.device?.name,256),
    'Model result provenance does not match the request');
    assert(p.executionProfile && ['segface','birefnet','generative'].includes(p.executionProfile.adapter) &&
      Object.entries(p.executionProfile).every(([key,value])=>key==='operatorPrecision'?
        value && typeof value==='object' && Object.keys(value).length===2 && value.deformConv2d==='float32' && value.weights==='float32':
        ['adapter','inputSize','precision','variant','threads','qualityProfile'].includes(key) && (typeof value==='number'?Number.isSafeInteger(value):boundedText(value,80))), 'Invalid trusted execution profile');
    const profile={...p.executionProfile,...(p.executionProfile.operatorPrecision?{operatorPrecision:{...p.executionProfile.operatorPrecision}}:{})};
    const provenance={jobId:p.jobId,task:p.task,modelId:p.modelId,modelVersion:p.modelVersion,weightsSha256:p.weightsSha256,kind:p.kind,device:{kind:p.device.kind,name:p.device.name},executionProfile:profile};
    if(!matting){
      assert(p.selection && ['kind','faceId','revision'].every(key=>p.selection[key]===context.selection[key]), 'Model result belongs to another face selection');
      provenance.selection={...context.selection};
    }else if(p.foregroundRefinement!==undefined){
      const r=p.foregroundRefinement;
      assert(r && r.kind==='classical-color-estimation' && r.implementation==='pymatting' && r.version==='1.1.16' && r.method==='estimate_foreground_ml' &&
        Buffer.byteLength(JSON.stringify(r))<=4096,'Invalid classical foreground refinement provenance');
      provenance.foregroundRefinement=JSON.parse(JSON.stringify(r));
    }
    return provenance;
  }
  async function run(value, mode) {
    requireOpen(); const matting=mode==='matting', request=requestObject(value,matting);
    if (jobs.has(request.requestId)) throw new Error('This request is already running');
    const controller = new AbortController(); jobs.set(request.requestId, controller);
    const context={jobId:crypto.randomUUID(),modelId:request.modelId,modelVersion:request.modelVersion,device:request.device,
      originalSize:request.originalSize,roi:request.roi,source:request.source,signal:controller.signal};
    if(!matting) context.selection=request.selection;
    try {
      const result=await (matting?backend.runMatting(context):backend.runParsing(context));
      if(controller.signal.aborted||disposed){const failure=new Error('本地模型任务已取消。');failure.name='AbortError';throw failure;}
      const provenance=checkedProvenance(result,context,matting), {width,height}=request.roi, pixels=width*height;
      if(matting){
        const matte=result.matte;
        assert(!result.image && matte && matte.width===width && matte.height===height && sameROI(matte.roi,request.roi) &&
          matte.space==='roi-original-pixels' && matte.encoding==='unit-float32', 'Invalid original-ROI matte result');
        checkProbabilities(matte.data,pixels);
        let foreground;
        if(result.foreground!==undefined){
          const f=result.foreground;
          assert(provenance.foregroundRefinement && f && f.width===width && f.height===height && f.format==='rgba8' && f.alphaMode==='straight' && f.colorSpace==='srgb' &&
            (f.data instanceof Uint8Array || f.data instanceof Uint8ClampedArray) && f.data.buffer instanceof ArrayBuffer && f.data.length===pixels*4,'Invalid optional foreground plane');
          assert(provenance.foregroundRefinement.alphaDigest===alphaDigest(matte.data),'Foreground refinement belongs to a different alpha plane');
          assert(provenance.foregroundRefinement.sourceDigest===crypto.createHash('sha256').update(request.source.data).digest('hex'),'Foreground refinement belongs to a different source image');
          for(let p=0;p<pixels;p++){
            const i=p*4;assert(f.data[i+3]===request.source.data[i+3],'Foreground refinement changed original alpha');
            if(request.source.data[i+3]<255 || matte.data[p]===1)for(let c=0;c<3;c++)assert(f.data[i+c]===request.source.data[i+c],'Foreground refinement changed protected RGB');
          }
          foreground={width,height,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:new Uint8ClampedArray(f.data)};
        }else assert(!provenance.foregroundRefinement,'Foreground refinement was declared without its foreground plane');
        return {matte:{width,height,roi:{...request.roi},space:'roi-original-pixels',encoding:'unit-float32',data:new Float32Array(matte.data)},...(foreground?{foreground}:{}),provenance};
      }
      assert(result.kind==='parsing' && result.width===width && result.height===height && sameROI(result.roi,request.roi) &&
        result.space==='roi-original-pixels' && result.encoding==='unit-float32' && result.layout==='planar' && Array.isArray(result.classes) && result.classes.length>0 && result.classes.length<=64 &&
        result.classes.every(name=>boundedText(name,256)) && new Set(result.classes).size===result.classes.length, 'Invalid original-ROI parsing result');
      checkProbabilities(result.data,pixels*result.classes.length);
      if(mode==='masks'){
        const masks=makeConservativeSkinMasks(result);
        return {kind:'face-masks',width,height,roi:{...request.roi},skin:masks.skin,protected:masks.protected,
          provenance:{...provenance,classVocabulary:[...CLASSES],maskClasses:masks.policy.maskClasses,maskPolicy:masks.policy}};
      }
      return {kind:'parsing',width,height,roi:{...request.roi},space:'roi-original-pixels',encoding:'unit-float32',layout:'planar',classes:[...result.classes],data:new Float32Array(result.data),provenance};
    } finally { if (jobs.get(request.requestId) === controller) jobs.delete(request.requestId); }
  }
  return Object.freeze({
    async probe() { requireOpen(); return backend.probe(); },
    /** @param {FaceRequest} value */
    parse(value) { return run(value,'classes'); },
    /** @param {FaceRequest} value @returns {Promise<FaceMasksResult>} */
    parseMasks(value) { return run(value,'masks'); },
    /** @param {ModelRequest} value @returns {Promise<MattingResult>} */
    matte(value) { return run(value,'matting'); },
    cancel(requestId) {
      requireOpen(); if (typeof requestId !== 'string') throw new Error('Invalid request ID');
      const controller = jobs.get(requestId); if (!controller) return false;
      controller.abort(); return true;
    },
    cancelAll() { for (const controller of jobs.values()) controller.abort(); backend.cancelAll(); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const controller of jobs.values()) controller.abort(); jobs.clear(); backend.dispose();
    }
  });
}
module.exports = { createDesktopAI };
