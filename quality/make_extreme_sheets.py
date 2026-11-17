import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'comparisons'/(sys.argv[1] if len(sys.argv)>1 else 'final')
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for r in json.loads((OUT/'extremes.json').read_text())['results']:
 path=OUT/f"{r['id']}-{r['name']}";Image.frombytes('RGBA',(r['width'],r['height']),path.with_suffix('.rgba').read_bytes()).save(path.with_suffix('.png'))
for id in ['victor','suni','eileen']:
 for suffix,variants,cols in [('reshape-extremes',['original','slim100','eyes100','nose100','nose-100','jaw100','jaw-100','reshape100','reshapeMixed'],3),('warmth-extremes',['original','combined100','warm100','cool100'],2)]:
  rows=(len(variants)+cols-1)//cols;sheet=Image.new('RGB',(500*cols,560*rows),'white');d=ImageDraw.Draw(sheet)
  for j,name in enumerate(variants):
   im=Image.open(OUT/f'{id}-{name}.png').convert('RGB');im.thumbnail((480,510));x=(j%cols)*500;y=(j//cols)*560;d.text((x+10,y+8),f'{id}: {name}',font=font,fill='black');sheet.paste(im,(x+(500-im.width)//2,y+36))
  sheet.save(OUT/f'{id}-{suffix}.jpg',quality=94)
# Public compact Chinese-labeled factual QA sheet. No private input.
font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',25,index=2)
small=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',18,index=2)
sheet=Image.new('RGB',(1440,1878),(245,246,248));d=ImageDraw.Draw(sheet)
d.text((20,8),'真实照片对照 · 同一原图、同一人脸关键点，仅改变提亮算法',font=font,fill=(15,30,40))
for row,id in enumerate(['victor','suni','eileen']):
 for col,(tag,name,label) in enumerate([(OUT.name,'original','原图'),('baseline','brighten100','旧版提亮 +100'),(OUT.name,'brighten100','修复版提亮 +100')]):
  im=Image.open(ROOT/'comparisons'/tag/f'{id}-{name}.png').convert('RGB');im.thumbnail((468,540));x=col*480;y=50+row*590
  d.text((x+12,y+5),label,font=font,fill=(15,30,40));sheet.paste(im,(x+(480-im.width)//2,y+42))
d.text((16,1820),'原始照片：NASA。编辑对比：Mint Portrait。仅作软件测试说明，不代表 NASA 认可或推荐。',font=small,fill=(35,50,60))
d.text((16,1850),'公开测试照片，不是用户上传的照片。人物：Victor Glover / Suni Williams / Eileen Collins。',font=small,fill=(35,50,60))
sheet.save(OUT/'public-before-old-new-zh.jpg',quality=91,optimize=True)
