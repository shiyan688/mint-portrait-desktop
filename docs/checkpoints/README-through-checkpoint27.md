# Archived source README through checkpoint 27

This is historical source documentation, not the current release status. See the root README and the current release manifest.

# 薄荷人像 Desktop0.2.8 已交付开发版源码（checkpoint27）

本版是可编辑本地图片贴图与已验证的未标记16bit RGB PNG native导出ICC修正版。最多4层，素材转为≤1024边/1MP的8bit sRGB工作像素；主照片原件不改。它不是16bit/RAW工作区或AI超分。右侧“本地图片贴图”→“从本机导入图片层”，调整后点“应用贴图”，或“取消输入 / 导入”。

在线/离线Setup均已编译、独立逐文件检查、入库回读；在线附件发送已获回执，但未验证用户打开或安装。当前工程v16读取v1–15，命名调色预设v3。2997项工作树与2997项新目录恢复回归通过，另有54项归档、126项安装/封装检查。源码checkpoint27仅补发布记录，应用/测试/构建源与编译输入checkpoint26一致。详见docs/checkpoints/RELEASE-0.2.8.md与CHECKPOINT.md。

未做Windows安装/运行/卸载、真实浏览器布局、4060性能、SOTA修肤或完整竞品验收。安装包未签名，遇安全警告请停止并反馈，不绕过策略。卸载旧版后重装，照片/工程/AppData保留。旧安装包/源包版本仍保留。

## 当前源码的精确恢复
先取得基础源码 libfile_409356280a8c8191a5bf3fd3cbdffe91 版本1，再用本源码 libfile_c7367392a7ec8191ad5f8bc8dafbc223 checkpoint27覆盖。四份QA包均需保持精确版本：
- libfile_c60c939b4c948191b422c7dc7b15e49e 版本4：MintPortrait-QA-Checkpoint20.zip，61564488字节，SHA256 4b39f257cf700d59b5da62e2fdaf41802f41e58fc6da5e9e8e4c4630f40b7b1d。
- libfile_c5ac740d6d208191897230d3878b5291 版本0：MintPortrait-QA-Straighten-Checkpoint22.zip，5115930字节，SHA256 019fb6f25a5595ba6ff8d523b159ce3da45e2bcbc1d32bc1a264bde93f0c88c4。
- libfile_d1c310bcd2bc8191bcf6bbaf8f2dac8e 版本0：MintPortrait-QA-Sharpness-Checkpoint23.zip，1783133字节，SHA256 43663e37867a3f5567dbad0732094f9ed152018d45548eeb3ff476025b3b518b。
- libfile_32b4b1bad3788191b4b95696586bbdbb 版本0：MintPortrait-QA-ImageLayers-Checkpoint26.zip，778370字节，SHA256 2f0be34965c34363b4d9c8f570c8c48cde57f7d8eb5d74f412accd72a7f67906。
通过官方Library流程取得文件。将四个本地ZIP路径分别传给 tools/archive-checkpoint.py 的 --restore-qa 参数，再运行 --verify-qa；脚本只做本地安全/hash验证和恢复，不登录/下载，也不接受猜测的私有URL。QA-RESTORE.json绑定全部186份二进制证据；本轮无新QA图。依赖、模型、字体、运行时和安装器不在源码ZIP，测试必须具备文档列明的已批准依赖及匹配静态打包夹具。QA图片不会安装进应用。

## 以下为保留的历史记录，不代表当前状态或恢复清单

# 薄荷人像 Desktop 0.2.8 未发布候选源码（checkpoint26）

本轮新增本地图片贴图：最多4层，位置/大小/旋转/透明度/翻转可编辑，明确应用/取消，撤销重做，独立素材随工程保存，不随调色预设或跨片参数同步传播。贴图位于构图/调平/留白之后、文字/绘画/遮盖之前。素材为最多1024长边/1MP的8位sRGB工作像素，非原尺寸素材或AI超分。详见 docs/DESKTOP-IMAGE-LAYERS.zh-CN.md（本文件在docs中时用同目录路径）。

