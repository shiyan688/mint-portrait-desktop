"""Read-only PE/resource audit. Python standard library only; never loads target binaries."""
from pathlib import Path
import struct,json,hashlib,datetime,xml.etree.ElementTree as ET,zipfile,argparse
EXPECTED_RUNTIME_SHA='ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47'
def digest(b):return hashlib.sha256(b).hexdigest()
def align4(n):return (n+3)&~3

def parse_version(b):
 def u16(off):return struct.unpack_from('<H',b,off)[0]
 def node(start,limit,depth=0):
  if depth>10 or start+6>limit:raise ValueError('Malformed version node')
  length,value_len,typ=struct.unpack_from('<HHH',b,start)
  end=start+length
  if length<6 or end>limit:raise ValueError('Invalid version node length')
  pos=start+6;chars=[]
  while pos+2<=end:
   code=u16(pos);pos+=2
   if code==0:break
   chars.append(code)
  else:raise ValueError('Version key missing terminator')
  key=bytes().join(struct.pack('<H',v) for v in chars).decode('utf-16le')
  pos=align4(pos);value_bytes=value_len*(2 if typ==1 else 1)
  if pos+value_bytes>end:raise ValueError('Version value exceeds node')
  value=b[pos:pos+value_bytes];children=[];pos=align4(pos+value_bytes)
  while pos+6<=end and u16(pos):
   child,nextpos=node(pos,end,depth+1);children.append(child);pos=align4(nextpos)
  return {'key':key,'type':typ,'value':value,'children':children},end
 root,_=node(0,len(b))
 if root['key']!='VS_VERSION_INFO':raise ValueError('Missing VS_VERSION_INFO')
 fixed={}
 if root['value']:
  if len(root['value'])<52:raise ValueError('Truncated VS_FIXEDFILEINFO')
  vals=struct.unpack_from('<13I',root['value'])
  if vals[0]!=0xFEEF04BD:raise ValueError('Bad fixed signature')
  def version(ms,ls):return '.'.join(map(str,[ms>>16,ms&65535,ls>>16,ls&65535]))
  fixed={'file':version(vals[2],vals[3]),'product':version(vals[4],vals[5]),'fileFlagsMask':hex(vals[6]),'fileFlags':hex(vals[7]),'fileOS':hex(vals[8]),'fileType':vals[9]}
 strings={}
 def collect(n,trail):
  if n['type']==1 and n['value']:strings['/'.join(trail+[n['key']])]=n['value'].decode('utf-16le').rstrip('\x00')
  for c in n['children']:collect(c,trail+[n['key']])
 collect(root,[])
 return {**fixed,'strings':strings}

