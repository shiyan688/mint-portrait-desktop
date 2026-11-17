# UNRELEASED: local model backend contract scaffold

This checkpoint defines an independently testable interface for a future redesign. It does **not** install, download, select, load or run a shipped model. It is not wired into the UI, pipeline, pixel worker, engine or installer. It does not make existing algorithms AI or SOTA. This pure runner ships no adapters; the separately implemented desktop transport and approved CPU research checks are documented in DESKTOP-BACKEND.md. Model quality, supported hardware and release approval remain separate gates.

The historical defect-mitigation implementation is preserved byte-for-byte at `quality/frozen-mitigation-portrait-engine.cjs`, SHA-256 `65cebaaaf65797e9661ee213d28083eec4c4f194fc14384ebd8ec8340cc00b2c`. It is not a SOTA implementation. The current `src/portrait-engine.cjs` additionally supports validated continuous learned alpha with linear-light background blending; its checkpoint SHA-256 is `436368db1f81de124f6e4b86a8500f8e3152fb7fb36fcaff58d151015e04a3b9`. The classical skin/reshape algorithms were not replaced by this alpha integration.

## Files and verification

- `src/backend-contracts.cjs`: dependency-free CommonJS contract runner; no production adapters.
- `src/backend-contracts.d.cts`: TypeScript declarations named for explicit `.cjs` imports under Node16/NodeNext resolution.
- `tests/backend-contracts.test.cjs`: injected, clearly labelled test doubles, not inference or quality evidence.
- `docs/BACKEND-CONTRACTS.md`: this boundary and its limitations.

Run the focused tests with `node --test tests/backend-contracts.test.cjs`. Run the existing aggregate checks with `npm test`. Tests do not require new packages, downloaded weights, network listeners, APIs or photo uploads.

## API and trust boundary

`createBackendSession(original, options)` snapshots a straight-alpha, sRGB RGBA8 original. `getOriginal()` returns a new copy. `listModels()` returns immutable metadata. `start(request)` returns a job with `id`, observable `state`, `result` promise and `cancel()`. `dispose()` rejects active work and closes the session. Subscribe to the result promise immediately, including cancellation errors.

`options.adapters` is empty by default. Injected adapters must expose a descriptor and `run(context)`. They are trusted local application code, not a plugin sandbox. This module does not load arbitrary code or verify that an adapter truthfully performs inference. Do not accept adapter implementations or readiness declarations from photo metadata, documents, remote content or untrusted model manifests.

Every descriptor explicitly names:

- Model ID, version, task capabilities and `kind: model | test-double`.
- `weightsSha256`, a lowercase 64-hex SHA-256 for the exact pinned weights asset/bundle. Only test doubles may use `test-double:no-weights`.
- Device kind (`cpu`, `cuda`, `directml`, `metal`) and device name. There is no implicit `auto` device or fallback.
- License ID, HTTPS source URL and review status (`approved`, `pending`, `blocked`).
- Model status (`ready`, `missing`, `incompatible`, `disabled`).

`license.status: approved` is a trusted application-configuration assertion that a separate review passed. It is **not** legal acceptance, proof of legal compliance, user consent, or an approval mechanism. This scaffold accepts no legal agreements. Similarly, `ready` and a digest declaration do not prove weights are present or correct. A future loader must verify actual asset hashes, all necessary code/weight licenses and hardware/runtime compatibility before marking a model ready. Multi-file or quantized assets need an exact pinned bundle/manifest identity, not a hash of an unrelated base checkpoint. The loader must compute and validate that identity; this contract only validates and compares the supplied digest.

The exact requested model ID/version must exist, be ready, support the requested task and have approved license metadata. Test doubles require the explicit test-harness option `allowTestDoubles: true`. Failures reject instead of trying a different model, a different device, hand-coded pixel processing or an output falsely labelled AI. Completed test-double output remains labelled `test-double`.

## Task and pixel contracts

Supported tasks are `retouch`, `matting`, `inpaint` and `restore`. Reshape is intentionally not scaffolded. Parameters for particular models are intentionally deferred.

Each request supplies `task`, exact `modelId` and `modelVersion`, `roi`, `mask`, finite `strength` in `[0, 1]`, and optionally an `AbortSignal`.

- Images declare `format: rgba8`, `alphaMode: straight` and `colorSpace: srgb`, with exactly `width × height × 4` bytes in `Uint8Array` or `Uint8ClampedArray`. Premultiplied pixels, floating image arrays and shared buffers are rejected. The caller must normalize image orientation and color before opening the session; decoding is outside this contract.
- ROI is an integer `{x, y, width, height}` rectangle in **original-image pixels**, using top-left origin and half-open bounds `[x, x + width) × [y, y + height)`. Invalid, fractional or out-of-bounds coordinates are rejected, never clamped.
- Masks explicitly declare `space: roi-original-pixels`, `encoding: unit-float32`, dimensions equal to the ROI and a `Float32Array` with one finite `[0, 1]` value per pixel. NaN, infinity, byte masks and guessed scales are rejected. Every task requires a supplied edit mask, including matting; it is distinct from the predicted foreground matte.
- Width and height must be positive safe integers within `maxPixels`. The default budget is 16,777,216 pixels and can be explicitly configured. There is no 1000-pixel working scale, preview-size substitution, aspect-ratio restriction or implicit resampling. Original-size preservation applies to every input allowed by that explicit budget, not to unlimited memory use.
- Adapters receive isolated copies of the ROI source and edit mask, plus immutable ROI, original dimensions and model metadata. They never receive the runner's private original buffer. Mutating an adapter input cannot alter the private original or the authoritative blend mask.

