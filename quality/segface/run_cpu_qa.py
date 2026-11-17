"""Authorized SegFace CPU experiment on existing NASA public QA portraits.

No private images, network calls, auto-downloads, or output photo retouching.
Saved overlays are diagnostic software output, not endorsed NASA images.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import platform
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from adapters.segface.adapter import infer, close, CLASSES, _MANIFEST, patched_network_ast


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    import numpy as np
    import torch
    import torchvision
    from PIL import Image, ImageDraw
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    out = ROOT / 'quality' / 'segface'
    model_root = ROOT / 'backend' / 'models' / 'segface-mobilenet-celeba-512'
    checkpoint = model_root / 'model_299.pt'
    asset = _MANIFEST['weights']['variants']['mobilenet']
    assert checkpoint.stat().st_size == asset['bytes'] and digest(checkpoint) == asset['sha256']
    source = model_root / 'source'
    for relative, meta in _MANIFEST['code']['files'].items():
        p = source / relative
        assert p.stat().st_size == meta['bytes'] and digest(p) == meta['sha256']
    patched_network_ast((source / 'network/models/segface_celeb.py').read_bytes())
    sources = {s['id']: s for s in json.loads((ROOT/'quality/fixtures/manifest.json').read_text())}
    report = {'schemaVersion':1, 'status':'running', 'device':'cpu', 'gpuTested':False,
              'runtime':{'python':platform.python_version(),'torch':torch.__version__,
                         'torchvision':torchvision.__version__,'numpy':np.__version__,
                         'pillow':Image.__version__,'platform':platform.platform(),'torchThreads':2},
              'model':{'variant':'mobilenet','weightsSha256':asset['sha256'],'checkpointBytes':asset['bytes'],
                       'codeRevision':_MANIFEST['code']['revision'],'weightsRevision':_MANIFEST['weights']['revision']},
              'limitations':['Three public frontal portraits only, not a benchmark or segmentation accuracy measurement.',
                            'MediaPipe-derived selected-face ROI is product crop policy, not a learned SegFace detector.',
                            'CPU timings in a shared cloud environment, not RTX 4060 or Windows measurements.',
                            'Saved class maps are diagnostic overlays; no original portrait pixels were modified.'],
              'fixtures':[]}
    palette = np.array([[0,0,0],[150,90,70],[40,205,110],[115,80,180],[230,140,90],[200,120,65],
                        [70,90,240],[100,130,255],[0,205,255],[80,230,255],[255,130,30],[220,0,130],
                        [255,35,165],[255,100,195],[255,205,0],[255,0,0],[160,220,15],[200,70,255],[180,180,255]],dtype=np.uint8)
    cells=[]
    for index, name in enumerate(['victor','suni','eileen']):
        print('Starting CPU fixture:', name, flush=True)
        folder=out/name;folder.mkdir(exist_ok=True)
        imgpath=ROOT/'quality/fixtures'/f'{name}.png'
        rawpath=ROOT/'quality/fixtures'/f'{name}.rgba'
        meta=json.loads((ROOT/'quality/fixtures'/f'{name}.json').read_text())
        lm=json.loads((ROOT/'quality/fixtures'/f'{name}.landmarks.json').read_text())
        assert digest(imgpath)==lm['image_sha256']
        assert digest(rawpath)==meta['fixture_sha256']
        image=Image.open(imgpath).convert('RGBA');w,h=image.size
        assert image.tobytes()==rawpath.read_bytes()
        pts=lm['faces'][0];xs=[p['x']*w for p in pts];ys=[p['y']*h for p in pts]
        bw,bh=max(xs)-min(xs),max(ys)-min(ys)
        x0=max(0,math.floor(min(xs)-0.30*bw));x1=min(w,math.ceil(max(xs)+0.30*bw))
        y0=max(0,math.floor(min(ys)-0.45*bh));y1=min(h,math.ceil(max(ys)+0.20*bh))
        roi={'x':x0,'y':y0,'width':x1-x0,'height':y1-y0}
        crop=image.crop((x0,y0,x1,y1));raw=crop.tobytes();before=hashlib.sha256(raw).hexdigest()
        request={'task':'parse','jobId':'segface-cpu-qa-'+name,'originalSize':{'width':w,'height':h},'roi':roi,
                 'source':{'width':crop.width,'height':crop.height,'data':raw},'mask':None,
                 'selection':{'kind':'detected-face','faceId':name+'-face-0','revision':digest(imgpath)},
                 'model':{'id':'segface-mobilenet-celeba-512','version':_MANIFEST['weights']['revision'],
                          'weightsSha256':asset['sha256'],'device':{'kind':'cpu','name':'cloud CPU'}},
                 'assets':{'checkpoint':str(checkpoint)},
                 'config':{'variant':'mobilenet','sourceDir':str(source),'executionApproved':True}}
        started=time.perf_counter();result=infer(request);seconds=time.perf_counter()-started
        assert result['width']==crop.width and result['height']==crop.height and result['classes']==list(CLASSES)
        assert before==hashlib.sha256(raw).hexdigest()
        probs=np.frombuffer(result['data'],dtype='<f4').reshape(19,crop.height,crop.width)
        assert np.isfinite(probs).all() and probs.min()>=0 and probs.max()<=1
        normalization_error=float(np.max(np.abs(probs.sum(axis=0)-1)))
        assert normalization_error<1e-5
        labels=probs.argmax(axis=0).astype(np.uint8)
        Image.fromarray(labels).save(folder/'label-indices.png')
        rgb=np.asarray(crop.convert('RGB'));colors=palette[labels]
        Image.fromarray(colors).save(folder/'class-colors.png')
        Image.fromarray(np.round(rgb*.55+colors*.45).astype(np.uint8)).save(folder/'class-overlay.png')
        Image.fromarray(np.round(probs[2]*65535).astype(np.uint16)).save(folder/'skin-probability-16bit.png')
        protected=np.clip(probs[[6,7,8,9,11,12,13,14,15,16]].sum(axis=0),0,1)
        Image.fromarray(np.round(protected*65535).astype(np.uint16)).save(folder/'protected-probability-16bit.png')
        # Diagnostic alpha overlays, not retouch edits or claimed ground truth.
        alpha=(probs[2]*.60)[...,None]
        skin_rgb=np.round(rgb*(1-alpha)+np.array([25,240,130])*alpha).astype(np.uint8)
        Image.fromarray(skin_rgb).save(folder/'skin-overlay.png')
        pp=(protected*.65)[...,None]
        protect_rgb=np.round(rgb*(1-pp)+np.array([245,60,190])*pp).astype(np.uint8)
        Image.fromarray(protect_rgb).save(folder/'protected-overlay.png')
        whole=np.asarray(image.convert('RGB')).copy();whole[y0:y1,x0:x1]=np.round(rgb*.55+colors*.45).astype(np.uint8)
        Image.fromarray(whole).save(folder/'original-coordinates-overlay.png')
        crop.convert('RGB').save(folder/'input-face-roi.png')
        (folder/'probabilities.f32le').write_bytes(result['data'])
        stats={CLASSES[i]:{'argmaxPixels':int(np.count_nonzero(labels==i)),'meanProbability':float(probs[i].mean())} for i in range(19)}
        record={'id':name,'source':sources[name],'fixturePngSha256':digest(imgpath),'roi':roi,
                'selection':request['selection'],'secondsIncludingLoad':seconds,'coldModelLoad':index==0,
                'outputDimensions':[crop.width,crop.height],'outputBytes':len(result['data']),
                'probabilitySumMaxError':normalization_error,'inputUnchanged':True,'classStats':stats,
                'provenance':{'weightsSha256':asset['sha256'],'codeRevision':_MANIFEST['code']['revision'],
                              'device':'cpu','inputSha256':before,'outputSha256':hashlib.sha256(result['data']).hexdigest()}}
        (folder/'result.json').write_text(json.dumps(record,indent=2)+'\n')
        report['fixtures'].append(record)
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'fixture':name,'seconds':seconds,'roi':roi,'skinPixels':stats['skin']['argmaxPixels'],
                          'sumError':normalization_error,'output':str(folder/'class-overlay.png')}),flush=True)
        cells.append((name,[crop.convert('RGB'),Image.fromarray(colors),Image.fromarray(skin_rgb),Image.fromarray(protect_rgb)]))
    tilew,tileh=320,380
    sheet=Image.new('RGB',(tilew*4,tileh*len(cells)+50),'white');draw=ImageDraw.Draw(sheet)
    for col,title in enumerate(['Original face ROI','Learned class labels','Skin probability (green)','Protected eyes/lips/hair (pink)']):draw.text((col*tilew+6,6),title,fill='black')
    for row,(name,images) in enumerate(cells):
        for col,im in enumerate(images):
            im.thumbnail((tilew-12,tileh-30));px=col*tilew+(tilew-im.width)//2;py=30+row*tileh
            sheet.paste(im,(px,py));draw.text((col*tilew+6,py+tileh-23),name+' | diagnostic output, no NASA endorsement',fill='black')
    sheet.save(out/'contact-sheet.jpg',quality=93)
    report['status']='cpu_inference_complete_pending_independent_visual_review'
    report['maxRssKiBLinux']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    report['classPaletteRgb']=palette.tolist()
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    close();print('Completed all three public CPU fixtures:',str(out/'contact-sheet.jpg'),flush=True)

if __name__=='__main__':main()
