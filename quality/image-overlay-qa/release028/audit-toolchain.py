"""Verify cached official tool packages against pins, then exact installed compiler files."""
from pathlib import Path
import argparse,hashlib,base64,tarfile,subprocess,io,json,os
ap=argparse.ArgumentParser();ap.add_argument('--repo-root',type=Path,required=True);ap.add_argument('--output-dir',type=Path,required=True);a=ap.parse_args();r=a.repo_root;o=a.output_dir;checked=[]
for name,digest in [('nsis.deb','e6eb6ffb70f0df09e95dedb2d2cf55ad3c2679f7c2ae357d0c00cc4c83178690'),('nsis-common.deb','103a3284c1a5356efa0aba90fdfc391c3cde8e7df8726377cef0f98471584047')]:
 p=r/'tools/nsis/downloads'/name;b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==digest
 data=subprocess.check_output(['dpkg-deb','--fsys-tarfile',str(p)]);n=0;links=[]
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as archive:
  for member in archive.getmembers():
   if member.issym():
    actual=r/'tools/nsis/root'/member.name;assert actual.is_symlink() and os.readlink(actual)==member.linkname;links.append({'path':member.name,'target':member.linkname})
   if member.isfile():
    actual=r/'tools/nsis/root'/member.name;expect=archive.extractfile(member).read();assert actual.read_bytes()==expect,member.name;n+=1
 checked.append({'package':name,'bytes':len(b),'sha256':digest,'actualCachedFilesMatchedToPackage':n,'actualSymlinksMatchedToPackage':links})
p=r/'tools/nsis/downloads/nsis-resources.7z';b=p.read_bytes();digest=base64.b64encode(hashlib.sha512(b).digest()).decode();assert digest=='Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0JTldxZu4NFoEmW4kJgZ3DlSWVON3+Q=='
for name in ['INetC.dll','StdUtils.dll','nsisunz.dll','nsProcess.dll']:
 b=subprocess.check_output([str(r/'tools/nsis/7zip/7zz'),'x','-so',str(p),'plugins/x86-unicode/'+name]);assert b==(r/'tools/nsis/resources/plugins/x86-unicode'/name).read_bytes(),name
checked.append({'package':p.name,'sha512Base64':digest,'actualUnicodePluginsMatchedToArchive':['INetC.dll','StdUtils.dll','nsisunz.dll','nsProcess.dll']})
p=r/'tools/nsis/downloads/7z2605-linux-x64.tar.xz';b=p.read_bytes();assert hashlib.sha256(b).hexdigest()=='22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e'
with tarfile.open(p,'r:xz') as archive:assert archive.extractfile('7zz').read()==(r/'tools/nsis/7zip/7zz').read_bytes()
checked.append({'package':p.name,'sha256':hashlib.sha256(b).hexdigest(),'actual7zipBinaryMatchesArchive':True})
report={'status':'pass','provenance':'Already cached packages only. No downloads or installation. Existing canonical pin values from installer/BUILD.md and tools/nsis/7zip-manifest.json.','packages':checked};(o/'toolchain-provenance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
