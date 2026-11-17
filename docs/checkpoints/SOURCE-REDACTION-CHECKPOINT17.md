# Desktop source checkpoint 17: final-canvas mosaic / opaque cover

Unreleased source overlay, 2026-10-22. The delivered 0.2.4 installer remains unchanged. This also preserves checkpoint16 light-balance/preset-v3 functionality and all prior directory validation, immutable-source, geometry, manual-tool, export, and recovery safeguards.

## Actual implementation

- Shared traditional redaction core with named desktop profile. Mobile default semantics remain byte-compatible. Desktop profile permits 16,777,216 final pixels / edge16,384, retaining 128MiB extra-memory and64M per-call work limits.
- Strict eight-layer adapter binds source revision and geometry recipe. Up to64strokes /4096points across layers;128M cumulative work. Disabled layers remain bound. Source-size selected masks have independent16Mi-pixel limits; covering requires binary, unfeathered selections. Arbitrary geometry changes reject until explicitly clearing or undoing redaction, not silently moving strokes.
- Final order: existing image edits → crop/quarter-turn/flip → padding → text → redaction → optional final downsize → encode. Source and diagnostic inspection deliberately show unredacted source, with explicit labels. A live face-parsing diagnostic prevents painting until explicitly disabled.
- Pointer-up is one history operation; draft remains display-only. Esc, cancellation, multiple contacts, blur, compare/source changes, edits, source changes and undo cancel stale strokes. Layers can be toggled/deleted/cleared and undone. No cross-photo/preset transplantation.
- Project format11 reads1–10; redaction is validated in current/committed/exported/undo/redo states. Old installers cannot open newly saved formats; keep earlier backups.

## Validation and evidence

- `checkpoints/redaction-aggregate-final.log`: 2346/2346 full JavaScript regression tests, zero failures/cancellations/skips.
- `checkpoints/redaction-ui-independent-final.log`: 49/49 owner actual Canvas/controls and independent regression cases (25+24), zero skips.
- `checkpoints/redaction-archive-tests.log`:23 archive boundary/regression cases.
- `quality/redact-qa/independent-sample.cjs`: synthetic, reproducible actual app.js orchestration + NativeCanvas text + native Sharp PNG/JPEG exports.
- Before/cover PNGs are580×852 from800×520 synthetic source; downsized PNG is218×320. Actual pixels reviewed: upper hard opaque stroke replaces the final text identifier; lower stroke mosaics a regular checkerboard. This is not a screenshot or a private photo.
- Exact opaque RGBA is verified before resampling/encoding. Alpha-zero export pixels have zero hidden RGB. Fresh encoded outputs do not retain original EXIF/XMP/IPTC/embedded thumbnails. JPEG and final resizing alter edge colors.

## Honest limits

Traditional mathematical tools, not SOTA, face retouch quality acceptance, secure deletion or reliable anonymization. Originals, editable projects, undo history and opt-in local drafts retain covered information; share only inspected exported copies. No Windows/Electron/browser/native pointer-input acceptance is claimed. Tests execute installed NativeCanvas0.1.100 and Sharp0.35.5; NativeCanvas is a required QA-only dependency, not shipped. Missing required native prerequisites must fail visibly, not turn acceptance into skipped green tests.

The source ZIP retains code, tests, manifests and reports. Binary evidence is separately preserved in QA checkpoint17, referenced by its verified Library identity/hash in QA-RESTORE.json. Source overlays the retained installer source libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Model weights, node_modules and Python environments are excluded, as before. No user feedback screenshots or private photographs were added.
