#!/usr/bin/env python3
"""Public-fixture-only, bounded model worker evaluation; no downloads or private inputs."""
import argparse, hashlib, io, json, pathlib, resource, struct, subprocess, sys, time
import numpy as np
from PIL import Image, ImageDraw
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from adapters.birefnet_quality import diagnostic_grid
from adapters.birefnet_support import alpha_statistics

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def manifest(side=2048):
    root=ROOT/'backend/models/birefnet-hr-matting'
    names={'weights':'model.safetensors','birefnetCode':'birefnet.py','birefnetConfig':'BiRefNet_config.py','modelConfig':'config.json','license':'LICENSE-BiRefNet.txt'}
    assets=[{'name':n,'relativePath':f,'sha256':sha(root/f)} for n,f in names.items()]
    return {'id':'ZhengPeng7/BiRefNet_HR-matting','version':'5d6b6f8adcb5b417c871b1d84ceaae9871355b7f','kind':'model','adapter':'birefnet','tasks':['matting'],'weightsAsset':'weights','weightsSha256':assets[0]['sha256'],'modelRoot':str(root),'assets':assets,'devices':['cpu','cuda'],'license':{'id':'MIT','url':'https://github.com/ZhengPeng7/BiRefNet/blob/97e4f35d74043427b0e9ba935ca10991853a36bc/LICENSE','status':'approved'},'requiredPackages':['torch','torchvision','numpy','Pillow','timm','transformers','kornia','einops','safetensors'],'enabled':True,'config':{'executionApproved':True,'modelRevision':'5d6b6f8adcb5b417c871b1d84ceaae9871355b7f','inputSize':side,'precision':'float32','threads':4,'sourceDir':str(root)}}

def main():
    p=argparse.ArgumentParser();p.add_argument('--fixture',default='suni');p.add_argument('--side',type=int,default=512);p.add_argument('--timeout',type=int,default=900);p.add_argument('--probe',action='store_true');p.add_argument('--precision',choices=['float32','bfloat16'],default='float32');a=p.parse_args()
    out=ROOT/'quality/matting'/(f'{a.fixture}-{a.side}'+('' if a.precision=='float32' else '-bf16'));out.mkdir(parents=True,exist_ok=True)
    m=manifest(a.side);m['config']['precision']=a.precision;(out/'manifest.json').write_text(json.dumps(m,indent=2))
    if a.probe:
        head={'protocol':1,'op':'probe','requiredPackages':m['requiredPackages'],'payloadBytes':0};payload=b''
    else:
        source=ROOT/'quality/fixtures'/f'{a.fixture}.png'
        rgba=np.array(Image.open(source).convert('RGBA'));h,w=rgba.shape[:2]
        payload=rgba.tobytes()+np.ones((h,w),dtype='<f4').tobytes()
        head={'protocol':1,'op':'infer','manifest':m,'maxPixels':16777216,'maxPayloadBytes':536870912,'payloadBytes':len(payload),'request':{'jobId':f'public-{a.fixture}-{a.side}','task':'matting','model':{k:m[k] for k in ('id','version','kind','weightsSha256')},'originalSize':{'width':w,'height':h},'roi':{'x':0,'y':0,'width':w,'height':h},'sourceBytes':w*h*4,'maskBytes':w*h*4}}
        head['request']['model']['device']={'kind':'cpu','name':'CPU (x86_64)'}
    encoded=json.dumps(head).encode();frame=struct.pack('>I',len(encoded))+encoded+payload
    cmd=[str(ROOT/'backend/.venv/bin/python'),'-I',str(ROOT/'backend/worker.py')]
    start=time.perf_counter()
    result=subprocess.run(cmd,input=frame,capture_output=True,timeout=a.timeout)
    (out/'worker.stderr.txt').write_bytes(result.stderr)
    elapsed=time.perf_counter()-start
    if len(result.stdout)<4:
        (out/'run-failure.json').write_text(json.dumps({'wallSeconds':elapsed,'exitCode':result.returncode,'stdoutBytes':len(result.stdout),'childPeakRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}));raise RuntimeError('Worker returned no frame: '+result.stderr.decode()[-2000:])
    length=struct.unpack('>I',result.stdout[:4])[0];response=json.loads(result.stdout[4:4+length]);body=result.stdout[4+length:]
    (out/'response.json').write_text(json.dumps(response,indent=2))
    print(json.dumps({'wallSeconds':elapsed,'exitCode':result.returncode,'response':response}),flush=True)
    if not response.get('ok'): raise RuntimeError('Model inference failed; see worker stderr')
    if a.probe:return
    assert len(body)==w*h*4 and response['width']==w and response['height']==h
    alpha=np.frombuffer(body,dtype='<f4').reshape(h,w)
    (out/'alpha.f32').write_bytes(body)
    Image.fromarray(np.floor(alpha*65535+.5).astype(np.uint16)).save(out/'alpha16.png')
    Image.fromarray(np.floor(alpha*255+.5).astype(np.uint8)).save(out/'alpha8.png')
    grid=diagnostic_grid(rgba[:,:,:3],alpha,cell=600)
    canvas=Image.new('RGB',(grid.width,grid.height+65),(20,20,20));canvas.paste(grid,(0,65));draw=ImageDraw.Draw(canvas)
    draw.text((10,8),f'Public NASA test: {a.fixture} | BiRefNet HR-matting | network {a.side} | CPU {a.precision} | alpha only, NO color decontamination',fill='white')
    draw.text((10,28),'Top: source / continuous alpha / black. Bottom: white / green / purple. No reference alpha: no accuracy score.',fill='white')
    canvas.save(out/'comparison.jpg',quality=94)
    summary={'fixture':a.fixture,'sourceSha256':sha(source),'networkSize':a.side,'precision':a.precision,'profile':'HR-2048' if a.side==2048 else 'diagnostic-not-HR-quality','wallSeconds':elapsed,'childPeakRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'sourceWidth':w,'sourceHeight':h,'alphaStats':alpha_statistics(alpha),'groundTruthAvailable':False,'foregroundDecontamination':False,'modelSha256':m['weightsSha256']}
    (out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)
if __name__=='__main__':main()
