'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createDesktopBackend } = require('../desktop-backend.cjs');
const { createBackendSession } = require('../src/backend-contracts.cjs');
const python = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, process.platform === 'win32' ? 'python.exe' : 'python3')).find(file => {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hasCode = expected => failure => failure && failure.code === expected;

// Locally authored fixture only, never copied into shipped adapter directories or labelled inference.
const fixturePython = String.raw`
import sys,json,struct,time,signal,pathlib,hashlib
size=struct.unpack('>I',sys.stdin.buffer.read(4))[0]
h=json.loads(sys.stdin.buffer.read(size))
body=sys.stdin.buffer.read(h['payloadBytes'])
def send(value,data=b''):
    encoded=json.dumps(dict(value,payloadBytes=len(data))).encode()
    sys.stdout.buffer.write(struct.pack('>I',len(encoded))+encoded+data)
    sys.stdout.buffer.flush()
if h['op']=='probe':
    send({'ok':True,'probe':{'runtime':{'available':True,'version':'fixture-not-inference'},'devices':[{'kind':'cpu','name':'Fixture CPU','available':True},{'kind':'cuda','name':'CUDA','available':False,'reason':'No fixture CUDA'}],'packages':{p:'fixture' for p in h['requiredPackages']},'adapters':{'segface':True,'birefnet':True,'generative':True}}})
else:
    r=h['request'];m=r['model'];roi=r['roi'];n=roi['width']*roi['height']
    behavior=h['manifest']['config'].get('fixtureBehavior','normal')
    pathlib.Path(__file__).with_name('inference-started').write_text('fixture only')
    if behavior=='hold' or (behavior=='hold-first' and r['jobId'].endswith('-job-1')):
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        time.sleep(30)
    if behavior=='crash':sys.exit(9)
    if behavior=='oversize':
        sys.stdout.buffer.write(b'x'*(h['maxPayloadBytes']+65541));sys.stdout.buffer.flush();sys.exit(0)
    p={'jobId':r['jobId'],'task':r['task'],'modelId':m['id'],'modelVersion':m['version'],'weightsSha256':m['weightsSha256'],'kind':m['kind'],'device':m['device'],'executionProfile':h['manifest']['executionProfile']}
    if r['task']=='parse':p['selection']=r['selection']
    if behavior=='wrong-provenance':p['weightsSha256']='0'*64
    if behavior=='wrong-profile':p['executionProfile']['precision']='unexpected'
    if behavior=='wrong-selection':p['selection']={'kind':'user-face-roi','faceId':'wrong','revision':'wrong'}
    out={'ok':True,'width':roi['width'],'height':roi['height'],'provenance':p}
    if r['task']=='parse':
        out.update(kind='parsing',classes=['skin','background'])
        data=struct.pack('<'+'f'*(n*2),*([0.25]*n+[0.75]*n))
        if behavior=='nan':data=struct.pack('<f',float('nan'))+data[4:]
    elif r['task']=='matting':
        out['kind']='matte';data=struct.pack('<'+'f'*n,*([0.5]*n))
        if behavior=='nan':data=struct.pack('<f',float('nan'))+data[4:]
        if behavior=='check-full-mask':
            assert all(v==1.0 for v in struct.unpack('<'+'f'*n,body[r['sourceBytes']:]))
    else:
        out['kind']='image';data=body[:r['sourceBytes']]
        if behavior=='wrong-alpha':data=data[:3]+bytes([data[3]^1])+data[4:]
    if behavior=='wrong-size':out['width']+=1
    refine=h['manifest']['config'].get('foregroundRefinement')=='pymatting-1.1.16'
    if (refine and behavior!='missing-foreground') or behavior=='unsolicited-foreground':
        fg=bytearray(body[:r['sourceBytes']]);base=len(data)
        if fg[3]==255:fg[0]=(fg[0]+10)%256
        if behavior=='foreground-wrong-alpha':fg[3]^=1
        if behavior=='foreground-protected-rgb':fg[0]=(fg[0]+10)%256
        if behavior=='foreground-interior-rgb':data=struct.pack('<f',1.0)+data[4:]
        out['matteBytes']=base
        out['foreground']={'width':roi['width'],'height':roi['height'],'format':'rgba8','alphaMode':'straight','colorSpace':'srgb','payloadBytes':len(fg)}
        p['foregroundRefinement']={'kind':'classical-color-estimation','implementation':'pymatting','version':'1.1.16','method':'estimate_foreground_ml','workingColorSpace':'linear-srgb','alphaDigest':hashlib.sha256(data).hexdigest(),'sourceDigest':hashlib.sha256(body[:r['sourceBytes']]).hexdigest()}
        if behavior=='foreground-wrong-source':p['foregroundRefinement']['sourceDigest']='0'*64
        if behavior=='foreground-wrong-digest':p['foregroundRefinement']['alphaDigest']='0'*64
        if behavior=='foreground-wrong-version':p['foregroundRefinement']['version']='unapproved'
        if behavior=='foreground-wrong-shape':out['foreground']['width']+=1
        data+=bytes(fg)
    send(out,data)
    if behavior=='trailing':sys.stdout.buffer.write(b'extra');sys.stdout.buffer.flush()
`;

async function setup(t, changes = {}, backendChanges = {}) {
  assert.ok(python, 'Python is required for executable transport tests.');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mint-backend-fixture-'));
  await fsp.writeFile(path.join(root, 'worker.py'), fixturePython);
  const weights = Buffer.from('explicitly labelled fixture bytes, never model weights');
  await fsp.writeFile(path.join(root, 'weights.bin'), weights);
  const manifest = { id: 'fixture-only', version: '1', kind: 'test-double', adapter: 'segface', tasks: ['parse'],
    weightsAsset: 'weights', weightsSha256: digest(weights), modelRoot: root,
    assets: [{ name: 'weights', relativePath: 'weights.bin', sha256: digest(weights) }], devices: ['cpu','cuda'],
    license: { id: 'TEST-ONLY', url: 'https://example.invalid/test-license', status: 'approved' },
    requiredPackages: [], enabled: true, config: { executionApproved: true }, ...changes };
  const backend = createDesktopBackend({ pythonPath: python, backendRoot: root, manifests: [manifest], allowTestDoubles: true,
    timeoutMs: 3000, killGraceMs: 40, ...backendChanges });
  t.after(async () => { backend.dispose(); await closed(backend); await fsp.rm(root, { recursive: true, force: true }); });
  return { root, manifest, backend };
}
function context(changes = {}) {
  return { jobId: 'fixture-job', modelId: 'fixture-only', modelVersion: '1', device: 'cpu', originalSize: { width: 11, height: 7 },
    roi: { x: 7, y: 3, width: 3, height: 2 }, selection: { kind: 'user-face-roi', faceId: 'face-1', revision: 'image-1' },
    source: { width: 3, height: 2, format: 'rgba8', alphaMode: 'straight', colorSpace: 'srgb', data: new Uint8ClampedArray(24).fill(127) }, ...changes };
}
async function until(predicate, deadlineMs = 3000) {
  const end = Date.now() + deadlineMs;
  while (!predicate()) { if (Date.now() > end) throw new Error('Condition deadline exceeded'); await delay(10); }
}
async function closed(backend) { await until(() => backend.diagnostics().active === 0, 3000); }

test('privileged config rejects relative commands, path traversal and unapproved test doubles', () => {
  assert.throws(() => createDesktopBackend({ pythonPath: 'python3' }), hasCode('INVALID_CONFIG'));
  assert.throws(() => createDesktopBackend({ pythonPath: python, backendRoot: 'relative' }), hasCode('INVALID_CONFIG'));
  const base = { id:'x',version:'1',kind:'test-double',adapter:'segface',tasks:['parse'],devices:['cpu'],modelRoot:os.tmpdir(),weightsSha256:'a'.repeat(64),
    weightsAsset:'weights',assets:[{name:'weights',relativePath:'../escape',sha256:'a'.repeat(64)}],enabled:false,config:{},license:{id:'x',url:'https://example.invalid/',status:'pending'},requiredPackages:[] };
  assert.throws(() => createDesktopBackend({ pythonPath: python, manifests:[base] }), hasCode('INVALID_CONFIG'));
  assert.throws(() => createDesktopBackend({ pythonPath: python, manifests:[base],allowTestDoubles:true }), hasCode('INVALID_CONFIG'));
});

test('missing local runtime returns actionable unavailable rather than simulated success', async () => {
  const backend = createDesktopBackend({ pythonPath: path.join(os.tmpdir(), 'nonexistent-mint-runtime'), manifests: [] });
  const result = await backend.probe();
  assert.equal(result.runtime.available, false); assert.match(result.runtime.reason, /runtime|Python/i);
  assert.ok(result.devices.every(device => device.available === false)); backend.dispose();
});

test('fixture probe reports exact configured model/license/hash and explicit CUDA unavailability', async t => {
  const { backend, manifest } = await setup(t);
  const report = await backend.probe();
  assert.equal(report.models[0].status, 'ready'); assert.equal(report.models[0].kind, 'test-double');
  assert.equal(report.models[0].weightsSha256, manifest.weightsSha256); assert.equal(report.models[0].assets.status, 'verified');
  await assert.rejects(backend.runParsing(context({ device:'cuda' })), hasCode('DEVICE_UNAVAILABLE'));
  await assert.rejects(backend.runParsing(context({ device:undefined })), hasCode('DEVICE_UNAVAILABLE'));
});

test('model execution gate and asset hash failures fail closed before inference', async t => {
  const { backend, root } = await setup(t, { enabled: false });
  assert.equal((await backend.probe()).models[0].status, 'disabled');
  await assert.rejects(backend.runParsing(context()), hasCode('MODEL_UNAVAILABLE'));
  await fsp.writeFile(path.join(root, 'weights.bin'), 'tampered');
  const report = await backend.probe();
  assert.equal(report.models[0].assets.code, 'ASSET_HASH_MISMATCH');
  await assert.rejects(backend.runParsing(context()), hasCode('MODEL_UNAVAILABLE'));
});

test('source directories reject unpinned Python and cached executable bytecode', async t => {
  const { root, manifest } = await setup(t);
  const vendor = path.join(root,'vendor'); await fsp.mkdir(vendor); await fsp.writeFile(path.join(vendor,'unlisted.py'),'# fixture');
  const config = { pythonPath:python, backendRoot:root,allowTestDoubles:true, manifests:[{...manifest,config:{executionApproved:true,sourceDir:vendor}}] };
  const backend = createDesktopBackend(config); t.after(() => backend.dispose());
  assert.equal((await backend.probe()).models[0].assets.code,'ASSET_UNPINNED_CODE');
  await fsp.unlink(path.join(vendor,'unlisted.py')); await fsp.mkdir(path.join(vendor,'__pycache__'));
  assert.equal((await backend.probe()).models[0].assets.code,'ASSET_UNPINNED_CODE');
});

test('parsing returns original-ROI planar probabilities, explicit labels and selection provenance', async t => {
  const { backend } = await setup(t);
  const input = context(), promise = backend.runParsing(input);
  input.source.data.fill(0); input.selection.faceId = 'changed-after-submit';
  const result = await promise;
  assert.deepEqual(result.classes,['skin','background']); assert.equal(result.width,3); assert.equal(result.height,2);
  assert.equal(result.layout,'planar'); assert.equal(result.space,'roi-original-pixels'); assert.equal(result.provenance.kind,'test-double');
  assert.equal(result.provenance.selection.faceId,'face-1');
  assert.deepEqual([...result.data], [...new Array(6).fill(0.25),...new Array(6).fill(0.75)]);
  assert.deepEqual(result.roi,{x:7,y:3,width:3,height:2});
});

test('malformed geometry, missing selection and bad image buffers reject before a process starts', async t => {
  const { backend } = await setup(t);
  for (const changes of [{selection:undefined},{roi:{x:10,y:3,width:3,height:2}},{originalSize:{width:NaN,height:7}},
    {source:{...context().source,data:new Float32Array(24)}}]) {
    await assert.rejects(backend.runParsing(context(changes)), hasCode('INVALID_INPUT'));
    assert.equal(backend.diagnostics().active,0);
  }
});

test('worker output validation rejects altered provenance, selection, dimensions, NaN and trailing bytes', async t => {
  for (const [behavior, expected] of [['wrong-provenance','INVALID_PROVENANCE'],['wrong-profile','INVALID_PROVENANCE'],['wrong-selection','INVALID_PROVENANCE'],['wrong-size','INVALID_OUTPUT'],['nan','INVALID_OUTPUT'],['trailing','PROTOCOL_ERROR']]) {
    await t.test(behavior, async child => {
      const { backend } = await setup(child,{config:{executionApproved:true,fixtureBehavior:behavior}});
      await assert.rejects(backend.runParsing(context()), hasCode(expected));
    });
  }
});

test('image/matte adapters implement existing contracts without changing original or alpha', async t => {
  const { backend } = await setup(t,{adapter:'birefnet',tasks:['matting','retouch']});
  const a = await backend.createAdapter('fixture-only','1','cpu');
  const original = {...context().source}; const before = new Uint8ClampedArray(original.data);
  const s = createBackendSession(original,{adapters:[a],allowTestDoubles:true});
  const req = {task:'matting',modelId:'fixture-only',modelVersion:'1',roi:{x:0,y:0,width:3,height:2},
    mask:{width:3,height:2,space:'roi-original-pixels',encoding:'unit-float32',data:new Float32Array(6).fill(1)},strength:0.5};
  const result = await s.start(req).result;
  assert.equal(result.image.data[3],Math.round(127*0.75)); assert.deepEqual(original.data,before);
  assert.deepEqual((await s.start({...req,task:'retouch'}).result).image.data,before);
});

test('direct matting API supplies full coverage internally and returns only a typed exact-ROI matte', async t => {
  const {backend}=await setup(t,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,fixtureBehavior:'check-full-mask'}});
  const input=context();delete input.selection;
  const before=new Uint8ClampedArray(input.source.data),result=await backend.runMatting(input);
  assert.deepEqual(result.matte.roi,input.roi);assert.equal(result.matte.width,3);assert.equal(result.matte.height,2);
  assert.equal(result.matte.space,'roi-original-pixels');assert.equal(result.matte.encoding,'unit-float32');
  assert.ok(result.matte.data instanceof Float32Array);assert.ok(result.matte.data.every(v=>v===0.5));
  assert.equal(result.image,undefined);assert.equal(result.provenance.task,'matting');assert.deepEqual(input.source.data,before);
});