Color tasks return an RGBA8 image at the exact original ROI dimensions. They must preserve the original alpha byte at every ROI pixel, including zero-mask pixels. Matting instead returns a `unit-float32` foreground matte at those dimensions. Default alpha-only matting preserves all source RGB bytes and can reduce, but not increase, original alpha. A result cannot contain both image and matte.

Adapters return **full-strength** predictions. The runner alone applies `w = editMask[p] × strength` once. For color tasks, each RGB byte is `round(original + w × (prediction − original))`; alpha is copied exactly. For matting, alpha is `round(originalAlpha × (1 − w + w × matte[p]))`; RGB is copied exactly. The existing color-task formula is byte-space sRGB interpolation; optional matting foreground color follows the separate linear-light rule below.

Optional matting `foreground` is a separate classical PyMatting 1.1.16 RGBA8 straight-sRGB color estimate, not an image edit or a different matte. Exact ROI dimensions, source-alpha byte identity, and original RGB wherever source alpha is below 255 or predicted matte equals 1 are mandatory. Its provenance must declare classical-color-estimation/pymatting/1.1.16/estimate_foreground_ml and an `alphaDigest` equal to SHA-256 of the exact matte's float32 little-endian bytes. Its `sourceDigest` must also match SHA-256 of the exact original ROI RGBA8 bytes. An edited matte or another source with an old estimate fails closed. Recompute classical color against corrected alpha without rerunning the model, or remain alpha-only.

The caller must explicitly pass `applyForeground: true` and `foregroundStrength` in `[0,1]`; color strength defaults to zero. These options are matting-only. The runner interpolates original to estimated RGB in linear light using foreground strength, then blends original and target as premultiplied linear-light layers using edit-mask × overall strength, and converts back to straight sRGB. Alpha uses the unchanged formula above. Color strength zero is exactly alpha-only matting, including source RGB preservation, while overall strength zero remains a full-image no-op. Hidden RGB is preserved where output alpha quantizes to zero. The original source, masks and model buffers remain isolated; provenance records the independent color strength and whether applied. This optional capability is not automatically enabled by a supplied plane and is not a claim that incorrect learned alpha is repaired.

The output retains original dimensions. Pixels outside the ROI and pixels with zero edit-mask weight are copied byte-for-byte, including hidden RGB under zero alpha. Blends stay between original and predicted channel values, subject to byte rounding. There is no feathering outside the supplied mask. Zero strength or an all-zero mask returns an exact original copy with `status: noop` and `provenance: null`, and never calls an adapter. Model/license/input validation still applies to no-ops.

Each session evaluates against its immutable original, not the previous job's result. Chained editing/history requires a separate, explicit integration design, rather than silently changing the meaning of the original.

## Provenance and lifecycle

Every non-noop result must echo its unique in-process session/job ID, task, model ID/version, exact weights digest, kind and device. All are compared with the selected descriptor and job. Wrong or missing provenance fails closed. Output buffers are validated and copied before blending; the runner never publishes adapter-owned buffers. Provenance is a consistency check, not cryptographic attestation that a model actually ran. Cross-process/persisted job identity is outside this scaffold.

States are `queued → running → succeeded | failed`, with `cancelled` or `superseded` terminal states possible before completion. No-op jobs may move directly from queued to succeeded.

- A valid new job supersedes the prior unfinished job. Invalid new requests and already-aborted signals do not discard useful active work.
- `cancel()`, external signal abort, supersession and disposal reject the affected result immediately and signal the adapter. Late success and late failure are consumed and discarded, even if an adapter ignores the signal. Synchronous abort handlers can reenter `start()` without losing the newest job.
- Cancellation is **cooperative signaling plus result rejection**, not proof that native inference stopped, GPU resources were freed, or synchronous work was preempted. This in-process runner cannot interrupt a blocking call. An eventual worker/native-process adapter must implement actual cancellation, resource cleanup and bounded inference scheduling; ignoring abort can leave physical inference running concurrently with newer requests.
- Failed jobs never publish a partial image or a fallback result. A later explicitly started request can retry. The original stays unchanged through failure, cancellation and successful output mutation.

## Pending integration decisions

Before any released model-backed feature, select and review actual model assets and licenses, verify exact asset hashes, benchmark supported hardware, implement a bounded cancellable worker/native runner, validate model preprocessing/output transforms at original resolution, and perform visual/identity/edge quality evaluation on authorized fixtures. For high-resolution restoration, this contract permits a same-size restored patch only; super-resolution needs a separate explicit output-geometry contract.

Nothing in this checkpoint authorizes downloading models, executing unknown code, opening network listeners, uploading photos, accepting licenses, changing the frozen engine or shipping a new installer.
