"""Curated source/QA overlays. No dependency, installer, font, or model payloads.

Freeze QA first, persist its returned metadata in QA-RESTORE.json after upload,
then build a source overlay against that exact QA archive. See
../docs/SOURCE-QA-ARCHIVES.md. This module has no import-time side effects.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import zipfile
import zlib

BASE_LIBRARY_FILE = 'libfile_409356280a8c8191a5bf3fd3cbdffe91'
BASE_VERSION = 1
SOURCE_MANIFEST = 'CHECKPOINT-FILES.json'
QA_MANIFEST = 'QA-CHECKPOINT-FILES.json'
QA_RESTORE = 'QA-RESTORE.json'
GENERATED_METADATA = {SOURCE_MANIFEST, QA_MANIFEST, QA_RESTORE}
EXCLUDED_TREES = {'.venv', 'node_modules', '.build', 'dist', '__pycache__', '.git'}
FORBIDDEN_SUFFIXES = {
    '.exe', '.dll', '.msi', '.msix', '.nupkg', '.zip', '.7z',
    '.safetensors', '.onnx', '.pth', '.pt', '.ckpt', '.gguf', '.bin',
    '.ttf', '.otf', '.woff', '.woff2', '.ttc',
}
QUALITY_CODE_SUFFIXES = {'.cjs', '.js', '.mjs', '.py', '.ts', '.cts', '.css', '.html'}
QUALITY_REPORT_SUFFIXES = {'.json', '.md', '.txt', '.log', '.tap', '.csv', '.tsv', '.sha256', '.diff'}
QUALITY_REPORT_NAMES = {'SHA256SUMS', 'EVIDENCE-SHA256SUMS', 'SOURCE-SHA256SUMS'}
QUALITY_BINARY_SUFFIXES = ('.png', '.jpg', '.jpeg', '.webp', '.rgba', '.rgba.gz', '.bmp', '.tif', '.tiff')
# Project containers are not a generally permitted evidence type. This one
# reviewed historical schema-16 fixture is required by the perspective tests;
# keep its exact path, bytes/hash manifest, and append-only restore guarantees.
QUALITY_BINARY_FIXTURES = {'quality/perspective-qa/project-v16-historical.mintproj'}
# Preserve the previous curated selector, not an unbounded quality/**/* glob.
# Checkpoint28 adds only bounded perspective QA; earlier binary evidence stays frozen.
CURATED_GLOBS = (
    '*.cjs', '*.json', 'src/**/*', 'tests/**/*', 'docs/**/*',
    'installer/generated/*', 'installer/windows-codec/*', 'tools/*.cjs', 'tools/*.py',
    'quality/manual-tools-qa/**/*', 'quality/advanced-tone/*', 'quality/geometry/*',
    'quality/presets/*', 'quality/photo-review/*', 'quality/reference-compare-qa/*',
    'quality/levels-qa/*', 'quality/preview-pixel-inspector-qa/*', 'quality/recovery-qa/*',
    'quality/padding-qa/*', 'quality/text-qa/*', 'quality/text-renderer-qa/*',
    'quality/export-size-qa/*', 'quality/light-balance-qa/*', 'quality/redact-qa/*',
    'quality/paint-qa/**/*', 'quality/portrait-people-qa/**/*', 'quality/straighten-qa/**/*', 'quality/sharpness-qa/**/*', 'quality/image-overlay-qa/**/*',
    'quality/perspective-qa/*',
)
CHECKPOINT_PREFIXES = (
    'manual', 'tone', 'geometry', 'presets', 'photo-review', 'reference-compare',
    'levels', 'recovery', 'padding', 'text', 'export-size', 'light-balance', 'redaction', 'paint', 'people', 'straighten', 'sharpness', 'image-overlay',
    'perspective',
)
REQUIRED_FILES = (
    'CHECKPOINT.md', 'CHECKPOINT.txt', 'README.md', 'installer/BUILD.md',
    'installer/MintPortrait.nsi', 'installer/prepare.py', 'installer/payload-manifest.json',
    'installer/out/online-validation.json', 'installer/out/offline-validation.json',
)


class ArchiveError(RuntimeError):
    """A fail-closed curation, integrity, or restoration error."""


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def checked_root(root: Path) -> Path:
    root = root.absolute()
    if not root.is_dir() or any(part.is_symlink() for part in (root, *root.parents)):
        raise ArchiveError('Source root must be an existing directory without symlink components')
    return root


def relative_path(name: str) -> PurePosixPath:
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\x00' in name:
        raise ArchiveError(f'Invalid checkpoint relative path: {name!r}')
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or path.as_posix() != name or name.endswith('/'):
        raise ArchiveError(f'Invalid checkpoint relative path: {name!r}')
    if any(part in EXCLUDED_TREES for part in path.parts):
        raise ArchiveError(f'Excluded build tree: {name}')
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        raise ArchiveError(f'Unexpected installer, runtime, font, archive, or model payload: {name}')
    return path


def checked_path(root: Path, name: str, *, required: bool = True) -> Path:
    """Reject every symlink component, including links pointing within root."""
    root = checked_root(root)
    rel = relative_path(name)
    path = root
    for index, part in enumerate(rel.parts):
        path = path / part
        if path.is_symlink():
            raise ArchiveError(f'Checkpoint symlink is not allowed: {name}')
        if index < len(rel.parts) - 1 and path.exists() and not path.is_dir():
            raise ArchiveError(f'Checkpoint parent is not a directory: {name}')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ArchiveError(f'Checkpoint path escapes source root: {name}')
    if required and not path.is_file():
        raise ArchiveError(f'Missing retained checkpoint file: {name}')
    if path.exists() and not path.is_file():
        raise ArchiveError(f'Checkpoint path is not a regular file: {name}')
    return path


def safe_glob(root: Path, pattern: str):
    """The curated glob semantics, without ever descending into a symlink."""
    root = checked_root(root)
    parts = pattern.split('/')

    def walk(directory: Path, index: int):
        part = parts[index]
        if part == '**':
            yield from walk(directory, index + 1)
            for entry in sorted(directory.iterdir()):
                if entry.name in EXCLUDED_TREES:
                    continue
                if entry.is_symlink():
                    raise ArchiveError(f'Checkpoint symlink is not allowed: {entry.relative_to(root)}')
                if entry.is_dir():
                    yield from walk(entry, index)
            return
        for entry in sorted(directory.iterdir()):
            if not fnmatch.fnmatchcase(entry.name, part) or entry.name in EXCLUDED_TREES:
                continue
            if entry.is_symlink():
                raise ArchiveError(f'Checkpoint symlink is not allowed: {entry.relative_to(root)}')
            if index == len(parts) - 1:
                if entry.is_file():
                    yield entry.relative_to(root).as_posix()
            elif entry.is_dir():
                yield from walk(entry, index + 1)

    yield from walk(root, 0)


def read_json(root: Path, name: str) -> tuple[dict, bytes]:
    raw = checked_path(root, name).read_bytes()
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ArchiveError(f'Invalid JSON in {name}: {exc}') from exc
    if not isinstance(value, dict):
        raise ArchiveError(f'{name} must contain a JSON object')
    return value, raw


def manifest_entries(manifest: dict, name: str) -> list[dict]:
    entries = manifest.get('files')
    if not isinstance(entries, list):
        raise ArchiveError(f'{name} is missing its file list')
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ArchiveError(f'Invalid file entry in {name}')
        relative_path(entry.get('path'))
        if entry['path'] in seen:
            raise ArchiveError(f'Duplicate retained path in {name}: {entry["path"]}')
        seen.add(entry['path'])
        if type(entry.get('bytes')) is not int or entry['bytes'] < 0 or not re.fullmatch(r'[0-9a-f]{64}', str(entry.get('sha256', ''))):
            raise ArchiveError(f'Invalid size/hash in {name}: {entry["path"]}')
    return entries


def collect_names(root: Path) -> set[str]:
    old, _ = read_json(root, SOURCE_MANIFEST)
    names = {entry['path'] for entry in manifest_entries(old, SOURCE_MANIFEST)}
    qa_path = checked_path(root, QA_MANIFEST, required=False)
    if qa_path.exists():
        qa, _ = read_json(root, QA_MANIFEST)
        names.update(entry['path'] for entry in manifest_entries(qa, QA_MANIFEST))
    for pattern in CURATED_GLOBS:
        for name in safe_glob(root, pattern):
            if name.startswith('quality/manual-tools-qa/') and name.endswith('.rgba.gz') and '/fixtures/' not in name:
                continue
            if name.startswith('quality/advanced-tone/') and name.lower().endswith('.png') and PurePosixPath(name).name != 'hue-boundary-contact.png':
                continue
            names.add(name)
    names.update(REQUIRED_FILES)
    for prefix in CHECKPOINT_PREFIXES:
        names.update(safe_glob(root, f'checkpoints/{prefix}-*'))
    names.difference_update(GENERATED_METADATA)
    names = {name for name in names if not name.endswith('-source-archive.json')}
    for name in sorted(names):
        checked_path(root, name)
    return names


def is_quality_binary_name(name: str) -> bool:
    """One shared type allowlist for selection and every manifest/restore schema."""
    return name.startswith('quality/') and (
        name.lower().endswith(QUALITY_BINARY_SUFFIXES) or name in QUALITY_BINARY_FIXTURES)


def is_quality_binary(root: Path, name: str) -> bool:
    if not name.startswith('quality/'):
        return False
    path = PurePosixPath(name)
    if path.suffix.lower() in QUALITY_CODE_SUFFIXES | QUALITY_REPORT_SUFFIXES or path.name in QUALITY_REPORT_NAMES:
        raw = checked_path(root, name).read_bytes()
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError as exc:
            raise ArchiveError(f'Quality code/report is not UTF-8 text: {name}') from exc
        if b'\x00' in raw:
            raise ArchiveError(f'Binary data disguised as a quality code/report: {name}')
        return False
    if is_quality_binary_name(name):
        return True
    raise ArchiveError(f'Unrecognized quality file type; explicitly review its classification: {name}')


def split_names(root: Path) -> tuple[list[str], list[str]]:
    source, qa = [], []
    for name in sorted(collect_names(root)):
        (qa if is_quality_binary(root, name) else source).append(name)
    return source, qa


def file_entry(root: Path, name: str) -> dict:
    raw = checked_path(root, name).read_bytes()
    return {'path': name, 'bytes': len(raw), 'sha256': sha256(raw)}


def verify_files(root: Path, entries: list[dict], *, qa: bool = False):
    for entry in entries:
        try:
            actual = file_entry(root, entry['path'])
            if actual != entry:
                raise ArchiveError(f'File bytes/hash changed: {entry["path"]}')
        except ArchiveError as exc:
            if qa:
                raise ArchiveError(f'QA restoration required or frozen QA changed: {exc}. Restore the exact archive in {QA_RESTORE}; see docs/SOURCE-QA-ARCHIVES.md. Do not skip fixture-dependent tests.') from exc
            raise


def _read_qa_manifest_v1(root: Path) -> tuple[dict, bytes]:
    try:
        manifest, raw = read_json(root, QA_MANIFEST)
    except ArchiveError as exc:
        raise ArchiveError(f'Frozen QA manifest required: {exc}. Run --qa-output only after QA is final, or restore the source overlay.') from exc
    if type(manifest.get('schemaVersion')) is not int or manifest['schemaVersion'] != 1 or manifest.get('kind') != 'curated-quality-evidence-overlay':
        raise ArchiveError(f'Unsupported {QA_MANIFEST} schema/kind')
    if type(manifest.get('checkpointRevision')) is not int or manifest['checkpointRevision'] < 1:
        raise ArchiveError(f'Invalid checkpoint revision in {QA_MANIFEST}')
    entries = manifest_entries(manifest, QA_MANIFEST)
    if not entries or [entry['path'] for entry in entries] != sorted(entry['path'] for entry in entries):
        raise ArchiveError('QA manifest must contain a nonempty sorted file list')
    for entry in entries:
        if not is_quality_binary_name(entry['path']):
            raise ArchiveError(f'QA archive may only contain curated binary evidence: {entry["path"]}')
    return manifest, raw


def verify_archive(path: Path, entries: list[dict], manifest_name: str, manifest_raw: bytes):
    expected = {entry['path']: entry for entry in entries}
    expected[manifest_name] = {'path': manifest_name, 'bytes': len(manifest_raw), 'sha256': sha256(manifest_raw)}
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) != len(expected) or {info.filename for info in infos} != set(expected):
                raise ArchiveError('Archive member list differs from its curated manifest')
            for info in infos:
                relative_path(info.filename)
                if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                    raise ArchiveError(f'Archive contains a directory or symlink: {info.filename}')
                entry = expected[info.filename]
                if info.file_size != entry['bytes']:
                    raise ArchiveError(f'Archive member size mismatch: {info.filename}')
                if sha256(archive.read(info)) != entry['sha256']:
                    raise ArchiveError(f'Archive member hash mismatch: {info.filename}')
            if archive.testzip() is not None:
                raise ArchiveError('Archive CRC readback failed')
    except (OSError, zipfile.BadZipFile, RuntimeError, EOFError, zlib.error) as exc:
        if isinstance(exc, ArchiveError):
            raise
        raise ArchiveError(f'Archive verification failed: {exc}') from exc


def checked_archive_path(path: Path, *, new: bool = False) -> Path:
    path = path.absolute()
    if path.suffix.lower() != '.zip':
        raise ArchiveError('Archive path must end in .zip')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ArchiveError(f'Archive path must not traverse a symlink: {path}')
    if new and path.exists():
        raise ArchiveError(f'Refusing to overwrite a retained archive: {path}')
    if not new and not path.is_file():
        raise ArchiveError(f'Missing QA archive: {path}')
    if not path.parent.is_dir():
        raise ArchiveError(f'Archive parent directory does not exist: {path.parent}')
    return path


def atomic_metadata(root: Path, name: str, raw: bytes):
    target = checked_path(root, name, required=False)
    fd, temporary = tempfile.mkstemp(prefix=f'.{name}.', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(raw)
        Path(temporary).replace(target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_archive(root: Path, output: Path, entries: list[dict], manifest_name: str, manifest_raw: bytes, *, prepublish=None):
    output = checked_archive_path(output, new=True)
    fd, temporary = tempfile.mkstemp(prefix='.checkpoint-', suffix='.zip', dir=output.parent)
    os.close(fd)
    temp = Path(temporary)
    try:
        with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            by_name = {entry['path']: entry for entry in entries}
            for name in sorted([*by_name, manifest_name]):
                raw = manifest_raw if name == manifest_name else checked_path(root, name).read_bytes()
                if name != manifest_name and (len(raw) != by_name[name]['bytes'] or sha256(raw) != by_name[name]['sha256']):
                    raise ArchiveError(f'File changed while archiving: {name}')
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        verify_archive(temp, entries, manifest_name, manifest_raw)
        verify_files(root, entries)
        if prepublish is not None:
            prepublish()
        # Re-read after potentially slow archive-set validation, not only before.
        verify_files(root, entries)
        # Exclusive publication: never replace an existing source/QA archive,
        # including the retained full checkpoint 14.
        os.link(temp, output)
    finally:
        temp.unlink(missing_ok=True)
    return {'file': str(output), 'fileName': output.name, 'bytes': output.stat().st_size,
            'sha256': sha256(output.read_bytes()), 'files': len(entries), 'crcAndHashReadback': 'passed'}


def freeze_qa(root: Path, output: Path, revision: int) -> dict:
    positive_revision(revision)
    existing = checked_path(root, QA_MANIFEST, required=False)
    if existing.exists() and read_json(root, QA_MANIFEST)[0].get('schemaVersion') == 2:
        raise ArchiveError('An archive set is append-only; use --qa-increment-output, not a replacement full QA freeze')
    _, qa_names = split_names(root)
    if not qa_names:
        raise ArchiveError('No curated binary QA evidence was selected')
    entries = [file_entry(root, name) for name in qa_names]
    manifest = {'schemaVersion': 1, 'kind': 'curated-quality-evidence-overlay',
                'checkpointRevision': revision, 'baseLibraryFile': BASE_LIBRARY_FILE,
                'baseVersion': BASE_VERSION, 'selectionPolicy': 'curated-checkpoint-globs-v1',
                'files': entries}
    raw = json_bytes(manifest)
    result = write_archive(root, output, entries, QA_MANIFEST, raw)
    atomic_metadata(root, QA_MANIFEST, raw)
    return {**result, 'checkpointRevision': revision, 'qaManifestSha256': sha256(raw),
            'nextStep': 'Upload this exact QA ZIP, then write operator-verified Library identity and these hashes to QA-RESTORE.json. No Library ID has been invented.'}


def _read_restore_v1(root: Path, manifest: dict, manifest_raw: bytes, archive_path: Path) -> dict:
    restore, _ = read_json(root, QA_RESTORE)
    if type(restore.get('schemaVersion')) is not int or restore['schemaVersion'] != 1 or restore.get('kind') != 'quality-archive-restore':
        raise ArchiveError(f'Unsupported {QA_RESTORE} schema/kind')
    if not re.fullmatch(r'libfile_[0-9a-f]{32}', str(restore.get('libraryFileId', ''))):
        raise ArchiveError(f'{QA_RESTORE} requires the operator-verified Library file ID, not a placeholder')
    if type(restore.get('libraryVersion')) is not int or restore['libraryVersion'] < 0:
        raise ArchiveError(f'{QA_RESTORE} requires the verified nonnegative integer Library version (0 is valid for an initial upload)')
    filename = restore.get('fileName', '')
    if not isinstance(filename, str) or '/' in filename or '\\' in filename or not filename.endswith('.zip'):
        raise ArchiveError(f'{QA_RESTORE} requires the original archive filename, not a path')
    if type(restore.get('checkpointRevision')) is not int or restore['checkpointRevision'] != manifest['checkpointRevision']:
        raise ArchiveError('QA restore metadata and frozen manifest revision differ')
    if restore.get('qaManifestSha256') != sha256(manifest_raw):
        raise ArchiveError('QA restore metadata does not match the frozen QA manifest')
    archive_path = checked_archive_path(archive_path)
    if type(restore.get('bytes')) is not int or restore['bytes'] != archive_path.stat().st_size or restore.get('sha256') != sha256(archive_path.read_bytes()):
        raise ArchiveError('QA archive bytes/hash differ from operator-verified restore metadata')
    verify_archive(archive_path, manifest['files'], QA_MANIFEST, manifest_raw)
    return restore


def _build_source_v1(root: Path, output: Path, revision: int, qa_archive: Path) -> dict:
    manifest, raw = read_qa_manifest(root)
    restore = read_restore(root, manifest, raw, qa_archive)
    verify_files(root, manifest['files'], qa=True)
    source_names, qa_names = split_names(root)
    if qa_names != [entry['path'] for entry in manifest['files']]:
        raise ArchiveError('Curated QA selection changed after freeze. Freeze/upload the new QA archive explicitly; source-only builds never mutate it.')
    if revision < manifest['checkpointRevision']:
        raise ArchiveError('Source revision cannot predate its frozen QA checkpoint')
    source_names += [QA_MANIFEST, QA_RESTORE]
    entries = [file_entry(root, name) for name in sorted(source_names)]
    source = {'schemaVersion': 1, 'kind': 'unreleased-source-overlay',
              'checkpointRevision': revision, 'baseLibraryFile': BASE_LIBRARY_FILE,
              'baseVersion': BASE_VERSION,
              'qualityEvidence': {'storage': 'separate-curated-archive', 'manifest': QA_MANIFEST,
                                  'restoreMetadata': QA_RESTORE,
                                  'libraryFileId': restore['libraryFileId'], 'libraryVersion': restore['libraryVersion'],
                                  'sha256': restore['sha256'], 'qaManifestSha256': sha256(raw)},
              'files': entries}
    source_raw = json_bytes(source)

    def still_frozen():
        if checked_path(root, QA_MANIFEST).read_bytes() != raw:
            raise ArchiveError('Frozen QA manifest changed while archiving source')
        verify_files(root, manifest['files'], qa=True)
        if read_restore(root, manifest, raw, qa_archive) != restore:
            raise ArchiveError('QA restore metadata changed while archiving source')

    result = write_archive(root, output, entries, SOURCE_MANIFEST, source_raw, prepublish=still_frozen)
    atomic_metadata(root, SOURCE_MANIFEST, source_raw)
    return {**result, 'checkpointRevision': revision, 'qaFiles': len(manifest['files']),
            'qaArchiveUnchanged': restore['sha256'], 'qaLibraryFileId': restore['libraryFileId']}


def _restore_qa_v1(root: Path, archive_path: Path) -> dict:
    manifest, raw = read_qa_manifest(root)
    restore = read_restore(root, manifest, raw, archive_path)
    # Complete archive verification and target preflight before the first write.
    for entry in manifest['files']:
        target = checked_path(root, entry['path'], required=False)
        if target.exists() and file_entry(root, entry['path']) != entry:
            raise ArchiveError(f'Refusing to overwrite different local QA evidence: {entry["path"]}. Restore into a clean source tree or preserve/move the changed evidence yourself.')
    restored = 0
    with zipfile.ZipFile(archive_path) as archive:
        for entry in manifest['files']:
            target = checked_path(root, entry['path'], required=False)
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as handle:
                handle.write(archive.read(entry['path']))
            restored += 1
    verify_files(root, manifest['files'], qa=True)
    return {'restoredFiles': restored, 'verifiedFiles': len(manifest['files']),
            'qaArchiveSha256': restore['sha256'], 'crcAndHashReadback': 'passed'}


# Schema 2 is an explicit archive set. The first member is an unchanged schema-1
# baseline; later members contain only new paths, never replacements or patches.
SET_KIND = 'curated-quality-evidence-archive-set'
INCREMENT_KIND = 'curated-quality-evidence-increment'
RESTORE_SET_KIND = 'quality-archive-set-restore'
REF_KEYS = {'role', 'checkpointRevision', 'bytes', 'sha256', 'qaManifestSha256'}
RECORD_KEYS = REF_KEYS | {'libraryFileId', 'libraryVersion', 'fileName'}


def archive_paths(value) -> list[Path]:
    """Accept the original one-Path API and an explicit collection of paths."""
    if isinstance(value, (str, os.PathLike)):
        return [Path(value)]
    if not isinstance(value, (list, tuple)) or not value:
        raise ArchiveError('Supply every frozen QA archive explicitly')
    if any(not isinstance(path, (str, os.PathLike)) for path in value):
        raise ArchiveError('Every QA archive input must be an explicit filesystem path')
    return [Path(path) for path in value]


def positive_revision(value):
    if type(value) is not int or value < 1:
        raise ArchiveError('Checkpoint revision must be a positive integer')


def archive_ref(record: dict) -> dict:
    return {key: record[key] for key in sorted(REF_KEYS)}


def validate_ref(ref: dict):
    if not isinstance(ref, dict) or set(ref) != REF_KEYS:
        raise ArchiveError('Archive reference has missing or unexpected fields')
    if ref['role'] not in ('baseline', 'increment'):
        raise ArchiveError('Archive role must be baseline or increment')
    positive_revision(ref['checkpointRevision'])
    if type(ref['bytes']) is not int or ref['bytes'] <= 0:
        raise ArchiveError('Archive reference requires a positive byte count')
    for key in ('sha256', 'qaManifestSha256'):
        if not isinstance(ref[key], str) or not re.fullmatch(r'[0-9a-f]{64}', ref[key]):
            raise ArchiveError(f'Archive reference requires a frozen {key}')


def validate_record(record: dict):
    if not isinstance(record, dict) or set(record) != RECORD_KEYS:
        raise ArchiveError('Frozen archive record has missing or unexpected fields; placeholders and URLs are not metadata')
    validate_ref(archive_ref(record))
    if not re.fullmatch(r'libfile_[0-9a-f]{32}', str(record['libraryFileId'])):
        raise ArchiveError('Archive record requires the operator-verified Library file ID, not a placeholder')
    if type(record['libraryVersion']) is not int or record['libraryVersion'] < 0:
        raise ArchiveError('Archive record requires the verified nonnegative integer Library version')
    name = record['fileName']
    if not isinstance(name, str) or '/' in name or '\\' in name or ':' in name or '\x00' in name or not name.endswith('.zip') or name == '.zip':
        raise ArchiveError('Archive record requires the original ZIP filename, not a path')


def validate_qa_entries(manifest: dict, label: str) -> list[dict]:
    entries = manifest_entries(manifest, label)
    if not entries or [entry['path'] for entry in entries] != sorted(entry['path'] for entry in entries):
        raise ArchiveError(f'{label} must contain a nonempty sorted file list')
    for entry in entries:
        if set(entry) != {'path', 'bytes', 'sha256'} or not is_quality_binary_name(entry['path']):
            raise ArchiveError(f'QA archive may only contain curated binary evidence: {entry["path"]}')
    return entries


def validate_refs(refs):
    if not isinstance(refs, list) or len(refs) < 2:
        raise ArchiveError('An archive set requires one baseline and at least one increment')
    seen = set()
    previous_revision = 0
    for index, ref in enumerate(refs):
        validate_ref(ref)
        if ref['role'] != ('baseline' if index == 0 else 'increment'):
            raise ArchiveError('Archive set must start with one baseline followed only by increments')
        if ref['checkpointRevision'] <= previous_revision:
            raise ArchiveError('Archive checkpoint revisions must strictly increase')
        previous_revision = ref['checkpointRevision']
        if ref['sha256'] in seen:
            raise ArchiveError('Duplicate archive in the frozen set')
        seen.add(ref['sha256'])


def read_qa_manifest(root: Path) -> tuple[dict, bytes]:
    try:
        manifest, raw = read_json(root, QA_MANIFEST)
    except ArchiveError as exc:
        raise ArchiveError(f'Frozen QA manifest required: {exc}. Run --qa-output only after QA is final, or restore the source overlay.') from exc
    if type(manifest.get('schemaVersion')) is int and manifest['schemaVersion'] == 1:
        return _read_qa_manifest_v1(root)
    if type(manifest.get('schemaVersion')) is not int or manifest['schemaVersion'] != 2 or manifest.get('kind') != SET_KIND:
        raise ArchiveError(f'Unsupported {QA_MANIFEST} schema/kind')
    positive_revision(manifest.get('checkpointRevision'))
    validate_qa_entries(manifest, QA_MANIFEST)
    validate_refs(manifest.get('archives'))
    if manifest['checkpointRevision'] != manifest['archives'][-1]['checkpointRevision']:
        raise ArchiveError('Combined QA revision must match the latest archive')
    return manifest, raw


def read_archive_manifest(path: Path, record: dict) -> tuple[dict, bytes]:
    try:
        with zipfile.ZipFile(path) as archive:
            raw = archive.read(QA_MANIFEST)
        manifest = json.loads(raw)
    except (OSError, KeyError, ValueError, RuntimeError, EOFError, zlib.error, zipfile.BadZipFile) as exc:
        raise ArchiveError(f'Cannot read the frozen archive manifest: {exc}') from exc
    if not isinstance(manifest, dict) or sha256(raw) != record['qaManifestSha256']:
        raise ArchiveError('Archive manifest differs from its frozen hash')
    schema, kind = (1, 'curated-quality-evidence-overlay') if record['role'] == 'baseline' else (2, INCREMENT_KIND)
    if type(manifest.get('schemaVersion')) is not int or manifest['schemaVersion'] != schema or manifest.get('kind') != kind:
        raise ArchiveError('Archive schema/kind does not match its baseline/increment role')
    if type(manifest.get('checkpointRevision')) is not int or manifest['checkpointRevision'] != record['checkpointRevision']:
        raise ArchiveError('Archive manifest and restore record revisions differ')
    validate_qa_entries(manifest, 'archive manifest')
    verify_archive(path, manifest['files'], QA_MANIFEST, raw)
    return manifest, raw


def read_archive_set(root: Path, manifest: dict, raw: bytes, paths) -> tuple[dict, list]:
    restore, _ = read_json(root, QA_RESTORE)
    if set(restore) != {'schemaVersion', 'kind', 'state', 'checkpointRevision', 'qaManifestSha256', 'archives'} or type(restore.get('schemaVersion')) is not int or restore['schemaVersion'] != 2 or restore.get('kind') != RESTORE_SET_KIND or restore.get('state') != 'frozen':
        raise ArchiveError('Schema-2 restore metadata must be complete and explicitly frozen; pending/placeholder metadata is not usable')
    if type(restore['checkpointRevision']) is not int or restore['checkpointRevision'] != manifest['checkpointRevision'] or restore['qaManifestSha256'] != sha256(raw):
        raise ArchiveError('QA restore metadata does not match the frozen combined QA manifest')
    records = restore['archives']
    if not isinstance(records, list) or len(records) != len(manifest['archives']):
        raise ArchiveError('Restore metadata does not describe the complete frozen archive set')
    for record, ref in zip(records, manifest['archives']):
        validate_record(record)
        if archive_ref(record) != ref:
            raise ArchiveError('Restore archive differs from its frozen archive reference')
    identities = [(record['libraryFileId'], record['libraryVersion']) for record in records]
    if len(set(identities)) != len(identities):
        raise ArchiveError('Library file/version identities must be distinct for every archive')
    paths = archive_paths(paths)
    if len(paths) != len(records):
        raise ArchiveError('Supply exactly every frozen QA archive; an archive is missing or extra')
    available = {}
    for path in paths:
        path = checked_archive_path(path)
        digest = sha256(path.read_bytes())
        if digest in available:
            raise ArchiveError('Duplicate QA archive input')
        available[digest] = path
    resolved = []
    combined = {}
    for index, record in enumerate(records):
        path = available.get(record['sha256'])
        if path is None or path.stat().st_size != record['bytes']:
            raise ArchiveError('QA archive bytes/hash differ from the frozen archive set; missing, corrupt, or mismatched archive')
        own, own_raw = read_archive_manifest(path, record)
        if index:
            previous = own.get('previousArchives')
            if not isinstance(previous, list) or len(previous) != index:
                raise ArchiveError('Increment predecessor metadata is incomplete')
            for previous_record in previous:
                validate_record(previous_record)
            if previous != records[:index]:
                raise ArchiveError('Increment predecessor metadata changed; baseline and earlier archive identities are immutable')
        for entry in own['files']:
            if entry['path'] in combined:
                raise ArchiveError(f'Overlapping QA archive paths are forbidden, even with matching hashes: {entry["path"]}')
            combined[entry['path']] = entry
        resolved.append((path, own, own_raw))
    if [combined[name] for name in sorted(combined)] != manifest['files']:
        raise ArchiveError('Combined QA manifest is not the exact union of the verified archives')
    return restore, resolved


def read_restore(root: Path, manifest: dict, manifest_raw: bytes, archive_path) -> dict:
    if manifest['schemaVersion'] == 1:
        paths = archive_paths(archive_path)
        if len(paths) != 1:
            raise ArchiveError('Schema-1 QA requires exactly one archive')
        return _read_restore_v1(root, manifest, manifest_raw, paths[0])
    return read_archive_set(root, manifest, manifest_raw, archive_path)[0]


def frozen_records(root: Path, manifest: dict, raw: bytes, paths) -> list[dict]:
    restore = read_restore(root, manifest, raw, paths)
    if manifest['schemaVersion'] == 2:
        return restore['archives']
    record = {key: restore[key] for key in RECORD_KEYS - {'role'}}
    record['role'] = 'baseline'
    validate_record(record)
    return [record]


def freeze_qa_increment(root: Path, output: Path, revision: int, qa_archives) -> dict:
    """Explicit append-only freeze. Never edit archives, evidence, or restore IDs."""
    positive_revision(revision)
    manifest, raw = read_qa_manifest(root)
    restore_raw = checked_path(root, QA_RESTORE).read_bytes()
    records = frozen_records(root, manifest, raw, qa_archives)
    if revision <= manifest['checkpointRevision']:
        raise ArchiveError('Increment revision must be later than the entire frozen QA set')
    verify_files(root, manifest['files'], qa=True)
    _, qa_names = split_names(root)
    previous = {entry['path'] for entry in manifest['files']}
    if not previous.issubset(qa_names):
        raise ArchiveError('Increment cannot remove previously retained QA paths')
    names = sorted(set(qa_names) - previous)
    if not names:
        raise ArchiveError('Empty QA increments are not allowed; reuse the existing archive set')
    entries = [file_entry(root, name) for name in names]
    increment = {'schemaVersion': 2, 'kind': INCREMENT_KIND, 'checkpointRevision': revision,
                 'baseLibraryFile': BASE_LIBRARY_FILE, 'baseVersion': BASE_VERSION,
                 'selectionPolicy': 'curated-checkpoint-globs-v1', 'previousArchives': records, 'files': entries}
    increment_raw = json_bytes(increment)

    def still_frozen():
        if checked_path(root, QA_MANIFEST).read_bytes() != raw or checked_path(root, QA_RESTORE).read_bytes() != restore_raw:
            raise ArchiveError('Frozen QA metadata changed while freezing the increment')
        if frozen_records(root, manifest, raw, qa_archives) != records:
            raise ArchiveError('Frozen QA archive set changed while freezing the increment')
        verify_files(root, manifest['files'], qa=True)
        if split_names(root)[1] != qa_names:
            raise ArchiveError('Curated QA selection changed while freezing the increment')

    result = write_archive(root, output, entries, QA_MANIFEST, increment_raw, prepublish=still_frozen)
    ref = {'role': 'increment', 'checkpointRevision': revision, 'bytes': result['bytes'],
           'sha256': result['sha256'], 'qaManifestSha256': sha256(increment_raw)}
    combined = {'schemaVersion': 2, 'kind': SET_KIND, 'checkpointRevision': revision,
                'baseLibraryFile': BASE_LIBRARY_FILE, 'baseVersion': BASE_VERSION,
                'selectionPolicy': 'curated-checkpoint-globs-v1',
                'archives': [archive_ref(record) for record in records] + [ref],
                'files': sorted(manifest['files'] + entries, key=lambda entry: entry['path'])}
    combined_raw = json_bytes(combined)
    atomic_metadata(root, QA_MANIFEST, combined_raw)
    return {**result, 'checkpointRevision': revision, 'qaManifestSha256': sha256(increment_raw),
            'combinedQaManifestSha256': sha256(combined_raw), 'totalQaFiles': len(combined['files']),
            'previousArchives': records,
            'nextStep': 'Upload only this increment through the approved Library flow. Record its actual Library identity in a complete frozen schema-2 QA-RESTORE.json, retaining every previous archive record exactly. Existing restore metadata is intentionally unchanged and cannot build source until updated. No Library ID has been invented.'}


def build_source(root: Path, output: Path, revision: int, qa_archive) -> dict:
    positive_revision(revision)
    manifest, raw = read_qa_manifest(root)
    if manifest['schemaVersion'] == 1:
        paths = archive_paths(qa_archive)
        if len(paths) != 1:
            raise ArchiveError('Schema-1 QA requires exactly one archive')
        return _build_source_v1(root, output, revision, paths[0])
    positive_revision(revision)
    restore_raw = checked_path(root, QA_RESTORE).read_bytes()
    restore = read_restore(root, manifest, raw, qa_archive)
    verify_files(root, manifest['files'], qa=True)
    source_names, qa_names = split_names(root)
    if qa_names != [entry['path'] for entry in manifest['files']]:
        raise ArchiveError('Curated QA selection changed after freeze; freeze an explicit new increment')
    if revision < manifest['checkpointRevision']:
        raise ArchiveError('Source revision cannot predate its frozen QA checkpoint')
    source_names += [QA_MANIFEST, QA_RESTORE]
    entries = [file_entry(root, name) for name in sorted(source_names)]
    source = {'schemaVersion': 1, 'kind': 'unreleased-source-overlay',
              'checkpointRevision': revision, 'baseLibraryFile': BASE_LIBRARY_FILE, 'baseVersion': BASE_VERSION,
              'qualityEvidence': {'storage': 'separate-curated-archive-set', 'manifest': QA_MANIFEST,
                                  'restoreMetadata': QA_RESTORE, 'restoreMetadataSha256': sha256(restore_raw),
                                  'qaManifestSha256': sha256(raw), 'archives': restore['archives']},
              'files': entries}
    source_raw = json_bytes(source)

    def still_frozen():
        if checked_path(root, QA_MANIFEST).read_bytes() != raw or checked_path(root, QA_RESTORE).read_bytes() != restore_raw:
            raise ArchiveError('Frozen QA metadata changed while archiving source')
        if read_restore(root, manifest, raw, qa_archive) != restore:
            raise ArchiveError('Frozen QA archive set changed while archiving source')
        verify_files(root, manifest['files'], qa=True)
        if split_names(root)[1] != qa_names:
            raise ArchiveError('Curated QA selection changed while archiving source')

    result = write_archive(root, output, entries, SOURCE_MANIFEST, source_raw, prepublish=still_frozen)
    atomic_metadata(root, SOURCE_MANIFEST, source_raw)
    return {**result, 'checkpointRevision': revision, 'qaFiles': len(manifest['files']),
            'qaArchivesUnchanged': [record['sha256'] for record in restore['archives']],
            'qaLibraryFiles': [{'libraryFileId': record['libraryFileId'], 'libraryVersion': record['libraryVersion']}
                               for record in restore['archives']]}


def restore_qa(root: Path, archive_path) -> dict:
    manifest, raw = read_qa_manifest(root)
    if manifest['schemaVersion'] == 1:
        paths = archive_paths(archive_path)
        if len(paths) != 1:
            raise ArchiveError('Schema-1 QA requires exactly one archive')
        return _restore_qa_v1(root, paths[0])
    restore_raw = checked_path(root, QA_RESTORE).read_bytes()
    restore, resolved = read_archive_set(root, manifest, raw, archive_path)
    missing = set()
    # All archives and all destinations are checked before any evidence writes.
    for entry in manifest['files']:
        target = checked_path(root, entry['path'], required=False)
        if target.exists():
            if file_entry(root, entry['path']) != entry:
                raise ArchiveError(f'Refusing to overwrite different local QA evidence: {entry["path"]}')
        else:
            missing.add(entry['path'])
    published = []
    try:
        with tempfile.TemporaryDirectory(prefix='.qa-restore-', dir=checked_root(root)) as staging:
            staged = []
            for path, own, _ in resolved:
                with zipfile.ZipFile(path) as archive:
                    for entry in own['files']:
                        if entry['path'] not in missing:
                            continue
                        content = archive.read(entry['path'])
                        if len(content) != entry['bytes'] or sha256(content) != entry['sha256']:
                            raise ArchiveError('QA archive changed while staging restoration')
                        temporary = Path(staging) / str(len(staged))
                        temporary.write_bytes(content)
                        staged.append((entry, temporary))
            if checked_path(root, QA_MANIFEST).read_bytes() != raw or checked_path(root, QA_RESTORE).read_bytes() != restore_raw:
                raise ArchiveError('Frozen QA metadata changed while staging restoration')
            read_archive_set(root, manifest, raw, archive_path)
            for entry, temporary in staged:
                target = checked_path(root, entry['path'], required=False)
                target.parent.mkdir(parents=True, exist_ok=True)
                target = checked_path(root, entry['path'], required=False)
                os.link(temporary, target)  # Fully staged bytes, atomic and exclusive.
                published.append((entry['path'], temporary.stat().st_ino, temporary.stat().st_dev))
            verify_files(root, manifest['files'], qa=True)
    except Exception:
        # Undo only this run's exact newly published inodes, never someone else's
        # replacement. Matching pre-existing files and metadata remain untouched.
        for name, inode, device in reversed(published):
            try:
                target = checked_path(root, name, required=False)
                info = target.lstat()
                if (info.st_ino, info.st_dev) == (inode, device):
                    target.unlink()
            except (ArchiveError, OSError):
                pass
        raise
    return {'restoredFiles': len(published), 'verifiedFiles': len(manifest['files']),
            'qaArchiveSha256s': [record['sha256'] for record in restore['archives']],
            'crcAndHashReadback': 'passed'}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, nargs='?', help='new source-only ZIP; requires --qa-archive')
    parser.add_argument('--root', type=Path, default=Path(__file__).absolute().parents[1])
    parser.add_argument('--checkpoint-revision', type=int)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--qa-output', type=Path, help='freeze selected QA binaries into a new ZIP, then stop')
    modes.add_argument('--qa-increment-output', type=Path, help='explicitly freeze only appended QA paths; requires every prior --qa-archive')
    modes.add_argument('--verify-qa', action='store_true', help='require all frozen QA files before fixture-dependent tests')
    modes.add_argument('--restore-qa', type=Path, action='append', help='verify and restore a downloaded QA ZIP without overwriting evidence')
    parser.add_argument('--qa-archive', type=Path, action='append', help='original frozen QA ZIP, required when building source')
    args = parser.parse_args(argv)
    try:
        root = checked_root(args.root)
        if args.checkpoint_revision is not None and args.checkpoint_revision < 1:
            raise ArchiveError('Checkpoint revision must be a positive integer')
        if args.output and (args.qa_output or args.qa_increment_output or args.verify_qa or args.restore_qa):
            raise ArchiveError('Freeze/restore/verify QA separately from building the source ZIP')
        if args.qa_output:
            if args.qa_archive:
                raise ArchiveError('--qa-archive is not used when freezing QA')
            old, _ = read_json(root, SOURCE_MANIFEST)
            revision = args.checkpoint_revision or old.get('checkpointRevision', 0) + 1
            result = freeze_qa(root, args.qa_output, revision)
        elif args.qa_increment_output:
            if not args.qa_archive or args.checkpoint_revision is None:
                raise ArchiveError('--qa-increment-output requires every --qa-archive and an explicit --checkpoint-revision')
            result = freeze_qa_increment(root, args.qa_increment_output, args.checkpoint_revision, args.qa_archive)
        elif args.restore_qa:
            if args.qa_archive:
                raise ArchiveError('Use --restore-qa ZIP, without --qa-archive')
            result = restore_qa(root, args.restore_qa)
        elif args.verify_qa:
            manifest, raw = read_qa_manifest(root)
            if args.qa_archive:
                read_restore(root, manifest, raw, args.qa_archive)
            verify_files(root, manifest['files'], qa=True)
            result = {'verifiedFiles': len(manifest['files']), 'checkpointRevision': manifest['checkpointRevision'],
                      'qaManifestSha256': sha256(raw), 'allQaHashes': 'passed'}
        elif args.output and args.qa_archive:
            manifest, _ = read_qa_manifest(root)
            revision = args.checkpoint_revision or manifest['checkpointRevision']
            result = build_source(root, args.output, revision, args.qa_archive)
        else:
            raise ArchiveError('Choose --qa-output ZIP, --qa-increment-output ZIP, --restore-qa ZIP, --verify-qa, or SOURCE.zip --qa-archive QA.zip. See docs/SOURCE-QA-ARCHIVES.md.')
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ArchiveError, OSError) as exc:
        parser.exit(2, f'archive-checkpoint: {exc}\n')


if __name__ == '__main__':
    raise SystemExit(main())
