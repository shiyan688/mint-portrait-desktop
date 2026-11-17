# Frozen-reference comparison: independent verification

Verified: 2026-10-22 12:03 UTC. Candidate hashes are recorded in `independent-source-hashes.sha256`; report/evidence identities are in `independent-evidence-hashes.sha256`.

## Result

- Independent suite: **71 passed, 0 failed, 0 skipped**.
- Independent cross-regression run: **326 passed, 0 failed, 0 skipped**, comprising every reference-comparison test plus the existing project, photo-review and geometry UI suites.
- The covered offline assertions pass. A conditional native QA-canvas snapshot discrepancy remains isolated and documented below; browser/Electron behavior is unvalidated. This is not native-application, browser or screen-layout acceptance.
- This verifier changed only `tests/reference-compare-independent.test.cjs` and its evidence/report in this directory. Production fixes were made by the implementation owner.

## Commands and evidence

From the source root:

```sh
MINT_REFERENCE_INDEPENDENT_EVIDENCE=1 node --test --test-reporter=tap tests/reference-compare-independent.test.cjs
node --test --test-reporter=tap tests/reference-compare*.test.cjs tests/project-ui.test.cjs tests/photo-review-ui.test.cjs tests/geometry-ui.test.cjs
node --test --test-reporter=tap quality/reference-compare-qa/independent-native-serialization.test.cjs
```

- `independent-latest.tap`: complete 71-test passing result.
- `independent-cross-regression.tap`: complete 326-test passing result.
- `independent-source-hashes.sha256`: tested app, core, HTML, CSS, feature documentation and independent test file identities.
- `independent-in-progress.tap`: an earlier intermediate run retained as defect-history evidence. Its two failures were subsequently repaired; it is not the final result.
- `independent-synthetic-evidence.json`: exact raw-pixel evidence, including hashes.
- `independent-synthetic-accepted.png`, `independent-synthetic-frozen-after-mutation.png`, `independent-synthetic-current-after-mutation.png`: synthetic canvas-readback evidence, encoded from actual RGBA with installed Sharp. Every PNG is decoded again and its dimensions/channels/raw hash asserted. **These are not app screenshots.**
- `independent-native-serialization.test.cjs`, `.json`, `.tap`: exact isolated native QA-library discrepancy reproduction and four-case matrix. The diagnostic TAP only means the reproduction completed; it is not a product passing assertion.
- `independent-native-tobuffer-discrepancy.png`: retained fully transparent native serialization result from the isolated failing sequence, not the frozen-readback visual proof.

## Independently discovered defects, now fixed

1. Capture initially accepted missing/empty source identity, negative generation/token, and a coercible name object before allocation. Bounded, own-data provenance now rejects these inputs before creating a bitmap or invoking coercion hooks.
2. Full-recipe key accounting initially counted an array separator only once although serialization repeated it. An authored boundary recipe exceeded the advertised 2 MiB character ceiling. The actual emitted key and all separators are now bounded.
3. Wipe comparison initially allowed capture despite being a forbidden capture view. It now rejects without silently switching modes or modifying image settings.
4. A post-mount label-update failure initially destroyed the previous reference while reporting that replacement failed and the previous reference remained. Replacement now retains the prior bitmap and view until fallible mounting/drawing succeeds, and restores it on failure.
5. A cheap-refresh optimization initially retained stale current-pane pixels after a full validation discovered an in-place recipe mismatch. Full-validation mismatch now invalidates the accepted-render capability, so the following refresh cannot remount that bitmap.

## Coverage

### Accepted preview and immutable capture

- Capture binds the full pixel recipe, nested edits, photo object, original Blob, working canvas, source revision, render generation and view token.
- Same-frame tone changes are rejected during debounce, during rendering, and after rendering fails, even though the legacy display stamp and old display bitmap still exist.
- Late older, same-sized output cannot replace a newer accepted result.
- Original hold, wipe, manual/point tools, diagnostic overlay, local/matte/face-box inspection, and crop drafts cannot be captured or silently changed to allow capture.
- Copy and mount failures preserve the old reference and release only the staged candidate.
- Later edits, undo, source repaint and subsequent successful replacement cannot mutate an existing frozen bitmap.
- Invalid dimensions and provenance fail before allocation. Preview decoding remains capped at 1280; the raw RGBA snapshot ceiling is 6,553,600 bytes (6.25 MiB). The replacement peak may temporarily contain both the old and candidate snapshots, as documented by the implementation.

### Navigation

- A separately authored oracle checks normalized centers and each pane's individual fit, including wide versus tall images and different pane sizes.
- Actual pan and wheel handlers use the initiating pane's dimensions and anchor, not shared pixel offsets.
- Zero, narrow, invalid and extreme inputs remain finite and bounded.
- Wrong pointer movement/up, movement through the other pane, second pointer, cancellation, lost capture, Escape, blur, pane/viewport resize, view switch and clear all release capture and prevent stale movement.