同时修复已交付0.2.7无ICC的16位RGB PNG在native导出强制套ICC产生的偏色。原版实际代码与颜色数值已复现，原件始终未改；新实现仅对有ICC的输入执行ICC转换。仍是8位sRGB处理，不是16位工作流或Windows色彩验收。见 UNTAGGED-PNG-COLOR-FIX.md。

当前工程v16读取v1–15；便携命名预设仍v3。新的Setup将在源码恢复验证后单独构建，本源码检查点不是已交付新安装包。旧0.2.7安装器及所有历史Library版本保留。测试和恢复结果见CHECKPOINT.md；不代表真实浏览器、Windows/4060或SOTA修肤验收。

## 历史记录（以下不代表当前版本）

# 薄荷人像 Desktop 0.2.7 已交付开发版源码（checkpoint25）

本版合并“任意角度调平”与“细节与锐化”。后者采用明确应用/取消、可撤销的强度/半径/阈值控制，作用于照片编辑后、构图与文字/绘画之前。默认0不变，不是AI复原、去噪或SOTA。半径1/阈值3效果克制，强设置会放大噪声；必须检查实际导出100%细节。详见 docs/DESKTOP-SHARPNESS.zh-CN.md。

当前工程v15读取v1–14；命名调色预设仍v3且不携带锐化或几何。2779项工作树云端回归通过，含真实NativeCanvas/Sharp像素与PNG、Worker脚本；另有53项归档安全及117项安装/发布检查。基础包、修正源码和三份QA包在独立空目录恢复后，2779项完整回归再次通过；最后仅补文档/结果及已单独验证的静态审计日志默认路径，应用/测试/版本工具字节不变。在线与离线0.2.7 Setup均已构建、入库并回读，在线附件已获发送回执；不代表用户已安装或Windows验收。编译输入是checkpoint24，本checkpoint25只补发布文档与审计记录，应用/测试/构建工具未变。详情见docs/checkpoints/RELEASE-0.2.7.md。旧0.2.6保持原字节。

安装说明与源码进度文档已分离；release-config.json 是版本/开发通道唯一来源，tools/sync-release.cjs 默认只读检查，避免把“尚未生成”的源码状态放入已安装说明。应用算法与ASAR未变，详见 docs/RELEASE-METADATA.md。

## 历史checkpoint25的恢复记录（非当前）
- 基础源码：libfile_409356280a8c8191a5bf3fd3cbdffe91 版本1；再覆盖本源码包 libfile_c7367392a7ec8191ad5f8bc8dafbc223（checkpoint25）。
- QA：libfile_c60c939b4c948191b422c7dc7b15e49e 版本4，MintPortrait-QA-Checkpoint20.zip，61564488字节，SHA256 4b39f257cf700d59b5da62e2fdaf41802f41e58fc6da5e9e8e4c4630f40b7b1d。
- QA：libfile_c5ac740d6d208191897230d3878b5291 版本0，MintPortrait-QA-Straighten-Checkpoint22.zip，5115930字节，SHA256 019fb6f25a5595ba6ff8d523b159ce3da45e2bcbc1d32bc1a264bde93f0c88c4。
- QA：libfile_d1c310bcd2bc8191bcf6bbaf8f2dac8e 版本0，MintPortrait-QA-Sharpness-Checkpoint23.zip，1783133字节，SHA256 43663e37867a3f5567dbad0732094f9ed152018d45548eeb3ff476025b3b518b。
- 通过官方Library流程获取指定版本，在源码根目录运行 python3 tools/archive-checkpoint.py --restore-qa <QA基础包本地路径> --restore-qa <调平QA本地路径> --restore-qa <锐化QA本地路径>，再运行 --verify-qa。脚本不下载或登录，精确信息在QA-RESTORE.json；共148张/份二进制夹具，原145份不变。
- 依赖、模型、字体、运行时和安装程序不在源码/QA包中。完整测试的依赖和匹配静态载荷前提不能跳过。QA图片不会装入应用，没有Windows或真实浏览器验收，也不表示整体人像质量过关。

