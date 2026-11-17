# Independent desktop paint-core QA

## Result

No core regression or release-blocking defect found in the audited candidate. The independent suite passes **123/123**, zero failures or skips. The unchanged inherited mobile regression suite was independently rerun: **161/161**, zero failures or skips. All standalone resource and desktop tile-reference checks completed successfully.

This result covers the isolated transparent paint-layer core on Linux Node v24.19.0 with the preinstalled `@napi-rs/canvas` 0.1.100. It is **not** acceptance of the editor UI, actual photograph integration, Electron, Windows, Chromium, GPU behavior, or device memory/latency.

## Audited inputs and change isolation

- Candidate SHA-256: `cbf7ef6b29254859df709f34b5f59a2cc2b9b29842cec4fe534ea9d9271130cf`.
- Frozen mobile control SHA-256: `fab1a908831f00f2c5d6110c2fde95a0957f3ee44b537058007cde4ce02f9f4e`.
- An exact source-reconstruction assertion proves that reversing only the named factory, desktop dimension caps, shared ownership WeakSet, and non-enumerable API addition recovers the original mobile source byte-for-byte. The raster, validation, tiling, disposal, and cancellation algorithms are otherwise unchanged.
- Default and explicit mobile retain 8,000,000 pixels and 4096 maximum edge. Desktop permits 16,000,000 pixels and 16384 maximum edge. All other limits remain exact.
- Legacy `Object.keys` enumeration is preserved. `createProfile` is non-enumerable, non-writable, and non-configurable. Browser-global and AMD loading also expose the profiles without allocating a Canvas.

No production files were edited. No dependency was installed. No network, external model, private photo, or Windows runtime was used.

## Independent coverage

`independent.test.cjs` exercises:

- Malformed and coercion-prone recipes; unknown/hidden/symbol fields; unsafe prototypes; inherited fields; sparse/extra/numeric-alias array properties; width, opacity, coordinates and color boundaries; invalid named profiles; null-prototype records and arrays; detached deeply frozen snapshots.
- Accessor descriptors at recipe, stroke, point, array-index and options levels are rejected without running getter or setter bodies. Proxy traps remain outside the documented passive-data contract.
- Item/point counts, exact 16M dimension boundary, 16384 edge, invalid dimension types, exact 32M erase-work budget and overflow rejection occur before Canvas allocation. Mobile caps stay unchanged. Independently calculated clipped bounds agree with plan metadata.
- **384 new seeded native fixtures** compare default, explicit mobile and desktop results against frozen mobile. They cover 1,537,767 reference pixels and 18,453,204 compared RGBA bytes, all exact.
- 2-point versus 257-collinear-point gestures and 1-point versus 1024-identical-point discs produce exact matching output for the tested geometry. One gesture does not accumulate alpha per event.
- Endpoint mapping, short-edge width, one-pixel dimensions, per-gesture partial/repeated/full erasure, paint-after-erase, zero-alpha erasers, monotone alpha, sanitized fully transparent RGB and untouched pixels outside conservative bounds.
- A five-profile ownership matrix, including descendant profiles, rejects previously published output aliases without changing prior pixels or dimensions. Reusing prior output as a mask, output as its own mask, and previously failed issued canvases is rejected. Only fresh unpublished output is cleaned up.
- Every one of **16 cancellation checkpoints** in a multi-tile fixture throws `AbortError` and disposes all newly owned canvases. Callback exceptions retain exact identity.
- Injected native allocation/context/save/restore/draw/read/write and malformed-ImageData faults clean up all fresh owned surfaces. Successful output identity is the originally allocated output. Exactly one bounded mask is reused and disposed.
- Actual native **16384×900** rendering uses one 1000×900 mask across 34 erasure tiles.
- Actual native **4000×4000** rendering uses one 1000×1000 mask; fully covered interior pixels at multiple tile seams have exactly `[255, 0, 0, 128]` after a 50% eraser.
- A synthetic 640×480 gradient/checker base is never passed to the core. Its before/after pixel SHA-256 stays exactly `a40851dc8cd677dbaf7cc788c7dda4f36698e8b0467386743085588a80068247`. Independently composing the returned transparent layer reveals the exact base pixels at erased areas. This proves the test composition, not the yet-untested editor integration.

NativeCanvas is a mandatory direct require in the independent suite and experiments. Missing or unloadable native dependencies fail the run; they cannot turn raster checks into skips.

## Desktop tiled-reference observation

`desktop-tile-comparison.cjs` independently implements whole-viewport coverage plus mathematical alpha erasure for a 5201×1601 bent/self-crossing path with repeated partial erasers. This size exceeds mobile caps.

