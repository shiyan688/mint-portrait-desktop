# Curves / HSL / histogram contract and acceptance cases

This is the recommended exact contract. The implementation may choose a different bounded representation, but it must document one unambiguous interpretation and update the tests accordingly. Do not ship independently chosen renderer/export interpretations.

**Selected implementation contract supersedes the representation below:** `advancedTone:null` or exact version-1 recipe; five fixed-node PCHIP curves with bounded segment extrema; explicit monotone/free mode; eight HSL bands; chroma guard zero for achromatic input and full at S>=0.1. The implementation must document exact node positions, PCHIP slopes, rounding, chroma-guard formula and schema migration, then adapt the curve rejection/identity/bounds tests to these choices. The variable-knot piecewise-linear rules below remain an audited alternative, not a requirement to mix both algorithms. Histogram sampling uses an explicit bounded stride: label sampling/counts honestly, disclose aliasing limits, and do not claim sampled endpoint proportions are exact full-image clipping percentages.

## 1. Curves

Suggested setting: `toneCurves = { master, red, green, blue }`, each an array of 2 to 16 ordinary `{ x, y }` objects. Coordinates are finite numbers in `[0,1]`. Default for each channel is `[{x:0,y:0},{x:1,y:1}]`.

Validation rules:

- Require exactly the allowed own enumerable data properties. Reject unknown keys, accessors, executable values, symbols, custom prototypes, sparse/extended arrays and non-finite/out-of-range coordinates before evaluating pixel math. Do not invoke a getter to discover that it is invalid.
- Require first `x===0`, last `x===1`, and strictly increasing x values. Reject duplicates, unsorted input, more than 16 points, or fewer than 2. Never silently sort or drop points from a saved document.
- Y need not be monotone. Contrast inversion is a legitimate explicit effect. Endpoint y can move to permit black lift and highlight limiting; endpoint x remains fixed.
- Interpolate piecewise linearly, not a cubic spline that can overshoot or an undocumented smoothing curve. At an exact knot use its y exactly.
- For each normalized encoded-sRGB channel `c`, calculate `channelCurve(masterCurve(c))`. The master is applied independently to R/G/B, not a luminance-only transform. Evaluate the composed function before final 8-bit rounding; avoid two independent integer quantizations.
- A 256-entry LUT per channel is sufficient because the incoming stage is RGBA8. Use deterministic rounding for final values; target `Math.round(clamp(value,0,1)*255)` and test ties explicitly. Default and redundant diagonal knots must be exact identity.
- For UI display, x/y may be shown as 0–255. Convert to normalized storage explicitly. A dragged interior point cannot cross its neighbors or delete locked endpoints. Numeric editing must have the same checks as dragging.

Curves are global. An active manual selection does not restrict them. Selected-area work continues to use the existing source-bound local-layer route; do not suggest curves/HSL affect only the visible selection.

## 2. Hue-band HSL

An eight-band panel is recommended for portrait usability because it separates orange from red/yellow. Recommended ordered centers in degrees:

`red:0, orange:30, yellow:60, green:120, cyan:180, blue:240, purple:270, magenta:300`.

If the implementation chooses six equal bands, name them red/yellow/green/cyan/blue/magenta and use centers 0/60/120/180/240/300. Do not advertise independent orange targeting. The rest of this contract applies to either explicitly fixed band set.

Suggested shape: `hsl = { bandName: { hue, saturation, lightness }, ... }`. All bands must exist when hsl is present; absent top-level hsl in an older document becomes all zero. Hue is finite degrees `[-30,30]`; saturation and lightness are finite percentages `[-100,100]`. All zero is exact identity. Reject unknown/missing band/parameter keys, unsafe objects and out-of-range values; do not clamp malformed saved projects.

Recommended interpretation:

1. Convert the post-curve encoded-sRGB R/G/B values to ordinary HSL: `L=(max+min)/2`; for nonzero chroma `C=max-min`, `S=C/(1-abs(2L-1))`; hue uses the standard maximum-channel branch, wrapped into `[0,360)`.
2. Determine the two neighboring fixed band centers around the input hue, wrapping last center to first+360. With relative position `t` in that interval, use `u=t*t*(3-2*t)`, weights `1-u,u`. This supplies a continuous partition of unity; a boundary is not a discontinuous hard mask. The two bands adjacent across 360 must behave just like every other adjacent pair.
3. Compute weighted `dH`, `dS`, `dL` from that original hue once. Do not apply each band serially or recalculate band membership after changing hue; that creates order-dependent spillover and self-targeting.
4. Compute `H'=wrap(H+dH)`, `S'=clamp(S*(1+dS/100),0,1)`. Set `q=dL/100`; `L'=L+(1-L)*q` when q>=0, otherwise `L'=L*(1+q)`. Convert once back to encoded RGB and explicitly round/clamp to bytes.
5. For exact achromatic inputs (`C===0`), hue is undefined. Leave these pixels unchanged by hue-band HSL, including its band-lightness values. Curves still affect neutral tones normally. Document and test this, rather than classifying every gray as red.
6. Alpha is unchanged. Alpha-zero pixels are skipped. HSL is not linear-light exposure, a white-balance calibration, Lab/LCh grading, or a skin/ethnicity detector.