test('diagnostic matting precision/resolution is explicit and never inherits an HR profile', async t => {
  const {backend}=await setup(t,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,inputSize:512,precision:'bfloat16',threads:2}});
  const result=await backend.runMatting(context());
  assert.deepEqual(result.provenance.executionProfile,{adapter:'birefnet',inputSize:512,precision:'mixed-bfloat16',threads:2,qualityProfile:'diagnostic-512',operatorPrecision:{deformConv2d:'float32',weights:'float32'}});
  assert.deepEqual((await backend.probe()).models[0].executionProfile,result.provenance.executionProfile);
});

test('optional declared foreground travels separately without changing alpha or source', async t => {
  const {backend}=await setup(t,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,foregroundRefinement:'pymatting-1.1.16'}});
  const input=context();for(let i=3;i<input.source.data.length;i+=4)input.source.data[i]=255;
  const before=new Uint8ClampedArray(input.source.data),result=await backend.runMatting(input);
  assert.equal(result.foreground.format,'rgba8');assert.equal(result.foreground.alphaMode,'straight');assert.equal(result.foreground.colorSpace,'srgb');
  assert.equal(result.foreground.data[0],137);assert.ok(result.matte.data.every(v=>v===0.5));assert.deepEqual(input.source.data,before);
  for(let i=3;i<result.foreground.data.length;i+=4)assert.equal(result.foreground.data[i],before[i]);
  assert.equal(result.provenance.foregroundRefinement.kind,'classical-color-estimation');assert.equal(result.provenance.foregroundRefinement.version,'1.1.16');
});

