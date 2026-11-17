# Separate source and QA evidence checkpoints

The original schema-1 workflow below is retained for compatibility. For new
binary evidence after the stable checkpoint-20 baseline, use the candidate
**schema-2 append-only archive-set workflow** at the end of this document, not
a growing full-QA reupload.

Starting with checkpoint 15, the private development source overlay and the
binary QA evidence are two separate, verifiable ZIPs. This is a packaging change,
not deletion of evidence, a new installer release, or Windows/GUI acceptance.

The source overlay remains based on Library
`libfile_409356280a8c8191a5bf3fd3cbdffe91`, version 1. Restore that base first,
then the current source overlay. Runtime/dependency/model installation still
follows the existing approved build instructions. Neither new ZIP contains an
installer, downloaded runtime, model weights, font binaries, virtual environment,
`node_modules`, or built application payload.

## Retained full checkpoint 14

The previous full source/QA overlay must remain available in Library history:

- Library file: `libfile_c7367392a7ec8191ad5f8bc8dafbc223`
- Version: **14**
- Size: **33,585,554 bytes**
- SHA-256: `7957c7e2643cf354f3565f976ab6cb25170045903d6762ba7ea6453d290cb63c`
- Manifest: **623 curated file entries**, plus `CHECKPOINT-FILES.json` itself
- Base: `libfile_409356280a8c8191a5bf3fd3cbdffe91`, version **1**

Those are historical verified identifiers, not placeholders for the new QA ZIP.
Do not delete, replace, or relabel that retained version as a source-only ZIP.
The companion's actual Library identity is recorded only after a successful
upload in `QA-RESTORE.json`. The packaging tool does not upload, query Library,
invent an identity, or claim that a syntactically valid ID is independently
verified. The operator must use the real upload response.

## What is included

`CHECKPOINT-FILES.json` describes the current **source** ZIP. It contains runtime
source, source tests and their text fixtures, package/installer manifests, docs,
quality scripts/harnesses, text reports, and JSON metadata. It also includes
`QA-CHECKPOINT-FILES.json` and the operator-authored `QA-RESTORE.json`. Every
member except `CHECKPOINT-FILES.json` itself has a byte count and SHA-256 in the
source manifest; archive readback also verifies the manifest's exact bytes.

`QA-CHECKPOINT-FILES.json` describes only the separate **binary QA** ZIP. The QA
ZIP contains those exact relative file paths and its own identical manifest.
The file list is deliberately retained independently of source-only manifests,
so future repackaging does not lose older curated fixtures outside newer globs.

Selection starts with existing `CHECKPOINT-FILES.json` names, retained
`QA-CHECKPOINT-FILES.json` names when present, and the existing narrow glob rules.
The explicitly added checkpoint-15 scopes are `quality/export-size-qa/*` and
`checkpoints/export-size-*`. It does **not** recursively select all of `quality/`.
In particular:

- Previously unselected quality subtrees, private diagnostics, feedback/user
  screenshots, and large raw planes do not become selected just because the QA
  ZIP is separate. Never add private screenshots to the curated manifest.
- The existing manual-tools exclusion for `.rgba.gz` outside `fixtures/` stays.
- The existing advanced-tone PNG exclusion stays, except the selected
  `hue-boundary-contact.png`. Previously retained manifest names remain retained.
- `*-source-archive.json` receipts are excluded to avoid recursive archive-hash
  bookkeeping. Explicitly curated text logs and reports remain source files.
- Model configuration, license, and adapter source files already selected under
  `backend/models/` remain source. Downloaded model binaries remain excluded.

The classifier is explicit and fail-closed:

- Quality source extensions: `.cjs`, `.js`, `.mjs`, `.py`, `.ts`, `.cts`, `.css`,
  `.html`.
- Quality report extensions: `.json`, `.md`, `.txt`, `.log`, `.tap`, `.csv`,
  `.tsv`, `.sha256`, `.diff` (UTF-8 text only).
- Extensionless quality report names: `SHA256SUMS`, `EVIDENCE-SHA256SUMS`,
  `SOURCE-SHA256SUMS`.
- Allowed binary QA evidence extensions: `.png`, `.jpg`, `.jpeg`, `.webp`,
  `.rgba`, `.rgba.gz`, `.bmp`, `.tif`, `.tiff`.

All selected quality source/reports must decode as UTF-8 without NUL bytes.
An unknown type or binary content disguised as a report is an error, not a reason
to silently include or omit it. Any new type or selection scope requires an
explicit, reviewed allowlist change. Arbitrary fonts/installers/models never
become QA evidence just by residing under `quality/`.

