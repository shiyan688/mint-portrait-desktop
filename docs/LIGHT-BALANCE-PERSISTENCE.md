# Light-balance candidate: desktop persistence and pipeline contract

This is conventional, deterministic, display-referred processing. It adds no model,
network request, RAW reconstruction, clipped-detail recovery, or SOTA claim. It is a
candidate integration, not native GUI/model quality certification.

## Recipe and shared stages

`settings.lightBalance` is explicitly `null` by default. A non-null recipe is exactly:

```json
{"version":1,"shadows":0,"highlights":0,"whiteBalance":{"r":1,"g":1,"b":1}}
```

Shadows/highlights are finite numbers in [-100,100]. Each white-balance gain is a
finite number in [0.25,4]. Null and the shown identity are exact pixel identities.
Unknown keys, accessors, hidden/symbol fields, unsupported versions, missing fields,
nonfinite values and out-of-range values are rejected rather than disabled.
Only gains and control values persist. Neutral-patch coordinates, source pixels,
photo IDs, paths and diagnostic sampling state do not belong in this recipe.

The classic pixel worker and native export core use the same shared
`src/light-balance.cjs` implementation. The order is:

1. Healing spots, then existing face beauty.
2. Existing basic `Local.tone` (exposure, contrast, saturation, temperature).
3. Light balance.
4. Levels, then advanced tone.
5. Local layers, manual tools, background, reshape.
6. Framing, canvas padding, then the established text composite.
7. The existing final-output-size stage, in native export, remains last.

The new stage is global pixel processing, not a complex portrait effect. By itself
it does not reduce the native 64,000,000-pixel / 16,384-edge basic-processing budget
to the existing 16,000,000-pixel complex-processing budget. Small output-size
requests still cannot bypass source, intermediate, text or complex-effect limits.
Preview budgets, immutable original bytes, analysis revision checks, cancellation
via worker termination, and existing output-size semantics are unchanged.

## Diagnostic sampling input

`pipeline.js` exports `lightBalanceInputSettings(settings)`. It returns an owned
settings record; it never mutates a photo, history or the supplied recipe.

Retained fields are exactly:

- Healing: `spots`, deeply cloned.
- Beauty: `smooth`, `brighten`, `warmth`, `underEye`, `redness`, `lip`, `blush`, `palette`.
- Basic tone: `exposure`, `contrast`, `saturation`, `temperature`.

All other default fields are reset: `lightBalance`, `levels`, `advancedTone`,
`manualSelection`, `framing` and `canvasPadding` become null; `localLayers`,
`manualLiquify`, `manualRepair` and `textLayers` become independent empty arrays;
`slim`, `eyes`, `nose` and `jaw` become zero; `bgMode` becomes original, with default
background parameters. Non-default learned-matte IDs/strokes and parsing/overlay
metadata are omitted. Unknown fields are not copied.

The caller must use the same original/working source revision, dimensions, existing
face-analysis meshes and cancellation lifecycle as ordinary rendering. Beauty still
requires its normal valid analysis; this helper neither performs inference nor
bypasses analysis requirements. It is a diagnostic-only recipe, not a saved setting
and not a generic worker `stopAt` interface. Patch coordinates must be bound by the
UI to this pre-stage view, never sampled after light balance/Levels/curves/framing.

## Project documents

The writer emits project schema 10, reading schemas 1 through 9 as legacy. Every
current, committed, undo, redo and non-null exported-settings record in a schema-10
document must explicitly carry a valid `lightBalance`, including on encode. Legacy
records with the field absent migrate to null; a malformed present field is rejected
even in an old version. Valid legacy records retain their edits and source bytes.
Existing source-revision, selection/mask ownership, bounded histories, metadata,
cache and immutable-source integrity protections remain in place.

Version 0.2.4 reads at most project schema 9 and cannot open new schema-10 files.
Keep the original old project if it must still be opened with 0.2.4. This candidate
does not overwrite or downgrade a future document by guessing its schema.

## Portable presets

The codec writes portable preset version 3 and reads exact versions 1 and 2.
Version 3 `controls` is exactly `basic`, `beauty`, `lightBalance`, `levels`, and
`advancedTone`. Legacy v1/v2 controls retain their strict historical whitelist and
migrate `lightBalance` to null; v1 also migrates absent Levels to null. Unknown
versions are rejected, not relabeled. Color-only application retains light balance
while neutralizing beauty.

`createCodec({advancedTone, levels, lightBalance?})` accepts the trusted shared
light-balance module as an optional dependency. Desktop app and main preset-store
validation supply it. Older callers without the module can still use legacy
presets and v3 null/exact-identity light-balance recipes. Active v3 recipes fail
closed without the module. An explicitly supplied invalid dependency is rejected.
The codec continues descriptor-only bounded cloning/parsing and never persists
sampling positions, pictures or paths.

## Verification scope

`tests/light-balance-integration.test.cjs` covers native/classic-worker equality,
identity including alpha/hidden RGB, fixed order, diagnostic clone boundaries,
same-analysis sampling, real Sharp PNG readback and final resize ordering, both
cancellation lifecycles, 64MP planning, all old project migrations, every current
history slot, malformed-present legacy fields, strict portable migrations and
missing-module behavior, browser-realm codecs, and hostile descriptors.

These checks use synthetic images, Node VM scheduler/worker doubles, actual native
worker threads and installed Sharp. They do not launch a browser, run models,
install dependencies, regenerate frozen QA archives or certify photographic quality.
