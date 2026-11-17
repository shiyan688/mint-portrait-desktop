"""Diagnostic metrics, not calibrated perceptual/clinical benchmark scores."""
from pathlib import Path
import json, gzip
import numpy as np
q=Path(__file__).resolve().parents[2]/'quality/manual-tools-qa'
r=json.loads((q/'synthetic-skin-variants.json').read_text());w,h=r['width'],r['height'];full=np.frombuffer(gzip.decompress((q/'fixtures/05_mukai.rgba.gz').read_bytes()),np.uint8).reshape(h,w,4)
p=r['results'][0]['target'];cx,cy=p['x']*(w-1),p['y']*(h-1);x0,y0=int(cx)-48,int(cy)-48
truth=full[y0:y0+96,x0:x0+96,:3].astype(float)
y,x=np.mgrid[y0:y0+96,x0:x0+96];radius=.018*min(w,h);distance=np.hypot(x-cx,y-cy);core=distance<.7*radius;ring=(distance>.7*radius)&(distance<1.1*radius)
t=np.arange(-9,10);kernel=np.exp(-.5*(t/3)**2);kernel/=kernel.sum()
def blur(a):
 a=np.apply_along_axis(lambda z:np.convolve(np.pad(z,(9,9),mode='reflect'),kernel,'valid'),0,a)
 return np.apply_along_axis(lambda z:np.convolve(np.pad(z,(9,9),mode='reflect'),kernel,'valid'),1,a)
def y_channel(a):return a@np.array([.2126,.7152,.0722])
def texture(a):
 y=y_channel(a);return float(np.sqrt(np.mean((y-blur(y))[core]**2)))
base_texture=texture(truth)
base_luma=y_channel(truth)
rows=[]
for case in r['results']:
 raw=[]
 for kind in ['dirty','healed']:
  raw.append(np.frombuffer(gzip.decompress((q/(case['variant']+'-'+kind+'.rgba.gz')).read_bytes()),np.uint8).reshape(h,w,4)[y0:y0+96,x0:x0+96,:3].astype(float))
 affected=np.any(raw[0]!=truth,axis=2)
 values=[]
 for kind,a in zip(['before','after'],raw):
  delta=blur(a)-blur(truth);rg=delta[:,:,0]-delta[:,:,1];yb=(delta[:,:,0]+delta[:,:,1])*.5-delta[:,:,2]
  luminance_delta=y_channel(a-truth);gx=np.diff(luminance_delta,axis=1);gy=np.diff(luminance_delta,axis=0);edges=np.concatenate([np.abs(gx)[ring[:,:-1]],np.abs(gy)[ring[:-1,:]]])
  values.append({'phase':kind,'lowFrequencyChromaRMS':float(np.sqrt(np.mean((rg**2+yb**2)[affected]))),'lowFrequencyRedMinusGreenBias':float(rg[affected].mean()),'lowFrequencyLuminanceBias':float(y_channel(delta)[affected].mean()),'textureHighPassRMS':texture(a),'textureRatioToOriginal':texture(a)/base_texture,'boundaryAddedLumaGradientMean':float(edges.mean()),'boundaryAddedLumaGradientP95':float(np.percentile(edges,95))})
 rows.append({'variant':case['variant'],'metrics':values,'chromaResidualReductionFraction':1-values[1]['lowFrequencyChromaRMS']/values[0]['lowFrequencyChromaRMS']})
out={'note':'Custom diagnostic metrics, not a validated perceptual, identity, skin or SOTA benchmark. One portrait, three artificial overlays; metrics must be read with contact sheets.','definitions':{'lowFrequency':'sigma3px separable Gaussian, 19tap; sRGB code values, no CIELAB/perceptual calibration','chroma':'R-G and (R+G)/2-B opponent values after blur, RMS over injected-overlay footprint','texture':'luma highpass RMS using same sigma3 blur, within0.7 brush radius; ratio to untouched original','seam':'absolute x/y first differences of result-minus-original luma in0.7–1.1 brush-radius band; p95 is not worst-case or universal seam acceptance'},'originalTextureHighPassRMS':base_texture,'testedSha256':r['testedSha256'],'results':rows}
(q/'synthetic-skin-diagnostics.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
