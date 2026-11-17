# Independent desktop editable-text QA

Date: 2026-10-22. This is cloud-source QA, not Windows installer acceptance.

## What executed

`tests/text-independent.test.cjs` executes the shipped `src/app.js` functions against an authored DOM/IPC shell extracted from `tests/text-ui.test.cjs`. The shell's one-pixel authored text raster is removed. The real `text-overlay.cjs`, `text-layers.cjs`, and `text-layer-renderer.cjs` execute with native Canvas measurements, drawing, readback, scaling and fonts. Native export cases run the actual `createExportRenderer` / worker / Sharp PNG encoder and decode the resulting file. The preview pipeline adapter uses the shipped export pixel core for non-text operations; this is not the browser `pipeline.js` worker or Electron renderer.

QA-only `quality/text-qa/native-support.cjs` resolves already-installed `@napi-rs/canvas` 0.1.100. It adapts only its `getImageData` fifth-argument signature from the browser options dictionary to the native color-space string, plus DOM-element/native-canvas unwrapping. Existing Noto Sans/Serif CJK and DejaVu Sans Mono files are explicitly registered under generic family names for reproducible Linux evidence. Font file SHA-256s and the resolved native package path/version are in `quality/text-qa/app-evidence.json`. No font, dependency, model, photo or API was downloaded; nothing was added to production dependencies/runtime packaging. The test skips native cases if the existing optional package is unavailable.

## Coverage

- Draft editing and Cancel leave source pixels, source bytes, committed settings, revision, undo/redo, cached raster and accepted preview unchanged. Project save excludes uncommitted text.
- A pending font wait cannot publish cache/accepted pixels after switching photo.
- An asynchronous composite is published atomically only while its operation is current; a late superseded result cannot replace a newer accepted canvas.
- Failure during the second real text-layer draw publishes neither partial raster nor an accepted preview.
- Cache reuse requires Blob identity, source revision, canonical layers, final dimensions and export mode. Tone-only changes reuse the same full raster; recipe/source/mode changes invalidate it. Returning to a previous basis rerasterizes because only one cache entry exists.
- Native export consumes the accepted full-size raster without another font layout when the basis matches. Even equal-size `original` and `working` modes are distinct bases and cannot reuse a previous prepared raster.
- Cancellation during font wait and during cached recipe hashing settles without native submission or writing a file. Late rejected font readiness is consumed safely.
- Page teardown invalidates pending preview/font work and export preparation. Regressions retain both previously observed failures.
- Compare-original preserves crop/rotation/padding but omits text. Manual selection view uses original source coordinates, omits crop/padding/text, and returns to the same text result in pan mode.
- A >16MP final canvas fails before font readiness or allocation. Tiny views over >64,000,000-byte or resizable backing storage are rejected by both native request validation and composition. >80MiB source backing storage is rejected by the renderer hash path.

## Native PNG evidence

`quality/text-qa/app-native-final.png` was exported through the shipped app's `startExport` → real renderer envelope → actual native worker. The authored source is a 900×640 opaque gradient, not a user photograph. Integer crop, quarter-turn rotation, horizontal flip and opaque padding produce 614×840 output. Four editable text layers exercise Chinese/Latin, explicit multiline, sans/serif/mono, fill colors, outline, shadow, opacity, italic, rotation and overlapping layer order. Visual review confirmed the Chinese glyphs and Latin lines are present and distinct. `app-source.png`, `app-overlay.png` and `app-accepted-preview.png` are included alongside it.

The decoded exported RGBA SHA-256 equals both the authoritative composition and a separate scalar straight-sRGB source-over calculation. Source pixels, encoded source SHA and settings remain unchanged. The app performs four text draws in one raster request, then reuses that exact RGBA for its native export. Full hashes, dimensions, byte count and recipe are recorded in `app-evidence.json`.

Preview and export use the same full-size text raster and layout. QA found an unnecessary unit-scale `drawImage` step changed filtered low-alpha edge values in NativeCanvas. The helper owner removed that avoidable resampling: exact same-size composition now uses the owned RGBA directly. In this opaque 614×840 fixture, accepted preview, authoritative native composition, independent scalar composition and decoded PNG now have the same RGBA SHA-256, with zero differing channels. A separate 800×640-final / 100×80-preview test verifies actual app downscaling against a separate native pixel-scaling plus scalar source-over oracle without another text layout. This conditional same-size result is **not** a general preview/export or cross-platform pixel-equality guarantee; scaling, alpha roundtrips, codecs and system fonts can differ.

