# Desktop source checkpoint 12: development 0.2.3

2026-10-22. Online and offline development installers are now 0.2.3; stable 0.1.1 identities remain unchanged. This is a coherent development milestone, not accepted SOTA retouch or complete PixelCake/Xingtu coverage. Previous checkpoint 11 notes are preserved in docs/checkpoints/SOURCE-LEVELS-CHECKPOINT11.md.

## Added and bundled

Checkpoint 10 frozen-reference comparison and checkpoint 11 RGB/channel Levels, preset v2 and the manual-liquify/final-framing boundary repair are bundled. Current-result RGBA inspection reads only the accepted 1280-pixel 8-bit sRGB preview, not RAW, original 1:1, the checkerboard or the reference canvas. Hidden RGB at alpha zero is not displayed. View-only features do not alter image history or export.

Optional local recovery drafts are OFF by default. The local-project panel exposes opt-in, per-generation storage cap, actual location/usage, and explicit latest/previous recovery. Drafts contain original photo bytes and full project history unencrypted on this machine. Disabling retains saved drafts. Two atomic generations protect the previous verified save; corrupt latest can offer separately confirmed previous recovery. Restoring never silently overwrites unsaved work or marks a project formally saved. Startup drafts hold automatic writes until a choice. Cancellation, stale results, uncertain commits, disk failures, symlink/hardlink boundaries and quit races have explicit tested outcomes. This is not a guarantee against all power loss, same-user malicious races or platform filesystem differences.

Project schema remains version 7 and reads versions 1–6; old 0.2.2 cannot read new version 7 files. Portable adjustment presets v2 read v1, with no photos, masks, geometry or private paths. Actual desktop and mobile replay of all four active groups (beauty, basic, Levels, curves/HSL), plus native PNG decode, matches RGBA SHA256 b335e9c82b878cecf7e42a821c7bd0c454badb1adc620fcdae93db8ea731e080 on one public licensed fixture. This establishes deterministic processing there, not aesthetic acceptance.

## Verification and delivery

Final direct Node aggregate: 1769/1769 passed; no failures, skipped or cancelled tests. checkpoints/recovery-full-final.log. Independent recovery 51 and preview inspector 66 are included subsets, not extra tests. Production handlers are exercised with authored DOM/IPC/Canvas harnesses, real temporary files, worker threads, native Sharp PNG readback and the optional native test Canvas. No browser, Electron interaction, Windows install/uninstall or RTX 4060 performance has been verified.

Windows package allowlist verified 174 app files against source; no QA portraits or tests included. Both unsigned per-user NSIS executables have verified 0.2.3 PE/application versions, archive integrity, and exact embedded application ASAR SHA256 69a89923c49e22536e20dc40a410b93fa88ade7438936f74e16876468ad92236. Online verifies the pinned official Electron 45.0.0 runtime download (158,223,852 bytes; SHA256 ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47). No model runtime is silently downloaded or claimed installed.

Online: MintPortrait-Development-0.2.3-Setup.exe, 13,829,124 bytes; SHA256 1f3d2f27e2f0f621ca4401aa1d939d97971da8f09f4eda0ee99f1b7748926683; Library libfile_44379f7c7100819199aca804f7e6403c v3.
Offline: MintPortrait-Development-0.2.3-Offline-Setup.exe, 125,671,864 bytes; SHA256 107a4ccff330f99e6dd73b7f89b1236e14d6ef4f2a13bd3eb3e265098c713f90; Library libfile_ef80df086da48191aa7f8e30c963c4fd v3.
Exact upload/readback receipts are in checkpoints/recovery-delivery-receipt.json. NSIS retains the safe directory validation fix. Existing installation must first be uninstalled after saving projects; this is not in-place upgrade. AppData projects/presets/recovery remain, so rollback compatibility must be considered.

## Boundaries

JPEG/PNG/WebP input; JPEG/PNG output, 8-bit sRGB. Basic/local/color original processing up to 64 MP / 16384 edge; complex portrait/manual/background/selection effects up to 16 MP before crop. Working export up to 4096 differs from interactive preview 1280. No RAW/16-bit proofing, arbitrary rotation/perspective, verified learned blemish repair or accepted SOTA beauty. SegFace is experimental parsing; BiRefNet remains quality-blocked. Conventional color/manual algorithms are not SOTA. None of 103 whole work packages is marked accepted.

No new models, credentials, private-photo transmission, paid API, publication, security bypass or user-computer access occurred. Private factual NASA QA assets are not application assets, endorsement or public marketing material.

Restore this source overlay over Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies, model weights and executable builds are excluded. CHECKPOINT-FILES.json verifies every included file except itself. Historical reports only apply to their recorded hashes.
