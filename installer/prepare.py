from pathlib import Path
import zipfile,hashlib,json,shutil,os,re
ROOT=Path(__file__).resolve().parents[1];HERE=ROOT/'installer';PAY=HERE/'payload';GEN=HERE/'generated'
# Canonical build release metadata is separate from source-checkpoint status.
def strict_pairs(pairs):
 out={}
 for key,value in pairs:
  if key in out: raise ValueError('Duplicate release metadata key')
  out[key]=value
 return out
release=json.loads((ROOT/'release-config.json').read_text(),object_pairs_hook=strict_pairs)
assert type(release) is dict and set(release)=={'schemaVersion','version','channel'}
assert type(release['schemaVersion']) is int and release['schemaVersion']==1
VERSION=release['version'];assert type(VERSION) is str and re.fullmatch(r'(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})',VERSION)
assert all(int(part)<=65535 for part in VERSION.split('.'))
assert release['channel']=='development';CHANNEL_LABEL='开发候选版'
package=json.loads((ROOT/'package.json').read_text());lock=json.loads((ROOT/'package-lock.json').read_text())
assert package['version']==lock['version']==lock['packages']['']['version']==VERSION,'Run tools/sync-release.cjs --write before preparing the installer'
project_versions=re.findall(r'\bconst VERSION = ([0-9]+)',(ROOT/'src/project-document.cjs').read_text())
assert len(project_versions)==1;PROJECT_VERSION=int(project_versions[0]);assert 1<=PROJECT_VERSION<=65535

