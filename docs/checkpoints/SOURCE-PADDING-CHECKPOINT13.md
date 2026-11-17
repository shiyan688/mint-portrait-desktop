# Desktop source checkpoint 13: reversible border and canvas padding

2026-10-22. This is an UNRELEASED source increment after the delivered development 0.2.3. No new installer was built or delivered for this increment. Existing online/offline 0.2.3 Library v3 and stable 0.1.1 artifacts remain unchanged. Previous delivery details are preserved in docs/checkpoints/SOURCE-RECOVERY-CHECKPOINT12.md.

## Implemented

The desktop right rail now has 边框与留白: four independent short-edge percentages, color, opacity, Apply, Cancel and Reset. Pending form values are not edits and do not enter project save, recovery, history or export until Apply. Applying/resetting is undoable, and photo/revision changes discard stale form state. Portable presets and batch adjustment synchronization preserve each photo's framing and padding rather than copying it implicitly.

Rendering is existing image effects → non-destructive crop/quarter-turn/flip → canvas padding → encoder. Padding never resizes the image content. It copies original RGBA bytes into an expanded canvas; PNG export alone removes hidden RGB where alpha is zero. Manual masks, strokes, landmarks and healing donor coordinates remain attached to the immutable source. Source-coordinate editing temporarily hides final framing/padding. Crop overlay and pointer mapping subtract border offsets correctly under all quarter-turns and flips.

Shared canvas-padding.cjs is byte-identical to the mobile frozen core, SHA256 91412cfaefd331c6fc5fffb8f9f58256dd25eb6306de6511cdec1cd2a2deb995. This does not make desktop and mobile project formats interchangeable.

Preview display remains bounded to longest edge 1280 after padding. Original/held-original comparison has identical framing and border. Reference/readout caches retain their existing limits. This display reduction does not alter original/native export dimensions: a real native 1280×960 source was exported to 2240×1920 with 480 pixels on all four sides, and every original source row was byte-exact at offset (480,480). No automatic export downscale is introduced.

## Persistence, budgets and compatibility

Project schema is now version 8 and reads versions 1–7. All current, committed, undo, redo and non-null exported settings explicitly include canvasPadding. Old files migrate missing padding to null. Malformed or missing version-8 fields fail closed, including correctly rehashed hostile containers. Delivered development 0.2.3 only reads through version 7 and cannot reopen future version-8 projects; do not overwrite a needed rollback copy.

Original source budgets still apply before crop and padding: 64,000,000 pixels / 16384 edge for ordinary native color, and 16 MP for complex portrait/manual/background effects. Final native output is independently checked against 64,000,000 pixels / 16384 edge. The working-size path remains explicit. Interactive full padded raster is capped at 16,777,216 pixels before allocation and then display-bounded to 1280. Border growth does not grant permission to bypass input limits or silently rescale to fit.

## Verification

Final aggregate: 1896/1896 passed, no failed, skipped or cancelled tests. Run: node --test --test-concurrency=2 tests/*.test.cjs tests/manual-qa/*.test.cjs. Log: checkpoints/padding-full-final.log. The independent padding audit's 51 cases are an included subset, with 600 seeded pixel-oracle comparisons. A separate reference regression rerun passed 71/71 after adapting its oversized-snapshot negative fixture to the intentional new display-only bounding, without relaxing the reference capture safety limit.

Actual Sharp worker PNG and JPEG files, independent decoded pixel oracles, dimensions and hashes are in quality/padding-qa. Production and evidence hashes were checked after the final aggregate. DOM/Canvas/IPC tests are authored cloud harnesses, not a real browser or Windows session. Real Electron interaction, Windows install/uninstall, platform fonts and RTX 4060 performance remain unverified.

## Scope boundaries

This is conventional reversible geometry, not SOTA retouch. Full PixelCake/Xingtu equivalence, learned blemish repair, RAW/16-bit color, arbitrary rotation/perspective and accepted matting quality remain unfinished. All 103 whole coverage work packages remain unaccepted; individual tested increments are recorded separately. Text is only a route assessment in this checkpoint, not an implemented desktop tool.

No new dependencies, remote fonts, models, credentials, private-photo transmission, paid APIs, publication, security bypass or user-computer access occurred. This source archive is private; retained factual NASA QA fixtures are not application assets, model training, endorsement or public marketing material. Production packaging continues to exclude tests and quality evidence.

Restore this overlay over Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies, model weights and executables are excluded. CHECKPOINT-FILES.json contains every retained file hash except itself. Historical evidence applies only to its recorded source hashes.
