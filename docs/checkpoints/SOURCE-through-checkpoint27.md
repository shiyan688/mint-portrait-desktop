# Checkpoint27: development0.2.8 release records

Both unsigned Setup artifacts were saved and metadata-readback verified at Library version8. Online attachment accepted: Sentinel_751f668e7ec0819186aca49e55367a66. Offline is saved, not sent unasked. This does not establish user installation or Windows acceptance. See docs/checkpoints/RELEASE-0.2.8.md and checkpoints/image-overlay-release028-release-manifest.json.

Compiled input remains source checkpoint26:2997working-tree/2997fresh-restored tests,54archive checks,126package/installer checks. Actual19/91embedded product files,72official runtime files,200ASAR files, PE versions/asInvoker/unsigned metadata and current installed README verified. All941frozen build inputs stayed unchanged through compilation. This checkpoint adds release/restore notes and audit reports only; application/tests/build source equivalence is recorded separately. No new QA binary or model, no private uploads/API fees, no native Windows execution.

Current project16 reads1–15; presets3. Material assets are bounded1024-edge/1MP8bit working pixels. The tested untagged16bit PNG ICC correction is not16bit processing, RAW support or a Windows color acceptance claim. Full competitor coverage and SOTA portrait quality remain unaccepted. Old releases remain preserved.

## 当前源码的精确恢复
先取得基础源码 libfile_409356280a8c8191a5bf3fd3cbdffe91 版本1，再用本源码 libfile_c7367392a7ec8191ad5f8bc8dafbc223 checkpoint27覆盖。四份QA包均需保持精确版本：
- libfile_c60c939b4c948191b422c7dc7b15e49e 版本4：MintPortrait-QA-Checkpoint20.zip，61564488字节，SHA256 4b39f257cf700d59b5da62e2fdaf41802f41e58fc6da5e9e8e4c4630f40b7b1d。
- libfile_c5ac740d6d208191897230d3878b5291 版本0：MintPortrait-QA-Straighten-Checkpoint22.zip，5115930字节，SHA256 019fb6f25a5595ba6ff8d523b159ce3da45e2bcbc1d32bc1a264bde93f0c88c4。
- libfile_d1c310bcd2bc8191bcf6bbaf8f2dac8e 版本0：MintPortrait-QA-Sharpness-Checkpoint23.zip，1783133字节，SHA256 43663e37867a3f5567dbad0732094f9ed152018d45548eeb3ff476025b3b518b。
- libfile_32b4b1bad3788191b4b95696586bbdbb 版本0：MintPortrait-QA-ImageLayers-Checkpoint26.zip，778370字节，SHA256 2f0be34965c34363b4d9c8f570c8c48cde57f7d8eb5d74f412accd72a7f67906。
通过官方Library流程取得文件。将四个本地ZIP路径分别传给 tools/archive-checkpoint.py 的 --restore-qa 参数，再运行 --verify-qa；脚本只做本地安全/hash验证和恢复，不登录/下载，也不接受猜测的私有URL。QA-RESTORE.json绑定全部186份二进制证据；本轮无新QA图。依赖、模型、字体、运行时和安装器不在源码ZIP，测试必须具备文档列明的已批准依赖及匹配静态打包夹具。QA图片不会安装进应用。

## Retained previous source checkpoint

# Checkpoint26: 0.2.8 local image layers and verified PNG color correction

This is an unreleased source checkpoint, not a new delivered Setup. Retained0.2.7 delivery and immutable binaries remain unchanged. Runtime production source is frozen at0.2.8 before the separate installer build.

Completed: maximum4 editable final-canvas local image layers; bounded single-frame local import; explicit apply/cancel and stale-job rejection; immutable primary originals; asset-aware undo/redo, project16, opt-in recovery, export queue and retry. Material pixels are≤1024-edge/1MP 8-bit sRGB, not original-resolution imported assets or AI upscaling. Assets are private project content and do not travel through adjustment presets or cross-photo parameter synchronization.

The shipped0.2.7 native export ICC defect was independently reproduced from its exact ASAR and restored source. Candidate conditional ICC conversion fixes the tested untagged16-bit RGB colors, while source bytes stay unchanged. This does not add a16-bit processing pipeline or certify Windows color behavior. Separate investigation of phone selection construction defects confirms the shipped desktop constructors were already correct: null subtraction starts from all, and visible add/subtract respects inversion. Actual old ASAR helper/core execution and49 related regressions pass; no old recipe meaning or shared selection math changed.

Validation:2997/2997 complete cloud regressions, zero failures or skips;54 separate archive-safety checks;126 packaging/installer-source checks including9 newly added actual stage/ASAR content checks. The real app-code event fixture combines two image layers, text, paint and opaque coverage; all32,000 output RGBA channels equal actual native PNG. Packaged0.2.8 files and source were checked, not executed on Windows.

Fresh empty-directory restoration verified995 source entries and all186 QA binaries, then2997/2997 complete regressions passed again, zero failures/skips. Existing approved node_modules were linked and matching0.2.8 static stage/package/payload fixtures were copied; no dependency install or Windows execution was claimed. Fresh restoration uses the official Library base source version1 plus this overlay and each exact QA archive listed in QA-RESTORE.json. Existing approved Node dependencies and matching native packaging artifacts are separate. No private user screenshots, model weights, font binaries, native runtimes or installers enter this source ZIP.

