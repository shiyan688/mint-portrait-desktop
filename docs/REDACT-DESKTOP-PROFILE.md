# MintRedact v1: bounded desktop resource profile

This module extends the existing authored mobile rasterizer with a trusted,
named resource profile. It adds no dependency, new image algorithm, recipe
field, model, network operation, or arbitrary limit override. This document
covers the pure core only, not editor/project/worker/export integration.

## Use

```js
const MintRedact = require('../src/redact-core.cjs');
const desktopRedact = MintRedact.createProfile('desktop');
const recipe = desktopRedact.validate(rawRecipe);
const plan = desktopRedact.plan(width, height, recipe);
const result = desktopRedact.apply({ width, height, data }, recipe, {
  shouldCancel: () => cancelled
});
```

CommonJS, browser-global `MintRedact`, and AMD entry points all default to the
original mobile profile. The only added public property is `createProfile`.
Every returned API and its `LIMITS` are frozen. Repeated calls return independent
API/limits objects; they do not mutate the default or other profiles.

`createProfile` accepts exactly one primitive string, either `'mobile'` or
`'desktop'`. No argument, extra arguments (including `undefined`), different
case/whitespace, boxed strings, objects, arrays, symbols, functions, and proxies
are rejected with `TypeError`, `code: 'REDACT_INVALID'`. Rejection does not read
properties, call getters, reflect on a proxy, or coerce the argument.

Select the profile in trusted application code, not from imported project JSON.
Recipes containing `profile`, resource overrides, or any other extra field are
still invalid. Profiles do not appear in the pixel recipe, and recipe version
remains **1**. No existing API gains an options field for limits or profile names.

## Exact limits

| Limit | Default / `mobile` | `desktop` |
|---|---:|---:|
| maxPixels | 8,000,000 | 16,777,216 (16 × 1024 × 1024) |
| maxEdge | 4,096 | 16,384 |
| maxExtraBytes | 134,217,728 (128 MiB) | unchanged |
| maxWorkPixels | 64,000,000 | unchanged |
| maxStrokes | 64 | unchanged |
| maxTotalPoints | 4,096 | unchanged |
| minRadius / maxRadius | 0.002 / 0.5 | unchanged |
| minBlockSize / maxBlockSize | 0.01 / 0.25 | unchanged |
| cancelIntervalPixels | 16,384 | unchanged |

Both dimension bounds are inclusive and apply even to zero-stroke recipes.
These are independent constraints: `16384 × 16384` is not allowed. Examples
within the pixel/edge dimensions include `4096 × 4096`, `16384 × 1024`, and
`1024 × 16384`, but a particular active recipe can still exceed the work budget.

### Fixed per-call budgets still apply

Let `P = width × height`, `S = sum(max(1, pointsPerStroke − 1))`, and
`C = ceil(width / blockEdge) × ceil(height / blockEdge)`.

- `segmentRows = height × S`.
- Active cover: `workPixels = 2 × P + segmentRows`.
- Active mosaic: `workPixels = 3 × P + segmentRows`.
- Active extra-buffer estimate: `2 MiB + 256 × totalPoints + 256 × strokeCount
  + 4 × P + 4 × (width + 1) + 160 × S + (mosaic ? 3 × C : 0)`.
- Neutral work is zero. Neutral extra estimate includes only the fixed 2 MiB
  allowance and recipe accounting, not an actual buffer allocation.

The plan is identical to apply's preflight and allocates no pixel, row, color,
or segment typed-array buffer. Dimension and resource failures throw
`RangeError`, `code: 'REDACT_LIMIT'`, before output allocation and before the
cancellation callback runs. No downsampling, skipped strokes, or partial success
is substituted.

The original work formula is intentionally unchanged and depends on height.
A `16384 × 1` mosaic with 4,095 segments plans 53,247 visits, while `1 × 16384`
with those same segments exceeds 64 million visits and is rejected. A
`4096 × 4096` mosaic with 4,095 segments is also rejected. UI and history replay
must plan the actual dimensions and current recipe rather than assume every
maximum can be combined.

The 128 MiB extra-buffer guard is unchanged. Even a deliberately loose bound
using all independent maxima, including `C <= P` and `S <= 4096`, is
121,323,524 bytes, below that cap. Thus no valid named-profile input can currently
reach that guard's rejection branch. Tests preserve the guard and prove this
bound rather than invent a configurable profile to force it. Work-budget and
dimension-budget rejection paths are dynamically tested before allocation.