以下版本说明是历史交付记录；当前源码恢复依赖以上述列表和 QA-RESTORE.json 为准。

## 历史：薄荷人像 Desktop 0.2.6 已交付开发版

本轮包含独立绘画层/本层橡皮/取色，以及最多5人显式选脸和独立参数。默认全零，同阶段不可变输入，邻脸影响区重叠会拒绝，不追踪身份。右侧入口是“绘画与橡皮”和“逐人调整”；先“启用逐人模式”，再从“当前人物”明确选人。详见 docs/PAINT-DESKTOP-UI.md、docs/PORTRAIT-PEOPLE-UI.zh-CN.md。

本版已通过2548项云端发布回归，本版完整基础包+源码+QA恢复后2548项另行复跑通过，含实际NativeCanvas/Sharp像素与PNG。在线Setup已保存为开发安装包Library版本6，并收到附件发送回执；不把发送回执等同于用户已安装。没有Windows/真实浏览器/4060验收，不是SOTA修肤完成。项目v13读取v1–12，保留原图和历史，旧版不保证打开新工程。

## 精确恢复依赖

- 先恢复基础源码 Library libfile_409356280a8c8191a5bf3fd3cbdffe91 版本1，再覆盖本源码包。当前源码身份为 libfile_c7367392a7ec8191ad5f8bc8dafbc223；具体源码检查点见 CHECKPOINT-FILES.json。
- QA必须使用 Library libfile_c60c939b4c948191b422c7dc7b15e49e 版本4，文件 MintPortrait-QA-Checkpoint20.zip，61,564,488字节，SHA256 4b39f257cf700d59b5da62e2fdaf41802f41e58fc6da5e9e8e4c4630f40b7b1d。不要用未核验的最新版替换指定版本。精确信息还在 QA-RESTORE.json。
- 用官方Library文件流程取得这两个源码包和QA后，在恢复好的源码目录执行 python3 tools/archive-checkpoint.py --restore-qa <本地QA.zip路径>，再执行 --verify-qa。脚本检查路径、完整性与哈希，不负责登录/下载Library，不应编造私有下载URL。
- 原始运行时/模型/依赖/字体不在源码和QA包内；按 installer/BUILD.md 使用已固定官方来源。包装清单测试还需保留的匹配安装载荷和ASAR静态夹具，不可把缺少它们的测试跳过后宣称全套通过。QA图片不进入安装包。

## 已交付历史

## 0.2.5开发版：明暗白平衡与最终画布遮盖

本轮已构建0.2.5，加入“明暗与白平衡”和“马赛克与遮盖”完整工具、历史、工程及原尺寸导出；下方checkpoint16/17与0.2.4段落保留为历史记录，不是当前交付状态。右侧选择不透明遮盖或马赛克画笔，拖动后松开提交；取消/撤销保留原件。当前工程v11可读v1–10，命名预设v3可读v1–2，旧0.2.4不能打开新保存格式，请保留旧工程备份。

马赛克不是可靠脱敏，不透明覆盖也不是安全删除。原图、工程、历史、本地恢复草稿仍保留被遮内容；只分享检查过的导出副本，不把工程当已脱敏文件发送。该版本仍未签名，只有云端源码/实际Canvas像素/原生编码/安装包结构检查，没有Windows安装、运行或界面实测，也不是SOTA修图质量验收。

先保存工作并退出旧版，通过Windows“已安装应用”卸载后安装新版；不删除用户照片、项目或AppData偏好/恢复。在线安装时只下载约158MB固定官方Electron运行组件并校验SHA256，之后照片处理离线。遇到安全拦截请停止反馈，不绕过系统策略。

## 未发布源码增量：最终画布马赛克与遮盖（checkpoint17）

右侧“马赛克与遮盖”新增可撤销画笔、分层开关/删除、选区快照和最终画布重放。先完成构图、留白、文字，再遮盖，最后按导出选项缩小。遮盖与原图和几何配方绑定，改变构图/形变前须先撤销或清除，不会静默移位；不随调色预设或跨片同步复制。工程格式v11读取v1–10，保存完整配方/历史，不替换原件。详见 docs/REDACTION-DESKTOP-UI.md。