If a near-neutral chroma guard is added to reduce unstable hue targeting in almost-gray noise, explicitly define its formula, threshold and placement and test it. Do not add an undocumented magic threshold that causes visible discontinuities.

## 3. Histogram

Recommended pure API input is the same bounded RGBA8 image contract as the tone core. Output has four 256-bin arrays (`red`,`green`,`blue`,`luma`) and scalar `visiblePixels`, `alphaWeight`, `width`, `height`. Histogram data is derived; do not store it in project settings/history.

- Measure completed edited pixels before display overlays, compare split, original-hold overlay, selection tint, local-layer outlines, diagnostics, checkerboard, crosshair or canvas CSS scaling.
- Ignore A=0. For A>0, count `visiblePixels += 1`, `alphaWeight += A/255`, and add that weight to the R/G/B bins at their byte values.
- Luma bin is explicitly `round(0.2126*R + 0.7152*G + 0.0722*B)` over encoded sRGB. Call this approximate encoded luma, not linear-light luminance. Other formulas are acceptable only if equally explicit and tested.
- Each of the four histogram arrays sums to alphaWeight within floating error. Empty/all-transparent data produces zero bins, zero alphaWeight, no division-by-zero, no fake peaks and an explicit empty display.
- Any visual normalization or log scale affects only drawing. A drawing normalization must not overwrite/count-normalize raw bins. Peak counts, shadow/highlight endpoint counts and axis labels must remain mathematically honest.
- A preview histogram must say preview, ideally include actual sampled width/height. Current preview uses a 1280 maximum edge. Do not falsely label it exact full-size export analysis.
- On render pending/failure/cancel, do not leave an unlabeled previous histogram pretending to describe newly edited pixels. Retain it with a pending/stale indicator or clear it. Photo switch/remove/open/new-session clears old association immediately.
- On manual-editing mode, either suppress histogram and label why, or label the histogram as the manual view whose background/automatic shape are temporarily omitted. It must not claim to describe the final full edit when it does not.
- Histogram computation or drawing failure must not silently replace a successfully rendered image, silently fall back to a wrong image, or break export. Display a truthful unavailable state. Unsupported canvas methods in a test harness are not a reason to disable real capability silently.
- Prefer worker-side calculation or cache one calculation for each accepted preview render. Do not scan image pixels on every pan, zoom, overlay movement, histogram redraw or slider label refresh.

## 4. Required core tests

### Curves

- C01: neutral defaults and redundant diagonal knots yield byte-identical output on a 256-value ramp, arbitrary RGB, full/partial/zero alpha. No input mutation.
- C02: inversion `[(0,1),(1,0)]` yields `[255-R,255-G,255-B,A]` for visible pixels; hidden RGB remains unchanged until export sanitization.
- C03: a red-only curve changes only red. A master curve followed by a red curve produces the documented composition, not the reverse. Test with noncommuting curves such as master square-like three-point mapping and red inversion.
- C04: interior knots, exact boundaries, endpoint black lift/white rolloff and nonmonotone y are evaluated accurately without overshoot.
- C05: reject duplicate/nonordered x, missing endpoints, insufficient/excessive points, NaN/infinity, out-of-range x/y, unknown channel/point fields, typed/sparse arrays, accessor properties and prototype pollution. Verify getters never execute.
- C06: neutral cores retain valid alpha unchanged; malformed data, count, width/height, subclasses/shared backing if unsupported and budget violations fail before mutation.

### HSL

- H01: neutral defaults are byte-identical. Test all 256 grays and exact black/white under nonzero band adjustments; they remain achromatic and unchanged by band HSL.
- H02: saturated red with red hue +30 becomes orange `[255,128,0]` under round-half-up; red hue -30 becomes `[255,0,128]`. Alpha unchanged.
- H03: saturated red with red saturation -100 becomes `[128,128,128]`; red lightness +100 becomes white and -100 black. Hue at 0 wraps identically at 360.
- H04: a non-target band has no effect outside its support. An orange center is independently selectable only for the eight-band scheme.
- H05: colors equally spaced around a band seam have continuous finite changes; test 359.99°/0°/0.01°, each band center, and every midpoint. Weighted deltas sum correctly and use pre-HSL hue once.
- H06: mixed nonzero bands produce the same result independent of JS property insertion order. No serial band application.
- H07: source pixels/settings remain unchanged and repeated independent calls match. Wrong strings, nonfinite/out-of-range values, extra/missing fields, getters and unsafe objects fail closed.
- H08: grayscale/alpha distributions, skin-colored synthetic swatches, nearly neutral noise and saturated primaries reveal clipping or channel discontinuities. This is a math/regression check, not skin-quality acceptance.

