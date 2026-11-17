# Confirmed 0.2.7 untagged 16-bit RGB PNG export defect

This is a correction to a shipped code path, not an inference from the new overlay importer. The reproduction verifies the exact 0.2.7 ASAR SHA-256 `087c84b326e2a5a00a5541832f33fb9dd9b06975d35ea19d344123b8eef4d591`, matches its four native-export/project modules to restored checkpoint24, then executes that old native worker with the same pinned Sharp 0.35.5 on Linux. See `quality/image-overlay-qa/color-export-regression/shipped-results.json` and the runnable `reproduce-shipped.cjs`.

Untagged 16-bit RGB fixtures use channels equivalent to the listed 8-bit values. Old output: (18,170,237) → (0,173,243); (230,50,35) → (251,0,5); (18,35,40) → (12,35,41); (244,220,200) → (249,219,197). Neutral (128,128,128) and all corresponding untagged 8-bit fixtures were unchanged. Source file bytes were unchanged. This confirms native export in the tested cloud runtime; it does not independently establish Chromium import or Windows runtime behavior.

The old worker unconditionally applied `withIccProfile('srgb')`, even when no source ICC existed. The candidate applies ICC conversion only if decoded metadata reports a profile, then explicitly uses 8-bit sRGB output. It does not invent source ICC/gamma or recover a missing original color-space declaration. Tagged sRGB/P3 PNG/JPEG still take the explicit conversion path; untagged gray/CMYK retain their decoder conversion semantics.

`tests/export-color-regression.test.cjs` has 19 actual native regressions covering 8/16-bit colors, the old-failure negative control, tagged profiles, alpha/hidden-RGB export sanitization and grayscale/CMYK controls. The corrected native exports preserve the tested reference RGB values. This is not a 16-bit working pipeline, RAW support, full professional color-proofing or native Windows acceptance.

Reproduce from the source root, using retained official task artifacts:

    NODE_PATH=<existing NativeCanvas runtime directory> node quality/image-overlay-qa/color-export-regression/reproduce-shipped.cjs <retained exact 0.2.7 app.asar> <restored checkpoint24 source root>

The script verifies the frozen artifact before execution and does not overwrite originals. No private photographs, API calls or paid services are involved.
