# Desktop source checkpoint15: padding, editable text and final output size

2026-10-22. Development0.2.4 delivered by the parent with explicit quality/runtime limits. This source checkpoint adds the final-file downsize UI/native pipeline to checkpoint14's reversible padding and editable text. Stable0.1.1 Library artifacts are not replaced. The full33,585,554-byte checkpoint14 remains in Library history and its local SHA was reverified.

## Actual result

“导出照片” distinguishes processing basis (original or explicit working size) from final file dimensions. Default unchanged is exact neutral. Optional integer long-edge1–16384 only downsizes, after effects, final crop/turn/flip, padding and full-resolution text. Batch photos smaller than the requested target fail individually rather than silently upscale or change the target. Retry uses frozen queue options. Controls do not modify picture history/project/presets. Source and intermediate budgets apply before final resizing.

Native Sharp0.35.5 uses a separate rawRGBA Lanczos3 resize, alpha-zero RGB sanitization, then final PNG or white-flattened JPEG. This separation matters: Sharp's combined pipeline would flatten before resize. The isolated worker and main service validate composition/final dimensions and own buffers. Text overlay binding remains against the pre-resize composition, with source/recipe hashes and revision/request/mode. The local Canvas fallback uses high-quality sampling and is not claimed pixel-identical to Sharp or mobile.

Projectv9 reads1–8 and saves editable text recipes; old0.2.3 maxv7 cannot open new projects. The app retains original compressed photos and ordered history. Eight final-coordinate text layers and padding do not move original manual/mask/landmark coordinates. System fonts only, no embedded or remote fonts; cross-system wrapping may differ. Text/complex processing stays16MP, basic64MP and edge16384; final small files do not bypass these budgets.

## Confirmed validation

-2043/2043 direct Node tests passed, zero skips/failures. Includes existing text/manual/geometry/project/recovery/preset/color regressions.
-16/16 independent final-size checks and83/83 focused related checks passed. Real900×640 source →634×851 completed composition →276×371 decoded PNG matches resampling the full composition exactly.2,447 glyph pixels exist wholly in bottom padding before resize. Hidden-magenta alpha PNG negative control and JPEG flatten-last oracle passed.
-22/22 standard-library archive tests passed, including initial Library version0, strict restore verification, path/symlink rejection, corrupt/missing evidence, no archive overwrite and concurrent manifest modification.
-180 curated installed files verified. Actual NSIS PE version, unsigned asInvoker structure, archive integrity and embedded payload hashes verified for both installers. No NASA QA photo, font binary, Python environment, SegFace/BiRefNet weights, paid API key or test/evidence directory is in the application payload.

Linux NativeCanvas/Sharp and authored DOM event harnesses are not browser/Electron/Windows execution. No4060 performance, font equality, SOTA retouch or full103-work-package acceptance claim. The coverage ledger remains103 work packages, zero full acceptance marks.

## Persisted deliverables

Online: libfile_44379f7c7100819199aca804f7e6403c v4,13,855,922bytes, SHA e3dc0139c4bcb64b708dd6f2e8daf2787b66e3aeedb2fabe38d02a5e3c2e872a.
Offline: libfile_ef80df086da48191aa7f8e30c963c4fd v4,125,642,626bytes, SHA8ef9295dcca36790dc55b3a9cc77face4fa93aaf4072a1fae7d5b65a9f248725.
Both ASAR:30b9bd059c8b0ee1e7afadb6121e51228253fe2ce76461b6c2a66ee972863ef0.

QA companion: libfile_c60c939b4c948191b422c7dc7b15e49e, tool-reported initial version0; readback version_id is null, not a fabricated1.31,409,261bytes, SHA a7ce833906a3aa6093d70c7f029ac959c20330d62363ebc068e791f37de8d9d9.85 curated binary fixtures, exact manifest hash7b4c36f3d8846d9486b41325eae692c1473a3be2362f33b8247d817fb057dad0. Metadata readback and local version xattrs were confirmed.

Source overlay uses the existing source Library identity libfile_c7367392a7ec8191ad5f8bc8dafbc223. Current source archive bytes/hash are recorded in its final persistence receipt after creation, not recursively embedded here. It restores over base libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Source now excludes binary QA: read docs/SOURCE-QA-ARCHIVES.md and QA-RESTORE.json, restore/verify the companion before QA-dependent tests. Existing fullv14 remains the historical all-in-one checkpoint, not deleted or renamed.

## Installation/privacy boundaries

Same MintPortrait.Desktop install identity, not side-by-side. Formally save projects, close and uninstall older installation before installing. Exact-owned-file uninstall preserves other photos/projects and AppData presets/recovery. Online setup downloads only official Electron45.0.0 Windowsx64 runtime158,223,852bytes with fixed SHA ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47. No admin, security bypass, signing identity or new service is created. Recovery remains opt-in, local and unencrypted. Do not publish private informational QA portraits as marketing/stock.
