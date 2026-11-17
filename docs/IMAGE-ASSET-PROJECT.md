# Image assets in project format 16

The project codec writes v16 and reads v1–v15. It remains a bounded data codec: it does not open paths or URLs, decode imported file formats, run image models, plan a canvas, render image layers, or rewrite the immutable source image.

## Editable state and ownership

Every v16 settings record explicitly contains `imageLayers`, including current, committed, undo, redo and non-null exported settings. The neutral value is `[]`. Each layer is the exact own-data record `{ id, name, enabled, assetId, recipe }`, validated by the shared `image-layers.cjs` validator. It retains the source-independent final-canvas placement recipe, not a rasterized preview.

Each photo explicitly owns `imageAssets`, outside settings and history. A runtime asset is exactly `{ id, version: 1, width, height, data }`, with canonical RGBA8 base64 in `data`. Asset records contain no filenames, filesystem paths, URLs or source-image identities. Per-photo duplicate asset IDs are rejected, including identical duplicate records. The same content can be independently owned by different photos, but each photo must have its own table record and raw blob. A layer cannot borrow another photo's table entry.

Every layer reference is checked, including disabled layers, zero-opacity recipes and all historical/exported snapshots. The application should retain the union of assets referenced by current, committed, undo, redo, active tool snapshots and export pins. It must not prune an asset merely because the current layer is hidden or removed while an undo/export snapshot still needs it. The codec validates photo-local ownership and complete blob references; it does not decide the application's undo or in-flight export lifecycle.

Portable presets and cross-photo parameter copying must exclude image layers and assets. They are not global color parameters.

## On-disk representation

The 64-byte framing and existing original/Float32 blob formats are unchanged. V16 adds one raw `rgba8` blob for each photo-owned asset, regardless of how many settings snapshots refer to it. The corresponding photo table entry is exactly:

```json
{ "id": "rgba-<64 lowercase hex>", "version": 1, "width": 2, "height": 2, "bytes": "blob-1", "byteLength": 16 }
```

No asset base64 is written to JSON metadata or repeated in history. Metadata and every blob retain their SHA-256 integrity checks. Blob IDs, encoding, offset, length and use must agree exactly; missing, reused, wrong-kind, overlapping and orphan blob records are rejected. A descriptor's byte length must equal width × height × 4.

The asset ID is verified separately from the container/blob hashes, using the shared asset helper's dimension-bound identity bytes:

`rgba-` + SHA-256(UTF-8(`mint-rgba-asset-v1\0`) || uint32LE(width) || uint32LE(height) || RGBA8)

This means a malicious file cannot change RGBA bytes, swap dimensions with the same byte count, or invent an asset ID merely by recomputing container and blob hashes. Canonical base64 encoding/decoding and identity-byte construction are delegated to `image-assets.cjs` and its qualified shared overlay codec. The project codec does not maintain a second image encoding or crypto implementation.

## Migration

V1–v15 photos acquire `imageAssets: []`, and every settings/history/export record acquires `imageLayers: []`. Other existing settings, source bytes, learned Float32 bytes (including signed zero), geometry bindings and source hashes are preserved. Missing v16 fields are errors, not silent defaults. Historical versions may carry explicit empty image fields, but cannot carry active image layers, asset tables or RGBA blobs.

The new format is not promised readable by an old application. Keep an original copy of a historical project if it must remain usable in that application.

## Bounds and allocation order

- Asset: at most 1024 pixels per edge, 1,048,576 pixels and 4 MiB raw RGBA8.
- Photo: at most 16 records and 32 MiB raw-equivalent asset bytes.
- Project: at most 128 records and 64 MiB raw-equivalent asset bytes.
- Learned-cache bytes and RGBA asset bytes share the existing 256 MiB pool. Asset limits do not add another pool.
- Source bytes remain capped at 400 MiB; metadata at 16 MiB and one million JSON nodes; container at 672 MiB + 64 bytes.
- The blob-directory cap is 100 source records + 2 × 512 learned-cache records + 128 asset records. Per-kind/aggregate byte limits still apply.

Encoding captures source, Float32, asset pixels and all recipe metadata synchronously before any asynchronous digest. Decoding parses and validates bounded metadata, validates the blob directory and photo-local references, and captures each referenced blob once before its first asynchronous digest. It does not make a second full-container copy. Metadata digest failure still takes precedence over a structural error in untrusted metadata.

No canonical base64 is reconstructed until all metadata/schema/count/byte/reference checks and every container/blob hash have passed. Shared `fromRaw` then verifies each asset identity before a successful project result can escape. A failure rejects the whole decode; no partial session is returned.

The raw and string accounting above is not measured process RSS and is not an absolute JavaScript heap ceiling. At the 64 MiB aggregate raw-asset cap, canonical base64 contains approximately 85.34 Mi characters, or approximately 170.67 MiB with a conservative two-byte-per-character representation. These strings, the caller's input, owned source/cache/blob snapshots, metadata objects and transient per-asset hash/encoding buffers may coexist. Runtime string layouts, object overhead and garbage collection vary. Rendering and export have separate canvas/work budgets and must be preflighted by their own modules.

## Verification

`node --test tests/image-asset-project.test.cjs`

The focused suite contains a genuine compressed v15 fixture captured before the codec change, verifies migration through versions 1–15, one raw blob across 83 settings snapshots, independent photo ownership, all inactive/history/export references, correctly rehashed identity attacks, strict own-data/getter rejection, count/byte caps, asynchronous caller mutation, source/Float32 preservation and browser UMD/WebCrypto roundtrip without raster execution.

This document describes codec behavior. It does not claim full application integration, package release, measured RSS, Windows execution or user-interface acceptance.

### Schema-migration regression run (2026-10-22, cloud)

The complete `node --test tests/*project*.test.cjs` run passed 227/227 tests. Current-format fixtures and latest-version assertions were updated in `project-document.test.cjs`, `padding-project.test.cjs`, `photo-review-project.test.cjs`, `sharpness-project.test.cjs`, `straighten-project.test.cjs` and `text-export-project.test.cjs`. Historical fixture bytes, historical schema numbers and negative controls were retained. The new image-asset suite passed 36/36, including source/float/asset capture during asynchronous input mutation. No production validation was relaxed for these fixture updates. This is project persistence coverage, not a full application or Windows acceptance claim.
