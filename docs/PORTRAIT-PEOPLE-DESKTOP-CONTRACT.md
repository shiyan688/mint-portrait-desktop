# Desktop independent portrait faces, v1

This adapter wraps the frozen shared multi-face core without changing the existing calibrated portrait engine. It is a bounded desktop policy, not a detector, learned beautification model, identity tracker, or quality/real-device performance claim.

- `src/portrait-people.cjs`: exact shared UMD core, SHA256 `0de2c158f3a23c6e4de8326e7474ad809e02d41ccc2931a5ccfba76505a02b3a`.
- `src/portrait-people-desktop.cjs`: UMD `MintPortraitPeopleDesktop`; Node requires that local core and `portrait-engine.cjs`. Browser load order is `PortraitEngine`, `MintPortraitPeople`, then this adapter.
- Calibrated engine SHA256 remains `5cde7dcd60aab1d68e1ec5fb026c6396c2f395c1597dd03113c34674ba57d524`.
- Pinned detector: `mediapipe-face-landmarker`, existing model SHA256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`, exact topology `MediaPipe478`.

## Frozen API

All calls are synchronous. Errors have a stable `code` and useful message. Options and metadata are plain own enumerable data records; do not pass native `ImageData` accessors. No API silently resizes, partially applies, redetects, changes selection, or converts an unsupported operation to a legacy fallback.

- `validate(value, options)` returns a detached mutable nullable strict batch. `value` is exactly `null` or the shared batch schema. `undefined` is not a batch. Options require `sourceRevision`; optional `batchId`, `detector`, `shouldCancel` are validated. These are the same context options used for apply.
- `hasEffect(value, phase)` strictly validates nullable metadata and the pinned detector, then returns whether any face has nonzero numeric controls in `beauty` or `reshape`. It does not require a source context and cannot establish image identity by itself.
- `validateCompatibility(settings, sourceRevision)` returns the detached validated `settings.faceAdjustments`, treating a missing setting as `null`. This validates an own-data projection of the full desktop settings object, not the full project/manual recipe schema. Other enumerable own-data settings are permitted; their schema remains the caller's responsibility.
- `planSize(width, height, value, {sourceRevision, phase, batchId?, detector?, shouldCancel?})` validates metadata, source binding, geometry, overlap, dimensions and resource budgets with no image-sized allocation. Returns a deeply frozen plan. Active reshape sets `opaqueAlphaRequired:true`: this is a precondition, not evidence that the source is opaque.
- `applyBeauty(image, value, options)` and `applyReshape(image, value, options)` return `{width,height,data}` when active. The exact original image object and backing bytes are returned for an inactive phase. Image must be a plain `{width,height,data}` record with native non-shared, non-resizable `Uint8Array`/`Uint8ClampedArray` and exactly `width * height * 4` bytes.
- `geometryBinding(value)` returns `null` when no reshape controls are active. Otherwise it returns deeply frozen detached canonical data: version, sourceRevision, batchId, detector, detectionSize, and all faces sorted by local ID, each with all original landmarks and complete reshape controls. Beauty controls are omitted. This is complete canonical data, not a lossy hash. All inactive faces remain included because their protected geometry matters. Metadata changes and new detection batch IDs invalidate bindings even when visible point coordinates happen to match.
- `version`, `LIMITS` and `DEFAULT_DETECTOR` are exported immutable metadata.

`sourceRevision` is a nonempty opaque string, not a pixel hash. Caller-controlled source revisions and batch IDs bind a particular immutable geometry snapshot; dimensions alone never establish identity. Keep all 478 points from all 0–5 detected faces. Do not transfer old controls to a fresh detection by order or assumed identity. Local IDs are assigned by the shared `createBatch` helper in detector order only.

## Required pipeline integration

Run `validateCompatibility` before processing. Run `planSize` for each phase before export pixel allocation using the actual pre-framing replay size. Fixed order:

1. Per-face beauty at the existing beauty stage, before basic color.
2. Per-face reshape after background processing and before final framing.

A nonnull batch selects per-face mode, including an all-zero batch. All eleven flat global numeric portrait controls must be zero: `smooth`, `brighten`, `warmth`, `underEye`, `redness`, `lip`, `blush`, `slim`, `eyes`, `nose`, `jaw`. Missing controls mean neutral for this compatibility projection. Numeric strings, NaN and Infinity are rejected. A selected global `palette` or manual `region` alone does not conflict. Null/missing per-face mode does not impose the new strict 60/50 reshape bounds on legacy controls.

Active per-face reshape rejects nonempty `manualLiquify` (`MANUAL_STALE_ANALYSIS`) because composition would use stale coordinates. Per-face beauty followed by manual liquify is allowed by this adapter; other existing manual restrictions still apply. Active per-face reshape also rejects explicit `bgMode:'transparent'` (`TRANSPARENT_RESHAPE`) before processing. At apply, every source alpha must be 255 for active reshape, including originally transparent sources or opacity introduced by any other earlier stage. Zero-effect reshape preserves transparency byte-for-byte.

The caller must also bind/invalidate source-coordinate masks, paint/redaction geometry, manual repairs and histories when upstream geometry changes. The adapter does not own those schemas. Use canonical `geometryBinding` in geometry keys instead of applying geometry-blind source masks after a reshape. Null binding for neutral batches preserves older neutral geometry identities.

## Strict metadata and atomic pixels

The shared batch contains version, sourceRevision, batchId, detector, detectionSize and `faces`. Each face has its ID, exact 478-point mesh, complete beauty controls and complete reshape controls. Unknown fields, symbols, accessors, hidden fields, inherited/custom-prototype defaults, sparse arrays, duplicate/missing IDs, oversized structures, invalid coordinates and out-of-range controls reject before processing. The descriptor checks never evaluate getters. Image backing validation calls captured native ArrayBuffer byteLength/resizable getters, never instance accessors or shadow values; actual resizable, detached and shared buffers reject even when their properties or prototype lie. This is not a sandbox for hostile JavaScript Proxies or altered built-ins. Decode stored data into ordinary records.

Each active face reads the same immutable input of its phase, never the output of another face. The shared core verifies every output-difference byte and only merges proven disjoint deltas. Neighbor protection includes inactive faces. Conservative influence intersections reject the whole operation (`FACE_OVERLAP`); no hard clipping or invented feather masks are used to make an unsupported overlap appear valid. Beauty preserves alpha and zero-alpha hidden RGB. Source image and batch records are not mutated by this adapter and the frozen engine.

Cancellation is checked during validation/planning, before and after each face, during alpha/output verification, and before returning. No partial output escapes. A synchronous individual engine call cannot be interrupted mid-call; keep preview/export generation or worker-job guards as well. User callbacks must not mutate phase input bytes. Engine/callback exceptions propagate without returning pixels.

## Budgets and plans

Active phase limits:

- 16,000,000 image pixels and 16,384 per edge.
- 268,435,456 bytes (256 MiB) estimated extra peak typed buffers.
- 512,000,000 conservative work units.
- 536,870,912 bytes (512 MiB) cumulative typed-array allocations across all faces in the phase.

The cumulative limit is explicitly checked after no-allocation core planning and before any engine operation. It avoids assuming prompt inter-face garbage collection. All budgets are reject-only, never an implicit resolution reduction. Core detection metadata remains bounded by its strict schema; active rendering also applies desktop active dimension limits to detectionSize.

Inactive phases still validate context, strict metadata, image descriptors/backing bytes, and the existing desktop 64,000,000-pixel / 16,384-edge admission budget. They do not invoke core plan/apply and do not introduce the 16M active portrait cap or allocate/copy a pixel buffer. This is phase-specific: an active beauty batch with zero reshape controls is a reshape no-op.

Plans retain the shared core fields: phase/source/batch/detector, width/height, workSize, opaqueAlphaRequired, all faces with protected/display/write/read/influence bounds, controls and resources. The adapter adds `noOp` and `desktopLimits`. Inactive plans have `workSize:null`, `opaqueAlphaRequired:false`, null effect bounds, `resources.reusedInputBytes` equal to source RGBA bytes, and zero additional output/temporary/cumulative/work estimates. All plan data is deeply frozen.

`resources.extraPeakBytes`, `cumulativeTypedArrayBytes` and `workUnits` are allocation/work estimates, not actual process RSS, CPU instructions, wall time, browser memory or Windows performance. They exclude source/canvas/native/GPU/history storage, metadata/JS objects and VM overhead. Whole-pipeline budgets remain the caller's responsibility; passing this adapter alone does not establish total application peak safety.

Additional adapter error codes include `HIDDEN_FIELD`, `PORTRAIT_GLOBAL_CONFLICT`, `MANUAL_STALE_ANALYSIS`, and `CUMULATIVE_MEMORY_BUDGET`; shared codes such as `MODEL_MISMATCH`, `SOURCE_MISMATCH`, `FACE_OVERLAP`, `TRANSPARENT_RESHAPE`, `LIMIT`, `RANGE`, `MEMORY_BUDGET`, `WORK_BUDGET`, `CANCELLED` remain available.

## Verified host regressions

Run `node --test tests/portrait-people-desktop.test.cjs`.

The pure/adversarial suite covers pinned file hashes and browser UMD loading, detached strict batches, stale source/batch/model rejection, getters never invoked, hidden/unknown metadata, limits and numeric controls, flat compatibility checks, allowed neutral palette/region, manual/transparent reshape rejection, exact no-op identity, 17MP inactive apply, allocation-free 64MP inactive plans, invalid backing bytes, malicious backing-buffer accessors, shadowed resizable flags, detached and prototype-disguised shared storage in active/inactive phases, two/five independent beauty and reshape deltas, array-order invariance, source/batch immutability, inactive-neighbor protection, overlap rejection, beauty alpha/hidden RGB, reshape alpha precondition, cumulative allocation rejection before engine invocation, cancellation and canonical geometry binding.

Optional portrait-pixel tests read `MINT_MULTIFACE_QA_DIR` or `/workspace/shared/mobile-multiface-qa`. These inputs are intentionally external QA artifacts, not app/bundled assets. The two/five-face source pixels were visually inspected. They are separated synthetic composites of existing public NASA adult portraits, not real group photos, training data, marketing assets or endorsement. The landmark files contain existing fresh MediaPipe Tasks Python CPU detections with all 478 points, matching the pinned model. This suite does not rerun or modify the model.

On 2026-10-22 all four public-composite phase cases matched independent immutable-input calls byte-for-byte, including reversed face order and inactive-neighbor protection. Changed pixels per detected face:

- Two-face beauty: 49,190 / 47,233; reshape: 9,034 / 14,401.
- Five-face beauty: 15,582 / 23,880 / 21,889 / 22,132 / 21,308; reshape: 4,817 / 6,172 / 6,189 / 4,200 / 5,129.

Conservative wide slim/jaw fields correctly reject these close composite configurations; eye/nose-only reshape passes. Successful host pixel tests do not prove detection or safe transformation for arbitrary overlapping group photos. These are cloud/Linux Node renderer and metadata tests with separate host CPU model evidence, not actual Electron UI, Windows/device inference, exporter round-trip, subjective Asian-portrait quality acceptance, or a state-of-the-art claim. Those integration/runtime checks remain separate.
