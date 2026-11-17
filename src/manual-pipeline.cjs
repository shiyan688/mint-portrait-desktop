/* Shared manual replay integration, not a model. A manual warp invalidates the
 * original semantic matte and face geometry; unsupported combinations fail closed. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MintManualPipeline=api;})(typeof globalThis==='object'?globalThis:null,function(){
'use strict';
function assertCompatible(settings){
 if(!settings.manualLiquify?.length)return;
 let reason='';
 if(settings.bgMode&&settings.bgMode!=='original')reason='手动推形不能与尚未同步变形的背景蒙版组合。请恢复原背景，或清除手动推形。';
 else if(['slim','eyes','nose','jaw'].some(k=>settings[k]))reason='手动推形后原始五官定位已过期。请清零自动塑形，或清除手动推形。';
 else if(settings.manualRepair?.some(c=>c.sampleMode==='automatic'))reason='手动推形后不能沿用原始人脸保护范围自动取样；请使用明确的手动取样。';
 if(reason){const e=new Error(reason);e.code='MANUAL_STALE_ANALYSIS';throw e;}
}
function apply(image,settings,context){
 assertCompatible(settings);
 if(!settings.manualLiquify?.length&&!settings.manualRepair?.length)return image;
 const manual=typeof module==='object'&&module.exports?require('./manual-tools.cjs'):globalThis.MintManualTools;
 if(!manual)throw new Error('手动工具核心未加载，不能重放。');
 let out=image;
 if(settings.manualLiquify?.length){
  for(let i=3;i<out.data.length;i+=4)if(out.data[i]!==255){const e=new Error('手动推形暂不支持带透明度的原图。请使用不透明原图先推形，再重新抠图；不会自动抹去透明信息。');e.code='MANUAL_TRANSPARENT_SOURCE';throw e;}
  out=manual.liquify(out,settings.manualLiquify,context);
 }
 if(settings.manualRepair?.length){
  const repair=typeof module==='object'&&module.exports?require('./repair-brush-core.cjs'):globalThis.RepairBrushCore;
  if(!repair)throw new Error('手工修复核心未加载，不能重放。');
  for(const command of settings.manualRepair){
   const data=manual.rasterizeSelection(out.width,out.height,command.selection??null,context);
   out=repair.apply(out,command,{...context,manualTools:manual,selection:data?{width:out.width,height:out.height,data,sourceRevision:context.sourceRevision,space:'original-pixels'}:null});
  }
 }
 return out;
}
return Object.freeze({assertCompatible,apply});
});
