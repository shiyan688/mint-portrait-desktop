# Desktop image asset/import candidate

Only files below this candidate directory were written. Production, mobile, Electron, user photos and model/API paths were not executed or changed. Dependencies are Node built-ins and the existing approved Sharp 0.35.5.

## Integration map

- Copy `image-assets.cjs` to `src/image-assets.cjs`; it is UMD (`MintImageAssets` in browsers).
- Copy `image-import.cjs`, `image-import-worker.cjs`, `image-import-decode.cjs`, and `image-import-guards.cjs` beside `main.cjs`.
- The worker imports existing `./src/project-document.cjs` only for its read-only `inspectImage` function; no rendering/model initialization is invoked. It requires existing installed `sharp`.
- Main constructs the codec with the frozen/default-compatible compositor. Asset dimensions are unchanged by the desktop compositor profile.
- Renderer IPC must forward only `{requestId, sourceRevision}`. Keep source/photo/revision ownership and atomic adoption on Apply in the caller. Do not retain the asset on cancellation or a stale source revision.
- Wire `cancel(requestId)` for the current request and `dispose()` on app quit. A newer import automatically cancels the old request.

## Asset codec API

`MintImageAssets.createCodec({ overlay, digest? })` returns a frozen object:

- `validate(record)` -> frozen canonical structural record; synchronous, does not claim cryptographic verification.
- `validateTable(records)` -> frozen strict dense array of frozen records; synchronous, rejects conflicting duplicate IDs and cumulative per-photo limits. Identical duplicates are preserved and count toward limits.
- `toOverlayAsset(record)` -> frozen `{version:1,width,height,data}` accepted by the original compositor.
- `toRaw(record)` -> fresh `{width,height,data:Uint8ClampedArray}`; canonical validation plus copied bytes, synchronous.
- `identityBytes({width,height,data})` -> fresh `Uint8Array`, synchronous.
- `createAsset({width,height,data})` -> Promise of a frozen content-addressed record. Captures/copies the input before the first await.
- `verify(record)` -> Promise of a frozen record, rejecting any dimension/pixel hash mismatch. Captures canonical strings and bytes before the first await.
- `fromRaw({id,width,height,data})` -> Promise of a frozen record, rejecting any claimed-ID mismatch. It is intentionally asynchronous, not a trusted synchronous reconstruction shortcut.

The EXACT record is `{id,version:1,width,height,data}`. `data` is canonical RGBA8 base64. There are no names, URIs, paths, encoded originals, or metadata fields. Identity is:

`rgba-` + lowercase SHA-256 of UTF-8 `mint-rgba-asset-v1\0`, uint32LE width, uint32LE height, raw straight RGBA bytes, concatenated in that order.

SHA-256 uses official Node crypto or browser WebCrypto, never a handwritten hash. Optional `digest(bytes)` is a trusted test/project hook returning canonical lowercase 64-hex or a local fixed native Uint8Array of exactly 32 bytes. A Node Buffer result must be copied to Uint8Array by the injector. Invalid options, getter-bearing records, typed subclasses, shadowed binary accessors, detached/shared/resizable buffers, malformed base64 and conflicting IDs are rejected. All base64 conversion delegates to the frozen compositor; no encoding/compositing algorithm is duplicated.

`LIMITS` is frozen: 1024 edge, 1,048,576 asset pixels, 4,194,304 raw bytes; 16 records and 32 MiB raw-equivalent per photo. Advertised session ceilings are 128 records / 64 MiB, enforced by the owning application, not this stateless per-photo codec.

IMPORTANT TRUST BOUNDARY: `validate` and `toRaw` only establish canonical structure. Trusted project load/main boundaries MUST use `verify`/`fromRaw` or independently hash `identityBytes` before accepting renderer/project identities. The import service ignores claimed identities entirely and computes the ID in main from captured worker RGBA.

## Native import service API

`createImageImportService({dialog,getWindow,codec,inspectImage,workerFactory?,workerPath?,timeoutMs?})`

Required dependencies are trusted main-owned Electron dialog/window access, a created codec, and `Project.inspectImage`. Test injection `workerFactory(file, options)` follows the ordinary Worker constructor shape; default is `new Worker(...)`. The default worker path is adjacent `image-import-worker.cjs`. Timeout defaults to 90 seconds and may only be reduced.

- `importImage({requestId,sourceRevision})` -> Promise of `{requestId,sourceRevision,asset,label,details}`.
- Each identifier is a bounded 1–200 character ASCII identifier starting alphanumeric and thereafter allowing alphanumerics, `_`, `.`, `:`, `-`.
- `null` means the native chooser was cancelled before a file was selected.
- `cancel(requestId?)` -> boolean. Omitting the ID cancels the current request; an unmatched ID does nothing.
- `isBusy()` -> boolean.
- `dispose()` permanently closes the service and cancels its current request.