- 8,326,801 output pixels; 24 mask tiles; 16,653,602 erase-work pixels.
- **2,251,408 flat-interior pixels: zero mismatches.**
- **17,250 tile-seam interior pixels: zero mismatches.**
- 52,284 pixels differ at non-flat antialiased boundaries.
- Observed maximum alpha difference: **33/255**.
- Observed maximum premultiplied-color-channel difference: **24.0471/255**.

The native rasterizer's tiled-versus-whole-viewport antialias behavior is already documented in the mobile contract. This larger fixture demonstrates why its observed mobile 5/19 alpha differences must not be reused as desktop or universal bounds. No cross-backend or universal per-pixel equivalence is claimed. No native `destination-out` path was used to construct the reference.

## Resource observations and integration guardrails

Desktop's maximum logical pixel storage is about **76 MB decimal**: 64 MB output, 4 MB reusable mask, and two 4 MB tile ImageData buffers. This replaces mobile's approximately 44 MB estimate. It excludes backend copies, backing-store implementation, photo, composite, history, GC lifetime, GPU and renderer overhead.

Two separate fresh Linux process diagnostics were recorded:

1. Four back-to-back synchronous 4000×4000 renders, shrinking canvases and requesting explicit GC between them: RSS rose from about 75.7 MB to a rendered observation of 759.0 MB and a final post-shrink observation of 627.0 MB.
2. Same four renders, but allowing event-loop yields and explicit GC between operations: rendered observations were about 344.0–361.4 MB, post-yield observations about 189.7–216.1 MB, and native external memory returned near baseline. Final RSS was about 193.7 MB.

These observations are consistent with native finalization/allocator timing; they do **not** establish a core leak, prove leak freedom, or characterize Windows/Electron. Explicit GC is diagnostic, not a browser integration mechanism. Do not present 76 MB as a process-memory cap. Bound the application's aggregate photo/layer/composite/history allocations and avoid unbounded synchronous chains of full-size re-renders.

The core is synchronous. Its checkpoints cannot receive fresh UI input while JavaScript is blocked. Cancellation/stale-publication handling, ownership transfer and release after later composition failures remain the editor integration's responsibility. A Canvas factory must supply a genuinely fresh transparent-layer Canvas, never the photo, a displayed preview or another owner's untracked Canvas.

## Visual inspection

The following are actual generated raster-test outputs, not UI screenshots:

- `synthetic-evidence-contact.png`: inspected at full contact-sheet size. It shows the synthetic base, painted layer, central erased gap and independent composition. Round paint endpoints remain; the erased gap shows the original checker/gradient, not white paint.
- `maximum-layer-4000.png`: inspected for diagonal geometry and continuity. Numeric RGBA assertions establish partial alpha, since the image viewer's transparent backdrop does not reliably visualize alpha differences.
- `synthetic-base.png`, `synthetic-transparent-layer.png`, `synthetic-composite.png`: original separate evidence layers. Their SHA-256 values are in `evidence.json`.

The first local harness run found two harness/oracle problems, not candidate defects: spreading an accessor options object caused the test itself to run its getter; the helper now copies descriptors. The paint-alpha assertion initially assumed 128 rather than permitting the native source-over backend's 127/128 quantization; exact eraser alpha remains asserted at 128. Corrected tests all pass. Production code was unchanged throughout.

## Evidence and reproduction

All files are in this independent QA directory:

- `independent.test.cjs`, `independent-test.log`, `evidence.json`.
- `mobile-regression-rerun.log`.
- `desktop-tile-comparison.cjs`, `.json`, `.log`.
- `memory-observation.cjs`, `.json`, `.log`.
- `memory-yield-observation.cjs`, `.json`, `.log`.
- The PNGs listed above.

Commands (run from this directory):

```sh
node --test independent.test.cjs
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node --test ../mobile-regression.test.cjs
node desktop-tile-comparison.cjs
node --expose-gc memory-observation.cjs
node --expose-gc memory-yield-observation.cjs
```

The native package is preinstalled at the pinned path used by the independent scripts. No installation is needed.

## Restorable-source relocation

The preserved audit was copied into `quality/paint-qa/core-independent`. Reproduction scripts now load the current `src/paint-layer.cjs` instead of an external candidate copy; the immutable mobile control is retained one directory above. Only module path locators changed. The audit generator emits new files beside itself. Run the 123-test suite from this folder, and the 161-case mobile/default regression from `../mobile-regression.test.cjs`. NativeCanvas remains mandatory. Original observations above are not universal memory or raster bounds.