马赛克不是可靠脱敏；不透明覆盖也不是安全删除。原件、工程、历史及本地恢复草稿仍保留被遮内容，只应分享检查后的导出副本。PNG不缩小导出可保留硬覆盖像素；JPEG或最终缩小会改变边缘。该模块是传统数学，不是SOTA修图。已交付0.2.4安装包保持不变，Windows/真实浏览器尚未实测。

## 未发布源码增量：明暗与白平衡（checkpoint16）

已交付的0.2.4安装包不变。当前源码新增阴影/高光与中性区域白平衡吸管，位于基础调色之后、色阶之前；默认全中性，可撤销，保存命名预设并同步到其他照片。取样临时显示此步骤之前的真实预览，不把后面的曲线/局部/构图效果误当输入；拒绝过暗、过曝、透明或明显混色区域。详见 docs/LIGHT-BALANCE-DESKTOP-UI.md。

这是传统8位sRGB全局调色，不是RAW恢复、肤色自动校准或SOTA修图。明暗重建保留线性RGB比例，超色域时压低目标亮度；强调整仍改变反差与视觉饱和度，不是自然美颜默认。当前工程格式v10可读v1–9；预设v3可读v1–2，新增明暗/白平衡组。旧0.2.4不能打开这些新格式，请保留旧备份。暂未新建安装包，也没有Windows/Electron/GPU实测声明。

以下0.2.4说明是已交付版本记录，不代表新源码增量已随它发布。

## 0.2.4开发候选：文字、留白与最终输出尺寸

当前候选构建版本为0.2.4；实际交付版本以Library附件回执为准。右侧“可编辑文字”支持最多8个独立层，多行、对齐、系统字体、旋转、描边、阴影、透明度及画布点选中心。输入后点“应用文字”，修改、删除、调序均可撤销；取消输入不改图片，未应用输入不会保存/导出。文字位于最终构图与留白之后，不进入调色预设或跨片参数同步。

项目源码格式现在是v9，读取v1–8；旧0.2.3最高读取v7，不能打开v8/v9项目，请保留旧格式备份。保存的是可编辑文字配方，不是预览位图。文字有明确原尺寸/工作尺寸排字基准，最终文字画布上限1600万像素/长边16384；超限停止而非自动缩小。仅使用本机系统字体，不下载字体；换机器字体与换行可能不同。云端Canvas/PNG验证不是Windows或Electron界面实测。

“导出照片”可单独指定最终文件精确长边。先按原图/工作尺寸完成全部效果、构图、留白、排字，再仅缩小副本；默认保持尺寸，不放大、不改变项目，不用小输出绕过大源图处理预算。批量失败重试沿用原尺寸选项。详见 docs/EXPORT-SIZE-DESKTOP-UI.md。

> Historical checkpoint13 added verified reversible border/canvas padding with projectv8. The current text increment supersedes that format withv9; neither increment was in the earlier0.2.3 installer. See docs/CANVAS-PADDING-DESKTOP.md and docs/TEXT-DESKTOP-UI.md.

# 薄荷人像 Desktop 后续候选源码（未发布）

这是独立的 Windows 桌面人像修图测试版，不是像素蛋糕官方产品，也不包含其商业模型、素材或私有界面。桌面工作流参考公开操作指南，使用自己的品牌、设计和实现。

## 开发候选源码与质量边界

此源码包含后续缺陷缓解、已授权的 SegFace / BiRefNet 公开样片评测、原图坐标蒙版修正和 .mintproj 自包含工程保存。当前源码已在0.2.5基础继续迭代；色阶、参考对比、预览读数和本机恢复来自0.2.3，当前新增文字、留白与最终尺寸。它不是完整修图重做的质量验收，也没有通过Windows真机或4060验收。SegFace 仅是分区诊断，BiRefNet 因白衣误删和边缘问题保持质量禁用；专用学习型祛瑕/精修仍未实现。不能把这些功能计作 SOTA 修图重做完成。

