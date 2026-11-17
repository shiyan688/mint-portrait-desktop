"""Dependency-free approval/precision tests; does not import model or torch."""
import importlib.util, pathlib, sys, unittest
p=pathlib.Path(__file__).with_name('birefnet.py')
spec=importlib.util.spec_from_file_location('reviewed_adapter_options',p);adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
class OptionTests(unittest.TestCase):
 def test_default_is_hr_float32(self):
  self.assertEqual(adapter._options({'modelRevision':'a'*40}),(2048,'float32',4,'a'*40))
 def test_bfloat16_requires_explicit_selection(self):
  self.assertEqual(adapter._options({'modelRevision':'a'*40,'precision':'bfloat16'})[1],'bfloat16')
 def test_invalid_precision_does_not_fallback(self):
  with self.assertRaises(ValueError):adapter._options({'modelRevision':'a'*40,'precision':'auto'})
 def test_unapproved_inference_stops_before_any_model(self):
  with self.assertRaises(PermissionError):adapter.infer({'task':'matting','config':{}})
 def test_probe_is_metadata_only(self):
  result=adapter.probe({'config':{'modelRevision':'a'*40,'precision':'bfloat16'}})
  self.assertFalse(result['loaded']);self.assertFalse(result['inferenceVerified']);self.assertFalse(result['foregroundDecontamination'])
if __name__=='__main__':unittest.main()
