/* Desktop browser fallback: final-output Canvas downsample, not source processing. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./export-size.cjs'));else root.MintExportResize=factory(()=>root.MintExportSize);})(typeof globalThis!=='undefined'?globalThis:this,function(getCore){
 'use strict';
 function cancelled(signal){if(signal?.aborted){const e=new Error('已取消最终尺寸处理');e.name='AbortError';throw e;}}
 function applyCanvas(input,recipe,createCanvas,{signal}={}){
  const core=getCore();if(!core)throw Error('最终尺寸组件未加载');if(!input||typeof input.getContext!=='function')throw Error('导出画布不可用');
  const w=input.width,h=input.height,plan=core.plan(w,h,recipe);cancelled(signal);if(!plan.resized)return input;
  if(typeof createCanvas!=='function')throw Error('缩放画布不可用');let out=null;
  try{
   out=createCanvas(plan.output.width,plan.output.height);if(!out||out===input||typeof out.getContext!=='function')throw Error('缩放输出必须是独立画布');
   if(out.width!==plan.output.width)out.width=plan.output.width;if(out.height!==plan.output.height)out.height=plan.output.height;
   if(input.width!==w||input.height!==h)throw Error('导出输入尺寸已变化');cancelled(signal);
   const ctx=out.getContext('2d');if(!ctx)throw Error('无法分配缩放画布');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(input,0,0,w,h,0,0,out.width,out.height);cancelled(signal);
   if(input.width!==w||input.height!==h||out.width!==plan.output.width||out.height!==plan.output.height)throw Error('最终尺寸校验失败');return out;
  }catch(e){if(out&&out!==input){try{out.width=1;out.height=1;}catch{}}throw e;}
 }
 return Object.freeze({applyCanvas});
});
