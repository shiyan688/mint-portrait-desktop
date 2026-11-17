# Independent desktop-profile review

Reviewed and run on 2026-10-22 UTC with Node v24.19.0. This is an isolated
candidate review, not production integration approval. The reviewer changed only
`tests/independent-review.test.cjs` and this evidence file; no source was changed.

## Reproduce

From this candidate's `profile` directory:

```sh
node --test tests/independent-review.test.cjs
```

By default, the test reads the sibling frozen baseline at
`../../mobile-oct22/薄荷人像/app/src/main/assets/image-overlay.js`. To use another
location, set `IMAGE_OVERLAY_FROZEN_SOURCE` to the baseline file path; a relative
override is resolved from the command's working directory. Both the default
route and the explicit environment override were tested successfully. The test
needs only Node built-ins, not downloaded dependencies. Its expected baseline SHA-256 is
`800751bc88f2539e51f742d57fe6287b44c2c2c8c74f958d297cf878790d579c`.

Reviewed candidate SHA-256:
`be527c529e013f706bfdc39b6970bbed3d2b0e33f75ac1f7c016cf6576a33b87`.

Review test SHA-256:
`8bb6160ab8acf8df113431998eeefbdf91790f8723c0889d2c99e5b4ca6bcd8d`.

## Result and coverage

Both commands exited 0. Each run passed all 8 tests; 0 failed, skipped, cancelled
or todo. Reported durations: 414.523945 ms with the default baseline path and
439.029065 ms with the explicit environment override. Timing is not a performance
guarantee.

```text
✔ independent: reverse normalization reproduces the exact frozen baseline
✔ independent: default limits are unchanged and desktop profiles are fixed and isolated
✔ independent: profile selector rejects unknown names, coercion and all extra arguments
✔ independent: desktop dimension boundaries remain mandatory at zero opacity
✔ independent: strict metadata rejects hidden fields, accessors, extras and unsafe prototypes
✔ independent: native attached fixed non-shared buffers remain required; safe offsets work
✔ independent: 200 seeded differential compositions and plans match the frozen original
✔ independent: maximum-canvas plans document extra-memory accounting, not total memory
tests 8
pass 8
fail 0
cancelled 0
skipped 0
todo 0
```

Reverse normalization removes only the enumerated candidate comment, named
factory/desktop selector, four conditional limits and `createProfile` export.
The resulting text equals the frozen original exactly. Asset, record, native
buffer, filtering, compositing, geometry and accounting code is unchanged.

The desktop limits are exactly 16,777,216 target pixels, 16,384 target edge,
134,217,728 managed extra bytes and 256,000,000 work units. Default limits equal
the original. APIs and limit records are frozen, and each profile has separate
API/functions/limit-record identities. Unsupported selectors, objects, boxed
strings and extra arguments reject without coercion. No override interface is
present.

The 200-case generator uses seed 725238 and a fully specified 32-bit LCG. It
compares original, candidate default and candidate desktop layouts/output bytes
for random RGBA inputs, non-square assets, arbitrary rotations, flips, positions,
opacity and scale, including minification. These are differential regression
checks, not an independent rendering oracle: they establish parity with the
frozen original, not the original algorithm's absolute correctness.

Negative tests independently exercise hidden/accessor/missing/extra/symbol fields,
unsafe record prototypes, Buffer, subclassed views/buffers, wider views,
DataView, mismatched lengths, foreign-realm/proxy/shared/resizable/detached views,
and safe native subarrays with ignored shadow getters. The current Node runtime
supports both shared and resizable buffers, so those conditional checks ran.

Maximum-size tests here are layout/admission checks, not actual maximum-size
rendering. They admit 4096×4096, 16384×1024 and 1024×16384 targets at zero opacity
and reject over-limit dimensions. Actual compositions in this review use small
targets. Separate main-qualification rendering/allocation tests are not counted
as these 8 independent tests.

## Precise caveats

No candidate-introduced defect was found within this review's scope. This does
not establish desktop UI, import, export, project, packaging or native runtime
integration correctness.

- **128 MiB is managed extra allocation, not total memory.** A valid
  16384×1024 target with a 1024×1024 asset, size 0.02 and rotation 37° has a
  plan of 84,574,208 extra bytes (80.65625 MiB). The caller-owned target adds
  67,108,864 bytes (64 MiB), already exceeding 128 MiB combined. Caller asset
  strings, other pipeline stages, retained layer outputs, callback allocations
  and JS/runtime overhead are additional exclusions. The parent needs aggregate
  admission and allocation-failure handling. Summing planned layer allocations
  should not assume timely garbage collection. Independently summing maximum
  components gives a conservative upper bound of 2 MiB + 4 MiB + 64 MiB +
  349,525 × 32 = 84,585,120 bytes. This component-wise bound does not assert that
  a particular admitted layout simultaneously attains every component maximum.
- **Work units are not CPU instructions or a latency guarantee.** A full-canvas
  4096×4096 plan reports 111,531,352 units and 73,400,320 extra bytes. The unchanged
  accounting arithmetic and bounded integer indices remain far below the
  2^53 safe-integer ceiling at the desktop caps; floating-point edge coverage
  remains the existing algorithm, not an analytic-coverage proof.
- **Cancellation stays synchronous.** A UI-event cancellation mechanism needs
  worker/orchestration support. Callers/hooks must not mutate or detach source
  buffers while a call runs. The core's input checks cannot prevent a callback
  from subsequently doing so.
- **Frozen APIs are not a hostile-JavaScript sandbox.** Proxy reflection traps
  and globally monkey-patched intrinsics remain outside the frozen core's
  plain-data contract. Record accessors are rejected without ordinary getter
  execution; that is not a claim that all Proxy traps can be prevented.
- **The profile does not admit arbitrary 16,384-square images.** Both pixel and
  edge caps apply even to zero-opacity overlays, and budget admission is still
  required. The larger profile is not a claim that every desktop pipeline size
  or every composition is supported.
