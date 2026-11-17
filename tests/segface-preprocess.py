"""Opt-in official-transform parity check; no checkpoint or research code runs."""
from pathlib import Path
import json, sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from adapters.segface.adapter import preprocess_rgba

def main():
 import numpy as np
 import torch
 from PIL import Image
 from torchvision.transforms import functional as F, InterpolationMode
 torch.set_num_threads(2)
 rng=np.random.default_rng(0);results=[]
 for width,height in [(7,5),(512,512),(17,23),(646,783)]:
  rgba=rng.integers(0,256,size=(height,width,4),dtype=np.uint8);rgba[:,:,3]=255
  raw=rgba.tobytes();actual=preprocess_rgba(raw,width,height)
  pil=Image.frombytes('RGBA',(width,height),raw).convert('RGB')
  expected=F.normalize(F.to_tensor(F.resize(pil,(512,512),InterpolationMode.BICUBIC)),
                       mean=[.485,.456,.406],std=[.229,.224,.225]).unsqueeze(0)
  err=float((actual-expected).abs().max())
  assert actual.shape==(1,3,512,512) and err<=1e-6
  results.append({'inputWidth':width,'inputHeight':height,'maxAbsoluteError':err,
                  'actualShape':list(actual.shape),'bitIdentical':bool(torch.equal(actual,expected))})
 report={'status':'pass','scope':'own preprocessing versus official torchvision/PIL recipe only, not model inference',
         'fixtures':'synthetic opaque RGBA8','results':results}
 (ROOT/'quality/segface/preprocess-parity.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report))

if __name__=='__main__':main()
