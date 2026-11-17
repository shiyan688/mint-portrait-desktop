"""Actual PyMatting on known synthetic linear-light mixtures; not human benchmark."""
import json,pathlib,sys,hashlib
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'backend'))
from adapters.birefnet_foreground import estimate_foreground
from adapters.birefnet_quality import linear_to_rgb,rgb_to_linear
results=[]
y,x=np.mgrid[:128,:160];radius=np.sqrt(((x-80)/1.15)**2+(y-64)**2);alpha=np.clip((52-radius)/18,0,1).astype(np.float32)
foreground=np.broadcast_to(np.array([.18,.07,.035]),(128,160,3))
for name,color in [('white',[.95,.95,.95]),('blue',[.02,.16,.8])]:
 background=np.broadcast_to(np.array(color),(128,160,3));mixed=foreground*alpha[:,:,None]+background*(1-alpha[:,:,None]);rgb=np.floor(linear_to_rgb(mixed)*255+.5).astype(np.uint8);source=np.dstack((rgb,np.full(alpha.shape,255,np.uint8)));before=source.copy();reference=alpha.copy()
 corrected,meta=estimate_foreground(source,alpha,enabled=True);edge=(alpha>.05)&(alpha<.95)
 baselineError=np.abs(rgb_to_linear(rgb/255)[edge]-foreground[edge]).mean();correctedError=np.abs(rgb_to_linear(corrected[:,:,:3]/255)[edge]-foreground[edge]).mean()
 assert correctedError<baselineError*.25,(name,baselineError,correctedError)
 assert np.array_equal(source,before) and np.array_equal(alpha,reference) and np.array_equal(corrected[:,:,3],source[:,:,3])
 results.append({'background':name,'knownSyntheticAlpha':True,'baselineForegroundLinearMAD':float(baselineError),'estimatedForegroundLinearMAD':float(correctedError),'relativeError':float(correctedError/baselineError),'alphaUnchanged':True,'sourceUnchanged':True})
report={'scope':'Actual PyMatting optional helper on synthetic known-alpha/color mixtures, not learned-model accuracy or portrait benchmark','results':results};(ROOT/'quality/matting/synthetic-foreground-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
