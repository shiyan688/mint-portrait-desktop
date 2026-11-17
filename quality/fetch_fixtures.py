"""Fetch NASA-owned editorial test fixtures, not promotional product assets."""
import json, urllib.request, urllib.parse, hashlib
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent
manifest=[]
for key,nasa_id in [('victor','NHQ202009150002'),('suni','jsc2005e02663'),('eileen','KSC-99pp0310')]:
    url='https://images-api.nasa.gov/search?nasa_id='+urllib.parse.quote(nasa_id)
    data=json.load(urllib.request.urlopen(url,timeout=60))
    item=next(i for i in data['collection']['items'] if i['data'][0]['nasa_id']==nasa_id)
    image_url=next(i['href'] for i in item['links'] if i['rel']=='canonical')
    path=ROOT/'fixtures'/f'{key}-source.jpg'
    urllib.request.urlretrieve(image_url,path)
    info={**item['data'][0], 'id':key, 'source_api':url,'source_page':'https://images.nasa.gov/details/'+nasa_id,'source_file':image_url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'usage_guidelines':'https://www.nasa.gov/nasa-brand-center/images-and-media/', 'usage':'Non-commercial factual software-testing illustration. Source NASA; no endorsement. Edited comparisons are software output, not NASA images. Do not reuse as promotional material or product assets.'}
    manifest.append(info)
    print(key,Image.open(path).size,flush=True)
(ROOT/'fixtures'/'manifest.json').write_text(json.dumps(manifest,indent=2))