## Freeze, upload, then build source

Finish the source/test/report work first. Do not generate new evidence, rerun
side-effecting evidence tests, or edit binary fixtures between freezing QA and
building the source archive. Run the packaging regression tests before freezing:

```sh
python3 tools/archive-quality.test.py
```

Choose existing destination directories and **new** ZIP filenames. The tool
refuses to overwrite any existing archive, including historical full overlays.

### 1. Freeze only the binary QA archive

```sh
python3 tools/archive-checkpoint.py \
  --checkpoint-revision 15 \
  --qa-output /path/to/MintPortrait-QA-Checkpoint15.zip
```

This writes the QA ZIP and `QA-CHECKPOINT-FILES.json`. It prints the ZIP's exact
filename, byte count, SHA-256, file count, checkpoint revision, and
`qaManifestSha256`. It does **not** rewrite `CHECKPOINT-FILES.json`, author
`QA-RESTORE.json`, or change any evidence/source file. The manifest is written
only after ZIP CRC and every member's bytes/hash have passed readback.

### 2. Persist the exact QA ZIP and record its real identity

Upload this exact ZIP through the approved Library flow. Retain the upload's
confirmed Library file ID and version. Author `QA-RESTORE.json` at the source
root using the following fields; all example tokens must be replaced with actual
values. There is intentionally no fake default ID in the tool or repository.

```json
{
  "schemaVersion": 1,
  "kind": "quality-archive-restore",
  "checkpointRevision": 15,
  "libraryFileId": "<verified Library file ID from the upload>",
  "libraryVersion": 0,
  "fileName": "<exact fileName printed by --qa-output>",
  "bytes": 0,
  "sha256": "<exact archive sha256 printed by --qa-output>",
  "qaManifestSha256": "<exact qaManifestSha256 printed by --qa-output>"
}
```

`libraryVersion` and `bytes` above are illustrative, not approved values: use the
actual version and nonzero byte count. An initial Library upload may report
`current_version_number: 0` with a null `version_id`; record integer `0` exactly
when that is the tool-reported version. Do not invent version 1. Later uploads
must likewise use their actual nonnegative integer version. Negative numbers,
booleans, strings, and null are not valid `libraryVersion` values.
Record only verified upload metadata. The
ZIP's own manifest must match the local manifest exactly. Library identity is an
operator assertion; the tool checks its structure and all local integrity
bindings, not remote access/permissions.

### 3. Build only the source archive against frozen QA

```sh
python3 tools/archive-checkpoint.py \
  /path/to/MintPortrait-Source-Checkpoint15.zip \
  --checkpoint-revision 15 \
  --qa-archive /path/to/MintPortrait-QA-Checkpoint15.zip
```

This checks the original QA ZIP's bytes/hash against `QA-RESTORE.json`, validates
its exact member list, rejects ZIP symlinks, reads every member/hash and CRC, and
requires every local QA file to match the frozen manifest. Newly selected,
missing, or modified QA binaries stop the source build. It never regenerates,
modifies, or silently updates the frozen QA ZIP, QA manifest, or restore record.
It then writes the source ZIP and updates `CHECKPOINT-FILES.json` after source
archive readback. Source files must also remain unchanged while being archived.

A later source-only checkpoint can reuse the same verified QA archive and
manifest if every QA binary remains identical. Pass the later source revision
explicitly; it must not predate the QA revision. A changed binary/selection needs
an explicit new QA freeze, new persistence/verification, and updated restore
metadata. Do not fabricate a new QA identity for unchanged bytes.

ZIP members are sorted relative POSIX paths with fixed ZIP timestamps and
permissions. Rebuilding the same inputs, metadata, and checkpoint revision with
the same Python/zlib implementation produces the same ZIP bytes. CRC and SHA-256
readback covers all members including the manifest itself. Source/QA symlink
components, traversal/absolute paths, duplicate archive members, and excluded
payloads fail closed. Output publication does not replace an existing file.

## Restore and run fixture-dependent tests

1. Restore the verified base and current source overlay into the intended source
   directory. Preserve any pre-existing local evidence rather than overwriting
   it with a conflicting archive.
2. Read `QA-RESTORE.json` from that source overlay, obtain that exact Library
   file/version, and retain the downloaded ZIP. Its download filename may vary;
   integrity is verified by bytes and SHA-256, not by the local filename.
3. Restore the companion into the source directory, preserving its relative
   paths:

