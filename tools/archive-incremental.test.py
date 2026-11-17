"""Append-only archive-set regressions. All evidence/IDs are synthetic temp fixtures."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

SPEC = importlib.util.spec_from_file_location('legacy_archive_tests', Path(__file__).with_name('archive-quality.test.py'))
LEGACY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LEGACY)
ARCHIVE = LEGACY.ARCHIVE


class IncrementalArchiveTests(unittest.TestCase):
    write = LEGACY.SourceQualityArchiveTests.write
    freeze = LEGACY.SourceQualityArchiveTests.freeze
    write_restore = LEGACY.SourceQualityArchiveTests.write_restore

    def setUp(self):
        LEGACY.SourceQualityArchiveTests.setUp(self)
        self.baseline_record = self.write_restore()
        self.baseline_bytes = self.qa_zip.read_bytes()
        self.baseline_manifest = (self.root / ARCHIVE.QA_MANIFEST).read_bytes()
        self.paths = [self.qa_zip]
        self.new_name = 'quality/geometry/append-16.png'
        self.new_bytes = b'\x89PNG\x00new geometry evidence'

    def append(self, revision=16, *, raw=None):
        name = f'quality/geometry/append-{revision}.png'
        self.write(name, raw or self.new_bytes)
        path = self.base / f'increment-{revision}.zip'
        result = ARCHIVE.freeze_qa_increment(self.root, path, revision, self.paths)
        self.paths.append(path)
        return result

    def record_increment(self, result):
        record = {key: result[key] for key in ('checkpointRevision', 'fileName', 'bytes', 'sha256', 'qaManifestSha256')}
        record.update(role='increment', libraryFileId='libfile_' + f'{result["checkpointRevision"]:032x}', libraryVersion=0)
        restore = {'schemaVersion': 2, 'kind': ARCHIVE.RESTORE_SET_KIND, 'state': 'frozen',
                   'checkpointRevision': result['checkpointRevision'], 'qaManifestSha256': result['combinedQaManifestSha256'],
                   'archives': result['previousArchives'] + [record]}
        self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(restore))
        return restore

    def ready(self):
        return self.record_increment(self.append())

    def remove_evidence(self):
        manifest, _ = ARCHIVE.read_qa_manifest(self.root)
        for entry in manifest['files']:
            (self.root / entry['path']).unlink()
        return manifest

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes()
                for path in self.root.rglob('*') if path.is_file() and not path.is_symlink()}

    def build(self, paths=None, output=None, revision=16):
        return ARCHIVE.build_source(self.root, output or self.source_zip, revision, self.paths if paths is None else paths)

    def test_only_new_paths_are_archived_and_baseline_is_read_only(self):
        self.qa_zip.chmod(0o444)
        result = self.append()
        self.assertEqual(result['files'], 1)
        self.assertEqual(result['totalQaFiles'], len(self.binary_files) + 1)
        self.assertEqual(self.qa_zip.read_bytes(), self.baseline_bytes)
        self.assertEqual(self.qa_zip.stat().st_mode & 0o777, 0o444)
        with zipfile.ZipFile(self.paths[-1]) as archive:
            self.assertEqual(set(archive.namelist()), {self.new_name, ARCHIVE.QA_MANIFEST})
            own = json.loads(archive.read(ARCHIVE.QA_MANIFEST))
            self.assertEqual(own['previousArchives'][0]['libraryFileId'], self.baseline_record['libraryFileId'])
            self.assertEqual(own['previousArchives'][0]['sha256'], self.baseline_record['sha256'])
        self.assertEqual(json.loads((self.root / ARCHIVE.QA_RESTORE).read_bytes()), self.baseline_record)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'complete and explicitly frozen'):
            self.build()
        self.assertFalse(self.source_zip.exists())
        self.record_increment(result)
        self.build()
        self.assertEqual(self.qa_zip.read_bytes(), self.baseline_bytes)

    def test_perspective_increment_keeps_project_fixture_binary_and_all_prior_archives_immutable(self):
        self.ready()
        originals = {path: path.read_bytes() for path in self.paths}
        previous_restore = json.loads((self.root / ARCHIVE.QA_RESTORE).read_bytes())
        source_inputs = {
            'tests/perspective-project.test.cjs': b'// migration tests require frozen fixture\n',
            'quality/perspective-qa/app-harness.cjs': b'// executable UI harness\n',
            'quality/perspective-qa/project-build-v16-fixture.cjs': b'// provenance\n',
            'quality/perspective-qa/project-v16-historical-manifest.json': b'{"writerVersion":16}\n',
            'quality/perspective-qa/ui-independent-results.tap': b'ok 1 - perspective\n',
        }
        fixture = 'quality/perspective-qa/project-v16-historical.mintproj'
        binaries = {
            fixture: b'MINTPROJ\x10\x00synthetic historical fixture',
            'quality/perspective-qa/app-native-export.png': b'\x89PNG\x00new perspective export',
        }
        for name, raw in {**source_inputs, **binaries}.items():
            self.write(name, raw)
        delta = self.base / 'perspective-28.zip'
        result = ARCHIVE.freeze_qa_increment(self.root, delta, 28, list(reversed(self.paths)))
        self.assertEqual(result['files'], len(binaries))
        self.assertLess(result['bytes'], 10000)
        self.assertEqual(result['previousArchives'], previous_restore['archives'])
        self.assertEqual(json.loads((self.root / ARCHIVE.QA_RESTORE).read_bytes()), previous_restore)
        with zipfile.ZipFile(delta) as archive:
            self.assertEqual(set(archive.namelist()), set(binaries) | {ARCHIVE.QA_MANIFEST})
            for name, raw in binaries.items():
                self.assertEqual(archive.read(name), raw)
        self.paths.append(delta)
        self.record_increment(result)
        self.build(revision=28)
        with zipfile.ZipFile(self.source_zip) as archive:
            self.assertTrue(set(source_inputs).issubset(archive.namelist()))
            self.assertFalse(set(binaries) & set(archive.namelist()))
            self.assertTrue({ARCHIVE.SOURCE_MANIFEST, ARCHIVE.QA_MANIFEST, ARCHIVE.QA_RESTORE}.issubset(archive.namelist()))
        # Fixture-dependent tests must not run on silently missing/changed data.
        self.write(fixture, b'changed historical project')
        rejected = self.base / 'changed-fixture-source.zip'
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'frozen QA changed'):
            self.build(output=rejected, revision=28)
        self.assertFalse(rejected.exists())
        (self.root / fixture).unlink()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'restoration required'):
            self.build(output=rejected, revision=28)
        restored = ARCHIVE.restore_qa(self.root, list(reversed(self.paths)))
        self.assertEqual(restored['restoredFiles'], 1)
        self.assertEqual((self.root / fixture).read_bytes(), binaries[fixture])
        self.assertEqual(ARCHIVE.restore_qa(self.root, self.paths)['restoredFiles'], 0)
        for path, raw in originals.items():
            self.assertEqual(path.read_bytes(), raw)

    def test_order_independent_restore_and_source_with_three_archives(self):
        self.ready()
        self.record_increment(self.append(17, raw=b'\x89PNG\x00second small feature'))
        originals = {path: path.read_bytes() for path in self.paths}
        report = self.build(paths=list(reversed(self.paths)), revision=17)
        self.assertEqual(report['qaFiles'], len(self.binary_files) + 2)
        with zipfile.ZipFile(self.source_zip) as archive:
            self.assertFalse(any(name.endswith('.png') for name in archive.namelist()))
            source = json.loads(archive.read(ARCHIVE.SOURCE_MANIFEST))
            self.assertEqual(source['qualityEvidence']['storage'], 'separate-curated-archive-set')
            self.assertEqual(len(source['qualityEvidence']['archives']), 3)
        second = self.build(output=self.base / 'same-source.zip', revision=17)
        self.assertEqual(second['sha256'], report['sha256'])
        manifest = self.remove_evidence()
        result = ARCHIVE.restore_qa(self.root, [self.paths[2], self.paths[0], self.paths[1]])
        self.assertEqual(result['restoredFiles'], len(manifest['files']))
        self.assertEqual(ARCHIVE.restore_qa(self.root, self.paths)['restoredFiles'], 0)
        for path, before in originals.items():
            self.assertEqual(path.read_bytes(), before)

    def test_empty_increment_changed_baseline_missing_evidence_and_nonfuture_revision_reject(self):
        for revision in (14, 15, 0, -1, True, '16'):
            with self.subTest(revision=revision), self.assertRaises(ARCHIVE.ArchiveError):
                ARCHIVE.freeze_qa_increment(self.root, self.base / 'bad.zip', revision, self.paths)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Empty QA increments'):
            ARCHIVE.freeze_qa_increment(self.root, self.base / 'bad.zip', 16, self.paths)
        self.write(self.new_name, self.new_bytes)
        old_name = next(iter(self.binary_files))
        self.write(old_name, b'changed retained evidence')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'frozen QA changed'):
            ARCHIVE.freeze_qa_increment(self.root, self.base / 'bad.zip', 16, self.paths)
        (self.root / old_name).unlink()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'restoration required'):
            ARCHIVE.freeze_qa_increment(self.root, self.base / 'bad.zip', 16, self.paths)
        self.assertFalse((self.base / 'bad.zip').exists())
        self.assertEqual((self.root / ARCHIVE.QA_MANIFEST).read_bytes(), self.baseline_manifest)
        self.assertEqual(self.qa_zip.read_bytes(), self.baseline_bytes)

    def test_increment_is_deterministic_without_including_source_reports(self):
        before = self.snapshot()
        first = self.append()
        first_bytes = self.paths[-1].read_bytes()
        for name, raw in before.items(): self.write(name, raw)
        self.write('quality/geometry/report.json', b'{"sourceOnly":true}\n')
        second_path = self.base / 'same-increment-other-name.zip'
        second = ARCHIVE.freeze_qa_increment(self.root, second_path, 16, [self.qa_zip])
        self.assertEqual(first['sha256'], second['sha256'])
        self.assertEqual(first_bytes, second_path.read_bytes())
        with zipfile.ZipFile(second_path) as archive:
            self.assertNotIn('quality/geometry/report.json', archive.namelist())

    def test_schema_two_cannot_be_collapsed_by_a_full_freeze(self):
        self.ready()
        before = self.snapshot()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'append-only'):
            ARCHIVE.freeze_qa(self.root, self.base / 'replacement-full.zip', 17)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.base / 'replacement-full.zip').exists())

    def test_existing_increment_evidence_cannot_be_replaced(self):
        self.ready()
        before = self.snapshot()
        self.write(self.new_name, b'changed previously appended geometry')
        self.write('quality/geometry/next.png', b'\x89PNG\x00next')
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'frozen QA changed'):
            ARCHIVE.freeze_qa_increment(self.root, self.base / 'bad.zip', 17, self.paths)
        self.assertEqual((self.root / ARCHIVE.QA_MANIFEST).read_bytes(), before[ARCHIVE.QA_MANIFEST])
        self.assertFalse((self.base / 'bad.zip').exists())

    def test_all_archives_required_and_missing_corrupt_mismatch_duplicate_inputs_fail_before_restore(self):
        self.ready()
        self.remove_evidence()
        corrupt = self.base / 'corrupt.zip'
        corrupt.write_bytes(self.paths[-1].read_bytes() + b'corrupt tail')
        missing = self.base / 'missing.zip'
        before = self.snapshot()
        choices = ([self.qa_zip], [self.paths[-1]], [self.qa_zip, missing],
                   [self.qa_zip, corrupt], [self.qa_zip, self.qa_zip], self.paths + [self.qa_zip])
        for paths in choices:
            with self.subTest(paths=paths), self.assertRaises(ARCHIVE.ArchiveError):
                ARCHIVE.restore_qa(self.root, paths)
            self.assertEqual(self.snapshot(), before)
        # Download filenames are deliberately irrelevant to identity.
        renamed = self.base / 'downloaded-different-name.zip'
        shutil.copyfile(self.paths[-1], renamed)
        self.assertGreater(ARCHIVE.restore_qa(self.root, [renamed, self.qa_zip])['restoredFiles'], 0)

    def test_pending_placeholder_invalid_and_incomplete_metadata_reject(self):
        good = self.ready()
        mutations = []
        for state in ('pending', None, True):
            record = copy.deepcopy(good); record['state'] = state; mutations.append(record)
        for value in ('UPLOAD_PENDING', '<Library ID>', None):
            record = copy.deepcopy(good); record['archives'][-1]['libraryFileId'] = value; mutations.append(record)
        for value in (-1, True, '0', None):
            record = copy.deepcopy(good); record['archives'][-1]['libraryVersion'] = value; mutations.append(record)
        for key in ('bytes', 'sha256', 'qaManifestSha256', 'libraryFileId', 'fileName'):
            record = copy.deepcopy(good); record['archives'][-1].pop(key); mutations.append(record)
        record = copy.deepcopy(good); record['archives'].pop(); mutations.append(record)
        record = copy.deepcopy(good); record['archives'][-1]['downloadUrl'] = 'https://invalid.example/private'; mutations.append(record)
        for record in mutations:
            with self.subTest(record=record):
                self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(record))
                with self.assertRaises(ARCHIVE.ArchiveError):
                    self.build()
                self.assertFalse(self.source_zip.exists())

    def test_prior_library_identity_version_and_filename_are_immutable(self):
        good = self.ready()
        for key, value in (('libraryFileId', 'libfile_' + 'b' * 32), ('libraryVersion', 2), ('fileName', 'renamed-record.zip')):
            changed = copy.deepcopy(good)
            changed['archives'][0][key] = value
            self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(changed))
            with self.subTest(key=key), self.assertRaisesRegex(ARCHIVE.ArchiveError, 'predecessor metadata changed'):
                self.build()
        self.assertFalse(self.source_zip.exists())

    def test_manifest_union_cannot_omit_add_or_conflict_with_archive_entries(self):
        restore = self.ready()
        good = json.loads((self.root / ARCHIVE.QA_MANIFEST).read_bytes())
        changes = []
        removed = copy.deepcopy(good); removed['files'].pop(); changes.append(removed)
        changed = copy.deepcopy(good); changed['files'][0]['sha256'] = '0' * 64; changes.append(changed)
        added = copy.deepcopy(good); added['files'].append({'path': 'quality/zzz.png', 'bytes': 1, 'sha256': '0' * 64}); changes.append(added)
        for manifest in changes:
            raw = ARCHIVE.json_bytes(manifest)
            self.write(ARCHIVE.QA_MANIFEST, raw)
            restore['qaManifestSha256'] = ARCHIVE.sha256(raw)
            self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(restore))
            with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'exact union'):
                self.build()
            self.assertFalse(self.source_zip.exists())

    def rewrite_increment(self, mutate_manifest=None, mutate_members=None):
        """Forge matching external hashes, ensuring inner integrity is tested."""
        manifest = json.loads((self.root / ARCHIVE.QA_MANIFEST).read_bytes())
        restore = json.loads((self.root / ARCHIVE.QA_RESTORE).read_bytes())
        with zipfile.ZipFile(self.paths[-1]) as archive:
            members = [(info, archive.read(info)) for info in archive.infolist()]
        own = json.loads(next(raw for info, raw in members if info.filename == ARCHIVE.QA_MANIFEST))
        if mutate_manifest:
            mutate_manifest(own, members)
        own_raw = ARCHIVE.json_bytes(own)
        if mutate_members:
            mutate_members(members)
        forged = self.base / 'forged.zip'
        with zipfile.ZipFile(forged, 'w') as archive:
            for info, raw in members:
                archive.writestr(info, own_raw if info.filename == ARCHIVE.QA_MANIFEST else raw)
        record = restore['archives'][-1]
        record.update(bytes=forged.stat().st_size, sha256=ARCHIVE.sha256(forged.read_bytes()), qaManifestSha256=ARCHIVE.sha256(own_raw))
        manifest['archives'][-1] = ARCHIVE.archive_ref(record)
        raw = ARCHIVE.json_bytes(manifest)
        restore['qaManifestSha256'] = ARCHIVE.sha256(raw)
        self.write(ARCHIVE.QA_MANIFEST, raw)
        self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(restore))
        return [self.qa_zip, forged]

    def test_overlapping_paths_even_same_hash_or_conflicting_hash_reject(self):
        self.ready()
        root_before = self.snapshot()
        for conflicting in (False, True):
            for name, raw in root_before.items(): self.write(name, raw)
            old_name = 'quality/fixtures/portrait.png'
            data = b'conflicting bytes' if conflicting else self.binary_files[old_name]
            def overlap(own, members):
                own['files'].append({'path': old_name, 'bytes': len(data), 'sha256': ARCHIVE.sha256(data)})
                own['files'].sort(key=lambda entry: entry['path'])
                members.append((zipfile.ZipInfo(old_name), data))
            paths = self.rewrite_increment(mutate_manifest=overlap)
            with self.subTest(conflicting=conflicting), self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Overlapping'):
                self.build(paths=paths)
            self.assertFalse(self.source_zip.exists())

    def test_unsafe_paths_and_archive_symlinks_reject_with_matching_outer_hashes(self):
        self.ready()
        root_before = self.snapshot()
        for unsafe in ('../escape.png', '/absolute.png', 'quality/../escape.png', 'quality\\escape.png', 'quality/x/model.onnx'):
            for name, raw in root_before.items(): self.write(name, raw)
            def change(own, members):
                own['files'][0]['path'] = unsafe
                for info, raw in members:
                    if info.filename == self.new_name:
                        info.filename = unsafe
            paths = self.rewrite_increment(mutate_manifest=change)
            with self.subTest(path=unsafe), self.assertRaises(ARCHIVE.ArchiveError):
                self.build(paths=paths)
        for name, raw in root_before.items(): self.write(name, raw)
        def symlink(members):
            for info, _ in members:
                if info.filename == self.new_name:
                    info.create_system = 3; info.external_attr = 0o120777 << 16
        paths = self.rewrite_increment(mutate_members=symlink)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            self.build(paths=paths)
        self.assertFalse(self.source_zip.exists())

    def test_restore_conflict_preflights_entire_set_without_writes(self):
        self.ready()
        self.remove_evidence()
        self.write(self.new_name, b'keep local changed evidence')
        before = self.snapshot()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Refusing to overwrite'):
            ARCHIVE.restore_qa(self.root, self.paths)
        self.assertEqual(self.snapshot(), before)

    def test_restore_symlink_parent_and_input_archive_symlink_reject(self):
        self.ready()
        self.remove_evidence()
        outside = self.base / 'outside'; outside.mkdir()
        (self.root / 'quality/geometry').rmdir()
        (self.root / 'quality/geometry').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            ARCHIVE.restore_qa(self.root, self.paths)
        self.assertEqual(list(outside.iterdir()), [])
        linked = self.base / 'linked.zip'; linked.symlink_to(self.paths[-1])
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'symlink'):
            self.build(paths=[self.qa_zip, linked])

    def test_frozen_metadata_archive_and_new_selection_changes_during_source_write_reject(self):
        self.ready()
        root_before = self.snapshot()
        zip_before = self.paths[-1].read_bytes()
        original = ARCHIVE.verify_archive
        for target in ('restore', 'combined', 'archive', 'evidence', 'selection'):
            for name, raw in root_before.items(): self.write(name, raw)
            self.paths[-1].write_bytes(zip_before)
            def mutate(path, entries, name, raw):
                original(path, entries, name, raw)
                if name != ARCHIVE.SOURCE_MANIFEST: return
                if target == 'restore': self.write(ARCHIVE.QA_RESTORE, root_before[ARCHIVE.QA_RESTORE] + b'\n')
                elif target == 'combined': self.write(ARCHIVE.QA_MANIFEST, root_before[ARCHIVE.QA_MANIFEST] + b'\n')
                elif target == 'archive': self.paths[-1].write_bytes(zip_before + b'changed')
                elif target == 'evidence': self.write(self.new_name, b'changed')
                else: self.write('quality/geometry/late.png', b'\x89PNG\x00late')
            with self.subTest(target=target), mock.patch.object(ARCHIVE, 'verify_archive', side_effect=mutate):
                with self.assertRaises(ARCHIVE.ArchiveError): self.build()
            self.assertFalse(self.source_zip.exists())
            (self.root / 'quality/geometry/late.png').unlink(missing_ok=True)

    def test_frozen_changes_during_increment_freeze_reject_before_publish(self):
        self.write(self.new_name, self.new_bytes)
        original = ARCHIVE.verify_archive
        def mutate(path, entries, name, raw):
            original(path, entries, name, raw)
            if json.loads(raw).get('kind') == ARCHIVE.INCREMENT_KIND:
                self.write(ARCHIVE.QA_RESTORE, ARCHIVE.json_bytes(self.baseline_record) + b'\n')
        with mock.patch.object(ARCHIVE, 'verify_archive', side_effect=mutate):
            with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'metadata changed'):
                ARCHIVE.freeze_qa_increment(self.root, self.base / 'bad.zip', 16, self.paths)
        self.assertFalse((self.base / 'bad.zip').exists())
        self.assertEqual((self.root / ARCHIVE.QA_MANIFEST).read_bytes(), self.baseline_manifest)

    def test_existing_outputs_are_never_overwritten(self):
        self.write(self.new_name, self.new_bytes)
        before = self.qa_zip.read_bytes()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Refusing to overwrite'):
            ARCHIVE.freeze_qa_increment(self.root, self.qa_zip, 16, self.paths)
        self.assertEqual(self.qa_zip.read_bytes(), before)
        self.ready()
        with self.assertRaisesRegex(ARCHIVE.ArchiveError, 'Refusing to overwrite'):
            self.build(output=self.paths[-1])

    def test_failed_publication_rolls_back_only_own_files(self):
        self.ready()
        self.remove_evidence()
        before = self.snapshot()
        original = ARCHIVE.os.link
        calls = 0
        def fail_later(source, target):
            nonlocal calls
            calls += 1
            if calls == 2: raise OSError('simulated disk failure')
            return original(source, target)
        with mock.patch.object(ARCHIVE.os, 'link', side_effect=fail_later):
            with self.assertRaisesRegex(OSError, 'simulated disk failure'):
                ARCHIVE.restore_qa(self.root, self.paths)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(list(self.root.glob('.qa-restore-*')))

    def test_cli_repeatable_archive_flags_and_one_path_backwards_compatibility(self):
        helper = str(Path(__file__).with_name('archive-checkpoint.py'))
        def cli(*args):
            return subprocess.run([sys.executable, helper, '--root', str(self.root), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(cli('--verify-qa', '--qa-archive', self.qa_zip).returncode, 0)
        self.write(self.new_name, self.new_bytes)
        increment = self.base / 'cli-increment.zip'
        result = cli('--qa-increment-output', increment, '--checkpoint-revision', 16, '--qa-archive', self.qa_zip)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.paths.append(increment)
        self.record_increment(json.loads(result.stdout))
        result = cli(self.source_zip, '--qa-archive', increment, '--qa-archive', self.qa_zip)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.remove_evidence()
        result = cli('--restore-qa', increment, '--restore-qa', self.qa_zip)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['restoredFiles'], len(self.binary_files) + 1)
        self.assertEqual(cli('--verify-qa').returncode, 0)
        result = cli('--verify-qa', '--qa-archive', increment)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
