# Independent four-corner UI and export audit

Audit date: 2026-10-22 UTC. Candidate: 0.2.9 source only. No installer was built and the 0.2.8 release was not modified by this audit.

## Scope and limitations

`tests/perspective-ui-independent.test.cjs` executes the current production `src/app.js` through the existing authored DOM/IPC shell in `app-harness.cjs`. It does not replace production app functions. The shell uses the already-installed NativeCanvas backend, real project/preset/geometry/paint/redaction/text cores, production preflight, and actual `export-renderer.cjs`/Sharp native exports. Fault-injection wrappers delay the harness renderer or alter returned native export provenance; they do not replace application decisions.

This is not real browser layout, Electron GUI, native-dialog, Windows, GPU, or model-inference acceptance. The canvas-shaped path is the browser-shaped application branch using NativeCanvas encoding, not a browser encoder. The write IPC is a capture stub: tests establish that bytes reached, or were rejected before, the write boundary, not that Windows files were durably saved.

Only local synthetic fixture pixels were used. No network, new dependencies, models, or user computer were accessed.

## Findings

1. Output-basis changes left a stale four-corner draft visible and active at the input handler, while `perspectiveInputReady()` became false. Reproduced via the enabled text basis selector without text layers; equivalent export and image basis handlers were affected. The owning production agent added a shared cancellation/refresh path. All three immediate cancellation, capture release, and committed-pixel restoration regressions now pass.
2. With active perspective and no straighten, native output could claim `details.resampling = 'none'`, an incorrect filter, or no aggregate chain at all, while keeping a valid perspective receipt. The queue accepted and wrote those contradictory results. Three targeted negative regressions reproduce this. The owning production agent added aggregate-chain and processing-scale checks for active perspective. All three negative regressions now pass, and all valid combinations remain accepted.
3. Reset rejection is checked with bound disabled, empty paint and cover layers. It must preserve committed settings/history; if a changed four-corner draft exists, a rejected reset must preserve that draft too. Current regression passes after the owning production agent's guard.

## Behavior coverage

- Actual photo activation and late asynchronous input results cannot transplant corners, accepted pixels, or original comparison cache to another photo.
- Save, undo, redo, pagehide, export opening, and source-tool changes cancel draft/capture without committing four-corner input. Save preserves the committed v17 state rather than numeric draft edits.
- Pointer cancellation and capture loss restore the complete selected-corner gesture. A second pointer cannot move or end the first. Non-finite coordinates, right-click, off-image/off-bounds input, and stale/pending frames cannot begin edits.
- Disabled empty paint/cover bindings still block geometry changes, including reset. Upstream framing, flips and straighten cannot silently move a committed quad; an explicit reset permits later changes.
- Selection, liquify, repair, old point repair and white-balance use source-coordinate views. A real selection brush stroke records source fractions while preserving the committed perspective recipe.
- Four-corner editing uses the post-framing/post-straighten input and excludes old perspective, padding and final overlays. Held-original comparison applies the identical committed geometry.
- Parameter synchronization and a portable color preset preserve each target photo's perspective and undo snapshots.
- Twelve real PNG combinations cover native and canvas-shaped paths with 0°, 90° and 13° straighten, each with and without final output resize. Output dimensions, receipt bindings, retained chain and actual decoded pixels are checked.
- Same-sized altered quads in both receipt copies, missing details, incorrect processing dimensions and extra neutral receipts fail before the write IPC.
- Actual final text, paint and cover remain on the final canvas after perspective. Preview pixels and native decoded PNG pixels match independently ordered core composition, including exact opaque paint/cover probes.

## Pixel oracle details

Native Sharp PNG output is compared exactly to the pure core geometry output when final resize is absent. When resized, an independently prepared final composition is downsampled with Sharp Lanczos3 or a separate NativeCanvas high-quality draw as appropriate; all twelve combinations pass exact decoded-pixel equality. NativeCanvas stores premultiplied pixels internally, so partially transparent oblique boundaries are compared against an independently allocated NativeCanvas put/get round trip of the pure core output. No arbitrary tolerance is used and no native-canvas equality is misrepresented as browser equality. Opaque output and the final-overlay fixture are exact byte comparisons.

## Evidence

- `ui-independent-results.tap`: latest full executable result.
- `ui-independent-final-overlays-native.png`: actual native PNG export of the synthetic fixture, not a screenshot. It visibly contains unwarped final-canvas text, red paint and blue cover.
- `ui-independent-final-overlays-manifest.json`: recipe, source/final pixel hashes, PNG hash, explicit probes, dimensions and perspective receipt.
- Shared core SHA-256: `3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557`.

Reproduce from the source root:

    node --test --test-reporter=tap tests/perspective-ui-independent.test.cjs

Final result: 59 tests, 59 passing, 0 failing, 0 cancelled, 0 skipped. Latest runtime: 5153.792126 ms. No packaging bytes were inspected or changed.

Exact final source/test/log hashes are recorded in `ui-independent-audit-manifest.json`.
