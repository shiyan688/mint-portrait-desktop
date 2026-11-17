"""Contract tests with deterministic estimator double, not model quality claims."""
import hashlib,importlib.util,pathlib,sys,types,unittest
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from adapters.birefnet_foreground import estimate_foreground,blend_foreground_strength
class ForegroundTests(unittest.TestCase):
 def run_fake(self,source,alpha):
  fake=types.ModuleType('pymatting');fake.estimate_foreground_ml=lambda image,alpha,**kw:np.full_like(image,.25)
  numba=types.ModuleType('numba');numba.config=types.SimpleNamespace(NUMBA_NUM_THREADS=2);numba.set_num_threads=lambda n:None
  with patch.dict(sys.modules,{'pymatting':fake,'numba':numba}),patch('importlib.metadata.version',return_value='1.1.16'):
   return estimate_foreground(source,alpha,enabled=True)
 def test_refinement_optin_required(self):
  with self.assertRaises(PermissionError):estimate_foreground(np.ones((1,1,4),np.uint8),np.ones((1,1),np.float32))
 def test_inputs_and_all_original_alpha_bytes_preserved(self):
  s=np.array([[[40,60,80,255],[60,90,30,128],[90,10,70,0]]],np.uint8);a=np.array([[.5,.5,.5]],np.float32);before=s.copy();aa=a.copy();o,m=self.run_fake(s,a)
  np.testing.assert_array_equal(s,before);np.testing.assert_array_equal(a,aa);np.testing.assert_array_equal(o[:,:,3],s[:,:,3]);np.testing.assert_array_equal(o[:,1:],s[:,1:]);self.assertFalse(np.array_equal(o[:,0],s[:,0]));self.assertFalse(m['alphaModified']);self.assertEqual(m['alphaDigest'],hashlib.sha256(a.astype('<f4').tobytes()).hexdigest())
 def test_opaque_interior_is_exact(self):
  s=np.array([[[26,66,97,255]]],np.uint8);o,_=self.run_fake(s,np.ones((1,1),np.float32));np.testing.assert_array_equal(o,s)
 def test_reject_wrong_version_before_estimation(self):
  with patch('importlib.metadata.version',return_value='9.9'):
   with self.assertRaises(RuntimeError):estimate_foreground(np.ones((2,2,4),np.uint8),np.ones((2,2),np.float32),enabled=True)
 def test_reject_nonfinite_alpha(self):
  with self.assertRaises(ValueError):self.run_fake(np.ones((1,1,4),np.uint8),np.array([[np.nan]],np.float32))
 def test_strength_endpoints_and_midpoint_are_real(self):
  s=np.array([[[10,30,60,255]]],np.uint8);a=np.array([[.5]],np.float32);o,m=self.run_fake(s,a)
  np.testing.assert_array_equal(blend_foreground_strength(s,o,a,m,0),s);np.testing.assert_array_equal(blend_foreground_strength(s,o,a,m,1),o)
  mid=blend_foreground_strength(s,o,a,m,.5);self.assertTrue(np.all(mid[:,:,:3]>s[:,:,:3]));self.assertTrue(np.all(mid[:,:,:3]<o[:,:,:3]))
 def test_stale_alpha_or_original_rejected(self):
  s=np.array([[[10,30,60,255]]],np.uint8);a=np.array([[.5]],np.float32);o,m=self.run_fake(s,a)
  with self.assertRaises(ValueError):blend_foreground_strength(s,o,np.array([[.4]],np.float32),m,.5)
  altered=s.copy();altered[0,0,0]+=1
  with self.assertRaises(ValueError):blend_foreground_strength(altered,o,a,m,.5)
 def test_strength_no_out_of_range_or_nan(self):
  s=np.array([[[10,30,60,255]]],np.uint8);a=np.array([[.5]],np.float32);o,m=self.run_fake(s,a)
  for strength in [-1,1.01,float('nan'),float('inf'),True]:
   with self.assertRaises(ValueError):blend_foreground_strength(s,o,a,m,strength)
if __name__=='__main__':unittest.main()
