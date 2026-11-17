# Desktop source checkpoint14: editable text after final framing and padding

2026-10-22. Unreleased source-only increment after delivered development0.2.3. Existing online/offline0.2.3 Libraryv3 and stable0.1.1 artifacts remain unchanged. The previous padding checkpoint is docs/checkpoints/SOURCE-PADDING-CHECKPOINT13.md.

## User-visible result

The right rail has8 independent editable text layers: multiline content, system sans/serif/mono fonts, alignment, size, box width, normalized center, point placement, rotation, line spacing, fill, opacity, outline and optional shadow. Apply changes one history step; cancel/drafts never enter saved recipes, recovery or export. Applied layers may be hidden, reordered, deleted and restored with undo/redo. Presets and ordinary batch synchronization preserve per-photo text rather than implicitly copying captions.

Pipeline: existing photo effects→framing→padding→text→alpha-zero RGB sanitization/PNG or white-flattened JPEG. Final-coordinate text can be positioned in padding; source landmarks, manual tools, selections and healing donor coordinates are untouched. Original comparison deliberately omits text but retains framing/padding, and labels that choice. Source/manual view hides final decorations.

One local Canvas font path rasterizes full-final-size text for both preview and export. Same-size previews use exact raw overlay bytes; smaller previews scale only the completed raster. Native export validates source and canonical recipe hashes plus request/revision/mode/final dimensions, owns buffers, composes and encodes without font substitution. These are association checks, not glyph attestation or a new one-use authorization token. No remote fonts, font downloads, dependencies, private-image uploads, models or API calls were added.

## Persistence and bounds

Project schema9 reads1–8 and requires textLayers in all current/committed/undo/redo/non-null exported settings. Missing legacy fields migrate to[], malformed fields reject. Source compressed bytes remain unchanged. The project stores editable recipes, never cached text rasters. Delivered0.2.3 can only read throughv7 and cannot open sourcev8/v9 projects. Keep earlier project copies when switching versions.

Active-text final canvases are limited16,000,000pixels/16384edge. Original/working basis is explicit and changing it rebuilds text. Original-source and complex-effect processing budgets still apply before cropping; small final output cannot bypass them. Renderer and native validation reject shared/resizable/oversized backing storage, with bounded offset views copied safely. Memory ceilings are per surface and do not claim measured maximum total RSS.

## Actual evidence

quality/text-qa/app-native-final.png is614×840, with CJK/Latin multiline/rotation/outline/shadow/translucent layer order after crop/rotation/flip/padding. Original bytes/pixels remain unchanged. The decoded native PNG, authoritative compositor, independent scalar oracle and same-size accepted preview all have RGBA SHA256969d6cb3457784cc8653983628d79f575fcabde0fff0acb5855f92d795c4f72a. Separate800×640→100×80 preview checks use a resampling oracle, not a false general pixel-equality claim.

quality/text-qa/padding-placement-final.png proves the final520×520 canvas accepts text wholly inside bottom padding:1,010 changed pixels in padding, zero in source content. No automatic repositioning or clipping to the pre-padding picture. The earlier footer's proximity to the content edge is its chosen normalized center, not a clipping bug.

Independent QA uses shipped app.js, real glyph helper, installed native Linux Canvas, native Sharp worker and actual PNG decode. Its DOM/IPC and non-text preview adapter are authored test scaffolding, not an Electron/browser window. It found and verified fixes for stalled cached-hash cancellation, pagehide late preview/export, unnecessary same-size resampling and backing-buffer limits. Source boundary tests additionally refuse active text in direct pure-pixel export without explicit final-stage ownership.

Focused text suites101/101 and independent full-app/native checks16/16 pass with zero skipped. Final aggregate1997/1997 passes with zero failed, cancelled or skipped; checkpoints/text-full-final.log records the direct Node run.

Shared text-overlay.cjs remains byte-identical to mobile SHA44874197cdf371f6763228d61a67c75346c50e37c2267e2b9e69e33f314f93a1. Renderer helper frozen SHA51c762e4fd54280c22e12a8edb608f354edd1a3b1f680390595b1eead9967687. System font binaries are not embedded. Font fallback/wrapping can differ on another operating system. Windows/Electron UI, IME, native dialogs, physical performance and maximum-size memory behavior remain unverified. Learned high-quality skin retouch/SOTA acceptance remains incomplete; existing model quality blockers are unchanged.

## Recovery

This private source overlay applies over base Librarylibfile_409356280a8c8191a5bf3fd3cbdffe91v1. CHECKPOINT-FILES.json validates every curated file. Runtime archives, installers, model weights, virtual environments and node_modules are excluded. Existing private QA assets remain source-only and are excluded from application packaging. Historical logs describe their recorded code hashes; latest aggregate log is checkpoints/text-full-final.log.
