# Desktop final-canvas mosaic and opaque cover

Included in Development 0.2.5. These are conventional, deterministic manual tools, not learned retouch or SOTA. Native Linux image/Canvas tests are not a Windows or browser usability acceptance.

## Use

Open **马赛克与遮盖** in the parameter rail. Choose **马赛克画笔** or **不透明遮盖**. Set brush radius, mosaic block width, or cover color. Drag on the final image; release to commit one undo entry. The pink stroke during dragging is a temporary guide, not the output. Esc, lost capture, a second pointer, changing photo, comparison, original inspection, undo, and closing the view cancel unfinished strokes.

The selected layer accepts another stroke only when mode, color, block width and captured selection match. A changed configuration creates a new layer. **下一笔新建层** forces a separate layer. Select layers to hide/show or remove them; clearing all is undoable. Up to 8 layers, 64 strokes and 4096 stored points are bounded further by actual work and memory costs.

The checkbox captures a copy of the current source-coordinate selection. Changing the later selection does not change older strokes. The mask is transported through crop, quarter turns, flip and padding. No selection allows painting on padding and text. A source selection does not include added padding. Feathered masks are allowed only for mosaic; opaque cover rejects them rather than partly revealing covered pixels. Selected redaction with liquify or face geometry is rejected because the source selection has not been warped.

## Placement and replay

Processing order: existing image effects, crop/rotation/flip, canvas padding, text, redaction, optional final output downsize, encoding. Redaction coordinates belong to the final composition, not the source image. Recipes bind to the immutable photo revision and a canonical geometry key. Changing crop, rotation, flip, padding or shape while stored redaction exists is rejected. Remove/clear or undo redaction first; it is never silently shifted or deleted. Disabled layers retain this binding too.

Preview drawing and the original-size export both replay the same recipes at their actual dimensions. Pixel boundaries are quantized at those dimensions, so a small preview is not a pixel-accurate privacy inspection. Original-size work and memory are preflighted before a stroke is committed. Final downsize does not bypass the full composition budget. Desktop final redaction canvas is at most 16,777,216 pixels and 16,384 per edge; selected masks independently obey that source-raster bound. A complicated recipe can exceed work limits at a smaller size.

Projects are format v11, reading v1–v10 with a neutral null stage. Every settings, committed and undo/redo slot is validated. Older builds may reject new projects. Named portable presets contain no redaction, selection or photo identity. Parameter synchronization retains each target's own redaction and shape instead of transplanting another person's coverage.

## Privacy boundaries

- Mosaic is a visual effect, not reliable sensitive-information redaction.
- Opaque cover writes the chosen RGB and alpha 255 at covered hard-mask pixels. It is not secure deletion. Check coverage at the final exported dimensions.
- JPEG re-encoding and any final downsize may alter boundary colors. Export to PNG without downsize when exact cover pixels matter, and still inspect the actual file.
- Fully transparent pixels in exported PNG are sanitized to zero hidden RGB; source bytes and partial-alpha edges remain preserved internally. Fresh PNG/JPEG encoding does not carry original EXIF/XMP/embedded thumbnails. This does not promise removal of metadata added by outside software.
- Original files, embedded project originals, undo history and opt-in local recovery drafts still retain the covered information. Share only a checked export, not the editable project or source file.
- No cloud upload or new API is used. Text uses the existing local font system and is composited before coverage.