No Windows install/runtime/uninstall, real browser layout, RTX4060 performance, SOTA retouch or full competitor parity acceptance is claimed. New Setup will be built only after restoration validation; existing installer/out reports are retained0.2.7 historical evidence until then.

## Retained earlier checkpoint

# Desktop source checkpoint 25: development 0.2.7 release records

Both 0.2.7 installers are compiled, saved and metadata-readback verified. The online attachment was accepted as Sentinel_f2ab2de41acc81918876236ede99d096; this does not establish that it was opened or installed. See docs/checkpoints/RELEASE-0.2.7.md and checkpoints/sharpness-release027-manifest.json for exact files, Library versions, hashes and provenance.

The application was compiled from checkpoint 24. This checkpoint 25 adds release documents and audit results only: all 230 application, test and build-helper files checked against checkpoint 24 are unchanged. The 912 frozen build inputs stayed unchanged throughout compilation, and the previous 0.2.6 installers are preserved. The corrected installed README identifies an unsigned development build, not an unbuilt Setup. Source progress notes are separate from the installed README.

The release combines arbitrary-angle straighten and explicit Apply/Cancel sharpening with undo and original-preserving export. Neutral sharpening is pixel-identical. Conservative radius 1 / threshold 3 is restrained; radius 3 / threshold 0 increases seeded noise variance by 27.5% in a retained negative control. This is conventional processing, not denoising, learned restoration, SOTA or overall portrait-quality acceptance. Non-integer geometry resamples and can soften or change the canvas dimensions.

Pipeline: photo-space edits → sharpening → framing → straighten → padding → text → paint → redaction → final resize. Source comparison shares geometry but omits sharpening. Source-coordinate manual views omit sharpening without changing saved settings. Portable presets remain version 3 and exclude detail and geometry. Project version 15 reads versions 1–14; keep older project backups.

Validation: 2779 / 2779 full regressions passed in the working source, a fresh restoration and the frozen build. This includes actual NativeCanvas/Sharp PNG pixels, Worker parity and app-code event tests. The final installer/release checks passed 117 / 117; separate archive safety checks passed 53 / 53. All 19 online and 91 offline extracted product files match the frozen payload. PE resources, version, unsigned/asInvoker manifests, native modules, licenses and uninstallers were inspected without executing Windows code. No Windows installation/runtime/uninstallation, real Chromium GUI, 4060 performance or SOTA quality acceptance is claimed.

ASAR: 47,105,317 bytes, SHA256 087c84b326e2a5a00a5541832f33fb9dd9b06975d35ea19d344123b8eef4d591. Frozen payload: 91 files, 441,055,001 bytes. The online installer downloads only the pinned official Electron runtime; the offline installer embeds it. No research model or QA portrait is bundled.

## Exact restoration dependencies
Base source Library libfile_409356280a8c8191a5bf3fd3cbdffe91 version1, followed by this source overlay (libfile_c7367392a7ec8191ad5f8bc8dafbc223, checkpoint25). Every QA archive below is required:
- libfile_c60c939b4c948191b422c7dc7b15e49e version4: MintPortrait-QA-Checkpoint20.zip, 61564488bytes; SHA256 4b39f257cf700d59b5da62e2fdaf41802f41e58fc6da5e9e8e4c4630f40b7b1d.
- libfile_c5ac740d6d208191897230d3878b5291 version0: MintPortrait-QA-Straighten-Checkpoint22.zip, 5115930bytes; SHA256 019fb6f25a5595ba6ff8d523b159ce3da45e2bcbc1d32bc1a264bde93f0c88c4.
- libfile_d1c310bcd2bc8191bcf6bbaf8f2dac8e version0: MintPortrait-QA-Sharpness-Checkpoint23.zip, 1783133bytes; SHA256 43663e37867a3f5567dbad0732094f9ed152018d45548eeb3ff476025b3b518b.

QA-RESTORE.json and QA-CHECKPOINT-FILES.json bind the three-archive set and148 binaries. Original145 binaries remain unchanged; this feature adds only3PNG sheets in a1.78MB increment. Obtain exact versions through the supported Library flow, then pass --restore-qa once for each downloaded file to tools/archive-checkpoint.py. It verifies safe members, exact hashes and collision-safe restoration; it does not sign in, download or fabricate private URLs.

Approved dependencies, models, fonts, runtime and generated packages/executables are excluded from the small source/QA archives. Full tests require documented approved dependencies and matching internal static package/payload fixtures. Never silently skip these prerequisites and claim a full pass. See docs/SOURCE-QA-ARCHIVES.md, docs/DESKTOP-SHARPNESS.zh-CN.md and docs/DESKTOP-SHARPNESS-CONTRACT.md.

No real browser layout, Windows installation/launch/GUI/uninstall, Android, GPU/4060, general portrait quality or SOTA acceptance is implied. Public NASA source/altered output is private informational evaluation only, not application artwork, marketing, training data or endorsement. No user-private photograph is included.

## Release-note correction and single source of release metadata
The installed README no longer carries transient source-checkpoint status. release-config.json owns version/channel; tools/sync-release.cjs defaults to read-only validation and can explicitly synchronize only fixed version fields. The installer README renders release placeholders and the actual project schema. An old-note negative control failed as expected; the corrected18 combined metadata tests and105 static package checks pass. Source checkpoint23 remains preserved. Application ASAR/algorithms are byte-identical to checkpoint23; only build metadata, tests and documentation changed. No Setup was compiled before corrected checkpoint24; both variants were compiled afterward from those frozen inputs. See docs/RELEASE-METADATA.md.
