# Desktop layout review

Date: 2026-10-22

## Changes

- Kept the desktop's three-column workspace: presets and projects on the left, preview and photo queue in the center, adjustments on the right.
- Reordered the actual adjustment markup, not just the visual order: basic color, baseline skin, experimental face color, shape, spot repair, background, local layers, then learned models. Keyboard and reading order therefore follow the same sequence.
- Left basic color and skin adjustments expanded by default. Local layers and experimental model controls remain available as collapsed sections instead of occupying the top of the inspector.
- Widened the inspector and increased control, note, and layer text sizes. Presets, adjustment controls, and longer layer lists can scroll independently.
- Kept a 960-pixel desktop minimum rather than converting the workbench into a mobile-style stack. Smaller or shorter browser windows can scroll to reach the whole workbench instead of hiding inaccessible tools.
- Preserved all existing IDs, labels, controls, data attributes, event wiring, and application logic. Added stable IDs to previously unnamed adjustment sections.
- Added a visible keyboard-focus outline to the image viewport. Prevented canvas tool hints from forcing the zoom buttons out of the toolbar.

## Verification

The following command passed 104 tests with zero failures:

```
node --test tests/desktop-layout.test.cjs tests/learned-ui.test.cjs tests/export-layer-ui.test.cjs tests/project-ui.test.cjs
```

The new layout tests check source-level contracts: section order and collapsed state, unique IDs, explicit label destinations, preserved control IDs, scroll/size rules, three-column breakpoint definitions, and viewport focus styling. These are not rendering tests. The other suites exercise application state using deterministic DOM/canvas doubles, and include existing native-worker/file-output integration coverage. They do not establish visual quality or real-browser interaction.

## Runtime UI limitation

The supported cloud browser rejected opening the local HTML file because its URL policy allows HTTP and HTTPS, but not file URLs. The application did not load. No server was started and no security restriction was bypassed. This review therefore contains no actual application screenshot and does not claim live import, rendering, dialog, narrow-window, or inference validation.

Before release, inspect the running desktop app at its normal window size and minimum supported size, then verify the import flow, keyboard navigation, preview resizing, compare divider, local-layer editing, queue selection, export dialog, and experimental-model status. Test with authorized local images; no private image upload is required for these local-only flows.
