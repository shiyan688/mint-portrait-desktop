"""Independent pixel-delta diagnostics supplement, not replace, visual review."""
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter,ImageFont
import numpy as np
ROOT=Path(__file__).resolve().parent
TAG=sys.argv[1] if len(sys.argv)>1 else 'candidate'
OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
FEATURES=[[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],[70,63,105,66,107,55,65,52,53,46],[336,296,334,293,300,276,283,282,295,285]]
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
metrics=[]
for id in ['victor','suni','eileen']:
 im=Image.open(ROOT/'fixtures'/f'{id}.png').convert('RGB');a=np.asarray(im).astype(float);w,h=im.size
 face=json.loads((ROOT/'fixtures'/f'{id}.landmarks.json').read_text())['faces'][0]
 def poly(ids):
  mask=Image.new('L',(w,h));ImageDraw.Draw(mask).polygon([(face[i]['x']*(w-1),face[i]['y']*(h-1)) for i in ids],fill=255);return mask
 oval=poly(OVAL);features=Image.new('L',(w,h))
 for ids in FEATURES:features=Image.fromarray(np.maximum(np.asarray(features),np.asarray(poly(ids))))
 core=np.asarray(features.filter(ImageFilter.MinFilter(5)))>0
 face_boundary=(np.asarray(oval.filter(ImageFilter.MaxFilter(7)))>0)&(np.asarray(oval.filter(ImageFilter.MinFilter(7)))==0)
 feature_boundary=(np.asarray(features.filter(ImageFilter.MaxFilter(7)))>0)&(np.asarray(features.filter(ImageFilter.MinFilter(7)))==0)
 boundary=face_boundary|feature_boundary
 skin=(np.asarray(oval.filter(ImageFilter.MinFilter(21)))>0)&(np.asarray(features.filter(ImageFilter.MaxFilter(17)))==0)
 result={'id':id,'actualLandmarks':len(face)}
 for tag in ['baseline',TAG]:
  d=np.asarray(Image.open(ROOT/'comparisons'/tag/f'{id}-brighten100.png').convert('RGB')).astype(float)-a
  grad=np.zeros((h,w));grad[:-1,:-1]=np.maximum(np.max(np.abs(d[1:,:-1]-d[:-1,:-1]),axis=2),np.max(np.abs(d[:-1,1:]-d[:-1,:-1]),axis=2))
  out=a+d;lum=out@np.array([.2126,.7152,.0722])-(a@np.array([.2126,.7152,.0722]))
  spread_a=(a.max(2)-a.min(2));spread_b=(out.max(2)-out.min(2));valid=skin&(spread_a>15)
  result[tag]={'boundary_delta_gradient_p95':round(float(np.quantile(grad[boundary],.95)),3),'boundary_delta_gradient_max':round(float(grad[boundary].max()),3),'feature_core_max_channel_change':float(np.abs(d[core]).max()),'face_core_mean_luma_lift':round(float(lum[skin].mean()),3),'face_core_mean_chroma_spread_ratio':round(float(np.mean(spread_b[valid]/spread_a[valid])),3),'changed_pixels':int(np.any(d!=0,axis=2).sum())}
 # Per-frame native-resolution crops: eye/eyebrow/forehead, lower cheek/lips/jaw, hairline.
 x0=min(p['x'] for p in face)*w;x1=max(p['x'] for p in face)*w
 y0=min(p['y'] for p in face)*h;y1=max(p['y'] for p in face)*h
 regions=[('forehead-eyes',(max(0,int(x0)-20),max(0,int(y0)-40),min(w,int(x1)+20),int(y0+(y1-y0)*.47))),('lips-jaw',(max(0,int(x0)-20),int(y0+(y1-y0)*.58),min(w,int(x1)+20),min(h,int(y1)+30)))]
 for region,box in regions:
  crops=[]
  for tag,name,label in [(TAG,'original','Original'),('baseline','brighten100','Previous +100'),(TAG,'brighten100','Repaired +100'),(TAG,'combined100','Repaired smooth100 +100')]:
   crop=Image.open(ROOT/'comparisons'/tag/f'{id}-{name}.png').convert('RGB').crop(box)
   canvas=Image.new('RGB',(crop.width,crop.height+32),'white');canvas.paste(crop,(0,32));ImageDraw.Draw(canvas).text((6,6),label,font=font,fill='black');crops.append(canvas)
  sheet=Image.new('RGB',(max(c.width for c in crops)*2,max(c.height for c in crops)*2),'white')
  for j,c in enumerate(crops):sheet.paste(c,((j%2)*c.width,(j//2)*c.height))
  sheet.save(ROOT/'comparisons'/TAG/f'{id}-{region}-native.jpg',quality=97)
 metrics.append(result)
(ROOT/'comparisons'/TAG/'pixel-diagnostics.json').write_text(json.dumps(metrics,indent=2));print(json.dumps(metrics,indent=2))
