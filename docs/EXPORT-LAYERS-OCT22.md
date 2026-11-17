# Desktop export queue and source-bound local layers

This source candidate adds actual editor controls and integrates the trusted native export renderer. It is not a signed or Windows-validated release.

## Export workflow

- Open Export, choose selected/all/current photos and JPG/PNG. The default is **Original size**. The dialog lists original and planned output dimensions for every photo before submission.
- **Working size** is a separate, explicit selection: proportional scaling to at most 4096 pixels on the long edge and 16 million pixels. Original mode never silently becomes working mode.
- Native input is limited to 64 million pixels and a 16384-pixel edge in either mode. Original output with portrait retouching, reshaping, spot repair, or background effects is limited to 16 million pixels; larger input can use explicit working output or have these effects disabled. Original native tone/local-layer output can use the 64-million-pixel limit. Source files remain subject to the existing 80 MB limit.
- Browser fallback supports exact-original export up to 16 million pixels / 16384 edge. A returned downscaled original or mismatched dimensions is rejected before writing. Browser downloads are described as initiated, not verified saved.
- Each new queue retains the original Blob and an immutable copy of each photo's parameters. Retry uses those snapshots, not edits made afterward. Success, failure, pending, processing, writing, and canceled/unfinished states are represented per file.
- Stop cancels processing and prevents subsequent writes. A native write already committing is allowed to settle; a successful write is counted even when Stop was pressed during the commit. Retry never repeats successful saved/download-started entries.
- Processing is sequential. Source byte arrays, decoded canvases, analysis references, and encoded output bytes are local to one item; queue records retain only dimensions, errors and write receipts, not encoded output buffers.
- Required face/mask analysis failing or unavailable stops that item. The queue does not silently omit configured portrait or background effects. Diagnostic visualization is never the exported canvas.
- A successful commit carrying a directory-durability or temporary-cleanup warning is shown as saved with warning, not as a retryable failure.
- Native output is re-encoded 8-bit sRGB with a profile, without source EXIF. Original size describes dimensions, not byte-for-byte source export.
- Image export is still not project save. `.mintproj` preserves the originals, edits and histories separately.

## Local adjustments

Up to eight source-bound layers can be added with radial or linear masks. Each has a name, enabled state, opacity, exposure, contrast, saturation and temperature. Layers can be selected, reordered and deleted. Every edit uses existing undo/redo and project-save history.

Coordinates are normalized percentages of the immutable original image. Radial masks expose center X/Y, radius X/Y and feather; linear masks expose start/end X/Y and reverse. Invalid or degenerate coordinate edits are rejected rather than stored. Layers are applied in list order after global tone and before background/reshape.

The optional outline view temporarily shows original unwarped pixels, clearly labels that coordinate space, and does not pretend the outline is aligned to reshaped geometry. Close the outline view to inspect the edited result. Outlines do not enter export settings or the output image.

Parameter sync preserves each destination photo's own local layers, spot repairs and learned masks instead of transferring source-bound coordinates. Preset application on the same photo retains that photo's local layers. The UI explains this distinction.

## Experimental face-color controls

The merged `classical-face-color-v1` implementation is exposed through four real controls: under-eye lift, localized redness reduction, lip color and cheek color, all defaulting to zero. Natural, peach and rose are explicitly selected lip/cheek palettes. The UI gates these controls on both genuine core capability and detected faces. Their values and palette support history and v2 project roundtrip.

The section is labeled experimental classical local color, not learned retouching or SOTA. It does not infer ethnicity, enable default face reshaping or uniformly whiten skin. Low-strength use and inspection of eye/lip/cheek edges are advised; high combined strengths can look soft and remain a candidate-quality limitation.

## Verification and remaining limitations

- `tests/export-queue.test.cjs`: sequential queue snapshots, cancellation before write, cancellation during commit, failed-commit retry, single-flight execution and browser download labeling.
- `tests/export-layer-ui.test.cjs`: shipped app execution with authored DOM/canvas/IPC doubles plus real queue/project codec. Covers native parameters, original/working dimensions, silent-resize rejection, retry snapshots, missing-effect failure, local layer controls, history, source identity, sync and v2 project roundtrip.
- One actual shipped-app → native worker → atomic filesystem test verifies 5000 × 8 original dimensions, outside-radial pixel identity, changed center pixels, sRGB profile, stripped source EXIF, and unchanged source bytes. The UI still uses DOM doubles in that test.
- Existing audit/project/learned UI suites remain passing after loading the new queue module. These tests are state/contract tests, not screenshot or layout tests.
- A fresh cloud Chromium normal-sandbox launch was already blocked by socket/process-singleton restrictions. It was not retried with weakened sandbox flags. No real-browser screenshots, Electron native-dialog runs or Windows installer acceptance are claimed.
- The installer payload was subsequently restored and the complete suite passed510/510 before the layout assertions were added; see the frozen checkpoint report for its final count. Four independently reproduced defects were repaired: canceled quit disabling services, quit during native writes, APNG frame loss, and nested payload-directory junction redirection. Tests genuinely detect the old behavior.
- Supported cloud browser subsequently refused the local file URL because it permits only HTTP/HTTPS. That denial was not bypassed. Layout changes were reviewed from source and state tests only.


## Manual milestone, source checkpoint5

Project schema3 reads schema1/2 and preserves their original bytes, local layers, face-color parameters and histories. A new current selection has no image effect until used. Selection-backed local layers, push/restore, and explicit-donor heal/clone use normalized original-source coordinates and independent per-operation selection recipes. They replay through the same shared modules in preview and native export. Selection-backed layers and manual strokes use the16-million-pixel complex-operation ceiling; radial/linear tone-only layers retain64-million-pixel support.

Manual view hides automatic reshape/background without mutating saved settings. The original matte/landmarks are not warped by manual liquify, so incompatible background, automatic reshaping or automatic donor-protection combinations are rejected in UI, project validation and both renderers. Repair must follow geometry; geometry cannot be reordered beneath existing repair strokes. See MANUAL-TOOLS-DESKTOP.md and MANUAL-TOOLS-CONTRACT.md. Native PNG encode/decode and project roundtrip tests check byte-exact shared replay, dimensions and original preservation; this remains distinct from real Windows/browser UI testing.
