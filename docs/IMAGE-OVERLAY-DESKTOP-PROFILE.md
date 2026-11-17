# Fixed desktop image-overlay profile candidate

Status: isolated, qualified source candidate. No mobile or desktop production integration, installer modification, download, model execution, or UI claim is included. Qualification used Node.js v24.19.0 on the cloud executor, not a Windows or Android device.

## API and selection

The CommonJS, AMD and browser-global module retains the original `LIMITS`, `defaults`, `validate`, `validateAsset`, `encodeAsset`, `decodeAsset`, `layout` and `apply` exports. Their default budgets and behavior are unchanged. One new export, `createProfile`, is deliberately observable through API enumeration.

`createProfile('desktop')` returns a fresh, frozen API object with the same nine members. Its functions and frozen `LIMITS` object are isolated from other instances. It may itself create another fixed desktop profile. Calling existing module functions directly always uses the original mobile/default profile.

Exactly one primitive string argument equal to `'desktop'` is accepted. Missing arguments, unknown names, boxed strings, objects, coercible values and extra arguments are rejected with `IMAGE_OVERLAY_INVALID`. There is no public limits object, override, arbitrary configuration, tile bypass, mutable shared profile, automatic promotion or fallback to a different renderer. Function expando properties do not affect closed-over budgets. Consumers should obtain one profile and retain it, rather than repeatedly construct profiles while rendering.

Only the private factory name, four selected limits, the explicit selector, the API export list and the introductory comment differ from the frozen original. Existing validation, geometry, filtering, color arithmetic, planning, copying and cancellation code is unchanged. There is one implementation of each compositor function, not separate mobile/desktop renderers.

## Fixed limits

| Constraint | Original/default | Explicit desktop |
| --- | ---: | ---: |
| Target pixels | 8,000,000 | 16,777,216 |
| Either target edge | 4,096 | 16,384 |
| Managed extra-allocation ceiling | 67,108,864 bytes (64 MiB) | 134,217,728 bytes (128 MiB) |
| Planned work ceiling | 100,000,000 units | 256,000,000 units |

Every other limit is identical in both profiles:

- Asset: at most 1,048,576 pixels, 1,024 per edge, 4,194,304 RGBA bytes and 5,592,408 canonical base64 characters.
- Size: 0.02 through 2; x/y and opacity: 0 through 1; rotation: -180 through 180 degrees.
- Edge coverage: fixed 4×4 samples; mip density: at most 2 texels per destination pixel where reducible.
- Cancellation checkpoint interval: 16,384 pixel visits, with additional row/chunk/stage checks.

Dimensions must be positive safe integers and satisfy both edge and total-pixel limits, including at zero opacity. Thus 4096×4096, 8192×2048 and 16384×1024 are desktop-admissible dimensions, but 4097×4096 and 16384×1025 are not. Dimension admission alone is not acceptance of a recipe/asset or of an entire application's pipeline.

## Input boundary and safety

Recipe, image, asset and options records retain their exact field sets. Records must have the local ordinary Object prototype or null prototype, with enumerable own data properties only. Missing/extra/symbol/non-enumerable/accessor fields and custom/inherited prototypes reject. Ordinary accessors are not invoked. Asset paths, URLs, filenames, MIME data, revision metadata and data URLs are not accepted by this core.

RGBA pixels must be a local exact native Uint8Array or Uint8ClampedArray view over a local ordinary, attached, fixed ArrayBuffer. Offsets and native subarray views are supported. Node Buffers, foreign-realm views, typed-array subclasses, proxies, DataView, wider arrays, shared buffers, resizable buffers, detached buffers and buffer subclasses reject. Intrinsic typed-array length/buffer/offset getters and native copying ignore shadow getters/methods on a legitimate native view. Non-index expando fields on a pixel view are ignored, not enumerated.

This is a plain-data contract, not an arbitrary hostile-JavaScript sandbox. Proxy reflection traps can execute before rejection, and monkey-patched global intrinsics are excluded. Hooks and callers must not change or detach inputs during execution. API freezing does not freeze caller-owned pixel buffers or prevent malicious callback code.

All dimensions are bounded before multiplications that determine allocations. At desktop limits, target RGBA length is at most 67,108,864 and edge-product intermediates remain well below Number.MAX_SAFE_INTEGER. Asset metadata/dimensions/length are checked, the plan is computed and work/memory guards are enforced, then canonical base64 is scanned before decoded asset, output or mip pixel buffers are allocated. `layout` allocates small bounded plan records but no pixel buffers. Invalid options/records, too-large dimensions, malformed base64 and immediate cancellation were traced to zero pixel-buffer allocations.

## Unchanged image behavior

The displayed overlay long edge is `recipe.size * min(targetWidth,targetHeight)`; aspect ratio is preserved. Center is normalized to target dimensions. Positive rotation is clockwise in image coordinates; local flips occur before rotation. Exact cardinal angles remain exact. The full transformed rectangle is clipped to the target, not split into tiles.

