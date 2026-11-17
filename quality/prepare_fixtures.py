import json,hashlib
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent
crops={'victor':(2070,0,3470,1950),'suni':(630,490,1610,1600),'eileen':(560,240,1470,1370)}
for key,box in crops.items():
 im=Image.open(ROOT/'fixtures'/f'{key}-source.jpg').convert('RGBA').crop(box)
 im.thumbnail((900,900),Image.Resampling.LANCZOS)
 im.save(ROOT/'fixtures'/f'{key}.png')
 (ROOT/'fixtures'/f'{key}.rgba').write_bytes(im.tobytes())
 (ROOT/'fixtures'/f'{key}.json').write_text(json.dumps({'id':key,'width':im.width,'height':im.height,'source_crop_xyxy':box,'crop_resize':'Lanczos fit in 900x900','fixture_sha256':hashlib.sha256(im.tobytes()).hexdigest()},indent=2))
