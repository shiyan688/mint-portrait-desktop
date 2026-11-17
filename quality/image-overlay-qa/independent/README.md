# Independent image-overlay native qualification

Result: **22/22 new independent tests passed; 82/82 focused native regression tests passed. Zero failures or skips.** No production defect was found in the exercised paths. Production files were not modified by this QA task.

## Scope and evidence

- Real `export-renderer.cjs` → Node worker → installed Sharp decode, compositing and PNG/JPEG encoding. No mock native encoder.
- Independent BigInt integer-alpha source-over oracle for aligned one-color overlays on zero, one, partial and full destination alpha. Exact PNG channel equality, including half opacity.
- Independently constructed SHA-256 asset records include dimensions and exact RGBA bytes; changing dimensions or content rejects. The fixture encoder does not call the production asset codec.
- Transformed, flipped, rotated and mip-reduced layers match explicitly staged desktop core composition. Actual UMD `pixel-worker.js` is executed in an isolated VM and compared byte-for-byte with the native replay path.
- Tone → framing → straighten → padding → image → text → paint → redaction → final downsize is exercised with deliberately overlapping synthetic content. Approved NativeCanvas renders actual glyphs for a separate native PNG check.
- Zero opacity and disabled layers are exact native PNG/JPEG legacy-neutral outputs, including returned metadata shape. Source bytes, original RGBA, assets and caller settings remain unchanged.
- Explicit working reduction, final downsize, EXIF orientation, JPEG white flattening, four-layer order and fifth-layer rejection are covered.
- Missing, extra, duplicate, malformed, wrong-hash and dimension-relabelled assets, unsafe accessors, stale metadata, source/edge/final-canvas caps and retained-memory limits fail closed. Oversized metadata is rejected before source copying or worker creation. Small final output cannot bypass these checks.
- Cancellation before/during replay, queued browser work, actual native cancellation, late completion from a cancelled native worker and forged native/browser provenance are covered. Subsequent valid jobs remain usable.
- Browser admission and scheduling use Canvas/DOM doubles with the real UMD worker. They are **not launched-browser, Electron interaction or Windows installer QA**.

`test-output.txt` records the 22-test run. `native-regression-output.txt` records 82 passing tests across the new suite plus existing image-layer, final-size, sharpening, straighten and text native suites.

## Reproduce from repository root

```sh
node --test tests/image-overlay-native-independent.test.cjs
node --test tests/image-overlay-native-independent.test.cjs tests/image-layers.test.cjs tests/export-size-native.test.cjs tests/sharpness-native.test.cjs tests/straighten-native.test.cjs tests/text-export-native.test.cjs
node quality/image-overlay-qa/independent/generate-artifacts.cjs
```

Uses the repository's approved Sharp dependency. NativeCanvas can resolve normally as `@napi-rs/canvas`; when provided by the host rather than the repository, set `MINT_NATIVE_CANVAS_MODULE` to its installed module location. `MINT_SHARP_MODULE` is an optional fixture-tool dependency override; the actual native worker still resolves its normal repository Sharp. No installation, downloads or network are performed. Without NativeCanvas, only the dedicated glyph test is explicitly skipped; artifact generation requires it. The recorded run supplied the approved host NativeCanvas and had no skips.

The generator, worker references and tests resolve repository files relative to their own file location, not an ephemeral absolute worker path.

## Synthetic artifacts

- `synthetic-comparison.png`: visually inspected four-panel contact sheet. It is a synthetic comparison, not an app screenshot.
- `synthetic-source.png`, `synthetic-rgba-asset.png`: self-created procedural fixtures.
- `expected-staged.png`: explicit stage-by-stage expected pixels.
- `actual-native.png`: actual native worker PNG export.
- `actual-final-downsize.png`: actual final-stage downsize, 240-pixel long edge.
- `artifact-report.json`: fixture settings, provenance, source hashes, artifact hashes and pixel errors.

Artifact checks: native output versus staged pixels has maximum channel error **0**. Final downsize versus explicit post-composition Lanczos resize has maximum channel error **0**. The generator asserts both before writing its report. Transparent RGB is removed in exported output only.

## Limits

This is focused integration qualification, not a full release regression or security audit. Complex transformed-overlay expected pixels use the qualified shared desktop compositor; only the aligned source-over cases are checked against a separate mathematical oracle. It does not test main-app file import/UI wiring, save-dialog interaction, project history persistence, Windows installation, performance on end-user hardware or external assets. The separately diagnosed existing untagged 16-bit PNG ICC behavior is outside this task; no color-path changes were made.
