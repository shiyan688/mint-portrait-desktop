# Renderer-owned text raster orchestration

`src/text-layer-renderer.cjs` exposes the frozen UMD API `MintTextLayerRenderer` in a browser and `module.exports` in Node. It orchestrates the existing `MintTextOverlay` renderer and `MintTextLayers` validator/compositor. It does not load fonts, decode photographs, access paths or URLs, create export tokens, or authorize a native export.

## Construction and API

```js
const helper = MintTextLayerRenderer.create({
  document, crypto,
  textCore: MintTextOverlay,
  layersCore: MintTextLayers
});

const raster = await helper.raster({
  layers, width: finalWidth, height: finalHeight,
  signal, isCurrent: () => currentRevision === capturedRevision
});

const preview = helper.compositePreview(acceptedBaseCanvas, raster, {
  signal, isCurrent: () => currentRevision === capturedRevision
});

const recipeHash = await helper.hashBytes(
  new TextEncoder().encode(MintTextLayers.canonicalRecipe(layers)),
  { signal, isCurrent }
);

const envelope = await helper.envelope({
  requestId, sourceRevision, sourceBytes: originalEncodedBytes,
  layers, width: finalWidth, height: finalHeight,
  mode: 'original', // Or explicitly 'working'. Never an implicit fallback.
  signal, isCurrent,
  preparedRaster: raster,
  preparedRecipeHash: recipeHash
});
```

In the browser, omitted dependencies default to the corresponding globals. In Node tests pass the dependencies explicitly. Optional cancellation properties may be omitted or `undefined`.

- `raster({layers,width,height,signal?,isCurrent?})` is asynchronous. It returns `null` for a validated inactive layer collection, otherwise a fresh frozen record `{width,height,rgba:Uint8Array}`. It validates the collection and dimensions before creating any Canvas, snapshots recipes, waits for the local document's existing `fonts.ready`, and renders enabled active layers in their stored order onto **one** fresh transparent final-size Canvas. The Canvas is disposed before returning owned RGBA bytes.
- `envelope({...})` is asynchronous. Active text returns exactly `{version:1,requestId,sourceRevision,sourceHash,recipeHash,mode,width,height,rgba}`. Inactive text returns `null` without any Canvas, font wait or hash work. `sourceHash` is SHA-256 of the original encoded source file bytes, not decoded pixels, a preview or a text PNG. `recipeHash` is SHA-256 of UTF-8 `MintTextLayers.canonicalRecipe(validatedLayers)`.
- `preparedRaster` and `preparedRecipeHash` are optional **together**. The helper validates the exact three-field raster shape, dimensions and byte storage; takes an owned copy synchronously; hashes the canonical current recipe; and rejects a mismatching supplied recipe hash. Successful reuse never remeasures or repaints. When omitted, the helper renders once itself.
- `hashBytes(bytes,{signal?,isCurrent?}?)` snapshots fixed byte storage before awaiting SHA-256 and returns a lowercase 64-character hex digest. It accepts ordinary native `Uint8Array`, `Uint8ClampedArray` or fixed `ArrayBuffer`, including a bounded nonzero-offset view. Empty bytes are valid for the generic hash function, but not as the source of an active export envelope.
- `compositePreview(baseCanvas,raster,{signal?,isCurrent?}?)` is synchronous. At equal raster/base dimensions it passes its owned RGBA snapshot directly to `MintTextLayers.composite`, with **no overlay Canvas roundtrip**. Only when dimensions differ does it recreate a disposable overlay Canvas and scale its pixels to the accepted base dimensions with `drawImage` and high-quality smoothing. It reads the accepted base and uses `MintTextLayers.composite` for straight-RGBA source-over, returning a new Canvas without changing or disposing the base. Passing `null` returns the exact base Canvas with no allocation or readback. The caller owns and must dispose a successfully returned new preview Canvas when obsolete.

Returned records are frozen, but JavaScript typed-array elements cannot be frozen. Their byte arrays have fresh ownership and no internal mutable alias. Callers must treat a cached raster as read-only. The optional prepared-raster path takes a further ownership copy before any asynchronous work.

## Association, mode and cache responsibilities

The app must choose the explicit current export mode and final post-framing/post-padding dimensions before rendering text. Preview must scale that raster, not measure the text again at preview dimensions. A useful cache key includes source identity/revision, original source Blob identity, canonical layers, export mode, width and height. Regenerate on any change and do not publish stale work.

Original and working modes can produce slightly different aspect ratios after fractional crop rounding and consequently different wrapping. A change of mode is a change of raster basis, not permission to silently substitute a smaller original export. Generic local system fonts can differ across operating systems; this helper promises no Linux/Windows/macOS glyph or pixel identity.

