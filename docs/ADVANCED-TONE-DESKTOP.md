# Desktop curves, eight-band HSL, and preview histogram

Release target: **0.2.1 development-quality desktop build**, not a production-quality or native-Windows/browser-verified release.

Implementation scope: desktop source UI, using the same dependency-free `MintAdvancedTone` core as the browser pixel worker and native export renderer. This is conventional 8-bit, display-referred sRGB processing, not learned retouching, RAW editing, HDR processing, full color management, or highlight recovery.

## Editing controls

The initially collapsed **曲线与 HSL** section follows **基础调色**, before portrait controls, inside the existing scrollable inspector. No new screen, dependency, model, account, network request, or photo upload is introduced.

- Four curve selectors: RGB overall, red, green, and blue. Each has exactly five fixed input coordinates: 0%, 25%, 50%, 75%, 100%. Five labeled, keyboard-accessible output sliders edit their y values. `step="any"` preserves valid fractional values on project restore instead of forcing a browser-side integer rounding. The graph is not an arbitrary-point or draggable editor.
- The graph is sampled through the actual shared core, using an isolated 256-step grayscale ramp with the selected curve in RGB, strength 1, and neutral HSL. It shows the selected curve itself, not a cosmetic Bézier approximation and not the cumulative effect of all channels, strength, or HSL.
- **单调** mode constrains neighboring outputs against reversals. **自由** mode permits bounded non-monotonic curves. Switching back to monotone checks all four channels. If any is reversed, the switch is refused with an explanation; the existing recipe is not silently sorted or replaced.
- Separate reset actions restore the selected channel, all curves, selected HSL band, all HSL, or the entire advanced-tone recipe. Curve-only resets keep mode/HSL/enable/strength. HSL-only resets keep curves/enable/strength. Entire advanced-tone reset stores `null` and is undoable.
- Eight HSL bands are red, orange, yellow, green, aqua, blue, purple, and magenta. Hue is −30°…+30°, saturation and HSL lightness are −100…+100. Their smooth overlapping weighting and near-gray behavior come from the shared core. HSL lightness is not physical luminance or exposure.
- Enable and overall strength are explicit. Disabling preserves the recipe; controls remain editable while disabled. Identity, disabled, and zero-strength recipes do not change pixels. Missing core disables all controls rather than simulating a usable effect.

## Settings, history, presets, and synchronization

`settings.advancedTone` is `null` by default. Otherwise it uses the version-1 recipe validated by `MintAdvancedTone`. Slider `input` updates the preview; `change` commits one grouped history step. All discrete changes and resets are undoable. Photo changes, undo/redo, save/load, and ordinary project settings use the same recipe. Project schema migration is provided by the project codec, not a second UI-only format.

**Preset choice is explicit:** applying a global style preset resets advanced tone to `null`. The preset tooltip and inspector note disclose this. Existing source-bound manual selections, liquify and repair commands, local layers, learned masks, and point repairs retain the existing preservation rules. One undo restores the previous advanced recipe.

**Batch synchronization includes advanced tone:** each target receives its own deep-copied global recipe. Each target retains its own source-bound selection, manual commands, local layers, points, learned masks, and per-photo history. Existing geometry/background conflict rules remain unchanged. The sync dialog names curves/HSL explicitly.

## Histogram data and lifecycle

Histogram input is the accepted render canvas, read immediately after the render's cancellation, view token, render version, photo identity, and source revision checks succeed. Browser `ImageData` is wrapped as a plain `{ width, height, data }` record before calling the strict shared core. It is never read from the display `previewCanvas`.

- Red, green, blue, and luma-code-value bins use the core's actual rendered pixels. The graph uses a common linear frequency scale. Luma is the core's weighted gamma-encoded code-value estimate, not scene-linear luminance.
- A budget of 262,144 pixels bounds histogram computation. Smaller images use every preview pixel. Larger previews use deterministic stratified sampling; the UI says the result is approximate and shows sampled/total preview pixels.
- Alpha 0 contributes no bin mass. Semitransparent samples are weighted by alpha/255. Effective weighted samples and each channel's 0/255 endpoint percentages are disclosed. Fully transparent images explicitly report no visible pixels.
- The label distinguishes normal processed preview from the manual-edit preview, where automatic geometry and background processing are temporarily omitted. This is not a RAW or full-resolution histogram.
- Checkerboard backgrounds, selection overlays, diagnostic overlays, held-original view, and split comparison never enter the histogram. Toggling those views does not recompute or overwrite accepted statistics.
- Scheduling an edit or starting a render clears the old histogram and labels it pending. A second stamp check after calculation prevents publication if identity changes during sampling. Superseded or aborted render completions cannot update bins, labels, or the accepted image. Source switches, clearing the session, and render failure invalidate current statistics.
- Histogram-read failure displays an unavailable message while keeping the independently accepted image. It does not mark image rendering as failed or substitute source pixels.

Endpoint percentages describe current 8-bit preview code values only. They cannot prove the original source has irrecoverable black/highlight clipping.

## Transparent-input manual-liquify safety regression

Manual liquify preserves destination alpha. On already transparent input, warping RGB without warping alpha can clip a silhouette. The UI now scans **every alpha byte of the actual accepted manual-edit image** before beginning both push and restore, and checks again immediately before a command is committed.

Any alpha other than 255 refuses the stroke, requests an opaque original with shaping before new matting, and states that it will not flatten the image. Unreadable alpha fails closed. Rejection adds no draft, command, undo entry, alpha change, or implicit background fill. Selection tools remain available on transparency. Ordinary opaque-image push behavior remains unchanged. The native/worker manual replay guard is separate defense in depth, including the actual export-resolution image.

## Executable evidence and limits

`tests/advanced-tone-ui.test.cjs` executes the shipped app with authored DOM/canvas/IPC doubles, real tone pixels, and the real project codec. It covers:

- Section order, collapsed default, five labeled controls/eight selectors, asset ordering, and responsive width contracts.
- Missing-core fail-closed behavior, real channel/HSL pixel changes, enable/strength bypass, alpha preservation, grouped history, and exact undo/redo.
- Monotone bounds, free-mode reversal, refusal to silently reshape, precise resets, and all eight bands.
- Per-photo sync preservation and deep copy, documented preset reset, and real encode/decode/UI restore.
- Accepted-pixel histogram values, alpha weighting, endpoint math, transparent images, sampling budget and labels, no overlay contamination, stale/late/aborted/source-change rejection, and histogram-only error isolation.
- Transparent/semitransparent push and restore refusal for alpha 0, 1, 128, and 254; commit-time recheck, unreadable pixels, opaque behavior, and continued transparency-safe selection editing.

These are source-level tests, not a claim of actual Chromium layout, native pointer/keyboard, Windows dialog, installer, or model-inference QA. Actual Chromium launch was blocked by the environment's socket restriction and cloud `file://` navigation was denied; neither restriction was bypassed. No browser screenshot is represented as verified. Native installed desktop interaction and visual checks remain separate release-validation work.