工程可保存原始压缩照片字节、调整、逐张撤销/重做、学习蒙版与手动笔画；打开前校验哈希和尺寸，损坏/取消时保留当前会话。项目包含原图全部数据，请按私密照片对待。原尺寸基础调色/局部图层导出已支持6400万像素、单边16384；人像/背景/手动笔画/选区图层等复杂效果仍限1600万像素。工作尺寸4096长边须明确选择，不再静默降采样。可选本机恢复默认关闭，需显式开启；完整原图和历史会保存在应用专用目录，未加密、不上传，两代草稿不代替正式保存。详见 docs/RECOVERY-DESKTOP.md、docs/PROJECT-FORMAT.md、docs/PROJECT-IO-SAFETY.md、docs/PROJECT-UI-QA.md。

恢复本候选源码见 RESTORE-LEARNED-CHECKPOINT.md；已跑通与未验收边界见 docs/LEARNED-INTEGRATION-CHECKPOINT.md。

## 2026-10-22 较早云端工作流检查点

已实现并测试：原尺寸原生PNG/JPEG导出、每张队列状态/取消/仅重试未成功项、8层径向/渐变局部调整及历史、工程v5兼容v1/v2/v3/v4、默认关闭的眼下/减红/唇色/面颊色传统算法控制。公开5412×7216样片实际不缩小导出，蒙版外像素与alpha不变，原文件哈希不变。见 docs/EXPORT-LAYERS-OCT22.md、docs/INDEPENDENT-EXPORT-RELEASE-QA.md。

实际浏览器验收仍被环境阻止：本地Chromium socket EPERM；受支持云浏览器拒绝file://路径，仅允许HTTP/HTTPS。没有绕过或伪造界面截图。桌面布局已做源码级改进和执行状态测试，尚不是视觉验收。

手工选区画笔/套索、加减/羽化/反选、推形/恢复、显式取样的修复涂抹/仿制已接通桌面交互、撤销/重做、工程v5和原尺寸导出。每笔捕获独立选区，取消未完成笔画不留历史。选区可转为局部调色层。详见 docs/MANUAL-TOOLS-DESKTOP.md。

为避免陈旧定位误用，手动液化与旧人物背景蒙版、自动五官塑形、自动修复取样的组合被明确拒绝；应先完成推形再修复，或撤销/清除修复后重推。当前显式取样工具是传统纹理拷贝与局部色调匹配，不是自动祛痘模型。开发安装包另行保存，不替换此前正式交付身份，也未宣称完成SOTA重做。

## 历史已交付安装器（不含上述新工作）

历史安装器修复为0.1.1：允许直接选择尚未创建的新目录，修复旧版把新目录误报为磁盘根目录的问题。修图应用与本地模型保持0.1.0原样。修复验证详情见docs/INSTALLER-PATH-REGRESSION.md。

- 推荐：双击 MintPortrait-Setup.exe，选择新建或空目录，按向导安装。安装器约7.46 MB，安装时从Electron官方GitHub下载约158 MB运行组件，校验后安装。安装完成可通过开始菜单或可选桌面快捷方式打开；Windows“设置 → 应用”可卸载。无需Node.js或管理员权限。
- 完整离线安装：MintPortrait-Offline-Setup.exe内含全部运行组件，安装时也无需联网。
- 两种安装器均为未签名测试版，尚未Windows真机安装/启动/卸载验收。重装请先卸载旧版。详情见docs/INSTALLER-VALIDATION.md和installer/BUILD.md。

以下是此前交付的便携运行方式，原包保持不变：

- 目标平台：Windows 10/11，x64。建议至少 8 GB 内存，预留约 1 GB 磁盘空间。其他平台未交付验证。
- 轻量启动包：完整解压后双击 START-MintPortrait.cmd。仅第一次从 Electron 官方 GitHub 下载固定版本 45.0.0，核对 SHA-256 后运行。无需 Node.js、账户、管理员权限或付费 API。下载后可离线使用。
- 完全离线包：按附带组装说明合并所有分卷、校验、解压，再双击 MintPortrait.exe。不要只移动 EXE，需保留整个文件夹。
- 未签名测试版。遇到系统或组织安全拦截请停止并反馈，不关闭安全软件，不绕过警告。

