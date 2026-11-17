# Next bounded desktop milestone: deterministic tone controls

Audit date: 2026-10-22. This is a source audit and implementation contract, not a claim that the proposed feature already exists or that a Windows build has passed acceptance.

**Implementation decision received after this audit:** the assigned implementation uses `src/advanced-tone.cjs`, optional `advancedTone:null` identity, five fixed curve nodes, explicit monotone/free curve mode, eight HSL bands, and the same post-base-tone/pre-local-layer stage. These selected names and representation supersede the suggested variable-knot API below. Parent integration owns its chosen schema-version/migration decision; the initial audit request specified retaining schema 3, while the later parent handoff explicitly selects schema 4. That discrepancy must be resolved and documented by integration rather than silently represented as unchanged schema. All safety, preservation, histogram-lifecycle and QA requirements remain applicable.

## Decision

Implement global master/R/G/B curves, hue-band HSL, and an alpha-aware histogram as one coherent offline tone module. Implement the real shared pixel math, bounded persisted parameters, renderer/native-export replay, and usable controls together. Do not add dormant controls, speculative models, network access, API credentials, new dependency installs, or permissions.

This is the highest-impact next bounded capability because the editor already has a safe global-color stage and non-destructive state/history/export paths. It adds targeted color work without changing the geometry on which the completed manual tools and learned-mask caches depend.

Crop/rotate remains valuable, but is the next separate geometry milestone. A correct implementation must choose and consistently enforce a source-to-output transform across selection, local masks, repair sampling, liquify displacement, learned original-ROI coordinates, compare views, image surface sizing, history, export plans and EXIF handling. A canvas-only rotate or a preview-only crop would not meet the existing product contract.

## Evidence and priorities

The requested baseline `/workspace/shared/photo-coverage-audit/coverage-checklist.json` and `功能覆盖验收清单.md` were not present in this executor. This inventory comes from the current source and does not claim reconciliation with that missing external baseline.

1. **P0, implement now: curves and hue-band HSL.** `src/local-adjustments.cjs` exposes only exposure, contrast, saturation and temperature. The `curveFor` function is an internal exposure/contrast LUT, not a user-editable curve. There is no user HSL/curve schema, panel, or native-export stage.
2. **P0, implement with tone: histogram.** The only histogram currently found is a local median statistic inside the portrait engine. There is no image-analysis histogram panel. It should describe the actual latest accepted render, not merely decorate a control panel.
3. **P1, next geometry milestone: crop, rotate and flip.** Current canvas layout and normalized manual coordinates assume unchanged dimensions. Native EXIF orientation normalization is present and is not a user rotation feature.
4. **P1, later usability/recovery: autosave/recovery, richer preset management.** The current project save/open path is useful and bounded, but no autosave claim is supported. Do not fold these stateful changes into the tone patch.
5. **P2, separate foundations: RAW/high-bit-depth/color-managed proofing.** Current color math is RGBA8 sRGB. Adding curves is not RAW development, 16-bit processing, perceptual color grading, or proofing.
6. **Outside this milestone: learned retouch, generative removal, professional quality parity, Windows/RTX acceptance.** These are not unlocked by adding tone controls and remain subject to existing authorization and evidence limits.

## Exact integration surfaces

Names below refer to the audited source before this milestone; line numbers can move during parallel implementation.

- **New pure core:** `src/tone-adjustments.cjs`, UMD usable by Node, worker and renderer. Suggested API: `validateCurves`, `validateHsl`, `apply`, `histogram`, immutable defaults and a capability marker. No DOM, paths, filesystem, network, inference, or mutable module-level image state.
- **Saved defaults and strict validation:** `src/project-document.cjs`, `DEFAULT_SETTINGS`, `SETTINGS_KEYS` and `settings()`. Add only the new allowlisted fields, validate and defensively copy them in every current/committed/undo/redo/exported-settings record. Retain outer schema version 3. Read older v1/v2/v3 records missing the new fields as explicit neutral defaults. Malformed fields that are present must fail closed, not silently become neutral. Preserve all existing source, bounds and integrity validation.
- **Browser defaults/snapshots:** `src/pipeline.js`, `DEFAULT_SETTINGS`, preset defaults and `render()`. Its structured clone already snapshots settings. Keep all existing abort and two-worker scheduling behavior.
- **Browser pixels:** `src/pixel-worker.js`, load the new core and run it immediately after `MintLocalAdjustments.tone` and before `MintLocalAdjustments.apply`. Preserve current ordering of repair, background and reshape. Validate new fields before processing, including when they are neutral.
- **Native pixels:** `export-render-core.cjs`, require the same core and add the same stage/order in `processPixels`. `validateRequest()` must continue to pass through strict project validation. Curves/HSL alone do not qualify as geometry or portrait operations and should remain eligible for the existing 64 MP/16384 native tone-only ceiling.
- **Module loading:** `src/index.html` loads the core before `project-document.cjs` and `app.js`. `pixel-worker.js` explicitly imports it. Packaging recursively copies `src` via `tools/package-win.cjs`; verify the staged/distributed file if packaging is otherwise in scope. Do not modify CSP or bridge permissions.
- **Controls/history:** `src/app.js`, `changeSettings`, `historyCommit`, `updateControls`, `updateAvailability`, `undo`, `redo`, `resetBtn`, preset handling and `applySync`. Tone settings are global and may sync across photos; photo-bound selection, local layers, repair, liquify and masks remain excluded. Preserve deep-copy ownership. Default/reset/preset behavior must be deliberate and tested.
- **Histogram lifecycle:** `renderCurrent()` accepts a result only after checking controller cancellation, view token, render version, current photo ID and source revision. Bind histogram data to that same accepted result. `activatePhoto` and `clearSessionView` must discard the old photo's histogram. Never read `previewCanvas` after overlays/compare composition as the measurement source.
- **UI/layout:** `src/index.html` and `src/styles.css`, real controls within the existing scrollable parameters panel. Accessible labels, keyboard editing, focus visibility, disabled states and a concise RGBA8/sRGB/preview-resolution scope note are required. The histogram is view state, not project metadata.

## Shared invariants

- Read-only original compressed bytes and input pixel buffers; output dimensions unchanged.
- Exact neutral identity, not RGB round-trip drift. Alpha is byte-identical for every edited pixel.
- Transparent RGB is not used to affect visible pixels. Skip alpha-zero pixels; retain the existing final export hidden-RGB sanitization policy unchanged.
- Partial alpha is straight/unassociated color. Do not multiply edited RGB by alpha or change opacity.
- Same deterministic math in browser preview and native export. Preview resolution and later spatial operations can change their actual histogram; color math on identical input pixels must match.
- New settings cannot disable safety caps, remove failed-operation errors, trigger models, modify source revision, mutate learned caches, or bypass renderer/export validation.
- Snapshot semantics remain unchanged: later UI edits cannot change queued/retrying export parameters, and canceled/late render jobs cannot update pixels or histograms.

## Release language

Describe the capability as ordinary deterministic 8-bit sRGB color adjustment, not learned retouch, SOTA, professional skin correction, full commercial parity, RAW, HDR, or a calibrated exposure meter. A histogram of the working preview is not an original-resolution export histogram. PNG alpha and JPEG white flattening differ; do not imply this preview predicts the post-compression JPEG distribution exactly.

The source/doc/automated evidence can be completed in cloud. A test double is not real browser or Windows interaction. Retain the existing known release and native-validation limits.