## Explicit full-final-canvas padding placement

`quality/text-qa/padding-placement-final.png` and its overlay/evidence prove text is not clipped to the original content rectangle. A 520×400 synthetic source receives 120px bottom padding, producing 520×520 output. The sole line “留白 MINT” is intentionally placed at normalized `(0.5, 0.95)`, anchor `(260, 494)`. Its measured box extends y=480.543–507 and actual glyph ink y=481–500, entirely inside padding y=400–519 and away from final-canvas edges. All 1,010 nonzero overlay pixels change exported padding pixels; zero content pixels change. The app raster exactly equals a direct shared-core draw at those unaltered coordinates, proving no automatic relocation. Actual native PNG pixels equal independent scalar source-over and accepted preview. The decoded RGBA SHA is `26aa792ed8dae4be21fa91ddda76fd50e43e7fdcd86b939e3d0d34ae8213c979`.

The first typography fixture deliberately uses footer anchor y=0.9 of the complete 840px final canvas, not of its inner source image. Its actual footer ink spans y=729–778 while the source-content region ends just before y=779, so the line happens to meet the content/border boundary visually. That proximity is placement, not source-content clipping or a hidden safe-area rule. The separate padding-only fixture makes this distinction unambiguous.

## Issues found and resolved during QA

1. Cached export recipe hashing omitted `signal` / `isCurrent`. A stalled digest could keep Cancel waiting indefinitely. The app owner added both controls; the independent regression confirms prompt cancellation with a never-settling digest and an existing cached raster.
2. The previous `pagehide` handler cleared the cache but left font-wait rendering live, allowing late accepted preview/cache publication. It also left export preparation live, allowing native export submission after teardown. Both failures were reproduced in shipped handlers and retained as regressions. The app owner added a terminal disposal gate, invalidated preview generation, aborted render/export controllers and canceled queued export work; both regressions pass.
3. Same-size preview resampled an already final-size raster, creating avoidable alpha-edge changes. The helper owner now directly composites owned RGBA at matching dimensions; independent accepted-preview/native-PNG/scalar hashes match for the opaque fixture.
4. Budget review by the app owner found native/pure checks bounded the typed view but not its backing allocation or resizability. Independent oversized/resizable-view regressions exercise the hardened contract.

## Limits of this evidence

- No live browser, local server, Electron contextBridge/IPC transport, graphical dialog, keyboard/IME, pointer capture, accessibility layout or actual screen acceptance was run here.
- Linux NativeCanvas with explicitly registered installed Linux fonts is not Windows Chromium font fallback. Windows generic fonts, emoji fallback, line-break differences across machines, display scaling and the packaged installer remain unverified.
- The per-raster 16MP / 64,000,000-byte ceiling is validated, not a claim that total native process memory is 64MB. Copies/Canvas surfaces/encoded source/preview/native worker can coexist. Maximum-size native peak memory and responsiveness were not profiled.
- Source/recipe/request/revision/mode/dimension hashes bind associations and reject stale/mismatched envelopes. They do not cryptographically attest glyph rendering, and there is no implemented one-time main-process prepared-raster token.
- This QA does not reinstate earlier PNG-overlay/token route proposals: the implementation transfers an exact-size bounded RGBA envelope.

## Reproduce

Run `node --test tests/text-independent.test.cjs`, then `node --test tests/text-*.test.cjs`. This directly uses the repository's test runner; it does not install packages or start a browser/server. Generated evidence stays under `quality/text-qa/`. The final focused-run result and source fingerprints are recorded there.

## Final verified result

- Independent suite: 16 passed, 0 failed, 0 skipped.
- All `tests/text-*.test.cjs`: 101 passed, 0 failed, 0 skipped.
- Frozen text renderer SHA-256: `51c762e4fd54280c22e12a8edb608f354edd1a3b1f680390595b1eead9967687`.
- Exact app/core/test file hashes are in `quality/text-qa/final-verification.json`; command logs are `independent-suite.log` and `focused-suite.log`. These are focused results, not a claim of full application or Windows acceptance.