test('foreground extension rejects missing, unsolicited, wrong-alpha/shape/version and protected-RGB changes', async t => {
  for(const behavior of ['missing-foreground','foreground-wrong-source','foreground-wrong-digest','foreground-wrong-alpha','foreground-wrong-shape','foreground-wrong-version','foreground-protected-rgb','foreground-interior-rgb','unsolicited-foreground']){
    await t.test(behavior,async child=>{
      const enabled=behavior!=='unsolicited-foreground';
      const {backend}=await setup(child,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,fixtureBehavior:behavior,...(enabled?{foregroundRefinement:'pymatting-1.1.16'}:{})}});
      const input=context();if(behavior==='foreground-interior-rgb')for(let i=3;i<input.source.data.length;i+=4)input.source.data[i]=255;
      await assert.rejects(backend.runMatting(input),hasCode('INVALID_OUTPUT'));
    });
  }
});

test('existing masked compositor remains exact outside ROI/zero mask/zero strength despite optional foreground', async t => {
  const {backend}=await setup(t,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,foregroundRefinement:'pymatting-1.1.16'}});
  const adapter=await backend.createAdapter('fixture-only','1','cpu');
  const original={width:7,height:5,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:new Uint8ClampedArray(140).fill(100)};
  for(let i=3;i<140;i+=4)original.data[i]=255;
  const session=createBackendSession(original,{adapters:[adapter],allowTestDoubles:true});
  const request={task:'matting',modelId:'fixture-only',modelVersion:'1',roi:{x:2,y:1,width:3,height:2},mask:{width:3,height:2,space:'roi-original-pixels',encoding:'unit-float32',data:new Float32Array([0,1,1,1,1,1])},strength:0};
  assert.deepEqual((await session.start(request).result).image.data,original.data);
  const result=await session.start({...request,strength:0.5}).result;
  for(let y=0;y<5;y++)for(let x=0;x<7;x++){
    const i=(y*7+x)*4,changed=x>=2&&x<5&&y>=1&&y<3&&!(x===2&&y===1);
    assert.deepEqual(result.image.data.slice(i,i+3),original.data.slice(i,i+3));
    assert.equal(result.image.data[i+3],changed?191:255);
  }
});