### Session and project boundaries

- Capture, fit, pan, zoom, mode switches and clear leave original bytes, settings, complete histories, review metadata, project serialization, dirty baseline and export scope unchanged.
- Actual selected export target IDs and rendered RGBA inputs remain identical before and after reference operations, including hidden selected photographs.
- View operations invoke no additional source decode, model analysis, or pixel render. Reference uses the existing accepted output rather than a second image-processing pipeline.
- Filtering, switching and unrelated removal retain the exact reference; removing its source photo clears it.
- Current-pane pixels are removed while a new photo loads or fails, so old current-photo pixels are not shown under its new filename.
- Canceled dialogs, decode/staging failure, declined replacement and installation rollback retain the reference. A committed project replacement clears it only after commitment.
- Page exit releases the session reference. Project schema and serialized contents do not acquire reference state.

### Busy-operation recovery

Ten additional tests preserve and execute the real scheduled preview callback while an actual export, project or preset operation is busy. The callback is allowed to early-return and consume its timer. Each test then completes/cancels/fails the real operation and requires its own completion path to schedule and execute a new preview callback. None manually calls `renderCurrent` to recover after interruption.

Covered outcomes: export folder cancellation/failure; project-open cancellation/failure; preset-import cancellation/failure; preset-catalog completion/failure; preset-application cancellation and failed preflight. The two application cases additionally prove no partial recipe commit.

## Native synthetic raster evidence

The independent raster check uses the already-installed native canvas implementation and an authored 257 × 256 pattern containing every alpha value 0–255. It compares the accepted canvas's actual readable RGBA, not assumptions about premultiplied storage.

- Accepted and frozen-after-source-mutation RGBA SHA-256: `46e54d42c5aa59d997a0704ada1200a3e320d2a461936a5ed6c73e215f632586`.
- Repainted current-source RGBA SHA-256: `9a7013786e3368e815455c87acaf3909a6cb880c172a5501bbdedc88a39c38ad`.
- Exact frozen reference allocation in this fixture: 263,168 raw bytes.

The frozen readable RGBA remains byte-identical while the repainted current image differs. The three visual proof PNGs encode these sampled bytes through installed Sharp and are independently decoded in the test, including dimensions and four-channel pixel hash. The normal native capture path without source PNG pre-encoding also decodes to the exact frozen pixels. No public or private portrait was required.

### Isolated native QA-library discrepancy

Reviewing the initial PNG evidence caught a real discrepancy, rather than a color or alpha-display interpretation. With installed `@napi-rs/canvas` 0.1.100, this exact sequence produces a 363-byte fully transparent PNG even though the frozen canvas's own `getImageData` remains correct:

1. Fill a 257 × 256 source canvas with the authored RGBA pattern.
2. Encode the source with `source.toBuffer('image/png')` **before** capture.
3. Call the real reference `capture` with a fresh native canvas factory.
4. Repaint the source without previously encoding the frozen canvas.
5. Encode the frozen canvas for the first time.

That PNG decodes to all RGBA `(0,0,0,0)`, SHA-256 `9b94b83334ada38b48b53f19ef2c45abc9f84fb723564671290a556f75d6fdc8`, while frozen readback remains `46e54d42…`. Consuming that frozen canvas through another native `drawImage` also produces transparent output in this sequence. Therefore, readback alone is not claimed as broad native-canvas acceptance.

The four-case reproduction varies source pre-encoding and frozen pre-encoding. Omitting source pre-encoding, or encoding the frozen canvas before repaint, gives matching native PNG/readback/replayed pixels. Both fresh-size and resized factory paths work in the normal sequence. The standalone matrix and transparent result are retained rather than silently replaced.

Production reference capture calls direct `drawImage` and never pre-encodes a PNG. The failing sequence is introduced by the QA evidence writer using a Node-native API, not by the production capture path. This is not proof of a browser clone failure, nor does it establish that browser cloning or real DOM mounting was tested. The corrected visual proof intentionally uses actual sampled RGBA and Sharp, labels that route, and asserts PNG round trips.

## Verification limits

- Shipped application handlers execute in a VM using established authored DOM/canvas/IPC doubles. This proves logic and state transitions, not real Electron event dispatch, accessibility behavior, native dialogs, browser compositing, visual layout or device performance.
- The native raster fixture validates its stated readback and normal non-pre-encoded copy/PNG path only. The conditional native snapshot discrepancy above remains a limitation of this QA backend. It is not a browser/Electron screenshot, native/browser acceptance, or original-resolution 100% inspection.
- No installs, npm commands, network requests, models, private photos, API calls, publication, or user-computer access were used by this verifier.