### Histogram

- G01: fixture `[255,0,0,255], [0,255,0,128], [0,0,255,0]` yields visiblePixels=2, alphaWeight=`1+128/255`; R bins 255=1 and 0=128/255; G bins 0=1 and 255=128/255; B bin 0=`1+128/255`; luma bins 54=1, 182=128/255. The transparent blue adds nothing.
- G02: all transparent and empty visible image produce zero sums. Reject invalid image dimensions/buffer lengths/nonbyte data explicitly.
- G03: each channel/luma sum equals alphaWeight within tolerance; constant black/white and a ramp have correct endpoint counts. Alpha is weighting, not black compositing.
- G04: transformed histogram equals histogram of the actual transformed output, not input. Toggling an overlay or compare split must not add peaks or change measured bins.

## 5. Required integration and UI tests

1. Run identical synthetic images through the direct core, real worker VM harness, and native `processPixels`, then actual PNG export/decode. Require exact pixels for matching same-size RGBA8 paths, subject only to existing explicit output sanitization.
2. Confirm order: base tone -> curves/HSL -> local layers -> manual liquify/repair -> background -> automatic reshape. Noncommuting fixture must detect an accidental order mismatch.
3. Source hashes, bytes, source revision, original dimensions, learned masks and manually captured selection/repair snapshots remain byte-identical before/after edits and save/open/export.
4. Schema 3 round-trips the new fields in settings, committed, undo, redo and exportedSettings with independent ownership. Old v1/v2/v3 snapshots missing them get neutral defaults. Malformed-present payloads reject the entire project before replacing a session. No schema version bump or dropping unknown malformed data.
5. A new/reset photo is neutral. Parameter input previews continuously and one completed gesture creates one history step. Undo/redo restores curves/HSL and histogram pixels. Reset curve, reset band, and reset all have exactly defined scopes.
6. Preset application either resets or preserves user curves/HSL according to the disclosed design; test it. The current preset mechanism spreads defaults, so it will reset any new fields unless deliberately changed. No accidental sharing of mutable nested defaults between photos/presets/history.
7. Global tone sync copies tone parameters without copying or changing destination selection, repair, liquify, local layers or learned masks. Each target has an independent undo snapshot. Changing the source later does not mutate targets.
8. Unavailable core disables controls with an honest message; normal controls work without detected faces or successful model initialization. Export uses the new fields even when no faces/masks exist.
9. Switching photo during a pending render, newer slider input, cancellation, view close, failed render and project open all prevent late histograms or old image pixels from replacing current state. Verify image and histogram share a token/version association.
10. Export snapshots are immutable through mid-export UI changes; cancel prevents write; retry uses the same failed-item snapshot and never repeats saved items. Tone-only 24 MP original plan remains full-size; adding an existing expensive/manual effect retains its existing 16 MP rejection. Do not change ceilings just for a histogram.
11. Hiding/showing histogram, pan/zoom and compare does not alter project dirty status or create history entries. Histogram overlay is never encoded into PNG/JPEG.
12. Test keyboard/pointer interruption if a draggable curve editor is provided: lost pointer capture, pointercancel, Escape, photo switch, reset and close must not commit an unintended stale drag. Numeric keyboard controls are a valid simpler first implementation, provided they edit real curve points and are clearly labeled.
13. Inspect 1100×680 and a taller viewport if permitted tooling exists. Controls remain reachable through the parameter scroll area, and no text/plot overlay blocks the export/undo controls. Do not represent DOM doubles as a pixel/layout pass.

## 6. Regression and evidence gates

Run the focused new suites first, then the complete existing `npm test` command against the final merged source. Record failed and unrun checks honestly; do not substitute a curated subset for a full pass. Run Node syntax checks on every modified CJS/JS entry. Verify local script references and unique IDs through the existing asset test.

Use synthetic pixels and existing authorized public-fixture files only. Public portrait inspection is informative, not a broad professional-quality benchmark. No new downloads, model execution, private photos, APIs, secrets, Windows/GPU access or installer publication are required for this milestone. Release/install artifacts and native acceptance remain distinct from source completion.