Filtering remains premultiplied-alpha area mip reduction followed by bilinear sampling in encoded sRGB byte space. Interior pixels use one center sample; geometric boundary pixels use fixed 4×4 coverage. This is not linear-light color processing, analytic antialiasing, a new resampler or a claim of parity with another graphics backend.

Effective sampled alpha is `As = sampledAlpha * opacity`. Source-over computes `Ao = As + destinationAlpha * (1 - As/255)` and divides premultiplied source-plus-destination color by Ao, then rounds. Transparent source samples leave target bytes untouched; subquantum coverage does not erase hidden RGB when output alpha rounds to zero. No source pixel is written. Inactive, all-transparent or byte-identical results return the original input object. Changed results publish a new Uint8ClampedArray only after completion.

## Honest resource accounting

For target pixels P, asset bytes B, asset base64 characters C, bounds rows R, interior pixels I, boundary pixels E and cumulative generated mip pixels M:

- Samples = I + 16×E.
- Active work = C + B + B/4 + P + I + E + 4×samples + 13×M + 8×R.
- Active managed extra bytes = 2 MiB + B + 4×P + 32×M.
- Inactive work = C; inactive managed extra bytes = 2 MiB.

Every generated Float64 mip allocation is charged cumulatively, even if a runtime might collect earlier levels. The 2 MiB allowance is a planning allowance for small objects and bounded views, not a physically reserved allocation. The memory cap is a guard on this estimate. With current independent target/asset/mip caps, a conservative maximum expression is 84,585,120 bytes (about 80.67 MiB), below the 128 MiB guard; this does not mean arbitrary future changes may omit the guard.

This estimate excludes existing caller target pixels, asset strings, original encoded files, decoder/Canvas/Sharp/IPC buffers, history, other layers, callbacks, runtime overhead and GC retention. A maximum target alone is another 64 MiB of caller-owned input. The compositor therefore DOES NOT promise total process memory ≤128 MiB, an RSS bound, successful OS allocation, bounded wall-clock latency or whole-pipeline admission. Integrations need their own aggregate memory/work and retained-asset budgets. Platform allocation errors propagate, and no result is published on failure.

Work units are bounded operations for this algorithm, not CPU instructions or milliseconds. The actual legal fixtures and boundary plans remain below the fixed ceilings. Additional test-only lowered-cap fault injection verifies both guards fail before pixel allocation; it is explicitly not a supported configurable profile, not an increased-cap rendering path, and not evidence of reaching 256 million work units under legal current inputs.

`encodeAsset` remains bounded by the asset caps and uses the existing `2 MiB + 4*encodedLength` string estimate. `decodeAsset` uses `2 MiB + assetBytes`. Neither gains larger asset dimensions in the desktop profile.

## Cancellation and failures

`apply(..., {shouldCancel})` remains cooperative and synchronous. It checks before allocation, during bounded base64/decode/alpha scans, every mip/raster row, chunked copying, bounded pixel visits and before publishing. Truthy throws an Error named AbortError with code `IMAGE_OVERLAY_CANCELLED`; hook exceptions propagate unchanged. No partial result is returned. Invalid input, cancellation, callback failure and allocation failure do not write caller pixels.

This does not yield the event loop. UI-initiated cancellation needs worker/orchestration support and does not arise merely because the function accepts a callback. Source mutation/detachment by the callback itself is outside the guarantee.

Errors remain TypeError / `IMAGE_OVERLAY_INVALID`, RangeError / `IMAGE_OVERLAY_LIMIT`, cancellation as above, or unchanged callback/platform exceptions.

## Evidence and exclusions

- The 27 frozen mobile pure fixtures pass against the original and the candidate default. The adapted copy changes only source-read/import paths and the expected extra API export.
- Added qualification covers 300 deterministic shared-domain RGBA cases with exact original/default/desktop outputs and plans, plus edge/near-cardinal rotation/alpha/mip cases, immutable inputs, schema/buffer safety, cap boundaries, cancellation and pre-allocation failure checks.
- An independent review contributes another 200 generated comparison cases and checks exact reverse-normalization to the original source.
- Two real 4096×4096 desktop renders (16,777,216 target pixels each) match independently coded integer source-over oracles byte-for-byte: a clipped aligned rectangle and a full-frame composition. The full-frame plan uses 100,696,077 work units, above the original 100M ceiling but within the fixed desktop budget. The original source image is unchanged and the default profile rejects the target. It traces 67,108,868 owned pixel-buffer bytes, with 69,206,020 planned bytes including the allowance. A real large-copy cancellation leaves the source unchanged.
- A mip-heavy trace accounts exactly for every decoded/output/Float64 pixel allocation, including all intermediate mips.

This does not qualify desktop UI, asset import, photo-level asset retention, multiple-layer aggregate admission, save/export integration, project replay, a native decoder, Windows execution, Android WebView or installer behavior. It is the shared-core prerequisite only. No new dependency is needed by this candidate.
