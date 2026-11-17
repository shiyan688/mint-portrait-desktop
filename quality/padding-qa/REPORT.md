# Independent desktop canvas-padding audit

Final focused audit: 2026-10-22 13:28 UTC.

Result: **51/51 independent tests pass**, with **600 seeded exact-pixel cases** inside the aspect/rounding test. No unresolved production defect was found in this focused audit. This is not a claim that the entire application's suite or a real desktop acceptance test passed.

Run: `node --test tests/padding-independent.test.cjs`

## Verified behavior

- The adopted padding core exactly matches the frozen candidate SHA-256 `91412cfaefd331c6fc5fffb8f9f58256dd25eb6306de6511cdec1cd2a2deb995`.
- Independent per-pixel oracles verify short-edge-based half-up rounding, asymmetric margins, tiny and extreme aspect ratios, zero/partial/opaque border alpha, byte-exact source placement, separate output ownership and source hidden RGB preservation.
- Shipped pixel-worker source and native pixel processing match effects → crop/quarter-turn/flip → padding, for every quarter-turn. Manual-liquify diagnostics do not violate the strict padding image-record boundary.
- Synthetic source-coordinate selections, local adjustment regions, manual records, background masks, source RGBA and settings snapshots remain unchanged by the final geometry/padding operations.
- Native PNGs are actually encoded by the shipped Sharp worker and independently decoded. Dimensions and every output RGBA byte match the independent oracle. Fully transparent hidden RGB is cleared only in exported output.
- Native JPEG output exactly equals a separate encoding of independently computed final content using the documented white flattening and 4:4:4 quality-100 policy. Dimensions, alpha removal and absent orientation metadata are checked.
- Original-source budgets remain authoritative before crops. Padding cannot bypass original source ceilings, complex-effect limits, final pixel/edge limits or working-mode selection. Browser-pipeline over-budget output rejects before canvas readback or Worker construction.
- Project v8 round-trips every current/committed/undo/redo/exported recipe with independent ownership and original file bytes. Real rehashed v1–7 containers migrate missing padding to null in every settings slot. Missing or malformed v8 padding rejects on encode and decode in every slot.
- Authored DOM tests execute shipped app code for pending values, apply-once, undo/redo, reset/cancel, invalid values, absent core, stale photo/revision/source, original/held-original/wipe, source-coordinate tools, crop border exclusion and content-offset overlays under all four rotations.
- Formal project save, recovery snapshot and native export request use only the applied padding recipe. Temporary form values do not enter settings, history, fingerprints or native dirty-state signaling. Save and export UI explicitly distinguish unapplied form values.
- Stale/incorrect-sized Worker results are rejected. Cancelled late results cannot allocate or publish a replacement canvas.
- Padded 1280×960, 960×1280 and 1280×1280 previews remain available to reference capture and pixel readout after display-only bounding. Each unchanged cache cap remains 6,553,600 bytes. Original/held-original display dimensions agree. Export plans preserve full output size and unscaled processing dimensions.

## Actual encoded-image evidence

- `synthetic-source.png`: test-only source, no private photos or model output.
- `oracle-padded.png`: independently generated expected PNG pixels.
- `native-padded.png`: actual shipped native export of the small crop/rotate/flip/partial-alpha test. Decoded RGBA equals the oracle byte-for-byte.
- `native-padded.jpg`: actual native JPEG for the same test.
- `pixel-manifest.json`: dimensions, exact recipe, per-file SHA-256 and matching decoded/oracle RGBA SHA-256.
- `native-large-padding.png`: actual native 1280×960 source expanded to 2240×1920 with 480 pixels on each side. Every one of the 960 original source rows is byte-equal at content offset (480,480). Result reports `scaled: false`.
- `large-export-proof.json`: large source/output sizes and hashes. This is the counterexample proving the 1280-pixel display-only cap does not shrink native exports.
- `EVIDENCE-SHA256SUMS`: hashes for encoded images and manifests.
- `SOURCE-SHA256SUMS`: audited production sources plus the independent test source.
- `independent-test-results.txt`: focused executable test result.

The small native padded PNG was also visually inspected. Its asymmetric blue border, rotated content and preserved synthetic detail agree with the encoded-pixel assertions. Pixel equality, not visual appearance alone, is the decisive content check.

## Test method and limits

No production files were edited by this audit. The new executable file is `tests/padding-independent.test.cjs`; evidence is confined to this directory.

The core pixel expectations are independent of the production padding and framing implementations. Existing upstream effects are used only to establish the unpadded input to the separately computed final geometry and padding oracle. UI harnesses are adapted authored DOM/Canvas/IPC doubles, not a browser. The display-bound test uses an explicitly labelled nearest-neighbour Canvas double to validate dimensions and allocation caps, not native Canvas interpolation fidelity.

No real browser, native Electron window, installer, Windows execution, model inference, private portrait, network/API request, dependency install, browser/socket service or user-computer access was used. Native Sharp encoding ran in the available cloud/Linux environment. Device visual acceptance, actual Canvas interpolation/color management, native quit dialogs and Windows installer/runtime acceptance remain outside this report. Full-suite regression is owned by the integrating parent task.
