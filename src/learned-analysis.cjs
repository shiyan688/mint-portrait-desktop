/* Coordinate/validation helpers only. No model, network, inferred photo identity,
 * image edits or fallback. Caller owns revision-bound immutable result caches. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MintLearnedAnalysis=api;})(typeof globalThis==='object'?globalThis:null,function(){
 'use strict';
 const MAX_PIXELS=16000000,MAX_FACE_PIXELS=1048576;
 const FACE_CLASSES=Object.freeze(['background','neck','skin','cloth','l_ear','r_ear','l_brow','r_brow','l_eye','r_eye','nose','mouth','l_lip','u_lip','hair','eye_g','hat','ear_r','neck_l']);
 const assert=(condition,message)=>{if(!condition)throw new Error(message);};
 function size(value){assert(value&&Number.isSafeInteger(value.width)&&Number.isSafeInteger(value.height)&&value.width>0&&value.height>0&&value.width*value.height<=MAX_PIXELS,'Invalid original image dimensions');return value;}
 function roi(value,original){size(original);assert(value&&['x','y','width','height'].every(k=>Number.isSafeInteger(value[k]))&&value.x>=0&&value.y>=0&&value.width>0&&value.height>0&&value.x<=original.width-value.width&&value.y<=original.height-value.height,'Invalid original-pixel ROI');return value;}
 const sameROI=(a,b)=>a&&b&&['x','y','width','height'].every(k=>a[k]===b[k]);
 function probabilities(data,width,height){size({width,height});assert(data instanceof Float32Array&&data.buffer instanceof ArrayBuffer&&data.length===width*height,'Expected exact Float32 probability mask');for(const v of data)assert(Number.isFinite(v)&&v>=0&&v<=1,'Invalid mask probability');return data;}
 function faceROI(landmarks,originalSize){
  size(originalSize);assert(Array.isArray(landmarks)&&landmarks.length>=468,'A real detected face mesh is required');
  assert(landmarks.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1),'Invalid normalized face coordinates');
  const xs=landmarks.map(p=>p.x),ys=landmarks.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),w=right-left,h=bottom-top;
  assert(w>0.025&&h>0.025,'Detected face is too small');
  const x=Math.max(0,Math.floor((left-w*.2)*originalSize.width)),y=Math.max(0,Math.floor((top-h*.35)*originalSize.height));
  const x2=Math.min(originalSize.width,Math.ceil((right+w*.2)*originalSize.width)),y2=Math.min(originalSize.height,Math.ceil((bottom+h*.15)*originalSize.height));
  const result={x,y,width:x2-x,height:y2-y};roi(result,originalSize);
  assert(result.width*result.height<=MAX_FACE_PIXELS,'当前人脸原始区域超过 104 万像素；分区任务已停止，不会缩小或裁掉脸部冒充原图分析。');
  return result;
 }
 function crop(canvas,region){roi(region,canvas);const context=canvas.getContext('2d',{willReadFrequently:true});assert(context,'Image canvas unavailable');const image=context.getImageData(region.x,region.y,region.width,region.height);assert(image.data.length===region.width*region.height*4,'Invalid cropped pixels');return {width:region.width,height:region.height,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:new Uint8ClampedArray(image.data)};}
 function resampleMask(mask,width,height){
  probabilities(mask?.data,mask?.width,mask?.height);size({width,height});const out=new Float32Array(width*height);
  // Pixel-centre mapping agrees with ordinary image resampling, not endpoint
  // stretching. Values outside the edge are clamped, never reflected/wrapped.
  for(let y=0;y<height;y++){const fy=Math.max(0,Math.min(mask.height-1,(y+.5)*mask.height/height-.5)),y0=Math.floor(fy),y1=Math.min(mask.height-1,y0+1),dy=fy-y0;
   for(let x=0;x<width;x++){const fx=Math.max(0,Math.min(mask.width-1,(x+.5)*mask.width/width-.5)),x0=Math.floor(fx),x1=Math.min(mask.width-1,x0+1),dx=fx-x0;
    const a=mask.data[y0*mask.width+x0]*(1-dx)+mask.data[y0*mask.width+x1]*dx,b=mask.data[y1*mask.width+x0]*(1-dx)+mask.data[y1*mask.width+x1]*dx;out[y*width+x]=a*(1-dy)+b*dy;}}
  return {width,height,data:out,maxValue:1,space:'working-pixels',encoding:'unit-float32'};
 }
 function provenance(result,request,task){const p=result?.provenance;assert(p&&p.kind==='model'&&p.task===task&&p.modelId===request.modelId&&p.modelVersion===request.modelVersion&&/^[a-f0-9]{64}$/.test(p.weightsSha256)&&p.device?.kind===request.device,'Model provenance does not match request');return p;}
 function validateParse(result,request){
  roi(request.roi,request.originalSize);assert(result?.kind==='face-masks'&&sameROI(result.roi,request.roi)&&result.width===request.roi.width&&result.height===request.roi.height,'Parsing result has wrong original-pixel geometry');
  probabilities(result.skin,result.width,result.height);probabilities(result.protected,result.width,result.height);const p=provenance(result,request,'parse');
  assert(p.selection&&request.selection&&['kind','faceId','revision'].every(k=>p.selection[k]===request.selection[k]),'Parsing result belongs to another face revision');
  assert(Array.isArray(p.maskClasses?.skin)&&p.maskClasses.skin.length===2&&p.maskClasses.skin[0]==='skin'&&p.maskClasses.skin[1]==='nose','Skin mask must explicitly include nose');
  assert(Array.isArray(p.classVocabulary)&&p.classVocabulary.length===FACE_CLASSES.length&&p.classVocabulary.every((v,i)=>v===FACE_CLASSES[i]),'Unexpected face class vocabulary');
  const policy=p.maskPolicy;assert(policy?.version==='segface-conservative-v1'&&policy.kind==='deterministic-mask-postprocessing-not-a-retouch-model'&&
    policy.guard?.units==='original-roi-pixels'&&policy.guard.outsideRoi==='fully-protected'&&Number.isInteger(policy.guard.radiusPx)&&policy.guard.radiusPx>=2&&policy.guard.radiusPx<=12,'Missing conservative boundary policy');
  for(let i=0;i<result.skin.length;i++)assert(Math.abs(result.skin[i]+result.protected[i]-1)<=1e-6,'Skin and protected masks are not complements');return result;
 }
 function validateMatte(result,request){
  roi(request.roi,request.originalSize);const m=result?.matte;assert(m&&sameROI(m.roi,request.roi)&&m.width===request.roi.width&&m.height===request.roi.height&&m.space==='roi-original-pixels'&&m.encoding==='unit-float32','Matte result has wrong original-pixel geometry');
  probabilities(m.data,m.width,m.height);provenance(result,request,'matting');
  // The experimental foreground contract is tested separately. This UI has no
  // refinement acceptance/control yet, so do not silently drop or cache that
  // extra plane, especially after a user changes the alpha with a brush.
  assert(!result.foreground&&!result.provenance?.foregroundRefinement,'当前界面尚未接入前景颜色修正候选；结果未应用，不会忽略该结果的一部分。');return result;
 }
 function applyMaskStrokes(mask,originalSize,strokes=[]){
  size(originalSize);probabilities(mask?.data,mask?.width,mask?.height);
  assert(mask.width===originalSize.width&&mask.height===originalSize.height,'Brush corrections require exact original-size alpha');
  assert(Array.isArray(strokes)&&strokes.length<=64,'At most 64 correction strokes are supported');
  const width=mask.width,height=mask.height,prepared=[];let work=0;
  for(const stroke of strokes){
   assert(stroke&&['keep','remove'].includes(stroke.mode)&&Array.isArray(stroke.points)&&stroke.points.length>=1&&stroke.points.length<=512,'Invalid correction stroke');
   const {radiusPx,hardness,opacity}=stroke;
   assert(Number.isFinite(radiusPx)&&radiusPx>=.5&&radiusPx<=Math.max(1,Math.min(width,height)/2)&&Number.isFinite(hardness)&&hardness>=0&&hardness<=1&&Number.isFinite(opacity)&&opacity>=0&&opacity<=1,'Invalid original-pixel brush parameters');
   assert(stroke.points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height),'Brush points must use original image coordinates');
   const segments=[];
   for(let n=0;n<Math.max(1,stroke.points.length-1);n++){
    const a=stroke.points[n],b=stroke.points[Math.min(n+1,stroke.points.length-1)];
    const box={x0:Math.max(0,Math.floor(Math.min(a.x,b.x)-radiusPx)),x1:Math.min(width-1,Math.ceil(Math.max(a.x,b.x)+radiusPx)),y0:Math.max(0,Math.floor(Math.min(a.y,b.y)-radiusPx)),y1:Math.min(height-1,Math.ceil(Math.max(a.y,b.y)+radiusPx))};
    work+=(box.x1-box.x0+1)*(box.y1-box.y0+1);assert(work<=64000000,'蒙版笔画过于复杂，请减少笔画或拆分操作。');segments.push({a,b,...box});
   }
   prepared.push({stroke,segments});
  }
  const data=new Float32Array(mask.data);
  for(const {stroke,segments}of prepared){
   if(stroke.opacity===0)continue;
   const x0=Math.min(...segments.map(s=>s.x0)),x1=Math.max(...segments.map(s=>s.x1)),y0=Math.min(...segments.map(s=>s.y0)),y1=Math.max(...segments.map(s=>s.y1)),w=x1-x0+1;
   const coverage=new Float32Array(w*(y1-y0+1)),inner=stroke.radiusPx*stroke.hardness;
   for(const segment of segments){const {a,b}=segment,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    for(let y=segment.y0;y<=segment.y1;y++)for(let x=segment.x0;x<=segment.x1;x++){
     const t=length2?Math.max(0,Math.min(1,((x+.5-a.x)*dx+(y+.5-a.y)*dy)/length2)):0;
     const distance=Math.hypot(x+.5-a.x-t*dx,y+.5-a.y-t*dy);if(distance>=stroke.radiusPx)continue;
     const edge=distance<=inner?0:(distance-inner)/(stroke.radiusPx-inner),weight=stroke.opacity*(1-edge*edge*(3-2*edge)),index=(y-y0)*w+x-x0;
     coverage[index]=Math.max(coverage[index],weight);
    }
   }
   const target=stroke.mode==='keep'?1:0;
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const weight=coverage[(y-y0)*w+x-x0];if(weight>0){const i=y*width+x;data[i]+= (target-data[i])*weight;}}
  }
  return {width,height,data,maxValue:1,space:'original-pixels',encoding:'unit-float32',correction:{algorithm:'manual-soft-polyline-union-v1',units:'original-pixels',strokeCount:strokes.length,learned:false}};
 }
 return Object.freeze({faceROI,crop,resampleMask,validateParse,validateMatte,applyMaskStrokes});
});