## 基线编辑功能（不是学习型专业精修）

- 原创桌面布局：预设栏、大画布、参数面板、底部胶片缩略图。
- 多张 JPG / PNG / WebP 导入；当前照片与批量选择分开；最大 100 张、每张 80 MB、合计 400 MB。
- 曝光、对比、饱和度、色温；确定性肤质平滑、肤色提亮和暖调；质量限制见后文。
- 本地 MediaPipe 人脸关键点，最多 5 张脸；局部瘦脸、眼部、鼻部与下颌参数。无可靠人脸时不伪造定位。
- 本地 Selfie Segmentation 人物蒙版；背景虚化、纯色与透明背景。
- 点选瑕疵修复、缩放与拖动、前后对比、每张独立撤销/重做、预设、复制参数、批量导出与取消。
- JPEG / PNG 导出；PNG 可保留透明，JPEG 的透明区域合成白色。输出重名自动编号，不覆盖已有文件。
- 所有照片处理在本地；编辑器网络请求被阻断，无遥测、账户或照片上传。首次启动器仅下载公开运行组件。

## 重要限制

- 这是功能测试版，不等同于成熟商业影楼软件。真实浏览器图形/推理和 Windows 真机启动尚未通过验收，详见 docs/VALIDATION.md。
- 交互预览长边1280，显式工作尺寸导出长边4096；原尺寸基础/局部调色导出限6400万像素、单边16384，人像/背景/点修/手动笔画/选区图层效果限1600万像素。只有显式工作尺寸导出才缩小。
- 不支持 RAW、HEIC、16-bit、专业 ICC 软打样、CMYK、EXIF 保留、相册数据库、云协作或生成式修复。原生导出通过Sharp转换并标记8-bit sRGB，剥离原EXIF；预览仍受浏览器解码限制，不是完整专业色彩管理保证。
- 皮肤处理为关键点限定区域内的确定性像素算法，不是商业 AI 精修模型。瑕疵修复为局部纹理融合，复杂修复可能有痕迹。
- 人物分割是自拍级模型，头发、透明物体、复杂背景和多人边缘可能不理想；多人最多 5 张脸，遮挡/侧脸可能检测不到。
- 候选源码可手动保存/打开 .mintproj 工程。未开启本机恢复时，未保存会话退出后会丢失；即使开启，最后尚未记录的更改也可能丢失，请正式保存。原图文件从不改写。
- 初次模型初始化、处理大照片或批量导出可能等待。批量取消会保留已写出的文件，不会删除它们。

## 开发与构建

官方依赖：Electron 45.0.0、@electron/packager 20.3.0、@mediapipe/tasks-vision 1.1.1。npm lockfile 固定解析结果。

安装官方 npm 依赖后可运行 npm start；npm test 执行无浏览器单元/状态测试；node tests/pipeline-browser.cjs 执行真实浏览器集成测试，需要本机可运行 Chromium/Playwright；npm run build:win 生成 Windows x64 portable 目录。无需凭证，不自动发布或签名。

CPU WASM 模型和运行库已随 assets 打包。离线资源哈希见 docs/offline-assets.json。第三方声明见 assets/licenses/THIRD-PARTY-NOTICES.txt。

## 公开参考

- 像素蛋糕桌面工作区指南：https://www.pixcakeai.com/guide/32445
- 官方操作指南：https://www.pixcakes.com/guide
- Electron 安全规范：https://www.electronjs.org/docs/latest/tutorial/security
- MediaPipe 官方：https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js

未复制第三方私有代码、商业模型、图标或品牌素材。


## 0.2.1 增量

“曲线与 HSL”折叠面板提供RGB总体/分通道五节点曲线、显式单调/自由模式、八色HSL、强度与精确复位。直方图读取已接受处理结果的预览像素，按alpha加权并标注采样，不是RAW直方图。默认全部中性；全局风格预设会明确重置高级调色，批量同步复制高级调色而保留每张照片的手工笔画。

