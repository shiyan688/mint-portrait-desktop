import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
TAG=sys.argv[1] if len(sys.argv)>1 else 'candidate'
OUT=ROOT/'comparisons'/TAG
run=json.loads((OUT/'run.json').read_text())
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
for r in run['results']:
 path=OUT/f"{r['id']}-{r['name']}"
 Image.frombytes('RGBA',(r['width'],r['height']),path.with_suffix('.rgba').read_bytes()).save(path.with_suffix('.png'))
variants=['original','brighten25','brighten50','brighten100','smooth100','combined100']
for id in ['victor','suni','eileen']:
 sheet=Image.new('RGB',(1800,1296),(245,246,248));draw=ImageDraw.Draw(sheet)
 for j,name in enumerate(variants):
  im=Image.open(OUT/f'{id}-{name}.png').convert('RGB');im.thumbnail((580,570))
  x=(j%3)*600;y=(j//3)*615
  draw.text((x+12,y+10),f'{id} / {name} / {TAG}',font=font,fill=(15,30,40))
  sheet.paste(im,(x+(600-im.width)//2,y+42))
 draw.text((12,1240),'Source photos: NASA. Edited comparison: Mint Portrait pixel engine. Factual test illustration; no endorsement.',font=small,fill=(35,50,60))
 draw.text((12,1266),'Cropped real photographs; actual offline MediaPipe 478 landmarks. See fixtures/manifest.json for provenance.',font=small,fill=(35,50,60))
 sheet.save(OUT/f'{id}-contact-sheet.jpg',quality=94)
# A concise before / previous maximum / repaired maximum sheet, all public fixtures.
if (ROOT/'comparisons/baseline/run.json').exists() and TAG!='baseline':
 sheet=Image.new('RGB',(1440,1818),(245,246,248));draw=ImageDraw.Draw(sheet)
 for row,id in enumerate(['victor','suni','eileen']):
  for col,(tag,name,label) in enumerate([(TAG,'original','Original'),('baseline','brighten100','Previous +100'),(TAG,'brighten100','Repaired +100')]):
   im=Image.open(ROOT/'comparisons'/tag/f'{id}-{name}.png').convert('RGB');im.thumbnail((468,540))
   x=col*480;y=row*590
   draw.text((x+12,y+10),f'{id}: {label}',font=font,fill=(15,30,40));sheet.paste(im,(x+(480-im.width)//2,y+42))
 draw.text((12,1775),'Source photos: NASA. Test edits by Mint Portrait; no endorsement. Not promotional product assets.',font=small,fill=(35,50,60))
 sheet.save(OUT/'public-before-old-new.jpg',quality=94)
