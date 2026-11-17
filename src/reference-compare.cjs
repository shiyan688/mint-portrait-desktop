/* Session-only frozen preview and normalized, linked view math. No pixel pipeline. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintReferenceCompare=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LIMITS=Object.freeze({maxEdge:1280,maxBytes:1280*1280*4,maxZoom:16,maxRecipeChars:2*1024*1024,maxRecipeNodes:150000});
  const finite=(n,fallback)=>typeof n==='number'&&Number.isFinite(n)?n:fallback;
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  function fitView(){return {u:.5,v:.5,zoom:1};}
  function normalizeView(view={}){return {u:clamp(finite(view?.u,.5),0,1),v:clamp(finite(view?.v,.5),0,1),zoom:clamp(finite(view?.zoom,1),1,LIMITS.maxZoom)};}
  function boundedSize(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxEdge||height>LIMITS.maxEdge||width*height*4>LIMITS.maxBytes)throw Error('参考预览尺寸超出 1280 像素 / 6.25 MiB 上限');return {width,height,bytes:width*height*4};}
  function layout(view,image,pane){
    const v=normalizeView(view),iw=finite(image?.width,0),ih=finite(image?.height,0),pw=finite(pane?.width,0),ph=finite(pane?.height,0);
    if(!Number.isInteger(iw)||!Number.isInteger(ih)||iw<=0||ih<=0||iw>LIMITS.maxEdge||ih>LIMITS.maxEdge||pw<=0||ph<=0||pw>100000||ph>100000)return {valid:false,width:0,height:0,left:0,top:0,scale:0};
    const scale=Math.min(pw/iw,ph/ih)*v.zoom;if(!Number.isFinite(scale)||scale<=0)return {valid:false,width:0,height:0,left:0,top:0,scale:0};const width=iw*scale,height=ih*scale;
    return {valid:true,width,height,left:pw/2-v.u*width,top:ph/2-v.v*height,scale};
  }
  function pan(view,delta,image,pane){const v=normalizeView(view),l=layout(v,image,pane);if(!l.valid)return v;return normalizeView({u:v.u-finite(delta?.x,0)/l.width,v:v.v-finite(delta?.y,0)/l.height,zoom:v.zoom});}
  function zoomAt(view,factor,anchor,image,pane){
    const v=normalizeView(view),l=layout(v,image,pane);if(!l.valid||!Number.isFinite(factor)||factor<=0)return v;
    const z=clamp(v.zoom*factor,1,LIMITS.maxZoom),ax=clamp(finite(anchor?.x,pane.width/2),0,pane.width)-pane.width/2,ay=clamp(finite(anchor?.y,pane.height/2),0,pane.height)-pane.height/2;
    return normalizeView({u:v.u+ax/l.width-ax/(l.width*z/v.zoom),v:v.v+ay/l.height-ay/(l.height*z/v.zoom),zoom:z});
  }
  // Bounded full-recipe canonical key. Reject cycles, getters, holes and non-JSON
  // objects before serialization; do not retain a second recipe or learned cache.
  function recipeKey(settings){
    let nodes=0,chars=0;const seen=new Set();
    const emit=s=>{chars+=s.length;if(chars>LIMITS.maxRecipeChars)throw Error('参考配方超出安全上限');return s;};
    function visit(value,depth){
      if(++nodes>LIMITS.maxRecipeNodes||depth>32)throw Error('参考配方超出安全上限');
      if(value===null)return emit('null');
      if(typeof value==='string'){if(value.length>LIMITS.maxRecipeChars)throw Error('参考配方过长');return emit(JSON.stringify(value));}
      if(typeof value==='boolean')return emit(String(value));
      if(typeof value==='number'&&Number.isFinite(value))return emit(JSON.stringify(value));
      if(!value||typeof value!=='object'||seen.has(value))throw Error('参考配方不是有限 JSON 数据');
      const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
      if(!array&&proto!==null&&Object.getPrototypeOf(proto)!==null)throw Error('参考配方必须为普通数据');
      seen.add(value);const ownKeys=Reflect.ownKeys(value),keys=[];if(ownKeys.length>LIMITS.maxRecipeNodes+1)throw Error('参考配方过大');for(const key of ownKeys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('参考配方含隐藏字段或访问器');keys.push(key);}
      if(array&&(keys.length!==value.length||keys.some((k,i)=>k!==String(i))))throw Error('参考配方数组不完整');
      const parts=[];for(const key of array?keys:keys.sort()){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))throw Error('参考配方不能含访问器');parts.push((array?'':emit(JSON.stringify(key)+':'))+visit(d.value,depth+1));}
      seen.delete(value);if(parts.length>1)emit(','.repeat(parts.length-1));return emit(array?'[':'{')+parts.join(',')+emit(array?']':'}');
    }
    const key=visit(settings,0);if(key.length>LIMITS.maxRecipeChars)throw Error('参考配方超出安全上限');return key;
  }
  function dispose(snapshot){if(snapshot?.canvas){snapshot.canvas.remove?.();snapshot.canvas.width=0;snapshot.canvas.height=0;}}
  function capture(canvas,provenance,createCanvas,isCurrent){
    const size=boundedSize(canvas?.width,canvas?.height);
    if(!provenance||typeof provenance!=='object')throw Error('参考来源记录无效');
    const meta={};for(const key of ['photoId','sourceRevision','name','mode','generation','viewToken','recipeKey','width','height','originalWidth','originalHeight','workingWidth','workingHeight']){const d=Object.getOwnPropertyDescriptor(provenance,key);if(d&&!('value'in d))throw Error('参考来源记录不能含访问器');meta[key]=d?.value;}
    for(const [key,max] of [['photoId',256],['sourceRevision',512],['name',1024]])if(typeof meta[key]!=='string'||!meta[key].length||meta[key].length>max)throw Error('参考来源标识无效或过长');
    if(meta.mode!=='framed'||!Number.isSafeInteger(meta.generation)||meta.generation<0||!Number.isSafeInteger(meta.viewToken)||meta.viewToken<0||typeof meta.recipeKey!=='string'||!meta.recipeKey.length||meta.recipeKey.length>LIMITS.maxRecipeChars||meta.width!==size.width||meta.height!==size.height||typeof createCanvas!=='function'||typeof isCurrent!=='function')throw Error('处理预览尚未就绪，不能固定参考');
    for(const prefix of ['original','working']){const w=meta[prefix+'Width'],h=meta[prefix+'Height'];if(w===undefined&&h===undefined)continue;if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>32768||h>32768||w*h>80000000)throw Error('参考来源尺寸无效');if(prefix==='working')boundedSize(w,h);}
    if(!isCurrent())throw Error('处理预览尚未就绪，不能固定参考');
    let copy=null;
    try{
      copy=createCanvas();if(!copy||copy===canvas)throw Error('参考副本不可用');
      copy.width=size.width;copy.height=size.height;const ctx=copy.getContext('2d');if(!ctx)throw Error('参考画布不可用');
      if(!isCurrent()||canvas.width!==size.width||canvas.height!==size.height)throw Error('处理预览已改变，请重试');
      ctx.drawImage(canvas,0,0); // Canvas owns an independent bitmap, never an alias to source.
      if(!isCurrent()||canvas.width!==size.width||canvas.height!==size.height)throw Error('处理预览已改变，请重试');
      return Object.freeze({...meta,canvas:copy,bytes:size.bytes,capturedAt:new Date().toISOString()});
    }catch(error){if(copy&&copy!==canvas)dispose({canvas:copy});throw error;}
  }
  return Object.freeze({LIMITS,fitView,normalizeView,layout,pan,zoomAt,boundedSize,recipeKey,capture,dispose});
});