test('direct matting rejects incompatible models and malformed/nonfinite output, and supports physical cancellation', async t => {
  const parsing=await setup(t);
  await assert.rejects(parsing.backend.runMatting(context()),hasCode('INCOMPATIBLE_TASK'));
  const invalid=await setup(t,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,fixtureBehavior:'nan'}});
  await assert.rejects(invalid.backend.runMatting(context()),hasCode('INVALID_OUTPUT'));
  const holding=await setup(t,{adapter:'birefnet',tasks:['matting'],config:{executionApproved:true,fixtureBehavior:'hold'}});
  const controller=new AbortController(),pending=holding.backend.runMatting(context({signal:controller.signal}));
  const rejected=assert.rejects(pending,hasCode('CANCELLED'));
  await until(()=>fs.existsSync(path.join(holding.root,'inference-started')));controller.abort();await rejected;await closed(holding.backend);
});

test('queued/pre-aborted cancellation does not launch an extra process, and running cancel kills before releasing capacity', async t => {
  const { backend, root } = await setup(t,{config:{executionApproved:true,fixtureBehavior:'hold'}},{maxConcurrent:1,maxQueued:1});
  const controller = new AbortController(); const first = backend.runParsing(context({signal:controller.signal}));
  const firstRejection = assert.rejects(first,hasCode('CANCELLED'));
  // A normal probe exits quickly; the infer process is the one that remains active.
  await until(() => fs.existsSync(path.join(root,'inference-started'))); assert.equal(backend.diagnostics().active,1);
  const queuedController = new AbortController(); const queued = backend.probe(queuedController.signal);
  const queuedRejection = assert.rejects(queued,hasCode('CANCELLED'));
  assert.equal(backend.diagnostics().queued,1);
  await assert.rejects(backend.probe(),hasCode('QUEUE_FULL'));
  queuedController.abort(); await queuedRejection; assert.equal(backend.diagnostics().queued,0);
  controller.abort(); await firstRejection;
  assert.equal(backend.diagnostics().active,1); // Promise rejection does not falsely free the live process slot.
  await closed(backend); assert.equal(backend.diagnostics().active,0);
  const already = new AbortController(); already.abort();
  await assert.rejects(backend.runParsing(context({signal:already.signal})),hasCode('CANCELLED'));
  assert.equal(backend.diagnostics().active,0);
});

