# Independent desktop geometry and export-guard review

Date: 2026-10-22 UTC
Scope: the shared integer crop/quarter-turn/output-axis-flip core, desktop final-framing integration, project snapshots, source-worker scheduling, and native Sharp export. This is a source/runtime test report, not a browser or Windows acceptance report.

## Result

- Added `tests/geometry-independent.test.cjs`: **43/43 passed**, 0 failed, skipped, cancelled, or todo.
- Related non-UI regression run: **113/113 passed**, 0 failed, skipped, cancelled, or todo.
- Two concrete defects were independently reproduced, reported before writing production code, fixed by the implementation owners, and retested without weakening the assertions.
- This reviewer changed only the new test file and this report. No production edits, installations, new models, photo uploads, or network-dependent test inputs were used.

## Defects found and verified fixed

### 1. Missing mandatory fields could invoke inherited accessors

Before the fix, in an isolated VM, give `Object.prototype.quarterTurns` a getter returning `1`, delete the recipe's own `quarterTurns`, and call `MintGeometry.validate(recipe)`. Validation succeeded and executed the inherited getter. Equivalent missing crop/image/point fields were also vulnerable. An inherited `shouldCancel` getter was consulted even when the options object had no own callback.

Expected: missing mandatory own fields are rejected before inherited accessors can execute; absent optional callbacks are not read from a prototype.

Verified fix: geometry records now require their mandatory own fields, and cancellation options resolve only an own callback. The suite separately covers recipe, crop, image, and point fields, plus the absent optional cancellation callback. All getter read counters remain zero.

### 2. Native renderer trusted false result-plan metadata and stale encoded dimensions

Before the fix, a request for a 7×3 PNG with a clockwise quarter turn planned a 3×7 output. An injected worker returned envelope width/height 3×7, the original 7×3 PNG bytes, `processingWidth/Height=999`, `originalWidth/Height=999`, `scaled=true`, and `framed=false`. `render()` resolved successfully with those false claims and the stale image.

Expected: reject all mismatched plan fields and encoded output dimensions before allowing the result to reach the write stage; release the worker after failure.

Verified fix: all eight plan fields are checked (`width`, `height`, `processingWidth`, `processingHeight`, `originalWidth`, `originalHeight`, `scaled`, `framed`), and PNG/JPEG header dimensions/format are checked. Each metadata field is forged in a separate regression. Separate tests cover stale PNG dimensions with an otherwise correct envelope, mismatched JPEG dimensions, wrong format, empty output, and truncated headers. Every rejection releases its worker and exposes no successful result.

The boundary guard checks the encoded header, not a second full image decode. Successful actual export bytes are independently decoded with Sharp in the pixel tests below.

## Independent coverage

### Pixel and geometry correctness

- Expected pixels come from a separately written array-of-rows oracle: crop rows/columns, repeated matrix rotation, row reversal, and row-order reversal. The oracle does not call `MintGeometry.plan` or `MintGeometry.apply`.
- 384 pure-core combinations cover six source sizes, four boundary/ordinary crops, all four turns, and both output-axis flips. Includes 1×1, 1×9, 8×1, and non-square sources.
- Half-pixel crop boundaries verify rounding of both edges rather than independently rounding the extent. Near-boundary values and a forced 1-pixel retained crop are exercised.
- Pixel-center mappings match independently labeled source pixels. Closed pixel-edge corners and fractional positions round-trip. Points outside a retained crop/output are not mapped to a valid retained pixel.
- Pixel worker source is executed in isolated Node VM contexts for all sixteen non-square crop/turn/flip combinations. This is not a real browser-worker test.
- Actual native worker threads produce 48 PNG outputs across all sixteen combinations on 11×7, 1×9, and 8×1 sources. Every output is decoded by Sharp and compared byte-for-byte with the independent oracle, allowing only the documented output-only hidden-RGB sanitization at alpha zero.
- Explicit 4103×13 working-size export resizes to 4096×13 before independent integer framing; original mode remains unscaled. `scaled` and `framed` retain distinct meanings.
- Actual JPEG output has the planned dimensions, opaque near-white flattening at previously transparent pixels, no EXIF/orientation, and unchanged source bytes.

### Source, alpha, and selected-region preservation

- Identity and nonidentity core operations return separate pixel storage and do not mutate the source.
- Raw alpha values and hidden RGB copy exactly through pure geometry, including alpha 0, 1, 17, 127, 254, and 255.
- A real lasso-selected local edit runs in original coordinates before framing. Unselected pixels and every alpha value are verified unchanged before framing; more than 500 protected pixels and more than 50 visibly changed selected pixels are asserted.
- Core, pixel-worker source, and actual native PNG match the independently transformed edited image.
- Original compressed bytes, source RGBA, settings, selection, and framing recipes remain unchanged.

