import unittest
import numpy as np
from birefnet_quality import alpha_metrics, composite
class QualityTests(unittest.TestCase):
    def test_identity_and_real_soft_region(self):
        a=np.array([[0,.25,.5,.75,1]],np.float32)
        m=alpha_metrics(a,a);self.assertEqual(m['MAD'],0);self.assertEqual(m['softReferencePixels'],3)
    def test_binary_substitution_is_measurably_wrong(self):
        a=np.array([[0,.25,.5,.75,1]],np.float32)
        m=alpha_metrics((a>.5).astype(np.float32),a)
        self.assertGreater(m['softReferenceMAD'],.3)
    def test_no_fake_soft_reference_metric(self):
        a=np.array([[0,1]],np.float32)
        self.assertIsNone(alpha_metrics(a,a)['softReferenceMAD'])
    def test_geometry_or_range_mismatch_fails(self):
        with self.assertRaises(ValueError):alpha_metrics(np.ones((2,2)),np.ones((1,4)))
        with self.assertRaises(ValueError):alpha_metrics(np.array([[np.nan]]),np.array([[0.]]))
    def test_composition_keeps_soft_alpha_and_linear_light(self):
        fg=np.array([[[255,255,255]]],np.uint8);a=np.array([[.5]],np.float32)
        out=composite(fg,a,np.array([0,0,0],np.uint8))
        self.assertEqual(int(out[0,0,0]),188)
    def test_opaque_and_transparent_endpoints(self):
        fg=np.array([[[10,20,30]]],np.uint8);bg=np.array([70,80,90],np.uint8)
        np.testing.assert_array_equal(composite(fg,np.ones((1,1),np.float32),bg),fg)
        np.testing.assert_array_equal(composite(fg,np.zeros((1,1),np.float32),bg),bg.reshape(1,1,3))
if __name__=='__main__':unittest.main()
