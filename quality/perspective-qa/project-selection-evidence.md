# Independent desktop perspective persistence and selection audit

Scope: project schema 17, historical migration, paint/redaction geometry bindings, and captured source-selection refusal. This audit owns only the two new tests and project/selection evidence in this folder. No production implementation was edited. All inputs are synthetic or pre-existing synthetic fixtures; no private photo, model inference, API execution, new dependency, user computer, or publication was used.

## Results

- `tests/perspective-project.test.cjs`: 58/58 passed.
- `tests/perspective-selection.test.cjs`: 25/25 passed.
- Four intentionally broken in-memory variants all failed with real assertion failures, not loader errors. See `project-selection-mutation-results.json`.
- Focused regression across these suites plus paint-layers, redaction-layers, straighten-selection, straighten-project, and image-asset-project: initial run 187/190 passed. The three failures are stale pre-v17 expectations outside this audit's ownership: the image-asset suite expects current VERSION16 and treats version17 as unsupported, and the redaction AMD test expects five dependencies rather than six. They were reported to the implementation owner. This initial result is not represented as a green aggregate run.
- Frozen `src/perspective.cjs` SHA-256 remains `3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557`.

## Genuine historical writer evidence

`project-v16-historical.mintproj` is 16,316 bytes, SHA-256 `b14b4bf87e6528a702a4096237770fa9270dc3b45511a31559a622671a2130f5`.

It was encoded using the unchanged `src/project-document.cjs` from the immutable checkpoint26 architecture ZIP, with VERSION16 asserted before encoding. The archived redaction geometry writer generated its historical geometry keys. Current source-root dependencies resolve the archived writer's validators, but the writer itself is archived v16, not a v17 writer with its version field changed. `project-build-v16-fixture.cjs` records how to reproduce it; the test suite consumes the committed binary and does not regenerate it.

The fixture has six distinct current/committed/two undo/redo/exported recipes, a synthetic original PNG, a learned Float32 signed-zero cache plus provenance, one embedded 2×2 RGBA asset with transparent pixels, and selected historical paint/redaction collections. Its original schema has no perspective field in any slot. Writer, old geometry writer, seed, source, and asset hashes are recorded in `project-v16-historical-manifest.json`.

Schemas 1–15 are explicit migration controls derived from that historical frame, not claimed as separately captured historical writers. Their later-version fields and RGBA blob are correctly removed, blob references and offsets are rewritten, and complete metadata/blob hashes are independently verified before each expected acceptance or rejection.

## Persistence assertions

- Every schema 1–16 migrates an omitted perspective field to null in all six settings/history/export slots while retaining source/cache blob bytes and existing metadata.
- Version17 requires an explicit own perspective field in every slot on both encode and correctly rehashed decode.
- Every schema 1–16 rejects active perspective in each of the six slots, including with a correct metadata SHA-256 and all correct blob SHA-256 values.
- Active v17 recipes retain independent corner/fraction data across all slots and preserve source, signed zero, provenance, embedded assets, and deterministic roundtrips.
- Complete neutral recipes retain old selected paint/redaction geometry strings byte for byte. They are not silently collapsed into missing metadata.
- Each bound collection independently rejects changed corners, output fraction, reset to null, or reset to neutral. Neither hidden nor empty collections silently rebind or discard saved strokes.
- Both paint and redaction selections are rejected under active perspective in every saved slot, even when the selected layer is hidden or has no strokes.
- Unknown/missing fields, malformed quads, reversed/nonconvex geometry, fractional bounds, NaN/Infinity, hidden properties, unsafe prototypes, symbols, holes, and nested getters fail closed without executing getters.
- Encode snapshots mutable perspective/source/cache/asset state before asynchronous hashing. Decode snapshots the container before its first await and does not retain mutable buffer aliases.
- Browser UMD roundtrip works with shared metadata validators and WebCrypto while perspective raster APIs are replaced with throwing controls. Large valid source dimensions are not incorrectly restricted to render limits during persistence validation.
- Metadata integrity failure keeps precedence, and schema18 is rejected.

## Selection/binding assertions

- Absent/null/exact-neutral perspective retains the frozen historical geometry string. Neutral behavior also remains exact for all 16 quarter-turn/flip combinations with crop, padding, and a 90° straighten recipe.
- Every active corner x/y and both output fractions affect bindings; unrelated exposure/contrast/revision edits do not. Paint and redaction share the canonical key.
- Both modules retain source-revision protection and reject stale quad/output/reset bindings for visible, hidden, and empty collections.
- Instrumented real modules reject captured selections before any selection rasterization, geometry/padding/straighten/perspective pixel planning or application, core paint/redaction planning, or Canvas creation. This includes hidden/empty paint and redaction, zero-opacity paint, erase-only paint, selected second layers, empty/all selections, fraction-only resize, integer-copy crop, and tiny nonneutral edits.
- Unselected final-canvas paint and redaction render normally under active perspective, exactly matching the equivalent final-canvas overlay without a second geometry transformation.
- Existing native Canvas feathered selection alpha remains byte-exact for null/neutral perspective. Scalar mask weights are checked per pixel, and zero-alpha RGB remains canonical zero.
- Browser UMD selection guards execute without a Canvas/model runtime.

## Negative controls

`project-selection-mutation-controls.cjs` compiles changed source only in isolated subprocess memory and leaves production files untouched:

1. Disable v17 explicit-field requirement: 6 expected test failures.
2. Disable pre17 active-perspective prohibition: 16 expected test failures.
3. Omit active perspective from geometry keys: 17 expected test failures.
4. Remove captured-selection perspective guards: 12 expected test failures.

## Re-run

`node --test tests/perspective-project.test.cjs tests/perspective-selection.test.cjs`

`node quality/perspective-qa/project-selection-mutation-controls.cjs`

The native Canvas test uses the already installed runtime package already used by neighboring suites. This is Linux/cloud functional evidence, not Windows, macOS, mobile, or Electron packaging verification. Renderer pipeline and UI coverage are separate owners' work.
