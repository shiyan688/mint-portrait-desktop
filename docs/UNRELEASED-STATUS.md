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

# Development source status, 2026-10-22

The 0.2.2 development bundle contains geometry, named-preset and photo-review work, with separate package/installer validation manifests. Earlier 0.2.1 and stable 0.1.1 binaries do not contain these later modules. This is NOT an accepted SOTA retouch remake or full PixelCake/Xingtu parity. All later installer work retains the 0.1.1 directory-path safeguards. No signing credentials or public publication were created.

## What changed after the initial scaffold

The user separately approved pinned SegFace and BiRefNet author-code/weight execution on public licensed samples. Actual cloud CPU inference completed: SegFace on three NASA portraits, BiRefNet HR2048 mixed-BF16 on four. Public results, source reviews, exact asset hashes and limits are retained. SegFace original-ROI parsing is experimental diagnostic code, not learned retouch. BiRefNet remains quality-blocked because white-garment and fine-edge failures are visible. CUDA was unavailable; no RTX4060 performance or native Windows validation is claimed. Optional classical PyMatting foreground estimation was tested but is not an accepted integrated retouch feature.

Source-coordinate mask inspection and keep/remove correction brushes preserve original model planes and edit history. A self-contained versioned .mintproj codec and native-dialog local file workflow now retain original compressed photo bytes, bounded settings/history and learned masks with integrity checks. Save failures leave old files intact, and opening stages valid images before replacing the session. The native 8-bit sRGB export path supports original-size basic/local work up to 64MP and 16,384 pixels per edge; complex portrait/background/manual/selection-layer effects retain a 16MP ceiling. Those limits apply before final cropping. Working-size reduction (long edge 4096) is an explicit choice, not original-resolution output. Optional local two-generation recovery is now implemented but disabled by default; it is not a formal project save or guaranteed zero-loss crash recovery. There is no RAW/16-bit workflow, professional color proofing or unrestricted-resolution claim.

Dedicated trained skin/blemish retouch remains outstanding. Generative API adapters remain disabled and unwired, tested only with mocks. No real remote image request, private photo upload, credential access or charge occurred. Any new model execution, gated rights or account-sharing requirements need their own applicable approval.

## Evidence and preservation

See LEARNED-INTEGRATION-CHECKPOINT.md and PROJECT-FORMAT.md / PROJECT-IO-SAFETY.md / PROJECT-UI-QA.md. The original repaired classical baseline is preserved byte-for-byte at quality/frozen-mitigation-portrait-engine.cjs (SHA25665cebaaaf65797e9661ee213d28083eec4c4f194fc14384ebd8ec8340cc00b2c). The current engine adds continuous learned-alpha background composition, without replacing classical skin/reshape with a neural model.

The source checkpoint omits weights, environments, private photographs and compiled installer payloads. Exact manifests/reproduction sources are included. A source-only restore requires the documented pinned dependencies and a separate package build before native-codec/installer payload tests can be reproduced. Historical manifests are not proof that a later source tree was packaged. Browser launch failed on a denied socket() inside Chromium; no sandbox or socket restriction was bypassed. UI tests use authored DOM/IPC doubles, separately from real CPU inference and filesystem tests.

## Later cloud-completable work

Original-space manual selections, push/restore, explicit-donor healing/clone and
local tone layers are reversible commands. The tone module adds user-controlled
curves, HSL and a preview-sampled histogram, not RAW analysis. Final integer
crop/quarter-turn/flip does not move saved original-space masks or strokes.
Portable named presets carry only the three whitelisted adjustment groups, never
photos, coordinates, masks, paths or geometry; their applied pixels have been
compared across the two app adapters on explicit public fixtures.

Project schema 6 adds authored star ratings, pick/reject flags, color labels and
independent review history. Legacy versions 1–5 migrate to neutral review data.
Filters and sort order are view state, not destructive source-array edits.
Hidden/rejected batch targets require explicit scope confirmation. This is not
automatic AI culling, EXIF editing, or a dual-image comparison feature. Refer to
the latest checkpoint for completed tests versus pending UI acceptance.

## 0.2.2 release boundary

Current source/package metadata is 0.2.2. It consolidates final framing, portable named presets and review metadata. Refer to installer/out validation and checkpoints/photo-review delivery receipts for actual built/saved artifact versions; older 0.2.1 binaries contain none of these later modules. This development bundle does not remove the SOTA/retouch quality blockers or establish Windows/browser acceptance.


## 0.2.3 candidate boundary

Current package/source metadata is 0.2.3. This increment adds shared Levels, project v7 and four-group portable preset v2 (reading previous versions), and repairs the manual-liquify transient-diagnostics boundary before final framing. Frozen reference comparison and optional RGBA inspection are session-only, 1280-preview tools. Opt-in local recovery keeps two complete .mintproj generations in a displayed host-owned directory; explicit startup/adoption choices, atomic writes, capacity bounds and failure/cancel stage reporting are required. It never clears formal unsaved status. Source/readback tests do not replace browser/Windows interaction, filesystem power-loss testing or aesthetic/model acceptance. Consult the latest CHECKPOINT and exact package/installer manifests for what was actually built and saved.
