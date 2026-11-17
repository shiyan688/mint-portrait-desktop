"""Public local alpha A/B evaluation, no new model call or modified alpha."""
import argparse,hashlib,json,pathlib,resource,sys,time
import numpy as np
from PIL import Image,ImageDraw
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'backend'))
from adapters.birefnet_foreground import estimate_foreground
from adapters.birefnet_quality import composite
p=argparse.ArgumentParser();p.add_argument('--fixture',default='suni');p.add_argument('--profile',default='2048-bf16');a=p.parse_args()
source=np.array(Image.open(ROOT/'quality/fixtures'/f'{a.fixture}.png').convert('RGBA'));h,w=source.shape[:2]
run=ROOT/'quality/matting'/f'{a.fixture}-{a.profile}';raw=(run/'alpha.f32').read_bytes();alpha=np.frombuffer(raw,dtype='<f4').reshape(h,w);before=source.copy()
started=time.perf_counter();fg,meta=estimate_foreground(source,alpha,enabled=True);seconds=time.perf_counter()-started
assert np.array_equal(source,before) and alpha.tobytes()==raw and np.array_equal(fg[:,:,3],source[:,:,3])
(run/'foreground.rgba').write_bytes(fg.tobytes());Image.fromarray(fg).save(run/'foreground.png')
canvas=Image.new('RGB',(1800,1300),(22,22,22));draw=ImageDraw.Draw(canvas)
draw.text((10,8),f'{a.fixture}: same learned alpha. Top: original RGB; bottom: optional PyMatting1.1.16 foreground color estimate. Black/white/green.',fill='white')
draw.text((10,27),'Alpha is unchanged. This cannot repair erroneous subject/clothing removal. Public NASA software QA, not endorsement.',fill='white')
for row,rgb in enumerate([source[:,:,:3],fg[:,:,:3]]):
 for col,bg in enumerate([(0,0,0),(255,255,255),(12,160,60)]):
  comp=composite(rgb,alpha,np.array(bg,np.uint8));im=Image.fromarray(comp);im.thumbnail((600,600));canvas.paste(im,(col*600+(600-im.width)//2,55+row*620));
canvas.save(run/'foreground-ab.jpg',quality=95)
if a.fixture=='suni':
 box=(480,60,795,650)
else:box=(0,0,min(w,650),min(h,650))
cols=[source[:,:,:3],np.repeat(np.floor(alpha[:,:,None]*255+.5).astype(np.uint8),3,2),composite(source[:,:,:3],alpha,np.array([12,160,60],np.uint8)),composite(fg[:,:,:3],alpha,np.array([12,160,60],np.uint8))]
width,height=box[2]-box[0],box[3]-box[1];crop=Image.new('RGB',(width*4,height+35));d=ImageDraw.Draw(crop)
for i,(img,label) in enumerate(zip(cols,['source','same alpha','source RGB composite','estimated RGB composite'])):crop.paste(Image.fromarray(img).crop(box),(i*width,35));d.text((i*width+3,8),label,fill='white')
crop.save(run/'foreground-edge-native.jpg',quality=97)
meta.update({'seconds':seconds,'peakRSSKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'sourceUnchanged':True,'sourceAlphaBytesPreserved':True,'alphaUnchanged':True,'alphaSha256':hashlib.sha256(raw).hexdigest(),'foregroundSha256':hashlib.sha256(fg.tobytes()).hexdigest(),'verification':'direct optional helper on saved actual learned alpha; not yet full worker foreground-plane integration'})
(run/'foreground-summary.json').write_text(json.dumps(meta,indent=2));print(json.dumps(meta),flush=True)
