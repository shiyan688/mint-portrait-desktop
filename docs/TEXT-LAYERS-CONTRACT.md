# Desktop editable text contract

This is a bounded editable-text implementation, not a font installer, generated-image feature, or typography portability guarantee. It uses local system sans/serif/monospace fonts. No font, model, photo, or API download is required by the text implementation.

## Frozen shared layout

`src/text-overlay.cjs` is a byte-for-byte copy of the mobile `assets/text-overlay.js` core. SHA-256: `44874197cdf371f6763228d61a67c75346c50e37c2267e2b9e69e33f314f93a1`.

Its version-1 recipe defines normalized final-image coordinates, font size relative to the shorter edge, box width relative to image width, clockwise rotation, alignment, fill/outline/shadow, opacity, and line height. Its canonical-min-edge-1024 layout stabilizes line breaks for the same aspect ratio within the same font engine. Generic fonts, glyph availability, antialiasing, and metrics can differ between operating systems. Cross-OS or Android/Electron pixel identity is not promised.

## Collection and persistence

`MintTextLayers.validate(layers)` accepts an ordinary dense array of at most 8 layers. Each layer has exactly `{ id, enabled, recipe }`: a unique ASCII ID (1–160 characters, first alphanumeric, then alphanumeric/underscore/dot/colon/hyphen), a boolean, and a complete shared version-1 recipe. Reserved prototype names are rejected. Every recipe has at most 500 Unicode code points and 12 explicit lines, for a bounded total of 4,000 code points. Shared wrapping limits still apply during Canvas layout.

Unknown or missing fields, accessors, hidden properties, symbols, inherited/custom prototypes, sparse/extended arrays, duplicate IDs, coercible values, and malformed recipes are rejected. Validation creates fresh deeply frozen collection snapshots. The original input is not frozen or changed. `isActive(layers)` validates first and returns true if a layer is enabled, has nonempty text, and has positive opacity. Disabled/empty/zero-opacity layers remain editable data but do not require a native export raster.

`canonicalRecipe(layers)` returns the exact JSON serialization of the validated collection in array order, with fixed layer and recipe field order. It is the UTF-8 input for the recipe SHA-256. It includes disabled layers as well as active layers. Colors and text are preserved according to the frozen shared validator; there is no extra font or Unicode normalization.

Project schema 9 stores explicit `settings.textLayers`, default `[]`, in current, committed, undo, redo, and each non-null exported-settings snapshot. A schema-9 write or read rejects a missing field in any such slot. Reading schemas 1–8 migrates an absent field to `[]`; an invalid present field is never treated as missing. Storage preserves original encoded bytes and does not restrict archival sources to the text render budget. Project settings returned by the codec are independent editable copies; the collection validator itself returns frozen snapshots.

## Renderer/native boundary

The renderer uses the same shared Canvas layout/raster path for preview and native export. It draws active layers in array order on a disposable transparent final-size Canvas. It does not draw text with Sharp SVG/text or request native font layout. Its native request includes the optional exact-own-field envelope:

```js
textOverlay = {
  version: 1,
  requestId, sourceRevision,
  sourceHash, recipeHash,
  mode, // 'original' or 'working'
  width, height,
  rgba // ordinary Uint8Array backed by ordinary ArrayBuffer
}
```

The raster is straight-alpha sRGB RGBA, exactly `width * height * 4` bytes. Shared buffers, subclasses, malformed or shadowed binary metadata, wrong byte lengths, and extra/missing/accessor envelope fields are refused. The main validator snapshots input, hashes the actual owned original encoded bytes with SHA-256, hashes the canonical validated text collection, and checks request ID, source revision, mode, and computed final dimensions. It rejects active text with no overlay and neutral settings with an extraneous overlay. The owned overlay buffer is transferred to the native worker; the renderer's original source and overlay buffers are not transferred or mutated.

These bindings detect mismatched/stale submissions; they are not glyph attestation. A renderer supplying pixels and the matching recipe hash has not cryptographically proved those pixels contain those glyphs. This is a single-stage request route, not a one-use token or replay prevention system. Existing sender restrictions and cancellation/job ownership remain required.

Both the active-text final canvas and compositor are limited to 16,000,000 pixels and an edge of 16,384 before overlay allocation/copy. The original-source 64,000,000-pixel/16,384-edge and complex-effect 16,000,000-pixel processing limits remain unchanged and cannot be bypassed with a small crop. A valid larger nontext source may be cropped to a text final canvas within the limit. Padding cannot secretly reduce processing size. Oversize text requests reject rather than automatically downsampling; an explicitly requested working mode retains its existing semantics.

## Composition and native encoding

`MintTextLayers.composite(image, {width, height, rgba}, {shouldCancel}?)` accepts an exact `{width,height,data}` source raster and returns a new `{width,height,data}` with a `Uint8ClampedArray`. It never resizes. Source and overlay dimensions must match. It uses straight-sRGB source-over with nearest-integer byte rounding. A zero-alpha overlay pixel preserves every source byte exactly, including hidden RGB; hidden source RGB never contributes through zero source alpha when overlay alpha is nonzero. Optional cancellation is checked before allocation, per row, and before return; cancellation throws `AbortError` and never publishes or mutates a partial result.

Native `processPixels(image, settings, analysis, textOverlay?)` fails closed for active text without an overlay. It validates text revision, recipe hash, and final geometry before image effects. It composites after all effects, geometry, and padding, then the export worker sanitizes zero-alpha RGB and finally encodes PNG or explicitly flattens JPEG on white. No extra source resize or original rewrite is introduced. The existing export plan shape is unchanged; `details.textLayers` reports the number of active text layers.

## Verification scope

Focused Node tests exercise strict data validation, immutable snapshots, all alpha pairs against an independent integer compositor oracle, cancellation, exact native PNG and JPEG oracle output, EXIF orientation, explicit working-size export, binding mismatches, preflight limits, owned-buffer transfer, real rehashed schema migration, and all history slots. Where the already installed optional `@napi-rs/canvas` is available, the tests also render actual shared-font glyph rasters and send those through the real Sharp worker. They install nothing. Native Canvas is not Electron/Chromium/Windows runtime evidence. Real desktop window interactions, installed Windows fonts, installer behavior, and physical-device performance require their own runtime verification.
