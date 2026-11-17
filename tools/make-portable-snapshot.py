"""Package an existing installation without altering it or the user's data."""
import argparse, hashlib, json, zipfile
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--installed-root',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
args=parser.parse_args()
source=args.installed_root.resolve()
out=args.output_dir.resolve();out.mkdir(parents=True,exist_ok=True)
if not (source/'MintPortrait.exe').is_file() or not (source/'resources/app.asar').is_file():
    raise SystemExit('Expected a MintPortrait installation')
root_name='MintPortrait-Desktop-0.2.9-win-x64'
archive=out/(root_name+'-portable.zip')
if archive.exists():raise SystemExit('Refusing to overwrite an existing archive')
excluded={'.mint-portrait-install.ini','Uninstall.exe'}
root_files={'MintPortrait.exe','MintPortrait.ico','LICENSE','LICENSES.chromium.html',
            'INSTALLER-NOTICES.txt','NSIS-LICENSES.txt','使用说明.txt','version',
            'chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll',
            'dxcompiler.dll','electron_wer.dll','ffmpeg.dll','icudtl.dat',
            'resources.pak','snapshot_blob.bin','v8_context_snapshot.bin',
            'vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll'}
items=[]
for p in sorted(source.rglob('*')):
    if not p.is_file():continue
    rel=p.relative_to(source)
    allowed=(len(rel.parts)==1 and rel.name in root_files)
    allowed=allowed or (len(rel.parts)==2 and rel.parts[0]=='locales' and rel.suffix=='.pak')
    allowed=allowed or rel.as_posix()=='resources/app.asar'
    allowed=allowed or (len(rel.parts)>2 and rel.parts[:2]==('resources','app.asar.unpacked'))
    if not allowed:continue
    if p.is_symlink() or not p.resolve().is_relative_to(source):raise ValueError('Unexpected link in runtime')
    items.append((p,rel.as_posix()))
digest=lambda b:hashlib.sha256(b).hexdigest()
manifest=[]
readme=('Mint Portrait Desktop 0.2.9 - unsigned development snapshot\n'
        'Extract the complete folder and run MintPortrait.exe.\n'
        'This is a copy of the existing installation, not a rebuilt installer.\n'
        'Installer state and uninstall.exe are omitted. No photos or AppData were collected.\n'
        'Third-party licenses remain included. Test with photo copies.\n'
        'No new Windows UI, portrait-quality, GPU or full-suite acceptance is claimed.\n')
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p,rel in items:
        data=p.read_bytes()
        z.writestr(root_name+'/'+rel,data)
        manifest.append({'path':rel,'bytes':len(data),'sha256':digest(data)})
    z.writestr(root_name+'/READ-ME-FIRST.txt',readme)
with zipfile.ZipFile(archive) as z:
    if z.testzip() is not None:raise ValueError('ZIP CRC validation failed')
    for row in manifest:
        b=z.read(root_name+'/'+row['path'])
        if len(b)!=row['bytes'] or digest(b)!=row['sha256']:raise ValueError('ZIP content mismatch')
payload={'date':'2026-11-17','version':'0.2.9','method':'Byte-preserving portable copy of installed runtime, not a rebuild','excluded':sorted(excluded),'files':manifest,'validation':'ZIP CRC and every included installed-file SHA-256 verified; no UI or photo-quality acceptance'}
(out/'PORTABLE-FILES.json').write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
rows=[]
for file in (archive,out/'PORTABLE-FILES.json'):
    rows.append(digest(file.read_bytes())+'  '+file.name)
(out/'SHA256SUMS.txt').write_text('\n'.join(rows)+'\n',encoding='utf-8')
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'runtimeFiles':len(manifest),'validation':'PASS byte integrity only'}))