test('a newer contract job cancels its old physical worker and only publishes the current result', async t => {
  const { backend, root } = await setup(t,{adapter:'birefnet',tasks:['retouch'],config:{executionApproved:true,fixtureBehavior:'hold-first'}});
  const adapter = await backend.createAdapter('fixture-only','1','cpu');
  const s = createBackendSession(context().source,{adapters:[adapter],allowTestDoubles:true});
  const req={task:'retouch',modelId:'fixture-only',modelVersion:'1',roi:{x:0,y:0,width:3,height:2},strength:1,
    mask:{width:3,height:2,space:'roi-original-pixels',encoding:'unit-float32',data:new Float32Array(6).fill(1)}};
  const first=s.start(req),rejected=assert.rejects(first.result,hasCode('STALE_JOB'));
  await until(() => fs.existsSync(path.join(root,'inference-started')));
  const second=s.start(req),result=await second.result;await rejected;
  assert.equal(first.state,'superseded');assert.equal(second.state,'succeeded');
  assert.equal(result.provenance.jobId,second.id);await closed(backend);
});

test('timeout terminates an uncooperative process and disposal rejects subsequent work', async t => {
  const { backend } = await setup(t,{config:{executionApproved:true,fixtureBehavior:'hold'}},{timeoutMs:250});
  await assert.rejects(backend.runParsing(context()),hasCode('TIMEOUT')); await closed(backend);
  backend.dispose(); backend.dispose();
  await assert.rejects(backend.probe(),hasCode('BACKEND_CLOSED'));
});