The recipe hash establishes an **association**, not an attestation that supplied pixels were produced by that recipe. Reusing a prepared raster is for a caller-owned, correctly keyed cache; it is not an untrusted renderer authentication mechanism. The native export boundary must independently validate the envelope, source/recipe/mode/dimension association, its own current request state and the raw buffer before compositing. There is no main-process prepare token or authorization claim here.

Source-view and manual-tool text visibility are app responsibilities. They must not mutate persisted text layers or rewrite the source image.

## Limits and cancellation

The final raster, preview base and temporary surfaces each have a ceiling of **16,000,000 pixels**, **16,384 pixels per edge**, and **64,000,000 raw RGBA bytes**. These are decimal values, not 16 MiPixels/64 MiB. Encoded source/hash inputs are limited to 80 MiB, aligned with the existing source file budget. These are per-buffer/surface bounds, not a claim that peak process memory is 64 MB: compositing owns bounded readbacks and temporary surfaces concurrently.

Typed-array intrinsics inspect the real length, offset and backing buffer. Shared, resizable, detached, wrong-element, subclass/proxy and oversized-backed views fail closed; shadowed metadata getters and iterators are not invoked. Supplied operation/raster records reject accessors, unexpected fields and non-plain prototypes. No raw buffer length is accepted on trust.

`AbortSignal` and `isCurrent()` are checked before and after asynchronous work, before/after every active layer, around readbacks and compositing, and immediately before return. Each layer boundary yields a task so UI cancellation can run. A pending font/digest promise is raced against abort and a 25 ms stale poll when `isCurrent` is provided. Cancellation removes its listener/timer and consumes late host-promise rejections. It cannot preempt one synchronous Canvas/native call mid-call, but that call's result cannot be published once cancellation is observed.

Failures use `TEXT_RENDERER_INVALID` where generated by this helper. Cancellation throws `AbortError` with `TEXT_RENDERER_ABORTED` or `TEXT_RENDERER_STALE`. Underlying font/Canvas/hash errors remain failures rather than silent omissions. All temporary canvases are resized to zero in `finally`, including failed paints/readbacks/composites. The helper never returns partial text or a partially composited preview.

## Focused verification

Run `node --test tests/text-layer-renderer.test.cjs`.

The authored tests exercise inactive exact no-op, strict bounds before allocation, immutable input snapshots, single-canvas/order rendering, optional controls, font waiting, never-settling font cancellation/staleness, late promise rejection handling, hashing of original bytes and canonical recipes, exact envelope fields, prepared raster ownership/rejection, hostile byte storage, preview scaling without remeasurement, exact same-size source-over without overlay readback/scaling, accepted-base immutability, source-over handoff and cleanup on failures/cancellation.

When the already-installed QA-only `@napi-rs/canvas` is present at `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas`, a real Skia test also runs. No package installation, browser process, socket, network, model, external font download or private photo is used. Missing native QA infrastructure is an explicit skip, not a pass.

Native QA registers only preexisting local Noto CJK and DejaVu font files into the QA process, recording their SHA-256 hashes. This registration is **test infrastructure only**, not production font bundling or font loading. A signature-only adapter maps the browser `getImageData` options object to the installed native build's fifth-argument color-space string. Text measurement/rendering, raster scaling, readback and PNG encoding remain real native operations.

The native tests compare the helper's full-size pixels against direct calls to the frozen shared core, independently compute source-over from the real scaled readback, verify the unchanged base, check that overlap order and style changes alter pixels, and verify prepared export byte identity. The same-size native regression compares the result against `MintTextLayers.composite` using the exact unscaled final-export RGBA, followed only by the necessary output Canvas write/read. Another test aborts or supersedes an envelope immediately after a real first-layer draw, verifies that nontransparent pixels were actually produced, and confirms that the second layer and publication never happen. Latin, CJK, explicit multiline, outlines, shadows, partial opacity and rotation appear in actual synthetic PNGs. Canvas premultiplied storage and `drawImage` filtering can change low-alpha bytes even at unit scale, so the equal-dimension path deliberately avoids that unnecessary overlay roundtrip. Different-dimension preview assertions retain the real native scaling/readback oracle.

Each native run writes `full-overlay.png`, `same-basis-preview.png`, `reversed-order.png`, `full-composite.png` and `evidence.json` to a unique `mint-text-raster-native-*` directory under the operating-system temporary directory, printed in test diagnostics. The report records package version, font identities, image dimensions, hashes and assertions. Evidence is synthetic native **Linux Skia raster QA**, not an Electron/browser screenshot, Windows acceptance, an installed-app run, or cross-OS font acceptance.

Focused verification after the same-size preview fix on 2026-10-22: 23 tests passed, 0 failed, 0 skipped using installed native Canvas 0.1.100. The actual 333×222 PNG was visually inspected and contained readable Latin/CJK text, outlines/shadows, rotated partial-opacity layers and overlap order. App/IPC/project/export integration is verified separately by their owners; this focused result alone is not full-product acceptance.
