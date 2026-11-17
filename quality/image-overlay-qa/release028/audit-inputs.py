"""Read-only frozen input/file-set audit; outputs only this report."""
from pathlib import Path
import argparse,datetime,hashlib,json,os
ap=argparse.ArgumentParser();ap.add_argument('--repo-root',required=True,type=Path);ap.add_argument('--artifact-dir',required=True,type=Path);ap.add_argument('--output-dir',required=True,type=Path);a=ap.parse_args();r=a.repo_root.resolve();art=a.artifact_dir.resolve();o=a.output_dir.resolve()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
frozen=art/'frozen-inputs-before.json'; expected='7d9bb0aeb53e97fbf40c09478da49ee99e469f2524ec73f7ff876a8f7cbf91af';assert sha(frozen)==expected,'Frozen input manifest was modified'
prior=json.loads(frozen.read_text());changed=[];symlinks=[]
for e in prior:
 p=r/e['path']
 if p.is_symlink():symlinks.append(e['path'])
 if not p.is_file() or p.stat().st_size!=e['bytes'] or sha(p)!=e['sha256']:changed.append(e['path'])
roots=['src','assets','tests','backend','tools','docs','installer/payload','installer/generated','installer/licenses','installer/windows-codec'];files=set(p for root in roots for p in (r/root).rglob('*') if p.is_file());files.update(p for p in r.iterdir() if p.is_file() and p.suffix in ['.json','.cjs','.md','.txt']);files.update(r/p for p in ['installer/MintPortrait.nsi','installer/prepare.py','installer/BUILD.md','installer/payload-manifest.json'])
paths={str(p.relative_to(r)) for p in files};before={e['path'] for e in prior};added=sorted(paths-before);removed=sorted(before-paths)
toolchain=json.loads((o/'toolchain-provenance.json').read_text());allowed_links={str(Path('tools/nsis/root')/e['path']):e['target'] for package in toolchain['packages'] for e in package.get('actualSymlinksMatchedToPackage',[])}
unknown_symlinks=[name for name in symlinks if name not in allowed_links or os.readlink(r/name)!=allowed_links[name]]
report={'status':'pass' if not changed and not added and not removed and not unknown_symlinks else 'fail','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'frozenManifestSha256':expected,'checkedFiles':len(prior),'modifiedFiles':changed,'addedFiles':added,'removedFiles':removed,'officialToolchainSymlinks':symlinks,'unexpectedSymlinks':unknown_symlinks,'payloadManifestSha256':sha(r/'installer/payload-manifest.json'),'scope':'Exact immutable source, tests, generated payload, installer inputs, and cached toolchain inventory; compilation output and audit reports excluded.'}
(o/'frozen-inputs-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));assert report['status']=='pass'