test('oversized stdout and crashing workers cannot publish a result', async t => {
  for (const [behavior, expected] of [['oversize','PAYLOAD_TOO_LARGE'],['crash','WORKER_EXIT']]) {
    await t.test(behavior,async child => {
      const {backend}=await setup(child,{config:{executionApproved:true,fixtureBehavior:behavior}},{maxPayloadBytes:4096});
      await assert.rejects(backend.runParsing(context()),hasCode(expected)); await closed(backend);
    });
  }
});

test('real authored worker enforces the execution gate before assets or adapter imports', async () => {
  const header={protocol:1,op:'infer',payloadBytes:0,manifest:{adapter:'segface',enabled:false,config:{executionApproved:false}},request:{}};
  const json=Buffer.from(JSON.stringify(header)),prefix=Buffer.alloc(4);prefix.writeUInt32BE(json.length);
  const child=spawn(python,['-I','-u',path.resolve(__dirname,'../backend/worker.py')],{stdio:['pipe','pipe','pipe'],shell:false});
  const chunks=[]; child.stdout.on('data',chunk=>chunks.push(chunk)); child.stderr.resume();
  const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  child.stdin.end(Buffer.concat([prefix,json])); assert.equal(await exited,0);
  const bytes=Buffer.concat(chunks),count=bytes.readUInt32BE(0),response=JSON.parse(bytes.subarray(4,4+count));
  assert.equal(response.ok,false);assert.equal(response.error.code,'EXECUTION_DISABLED');assert.equal(response.payloadBytes,0);
});

