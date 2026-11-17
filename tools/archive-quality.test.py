"""Stdlib-only archive regression tests; never read or rewrite real QA evidence."""
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

SPEC = importlib.util.spec_from_file_location('archive_checkpoint', Path(__file__).with_name('archive-checkpoint.py'))
ARCHIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVE)


class SourceQualityArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='mintportrait-archive-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / 'source'
        self.root.mkdir()
        self.runtime_sources = {
            'main.cjs': b'module.exports = {};\n',
            'src/app.js': b'// runtime source\n',
            'src/worker.cjs': b'// runtime worker\n',
            'tests/runtime.test.cjs': b'// source tests retained\n',
            'tests/fixtures/runtime.json': b'{"fixture":"synthetic"}\n',
            'backend/models/example/manifest.json': b'{"weights":"not included"}\n',
            'docs/README.md': b'Restored source documentation.\n',
            'quality/helper.cjs': b'// retained root-level QA support code\n',
            'quality/text-qa/harness.cjs': b'// QA harness remains source\n',
            'quality/light-balance-qa/harness.cjs': b'// added bounded color QA source\n',
            'quality/paint-qa/core-independent/check.cjs': b'// nested paint QA source\n',
            'quality/text-qa/report.json': b'{"result":"passed"}\n',
            'quality/text-qa/results.tap': b'ok 1 - synthetic\n',
            'quality/text-qa/REPORT.md': b'# Synthetic evidence report\n',
            'quality/fixtures/portrait.landmarks.json': b'{"points":[]}\n',
            'quality/recovery-qa/SHA256SUMS': b'public synthetic hash list\n',
            'checkpoints/text-final.log': b'prior test log\n',
        }
        self.binary_files = {
            # Retained old evidence outside any current quality glob must survive
            # source-only manifests via QA-CHECKPOINT-FILES.json.
            'quality/fixtures/portrait.png': b'\x89PNG\x00synthetic public fixture',
            'quality/fixtures/portrait.rgba': bytes(range(256)) * 16,
            'quality/manual-tools-qa/fixtures/public.rgba.gz': b'\x1f\x8b\x00synthetic fixture',
            'quality/advanced-tone/hue-boundary-contact.png': b'\x89PNG\x00contact',
            'quality/text-qa/composite.png': b'\x89PNG\x00synthetic composite',
            'quality/export-size-qa/export.jpg': b'\xff\xd8\x00synthetic export',
            'quality/light-balance-qa/color-ramp.png': b'\x89PNG\x00synthetic color ramp',
            'quality/paint-qa/core-independent/alpha.png': b'\x89PNG\x00synthetic paint layer',
        }
        for name in ARCHIVE.REQUIRED_FILES:
            self.write(name, b'{}\n' if name.endswith('.json') else b'Synthetic required source.\n')
        for name, raw in {**self.runtime_sources, **self.binary_files}.items():
            self.write(name, raw)
        selected = sorted(set(ARCHIVE.REQUIRED_FILES) | self.runtime_sources.keys() | self.binary_files.keys())
        manifest = {'schemaVersion': 1, 'kind': 'unreleased-source-overlay', 'checkpointRevision': 14,
                    'baseLibraryFile': ARCHIVE.BASE_LIBRARY_FILE, 'baseVersion': 1,
                    'files': [ARCHIVE.file_entry(self.root, name) for name in selected]}
        self.write(ARCHIVE.SOURCE_MANIFEST, ARCHIVE.json_bytes(manifest))
        self.qa_zip = self.base / 'qa.zip'
        self.source_zip = self.base / 'source.zip'

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return path

    def freeze(self, name=None):
        return ARCHIVE.freeze_qa(self.root, name or self.qa_zip, 15)

    def write_restore(self, result=None):
        result = result or self.freeze()
        record = {key: result[key] for key in ('checkpointRevision', 'fileName', 'bytes', 'sha256', 'qaManifestSha256')}
        record.update(schemaVersion=1, kind='quality-archive-restore',
                      libraryFileId='libfile_' + 'a' * 32, libraryVersion=1)
        self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(record))
        return record

    def build(self, output=None, revision=15):
        return ARCHIVE.build_source(self.root, output or self.source_zip, revision, self.qa_zip)

    def test_curated_partition_retains_runtime_sources_and_omits_unselected_evidence(self):
        omitted = [
            'quality/private-unselected/diagnostic.png', 'quality/fixtures/not-previously-curated.rgba',
            'quality/advanced-tone/regenerable-full.png', 'quality/manual-tools-qa/raw.rgba.gz',
            'checkpoints/text-source-archive.json', 'node_modules/dependency/index.js',
            'src/__pycache__/noise.pyc',
        ]
        for name in omitted:
            self.write(name, b'Not part of the curated selection.\n')
        self.write('quality/export-size-qa/report.json', b'{"export":"checked"}\n')
        self.write('checkpoints/export-size-final.log', b'export tests passed\n')
        source, qa = ARCHIVE.split_names(self.root)
        self.assertEqual(qa, sorted(self.binary_files))
        self.assertTrue(set(self.runtime_sources).issubset(source))
        self.assertIn('quality/export-size-qa/report.json', source)
        self.assertIn('checkpoints/export-size-final.log', source)
        self.assertFalse(set(omitted) & (set(source) | set(qa)))

    def test_checkpoint17_redaction_is_curated_without_neighboring_private_evidence(self):
        self.write('quality/redact-qa/independent-cover.png', b'\x89PNG\x00synthetic cover')
        self.write('quality/redact-qa/report.json', b'{"scope":"synthetic"}\n')
        self.write('quality/redact-qa/builder.cjs', b'// reproducible sample\n')
        self.write('quality/redact-private/photo.png', b'not authorized QA selection')
        self.write('checkpoints/redaction-final.log', b'passed\n')
        source, qa = ARCHIVE.split_names(self.root)
        self.assertIn('quality/redact-qa/independent-cover.png', qa)
        self.assertNotIn('quality/redact-qa/independent-cover.png', source)
        self.assertIn('quality/redact-qa/report.json', source)
        self.assertIn('quality/redact-qa/builder.cjs', source)
        self.assertIn('checkpoints/redaction-final.log', source)
        self.assertNotIn('quality/redact-private/photo.png', source + qa)

    def test_checkpoint28_perspective_partition_is_bounded_and_retains_test_inputs(self):
        sources = {
            'tests/perspective-project.test.cjs': b'// executable migration tests\n',
            'tests/perspective-selection.test.cjs': b'// executable selection tests\n',
            'quality/perspective-qa/app-harness.cjs': b'// executable UI harness\n',
            'quality/perspective-qa/project-build-v16-fixture.cjs': b'// fixture provenance\n',
            'quality/perspective-qa/project-v16-historical-manifest.json': b'{"writerVersion":16}\n',
            'quality/perspective-qa/pipeline-manifest.json': b'{"checks":"passed"}\n',
            'quality/perspective-qa/PIPELINE-NOTES.md': b'# Synthetic report\n',
            'quality/perspective-qa/ui-tests.tap': b'ok 1 - synthetic perspective\n',
            'checkpoints/perspective-final.log': b'passed\n',
        }
        binaries = {
            'quality/perspective-qa/app-native-export.png': b'\x89PNG\x00synthetic export',
            'quality/perspective-qa/project-v16-historical.mintproj': b'MINTPROJ\x10\x00synthetic historical fixture',
        }
        omitted = (
            'quality/perspective-private/photo.png',
            'quality/perspective-qa-private/report.json',
            'quality/perspective-qa/unreviewed-subtree/secret.png',
            'quality/perspective-qa/node_modules/pkg/index.js',
            'checkpoints/perspective-source-archive.json',
        )
        for name, raw in {**sources, **binaries}.items():
            self.write(name, raw)
        for name in omitted:
            self.write(name, b'not selected\n')
        source, qa = ARCHIVE.split_names(self.root)
        self.assertTrue(set(sources).issubset(source))
        self.assertTrue(set(binaries).issubset(qa))
        self.assertFalse(set(sources) & set(qa))
        self.assertFalse(set(binaries) & set(source))
        self.assertFalse(set(omitted) & set(source + qa))

    def test_exact_project_fixture_roundtrips_schema_one_without_becoming_source(self):
        name = 'quality/perspective-qa/project-v16-historical.mintproj'
        raw = b'MINTPROJ\x10\x00synthetic schema-16 fixture'
        self.write(name, raw)
        self.write_restore()
        self.build()
        with zipfile.ZipFile(self.qa_zip) as archive:
            self.assertEqual(archive.read(name), raw)
        with zipfile.ZipFile(self.source_zip) as archive:
            self.assertNotIn(name, archive.namelist())
        (self.root / name).unlink()
        manifest, _ = ARCHIVE.read_qa_manifest(self.root)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'restoration required'):
            ARCHIVE.verify_files(self.root, manifest['files'], qa=True)
        result = ARCHIVE.restore_qa(self.root, self.qa_zip)
        self.assertEqual(result['restoredFiles'], 1)
        self.assertEqual((self.root / name).read_bytes(), raw)

    def test_project_fixture_allowlist_does_not_allow_arbitrary_project_containers(self):
        names = (
            'quality/perspective-qa/private.mintproj',
            'quality/perspective-qa/project-v17-historical.mintproj',
            'quality/perspective-qa/project-v16-historical.MINTPROJ',
            'quality/perspective-qa/nested/project-v16-historical.mintproj',
            'quality/image-overlay-qa/project-v16-historical.mintproj',
            'tests/project-v16-historical.mintproj',
        )
        for name in names:
            with self.subTest(name=name):
                self.assertFalse(ARCHIVE.is_quality_binary_name(name))
                # Test both schema readers even when the path is not selected by
                # a current glob: an old/malicious manifest cannot broaden it.
                entry = {'path': name, 'bytes': 4, 'sha256': ARCHIVE.sha256(b'data')}
                with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'curated binary evidence'):
                    ARCHIVE.validate_qa_entries({'files': [entry]}, 'synthetic manifest')
                self.write(ARCHIVE.QA_MANIFEST, ARCHIVE.json_bytes({
                    'schemaVersion': 1, 'kind': 'curated-quality-evidence-overlay',
                    'checkpointRevision': 28, 'files': [entry]}))
                with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'curated binary evidence'):
                    ARCHIVE.read_qa_manifest(self.root)
        (self.root / ARCHIVE.QA_MANIFEST).unlink()
        self.write(names[0], b'MINTPROJ\x00unreviewed project')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Unrecognized quality file type'):
            self.freeze()
        self.assertFalse(self.qa_zip.exists())

    def test_project_fixture_symlink_and_binary_manifest_fail_closed(self):
        name = 'quality/perspective-qa/project-v16-historical.mintproj'
        target = self.write('unselected-project.mintproj', b'MINTPROJ\x00outside selection')
        path = self.root / name
        path.parent.mkdir(parents=True)
        path.symlink_to(target)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            self.freeze()
        path.unlink()
        self.write('quality/perspective-qa/project-v16-historical-manifest.json', b'MINTPROJ\x00not a report')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'disguised'):
            self.freeze()
        self.assertFalse(self.qa_zip.exists())

    def test_quality_archive_is_deterministic_and_fully_read_back(self):
        first = self.freeze()
        manifest_raw = (self.root / ARCHIVE.QA_MANIFEST).read_bytes()
        second_path = self.base / 'same-qa-different-name.zip'
        second = self.freeze(second_path)
        self.assertEqual(first['sha256'], second['sha256'])
        self.assertEqual(self.qa_zip.read_bytes(), second_path.read_bytes())
        self.assertEqual((self.root / ARCHIVE.QA_MANIFEST).read_bytes(), manifest_raw)
        with zipfile.ZipFile(self.qa_zip) as archive:
            self.assertEqual(archive.namelist(), sorted([*self.binary_files, ARCHIVE.QA_MANIFEST]))
            self.assertIsNone(archive.testzip())
            for name, raw in self.binary_files.items():
                self.assertEqual(archive.read(name), raw)

    def test_source_only_archive_keeps_code_reports_and_verified_restore_metadata(self):
        restore = self.write_restore()
        qa_before = self.qa_zip.read_bytes()
        manifest_before = (self.root / ARCHIVE.QA_MANIFEST).read_bytes()
        result = self.build()
        self.assertEqual(result['qaArchiveUnchanged'], restore['sha256'])
        self.assertEqual(self.qa_zip.read_bytes(), qa_before)
        self.assertEqual((self.root / ARCHIVE.QA_MANIFEST).read_bytes(), manifest_before)
        with zipfile.ZipFile(self.source_zip) as archive:
            names = set(archive.namelist())
            self.assertTrue(set(self.runtime_sources).issubset(names))
            self.assertFalse(set(self.binary_files) & names)
            self.assertTrue({ARCHIVE.SOURCE_MANIFEST, ARCHIVE.QA_MANIFEST, ARCHIVE.QA_RESTORE}.issubset(names))
            self.assertEqual(json.loads(archive.read(ARCHIVE.QA_RESTORE)), restore)
            source = json.loads(archive.read(ARCHIVE.SOURCE_MANIFEST))
            self.assertEqual(source['checkpointRevision'], 15)
            self.assertEqual(source['baseLibraryFile'], ARCHIVE.BASE_LIBRARY_FILE)
            self.assertEqual(source['baseVersion'], 1)
            for entry in source['files']:
                self.assertEqual(ARCHIVE.sha256(archive.read(entry['path'])), entry['sha256'])
                self.assertEqual(len(archive.read(entry['path'])), entry['bytes'])
        # A second source-only build uses its prior manifest plus the frozen QA
        # manifest, not a lossy new selection or changed/recreated QA ZIP.
        second = self.build(self.base / 'source-again.zip')
        self.assertEqual(result['sha256'], second['sha256'])
        self.assertEqual(self.qa_zip.read_bytes(), qa_before)
        self.assertEqual(ARCHIVE.split_names(self.root)[1], sorted(self.binary_files))

    def test_later_source_revision_can_reuse_identical_frozen_qa(self):
        self.write_restore()
        self.build()
        before = self.qa_zip.read_bytes()
        self.write('src/worker.cjs', b'// later source-only change\n')
        result = self.build(self.base / 'source-16.zip', revision=16)
        self.assertEqual(result['checkpointRevision'], 16)
        self.assertEqual(self.qa_zip.read_bytes(), before)
        self.assertEqual(json.loads((self.root / ARCHIVE.QA_MANIFEST).read_text())['checkpointRevision'], 15)

    def test_source_build_requires_real_operator_record_not_invented_library_id(self):
        result = self.freeze()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Missing retained checkpoint file: QA-RESTORE'):
            self.build()
        record = self.write_restore(result)
        record['libraryFileId'] = 'UPLOAD_PENDING'
        self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(record))
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'operator-verified Library file ID'):
            self.build()
        self.assertFalse(self.source_zip.exists())

    def test_initial_library_version_zero_builds_and_invalid_versions_fail(self):
        record = self.write_restore()
        record['libraryVersion'] = 0
        self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(record))
        self.build()
        with zipfile.ZipFile(self.source_zip) as archive:
            self.assertEqual(json.loads(archive.read(ARCHIVE.QA_RESTORE))['libraryVersion'], 0)
            self.assertEqual(json.loads(archive.read(ARCHIVE.SOURCE_MANIFEST))['qualityEvidence']['libraryVersion'], 0)
        for invalid in (-1, True, False, '0', None):
            with self.subTest(version=invalid):
                record['libraryVersion'] = invalid
                self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(record))
                with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'nonnegative integer Library version'):
                    self.build(self.base / 'invalid-version.zip')
                self.assertFalse((self.base / 'invalid-version.zip').exists())

    def test_qa_change_during_source_write_is_rejected_before_publication(self):
        self.write_restore()
        qa_before = self.qa_zip.read_bytes()
        original_verify = ARCHIVE.verify_archive
        for target in ('fixture', 'archive'):
            with self.subTest(target=target):
                def mutate_after_source_readback(path, entries, manifest_name, raw):
                    original_verify(path, entries, manifest_name, raw)
                    if manifest_name == ARCHIVE.SOURCE_MANIFEST:
                        if target == 'fixture':
                            self.write('quality/fixtures/portrait.png', b'changed during source build')
                        else:
                            self.qa_zip.write_bytes(qa_before + b'changed during source build')

                with mock.patch.object(ARCHIVE, 'verify_archive', side_effect=mutate_after_source_readback):
                    with self.assertRaises(ARCHIVE.ArchiveError):
                        self.build()
                self.assertFalse(self.source_zip.exists())
                self.write('quality/fixtures/portrait.png', self.binary_files['quality/fixtures/portrait.png'])
                self.qa_zip.write_bytes(qa_before)

    def test_manifest_change_before_source_snapshot_is_rejected(self):
        self.write_restore()
        original_split = ARCHIVE.split_names

        def mutate_manifest_after_selection(root):
            result = original_split(root)
            path = root / ARCHIVE.QA_MANIFEST
            path.write_bytes(path.read_bytes() + b'\n')
            return result

        with mock.patch.object(ARCHIVE, 'split_names', side_effect=mutate_manifest_after_selection):
            with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Frozen QA manifest changed'):
                self.build()
        self.assertFalse(self.source_zip.exists())

    def test_changed_missing_and_new_qa_fail_after_freeze_without_rewriting_qa(self):
        self.write_restore()
        zip_before = self.qa_zip.read_bytes()
        manifest_before = (self.root / ARCHIVE.QA_MANIFEST).read_bytes()
        name = 'quality/fixtures/portrait.png'
        self.write(name, b'changed')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'frozen QA changed'):
            self.build()
        (self.root / name).unlink()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'restoration required'):
            self.build()
        self.write(name, self.binary_files[name])
        self.write('quality/export-size-qa/new.png', b'\x89PNG\x00new')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'selection changed after freeze'):
            self.build()
        self.assertEqual(self.qa_zip.read_bytes(), zip_before)
        self.assertEqual((self.root / ARCHIVE.QA_MANIFEST).read_bytes(), manifest_before)
        self.assertFalse(self.source_zip.exists())

    def test_missing_restored_qa_is_explicit_failure_and_valid_restore_is_exact(self):
        self.write_restore()
        self.build()
        clean = self.base / 'clean'
        clean.mkdir()
        with zipfile.ZipFile(self.source_zip) as archive:
            archive.extractall(clean)  # Only our just-created, fully verified test ZIP.
        manifest, _ = ARCHIVE.read_qa_manifest(clean)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Do not skip fixture-dependent tests'):
            ARCHIVE.verify_files(clean, manifest['files'], qa=True)
        report = ARCHIVE.restore_qa(clean, self.qa_zip)
        self.assertEqual(report['restoredFiles'], len(self.binary_files))
        self.assertEqual(report['crcAndHashReadback'], 'passed')
        for name, raw in {**self.runtime_sources, **self.binary_files}.items():
            self.assertEqual((clean / name).read_bytes(), raw)
        self.assertEqual(ARCHIVE.restore_qa(clean, self.qa_zip)['restoredFiles'], 0)
        self.assertEqual(ARCHIVE.split_names(clean)[1], sorted(self.binary_files))

    def test_restore_refuses_overwriting_changed_evidence_before_any_write(self):
        self.write_restore()
        self.write('quality/fixtures/portrait.png', b'local evidence must remain')
        missing = self.root / 'quality/text-qa/composite.png'
        missing.unlink()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Refusing to overwrite different local QA evidence'):
            ARCHIVE.restore_qa(self.root, self.qa_zip)
        self.assertEqual((self.root / 'quality/fixtures/portrait.png').read_bytes(), b'local evidence must remain')
        self.assertFalse(missing.exists())

    def test_archive_corruption_and_wrong_restore_hash_are_rejected_before_restore(self):
        record = self.write_restore()
        missing = self.root / 'quality/text-qa/composite.png'
        missing.unlink()
        broken = self.base / 'corrupt.zip'
        raw = bytearray(self.qa_zip.read_bytes())
        raw[50] ^= 0x40
        broken.write_bytes(raw)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'archive bytes/hash differ'):
            ARCHIVE.restore_qa(self.root, broken)
        self.assertFalse(missing.exists())
        record['qaManifestSha256'] = '0' * 64
        self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(record))
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'frozen QA manifest'):
            ARCHIVE.restore_qa(self.root, self.qa_zip)
        self.assertFalse(missing.exists())

    def test_readback_rejects_changed_member_extra_member_duplicate_and_symlink(self):
        self.freeze()
        manifest, raw = ARCHIVE.read_qa_manifest(self.root)
        with zipfile.ZipFile(self.qa_zip) as archive:
            records = [(info, archive.read(info)) for info in archive.infolist()]
        for mode in ('changed', 'extra', 'duplicate', 'symlink'):
            with self.subTest(mode=mode):
                path = self.base / f'bad-{mode}.zip'
                with zipfile.ZipFile(path, 'w') as archive:
                    for index, (original, content) in enumerate(records):
                        info = zipfile.ZipInfo(original.filename)
                        if mode == 'symlink' and index == 1:
                            info.create_system = 3
                            info.external_attr = 0o120777 << 16
                        if mode == 'changed' and index == 1:
                            content = bytes([content[0] ^ 1]) + content[1:]
                        archive.writestr(info, content)
                    if mode == 'extra':
                        archive.writestr('../escaped.txt', 'outside')
                    if mode == 'duplicate':
                        import warnings
                        with warnings.catch_warnings():
                            warnings.simplefilter('ignore', UserWarning)
                            archive.writestr(records[0][0].filename, records[0][1])
                with self.assertRaises(ARCHIVE.ArchiveError):
                    ARCHIVE.verify_archive(path, manifest['files'], ARCHIVE.QA_MANIFEST, raw)

    def test_readback_checks_member_crc_not_only_file_listing(self):
        self.freeze()
        manifest, manifest_raw = ARCHIVE.read_qa_manifest(self.root)
        corrupted = self.base / 'crc-corrupt.zip'
        with zipfile.ZipFile(corrupted, 'w', zipfile.ZIP_STORED) as archive:
            archive.writestr(ARCHIVE.QA_MANIFEST, manifest_raw)
            for name, raw in self.binary_files.items():
                archive.writestr(name, raw)
        with zipfile.ZipFile(corrupted) as archive:
            offset = archive.getinfo('quality/fixtures/portrait.png').header_offset
        raw = bytearray(corrupted.read_bytes())
        filename_length, extra_length = struct.unpack_from('<HH', raw, offset + 26)
        raw[offset + 30 + filename_length + extra_length] ^= 1
        corrupted.write_bytes(raw)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'CRC'):
            ARCHIVE.verify_archive(corrupted, manifest['files'], ARCHIVE.QA_MANIFEST, manifest_raw)

    def test_rejects_symlink_files_even_if_they_point_inside_root(self):
        target = self.root / 'quality/fixtures/portrait.png'
        original = target.read_bytes()
        target.unlink()
        inside = self.write('unused-inside.png', original)
        target.symlink_to(inside)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            self.freeze()
        self.assertFalse(self.qa_zip.exists())

    def test_rejects_symlink_directory_selected_by_glob_without_traversal(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'secret.png').write_bytes(b'not authorized for archive')
        (self.root / 'quality' / 'geometry').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            self.freeze()
        self.assertFalse(self.qa_zip.exists())

    def test_direct_helpers_reject_symlink_source_roots(self):
        linked_root = self.base / 'linked-source'
        linked_root.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'without symlink components'):
            ARCHIVE.freeze_qa(linked_root, self.qa_zip, 15)
        self.assertFalse(self.qa_zip.exists())

    def test_restore_rejects_symlink_parent(self):
        self.write_restore()
        (self.root / 'quality/fixtures/portrait.png').unlink()
        (self.root / 'quality/fixtures/portrait.rgba').unlink()
        (self.root / 'quality/fixtures/portrait.landmarks.json').unlink()
        (self.root / 'quality/fixtures').rmdir()
        outside = self.base / 'outside'
        outside.mkdir()
        (self.root / 'quality/fixtures').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            ARCHIVE.restore_qa(self.root, self.qa_zip)
        self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_bad_relative_paths_and_excluded_payloads(self):
        names = ('../escape.txt', '/absolute.txt', 'a/../../escape', 'a\\escape', 'C:/file',
                 'a//b', './file', 'node_modules/pkg/file.js', '.venv/bin/python',
                 'quality/text-qa/font.ttf', 'model.safetensors', 'payload.exe', 'payload.zip')
        for name in names:
            with self.subTest(name=name), self.assertRaises(ARCHIVE.ArchiveError):
                ARCHIVE.relative_path(name)

    def test_utf8_source_diff_is_a_report_but_binary_disguise_is_rejected(self):
        name = 'quality/text-qa/source-change.diff'
        self.write(name, b'--- before.js\n+++ after.js\n@@ -1 +1 @@\n-old\n+new\n')
        source, qa = ARCHIVE.split_names(self.root)
        self.assertIn(name, source)
        self.assertNotIn(name, qa)
        self.write(name, b'--- source\n\x00binary')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'disguised'):
            ARCHIVE.split_names(self.root)

    def test_binary_disguised_as_report_and_unknown_quality_types_fail(self):
        self.write('quality/text-qa/not-a-report.json', b'\x89PNG\x00binary')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'not UTF-8 text|disguised'):
            self.freeze()
        (self.root / 'quality/text-qa/not-a-report.json').unlink()
        self.write('quality/text-qa/unreviewed.dat', b'binary or text is unknown')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Unrecognized quality file type'):
            self.freeze()
        self.assertFalse(self.qa_zip.exists())

    def test_existing_archive_is_never_replaced(self):
        self.write_restore()
        before = self.qa_zip.read_bytes()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Refusing to overwrite'):
            self.freeze()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Refusing to overwrite'):
            self.build(self.qa_zip)
        self.assertEqual(self.qa_zip.read_bytes(), before)

    def test_cli_verify_is_nonzero_before_restoration_not_a_skip(self):
        self.write_restore()
        (self.root / 'quality/fixtures/portrait.png').unlink()
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('archive-checkpoint.py')),
                                 '--root', str(self.root), '--verify-qa'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('QA restoration required', result.stderr)
        self.assertIn('Do not skip fixture-dependent tests', result.stderr)
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