RUNTIME=Path(os.environ['RUNTIME_ZIP']) if 'RUNTIME_ZIP' in os.environ else next(Path('/tmp/mint-electron-cache').rglob('electron-v45.0.0-win32-x64.zip'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(RUNTIME)=='ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47'
shutil.rmtree(PAY,ignore_errors=True);PAY.mkdir();GEN.mkdir(exist_ok=True)
with zipfile.ZipFile(RUNTIME) as z:
 for n in z.namelist():
  assert '..' not in Path(n).parts and not n.startswith(('/', '\\'))
 z.extractall(PAY)
(PAY/'electron.exe').rename(PAY/'MintPortrait.exe');(PAY/'resources/default_app.asar').unlink()
shutil.copy2(Path(os.environ.get('ASAR_FILE',str(ROOT/'dist/Mint Portrait-win32-x64/resources/app.asar'))),PAY/'resources/app.asar')
unpacked=Path(os.environ.get('ASAR_FILE',str(ROOT/'dist/Mint Portrait-win32-x64/resources/app.asar'))).with_name('app.asar.unpacked')
assert unpacked.is_dir(), 'Native Windows Sharp runtime is missing'
shutil.copytree(unpacked,PAY/'resources/app.asar.unpacked')
shutil.copy2(ROOT/'assets/icon.ico',PAY/'MintPortrait.ico')
PIPELINE_ORDER='构图 → 调平 → 透视 → 留白 → 贴图 → 文字 → 绘画 → 马赛克/不透明遮盖 → 可选最终缩小 → 编码'
readme='''薄荷人像 Desktop __RELEASE_VERSION__ · Windows x64 __RELEASE_CHANNEL_LABEL__

这是独立人像修图软件，不是像素蛋糕官方产品。
已安装到你选择的目录。桌面或开始菜单可启动；Windows“设置 → 应用”中可卸载。
在线 Setup 仅在安装时从 Electron 官方 GitHub 下载运行组件约 158 MB，SHA-256 校验后安装；离线 Setup 不需要联网。安装后的照片处理均离线，无账户、API 密钥或照片上传。
安装无需管理员权限，不改安全策略、不关闭防护、不创建开机启动。

请先使用照片副本测试。
这是__RELEASE_VERSION__未签名__RELEASE_CHANNEL_LABEL__，新增手动四角透视，保留本地图片贴图与无ICC的16位PNG导出偏色修补；仍不代表Windows真机、4060性能或SOTA修肤验收。
新增“四角透视”：右侧点击“编辑四角”，依次选左上/右上/右下/左下，在画布点选或拖动，也可填写百分比；输入基于裁剪/调平后的画面。输出宽高比例针对该完整输入画面，界面显示实际尺寸；点击“应用透视”才保存为可撤销步骤，取消或切换基准不改已提交照片。交叉/凹形/退化输入拒绝，默认不改变图像；传统几何重采样可能软化纹理，不是AI修复、无损或自动镜头校正。
透视在构图/调平之后、留白/贴图/文字/绘画/遮盖之前。原图坐标编辑保留；最终图层不跟随照片透视变形。已有绘画/遮盖绑定几何，修改或重置透视会拒绝，隐藏/空层也不会被偷偷移动或清空。捕获源图选区的最终绘画/遮盖暂不支持与透视组合；应明确清除或撤销相关层后再改变几何。开启透视后须先重置，再更改上游裁剪/旋转/调平。原件保留；命名调色预设和跨片同步不传递透视。原尺寸超限不会自动缩小，小输出不能绕过处理预算。请检查最终导出；预览不等于原尺寸像素验收。
新增“本地图片贴图”：右侧展开“本地图片贴图” → “从本机导入图片层”，调整位置/大小/旋转/透明度/翻转后点击“应用贴图”；也可“在画布点选中心”。输入未应用时不进入照片、工程或导出，取消输入不改原图。最多4层，可重编、隐藏、上下移或移除，所有应用均可撤销。只读取本机选择的单帧JPEG/PNG/WebP（编码≤32MiB、输入≤24MP/8192边），转换为≤1024长边/1MP的8位sRGB工作素材；放大会变软，不是AI超分。缺少ICC时不猜测原色域，按解码器提供的sRGB通道处理；有ICC时显式转换。素材不保留路径或原EXIF，但工作像素及名称会嵌入工程与可选恢复草稿；跨片同步和命名预设不携带素材。每照片素材≤16份/32MiB原始RGBA，全会话≤128份/64MiB；撤销/重做或最近导出引用的素材仍保留。
贴图在构图、调平、透视、留白之后，文字、绘画和遮盖之前，最后才缩小输出。启用时最终处理画布≤16,777,216像素/16384边，并有256MiB图层累计分配及整体512MiB缓冲等预算，复杂组合会更早拒绝；后续缩小不能绕过。原尺寸超限时必须明确选择工作尺寸，并检查最终成品。
修复0.2.7中无ICC、16位RGB PNG进入native导出时强制套ICC造成的偏色。已用原版实际代码复现并做8/16位、带ICC、CMYK/灰阶和透明度回归；主照片原始字节始终保留。处理及输出仍是8位sRGB，不是16位工作流、RAW或完整色彩管理验收。
保留“细节与锐化”：默认强度0，明确应用/取消；强度、半径、阈值可撤销保存。传统亮度细节增强，不是去噪、失焦修复或SOTA。大半径/低阈值会强化噪声，半径1/阈值3较保守。锐化位于照片编辑后、构图/调平/文字/绘画前；手动原图坐标视图暂不显示锐化。开启时所选处理源上限16,777,216像素且受512MiB合并缓冲预算限制，后续裁剪或缩小不能绕过；原尺寸超限不会自动缩小，可明确选择工作尺寸并逐张检查。预览与原尺寸不是逐像素等价，请检查成品100%细节。命名调色预设不传递锐化，整体同步参数会传递。
保留“任意角度调平”：先输入角度/扩展或居中裁切，再明确应用；待应用字段不影响保存和导出。顺序为__PIPELINE_ORDER__。默认0不变，精确90度倍数复制像素；其他角度线性光预乘alpha双线性重采样，可能软化，极小非零角度也不会自动吸附0度。对比原图使用同几何；选区绑定的绘画/遮盖在非90度角会明确拒绝。几何受512MiB保守缓冲预算约束，原图/工程历史保留。
保留“绘画与橡皮”：右侧选择“绘画画笔”或“本层橡皮”，在最终画布拖动后松开提交一笔；橡皮只减当前透明绘画层，不擦原图。最多4层，支持显示/隐藏、上下移、取色与撤销；“下一笔新建层”建立独立层。原图选区会在新层建立时冻结，已有层继续使用自己的选区；有绑定图层时改变构图/形变需先撤销或清除。复杂笔画和最终画布有16MP工作量预算，超限明确拒绝，不靠最终缩图绕过。
保留“逐人调整”：点“启用逐人模式”，在“当前人物”下拉框明确选人后再调人像滑杆；“查看原图中的人物编号”显示原图位置，调节后返回结果。最多5人、默认全零，各人从同一不可变阶段输入计算，编号仅属于当前检测批次，不是身份跟踪。重新检测建立新全零批次，不按旧编号继承。近邻影响区重叠、透明塑形、手动液化混用或超资源预算明确拒绝。新逐人眼睛/瘦脸0–60、鼻子/下颌-50–50；不会推断族裔或统一漂白。完整配方只用于当前所选人，批量模式只调色，不把网格和人物参数移植到其他照片。
逐人修饰仍是传统可调处理，学习模型只提供人脸关键点，不是学习型修肤或SOTA美颜验收。已测公开合成2/5人样片，不等于实拍合照普遍质量或你的4060性能。工程写v__PROJECT_VERSION__并读取v1–__PROJECT_PREVIOUS__，旧版本不能打开新工程，请保留旧文件备份。
保留明暗与白平衡：阴影/高光是默认中性的全局亮度曲线；中性区域吸管从明暗阶段之前的输入像素取样，只保存RGB增益。过暗、过曝、半透明、明显混色或不足的有效样本会拒绝，保留原设置。取样视图排除本组及后续色阶/曲线/局部/手动变形/背景/构图/留白/文字/遮盖；不是RAW、Kelvin测量、自动肤色识别或学习型修图。批量复制增益不等于为每张照片自动寻找白点，已丢失的高光或暗部信息无法恢复。
保留“马赛克与遮盖”：在最终画布拖动画笔，松开形成一次可撤销编辑。支持马赛克或不透明纯色遮盖，最多8层、64条笔画、4096点，并受原尺寸工作量及内存预算限制；可隐藏/显示、删除层或撤销。可捕获当前源坐标选区副本，后改选区不改变旧笔画；不透明遮盖拒绝羽化选区。选区遮盖不能与未变形的推形/五官几何混用；有遮盖时改变裁切/旋转/翻转/留白/形变会拒绝，须先清除或撤销遮盖，隐藏层仍保留绑定。预设不含遮盖，参数同步保留各目标照片自己的遮盖及形变。
遮盖顺序是原有图像处理 → __PIPELINE_ORDER__。遮盖最终画布最多16,777,216像素、单边16,384；复杂笔画可能提前达到限制，小输出不能绕过原尺寸预算。预览不是原图像素级隐私检查。
隐私提醒：马赛克不是可靠匿名化；不透明遮盖也不是安全删除。原图、工程内嵌原图、撤销历史和可选恢复草稿仍保留被覆盖内容。只分享逐张检查过的导出成品，不分享原图或可编辑工程。JPG编码和最终缩小会改变边缘颜色；需要精确遮盖像素时选择PNG且不缩小，仍须打开实际输出确认覆盖完整。本程序新编码不带原始EXIF/XMP/内嵌缩略图，不能保证外部软件不会另添元数据。
此前新增可撤销的四边留白/边框，按原图短边比例扩展画布，不重采样原有画面。新增最多8层可编辑文字：多行、系统字体、对齐、位置、旋转、描边、阴影、透明度、隐藏与调序。先应用文字再保存；未应用输入不进入历史、恢复或导出。文字位于最终构图和留白之后，可放在留白中，只有本机字体，不下载字体；换系统字体或换行可能不同。
新增最终文件精确长边：先按所选原像素/工作尺寸处理、构图、留白和排字，再缩小副本；不放大，不用小输出绕过原图或中间图预算。桌面最终缩小用Lanczos3，JPG最后填白；PNG保留透明度并清除alpha为0的隐藏RGB。原图和项目不因尺寸选择而改变。
活动文字最终合成画布最多1600万像素、长边16384；超限明确报错，没有自动降级。
此前新增RGB/分通道色阶：输入黑白点、中间调gamma和输出黑白点；默认精确中性，固定在基础调色后、曲线前。命名预设现为v3，包含明暗/白平衡和色阶并兼容旧v1/v2。修复手动推形后最终构图/导出因多余诊断字段被拒绝的问题。
新增固定处理预览参考与双栏联动缩放/平移，以及默认关闭的RGBA预览读数。两者都是长边1280预览，不是原图1:1、RAW信息或人脸配准，不写入照片历史或导出。
“本地项目”下的“本地恢复草稿”可选择每代64/128/256/512MiB，默认128。稳定30秒后尝试记录，保留两代；写入还需临时空间，降低容量不删除旧大文件。旧草稿需明确恢复或开始本次记录后才继续轮换；最新损坏时只提供上一代选择，不自动替换当前会话。关闭功能保留已有草稿。恢复后须正式另存。
新增无损构图：最终裁切、90度旋转和翻转保留原图及原图坐标的已有编辑。新增“我的调整预设”，只传人像数值/基础调色/明暗白平衡/色阶/曲线HSL，不传照片、路径、蒙版、笔画、几何、取样点位或人脸数据。新增“选片管理”：0至5星、精选/拒绝、色标、筛选排序和独立标记撤销；评分标记随工程保存。筛选不自动取消勾选；批量包含隐藏或拒绝照片时需确认。0至5评分，P精选、U取消旗标、X拒绝，F适应画布。
新增RGB/分通道五节点曲线（单调/自由）、八色HSL和处理后预览直方图，默认不改变图像。直方图按预览采样，不代表RAW高光数据。
包含选区画笔/套索/羽化/反选、推形/恢复、显式取样修复和仿制；它们是传统手动工具，不是自动AI祛痘。先推形再修复；手动推形不能与旧背景蒙版/自动五官塑形组合。带透明度的输入不支持手动推形，会明确拒绝而非抹去透明度；修复大笔在预览和导出使用同一保守面积限制。原图不会改写，导出重名会自动编号。
支持 JPEG、PNG、WebP 导入；JPEG、PNG 导出。原尺寸基础调色/局部调整上限6400万像素，单边16384；人像/背景/手动笔画/选区图层效果仍限1600万像素。工作尺寸长边4096，须明确选择。输出为8-bit sRGB并移除原EXIF；不是RAW、16-bit或专业软打样工作流。工程保存保留原始图片字节、历史和蒙版，关闭前请正式保存.mintproj。可选本机恢复草稿默认关闭，显式开启后在应用专用目录保存完整原图和历史；未加密、不上传。两代草稿不等于正式存档，也不保证含最近修改。
柔肤、美型和可选局部妆色仍是关键点辅助的传统像素算法，不等同SOTA或商业精修。新妆色默认关闭，最高组合强度仍可能过软。SegFace/BiRefNet研究模块不随此安装包包含Python环境和权重，必须显示缺失/实验或质量阻断，不会自动下载或偷偷退回旧模型。
无商业素材授权的公共QA照片不会随软件安装。本开发候选版不代表完整功能和美颜质量验收完成。
导出以临时文件+原子不覆盖写入保护原文件；不支持硬链接的文件系统会报错，不会生成半成品或覆盖原图。

本安装包未签名，尚未实际Windows安装/运行/卸载验收；已做源码、安全、文件完整性及打包检查。遇到安全拦截请停止并反馈，不绕过警告或组织策略。
重装前请先通过“已安装应用”卸载旧版，再运行Setup。卸载只删除程序自有文件，保留其他文件及照片、用户工程和AppData偏好/命名预设/恢复草稿。

第三方许可：Electron根目录LICENSE和LICENSES.chromium.html；程序内MediaPipe、Sharp Apache-2.0及其libvips依赖许可；安装器许可见INSTALLER-NOTICES.txt。
'''
readme=readme.replace('__RELEASE_VERSION__',VERSION).replace('__RELEASE_CHANNEL_LABEL__',CHANNEL_LABEL).replace('__PROJECT_VERSION__',str(PROJECT_VERSION)).replace('__PROJECT_PREVIOUS__',str(PROJECT_VERSION-1)).replace('__PIPELINE_ORDER__',PIPELINE_ORDER)
assert not re.search(r'__[A-Z_]+__',readme),'Unresolved installed README template'
(PAY/'使用说明.txt').write_text(readme,encoding='utf-8-sig')
notices='''Installer third-party notices

NSIS 3.11 (official Debian distribution). NSIS compiler, stubs and standard plugins retain their original licenses. See https://nsis.sourceforge.io/License and https://packages.debian.org/trixie/nsis .

Native installer plugins are unmodified binaries from electron-builder's official nsis-resources 3.4.1 release:
https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z
SHA512(base64): Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0JTldxZu4NFoEmW4kJgZ3DlSWVON3+Q==
INetC by Takhir and contributors, based on InetLoad and NSISdl; WinINet HTTPS downloader. https://nsis.sourceforge.io/Inetc_plug-in
nsProcess by Instructor and contributors; used only to detect running app processes, never to kill them. https://nsis.sourceforge.io/NsProcess_plugin
StdUtils by LoRd_MuldeR and contributors, LGPL-2.1 with the NSIS installer exception/clarification. https://nsis.sourceforge.io/StdUtils_plug-in . The unmodified library is used through the NSIS plugin interface; it is not modified or derived into our source. Source is available from the linked upstream project.
nsisunz by Saivert, based on NSIS Zip2Exe, zlib (Mark Adler) and ZIP routines (Gilles Vollant). https://nsis.sourceforge.io/Nsisunz_plug-in

nsisunz license:
This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.
Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:
1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.
2. Altered versions must be plainly marked as such, and must not be misrepresented as being the original software.
3. This notice may not be removed or altered from any distribution.
'''
notices += '\nStdUtils source: https://github.com/lordmulder/stdutils\n\n' + (HERE/'licenses/LGPL-2.1.txt').read_text()
(PAY/'INSTALLER-NOTICES.txt').write_text(notices,encoding='utf-8')
shutil.copy2(HERE/'licenses/NSIS-COPYRIGHT.txt',PAY/'NSIS-LICENSES.txt')
files=[]
for p in sorted(PAY.rglob('*')):
 if p.is_file():files.append({'path':p.relative_to(PAY).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
(HERE/'payload-manifest.json').write_text(json.dumps(files,ensure_ascii=False,indent=2))
# Exact paths are generated from our curated package, never from a mutable installation manifest.
verify=['!macro VerifyPayload ROOT']
for f in files:
 n=f['path'].replace('/','\\');verify += [f'  Push "SHA2-256"',f'  Push "${{ROOT}}\\{n}"','  StdUtils::HashFile','  Pop $0',f'  StrCmp $0 "{f["sha256"]}" +3',f'    StrCpy $Failure "文件校验失败：{n}"','    Goto install_fail']
verify+=['!macroend']
(GEN/'verify.nsh').write_text('\n'.join(verify)+'\n',encoding='utf-8-sig')
remove=['!macro RemoveOwnedPayload ROOT']
for f in files:
 n=f['path'].replace('/','\\');remove += ['  ClearErrors','  Delete "${ROOT}\\'+n+'"','  ${If} ${Errors}','    StrCpy $DeleteFailed "1"','  ${EndIf}']
for d in sorted([p for p in PAY.rglob('*') if p.is_dir()],key=lambda p:len(p.parts),reverse=True):remove.append('  RMDir "${ROOT}\\'+str(d.relative_to(PAY)).replace('/','\\')+'"')
remove+=['!macroend'];(GEN/'remove.nsh').write_text('\n'.join(remove)+'\n',encoding='utf-8-sig')
# Check every traversed directory, not merely resources/locales, before exact-path removal.
dirs=sorted([p.relative_to(PAY).as_posix() for p in PAY.rglob('*') if p.is_dir()],key=lambda p:(p.count('/'),p))
guards=['!macro ValidateOwnedPayloadDirectories ROOT']
for d in dirs:
 n=d.replace('/','\\')
 guards += [f"  System::Call 'kernel32::GetFileAttributesW(w \"${{ROOT}}\\{n}\") i .r0 ?e'",'  Pop $1','  ${If} $0 == -1','    ${If} $1 != 2','    ${AndIf} $1 != 3','      MessageBox MB_OK|MB_ICONSTOP \"无法验证程序目录属性。为保护其他文件，已停止卸载。\"','      Abort','    ${EndIf}','  ${Else}','    IntOp $0 $0 & 0x400','    ${If} $0 != 0','      MessageBox MB_OK|MB_ICONSTOP \"程序子目录已被替换为链接。为保护其他文件，已停止卸载。\"','      Abort','    ${EndIf}','  ${EndIf}']
guards+=['!macroend'];(GEN/'directory-guards.nsh').write_text('\n'.join(guards)+'\n',encoding='utf-8-sig')
print('Prepared',len(files),'payload files',sum(f['bytes'] for f in files),'bytes; app.asar',sha(PAY/'resources/app.asar'))
