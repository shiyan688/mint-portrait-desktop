# Light-balance chroma reconstruction review

Status: candidate approved for production promotion on 2026-10-22 after both reviewers inspected the actual portrait sheet. This is not a release approval or a claim that production/native verification has completed. At the initial review time, `src/light-balance.cjs` remained byte-for-byte at SHA-256 `b33b2cc55dbd5943dc07db4baf42f6af68e61c62951751c5dc5774063a272531`.

## Decision

Use common linear RGB scaling for tone instead of a convex mix toward white. This fixes the specific avoidable gray/washed-out shadow lift visible in the two existing public portrait fixtures, while preserving the API, recipe, white-balance estimator, scalar tone curve, strict input handling and cancellation policy. It does not establish broad photographic-quality acceptance or a natural-beauty default.

Candidate: `quality/light-balance-qa/chroma-candidate.cjs`, SHA-256 `bfd8cb0be2fbdaea50ce59b5646cf6a99ae3a980fdb97cd554a901761860dac1`.

The exact rejected white-mix core is retained as `quality/light-balance-qa/desaturating-tone-control.cjs`. It is an explicit test control, never a fallback engine or shipping alternative. The even earlier maximum-chroma gamut algorithm remains a second negative control in the test file; its original failure has not been removed.

## Minimal transform change

Linear decode, white-balance gain multiplication and its common-maximum gamut normalization remain unchanged. Let corrected bounded RGB be `B`, luminance `L`, target luminance from the unchanged eased log-odds curve `Y`, and `m = max(B)`.

- For `L > 0`, form `T = B * Y/L`.
- Let `M = max(1, max(T))`.
- Output linear RGB is `T/M`, followed by the same one-time sRGB encoding and rounding.
- At `L = 0`, output black. All positive luminance weights imply every corrected channel is zero in that case.

No separately clipped RGB channel is used to obtain gamut. The final encode clamp still only protects numerical roundoff. There is no intermediate byte quantization.

### Guarantees and limits

Every output channel is the input corrected channel times the same nonnegative multiplier. Corrected linear RGB ratios therefore survive before quantization, including gamut-limited cases. Zero channels remain zero. This is an algebraic property, not a claim of constant perceptual hue, HSL hue or perceived saturation.

For in-gamut `T`, luminance reaches `Y` before quantization. If `M > 1`, output luminance is `Y/M < Y`. Equivalently, for nonblack colors it is `min(Y, L/m)`. Gamut-limited saturated colors cannot brighten beyond that chromaticity's display boundary without sacrificing the ratios. In particular, a pure `[255,0,0]` primary cannot become brighter under positive shadows while preserving its RGB direction. The tests demonstrate this deliberately, instead of falsely claiming target luminance is always reached.

The scalar tone curve remains strictly increasing on `(0,1)` by the existing derivative proof. Unity-WB grayscale has `m = L`, so its target is always within gamut and the original monotone, fixed-black/fixed-white behavior is retained. For a fixed corrected chromaticity ray, the gamut cap can flatten the response. Across different chromaticities, luminance ordering is not promised.

The map remains continuous before quantization, but common-maximum normalization has derivative kinks where the limiting channel or gamut state changes. It is not a universal no-banding solution. At near-black, `Y/L` has a finite limit equal to the bounded log-odds scale; the zero-luminance branch avoids division by zero. The explicit near-black cube test complements this argument.

## Measured numerical evidence

`node --test tests/light-balance-chroma-candidate.test.cjs` passes 40/40 tests. The evidence generator adds the local portrait-render test and passes 41/41:

`node quality/light-balance-qa/render-chroma-evidence.cjs`

The generator's implementation is in the opt-in final test block. It uses only existing local fixtures and existing Sharp; no install, browser, network, private photo or model is used. It regenerates `chroma-report.json` and `chroma-comparison.png`. Regeneration resets the report's manual visual-inspection status until somebody actually opens the new PNG again.

The original five saturated hue traversals still enforce the unchanged maximum adjacent-channel step of 8 codes:

| Algorithm | Case 1 | Case 2 | Case 3 | Case 4 | Case 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earliest rejected maximum-chroma control | 18 | 17 | 48 | 32 | 52 |
| Rejected white-mix control | 7 | 8 | 5 | 2 | 3 |
| RGB-ratio candidate | 2 | 2 | 2 | 8 | 3 |

