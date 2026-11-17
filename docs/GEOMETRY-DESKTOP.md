# Desktop non-destructive framing

This is a development candidate, not a claim that a Windows installer or interactive desktop UI has been validated.

## User workflow

The initially collapsed **裁剪与旋转** section contains:

- Left/right 90-degree turns and horizontal/vertical flips of the visible image.
- **调整裁剪**: begin a draft, drag a new rectangle in the current accepted frame, or enter a rectangle in complete-original-image pixels.
- **应用裁剪** / **取消 · Esc**: accept one history entry, or discard the draft without changing settings or source pixels.
- **重置构图**: remove only framing, preserving all other adjustments. The existing full reset still resets all adjustments and remains undoable.

Dragging in either direction and to the exact outer edges is supported. Dragging beyond the image is clamped. A tap or zero-area drag is not a crop. Numeric X/Y/width/height must be integers inside the oriented original; width and height must be at least one pixel. Numeric edits can restore content outside a previous crop. That extra area becomes visible after Apply; the draft outline shows only its intersection with the currently accepted frame. This is explicitly explained beside the controls. There are no unimplemented ratio presets or movable-handle claims.

Drafts are ephemeral and bound to photo ID, immutable source revision and accepted framing. Pointer cancellation/lost capture, Escape, blur, tool/source-inspection changes, photo/project/import changes, undo/redo, save, export, preset/reset/sync and learned-task launch discard them. Pointerup ends the drag but does not apply the crop. Repeated Apply cannot create duplicate history. Settings remain unchanged until Apply, so draft rectangles cannot leak into project files or exports.

## Coordinate and display contract

Desktop framing is `settings.framing = null | { version: 1, crop: { x, y, w, h }, quarterTurns, flipX, flipY }`. Crop boundaries are normalized edges of the full original. The shared core's quantization and domains are specified in [GEOMETRY-CONTRACT.md](GEOMETRY-CONTRACT.md).

Processing order is all existing original-space edits, then crop, clockwise quarter-turn, and output-axis flips. Framing never reassigns source revision or changes compressed source bytes, face landmarks, local masks, selection recipes, matte corrections, manual strokes or the repair donor. Presets preserve the photo's framing; sync preserves every target's own framing.

A turn of the currently displayed result updates quarterTurns and swaps flipX/flipY. A drag maps all four output-edge corners through `mapEdgePoint(..., 'inverse')`, bounds their source rectangle, snaps to original integer pixel edges and normalizes it. This works across all 16 quarter-turn/flip combinations and does not confuse pixel centers with image edges. Preview and original plans quantize independently, so their rounded boundary counts may differ slightly; saved intent remains in the original domain.

Preview canvas, surface layout and fit use the final frame dimensions. They do not stretch a cropped/rotated image back to source dimensions. The comparison side and held-Space original are transformed by the same accepted framing as the result. A cached pixel-copy original is used instead of showing a raw original stretched into the framed canvas.

Selection, liquify, repair and legacy point-heal tools visibly show the full unframed source-coordinate view. Manual tools and legacy point heal additionally hide automatic reshape/background and bypass learned-matte facts for that temporary view. Legacy point heal explicitly requests both source-view framing bypass and the temporary source-coordinate processing override, even though its UI is not a manual tool. It has a distinct `point-source` render stamp so a diagnostic-source render cannot prematurely enable it. New legacy points are refused after manual liquify, including photo-switch and pointerdown admission; the user is directed to the actual repair/clone tool. Existing spots followed by liquify remain valid and replay unchanged. Mode changes invalidate stroke readiness; a mode/source/recipe stamp plus render-version cancellation rejects late framed/unframed completions. Manual repair snapshots remain full source pixels. Matte inspection, face diagnostics and local-layer outlines also use the full source view, with an explicit badge; matte brushing operates on that raw original-coordinate inspection, not a framed render. Space retains that full source view while these inspections/tools are active.

Diagnostic overlays and crop drafting are not mixed: crop initiation asks the user to close an active parsing diagnostic, and entering source-coordinate inspection cancels a draft. Preview-only crop/selection/matte outlines are never export inputs.

## Export contract

`exportDimensions` reports final `width`/`height`, pre-framing `processingWidth`/`processingHeight`, original dimensions, `scaled` and `framed`.

- Original mode retains original pixel scale, then applies framing. Crop and rotation are not resize, so they do not set `scaled`.
- Working mode first computes the existing full-source 4096-edge/16-million-pixel resize, then applies framing to those processing dimensions.
- Analysis and learned-mask resampling use processing dimensions. Only final result/encoded metadata use final dimensions.
- Native responses must match all eight plan fields, including `framed`, so dimension-preserving flips cannot masquerade as an unframed result.
- Browser decode must match processing dimensions; browser final render must match final dimensions before encoding.
- Native source limits and the 16-million processing-pixel complex-effect guard apply before crop. Manual liquify, repair and selection-based local layers are included in the guard. A small crop cannot bypass it.

The export dialog explains processing before framing and shows final output sizes. Export queues freeze accepted settings; unfinished drafts are discarded before queue creation, not auto-applied. Processing dimensions and framed status are retained in queue result metadata.

## Verification

`tests/geometry-ui.test.cjs` executes the shipped app module using authored DOM, canvas and IPC doubles, the real shared geometry and pixel processing cores, and the real project codec. One test uses the real native worker and Sharp PNG codec. It is not actual Chromium, pointer-device, browser-layout, Windows dialog, installer, GPU or model-inference QA.

Focused suite (61 cases at implementation handoff):

- UI controls are present, initially collapsed and gated when unavailable.
- All 16 rotated/flipped inverse drag mappings; reversed/full-edge/outside drags; tap and invalid numeric rejection.
- Draft/history/source immutability; repeated Apply; cancellation and wrong-pointer behavior; undo/redo and actual project archive roundtrip.
- Display fit/dimensions, no stretch, same-frame original/compare, and mode race rejection.
- Full-source manual/legacy/matte/local/diagnostic editing; original-coordinate matte strokes and repair donor preservation.
- Preset/sync per-photo framing, learned-cache retention, full-processing-size learned export masks.
- Legacy-point automatic-geometry/background suppression and post-liquify admission guards; distinct inspection/point-view stamps.
- Oversized archive metadata with neutral or active framing remains viewable and is not rewritten. Original-domain numeric framing controls are explicitly disabled beyond the shared metadata budget (80 million pixels / edge 32768), while native original export retains its stricter limits.
- Size-plan parity, complex-effect preflight, frozen queue snapshots, browser-path framing and native-worker encoded dimensions.

Commands:

```sh
node --input-type=module --check < src/app.js
node --test tests/geometry-ui.test.cjs
node --test tests/*ui*.test.cjs
npm test
```

The focused 61-case suite passed at handoff. An all-UI suite run before the final additional stamp test passed 244/244. Final aggregate results belong to the parent implementation report because backend/schema work is being integrated concurrently. No model was downloaded/run, no user computer was accessed, and no installer or release was produced for this UI change. Real desktop visual QA remains necessary, particularly crop overlays, pointer capture and narrow-window control layout.