The estimate excludes the source, decoded originals, runtime, Canvas backing
stores, encoder, whole editing pipeline, hook allocations, and deferred garbage
collection. It is neither a physical-memory reservation nor a speed promise.
The host still owns total-pipeline preflight and runtime allocation failures.

## Unchanged pixel and cancellation contract

The complete default module remains equivalent to the frozen mobile source
apart from the factory/export additions. The entire validation and raster body,
resource formulas, errors, typed-array handling, and cancellation checkpoint
placement are unchanged. Source-transform tests enforce this, not just sampled
output comparisons.

- Closed hard capsule union; normalized coordinates map to integer pixel-center
  coordinates using `x × (width − 1)` and `y × (height − 1)`.
- Radius is a fraction of the current image's shorter edge. The pixel cap still
  makes the maximum shorter edge 4,096, so the original numerical radius-fence
  bound remains applicable despite a larger permitted long edge.
- Cover writes exact selected RGB and alpha 255, including transparent input.
- Mosaic uses whole original-source, origin-anchored grid-cell alpha-weighted
  means with `Math.round`; source alpha and hidden RGB at alpha zero survive.
- Bytes outside the mask survive exactly. No source byte is written.
- Zero strokes return the exact input wrapper and buffer after validation and
  cancellation checking. Active operations return a new native
  `Uint8ClampedArray`, even if the resulting bytes are unchanged.
- Cancellation is synchronous/cooperative; it is not event-loop yielding. Abort
  throws `AbortError` / `REDACT_CANCELLED`; callback exceptions propagate. The
  caller must not mutate/detach source data while running.

**Mosaic is decorative, not secure redaction.** Opaque cover does not ensure the
user selected a complete region, remove originals, erase recoverable history,
or delete project data. Do not label either mode as secure original deletion.
Final export inspection and all integration behavior remain the host's job.

## Provenance and reproducible checks

Frozen control: `quality/redact-qa/mobile-core-control.cjs`, copied exactly from
the authored mobile `app/src/main/assets/redact-core.js` without modifying it.

- Frozen control SHA-256:
  `76feabea4b8b940bf26d9b807e2799ce5012ef6973841f38120770a537c9da61`.
- Desktop source SHA-256:
  `14abf070ebc42e9942e4a847d672ff4a53c1769ee66276de4e24ff86e6b62be8`.
- Original mobile test SHA-256:
  `8e5f9b0533f308863abc6666cdafefacbfbfdd212b9c12cb22dca6199c17b663`.

The desktop test file includes all 25 original mobile contract checks, changing
only their module path and additive-export expectation. A reconstruction hash
assertion proves no copied mobile assertion was otherwise changed.

```sh
node --check src/redact-core.cjs
REDACT_WRITE_REPORT=1 node --test --test-concurrency=1 tests/redact-core-desktop.test.cjs
```

The focused run passes **39/39** tests: the 25 copied mobile checks, 13 desktop
profile checks, and an evidence-write check. Evidence is replaced only when the
run exits successfully. `quality/redact-qa/profile-report.json` contains current
source/test hashes, all plans, counters, and the isolated allocation observation.

Additional coverage includes:

- Exact whole-source transformation proof and public function-source equality.
- 512 deterministic frozen-control differential cases across the default,
  named mobile, and named desktop APIs: 8,375,400 compared RGBA values, including
  subarray offsets, alpha-zero hidden RGB, partial alpha, and empty recipes.
- 48 independent pixel-distance reference cases on desktop-only long edges,
  comparing 5,501,440 RGBA values, including 16,384 × 1 / 1 × 16,384, subnormal
  slopes, cover, and mosaic.
- Strict profile validation without getters or proxy traps; UMD entry parity.
- Cancellation count equality, early/middle/final aborts, and hook exceptions.
- Inclusive pixel/edge plans, above-bound rejection, height-dependent work
  rejection, zero-stroke identity/cancellation, and instrumented no-allocation
  preflight paths.
- An isolated, serial real `4096 × 4096` full-image opaque cover from transparent
  synthetic input. The 67,108,864-byte output is checked byte by byte for
  `[18, 52, 86, 255]`; the source remains unchanged. Neutral identity and
  cancellation are also checked with that actual full-resolution input.

That one smoke run records process-memory snapshots, observed apply duration,
and output SHA-256. Memory metrics are observations in this cloud Node runtime,
not a platform bound or benchmark. No user images, new dependencies, browser,
model, network, external API, or user-computer execution are involved. These
checks do not establish editor UI, PNG/JPEG, worker, packaging, Windows, or
macOS acceptance.