def parse(path):
 b=path.read_bytes()
 if b[:2]!=b'MZ':raise ValueError('Missing DOS signature')
 pe=struct.unpack_from('<I',b,0x3c)[0]
 if b[pe:pe+4]!=b'PE\0\0':raise ValueError('Missing PE signature')
 machine,nsections,timestamp,_,_,opt_size,coffflags=struct.unpack_from('<HHIIIHH',b,pe+4)
 opt=pe+24;magic=struct.unpack_from('<H',b,opt)[0]
 if magic not in (0x10b,0x20b):raise ValueError('Unknown optional header')
 dd=opt+(96 if magic==0x10b else 112)
 numberdirs=struct.unpack_from('<I',b,opt+(92 if magic==0x10b else 108))[0]
 subsystem,flags=struct.unpack_from('<HH',b,opt+68)
 cert=struct.unpack_from('<II',b,dd+4*8) if numberdirs>4 else (0,0)
 sections=[]
 for i in range(nsections):
  off=opt+opt_size+i*40
  name=b[off:off+8].rstrip(b'\0').decode('ascii',errors='replace')
  vsize,rva,rawsize,raw=struct.unpack_from('<IIII',b,off+8)
  sections.append({'name':name,'rva':rva,'virtualSize':vsize,'rawSize':rawsize,'rawPointer':raw})
 def offset(rva,size=1):
  for s in sections:
   if s['rva']<=rva<s['rva']+max(s['virtualSize'],s['rawSize']):
    delta=rva-s['rva']
    if delta+size>s['rawSize']:raise ValueError('RVA is not fully backed by raw section')
    pos=s['rawPointer']+delta
    if pos+size>len(b):raise ValueError('RVA beyond file')
    return pos
  raise ValueError(f'Unmapped RVA {rva:x}')
 resources=[]
 if numberdirs>2:
  rrva,rsize=struct.unpack_from('<II',b,dd+16)
  if rrva and rsize:
   base=offset(rrva)
   def rcheck(rel,size):
    if rel<0 or rel+size>rsize:raise ValueError('Resource outside declared directory')
    return offset(rrva+rel,size)
   def resname(val):
    if not val&0x80000000:return val
    p=rcheck(val&0x7fffffff,2);n=struct.unpack_from('<H',b,p)[0]
    p=rcheck((val&0x7fffffff)+2,n*2)
    return b[p:p+n*2].decode('utf-16le')
   def tree(rel,trail=(),ancestors=()):
    if rel in ancestors or len(trail)>4:raise ValueError('Recursive/deep resource tree')
    pos=rcheck(rel,16);named,ids=struct.unpack_from('<HH',b,pos+12)
    for idx in range(named+ids):
     p=rcheck(rel+16+idx*8,8);name,val=struct.unpack_from('<II',b,p);route=trail+(resname(name),)
     if val&0x80000000:tree(val&0x7fffffff,route,ancestors+(rel,))
     else:
      p=rcheck(val,16);rva,size,codepage,reserved=struct.unpack_from('<IIII',b,p);fileoff=offset(rva,size)
      resources.append({'route':route,'rva':rva,'bytes':size,'codepage':codepage,'data':b[fileoff:fileoff+size]})
   tree(0)
 versions=[];manifests=[]
 for r in resources:
  if r['route'][0]==16:versions.append({'resourcePath':r['route'],**parse_version(r['data'])})
  if r['route'][0]==24:
   data=r['data'];encoding='utf-16' if data[:2] in (b'\xff\xfe',b'\xfe\xff') else 'utf-8-sig';text=data.decode(encoding).rstrip('\x00')
   root=ET.fromstring(text);levels=[e.attrib for e in root.iter() if e.tag.rsplit('}',1)[-1]=='requestedExecutionLevel']
   manifests.append({'resourcePath':r['route'],'bytes':len(data),'sha256':digest(data),'requestedExecutionLevels':levels,'xml':text})
 levels=[e.get('level') for m in manifests for e in m['requestedExecutionLevels']]
 return {'file':str(path),'bytes':len(b),'sha256':digest(b),'machine':hex(machine),'architecture':{0x14c:'x86',0x8664:'x64'}.get(machine,'other'),'optionalHeaderMagic':hex(magic),'subsystem':subsystem,'subsystemName':{2:'Windows GUI',3:'Windows CUI'}.get(subsystem,'other'),'coffCharacteristics':hex(coffflags),'dllCharacteristics':hex(flags),'aslr':bool(flags&0x40),'dep':bool(flags&0x100),'highEntropyVa':bool(flags&0x20),'cfgFlagPresent':bool(flags&0x4000),'certificateDirectory':list(cert),'authenticodeSignaturePresent':bool(cert[0] and cert[1]),'versionResources':versions,'manifests':manifests,'installerExecutionLevel':levels[0] if len(levels)==1 else None,'resourceInventory':[{'path':r['route'],'bytes':r['bytes'],'sha256':digest(r['data'])} for r in resources],'sections':sections}