`label` is a separately normalized, control/bidi-stripped basename, at most 120 code units. It never enters the asset identity/record. `details` contains EXACTLY:

`{encodedWidth,encodedHeight,sourceWidth,sourceHeight,resized,orientationApplied,color:'8-bit sRGB',alpha:'straight',metadataPreserved:false}`

`sourceWidth/sourceHeight` are oriented input dimensions; `encodedWidth/encodedHeight` are encoded dimensions. Width/height on `asset` are the bounded working dimensions. Downsize applies ONLY to the imported overlay. Main photo bytes/dimensions are never touched.

Errors have `IMAGE_IMPORT_*` codes and safe fixed messages. Post-selection cancellation rejects `IMAGE_IMPORT_CANCELLED` with name `AbortError`; malformed decode is `IMAGE_IMPORT_DECODE`, animation `IMAGE_IMPORT_ANIMATED`, budgets `IMAGE_IMPORT_LIMIT`, timeout `IMAGE_IMPORT_TIMEOUT`, closed service `IMAGE_IMPORT_CLOSED`. Stale results are never returned.

### Native safety envelope

- No exported path-reading API and no renderer-supplied source path. Only the result of the injected main-owned chooser is opened.
- Bounded regular-file read: pre-open lstat, no-follow/non-blocking open when supported, opened-handle identity match, exact-size chunked reads plus EOF probe, post-read identity/size/mtime/ctime check. Symlink leaves, replacement, growth and truncation fail closed.
- 32 MiB encoded ceiling, 8192 input edge, 24,000,000 input pixels checked from bounded headers before Sharp metadata or decode. Worker repeats the checks independently.
- JPEG/PNG/WebP only, single page. APNG acTL/fcTL/fdAT, animated WebP flags/chunks, multiple WebP frames, JPEG MPO and concatenated image payloads are rejected before decoding.
- PNG chunk lengths/types/CRC and exact IEND are checked. JPEG full marker framing/EOI and WebP RIFF/payload geometry are checked. Truncation and unsupported native warnings fail closed.
- PNG unknown/text ancillary chunks are dropped before native metadata parsing; ICC inflation is bounded to 1 MiB, EXIF/profile bytes are bounded. Supported profile/orientation/color chunks are preserved for normalization.
- EXIF orientation is applied. Tagged inputs transform to sRGB; untagged inputs use Sharp's normal source interpretation, followed by explicit sRGB and unsigned 8-bit RGBA. This avoids Sharp 0.35.5's forced-ICC color shift on untagged rgb16 PNG.
- Lanczos downsize preserves aspect subject to integer pixel rounding, never enlarges, and never exceeds 1024 edge / 1 Mi pixel. Sharp internally premultiplies during resampling and returns straight RGBA; its `info.premultiplied` flag means the operation used premultiplication, not that returned bytes are premultiplied.
- Worker output consists solely of bounded raw RGBA and fixed scalar details. EXIF/XMP/ICC payloads and encoded source bytes are not returned, embedded, or persisted.
- Cancellation, superseding imports, timeout and quit call worker termination. Main checks job freshness after every await and computes asset identity only after strict worker-envelope validation.

## Tests and reproducible evidence

Run in this workspace:

`node --test assets/tests/*.test.cjs`

from the candidate root, or invoke the absolute test paths. Tests resolve the approved source checkout and frozen mobile compositor via the paths at the top of each file; no dependency installation is performed. Test-only native worker staging is confined to this candidate and removed afterward.

The focused suite is **23/23 passing**. Coverage includes canonical/hash dimensions and sync capture, strict records/buffers/tables, browser WebCrypto parity, real PNG/JPEG/WebP, transparent alpha, EXIF-oriented JPEG, real 16-bit PNG, Display P3 conversion, actual Sharp-generated oversize files, APNG and animated WebP pre-decode rejection, truncated/corrupt files, metadata bombs, a real worker, worker envelope forgeries, stale/cancel/replacement/timeout/quit, and filesystem replacement/growth races.

`tests/build-evidence.cjs` regenerates `evidence/` using only synthetic gradients/checkerboards. Evidence includes source PNG (1600×900 with ICC metadata), decoded/reconstructed working PNG (1024×576), `synthetic-decode.json` with content identities/digests, and `tests.tap`. The reconstructed PNG has no EXIF, XMP or ICC payload. The frozen mobile compositor SHA-256 remains `800751bc88f2539e51f742d57fe6287b44c2c2c8c74f958d297cf878790d579c`.

Not tested here: Electron IPC/dialog execution, UI Apply/Undo behavior, integration into project v16/export, operating-system native picker behavior, or user photos. Those remain the owner's integration work.
