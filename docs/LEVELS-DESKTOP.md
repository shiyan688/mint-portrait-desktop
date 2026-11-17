# Desktop Levels integration

Status: source candidate. No installer was rebuilt and no native Chromium/Windows visual acceptance is claimed.

## Controls and operation

A collapsed “色阶 Levels” section sits after basic color and before curves/HSL. It exposes RGB master, Red, Green and Blue channel selection; five labelled sliders with numeric outputs (input black, gamma, input white, output black, output white); overall strength; selected-channel reset; and full Levels reset. Channel selection is view state, not a photo edit.

- Endpoints are integer code values 0–255. Input black must be strictly below input white. Output black may equal output white but cannot exceed it.
- Gamma is 0.1–10. Gamma above 1 brightens midtones; gamma below 1 darkens them. This is conventional display-referred 8-bit sRGB code-value processing, not RAW/highlight recovery.
- Input/output slider bounds follow the other endpoint. Full shared-core validation still runs before mutation, so injected/programmatic invalid changes are rejected rather than silently reordered.
- The pipeline order is basic color → Levels → advanced tone (curves/HSL). Within Levels, RGB master precedes the individual channel. Overall strength is blended once; the shared core performs the final rounding.
- Source pixels and original files remain immutable. The null default and neutral recipe leave pixels unchanged. Zero strength preserves saved channel settings while leaving pixels unchanged.

An input event updates the live preview without creating an undo record. Its change event creates one undo record for the drag, and a change-only accessibility/keyboard event also validates and commits. Repeating the same value is a no-op. Selected-channel reset leaves the other channels and strength intact. Full reset sets only Levels to null and can be undone.

## Existing state and safety

Levels uses ordinary settings and the established render invalidation path. An uncommitted edit immediately invalidates accepted preview/reference capture and clears the preview histogram. Generation, source revision, photo identity and recipe checks reject late renders. Frozen reference pixels are not updated by Levels changes.

All existing import, export, project, preset and photo-load locks apply to Levels. Missing shared core disables editing and never fabricates an effect. Invalid saved recipes produce a visible status instead of being replaced with defaults; an explicit full reset can clear the invalid recipe. The histogram remains the existing accepted-preview-only histogram, not full-resolution analysis or a new clipping inspector.

## Projects, presets and synchronization

- Levels is an optional photo setting, saved with settings and each undo/redo state in project v7. Project parsing, older-version migration and actual pipeline/export behavior are owned by the shared project/pixel components.
- Named preset codec v2 receives both trusted modules, captures a cloned controls.levels recipe and validates it. Both full and color-only application include Levels. Version-1 presets migrate Levels to null, explicitly clearing prior Levels when applied.
- Preset capture does not modify the project or include source-specific coordinates, masks, strokes, files or cache entries. Preset application uses the existing atomic batch/state guards and per-photo history.
- Built-in style presets reset Levels and advanced tone together. The tooltip states this behavior. Framing, source-bound edits, local layers and retained manual state keep their existing protections.
- Cross-photo synchronization carries the cloned global Levels recipe while retaining each target photo’s framing, selection, manual edits, repair points, local layers and model masks under the existing rules.

## Verification

Run without network access or new dependencies:

    node --test tests/levels-ui.test.cjs

The test file executes the shipped app.js with authored DOM/canvas/IPC doubles and real Levels, preset/project, reference and pixel cores. It checks actual listener paths, default identity, channel selection, input/change history, endpoint guards, collapsed output ranges, strength/reset scopes, locks, core errors, late-render rejection, frozen references, v1/v2 preset capture/application, preserved source-bound state, sync and built-in reset behavior.

This is substantive application-state and CPU pixel verification, not browser layout, physical slider interaction, native Electron IPC/dialogs, model inference or Windows installer acceptance. Those remain separate environment-dependent checks. No new inspector, automatic correction, face inference, cloud service or dependency was added for Levels.


## Final integrated checkpoint11

All22 Levels UI cases now pass after the integration owner repaired the pre-existing liquify-only → strict Geometry boundary. Final full suite1449/1449 includes57 independent checks and actual native PNG readback. No Windows/browser layout acceptance or newly built Setup is implied.
