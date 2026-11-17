"""Pure adapter tests; no downloaded models or inference claims."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from birefnet_support import *

class SupportTests(unittest.TestCase):
    def fixture(self, root):
        for name in REQUIRED_ASSETS:
            (root / name).write_bytes(b"not executed or loaded")
        (root / "config.json").write_text(json.dumps({"bb_pretrained":False,"architectures":["BiRefNet"]}))
        return {"modelId":MODEL_ID,"revision":"a"*40,"files":{name:file_sha256(root/name) for name in REQUIRED_ASSETS}}
    def test_all_assets_validated_without_execution(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); manifest=self.fixture(root)
            self.assertEqual(verify_bundle(root,manifest)["revision"],"a"*40)
    def test_any_asset_tampering_rejected(self):
        for name in REQUIRED_ASSETS:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                root=Path(d); manifest=self.fixture(root); (root/name).write_bytes(b"altered")
                with self.assertRaises(MattingError):verify_bundle(root,manifest)
    def test_unlisted_code_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); manifest=self.fixture(root); (root/"extra.py").write_text("raise RuntimeError()")
            with self.assertRaises(MattingError):verify_bundle(root,manifest)
    def test_parent_path_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); manifest=self.fixture(root); manifest["files"]["../outside"]="a"*64
            with self.assertRaises(MattingError):verify_bundle(root,manifest)
    def test_unpinned_revision_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); manifest=self.fixture(root); manifest["revision"]="main"
            with self.assertRaises(MattingError):verify_bundle(root,manifest)
    def test_download_config_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); manifest=self.fixture(root)
            (root/"config.json").write_text('{"bb_pretrained": true, "architectures":["BiRefNet"]}')
            manifest["files"]["config.json"]=file_sha256(root/"config.json")
            with self.assertRaises(MattingError):verify_bundle(root,manifest)
    def test_rgb_channel_order_and_normalization(self):
        source=np.zeros((3,7,4),np.uint8);source[:]=[255,0,127,17];before=source.copy()
        x, meta=prepare_rgb(source,512)
        self.assertEqual(x.shape,(1,3,512,512));self.assertEqual(x.dtype,np.float32)
        np.testing.assert_allclose(x[0,:,0,0],[(1-.485)/.229,(0-.456)/.224,(127/255-.406)/.225],atol=1e-6)
        self.assertEqual(meta["sourceWidth"],7);self.assertEqual(meta["sourceHeight"],3)
        self.assertEqual(meta["profile"],"diagnostic-512");np.testing.assert_array_equal(source,before)
    def test_bad_images_and_implicit_resolution_rejected(self):
        for image in [np.zeros((2,2,3),np.uint8),np.zeros((2,2,4),np.float32),np.zeros((0,2,4),np.uint8)]:
            with self.assertRaises(MattingError):prepare_rgb(image)
        with self.assertRaises(MattingError):prepare_rgb(np.zeros((2,2,4),np.uint8),256)
    def test_soft_alpha_and_source_transparency_preserved(self):
        source=np.array([[[11,23,37,255],[49,51,63,127],[71,83,97,0]]],np.uint8)
        matte=np.array([[.2,.5,1]],np.float32)
        out=source_alpha_cutout(source,matte)
        np.testing.assert_array_equal(out[:,:,:3],source[:,:,:3]);np.testing.assert_array_equal(out[:,:,3],[[51,64,0]])
        self.assertEqual(alpha_statistics(matte)["softPixelCount"],2)
    def test_invalid_alpha_rejected(self):
        for alpha in [np.array([[np.nan]],np.float32),np.array([[2]],np.float32),np.array([[-.1]],np.float32),np.array([[1]],np.float64)]:
            with self.assertRaises(MattingError):validate_alpha(alpha,1,1)
    def test_zero_one_and_copy(self):
        source=np.array([[[1,2,3,45],[4,5,6,0]]],np.uint8)
        np.testing.assert_array_equal(source_alpha_cutout(source,np.ones((1,2),np.float32)),source)
        out=source_alpha_cutout(source,np.zeros((1,2),np.float32));self.assertEqual(int(out[:,:,3].sum()),0)
        out[:]=9;self.assertEqual(int(source[0,0,0]),1)

if __name__=="__main__":unittest.main()
