from pathlib import Path
import zipfile,hashlib,json
root=Path(__file__).resolve().parents[1]
out=root/'installer/deliverables/MintPortrait-Installer-Source-0.1.0.zip'
files=[]
for name in ['src','assets','tests','docs']:
 files += [p for p in (root/name).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
for name in ['package.json','package-lock.json','main.cjs','preload.cjs','desktop-core.cjs','README.md','tools/package-win.cjs','tools/vendor.cjs','tools/verify-package.cjs','installer/MintPortrait.nsi','installer/prepare.py','installer/BUILD.md','installer/payload-manifest.json','installer/make-source.py','installer/out/test-results.txt','installer/out/build-online.log','installer/out/online-validation.json']:
 files.append(root/name)
for name in ['installer/generated','installer/licenses']:
 files += [p for p in (root/name).rglob('*') if p.is_file()]
for name in ['offline-validation.json','build-offline.log']:
 p=root/'installer/out'/name
 if p.exists() and name=='offline-validation.json':files.append(p)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,9) as z:
 for p in sorted(set(files)):z.write(p,'MintPortrait-Source/'+p.relative_to(root).as_posix())
with zipfile.ZipFile(out) as z:assert z.testzip() is None
print(json.dumps({'path':str(out),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'files':len(set(files))}))
