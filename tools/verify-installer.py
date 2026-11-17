"""Read/extract our compiled NSIS installers; never execute Windows binaries."""
import hashlib,json,struct,subprocess,tempfile,re
from pathlib import Path
import argparse
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('installer',type=Path);p.add_argument('--offline',action='store_true');args=p.parse_args()
exe=args.installer.resolve();raw=exe.read_bytes();off=struct.unpack_from('<I',raw,0x3c)[0]
assert raw[:2]==b'MZ' and raw[off:off+4]==b'PE\0\0'
assert struct.unpack_from('<H',raw,off+4)[0]==0x14c, 'Expected NSIS x86 installer stub for x64 application'
assert struct.unpack_from('<H',raw,off+24+68)[0]==2, 'Expected GUI subsystem'
assert struct.unpack_from('<II',raw,off+24+128)==(0,0), 'Unexpected signing certificate'
assert b'asInvoker' in raw, 'Expected per-user execution manifest'
seven=root/'tools/nsis/7zip/7zz'
subprocess.run([str(seven),'t',str(exe)],check=True,stdout=subprocess.DEVNULL)
manifest=json.loads((root/'installer/payload-manifest.json').read_text())
if not args.offline:
 manifest=[e for e in manifest if e['path'].startswith('resources/') or e['path'] in ['MintPortrait.ico','使用说明.txt','INSTALLER-NOTICES.txt','NSIS-LICENSES.txt']]
with tempfile.TemporaryDirectory(prefix='mint-setup-audit-') as d:
 subprocess.run([str(seven),'x','-y',str(exe),'-o'+d],check=True,stdout=subprocess.DEVNULL)
 archives=list(Path(d).rglob('app.asar'));assert len(archives)==1
 payload=archives[0].parent.parent
 for item in manifest:
  data=(payload/item['path']).read_bytes();assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],item['path']
version=json.loads((root/'package.json').read_text())['version']
assert re.search(r'!define VERSION "'+re.escape(version)+r'"', (root/'installer/MintPortrait.nsi').read_text())
parts=[int(x) for x in version.split('.')]+[0]
signature=struct.pack('<I',0xFEEF04BD)
assert raw.count(signature)==1, 'Expected one uncompressed PE fixed-version structure'
fixed=struct.unpack_from('<13I',raw,raw.index(signature))
expected=((parts[0]<<16)|parts[1],(parts[2]<<16)|parts[3])
assert fixed[2:4]==expected and fixed[4:6]==expected, 'Compiled PE fixed version does not match package version'
# NSIS3.11 emits dwStrucVersion=0. It is not the product/file version fields.
assert (version+'.0\0').encode('utf-16le') in raw, 'Compiled PE string version missing'
result={'file':exe.name,'installerVersion':version,'applicationVersion':json.loads((root/'package.json').read_text())['version'],'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'peFixedAndStringVersionsVerified':True,'signed':False,'executionLevel':'asInvoker','offline':args.offline,'embeddedProductFilesVerified':[e['path'] for e in manifest],'appAsarSha256':next(e['sha256'] for e in manifest if e['path']=='resources/app.asar'),'archiveIntegrityTest':'passed','windowsExecutionTested':False,'qualityStatus':'development candidate, not accepted SOTA remake'}
out=root/'installer/out'/('offline-validation.json' if args.offline else 'online-validation.json');out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='embeddedProductFilesVerified'},ensure_ascii=False));print('Verified embedded files:',len(manifest))