Case 4 gets worse than the white-mix control, from 2 to 8, but still meets the original bound. No threshold was relaxed. The broader 243 gain/tone-corner sweep falls from 15 to 13 codes; both exact results and their locations remain recorded. The candidate's worst case is shadows `+100`, highlights `-100`, gains `{r:0.25,g:4,b:0.25}`, at pixel 1023 in green. A 16:1 relative gain can still amplify a one-code hue input step substantially.

The new tests retain all 35 original categories, adapting only the independent reconstruction reference and its measured numeric snapshots. They cover 48,128 random/extreme scalar-reference pixels, 1,206 monotone grayscale recipe ramps, neutral object and byte identity, exact alpha/hidden RGB, source immutability, sample quality and range errors, malicious descriptors/prototypes/storage, size limits, callback cancellation and detachment. Additional checks cover:

- More than 1,400 in-gamut color/recipe combinations: actual bytes equal an independently calculated one-rounding reference whose corrected RGB cross-ratios are exact before quantization and whose luminance reaches the target.
- Six representative synthetic skin-color swatches under moderate `+25/-25`: absolute linear-ratio saturation drift stays below 0.006 after 8-bit rounding. On the four darker/midrange swatches, the old algorithm loses 0.0375–0.0976 saturation while the candidate's absolute drift is at most 0.0049.
- Explicit out-of-gamut target-luminance sacrifice and a mismatch from independent channel clipping.
- All 4,913 colors in the `[0,16]^3` near-black cube under 18 recipes, compared byte-for-byte to the independent scalar reference.
- Candidate source outside the single reconstruction block is identical to the preserved baseline.

The saturation diagnostic is `1 - min(linear RGB)/max(linear RGB)`. The swatches are synthetic numerical witnesses, not a claim about correct skin rendering, the people in the portrait fixtures, or a perceptual metric.

## Actual portrait inspection

I opened both the previous `portrait-contact.png` and the new 1960×1308 `chroma-comparison.png` using local image inspection at original detail. The new sheet has original, old `+25/-25`, candidate `+25/-25`, old `+50/-50`, candidate `+50/-50`, old `+100/-100`, candidate `+100/-100` columns. Rows show Victor Glover, Chiaki Mukai, and a larger Victor face-detail crop.

Observed pixels, not just tests:

- At `+25/-25`, Victor's candidate skin remains warm and the shirt remains blue while shadows lift; the white-mix control has an avoidable gray veil, most visible around the cheek, jaw and neck. The candidate is closer to the original chromatic character, not merely brighter.
- At `+50/-50`, that difference is clearer. The candidate preserves the relative color of facial highlights/shadows and the clothing; the old control noticeably washes them out.
- Mukai's moderate candidate panels likewise retain hair/clothing and facial color better than the old control. No new obvious white bands or spatial halos appeared in these viewed panels. This is a limited observation, not a no-halo/no-banding guarantee for all images.
- At `+100/-100`, the candidate is deliberately brighter and vivid, with strongly lifted shadows and reduced tonal depth. The old control is dramatically gray/matte. Neither extreme is being accepted as a natural-beauty default, and ratio preservation does not prove aesthetic quality.

Every one of the 14 full-resolution PNG variants was decoded again and matched its direct core output exactly. Original source buffers stayed unchanged. This is core-to-Sharp PNG readback, not native export/preview parity; the parent must rerender the production pipeline after integration.

The public NASA fixtures are used only for private informational QA. Existing attribution is in `quality/levels-qa/visual-evidence.json` and `quality/advanced-tone/README.md`. No training, upload, marketing, endorsement or shipped stock-asset use is claimed. Only two portraits were tested, not a representative skin/lighting/camera benchmark.

## Parent integration checklist

1. Inspect the actual candidate sheet and approve or reject this conventional reconstruction policy.
2. If approved, replace the production core with the exact candidate and update the main contract's reconstruction and limitation language. Keep recipe/API/version and sampling unchanged.
3. Update production core reference tests and their measured snapshots while retaining the original eight-code gate and both old-control counterexamples. Do not replace all existing tests with the candidate suite blindly.
4. Rerender real native PNG exports and all shared-stage/preset hash parity with the promoted SHA, then recheck desktop/mobile use of the same bytes.
5. Keep quality assets and control engines out of release installers. Record that natural-beauty quality, Windows/UI, Android device/GPU and color-managed-display QA remain separate verification tasks.
