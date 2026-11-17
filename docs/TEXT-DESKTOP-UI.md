# Desktop editable typography UI and pipeline

This is a source-only increment after delivered development 0.2.3. It is conventional editable text, not AI retouch or complete templates/sticker/font-library coverage.

## Workflow

Open 可编辑文字, add a text layer, enter a multiline paragraph and choose system sans/serif/mono, alignment, size, width, normalized center, rotation, line spacing, fill, opacity, outline and optional shadow. Up to8 layers compose bottom-to-top. 新增文字 creates a form draft only. Apply writes one ordinary history step; Cancel discards the form. Existing layers can be selected, edited, hidden, reordered or deleted and all applied changes can be undone/redone. An empty or disabled layer remains editable without drawing.

在画布点选位置 records a normalized final-canvas center only on matching pointerup. Pointercancel, lost capture and Escape do not commit coordinates. This is point positioning, not an unimplemented draggable bounding-box UI. Applying is still explicit. Switching photographs or applying another edit invalidates the pending draft and notifies the user; applied text is preserved. Save, local recovery and batch export retain only applied recipes.

All text is after crop/quarter-turn/flip and canvas padding. Changing framing recomputes final placement/wrapping, not source landmarks, manual strokes or healing donors. Original/held-original comparison retains framing/padding but intentionally has no text; its badge says so. Source-coordinate inspection and manual tools hide text. Text is preserved per photo when applying built-in/portable presets or copying ordinary parameters, never copied implicitly.

## One font path and honest preview basis

The existing sandboxed renderer's Canvas performs both measurement and full-final-size glyph rasterization using the byte-identical mobile text core. The accepted preview downsamples that finished raster and composites it into its real pixel canvas, so reference capture and RGBA readout include applied text. It is not a decorative HTML layer or a low-resolution bitmap enlarged on export. The original image and previous accepted canvas are never mutated by a partial render.

The explicit 排字/导出基准 control mirrors original/working export mode. Changing mode invalidates and regenerates the text preview. Fractional crop/padding rounding can yield slightly different aspect ratios across modes, so identical wrapping is promised only for the same basis, not across every resolution. The renderer caches only one full raster bound to source Blob/revision, validated canonical layer recipes, final dimensions and mode. A matching current-photo export reuses that exact raster; other queued photos rerender from their frozen recipes. Hashes bind source bytes and recipe association, not a proof that arbitrary supplied pixels contain particular glyphs.

The native main validator independently hashes original encoded bytes, checks recipe/request/source revision/mode/size association, ordinary fixed bounded RGBA storage and final16MP ceiling. Sharp replays image effects, geometry and padding, composites this final-size text without font layout or resizing, sanitizes alpha-zero hidden RGB and encodes PNG or white-flattened JPEG. There is no font path, arbitrary file access, SVG text rendering or remote font service in this protocol. Requests without active text omit the overlay; active text with missing raster fails closed.

## Persistence and limitations

Projectv9 explicitly persists textLayers in every current/committed/undo/redo/exported settings snapshot and migrates v1–8 missing fields to[]. Original image bytes remain embedded and immutable. The existing optional recovery service uses the current codec. Delivered0.2.3 cannot read these new projects.

Final active-text surfaces are capped16,000,000pixels/16384edge, including preview's full-size text surface. Existing original-source processing limits still apply before cropping. This is not a guarantee of total process RSS: Canvas, readback, IPC and native worker each can own bounded copies. Large nontext originals may crop to a supported final text canvas only when existing source/complex-effect budgets also permit it. No automatic working-size fallback.

Only local generic system fonts are used. Font availability/fallback/metrics can differ across OSes, and reopening on another system rerenders the stored recipe using that system's fonts. No font binaries are embedded. Native Linux Skia QA proves the tested code path/pixels there, not Chromium/Electron layout, Windows installed fonts, actual desktop event dispatch or device performance. User-computer access and prior denied browser/npm routes were not used.
