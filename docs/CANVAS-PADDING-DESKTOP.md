# Desktop canvas padding integration

## Scope and frozen shared core

Canvas padding adds a non-destructive border after the existing render pipeline. It does not resample, crop, alter source-coordinate tools, rewrite source files, or call a model/API. It is reapplied from the retained unpadded upstream image for each render; an earlier padded preview must not be used as the next input.

`src/canvas-padding.cjs` is a byte-for-byte copy of the reviewed shared `MintCanvasPadding 1.0.0` core, with no desktop math fork:

- SHA-256: `91412cfaefd331c6fc5fffb8f9f58256dd25eb6306de6511cdec1cd2a2deb995`
- CommonJS export: `require('./src/canvas-padding.cjs')`
- Browser global: `MintCanvasPadding`
- Public API: `version`, `LIMITS`, `defaults`, `validate`, `measure`, `plan`, `apply`
- Shared hard ceiling: 67,108,864 pixels and 16,384 per edge. The desktop adapters deliberately enforce the tighter limits below.

## Recipe and project schema

Both project and browser defaults include `canvasPadding: null`. `null` disables the step. A non-null recipe must carry all seven fields:

```js
{
  version: 1,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  color: '#ffffff',
  opacity: 1
}
```

Each side is a finite numeric fraction in `[0, 0.5]` of the current input's short edge, independently quantized with `Math.round`. Here the current input is the image **after final framing**, not the original photograph. Color must be exactly six hex digits prefixed by `#`; alpha is a numeric fraction in `[0, 1]`. The shared validator normalizes case and negative zero. No partial merge, coercion, unknown field, accessor, hidden field, or custom-prototype record is accepted.

Project format is now **8**; readers retain support for versions **1–7**. Missing `canvasPadding` is migrated to explicit `null` in every legacy current, committed, undo, redo, and non-null exported-settings record. A schema-8 writer or reader requires the field explicitly in every such record. A present malformed recipe is rejected even in a legacy document; correctly recomputing metadata hashes does not bypass schema validation. Null exported-settings records remain valid.

Recipe validation does not require the retained original's theoretical expanded canvas to fit a render budget. Source/project metadata limits are unchanged. Renderability is determined later against the actual selected processing dimensions. Recipes and source bytes are copied through the existing codec, so current, committed, history, and exported recipes do not alias one another.

## Pipeline ordering and source coordinates

The order remains:

1. Existing spot repair and face beauty.
2. Basic tone, Levels, advanced tone, and local adjustments.
3. Manual liquify/repair.
4. Background treatment and automatic face reshaping.
5. Existing framing: integer crop, quarter turn, flips.
6. **Canvas padding**, using the post-framing short edge.
7. Existing encoder privacy/alpha policy.

Manual selections, repair strokes, meshes, learned mattes, caches, source identity, and revision coordinates remain unchanged. Both framing and padding adapters pass only `{width, height, data}` to their strict cores, excluding transient liquify diagnostics.

`manualEditing` and `sourceView` suppress both framing and padding in ephemeral render settings. They do not change the stored recipe. Manual editing retains its existing suppression of incompatible background/automatic reshape effects. Source inspection still retains other edits. A full preview/export restores the final framing and padding.

## Dimensions and budgets

### Native desktop export

`export-render-core.cjs` performs preflight in this order:

1. Validate original dimensions, before any crop: **64,000,000 pixels / 16,384 per edge**.
2. Select original or explicit working processing size using the existing policy. Working source selection still caps its long edge at 4,096 and pixel count at 16,000,000. Expensive portrait/manual/masked effects retain their existing source-processing limits.
3. Compute framing dimensions.
4. Call shared padding `plan` with **64,000,000 pixels / 16,384 per edge**.

Padding cannot influence or silently shrink step 2. An excessive final canvas throws; it is never scaled, clipped, or silently cropped. For example, explicit working processing of an 8,000 × 8,000 source remains 4,000 × 4,000 before framing; maximum four-sided padding can produce an 8,000 × 8,000 final native canvas without changing that processing choice.

The plan keeps `processingWidth`/`processingHeight` pre-framing and `originalWidth`/`originalHeight` at oriented source dimensions. `width`/`height` are final dimensions. `scaled` describes source downsampling, not border growth. `framed` keeps its existing meaning. New `padded` is true only when **quantized** padding actually increases a dimension, so a non-null zero or subpixel-to-zero recipe reports false. Native worker envelopes carry the plan, and the renderer verifies `padded` along with all existing size fields and actual encoded dimensions.

### Browser scheduler and pixel worker

The existing browser source-canvas budget remains **16,000,000 pixels**. Preview source sizing is unchanged, including the application's 1,280-pixel preview source. The pixel worker keeps its existing direct input ceiling of **16,777,216 pixels**.

