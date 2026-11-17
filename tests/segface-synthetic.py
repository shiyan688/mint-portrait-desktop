"""Own stdlib synthetic fixtures only. No upstream source/model is executed."""
import hashlib
import importlib.util
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend' / 'adapters'))
from segface import probe, infer, SegFaceError
from segface.adapter import CLASSES, _MANIFEST, validate_request, verify_file, extract_state_dict, pack_probabilities, patched_network_ast
import segface.adapter as adapter


def request():
    return {'task': 'parse', 'source': {'width': 2, 'height': 1, 'data': bytes([1, 2, 3, 255] * 2)},
            'roi': {'x': 1, 'y': 2, 'width': 2, 'height': 1}, 'originalSize': {'width': 10, 'height': 10},
            'mask': None, 'selection': {'kind': 'detected-face', 'faceId': 'synthetic-1', 'revision': 'test-1'},
            'config': {'executionApproved': True, 'sourceDir': '/synthetic/not-read', 'variant': 'mobilenet'},
            'model': {'weightsSha256': _MANIFEST['weights']['variants']['mobilenet']['sha256'], 'device': {'kind': 'cpu'}},
            'assets': {'checkpoint': '/synthetic/not-read.pt'}}


class Tests(unittest.TestCase):
    def test_import_and_probe_never_import_models(self):
        self.assertNotIn('torch', sys.modules)
        p = probe()
        self.assertEqual(p['status'], 'not_validated')
        self.assertFalse(p['executionApproved'])
        self.assertEqual(p['classes'][2], 'skin')
        self.assertNotIn('torch', sys.modules)

    def test_approval_fails_before_import_or_asset_access(self):
        r = request(); r['config']['executionApproved'] = False
        with self.assertRaises(SegFaceError) as e: infer(r)
        self.assertEqual(e.exception.code, 'EXECUTION_NOT_APPROVED')
        self.assertNotIn('torch', sys.modules)

    def test_valid_original_pixel_roi(self):
        self.assertEqual(validate_request(request())[2:4], (2, 1))

    def test_bad_roi_alpha_digest_device(self):
        mutations = [lambda r: r['roi'].update(x=9), lambda r: r['roi'].update(width=3),
                     lambda r: r['source'].update(data=bytes([1, 2, 3, 0] * 2)),
                     lambda r: r['model'].update(weightsSha256='0'*64),
                     lambda r: r['model'].update(device={'kind':'auto'}),
                     lambda r: r.update(mask={}), lambda r: r.update(task='retouch'),
                     lambda r: r.update(selection=None), lambda r: r['selection'].update(kind='whole-photo'),
                     lambda r: r.update(source=None), lambda r: r.update(model=None),
                     lambda r: r['config'].update(threads=0), lambda r: r['config'].update(threads=9),
                     lambda r: r['config'].update(threads=True)]
        for mutate in mutations:
            r = request(); mutate(r)
            with self.assertRaises(SegFaceError): validate_request(r)

    def test_exact_file_hash_and_size(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'fixture.txt'; p.write_bytes(b'own synthetic fixture')
            meta = {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            self.assertEqual(verify_file(p, meta), p.resolve())
            with self.assertRaises(SegFaceError): verify_file(p, {**meta, 'bytes': 1})
            with self.assertRaises(SegFaceError): verify_file(p, {**meta, 'sha256': '0'*64})

    def test_tensor_wrapper_validation_with_explicit_test_double(self):
        class TensorFixture: pass
        class TorchTestDouble:
            @staticmethod
            def is_tensor(value): return isinstance(value, TensorFixture)
        state = {'weight': TensorFixture()}
        self.assertIs(extract_state_dict({'state_dict_backbone': state}, TorchTestDouble), state)
        for ckpt in [{}, {'state_dict_backbone': {}}, {'state_dict_backbone': {'weight': 'not-a-tensor'}}]:
            with self.assertRaises(SegFaceError): extract_state_dict(ckpt, TorchTestDouble)

    def test_restricted_loader_never_falls_back_to_pickle(self):
        calls = []
        fake = types.ModuleType('torch')
        fake.cuda = types.SimpleNamespace(is_available=lambda: False)
        def restricted_failure(stream, **kwargs):
            calls.append(kwargs)
            raise ValueError('synthetic restricted-loader rejection')
        fake.load = restricted_failure
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'own-fixture.pt'; p.write_bytes(b'not a real checkpoint')
            asset = {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            r = request(); r['assets']['checkpoint'] = str(p)
            with patch.dict(sys.modules, {'torch': fake}), patch.object(adapter, '_build_network', return_value=object()):
                with self.assertRaises(SegFaceError) as e: adapter._load_network(r, 'mobilenet', asset, 'cpu')
            self.assertEqual(e.exception.code, 'SAFE_LOAD_FAILED')
            self.assertEqual(calls, [{'map_location': 'cpu', 'weights_only': True}])
        self.assertNotIn('torch', sys.modules)

    def test_little_endian_planar_probability_fixture(self):
        values = [0.0] * (len(CLASSES) * 2)
        values[0:2] = [0.25, 0.5]; values[4:6] = [0.75, 0.5]
        raw = pack_probabilities(values, 2, 1)
        self.assertEqual(struct.unpack_from('<f', raw, 4*4)[0], 0.75)
        for bad in [float('nan'), float('inf'), -0.1, 1.1]:
            altered = values.copy(); altered[0] = bad
            with self.assertRaises(SegFaceError): pack_probabilities(altered, 2, 1)
        with self.assertRaises(SegFaceError): pack_probabilities([0.0] * 38, 2, 1)

    def test_patching_refuses_unexpected_source_without_execution(self):
        with self.assertRaises(SegFaceError): patched_network_ast('raise Exception("must not execute")')
        source = ('import sys\nfrom network.models.transformer import *\n'
                  'from network.models.utils_models import *\nsys.path.insert(0,"bad")\n' +
                  '\n'.join('mobilenet_v3_large(pretrained=True)' for _ in range(10)))
        tree = patched_network_ast(source)
        import ast
        transformed = ast.unparse(tree)
        self.assertNotIn('sys.path.insert', transformed)
        self.assertNotIn('pretrained=True', transformed)
        self.assertEqual(transformed.count('weights=None'), 10)

    def test_threads_are_bounded_and_interop_set_once_with_test_double(self):
        calls=[]
        fake=types.SimpleNamespace(set_num_threads=lambda n:calls.append(('intra',n)),
                                   get_num_interop_threads=lambda:4,
                                   set_num_interop_threads=lambda n:calls.append(('inter',n)))
        with patch.object(adapter,'_INTEROP_ATTEMPTED',False):
            adapter._configure_threads(fake,2);adapter._configure_threads(fake,4)
        self.assertEqual(calls,[('intra',2),('inter',1),('intra',4)])


if __name__ == '__main__': unittest.main()
