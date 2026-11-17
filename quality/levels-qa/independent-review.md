# Conventional Levels: independent desktop QA

## Result

2026-10-22: **57/57 independent tests pass**, with no skipped cases. Actual native-export PNG readbacks agree byte-for-byte with a separate scalar reference for all eight portrait/ramp variants. Neutral output changes zero pixels. The production pure core and VM-executed Worker agree on all tested pixels, including alpha-zero hidden RGB; native export deliberately sanitizes invisible RGB only in its output copy.

- Frozen Levels core: `1e454e275c24e2e99b7b6e32bad3569a3ce996e73e2d8cc895c00aea5daf327f`.
- Reviewed preset v2 codec: `30b4f98139e9fef2d4e3b6dffc2cf0d4594862039623fa02c3877cacfc6fe5ab`.
- Run: `node --test --test-reporter=tap tests/levels-independent.test.cjs`.
- Evidence: `node quality/levels-qa/render-evidence.cjs`.
- Detailed test results: `independent-tests.tap`.
- Full recipes, source hashes, readback metrics and attribution: `visual-evidence.json`.

## Defect found and fixed

The initial candidate (`3a7c6d9…`) assigned validated channels with `channels[key] = channel` into a normal object. An inherited `Object.prototype.red` setter executed and captured the write; validation returned a recipe missing its own red channel. Reported before freeze. The core owner replaced dynamic output writes with an explicit own data property and null-prototype property descriptor. The independent inherited-setter regression passes on the frozen core. No production files were edited by this reviewer.

The integration owner also found a preexisting manual-liquify-only + framing incompatibility: manual output includes diagnostics while the geometry core deliberately accepts only image fields. The owner fixed the Worker/native stage boundary by passing an explicit `{width,height,data}` image, without weakening Geometry validation. Four new independent cases (Levels null/active × neutral/rotated-flipped framing) confirm that real manual output still rejects if sent directly to Geometry, but production Worker/native/PNG replay now succeeds with exact expected pixels. The owner’s original reproduction is retained in `manual-framing-before-fix.log`.

## Independent coverage

- 800 deterministic, randomized full recipes × 256 input codes × 3 channels = **614,400 scalar/LUT comparisons**, with gamma extremes, endpoint clamps, flat outputs and monotonicity.
- Explicit no-intermediate-rounding, single-strength-blend and half-up tie examples; master neutral-gray behavior and red-only channel isolation.
- Null, neutral and zero-strength exact identity; alpha and invisible-RGB preservation; immutable input pixels and independently owned validated controls.
- Eighteen malformed recipe families tested through validation, LUTs and image application, also when strength is zero. Own getters, nonenumerable fields, symbol keys, inherited mandatory getters and inherited optional callbacks are rejected/ignored without hook execution.
- Native typed-array storage, offsets, shadowed getters/methods, detached/shared/subclass storage, invalid dimensions and malformed options. Exact 64 MP/16384-edge limits are checked without claiming an actual full-64-MP allocation/performance run.
- Pre-allocation, chunk and final cancellation; callback-induced input detachment cannot publish partial data.
- Actual shipped Worker source executed in a Node VM; native direct pipeline; actual native export worker threads and Sharp PNG decode/readback.
- Noncommuting basic → Levels → advanced tone → local → repair → framing comparisons, and a separate repair → background → reshape → framing path using an existing public landmark fixture over synthetic pixels. Swapping Levels across basic/advanced/local stages demonstrably changes pixels, so order checks are not identity-only.
- Four liquify-only + framing regressions cover the diagnostics/image boundary in Worker, native direct processing and actual PNG export/readback, preserving strict Geometry validation and immutable source pixels.
- Project v7 all current, committed, undo, redo and exported settings; source bytes and independent ownership. Validly rehashed v1, v2, v3, v4, v5 and v6 migration, retaining preexisting active tone/framing where those schemas support them and preserving v6 review.
- Validly rehashed v7 missing or invalid Levels at every history/current/export slot rejects; malformed imports/saves do not overwrite previous files or invoke save dialogs.
- Preset v2 exact dependency injection `{advancedTone, levels}`, v1 migration to null Levels, v2 required own Levels, independent ownership, color-only retention, duplicate escaped keys and browser/CommonJS serialization equality. Malformed imports preserve active catalog and retained backup bytes.

## Visible evidence

- `portrait-levels-contact.png`: original, neutral identity, moderate user-chosen master/channel color change, endpoint stress. Existing public NASA Victor Glover fixture, NASA/Bill Ingalls. Original and neutral are pixel-identical; moderate changes 581,306 of 581,400 pixels; endpoint stress changes all 581,400. Every variant's independent scalar-to-native-readback maximum error is zero.
- `synthetic-levels-contact.png`: grayscale, hue, opposed RGB, near-black and near-white ramps under the same four recipes. Every native PNG readback has zero oracle error.
- Both contact sheets were opened and visually inspected after saving, and independently decoded from disk. Labels distinguish **algorithm output, not app screenshots**, and intentional endpoint stress, not a recommended/default preset.
- Existing source portrait bytes and decoded input pixels stayed unchanged. Encoded neutral PNG bytes need not match the source PNG, because native export embeds its own sRGB profile; pixel identity is what is asserted.

## Scope and limits

This is conventional user-controlled 8-bit gamma-encoded sRGB color processing, not a natural-beauty default, learned retouch, RAW/HDR recovery or an aesthetic-quality benchmark. Public portrait use is existing private, non-commercial factual software QA only, not a bundled product asset or endorsement. No network, installation, model execution, new dependencies or private photos were used.

These tests do not establish native browser rendering, Windows app interaction, a native Canvas serialization path, installer success, full-resolution performance or GPU/model behavior. The actual production PNG exporter was exercised and then independently decoded, so encoder caching or stale serialized output would be visible as a byte mismatch rather than concealed by trusting the pre-encode buffer. UI/state interaction tests and the full historical suite remain with the integration owner.

The system emitted non-fatal Fontconfig cache-directory warnings while rasterizing contact-sheet labels. Saved sheets were still independently decoded and visually inspected with readable labels; these warnings do not affect the pixel pipeline or oracle comparisons.