修正两项手工边界：带透明度输入的推形/恢复现在在UI、预览和原尺寸导出拒绝，不会静默裁边或铺平；大面积修复笔划在小预览和原尺寸导出使用同一归一化预算。旧NASA内置演示图及入口已从应用payload移除，私人QA只保留于源码证据中。

743项完整自动检查、88项独立手工/调色检查通过；5001×3300真实PNG导出与共享核心像素一致且不缩放。仍没有实际Windows/浏览器视觉验收，不代表103个竞品工作包全部完成。

## 0.2.2 增量：构图、命名预设与选片

构图在所有原图坐标编辑之后执行：整数边界裁切、90度旋转、水平/垂直翻转均不插值，不改原图字节，也不会删除或偷偷改写既有笔划。修图/蒙版检查视图仍明确使用未裁切的原图画布；裁切不能绕过原图处理预算。详见 docs/GEOMETRY-DESKTOP.md。

“我的调整预设”保存基础调色、人像数值和曲线/HSL配方。文件不自动包含照片、路径、蒙版、网格、笔划、塑形或构图，可在两端导入；这不是跨端工程文件。完整应用逐图预检各自真实人脸，任何失败/取消都不部分应用；仅调色模式明确保留原有修肤。每张有独立撤销记录。本机库最多100个活动项和20个可恢复移除项，损坏库不自动重建覆盖。详见 docs/PRESETS-DESKTOP.md 和 docs/PRESET-CODEC-CONTRACT.md。

“选片管理”提供0–5星、精选/拒绝、五色色标、筛选/排序、可见照片导航与独立标记撤销。标记随schema6工程保存，读取旧1–5版本时迁移为中性；不会改变源图或像素设置。筛选不隐式取消勾选，批量操作显示隐藏/拒绝计数并确认，导出重试不会重复成功文件。这不是AI挑图、EXIF编辑或双照片并排比较。详见 docs/PHOTO-REVIEW-DESKTOP.md。

## 0.2.3 候选增量：参考、色阶与恢复

已交付0.2.2安装包不含此后续源码功能。完成普通构图预览后，可“固定当前处理预览为参考”，左侧保留单份冻结预览，右侧继续编辑或切换照片；拖动/滚轮按归一化位置与各自适合倍率联动，不是人脸配准或原图1:1。参考仅在本次会话保留，不存工程，不影响导出。未做真实浏览器或Windows交互验收，详见 docs/REFERENCE-COMPARE-DESKTOP.md。


色阶位于基础调色后、曲线/HSL之前，支持RGB总体与分通道的输入黑白点、gamma、输出黑白点及总强度，默认精确不变。工程v7兼容1–6，命名预设v2兼容v1，并在特定公开样片上验证两端四组活跃调节及真实PNG输出一致。它不是RAW高光恢复，也不是自然美颜的强制默认。手动液化之后的最终构图/导出组合缺陷已修复，严格字段校验仍保留。

可选RGBA读数只采样已完成的当前结果预览，不读取棋盘合成色、固定参考或原图比较帧；全透明像素不显示隐藏RGB。关闭后释放缓存，不影响图片设置、历史或导出。见 docs/PREVIEW-PIXEL-INSPECTOR.md。

“本地恢复草稿”默认为关闭，显式开启后等待稳定30秒，保存完整照片、历史和蒙版到显示的应用专用目录。容量是每代64/128/256/512MiB，默认128；正常保留两代，原子写入额外需要临时空间。下调容量不会删除旧大文件，残留临时文件也可能增加占用。既有恢复机会在用户明确选择前不会被新会话自动轮换。最新损坏时只提供经过验证的上一代候选，恢复当前会话仍须确认；恢复后仍是未正式保存的项目。不是云备份、加密相册或断电零丢失保证。见 docs/RECOVERY-DESKTOP.md 和 docs/RECOVERY-STORE.md。