### Validation and budgets

- Rejects own accessors, hidden/symbol fields, custom prototypes, malformed/nonfinite recipes, wrong binary element types/lengths, detached buffers, and shared memory.
- Exact offset RGBA views are accepted without reading outside their view.
- Metadata planning rejects over-edge and over-budget sources before considering the tiny crop.
- Pixel application cannot use a tiny crop to bypass its source allocation budget.
- Every native 16MP complex-effect class is tested independently: all face-effect keys, spots, background, learned matte, manual liquify, repair, and selected local layers.
- Both native original and explicit working modes reject source inputs above 64,000,000 pixels or the 16,384 edge limit before framing. Exactly 8000×8000 basic original processing remains eligible and is not described as scaled merely because it is cropped.
- A forged oversized PNG source header is rejected before any native worker is constructed.

### Lifecycle, stale output, and project state

- Pre-allocation, 16-row boundary, and final core cancellation never return partial results or change source pixels. Throwing cancellation callbacks also leave source data intact.
- Native cancellation waits for termination before releasing capacity. Late success cannot override cancellation or settle a new job. Worker errors and premature exits release capacity.
- A real native framed job is cancelled, verifies its source bytes remain attached/unchanged, and is followed by a successful new framed job.
- Source scheduler rejects old unframed dimensions and wrong RGBA byte counts, terminates failed workers, and drains queued work. A queued framing recipe is snapshotted before caller mutation.
- Explicit `sourceView` and `manualEditing` use unframed source dimensions without changing the saved framing recipe. Missing geometry and pre-aborted work allocate no worker/source copy.
- Every project settings snapshot is validated independently: current, committed, undo, redo, and exported settings. Invalid framing is rejected on both encode and decode, including otherwise-unused redo/exported snapshots.
- Restored framing snapshots do not alias each other. Valid v4 source bytes and all history snapshots migrate to v5 with `framing:null`. Missing geometry validation fails closed for active framing.

## Commands and environment

Node `v24.19.0`; Sharp `0.35.5`.

```sh
node --test tests/geometry-independent.test.cjs
# 43 passed, 0 failed; approximately 5.2 seconds

node --test \
  tests/geometry-independent.test.cjs \
  tests/geometry-integration.test.cjs \
  tests/geometry-browser-pipeline.test.cjs \
  tests/export-renderer.test.cjs \
  tests/audit-pipeline.test.cjs \
  tests/project-document.test.cjs \
  tests/advanced-tone-integration.test.cjs
# 113 passed, 0 failed; approximately 5.1 seconds
```

The related run also retains existing actual 24MP unscaled export, EXIF6 orientation, learned-mask-size checks, all v1–v4 project migrations, and advanced-tone integration. This is a focused regression run, not a claim that the entire repository's aggregate tests were run by this reviewer.

Reviewed file SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `src/geometry.cjs` | `c8a0dc83278229ed9b07978801afe3a1a835eb505415ffc91e937a51d77590ba` |
| `export-renderer.cjs` | `7fccb76059f9108b70fe025c0b14ec3d1832b2c40000bdbedc2ad4857c6781c3` |
| `export-render-core.cjs` | `7f107573b1c9e538044a4eafdd3548371eb3adc96f971ead9e2996099e94bc9c` |
| `export-render-worker.cjs` | `e2df68c1e6e8ccb7d3fd5d03fdb75676be411a0a45fb192c06d70f065fe0334d` |
| `src/pipeline.js` | `3ecd17acdf8a789c7816a7d2e1bcc27cd062d7b3f40cbb47c5cb24739a69863f` |
| `src/project-document.cjs` | `802030567b7fff4803fb6d3f1f3a79f1c93a38320d4a7db55589ebcddf71b2a2` |
| `tests/geometry-independent.test.cjs` | `eea682919718f15cc1e89ef9498b0c765e452776e6f864a572d64ff093d2cef6` |

## Boundaries and separate UI advisory

No actual browser rendering, browser color-management/premultiplication, pointer interaction, screenshot comparison, Electron desktop, Windows installation, or GPU acceptance was performed. UI files were changing during this assignment and their interactive tests were deliberately left to the UI owner.

A separate static advisory was sent to that owner: project storage allows sources above the geometry metadata plan's 80MP/32,768-edge limit, while the then-current `updateFramingControls` unconditionally called the planner on original dimensions, including null framing. For example, a stored 15000×15000 source passes settings validation but fails `Geometry.plan`. The parent/UI owner was asked to verify that oversized stored sources leave controls safely disabled or otherwise handled rather than throwing during ordinary state updates. This reviewer did not execute a changing UI harness to establish or close that UI-specific behavior.