```sh
python3 tools/archive-checkpoint.py \
  --restore-qa /path/to/downloaded-QA.zip
python3 tools/archive-checkpoint.py --verify-qa
```

`--restore-qa` validates the entire archive and every destination before its first
write. It only creates missing files under the manifest's `quality/` paths,
leaves already matching files untouched, and refuses to overwrite different
local evidence. It never deletes evidence or extracts unlisted archive members.
For a conflict, preserve/move the local evidence yourself or restore into a clean
source tree; do not use deletion or a forced overwrite to conceal a mismatch.
A restored companion has exactly the same bytes, hashes, and relative paths as
the pre-split evidence.

Then run the existing real test command with QA verification as a prerequisite:

```sh
python3 tools/archive-checkpoint.py --verify-qa && \
node --test --test-concurrency=2 tests/*.test.cjs tests/manual-qa/*.test.cjs
```

Some source tests use retained public-photo fixtures and native-text/synthetic
PNG evidence. A source-only download is **not** sufficient to run those tests.
Missing/corrupt QA is a nonzero failure saying restoration is required. Do not
mark fixture-dependent tests as passed, add silent skips, substitute different
photos, fetch/recreate evidence to hide a missing archive, or weaken assertions.
Independent source-only tests may be run intentionally, but are not a full-suite
pass. Restoring QA does not install native dependencies, fonts, or a browser, and
does not establish Windows or interactive UI acceptance.

For an additional check of the retained ZIP and its metadata:

```sh
python3 tools/archive-checkpoint.py --verify-qa \
  --qa-archive /path/to/downloaded-QA.zip
```

All commands default to the source root containing this tool. `--root PATH`
selects another explicit source root without following symlinks. The packaging
regression tests use only temporary synthetic trees; they do not modify real
source/QA manifests or evidence.

## Checkpoint 20 addition

