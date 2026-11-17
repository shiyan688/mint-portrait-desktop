"""Statically inspect installer documentation without executing prepare.py."""
from pathlib import Path
import ast,json,hashlib,re,datetime,argparse
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--repo-root',type=Path,default=Path.cwd(),help='Source repository root (default: current directory)')
ap.add_argument('--output-dir',type=Path,default=Path.cwd()/'audit-output',help='Report destination (default: ./audit-output)')
args=ap.parse_args();r=args.repo_root.resolve();out=args.output_dir.resolve();out.mkdir(parents=True,exist_ok=True)
tree=ast.parse((r/'installer/prepare.py').read_text())
readme=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='readme' for t in n.targets))
p=r/'installer/payload/使用说明.txt';b=p.read_bytes();actual=b.decode('utf-8-sig')
version=int(re.search(r'const VERSION = (\d+)',(r/'src/project-document.cjs').read_text()).group(1))
checks={'generatedReadmeEqualsSourceLiteral':actual==readme,'currentProjectVersionMatches':f'工程写v{version}并读取v1–{version-1}' in actual,'obsoleteV11ParagraphRemoved':'工程当前v11读取旧1至10' not in actual and '工程现已升级v11' not in actual,'unsignedAndWindowsUntestedDisclosure':'本安装包未签名，尚未实际Windows安装/运行/卸载验收' in actual,'stopOnSecurityBlockDisclosure':'遇到安全拦截请停止并反馈，不绕过警告或组织策略' in actual}
report={'release':'0.2.6','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'pass' if all(checks.values()) else 'fail','checks':checks,'readme':{'file':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()},'currentProjectVersion':version,'sourceLiteralReadStatically':True,'issue':'Removed stale v11 claims after independent audit reported a contradiction with v13.','limitations':'Installer-extracted readme parity is covered by the owner’s independent extraction/hash checks.'}
(out/'documentation-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
if not all(checks.values()):raise SystemExit(1)
