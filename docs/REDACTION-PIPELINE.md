# Desktop final-canvas redaction

This development integration is local deterministic RGBA processing. It adds no
models, network calls, codecs, file permissions, installer changes, or dependency
versions. Tests use synthetic identifiers and synthetic pixels, not downloaded
portraits. The shared raster mathematics in `src/redact-core.cjs` are unchanged;
the desktop adapter explicitly selects its `desktop` profile.

## Stage ownership and order

The formal composition order is:

1. Existing healing, portrait/tone/local/manual/background/shape effects.
2. Integer framing: crop, quarter-turn, and flip.
3. Canvas padding.
4. Validated text-layer raster compositing.
5. Final-canvas redaction.
6. Explicit final output-size reduction, if requested.
7. Export privacy sanitization and PNG/JPEG encoding.

Strokes are normalized coordinates in the final composition, not the bounded
screen preview. Text cannot be added after redaction. A PNG cover writes the exact
requested RGB with alpha 255 in its hard covered pixels. JPEG is deliberately
lossy and flattens transparency onto white, so decoded JPEG RGB need not exactly
match the recipe. Final Lanczos reduction can blend boundary pixels, but never
runs before or in place of the full-resolution redaction stage.

`Pipeline.render` normally sends redactions to the pure pixel worker, which
applies them after padding. That worker rejects nonempty text recipes because it
cannot rasterize fonts. A caller owning text composition must explicitly pass
both `deferTextLayers: true` and `deferRedactions: true` when both stages are active,
then composite text and apply redaction exactly once. Missing dependencies, stale
recipes, incomplete stage ownership, and invalid budgets reject before a worker
starts. Deferred rendering still plans the actual final redaction raster.

Source-coordinate/manual diagnostic views explicitly omit framing, padding,
text, and redactions. White-balance input sampling likewise omits final stages.
These are diagnostics, not completed exports, and never mutate saved settings.

## Recipe and binding

`settings.redactions` defaults to `null`. A non-null value is an ordinary data
record with exactly `version`, `sourceRevision`, `geometryKey`, and `layers`.
Each layer has `id`, `name`, `enabled`, `recipe`, and `selection`. The recipe is the
shared core's bounded mosaic/cover recipe. No raster, path, URL, image identifier,
or external resource is accepted in a layer recipe.

Every persisted settings slot is validated independently against the immutable
photo source revision and that slot's canonical framing, padding, manual-liquify,
and facial-shape settings. Tone and text changes do not move the geometry.
Changing geometry makes existing strokes stale; they are not silently moved,
cleared, rebound, or skipped. Source revision also binds selection snapshots.

Selection masks are rasterized in the actual pre-geometry processing-source
size, then transported through the same exact framing and padding. Preview and
explicit working-size export therefore use their processing dimensions, while
original-size export uses the original decoded dimensions. Padding outside a
source selection has zero selection coverage. Selected redaction with shape
warps is rejected rather than using a stale unwarped selection. Opaque cover
requires an unfeathered binary selection.

## Project format

The writer emits project version 11. Versions 1 through 10 remain readable;
missing historical redactions migrate to `null` in current settings, committed
settings, undo, redo, and exported-settings records. Version 11 requires an
explicit field in each of those settings records. Present malformed historical
values are rejected rather than treated as neutral. Owned recipe snapshots are
made before asynchronous hashing. Project source bytes are kept unchanged.

A project intentionally retains its original image and editable recipes. It is
not a privacy-redacted deliverable and should not be shared as one. Share the
completed PNG/JPEG when only the redacted output should be disclosed. Exported
files do not retain source EXIF, XMP, or IPTC metadata; only the existing sRGB
output profile is added. Fully transparent output RGB is scrubbed after final
resizing. Neither export sanitization nor redaction rewrites source bytes.

Existing project source/cache/container/node/string limits remain in force. No
new raster cache or automatic materialization is stored. Save and open validation
rejects accessors, unsafe prototypes, unknown fields, malformed selections, and
stale bindings even if imported JSON has a correctly recomputed checksum.

## Resource and cancellation boundaries

- At most 8 layers, 64 aggregate strokes, and 4096 aggregate stroke points.
- Redaction canvas: at most 16,777,216 pixels and 16,384 pixels on either edge.
- Shared per-layer work limit: 64,000,000 bounded work units.
- Adapter aggregate work limit: 128,000,000 units, with a 128 MiB extra-buffer
  accounting limit. These measure bounded visits/allocations, not elapsed time.
- A selected source mask independently obeys the redaction raster size limits.
- Native source and other existing effect/text/padding limits remain unchanged.

Native `sizePlan` invokes the actual redaction planner before final output sizing.
A tiny requested output cannot admit an over-budget full composition, selected
source mask, or expensive layer stack. An otherwise valid 64MP native source may
be cropped to a valid redaction canvas when there is no selected redaction; the
entire source is not unnecessarily subjected to the redaction canvas limit.
`validateRequest` and pure replay bind preflight to the explicit source revision;
standalone dimension planning also accepts a sixth context argument for this.

Pure replay accepts an optional fifth `options.shouldCancel` callback. Shared
cores poll cancellation; aborted outputs are discarded. Browser/native job
cancellation terminates the worker and prevents result publication. Immutable
source bytes and settings remain reusable for the next render.

Mosaic is visual obfuscation, not a guarantee that sensitive content cannot be
inferred. Use opaque cover with adequate margin for privacy-critical content and
review the final exported file. This feature does not perform automatic personal
data detection or claim cryptographic redaction.

## Verification

`node --test tests/redaction-integration.test.cjs` exercises:

- Real checksummed v1–v10 migration and all v11 settings/history slots.
- Recipe ownership, malformed/accessor rejection, and stale source/geometry.
- Worker/native byte-exact ordering with framing, padding, selection, and text.
- Real Sharp PNG/JPEG files, dimensions, RGB/alpha behavior, source metadata
  stripping, source immutability, and working/final resize separation.
- Preflight pixel/edge/work budgets, cancellation and subsequent reuse.
- Browser scheduler ownership/defer/diagnostic behavior using VM/Canvas doubles.

The scheduler doubles are not native desktop UI or visual-browser QA. Installer,
user-computer smoke tests, and visual UI acceptance require their own evidence.
