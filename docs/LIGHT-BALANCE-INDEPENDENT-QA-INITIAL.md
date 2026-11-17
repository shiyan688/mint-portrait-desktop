# Independent desktop light-balance workflow audit

Verified on 2026-10-22 in the cloud workspace with the already installed Node,
NativeCanvas and Sharp. This is source-level and deterministic pixel/workflow QA,
not a release sign-off or an actual browser/Electron/Windows test.

## Result

All four targeted suites pass against the recorded final source:

- Core: 35/35.
- Pipeline/export/persistence integration: 37/37.
- Existing UI suite: 14/14.
- New independent adversarial workflow suite: 27/27.
- Total: 113 passed; 0 failed, cancelled, skipped or TODO.

Exact commands, SHA-256 values, runtime version and verification timestamp are
recorded in `quality/light-balance-qa/independent-report.json`. Recorded files
were hashed before and after all four suite runs and remained unchanged.

The independent work adds `tests/light-balance-independent.test.cjs`. No
production source was edited by this audit. With the implementation owner's
approval, one test-only dependency injection was corrected in
`quality/light-balance-qa/app-harness.cjs`: its inherited named-preset callback
now receives the shared light-balance codec dependency, matching production.
The harness still executes the shipped `src/app.js` unchanged.

## Reproduced defect and verified fix

WB-COMPARE-01: enabling before/after comparison while the neutral-patch picker
was armed left the application in `white-balance` mode. `compare` was true, but
the divider was hidden by source view. A pending pointer release still applied
white balance and added history after the explicit view switch.

The implementation owner changed comparison switching to exit the sampler and
cancel the pending point, and added a comparison-state rejection to the frame
readiness guard. The independent regression now passes. Fixed-reference view
switching is independently covered as well.

The owner also hardened fit/zoom interruption and missing upstream face facts.
Those additions pass: navigation cancels a pending point without changing the
recipe, and each of the seven nonzero upstream beauty controls blocks sampling
when face facts are absent. Losing face facts after pointer-down also prevents
commit. Synthetic face topology is used to exercise the existing beauty code;
no detector or learned model was run.

## Added adversarial evidence

### Correct input and coordinate system

- NativeCanvas reads of the sampler frame match independently assembled
  healing → beauty → basic-tone bytes exactly. The synthetic fixture is asserted
  to differ both from raw pixels and from basic-only processing, so this cannot
  pass through an accidental no-op beauty fixture.
- Existing light balance, Levels, text, crop/rotation and padding are not sampled.
  The applied gains equal gains derived from the pre-stage bytes, not the raw
  source. Entering the picker leaves photo settings and history unchanged.
- Normalized picking is tested with offset, clipped-position, very wide and very
  tall authored display rectangles over a nonuniform four-patch source.
- Nonfinite coordinates, points outside the image, right-click and zero-size
  image bounds do not create edits.

### Cancellation, replay and stale-state defenses

- Lost pointer capture, blur, Space press/release, a second pointer, cancel,
  fit and zoom reject a pending point even if pointer-up is delivered again.
- An out-and-back drag is still cancelled. Duplicate pointer-up and later lost
  capture cannot add a second history entry.
- Blob identity, source-canvas identity, render generation, view token, accepted
  canvas identity and render-pending state are checked adversarially.
- A delayed pre-stage render from an old photo cannot replace a newer photo's
  accepted frame. The shell controls timers to make the completion order exact;
  the production render/acceptance functions are unchanged.
- Actual photo activation, undo/redo, split comparison and fixed-reference
  comparison leave no stale point capable of editing another state.

### Persistence and export isolation

- Project save/open retains gains and committed full settings but no transient
  point, sampler session or diagnostic-only recipe. Encoded source bytes remain
  exact and reopening begins in normal pan mode.
- Opening export cancels sampling. The desktop export request contains the
  committed full recipe and original source bytes, not the diagnostic input
  recipe. Its IPC boundary is a test double; the separate integration suite
  performs real Sharp/native PNG encode/readback parity.
- Applying an active named color preset cancels old sampling, preserves the
  target's beauty setting, commits once, and undo restores previous gains.
- An invalid active recipe disables sampling/editing; explicit whole-stage reset
  recovers without silently discarding the invalid value before that reset.

### Frozen core and shared-path parity

The announced frozen core and codec hashes were independently verified:

- `src/light-balance.cjs`:
  `b33b2cc55dbd5943dc07db4baf42f6af68e61c62951751c5dc5774063a272531`
- `src/preset-codec.cjs`:
  `b03d59aab2fa6b32639ceb1ddc0d22e680adde21a2834aece6cea9e79645e5d6`

For synthetic adversarial colors, extreme gains, opposing tone endpoints and
alpha values 0, 1, 17, 128, 254 and 255, direct core output equals the native export
pixel path and the actual shipped classic pixel worker executed in a Node VM.
Alpha is exact, fully transparent RGB is exact, and input buffers remain untouched.
The integration suite additionally verifies the actual pipeline scheduler,
native PNG bytes, output-size-last processing, cancellation, project versions
1–10, preset versions 1–3 and fixed pipeline ordering.

## Reproduction

From the repository root, without installing software:

```sh
node --test tests/light-balance-core.test.cjs
node --test tests/light-balance-integration.test.cjs
node --test tests/light-balance-ui.test.cjs
node --test tests/light-balance-independent.test.cjs
```

The independent UI suite requires the existing NativeCanvas dependency loaded by
the shared QA harness. It is not a shipped runtime dependency. The report's test
commands add `--test-reporter=tap` for machine-readable counts.

## Explicit limits

- No browser was launched, no network/npm/install route was used, no model was
  executed, no upload was made and no user computer was accessed.
- Authored DOM rectangles, IPC, timers and event dispatch do not validate real
  CSS layout, browser pointer-capture ordering, compositor behavior or native
  desktop dialogs. NativeCanvas does validate real raster draw/read behavior.
- No Windows installer, RTX 4060, real-image portrait quality, RAW pipeline,
  HDR, clipped-detail recovery or SOTA acceptance is established here.
- White-balance sampling remains an 8-bit display-referred pre-stage operation.
  Its intended neutral-patch selection is not automatic scene understanding.
- Frozen-hash evidence applies to the recorded files only. Later production
  changes require rerunning the affected checks and updating the report.
