"""Render actual optional foreground plane at0/.5/1 without re-inference."""
import argparse,hashlib,json,pathlib,sys
import numpy as np
from PIL import Image,ImageDraw
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'backend'))
from adapters.birefnet_foreground import blend_foreground_strength
from adapters.birefnet_quality import composite,diagnostic_grid
p=argparse.ArgumentParser();p.add_argument('--fixture',required=True);p.add_argument('--profile',default='2048-bf16');a=p.parse_args()
s=np.array(Image.open(ROOT/'quality/fixtures'/f'{a.fixture}.png').convert('RGBA'));h,w=s.shape[:2];run=ROOT/'quality/matting'/f'{a.fixture}-{a.profile}';alpha=np.fromfile(run/'alpha.f32','<f4').reshape(h,w);fg=np.fromfile(run/'foreground.rgba',np.uint8).reshape(h,w,4)
r=json.loads((run/'response.json').read_text());meta=r.get('provenance',{}).get('foregroundRefinement') or json.loads((run/'foreground-summary.json').read_text())
canvas=Image.new('RGB',(1350,1080),(20,20,20));d=ImageDraw.Draw(canvas);d.text((8,8),f'{a.fixture}: actual learned HR alpha + optional classical foreground color estimation. Columns strength0 /0.5 /1; white /green.',fill='white');d.text((8,26),'Same alpha in every panel, original unchanged. Does not repair incorrect subject-alpha. Not a SOTA quality certificate.',fill='white')
strengths=[0,.5,1];variants=[];summ=[]
for col,strength in enumerate(strengths):
 v=blend_foreground_strength(s,fg,alpha,meta,strength);variants.append(v)
 assert np.array_equal(v[:,:,3],s[:,:,3]);assert np.array_equal(v[alpha==1],s[alpha==1])
 if strength==0:assert np.array_equal(v,s)
 for row,color in enumerate([(255,255,255),(12,160,60)]):
  c=composite(v[:,:,:3],alpha,np.array(color,np.uint8));im=Image.fromarray(c);im.thumbnail((450,500));canvas.paste(im,(col*450+(450-im.width)//2,60+row*510))
 summ.append({'strength':strength,'foregroundRgbaSha256':hashlib.sha256(v.tobytes()).hexdigest(),'originalAlphaPreserved':True,'fullyOpaquePixelsProtected':True})
canvas.save(run/'foreground-strengths-0-50-100.jpg',quality=95)
if a.fixture=='suni':box=(480,60,795,650)
elif a.fixture=='eileen':box=(90,0,660,260)
else:box=(770,180,1020,465)
cw,ch=box[2]-box[0],box[3]-box[1];crop=Image.new('RGB',(cw*3,ch*2+55),(20,20,20));dr=ImageDraw.Draw(crop)
for col,(strength,v) in enumerate(zip(strengths,variants)):
 dr.text((col*cw+4,7),f'strength {strength} / green then white',fill='white')
 for row,color in enumerate([(12,160,60),(255,255,255)]):crop.paste(Image.fromarray(composite(v[:,:,:3],alpha,np.array(color,np.uint8))).crop(box),(cw*col,35+row*ch))
crop.save(run/'foreground-strengths-edge-native.jpg',quality=97)
Image.fromarray(np.floor(alpha*65535+.5).astype(np.uint16)).save(run/'alpha16.png');Image.fromarray(np.floor(alpha*255+.5).astype(np.uint8)).save(run/'alpha8.png')
g=diagnostic_grid(s[:,:,:3],alpha,cell=500);can=Image.new('RGB',(g.width,g.height+40),(20,20,20));can.paste(g,(0,40));ImageDraw.Draw(can).text((8,10),f'{a.fixture} actual HR2048 mixed-BF16 learnedalpha. Top source/alpha/black; bottom white/green/purple. Original RGB, no decontamination.',fill='white');can.save(run/'comparison.jpg',quality=94)
(run/'strength-summary.json').write_text(json.dumps({'alphaDigest':meta['alphaDigest'],'sourceDigest':meta['sourceDigest'],'inputUnchanged':True,'alphaUnchanged':True,'variants':summ},indent=2))