def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--repo-root',type=Path,default=Path.cwd(),help='Source repository root (default: current directory)')
 ap.add_argument('--output-dir',type=Path,default=Path.cwd()/'audit-output',help='Report destination (default: ./audit-output)')
 ap.add_argument('--runtime-zip',type=Path,help='Existing pinned Electron ZIP; overrides runtime-cache discovery')
 ap.add_argument('--runtime-cache-dir',type=Path,default=Path('/tmp/mint-electron-cache'),help='Directory to search for the existing pinned runtime ZIP')
 ap.add_argument('--artifact-dir',required=True,type=Path,help='Directory with finalized versioned Setup files')
 ap.add_argument('--require-offline',action='store_true')
 args=ap.parse_args();ROOT=args.repo_root.resolve();OUT=args.output_dir.resolve();OUT.mkdir(parents=True,exist_ok=True)
 online=args.artifact_dir/'MintPortrait-Development-0.2.8-Setup.exe';offline=args.artifact_dir/'MintPortrait-Development-0.2.8-Offline-Setup.exe'
 pack=ROOT/'dist/Mint Portrait-win32-x64/MintPortrait.exe';payload=ROOT/'installer/payload/MintPortrait.exe'
 native=ROOT/'installer/payload/resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib'
 paths=[online]+([offline] if offline.is_file() else [])+[pack,payload]+sorted(p for p in native.iterdir() if p.suffix.lower() in ('.dll','.node'))
 files=[parse(p) for p in paths];by={Path(f['file']):f for f in files};installers=[by[online]]+([by[offline]] if offline in by else [])
 runtime=[args.runtime_zip.resolve()] if args.runtime_zip else list(args.runtime_cache_dir.resolve().rglob('electron-v45.0.0-win32-x64.zip'))
 verification={'runtimeZipFound':bool(runtime)}
 if runtime:
  zpath=runtime[0];zhash=digest(zpath.read_bytes())
  runtime_records=[]
  with zipfile.ZipFile(zpath) as z:
   ehash=digest(z.read('electron.exe'))
   for name in z.namelist():
    if name.endswith('/') or name=='resources/default_app.asar':continue
    target='MintPortrait.exe' if name=='electron.exe' else name
    actual=ROOT/'installer/payload'/target;expected=z.read(name);actual_hash=digest(actual.read_bytes()) if actual.is_file() else None
    runtime_records.append({'runtimeZipMember':name,'payloadPath':target,'bytes':len(expected),'sha256':digest(expected),'payloadSha256':actual_hash,'match':actual_hash==digest(expected)})
  verification.update({'path':str(zpath),'bytes':zpath.stat().st_size,'sha256':zhash,'expectedSha256':EXPECTED_RUNTIME_SHA,'zipHashVerified':zhash==EXPECTED_RUNTIME_SHA,'electronExeSha256':ehash,'payloadLauncherEqualsElectronZipMember':ehash==by[payload]['sha256'],'runtimePayloadFiles':runtime_records,'all72RuntimePayloadFilesExactPinnedArchive':len(runtime_records)==72 and all(e['match'] for e in runtime_records)})
 def versions(f,want):return bool(f['versionResources']) and all(v.get('file')==want and v.get('product')==want for v in f['versionResources'])
 checks={'allPEParsed':True,'onlineInstallerX86Gui':by[online]['machine']=='0x14c' and by[online]['subsystem']==2,'offlineInstallerPresent':offline in by,'allPresentInstallersX86Gui':all(f['machine']=='0x14c' and f['subsystem']==2 for f in installers),'allPresentInstallersVersion028':all(versions(f,'0.2.8.0') for f in installers),'allInstallerStringVersions028':all(any(str(k).endswith('/FileVersion') and v=='0.2.8.0' for k,v in r['strings'].items()) and any(str(k).endswith('/ProductVersion') and v=='0.2.8' for k,v in r['strings'].items()) for f in installers for r in f['versionResources']),'allPresentInstallersAsInvoker':all(f['installerExecutionLevel']=='asInvoker' and all(e.get('uiAccess')=='false' for m in f['manifests'] for e in m['requestedExecutionLevels']) for f in installers),'packagedLauncherX64Version028':by[pack]['machine']=='0x8664' and versions(by[pack],'0.2.8.0'),'payloadLauncherX64Electron45':by[payload]['machine']=='0x8664' and versions(by[payload],'45.0.0.0'),'payloadLauncherExactPinnedRuntime':verification.get('zipHashVerified',False) and verification.get('payloadLauncherEqualsElectronZipMember',False),'all72RuntimePayloadFilesExactPinnedArchive':verification.get('all72RuntimePayloadFilesExactPinnedArchive',False),'threeSharpNativePEsX64':len([f for f in files if Path(f['file']).parent==native])==3 and all(f['machine']=='0x8664' for f in files if Path(f['file']).parent==native),'allStaticAslrDepFlags':all(f['aslr'] and f['dep'] for f in files),'allCertificateDirectoriesEmpty':all(f['certificateDirectory']==[0,0] for f in files)}
 applicable={k:v for k,v in checks.items() if args.require_offline or k!='offlineInstallerPresent'}
 status='fail' if not all(applicable.values()) else 'pass' if offline in by else 'pending_offline'
 report={'release':'0.2.8','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checksDescription':'Fresh standard-library PE32/PE32+ header, section, resource-tree, VS_VERSION_INFO fixed/string resource and XML application-manifest parsing. Targets were not executed or loaded.','status':status,'checks':checks,'unsigned':all(f['certificateDirectory']==[0,0] for f in files),'windowsExecutionTested':False,'windowsNativeDllLoadingTested':False,'runtimeVersionNote':'Installer payload launcher is the exact electron.exe member of the pinned Electron 45.0.0 runtime ZIP; its 45.0.0 resource metadata is expected. The separate Electron Packager launcher is patched to app 0.2.8. The installed app version is in app.asar and Setup resources.','runtimeVerification':verification,'files':files,'limitations':['ASLR/DEP/CFG fields are static opt-in flags, not proof of runtime effectiveness or exploit mitigation.','Empty certificate directories establish that these files contain no embedded Authenticode signature; this does not assess catalog signatures, reputation, malware or Windows security acceptance.','PE parse and source parity do not establish successful installation, execution, DLL loading or uninstallation.']}
 (OUT/'pe-security.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':status,'checks':checks,'runtimeVerification':verification,'files':[{'file':f['file'],'bytes':f['bytes'],'sha256':f['sha256'],'architecture':f['architecture'],'subsystem':f['subsystem'],'versions':[{k:v for k,v in r.items() if k!='strings'} for r in f['versionResources']],'level':f['installerExecutionLevel'],'manifestCount':len(f['manifests'])} for f in files]},ensure_ascii=False,indent=2))
 if status=='fail':raise SystemExit(1)
if __name__=='__main__':main()
