'use strict';
// Test-only bridge to an already installed NativeCanvas. Never a shipped dependency.
const crypto = require('node:crypto'),fs=require('node:fs'),path=require('node:path');
let Native, nativePath;
for (const candidate of ['@napi-rs/canvas', '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas']) {
  try { Native = require(candidate); nativePath = path.dirname(require.resolve(candidate)); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}

const fontRegistrations=[];
if(Native)for(const[file,family]of[
 ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','sans-serif'],
 ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc','sans-serif'],
 ['/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc','serif'],
 ['/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc','serif'],
 ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf','monospace']]){
 if(fs.existsSync(file)){if(!Native.GlobalFonts.registerFromPath(file,family))throw Error('Existing QA font registration failed: '+file);fontRegistrations.push({file,family,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}
}

function fixture(width, height) {
  const canvas = Native.createCanvas(width, height), ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4; image.data.set([35+Math.round(x/width*95),70+Math.round(y/height*100),110+Math.round(x/width*40),255],i);
  }
  ctx.putImageData(image,0,0); return canvas;
}
function install(Element, overrides, calls) {
  function backing(el) {
    if (!el._native || el._native.width!==Math.max(1,el.width) || el._native.height!==Math.max(1,el.height)) el._native=Native.createCanvas(Math.max(1,el.width),Math.max(1,el.height));
    return el._native;
  }
  Element.prototype.getContext=function() {
    const context=backing(this).getContext('2d'), element=this;
    return new Proxy(context, {
      get(target,key) {
        if(key==='getImageData') return (x,y,w,h,settings)=>target.getImageData(x,y,w,h,settings&&typeof settings==='object'?settings.colorSpace:settings); // NativeCanvas 0.1.100 lacks browser options dictionary.
        if(key==='drawImage') return (source,...args)=>{ calls.draws.push({target:element.id,canvas:source,args}); return target.drawImage(source instanceof Element?backing(source):source,...args); };
        const value=target[key]; return typeof value==='function'?value.bind(target):value;
      },
      set(target,key,value){target[key]=value;return true;}
    });
  };
  Object.defineProperty(Element.prototype,'pixels', {
    get(){return this.getContext().getImageData(0,0,this.width,this.height).data;},
    set(data){ const ctx=this.getContext(), image=ctx.createImageData(this.width,this.height);image.data.set(data);ctx.putImageData(image,0,0); }
  });
}
function service(document, calls, overrides) {
  const Text=require('../../src/text-overlay.cjs'),Layers=require('../../src/text-layers.cjs'),Renderer=require('../../src/text-layer-renderer.cjs');
  const core={...Text,render(...args){calls.nativeTextDraws=(calls.nativeTextDraws||0)+1;const out=Text.render(...args);overrides.textDraw?.(...args);return out;}};
  const real=Renderer.create({document,crypto:{subtle:{digest(...args){calls.digests=(calls.digests||0)+1;return overrides.digest?overrides.digest(...args):crypto.webcrypto.subtle.digest(...args);}}},textCore:core,layersCore:Layers});
  const opts=o=>({...o,...('layers'in o?{layers:structuredClone(o.layers)}:{}),...('preparedRaster'in o?{preparedRaster:structuredClone(o.preparedRaster)}:{})});
  return {
    hashBytes(bytes,o){calls.hashOptions=(calls.hashOptions||[]).concat([o]);return real.hashBytes(bytes,o===undefined?undefined:{...o});},
    raster(o){calls.textRasters.push(o);return real.raster(opts(o));},
    async compositePreview(base,raster,o){calls.textComposites.push({base,raster});const output=real.compositePreview(base,raster,{...o});await overrides.afterComposite?.(output);return output;},
    envelope(o){calls.textEnvelopes.push(o);return real.envelope(opts(o));}
  };
}
module.exports={Native,nativePath,fontRegistrations,fixture,install,service};
