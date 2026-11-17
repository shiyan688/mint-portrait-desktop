"""Independent exact-extraction and compiled-NSIS-header audit; never execute PE files."""
from pathlib import Path
import argparse,hashlib,json,struct,lzma,subprocess,tempfile,importlib.util,datetime,re
ap=argparse.ArgumentParser();ap.add_argument('--repo-root',required=True,type=Path);ap.add_argument('--output-dir',required=True,type=Path);ap.add_argument('--artifact-dir',required=True,type=Path);ap.add_argument('--mode',choices=['online','offline','both'],default='both');args=ap.parse_args()
r=args.repo_root.resolve();o=args.output_dir.resolve();seven=r/'tools/nsis/7zip/7zz'
spec=importlib.util.spec_from_file_location('pe_audit',o/'audit-pe.py');pe=importlib.util.module_from_spec(spec);spec.loader.exec_module(pe)
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((r/'installer/payload-manifest.json').read_text());meta=json.loads((r/'release-config.json').read_text());version=meta['version'];assert version=='0.2.8'
source=(r/'installer/MintPortrait.nsi').read_text();runtime_url=re.search(r'!define RUNTIME_URL "([^"]+)"',source)[1];runtime_sha=re.search(r'!define RUNTIME_SHA "([^"]+)"',source)[1]
assert runtime_url=='https://github.com/electron/electron/releases/download/v45.0.0/electron-v45.0.0-win32-x64.zip';assert runtime_sha=='ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47'
expected_asar='108ffadbf3bd4e11a658ced310da98dfcbccc728f053b19462cb085b4f036a20';assert sha((r/'installer/payload-manifest.json').read_bytes())=='5821bc43931986eba18f05cde6aa056490bdd446ec0df47c3717229dcd6e2644'
# Verify source ordering as well as presence. Full safe-path interpreter/regression
# coverage lives in installer-release-tests.tap; these are additional static guards.
def function(name):return source.split('Function '+name+'\n',1)[1].split('FunctionEnd',1)[0]
download=source.index('INetC::get');cancel=source.index('$0 == "Cancelled"',download);hashcall=source.index('StdUtils::HashFile',download);hashcheck=source.index('$0 != "${RUNTIME_SHA}"',hashcall);extract=source.index('nsisunz::Unzip');stage=source.index('GetTempFileName $Stage',download);commit=source.index('Rename "$Stage" "$INSTDIR"',stage)
checks={'cancelBeforeHashAndStage':download<cancel<hashcall<hashcheck<stage<extract<commit,'cancelFailsClosed':'Goto install_fail' in source[cancel:hashcall],'checksumFailsClosed':'Goto install_fail' in source[hashcheck:stage],'downloadHasTimeoutAndCancelPrompt':all(x in source[download:cancel] for x in ['/CONNECTTIMEOUT 30','/RECEIVETIMEOUT 60','/CANCELTEXT','/QUESTION','/NOCOOKIES']),'noWeakNetworkSecurity':'/WEAKSECURITY' not in source,'safeDestinationBeforeAfterNetworkAndBeforeCommit':source[:download].count('Call CheckEmptyDestination')>=2 and 'Call CheckEmptyDestination' in source[hashcheck:stage] and 'Call CheckEmptyDestination' in source[extract:commit],'cleanupRequiresOwnedUncommittedStage':all(x in function('CleanupStage') for x in ['$StageOwned == "1"','${PRODUCT_ID}','RMDir /r "$Stage"']) and 'StrCpy $StageOwned "0"' in source[commit:source.index('StrCpy $Committed "1"',commit)],'newPathWin32Fix':('GetFullPathNameW' in source and 'PathInput' in source and 'PathCandidate' in source),'freshOnlyOldInstallRejected':all(x in function('.onInit') for x in ['ReadRegStr','InstallLocation','Abort']),'noForcedKillOrPrivilegeBypass':not re.search(r'(?:_KillProcess|_CloseProcess|--no-sandbox|ExecutionPolicy)',source)}
assert all(checks.values()),checks
reports=[]
for mode in (['online','offline'] if args.mode=='both' else [args.mode]):
 offline=mode=='offline';name=f'MintPortrait-Development-{version}'+('-Offline' if offline else '')+'-Setup.exe';exe=args.artifact_dir/name;raw=exe.read_bytes();assert raw==(r/'installer/out'/('MintPortrait-Offline-Setup.exe' if offline else 'MintPortrait-Setup.exe')).read_bytes()
 expected=manifest if offline else [e for e in manifest if e['path'].startswith('resources/') or e['path'] in ['MintPortrait.ico','使用说明.txt','INSTALLER-NOTICES.txt','NSIS-LICENSES.txt']]
 # NSIS solid LZMA header, independent of 7-Zip: validate first header, decode
 # only the bounded metadata block, then inspect compiled UTF-16 strings.
 sig=raw.index(b'\xef\xbe\xad\xdeNullsoftInst');start=sig-4;flags,magic,s1,s2,s3,hlen,following=struct.unpack_from('<7I',raw,start)
 assert raw[start+4:start+20]==b'\xef\xbe\xad\xdeNullsoftInst';assert 1024<hlen<1024*1024;assert start+following==len(raw)
 compressed=raw[start+28:];prop=compressed[0];lc=prop%9;prop//=9;lp=prop%5;pb=prop//5;dictionary=struct.unpack_from('<I',compressed,1)[0];assert dictionary<=64*1024*1024
 dec=lzma.LZMADecompressor(format=lzma.FORMAT_RAW,filters=[{'id':lzma.FILTER_LZMA1,'dict_size':dictionary,'lc':lc,'lp':lp,'pb':pb}]);header=dec.decompress(compressed[5:],max_length=hlen+4);assert struct.unpack_from('<I',header)[0]==hlen;header=header[4:];assert len(header)==hlen
 contains=lambda text:text.encode('utf-16le') in header
 common=['GetFullPathNameW','GetFileAttributesW','MintPortrait.Desktop','0.2.8','SHA2-256']
 compiled={s:contains(s) for s in common};assert all(compiled.values());forbidden_compiled=['/WEAKSECURITY','--no-sandbox','ExecutionPolicy','_KillProcess','_CloseProcess'];assert not any(contains(s) for s in forbidden_compiled)
 online_strings=[runtime_url,runtime_sha,'Cancelled','/NOCOOKIES','/CONNECTTIMEOUT','/RECEIVETIMEOUT','/CANCELTEXT','/QUESTION','下载已取消，未安装程序。','下载文件校验失败，已停止，未运行任何下载程序。']
 for s in online_strings:assert contains(s)==(not offline),(mode,s)
 subprocess.run([str(seven),'t',str(exe)],check=True,stdout=(o/(mode+'-archive-test.log')).open('w'))
 listing=subprocess.run([str(seven),'l','-slt',str(exe)],check=True,stdout=subprocess.PIPE,text=True).stdout;(o/(mode+'-archive-inventory.txt')).write_text(listing)
 with tempfile.TemporaryDirectory(prefix='mint-028-exact-audit-') as temp:
  t=Path(temp);subprocess.run([str(seven),'x','-y',str(exe),'-o'+str(t)],check=True,stdout=(o/(mode+'-archive-extract.log')).open('w'))
  archives=list(t.rglob('app.asar'));assert len(archives)==1;product=archives[0].parent.parent
  found=sorted(str(p.relative_to(product)).replace('\\','/') for p in product.rglob('*') if p.is_file());want=sorted([e['path'] for e in expected]+['Uninstall.exe']);assert found==want,{'unexpected':set(found)-set(want),'missing':set(want)-set(found)}
  records=[]
  for e in expected:
   p=product/e['path'];assert not p.is_symlink();b=p.read_bytes();assert len(b)==e['bytes'] and sha(b)==e['sha256'];records.append(e)
  assert len(expected)==(91 if offline else 19);assert sha(archives[0].read_bytes())==expected_asar
  pluginroot=t/'$PLUGINSDIR';plugins=sorted(p.name for p in pluginroot.iterdir());plugin_names=['modern-wizard.bmp','nsDialogs.dll','System.dll','nsProcess.dll','StdUtils.dll']+([] if offline else ['INetC.dll','nsisunz.dll']);assert plugins==sorted(plugin_names),plugins
  plugin_records=[]
  for name in plugins:
   b=(pluginroot/name).read_bytes();matches=[]
   if name=='modern-wizard.bmp':candidates=(r/'tools/nsis/root/usr/share/nsis/Contrib/Graphics').rglob('*.bmp')
   else:candidates=[r/'tools/nsis/root/usr/share/nsis/Plugins/x86-unicode'/name,r/'tools/nsis/resources/plugins/x86-unicode'/name]
   for candidate in candidates:
    if candidate.is_file() and candidate.read_bytes()==b:matches.append(str(candidate.relative_to(r)))
   assert matches,('Unexpected/unmatched compiler plugin',name);plugin_records.append({'path':name,'bytes':len(b),'sha256':sha(b),'matchesCachedCompilerFiles':matches})
  allfiles=sorted(str(p.relative_to(t)) for p in t.rglob('*') if p.is_file());assert len(allfiles)==len(found)+len(plugins)
  uninstall=pe.parse(product/'Uninstall.exe');assert uninstall['machine']=='0x14c' and uninstall['subsystem']==2 and uninstall['certificateDirectory']==[0,0] and uninstall['installerExecutionLevel']=='asInvoker';uninstall['file']='embedded/Uninstall.exe'
  readme_bytes=(product/'使用说明.txt').read_bytes()
  readme=(product/'使用说明.txt').read_text(encoding='utf-8-sig');assert 'Setup尚未生成或交付' not in readme;assert '本地图片贴图' in readme;assert '工程写v16并读取v1–15' in readme;assert '16位RGB PNG' in readme and '8位sRGB' in readme;assert '仍不代表Windows真机' in readme
 report={'mode':mode,'status':'pass','file':exe.name,'bytes':len(raw),'sha256':sha(raw),'payloadManifestSha256':sha((r/'installer/payload-manifest.json').read_bytes()),'productFileCount':len(records),'productFiles':records,'exactProductAndAuxiliaryInventory':True,'appAsarSha256':expected_asar,'plugins':plugin_records,'uninstaller':uninstall,'compiledNsisHeader':{'sha256':sha(header),'bytes':len(header),'solidLzmaDictionaryBytes':dictionary,'commonStringsVerified':compiled,'forbiddenSecurityBypassStringsAbsent':forbidden_compiled,'onlineRuntimeAndCancellationStringsPresent':not offline,'offlineDownloaderStringsAbsent':offline},'unsigned':True,'installedReadme':{'bytes':len(readme_bytes),'sha256':sha(readme_bytes),'overlaysAndProject16AndEightBitColorFixDisclosed':True},'windowsExecuted':False}
 (o/(mode+'-exact-artifact-audit.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');reports.append({k:report[k] for k in ['mode','status','file','bytes','sha256','productFileCount']});print(json.dumps(reports[-1]))
summary={'status':'pass','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':version,'sourceGuards':checks,'runtime':{'url':runtime_url,'bytes':158223852,'sha256':runtime_sha},'installers':reports,'windowsExecuted':False,'limits':['Exact archived-byte, compiled metadata/string, source-ordering and source-regression evidence only. No Windows download, install, launch, DLL loading, uninstall or UI/runtime behavior was exercised.','Known-secret signature and exact QA fixture checks do not prove absence of every possible encoded secret.']}
(o/('installed-artifacts-audit-'+args.mode+'.json')).write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