Both scheduler and worker plan padded final output at **16,777,216 pixels / 16,384 per edge**. The worker preflights before effects and allocations; it first checks its original input budget, so a small crop cannot hide an oversized source. The browser encoder accepts that same final-canvas budget rather than incorrectly reapplying the smaller source-canvas limit to a valid border-expanded result. Browser fallback export still has its existing smaller source-processing limits; native and browser source budgets are not interchangeable.

Missing browser padding code fails closed for a non-null recipe. The scheduler computes the expected final size before reading pixels or starting a worker, snapshots recipe settings for queued work, validates result dimensions and byte lengths, and keeps existing cancellation/stale-result handling. No implicit preview-source resize is performed to fit padding.

## Alpha and export policy

The shared core copies source RGBA bytes exactly, including nonzero RGB underneath zero alpha. Border pixels use straight alpha, `Math.round(opacity * 255)`. Quantized-zero border alpha gives zero RGBA bytes. Source/background pixels are not blended with the new border.

The native exporter retains its existing subsequent policies:

- PNG zeroes hidden RGB under alpha zero **in the output only**; partial-alpha colors remain straight RGBA.
- JPEG explicitly flattens transparency onto white and uses the existing quality/profile settings.
- Original compressed bytes and retained source RGBA are not rewritten.
- User framing is not repeated at export, and padding causes no final resize or crop.

The browser encoder keeps the analogous existing PNG/WebP hidden-RGB sanitization and white JPEG flattening. Native sharp encoding is separately tested; browser tests use deterministic Canvas/Worker doubles and are not a claim of real Chromium/Windows UI validation.

## Verification

Direct Node tests, no package installation, new dependencies, browser/socket launch, or model download:

```sh
node --test tests/padding-project.test.cjs tests/padding-pipeline.test.cjs tests/padding-browser-pipeline.test.cjs
```

The initial integration suite has 52 cases covering:

- Frozen shared bytes and strict recipe validation, including non-invoked accessors.
- Project v1–7 migration, schema-8 mandatory fields across all settings/history slots, and correctly hashed malformed imports.
- Byte-exact neutral, asymmetrical, opaque, transparent, partial-alpha, and quantized-zero worker/native behavior.
- Final-stage placement after framing, Levels/local/manual edits, and diagnostic stripping without framing.
- Learned mask/cache/source-coordinate preservation and fixed processing dimensions.
- Original-source limits before crop, stricter desktop 64,000,000 versus shared 64 Mi limits, edge limits, and fixed working source selection.
- Real native PNG pixels and JPEG bytes versus pure-core expected results, including source privacy sanitization, EXIF orientation, explicit working resize, and null/default byte invariance.
- Scheduler source/manual views, queued snapshotting, missing component errors, over-budget preflight, malformed output, cancellation, stale completion, and final encode budget.

The parent integration owns application UI/history interactions and updates to existing version/metadata assertions. These additions alone do not produce a signed installer or establish Windows visual validation.

## Desktop controls and bounded display integration

Right rail: 边框与留白. Four independent percentages (0–50 of the post-framing short edge), color and opacity remain unapplied form values until explicit Apply. Cancel and Reset are separate; Reset is an undoable settings operation. Form values bind to the photo object, source revision, history revision and framing/padding recipe. Photo/history changes invalidate them. They do not enter project/recovery fingerprints, saved records, exports or shutdown dirty state. Save/export messaging explicitly warns when values remain unapplied.

Canvas padding is photo-specific. Both built-in parameter presets and cross-photo adjustment synchronization preserve each target’s border. Portable adjustment preset v2 is unchanged and does not transfer geometry. No desktop/mobile project interchange is claimed.

The display layer alone resamples a border-expanded preview back to a maximum 1280 edge. It first verifies the full worker raster dimensions, rejects stale completions, then constructs a disposable display canvas. The matching original/Space/wipe comparison uses the same framing/padding and display reduction. This retains the existing reference and pixel-inspector 1280 / 6.25 MiB cache budgets. It does not change the input source, recipes, native or browser export pipeline, or full-resolution output dimensions. Pixel readout remains explicitly sampled preview values, not original 1:1 inspection.

Crop gestures reject presses on the added border, clamp drags to the photo-content rectangle, and map through the preview’s actual integer padding and framing before original-coordinate inverse geometry. Crop overlays add the same border offsets. Source-coordinate manual/diagnostic views suppress framing and padding without deleting either recipe. Framing is applied before padding, so later crop changes recalculate each percentage against the newly framed short edge.

System-font downloads, text rendering, model execution and new packages are not part of this milestone. Source-level DOM/Canvas harness checks and actual native codec exports are not a browser-layout, Windows or device acceptance claim.
