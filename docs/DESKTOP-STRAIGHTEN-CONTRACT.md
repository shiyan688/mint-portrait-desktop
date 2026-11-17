# Desktop straighten integration contract

Candidate implementation after the immutable 0.2.6/checkpoint21 source. This document does not assert Windows, Electron visual, GPU, device, installer or SOTA validation.

## Recipe, provenance and order

`settings.straighten` is `null` or exactly `{version:1, angle:<finite number -180…180>, mode:'expand'|'crop'}`. The frozen shared implementation is `src/straighten.cjs`, SHA-256 `7b28d67aba28747e85abf95c12b39522153871c4d084038bcb053244fa11f98e`. It is byte-identical to the approved mobile core. Its trigonometry, quantization, alpha/color interpolation and byte-copy loops are unchanged. No dependencies or models were added.

The final order is source-space edits/background/reshape → existing framing → straighten → padding → text → paint → redaction → explicit final-file resize → encoding. Strict raster calls receive only `{width,height,data}`, never transient manual-tool diagnostics. Preview source/manual views and white-balance input settings exclude all final geometry, including straighten.

Null/omission/exact zero do not execute the transform and retain legacy geometry binding strings and inactive export-plan shapes. An explicit complete zero recipe remains valid metadata; UI commits zero as null. Nonzero angle/mode are canonical binding data, even for same-sized outputs. Existing bound paint/redaction collections cannot be silently rekeyed or cleared.

## Persisted schema

Version 14 requires an explicit `straighten` field in current, committed, every undo/redo entry, and exported settings. Versions 1–13 remain readable and omitted historical fields migrate to null. Non-null validation is strict metadata validation before bound collections, without image allocation or render-budget planning. Original encoded source, source revision, cache blobs/provenance and previous history are retained. Recovery uses the same project codec.

## Selection rule

Any saved paint or redaction layer with a captured selection is rejected for non-exact-quarter angles, including hidden, disabled and empty layers. The check occurs before active-layer filtering, raster allocation or Canvas creation. Source-space manual selections and selection-local adjustments remain supported before the new stage.

Exact ±90/±180 selected-mask transport uses the shared byte-copy branch only. It is charged as its own work/output allocation between existing framing and zero-alpha padding. Packed Float32 mask bytes are never passed to arbitrary-angle RGBA interpolation. Existing selection/shape guards remain active.

## Plans, metadata and cancellation

Worker/native active results contain `straightened:true`, canonical `straightenRecipe`, and `straightenedWidth` / `straightenedHeight` before padding. These keys are omitted entirely for null/zero. Existing `framed`, `scaled`, processing dimensions and explicit composition/final-resize dimensions keep their prior meanings.

Native details additionally contain `straighten` (`exact-quarter-turn-byte-copy` or `linear-light-premultiplied-alpha-bilinear`) and `straightenRecipe`. `resampling` composes the arbitrary-angle token `straighten-linear-light-premultiplied-alpha-bilinear` with independent explicit working/final Lanczos resize stages. Exact turns themselves require no interpolation, but that does not make JPEG encoding lossless. Native bridge, preview scheduler and queue reject missing/forged same-size active metadata.

`Pipeline.preflightRender(canvas, settings, analysis, options)` synchronously returns the owned worker-ready recipe, expected dimensions, active metadata and managed-byte estimate without pixel reads, Canvas/worker/RGBA allocation or queueing. UI Apply and `render` share this exact admission; project loading does not call it. Every queued recipe and its plan are snapshotted together; analysis is copied before queuing. Active-straighten browser jobs serialize against other pixel jobs, while inactive jobs retain the old two-worker limit. Abort terminates running workers or removes queued work; late completions cannot publish accepted output. Direct replay forwards cooperative callbacks into the shared core. Cancellation never mutates originals or begins a queued write; an already committed atomic write retains existing saved semantics.

## Limits and managed-buffer admission

Shared limits remain outer ceilings, not desktop permission increases. Native source/intermediate/output remains 64,000,000 pixels and edge 16,384. Working size/complex effects retain existing 16,000,000-pixel limits. Browser render remains 16,777,216 pixels; active text/paint retain 16,000,000-pixel and their independent work/scratch limits. Every processing/framed/straightened/padded stage is preflighted before raster work, even without overlays or with a final 1px output request. Original and working plans are independently evaluated; there is no implicit fallback.

Active straighten also admits only a conservative cumulative managed geometry-path estimate ≤512 MiB. Native estimates add original and edited pre-framing processing RGBA planes, every non-null framing allocation (including identity), the shared output plus 2,048-byte table allowance, every non-null padding allocation (including zero edges), overlay composites, paint/redaction scratch, explicit final-resize output, retained encoded source buffers and incoming overlay/analysis backing buffers plus their main/worker copies. Runtime pure replay charges actual full backing allocations, not only logical views. Existing stage work limits still apply independently.

Browser estimates additionally charge input Canvas/readback and the edited pre-framing plane, output/comparison surfaces, overlay Canvas/readback copies, analysis copies, and caller `render(..., {retainedBytes})` for already-live UI/source surfaces. The application supplies its retained source Blob, displayed/comparison canvases and cached analysis buffers. Scheduling prevents two active geometry jobs from each independently admitting the same global envelope. These estimates do not guarantee RSS, native codec/Canvas internals, GC latency or GPU memory.

## Quality and verification

Only exact zero/quarter turns preserve core RGBA bytes. Arbitrary angles use linear-light premultiplied-alpha bilinear resampling and can soften texture. Expand intentionally includes transparent corners. Crop uses continuous pixel-center spans before integer quantization, not a guaranteed largest integer rectangle. No epsilon snapping or edge fill is added. Near-axis phase shifts and the shared documented binary64 one-pixel limits remain visible, including 2×3 at `1e-20°` expanding to 3×4 and the 8×8 / `36.86989764584403°` crop yielding 6×6.

Focused cloud tests:

- `tests/straighten-project.test.cjs`: schema, genuine frozen v13, every snapshot, strict records, original/cache/history preservation, oversized metadata, recovery and browser-global/WebCrypto roundtrip.
- `tests/straighten-pipeline.test.cjs`: provenance, legacy bindings, independent inverse sampler, exact turns after every legacy turn/flip, actual pixel-worker, near-axis/thin cases, selection guards, source-local order and cancellation.
- `tests/straighten-browser-pipeline.test.cjs`: scheduler snapshots, serialization, cancellation, stale/missing metadata, pre-readback caps and source/manual/WB bypass. Canvas/scheduling doubles, not an actual browser.
- `tests/straighten-native.test.cjs`: real existing Sharp PNG/JPEG, transparency, full working/final size order, final overlays/cover, metadata attacks, cancellation/reuse and queue retry/write boundaries.
- `tests/straighten-selection.test.cjs`: real existing native Canvas paint rasterization and independent scalar-coordinate feather-mask transport for all legacy turn/flip combinations and exact turns; backing-buffer accounting.

The UI and independent QA suites are owned separately. Full regression/packaging validation must run only after current static package fixtures are refreshed. No release0.2.6 archive or Library bytes are modified by this increment.
