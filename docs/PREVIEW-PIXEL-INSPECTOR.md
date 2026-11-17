# Current-result preview pixel inspector

This is an optional, session-only desktop readout. It is **not image editing**, an original-file eyedropper, RAW/HDR clipping analysis, a second-image sampler, or a new export mode. It does not add a clipping overlay.

## User-facing behavior

- `检查当前结果像素` is an explicit checkbox, off on startup. Its detail panel is hidden while off.
- The scope is labeled `8-bit sRGB PREVIEW`, code values 0–255, with zero-based integer preview x/y coordinates. Coordinates refer to the current final framed preview, including accepted crop/rotation/flip, not original sensor/file coordinates.
- In ordinary pan view, point inside the visible displayed image to see the current photo name, x/y and RGBA. Letterboxing, an image edge's right/bottom boundary, and pointer-captured positions outside the viewport do not sample/clamp to the nearest pixel.
- At A=0, RGB is suppressed as meaningless hidden color. At 0<A<255, RGB is explicitly labeled uncomposited, not blended with the checkerboard. These are Canvas readback values; transparent-edge premultiplication/rounding can differ from source-file channels.
- Endpoint information names only RGB channels at code value 0 and/or 255, reporting both groups when applicable. It does not assert underexposure, overexposure, lost RAW detail, or sensor clipping.
- Readout is suspended and its cached pixels released for original-hold, original/result wipe, reference panes, crop drafts, manual tools, old point repair, matte/local/face/diagnostic inspection, pending/failed rendering and busy work. Returning to a fresh ordinary result can capture one new readback.
- Pointer leave and window blur clear the active coordinate/value display. Pan, zoom, fit and viewport resize refresh its mapping without reading or processing the image again. The output uses `aria-live="off"` to avoid continuous assistive-technology announcements for pointer motion; the labeled toggle and textual value remain available.

## Provenance and lifecycle

The only readback source is `acceptedRender.canvas`. The composed `previewCanvas`, working source, original view, reference snapshot and diagnostic/manual overlays are never read by the inspector. The existing accepted-render capability verifies current photo object, source Blob/input, source revision, render generation, view token, framed display stamp, recipe key, exact canvas identity/dimensions, abort status and pending/failure state.

A full recipe freshness check occurs before capture and after the fallible readback. An accepted render or view that changes during readback discards that candidate. Camera/pointer hot paths use capability identities/generations and the existing immediate render-invalidation contract, **not full recipe serialization**. Settings mutations performed by application handlers invalidate accepted renders immediately; the inspector is not a watcher for unsupported external mutation of a live recipe or canvas bitmap.

`previewPixelCache` contains at most one `{ accepted, image: { width, height, data } }`. It retains the one native `getImageData` array without making another Canvas/ImageData/pixel copy. The previous cache reference is cleared before any new allocation. Both edge lengths are bounded to 1280 and backing storage to 6,553,600 bytes (6.25 MiB). Cache clearing releases references for garbage collection, not a claim of immediate physical memory zeroing.

Readback requests sRGB `rgba-unorm8`. Invalid dimensions/storage or any readback/DOM failure closes the inspector only; ordinary editing continues. Failure is latched against that accepted render so pointer movement and UI refresh do not repeatedly read or toast. Turning the option off then on, a new accepted result, or leaving/reentering a supported view permits a new attempt. No network, inference, image decode or pixel render is started by this option.

The inspector's enabled flag, point, cache and error latch live outside photos/settings. They are excluded from undo/redo, dirty fingerprints, projects, named presets, export settings and original source data. They have no project format/version effect.

## Pure helper API

`src/preview-pixel-inspector.cjs` exports a frozen CommonJS API and browser global `MintPreviewPixelInspector`:

- `LIMITS`: frozen `{ maxEdge: 1280, maxBytes: 6553600 }`.
- `boundedSize(width, height)`: returns `{ width, height, bytes }`; dimensions must be positive integers within the fixed limit.
- `mapPoint(point, imageRect, viewportRect, size)`: accepts exact own-data records `{x,y}`, two `{left,top,width,height}` rectangles, and `{width,height}`. Returns integer `{x,y}` or `null` for a valid coordinate outside either half-open rectangle. It never clamps outside positions. Finite bounded dimensions/coordinates are required.
- `samplePixel(image, x, y)`: accepts exact `{width,height,data}` and integer in-bounds coordinates. Returns `{x,y,r,g,b,a,alphaMode,zeroChannels,fullChannels}`. `alphaMode` is `opaque`, `partial`, or `transparent`; R/G/B values are null at alpha zero and both endpoint arrays are empty. Endpoint channel names are uppercase `R`, `G`, `B`.

Malformed input throws. Ordinary records must have same-realm Object.prototype or null prototype, exactly the expected enumerable own data properties, no accessors/symbol/hidden/extra fields. The RGBA storage must have the native Uint8Array or Uint8ClampedArray prototype. Intrinsic storage accessors avoid invoking shadowed getters/methods and reject proxies, subclasses, detached buffers, SharedArrayBuffer, resizable buffers, wrong byte lengths and oversized backing allocations. Bounded native offset views are allowed. Helpers do not mutate inputs or allocate a second pixel array. Sampling validates storage in constant time and reads four cached bytes, without scanning the full image.

## Verification

Run directly with Node, without npm:

    node --test tests/preview-pixel-inspector.test.cjs tests/preview-pixel-inspector-ui.test.cjs

The authored tests cover pure-helper contracts, 2,000 randomized mapping cases, native ownership and malformed records, real native Skia synthetic pixels and 1280² bounds. The UI tests execute the entire shipped app and its actual checkbox/pointer/wheel/render/lifecycle handlers against authored DOM, Canvas and IPC doubles. They check source decoys, coordinates, transparency, endpoint wording, cache identity/readback count, mode gates, provenance mismatches, source switches/removal, pending/failed/discarded/reentrant outputs, failure recovery and source/history/project/preset/export/dirty invariance. They also exercise the production capture and pointer path against a native Skia accepted canvas.

`@napi-rs/canvas`, already available in this environment, takes a fifth color-space string rather than the browser's ImageDataSettings object. The native UI test adapts only that call signature to `srgb`; it does not change pixel values, production handlers or sampling math. These are real synthetic Canvas pixels, not a browser screenshot or proof of Electron UI acceptance. No browser/server/socket retry, dependency installation, network/model execution, public/user photo or fabricated screenshot is used. Final aggregate-suite/checkpoint verification remains with the parent task.
