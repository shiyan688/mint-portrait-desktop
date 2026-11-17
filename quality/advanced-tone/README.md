# Actual tone-pipeline evidence

Private informational QA, not marketing/app assets or an aesthetic/SOTA benchmark. Public NASA fixture provenance is retained in quality/fixtures/manifest.json and quality/manual-tools-qa/fixtures/PROVENANCE.json. The source package preserves compact comparison sheets and scripts, not all regenerable full-size output PNGs.

portrait-tone-contact.jpg is a visually inspected lossy contact sheet from actual shared-core outputs. Original/neutral is byte-exact; the example master curve intentionally raises contrast/saturation, not a natural-beauty default. The blue-band example shifts blue clothing/background; it is a global hue-range operation, not semantic clothing segmentation. Full pixel metrics and recipe/core hashes are in metrics.json. Alpha and original buffers were unchanged. Core brightness/smoothing/geometry were not invoked.

hue-boundary-contact.png uses synthetic spectral, low-saturation and one-code dark/light ramps. Alternating extreme band settings are a continuity diagnostic, not a suggested look; extreme control differences may deliberately compress color detail and8bit quantization remains. Near-white/black perturbations changed at most2 code values in this fixture, not a universal perceptual guarantee.

check-original-export.cjs actually renders a5001×3300synthetic PNG through the native export service, decodes output and compares every pixel to the same shared pipeline. original-size-report.json records exact original/output hashes, no scaling, original byte preservation and cloudCPU-only timing. This is not a4060 benchmark or RAW/16bit test.

Reproduce from source root: node quality/advanced-tone/render-evidence.cjs and node quality/advanced-tone/check-original-export.cjs. These run our own code against local test fixtures; no photos are sent externally. Images are pixel-output evidence, not UI screenshots. Browser/Windows runtime remains unverified.
