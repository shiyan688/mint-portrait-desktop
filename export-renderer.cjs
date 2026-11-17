'use strict';
const path=require('node:path');const {Worker}=require('node:worker_threads');const {isDeepStrictEqual}=require('node:util');const core=require('./export-render-core.cjs');const Project=require('./src/project-document.cjs');const Sharpness=require('./src/sharpness.cjs');
function abortError(){const e=new Error('已取消导出渲染；原图未修改。');e.name='AbortError';return e;}
function createExportRenderer({WorkerClass=Worker,workerPath=path.join(__dirname,'export-render-worker.cjs'),timeoutMs=300000}={}){
 let active=null,disposed=false;
 function render(payload){
  if(disposed)return Promise.reject(new Error('导出服务已关闭。'));
  if(active)return Promise.reject(new Error('已有导出任务进行中。'));
  let request;try{request=core.validateRequest(payload);}catch(e){return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
   const job={id:request.requestId,worker:null,settled:false,timer:null};active=job;
   const finish=(error,result)=>{if(job.settled)return;job.settled=true;clearTimeout(job.timer);let ending;try{ending=job.worker?.terminate();}catch{}Promise.resolve(ending).catch(()=>{}).then(()=>{if(active===job)active=null;if(error)reject(error);else resolve(result);});};job.finish=finish;
   try{
    job.worker=new WorkerClass(workerPath,{workerData:request,transferList:[request.bytes.buffer,...(request.textOverlay?[request.textOverlay.rgba.buffer]:[]),...(request.paintOverlay?[request.paintOverlay.rgba.buffer]:[])],resourceLimits:{maxOldGenerationSizeMb:1024}});
    job.worker.once('error',e=>finish(new Error(`本地导出失败：${e.message}`)));
    job.worker.once('exit',code=>{if(!job.settled)finish(new Error(`导出进程提前退出（${code}），未写入文件。`));});
    job.worker.once('message',result=>{
     if(!result?.ok)return finish(new Error(result?.error||'导出失败。'));
     try{
      if(!(result.bytes instanceof Uint8Array)||!(result.bytes.buffer instanceof ArrayBuffer)||!result.bytes.length||result.bytes.length>core.LIMITS.outputBytes)throw new Error('无效的输出字节。');
      // Validate recipe records themselves, not only deep equality: hidden,
      // accessor or unknown fields cannot masquerade as the frozen snapshot.
      if(request.plan.sharpened){Sharpness.validate(result.sharpnessRecipe);Sharpness.validate(result.details?.sharpnessRecipe);}
      if(request.plan.perspectiveReceipt){core.validatePerspectiveReceipt(result.perspectiveReceipt,request.plan.perspectiveReceipt);core.validatePerspectiveReceipt(result.details?.perspectiveReceipt,request.plan.perspectiveReceipt);}
      for(const key of ['width','height','processingWidth','processingHeight','originalWidth','originalHeight','scaled','framed','padded'])if(result[key]!==request.plan[key])throw new Error(`输出计划字段不匹配：${key}`);
      for(const key of ['compositionWidth','compositionHeight','outputSizePlan','straightened','straightenRecipe','straightenedWidth','straightenedHeight','sharpened','sharpnessRecipe','imageLayered','imageLayerKey','perspectiveReceipt'])if(Object.hasOwn(result,key)!==Object.hasOwn(request.plan,key)||!isDeepStrictEqual(result[key],request.plan[key]))throw new Error(`最终尺寸计划字段不匹配：${key}`);
      // Same-sized rotations are not identity. Validate algorithm and recipe,
      // not merely dimensions, before releasing bytes to a writer.
      if(request.plan.straightened||request.plan.sharpened||request.plan.imageLayered||request.plan.perspectiveReceipt){
       const expected=core.resamplingDetails(request.plan);
       for(const key of Object.keys(expected))if(!result.details||!Object.hasOwn(result.details,key)||!isDeepStrictEqual(result.details[key],expected[key]))throw new Error(`校正算法结果字段不匹配：${key}`);
      }
      if(!request.plan.perspectiveReceipt&&result.details&&(Object.hasOwn(result.details,'perspective')||Object.hasOwn(result.details,'perspectiveReceipt')))throw new Error('未启用透视时收到额外透视结果。');
      if(!request.plan.straightened&&result.details&&(Object.hasOwn(result.details,'straighten')||Object.hasOwn(result.details,'straightenRecipe')))throw new Error('未启用校正时收到额外校正结果。');
      if(!request.plan.sharpened&&result.details&&(Object.hasOwn(result.details,'sharpness')||Object.hasOwn(result.details,'sharpnessRecipe')))throw new Error('未启用锐化时收到额外锐化结果。');
      if(!request.plan.imageLayered&&result.details&&(Object.hasOwn(result.details,'imageOverlay')||Object.hasOwn(result.details,'imageLayerKey')))throw new Error('未启用贴图时收到额外贴图结果。');
      // Validate encoded dimensions as well as the worker envelope. A stale or
      // mismatched buffer must never be written under otherwise plausible metadata.
      const encoded=Project.inspectImage(result.bytes,request.format==='png'?'image/png':'image/jpeg');
      if(encoded.width!==request.plan.width||encoded.height!==request.plan.height)throw new Error('编码图像尺寸不匹配。');
      const {ok,...value}=result;finish(null,value);
     }catch(error){finish(new Error(`导出结果校验失败：${error.message||error}`));}
    });
    job.timer=setTimeout(()=>finish(new Error('导出超过 5 分钟，已停止以释放资源。')),timeoutMs);job.timer.unref?.();
   }catch(e){finish(e);}
  });
 }
 function cancel(id){if(typeof id!=='string'||active?.id!==id)return false;active.finish(abortError());return true;}
 return{render,cancel,isBusy:()=>!!active,dispose(){disposed=true;if(active)active.finish(abortError());}};
}
module.exports={createExportRenderer};
