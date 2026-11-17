"""Independent adversarial regression checks. Synthetic temporary trees only."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock
import zipfile

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('archive_baseline_tests', HERE / 'archive-quality.test.py')
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
A = BASE.ARCHIVE


class AdversarialArchiveTests(unittest.TestCase):
    setUp = BASE.SourceQualityArchiveTests.setUp
    write = BASE.SourceQualityArchiveTests.write
    freeze = BASE.SourceQualityArchiveTests.freeze
    write_restore = BASE.SourceQualityArchiveTests.write_restore
    build = BASE.SourceQualityArchiveTests.build

    def increment(self, names=('quality/text-qa/new-a.png', 'quality/text-qa/new-b.png')):
        self.write_restore()
        for name in names:
            self.write(name, b'new synthetic PNG\x00' + name.encode())
        self.inc_zip = self.base / 'increment.zip'
        result = A.freeze_qa_increment(self.root, self.inc_zip, 16, [self.qa_zip])
        record = {key: result[key] for key in A.REF_KEYS - {'role'}}
        record.update(role='increment', libraryFileId='libfile_' + 'b' * 32,
                      libraryVersion=0, fileName=self.inc_zip.name)
        restore = dict(schemaVersion=2, kind=A.RESTORE_SET_KIND, state='frozen', checkpointRevision=16,
                       qaManifestSha256=result['combinedQaManifestSha256'],
                       archives=result['previousArchives'] + [record])
        self.write(A.QA_RESTORE, A.json_bytes(restore))
        return restore

    def rewrite_increment(self, transform):
        with zipfile.ZipFile(self.inc_zip) as z:
            members = [(i.filename, z.read(i)) for i in z.infolist()]
        own = json.loads(dict(members)[A.QA_MANIFEST])
        transform(own)
        own_raw = A.json_bytes(own)
        with zipfile.ZipFile(self.inc_zip, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, raw in members:
                z.writestr(name, own_raw if name == A.QA_MANIFEST else raw)
        manifest, _ = A.read_qa_manifest(self.root)
        restore, _ = A.read_json(self.root, A.QA_RESTORE)
        for record in (manifest['archives'][-1], restore['archives'][-1]):
            record.update(bytes=self.inc_zip.stat().st_size, sha256=A.sha256(self.inc_zip.read_bytes()),
                          qaManifestSha256=A.sha256(own_raw))
        combined_raw = A.json_bytes(manifest)
        restore['qaManifestSha256'] = A.sha256(combined_raw)
        self.write(A.QA_MANIFEST, combined_raw)
        self.write(A.QA_RESTORE, A.json_bytes(restore))

    def test_previous_archive_records_reject_boolean_version(self):
        self.increment()
        self.rewrite_increment(lambda own: own['previousArchives'][0].update(libraryVersion=True))
        manifest, raw = A.read_qa_manifest(self.root)
        with self.assertRaises(A.ArchiveError):
            A.read_restore(self.root, manifest, raw, [self.inc_zip, self.qa_zip])

    def test_previous_archive_records_reject_float_revision(self):
        self.increment()
        self.rewrite_increment(lambda own: own['previousArchives'][0].update(checkpointRevision=15.0))
        manifest, raw = A.read_qa_manifest(self.root)
        with self.assertRaises(A.ArchiveError):
            A.read_restore(self.root, manifest, raw, [self.qa_zip, self.inc_zip])

    def test_schema_one_manifest_rejects_boolean_schema(self):
        self.freeze()
        manifest, _ = A.read_json(self.root, A.QA_MANIFEST)
        manifest['schemaVersion'] = True
        self.write(A.QA_MANIFEST, A.json_bytes(manifest))
        with self.assertRaises(A.ArchiveError):
            A.read_qa_manifest(self.root)

    def test_schema_one_restore_rejects_boolean_schema(self):
        restore = self.write_restore()
        restore['schemaVersion'] = True
        self.write(A.QA_RESTORE, A.json_bytes(restore))
        manifest, raw = A.read_qa_manifest(self.root)
        with self.assertRaises(A.ArchiveError):
            A.read_restore(self.root, manifest, raw, self.qa_zip)

    def test_increment_metadata_cannot_change_prior_library_identity(self):
        restore = self.increment()
        restore['archives'][0]['libraryFileId'] = 'libfile_' + 'c' * 32
        self.write(A.QA_RESTORE, A.json_bytes(restore))
        manifest, raw = A.read_qa_manifest(self.root)
        with self.assertRaisesRegex(A.ArchiveError, 'predecessor metadata changed'):
            A.read_restore(self.root, manifest, raw, [self.inc_zip, self.qa_zip])

    def test_duplicate_archive_identity_is_rejected(self):
        restore = self.increment()
        restore['archives'][1].update(libraryFileId=restore['archives'][0]['libraryFileId'],
                                     libraryVersion=restore['archives'][0]['libraryVersion'])
        self.write(A.QA_RESTORE, A.json_bytes(restore))
        manifest, raw = A.read_qa_manifest(self.root)
        with self.assertRaisesRegex(A.ArchiveError, 'identities must be distinct'):
            A.read_restore(self.root, manifest, raw, [self.qa_zip, self.inc_zip])

    def test_corrupt_late_archive_fails_before_any_publication(self):
        self.increment()
        for name in A.read_qa_manifest(self.root)[0]['files']:
            (self.root / name['path']).unlink()
        self.inc_zip.write_bytes(self.inc_zip.read_bytes() + b'corrupt')
        with mock.patch.object(A.os, 'link', wraps=A.os.link) as link:
            with self.assertRaises(A.ArchiveError):
                A.restore_qa(self.root, [self.qa_zip, self.inc_zip])
            link.assert_not_called()

    def test_interrupted_publish_rolls_back_only_own_files(self):
        self.increment()
        manifest, manifest_raw = A.read_qa_manifest(self.root)
        restore_raw = (self.root / A.QA_RESTORE).read_bytes()
        for entry in manifest['files']:
            (self.root / entry['path']).unlink()
        original_link = A.os.link
        published, foreign = [], []
        def racing_link(source, target):
            if not published:
                original_link(source, target)
                published.append(Path(target))
            else:
                Path(target).write_bytes(b'foreign replacement survives')
                foreign.append(Path(target))
                raise FileExistsError('simulated concurrent creation')
        with mock.patch.object(A.os, 'link', side_effect=racing_link):
            with self.assertRaises(FileExistsError):
                A.restore_qa(self.root, [self.inc_zip, self.qa_zip])
        self.assertFalse(published[0].exists())
        self.assertEqual(foreign[0].read_bytes(), b'foreign replacement survives')
        self.assertEqual((self.root / A.QA_MANIFEST).read_bytes(), manifest_raw)
        self.assertEqual((self.root / A.QA_RESTORE).read_bytes(), restore_raw)

    def test_restore_preflights_regular_file_parent_before_any_publication(self):
        self.increment(names=('quality/portrait-people-qa/zzz/sub.png',))
        for entry in A.read_qa_manifest(self.root)[0]['files']:
            (self.root / entry['path']).unlink()
        (self.root / 'quality/portrait-people-qa/zzz').rmdir()
        self.write('quality/portrait-people-qa/zzz', b'not a directory')
        with mock.patch.object(A.os, 'link', wraps=A.os.link) as link:
            with self.assertRaises((A.ArchiveError, OSError)):
                A.restore_qa(self.root, [self.qa_zip, self.inc_zip])
            link.assert_not_called()

    def test_delta_change_during_slow_prepublication_checks_is_rejected(self):
        self.write_restore()
        name = 'quality/text-qa/new-a.png'
        self.write(name, b'original new evidence')
        output = self.base / 'increment.zip'
        manifest_before = (self.root / A.QA_MANIFEST).read_bytes()
        original = A.frozen_records
        calls = 0
        def racing_check(*args, **kwargs):
            nonlocal calls
            result = original(*args, **kwargs)
            calls += 1
            if calls == 2:
                self.write(name, b'new evidence changed during prior-archive readback')
            return result
        with mock.patch.object(A, 'frozen_records', side_effect=racing_check):
            with self.assertRaises(A.ArchiveError):
                A.freeze_qa_increment(self.root, output, 16, [self.qa_zip])
        self.assertFalse(output.exists())
        self.assertEqual((self.root / A.QA_MANIFEST).read_bytes(), manifest_before)

    def test_restore_rolls_back_when_existing_file_changes_during_staging(self):
        self.increment()
        missing = self.root / 'quality/text-qa/new-a.png'
        missing.unlink()
        old = self.root / 'quality/fixtures/portrait.png'
        original = A.read_archive_set
        calls = 0
        def racing_check(*args, **kwargs):
            nonlocal calls
            result = original(*args, **kwargs)
            calls += 1
            if calls == 2:
                old.write_bytes(b'changed by another process')
            return result
        with mock.patch.object(A, 'read_archive_set', side_effect=racing_check):
            with self.assertRaises(A.ArchiveError):
                A.restore_qa(self.root, [self.qa_zip, self.inc_zip])
        self.assertFalse(missing.exists())
        self.assertEqual(old.read_bytes(), b'changed by another process')


if __name__ == '__main__':
    unittest.main(verbosity=2)
