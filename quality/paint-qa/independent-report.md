# Desktop paint UI: independent cloud audit

## Result

52/52 focused tests pass, with zero skips, against the current candidate production-source application functions. The installed NativeCanvas package is mandatory; missing it fails the suite. A separate synthetic sample passes its assertions and produces small reviewable PNG evidence. No production file was edited by this audit. This is a development candidate, not a feature in the previously delivered 0.2.5 installer.

Run from the desktop source directory:

- `node --test tests/paint-ui-independent.test.cjs`
- `node quality/paint-qa/independent-sample.cjs`

The exact output is in `independent-test-output.txt`. `independent-sample-manifest.json` records evidence hashes, production-file hashes, dimensions and checks. Regenerate both after any relevant code change.

## Meaningful verification

- Real viewport/control event listeners create a single undo entry per released stroke. Draft strokes never enter project settings, accepted-image pixels, export overlay or history. Source canvas and original encoded bytes stay unchanged.
- Exact opaque paint interiors and source-over opacity are checked. Erasing the upper magenta layer reveals the independent green lower layer. Source pixels and the lower-layer recipe are unchanged; undo/redo restores the exact pixel arrays.
- Pointer cancellation, lost capture, Escape, blur, pagehide, original/compare/reference views, unrelated edit, undo, source Blob/revision change, photo/tool/control changes and multi-pointer interruption discard draft state. Loss of capture does not simulate physical release; replacement contacts stay suppressed until all original contacts really release, including window-level release.
- Right-click, outside-image and pending/stale frames cannot authorize painting. Diagnostic overlays and held-original views cannot authorize painting or picking. Eyedropper samples the accepted processed image only, rejects transparent padding, and does not mutate image settings or history.
- Existing layers retain their frozen selection snapshots for both painting and erasing when the current selection changes. The snapshot checkbox is locked. Explicit new-layer creation captures the current selection, verified with opposing left/right masks and actual pixels.
- Layer order, visibility, remove, clear and undo have tested pixel consequences. Fifth-layer, 129th-stroke and aggregate 8193rd-point attempts do not enter history. Actual pointer events cap one stroke at 1024 points. Invalid controls reject before draft creation. A 24 MP original cannot evade the paint limit via a small final-resize request.
- Late canceled raster work and late completed composites cannot replace a newer accepted image or contaminate its cache. Changing immutable source Blob identity prevents reuse of a previous raster cache.
- Source-editing/original inspection excludes final paint; returning restores the painted image without editing history.
- Built-in/named presets and synchronization preserve each target's own paint rather than copying source-bound paint between photos.
- Schema 12 save/load retains paint and eraser recipes plus undo history, without embedded paint RGBA. Undo after loading reconstructs the earlier paint pixels.
- Real native-worker PNG export receives a separate source/revision/recipe/size-bound `paintOverlay`; uncommitted strokes are absent. Wrong source hash, source revision, recipe hash, dimensions, wrong overlay slot and extra overlays with inactive paint all reject.
- Real batch export produces red and blue output for distinct source-bound target recipes without borrowing the current preview or changing history. PNG pixels exactly match accepted preview for the synthetic opaque fixture.
- Native framing/padding, actual text raster, paint, final opaque redaction and final resize are exercised together. JPEG output flattens transparent padding to white and matches the explicit Sharp reference encoding; output metadata lacks EXIF/XMP.
- A paint-raster failure on the browser-path export writes nothing rather than silently exporting a source-only fallback.

## Evidence

`independent-contact-sheet.png` was visually inspected. It is a labeled synthetic-pixel montage, not a screen capture:

1. Original synthetic gradient.
2. Green lower paint layer.
3. Magenta upper paint layer.
4. Erase only the upper layer, exposing green underneath.
5. Undo restores magenta.
6. Native-worker PNG is pixel-identical to the erased preview.

Individual PNGs are 100 × 80. No private photos, remote APIs, network access or package installations were used.

## Method and limits

The harness reuses only an authored DOM/IPC shell and executes the candidate production-source app.js function/event code. The module import is supplied by an authored pipeline bridge, with real export pixel cores for upstream operations. Paint/text/redaction cores, paint renderer, NativeCanvas draw/read operations, codecs and native export worker/Sharp are real. Cross-realm records are normalized only at that shell boundary. Zero-delay scheduled rendering uses cancellable host timers; the older shell's uncancellable queued-microtask timer behavior would create artificial undo/redo races.

This is not browser layout, actual DOM event propagation, physical pointer/touch-device, Electron GUI, Windows, installer, accessibility or model-inference QA. It does not establish universal cross-platform antialias equivalence. The assertions distinguish opaque/eraser interiors, exact repeated replay in this runtime and known encoding behavior; no universal alpha-error bound is inferred from a single sample. Full application aggregate suites and real Windows interaction remain separate checks owned by the integration task.