Only quality/portrait-people-qa/** and checkpoints/people-* are added to curation.
The exact public synthetic-composite inputs and recorded CPU landmark metadata
are included for reproducibility, with their source/rights record. This does not
add all quality subtrees or private feedback. The two input PNGs and generated
comparison PNGs remain in the separate QA archive; code/JSON/reports remain in
source. No new model, runtime, font or installer binary is added.

## Candidate schema 2: stable baseline plus append-only increments

This section documents the candidate implementation, not a migrated production
checkpoint. Checkpoint 21 release packaging is unaffected. The checkpoint-20 QA
baseline remains the exact retained object below, with its original schema-1
manifest and ZIP bytes:

- Library file: `libfile_c60c939b4c948191b422c7dc7b15e49e`, version **4**.
- Filename: `MintPortrait-QA-Checkpoint20.zip`.
- Size: **61,564,488 bytes**; **127** binary QA files.
- ZIP SHA-256: `4b39f257cf700d59b5da62e2fdaf41802f41e58fc6da5e9e8e4c4630f40b7b1d`.
- Own manifest SHA-256: `85ea2c7bacca449eed04da02d3232ad2a2aab680cfb7af3170d30d34addf863c`.

Do not upload or rebuild this baseline when adding future geometry or other
feature evidence. A new increment contains only newly selected binary paths.
The original baseline can be read-only. Existing evidence cannot be removed,
modified, renamed, or shadowed by an increment, even if duplicate bytes match.
If a new experiment supersedes old evidence, retain the old path and give the
new evidence a distinct reviewed path. Empty increments fail; source-only
changes continue to reuse all unchanged archives.

### Metadata and integrity model

The source-root `QA-CHECKPOINT-FILES.json` becomes schema 2 with kind
`curated-quality-evidence-archive-set`. It contains:

- `checkpointRevision`: the newest increment revision, an exact positive integer.
- `baseLibraryFile`, `baseVersion`, and `selectionPolicy`: unchanged source-base
  and curation information.
- `files`: the nonempty, sorted, exact union of all binary file records, each with
  `path`, `bytes`, and `sha256`. The usual narrow curation remains unchanged.
- `archives`: one `baseline` reference followed by `increment` references in
  strictly increasing checkpoint revision order. Every reference has exactly
  `role`, `checkpointRevision`, `bytes`, `sha256`, and `qaManifestSha256`.

Each ZIP retains its own `QA-CHECKPOINT-FILES.json`. The baseline retains schema 1
unchanged. An increment uses schema 2, kind
`curated-quality-evidence-increment`, and a `files` list containing only its
nonempty delta. Its `previousArchives` field freezes the complete previous
archive records, including their operator-verified Library IDs and versions.
Thus later metadata cannot silently swap an earlier identity, version, original
filename, size, hash, or manifest hash. Each archive's exact member list, each
member's size/hash, and CRC are independently checked, not merely the union.

`QA-RESTORE.json` uses the following exact top-level structure:

```text
schemaVersion: 2
kind: quality-archive-set-restore
state: frozen
checkpointRevision: the newest increment revision
qaManifestSha256: SHA-256 of the exact source-root combined manifest bytes
archives: baseline record, then every increment record in revision order
```

Every archive record has exactly these fields:

```text
role, checkpointRevision, libraryFileId, libraryVersion, fileName,
bytes, sha256, qaManifestSha256
```

`qaManifestSha256` inside each archive record is that archive's own manifest
hash, not the combined hash. `libraryVersion` accepts the actual nonnegative
integer returned by Library, including zero; booleans, floats, strings and null
are rejected. `fileName` is the original uploaded filename, not a local path or
private download URL. Downloaded copies may have different local filenames.
The `(libraryFileId, libraryVersion)` pairs must be distinct across the set.

Pending state, missing fields, placeholder IDs/hashes, extra fields such as
private download URLs, archive overlap, empty archives, mismatched revisions,
conflicting hashes, or an incomplete archive list all fail closed. The combined
file manifest must equal the archive union exactly, and source builds additionally
require that it equals the entire current curated QA selection.

Library IDs are operator assertions backed by real upload responses. This
standard-library-only offline helper cannot prove that an arbitrary syntactically
valid Library ID exists or that a user has access to it. It never invents IDs,
uploads, queries Library, or discovers/downloads private URLs. Record only the
actual verified upload result. The explicit `frozen` state is not a substitute
for that verification; byte/hash checks independently verify every local ZIP.

### Freeze only a new feature increment

1. Finish and test the new evidence under explicitly curated paths. Keep every
   existing binary byte unchanged. Keep archive files and operation receipts
   outside the source root.
2. Provide every current archive explicitly, including the stable baseline.
   For the first increment after checkpoint 21, for example:

```sh
python3 tools/archive-checkpoint.py \
  --checkpoint-revision 22 \
  --qa-increment-output /path/to/MintPortrait-QA-Geometry-Checkpoint22.zip \
  --qa-archive /path/to/MintPortrait-QA-Checkpoint20.zip
```

The command validates the complete existing frozen set and local evidence,
selects only new paths, writes and fully reads back the new ZIP, rechecks the
old frozen metadata/archives and evidence, and atomically updates the combined
manifest. Archive publication is exclusive and never overwrites an existing ZIP.

This is an explicit state change, not an automatic source-build side effect.
It does not touch the baseline, any earlier increment, source files, evidence,
or `QA-RESTORE.json`. Because the latter still describes the old set, source
builds and another increment freeze now deliberately fail until the operator
records the new verified metadata. Do not treat a stale restore record as a
successful completed checkpoint. If manifest publication itself fails after the
ZIP is published, the retained ZIP is still a verified artifact; preserve it and
review/recover the matching metadata instead of overwriting the ZIP.

The output includes:

- `qaManifestSha256`: the new increment's own manifest hash.
- `combinedQaManifestSha256`: the new source-root union manifest hash.
- `previousArchives`: the exact prior records to preserve unchanged.
- The new increment's actual `fileName`, `bytes`, `sha256`, revision and file count.

3. Upload **only this new increment** using the approved Library flow. Build the
   complete schema-2 `QA-RESTORE.json` using all unchanged `previousArchives`
   followed by the new archive record, with its actual returned Library file ID
   and version. Use `combinedQaManifestSha256` at the restore document's top level.
   Do not use placeholder metadata or upload another full growing QA ZIP.
4. Verify and build source against the entire set:

```sh
python3 tools/archive-checkpoint.py --verify-qa \
  --qa-archive /path/to/MintPortrait-QA-Checkpoint20.zip \
  --qa-archive /path/to/MintPortrait-QA-Geometry-Checkpoint22.zip

python3 tools/archive-checkpoint.py \
  /path/to/MintPortrait-Source-Checkpoint22.zip \
  --checkpoint-revision 22 \
  --qa-archive /path/to/MintPortrait-QA-Checkpoint20.zip \
  --qa-archive /path/to/MintPortrait-QA-Geometry-Checkpoint22.zip
```

A later increment repeats step 2 with every preceding archive supplied. Its
checkpoint revision must be greater than the latest QA revision. Source-only
checkpoints can use a later source revision without making any new QA ZIP.
Once using schema 2, `--qa-output` is rejected, preventing a mistaken full-freeze
operation from discarding append-only history. One-archive schema-1 freezing,
restore and source building still retain their original valid behavior and APIs.

### Restore an archive set

Download the exact Library file/version for **every** record in the source
checkpoint, then supply all their local paths:

```sh
python3 tools/archive-checkpoint.py \
  --restore-qa /path/to/MintPortrait-QA-Geometry-Checkpoint22.zip \
  --restore-qa /path/to/MintPortrait-QA-Checkpoint20.zip
python3 tools/archive-checkpoint.py --verify-qa
```

Input path order is irrelevant: archives are identified by their full SHA-256,
not by argument order or local filename. Missing, duplicate, extra, corrupt, or
wrong archive bytes stop restoration before publication. The metadata itself
retains chronological baseline/increment order so the lineage is unambiguous.

Every archive is validated and every destination is preflighted before any
binary evidence is published. Matching existing files remain untouched; differing
files, symlink components, and non-directory parent components fail. All missing
members are first staged and hash-checked. Metadata and all archives are checked
again, then each file is published atomically with an exclusive hard link, never
with overwrite or `extractall`. If publication fails, rollback removes only the
exact inodes newly created by this run, never pre-existing files or concurrent
replacements. Empty directories may remain after a failed attempt. This is
per-file atomic publication and best-effort rollback, not a whole-tree
transaction against arbitrary concurrent external edits. Use a quiescent source
tree; neither source nor evidence should be edited while packaging/restoring.

`--verify-qa` without archive arguments retains its old local-fixture preflight
meaning: it checks the frozen combined manifest and all local file hashes. It
cannot prove that downloadable archives or finalized restore metadata are present.
Use all `--qa-archive` arguments when verifying the retained archive set. Source
builds always require all archive bytes and complete frozen restore metadata.

### Candidate regression checks

All tests use synthetic temporary trees and standard Python only; they never
read, upload, restore or rewrite production evidence:

```sh
python3 tools/archive-quality.test.py
python3 tools/archive-incremental.test.py
python3 tools/archive-adversarial.test.py
```

Coverage includes the unchanged 23 legacy regressions, reordered three-archive
restore/build, read-only baseline bytes, exact partition and overlap rejection,
missing/extra/corrupt archives, malformed metadata and predecessor identity
changes, unsafe paths/symlinks, non-directory ancestors, no overwrite, atomic
publication failure/rollback, changed frozen inputs, and CLI compatibility.


## Checkpoint26 image-overlay increment

Only `quality/image-overlay-qa/**` and `checkpoints/image-overlay-*` are appended. New binary evidence is self-created synthetic import/compositing/color-export fixtures, not private user screenshots or newly redistributed portrait assets. The frozen checkpoint20/22/23 archives remain byte-identical and retain their verified Library IDs/versions. `QA-RESTORE.json` lists all required exact archives after successful persistence. Restoring requires the installer source base Library `libfile_409356280a8c8191a5bf3fd3cbdffe91` version1 plus the current source overlay `libfile_c7367392a7ec8191ad5f8bc8dafbc223` version26 and each archive in that JSON. Use the supported Library materialization flow for those identities, then the existing checked `--restore-qa` operation; do not invent private download URLs. No runtime/model/font/installer binaries are included in the source overlay.

## Checkpoint28: bounded perspective increment

Adds only quality/perspective-qa/* and the perspective checkpoint-report prefix. The one exact-path quality/perspective-qa/project-v16-historical.mintproj fixture is curated as binary QA because migration tests read its genuine old-writer bytes; arbitrary project files in quality remain rejected. There are12 new PNGs plus this one synthetic historical project, not private photographs. New code, tests, report logs and manifests remain in source. The previous186 binary files and four archives are unchanged. This increment brings the frozen combined set to199 files.

Verified increment: Library libfile_9933680f203881919a8685db758e2c8f version0, MintPortrait-QA-Perspective-Checkpoint28.zip,422713bytes, SHA256 d1ee614c0add5856e39902b3af0b7ffb5f739f1986e8d5058e61b893d069bb64. QA-RESTORE.json lists all five exact archives. Restore the installer source base libfile_409356280a8c8191a5bf3fd3cbdffe91 version1, overlay current source libfile_c7367392a7ec8191ad5f8bc8dafbc223 version28, materialize the five QA packages through the supported Library flow, then pass all local paths to --restore-qa and run --verify-qa. No private download URL, new account, credential or network helper is needed. Dependencies, model weights, fonts and installer binaries are not carried in the source overlay.