test('trusted quality-block metadata stays visible and disabled even when enabled flag is true',async t=>{
  const disabledReason='复杂衣物误删/发缘灰雾，尚未通过质量验收';
  const {backend}=await setup(t,{enabled:true,qualityStatus:'blocked',disabledReason});
  const model=(await backend.probe()).models[0];assert.equal(model.status,'disabled');assert.equal(model.qualityStatus,'blocked');
  assert.equal(model.reason,disabledReason);assert.equal(model.disabledReason,disabledReason);assert.equal(model.assets.status,'verified');
  await assert.rejects(backend.runParsing(context()),hasCode('MODEL_UNAVAILABLE'));
});

test('actual authored Python validator rejects stale foreground alpha/source bindings without loading any model',()=>{
  const code=String.raw`
import sys,struct,hashlib,types,copy
sys.path.insert(0,sys.argv[1]);import worker
worker.verify_assets=lambda manifest:{}
worker.runtime_probe=lambda packages:{'packages':{},'devices':[{'kind':'cpu','name':'fixture CPU','available':True}]}
source=bytes([30,40,50,255,60,70,80,255]);alpha=struct.pack('<2f',.5,.75)
model={'id':'validator-fixture','version':'1','weightsSha256':'a'*64,'kind':'test-double','device':{'kind':'cpu','name':'fixture CPU'}}
manifest={**model,'adapter':'birefnet','enabled':True,'license':{'status':'approved'},'devices':['cpu'],'tasks':['matting'],'config':{'executionApproved':True,'foregroundRefinement':'pymatting-1.1.16'}}
header={'manifest':manifest,'request':{'jobId':'fixture','task':'matting','model':model,'roi':{'x':0,'y':0,'width':2,'height':1},'originalSize':{'width':2,'height':1},'sourceBytes':8,'maskBytes':8},'maxPixels':32,'maxPayloadBytes':1024}
result={'kind':'matte','width':2,'height':1,'data':alpha,'foreground':{'width':2,'height':1,'format':'rgba8','alphaMode':'straight','colorSpace':'srgb','data':source},'foregroundRefinement':{'kind':'classical-color-estimation','implementation':'pymatting','version':'1.1.16','method':'estimate_foreground_ml','alphaDigest':hashlib.sha256(alpha).hexdigest(),'sourceDigest':hashlib.sha256(source).hexdigest()}}
worker.importlib.import_module=lambda name:types.SimpleNamespace(infer=lambda request:result)
payload=source+struct.pack('<2f',1,1)
response,data=worker.infer(header,payload);assert data==alpha+source
for key in ('alphaDigest','sourceDigest'):
    saved=result['foregroundRefinement'][key];result['foregroundRefinement'][key]='0'*64
    try:worker.infer(header,payload);raise AssertionError('accepted stale digest')
    except worker.ProtocolError as exc:assert exc.code=='INVALID_OUTPUT'
    result['foregroundRefinement'][key]=saved
result['foreground']['data']=source[:3]+bytes([254])+source[4:]
try:worker.infer(header,payload);raise AssertionError('accepted changed alpha')
except worker.ProtocolError as exc:assert exc.code=='INVALID_OUTPUT'
manifest['qualityStatus']='blocked'
try:worker.infer(header,payload);raise AssertionError('accepted quality-blocked model')
except worker.ProtocolError as exc:assert exc.code=='EXECUTION_DISABLED'
print('authored worker validator passed; no model imports')
`;
  const output=require('node:child_process').execFileSync(python,['-I','-c',code,path.resolve(__dirname,'../backend')],{encoding:'utf8',timeout:10000});
  assert.match(output,/validator passed/);
});
