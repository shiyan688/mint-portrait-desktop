"""Explicit optional classical foreground-color estimation; never replaces alpha.

Uses official PyPI PyMatting 1.1.16 (MIT). No model/download/network operations.
The immutable original and learned alpha are inputs; the returned RGB is a
separate optional plane, not a silently recolored original or a learned retouch.
"""
from __future__ import annotations
import hashlib
import importlib.metadata
import numpy as np
from .birefnet_support import rgba_array, validate_alpha
from .birefnet_quality import rgb_to_linear, linear_to_rgb

SETTINGS = {'workingColorSpace':'linear-srgb','regularization':1e-5,
            'n_small_iterations':10,'n_big_iterations':2,'small_size':32,
            'gradient_weight':1.0,'opaqueProtection':'correction weight min(1,20*(1-alpha))',
            'sourceAlphaPolicy':'original alpha bytes preserved; RGB unchanged where source alpha < 255'}


def estimate_foreground(rgba: np.ndarray, alpha: np.ndarray, *, enabled: bool = False) -> tuple[np.ndarray, dict]:
    if enabled is not True:
        raise PermissionError('Foreground color refinement must be explicitly selected')
    source=rgba_array(rgba);h,w=source.shape[:2];a=validate_alpha(alpha,w,h)
    if w*h>16_777_216: raise ValueError('Foreground estimation exceeds pixel budget')
    if importlib.metadata.version('pymatting')!='1.1.16':
        raise RuntimeError('Foreground estimator requires the pinned PyMatting 1.1.16 runtime')
    import numba
    numba.set_num_threads(min(2,numba.config.NUMBA_NUM_THREADS))
    from pymatting import estimate_foreground_ml
    # The actual source RGB is copied. Neither input buffer can be modified by
    # third-party estimation. Alpha never receives smoothing/thresholding here.
    image=rgb_to_linear(source[:,:,:3].astype(np.float64)/255).astype(np.float32)
    estimated=estimate_foreground_ml(image,a.copy(),regularization=1e-5,
                    n_small_iterations=10,n_big_iterations=2,small_size=32,
                    gradient_weight=1.0,return_background=False)
    if estimated.shape!=image.shape or not np.isfinite(estimated).all():
        raise RuntimeError('Foreground estimator returned invalid RGB')
    weight=np.clip((1-a.astype(np.float64))*20,0,1)
    weight[source[:,:,3]!=255]=0
    corrected=image.astype(np.float64)+(np.clip(estimated,0,1)-image)*weight[:,:,None]
    out=source.copy()
    out[:,:,:3]=np.floor(linear_to_rgb(corrected)*255+.5).astype(np.uint8)
    # Enforce bit-identical originally translucent/transparent pixels and opaque
    # interiors. This postprocess cannot reconstruct already missing alpha.
    out[source[:,:,3]!=255]=source[source[:,:,3]!=255]
    out[a==1]=source[a==1]
    metadata={'kind':'classical-color-estimation','implementation':'pymatting','version':'1.1.16',
              'method':'estimate_foreground_ml','settings':dict(SETTINGS),'alphaModified':False,
              'alphaDigest':hashlib.sha256(a.astype('<f4',copy=False).tobytes()).hexdigest(),
              'sourceDigest':hashlib.sha256(source.tobytes()).hexdigest()}
    return out,metadata


def blend_foreground_strength(source: np.ndarray, estimated: np.ndarray, alpha: np.ndarray,
                              provenance: dict, strength: float) -> np.ndarray:
    """Pure strength adapter; refuses an estimate after any alpha/source change."""
    import math
    original=rgba_array(source);candidate=rgba_array(estimated);h,w=original.shape[:2]
    a=validate_alpha(alpha,w,h)
    if candidate.shape!=original.shape or not np.array_equal(candidate[:,:,3],original[:,:,3]):
        raise ValueError('Estimated foreground geometry/source alpha differ')
    if type(strength) not in (int,float) or not math.isfinite(strength) or not 0<=strength<=1:
        raise ValueError('Foreground strength must explicitly be finite [0,1]')
    digest=hashlib.sha256(a.astype('<f4',copy=False).tobytes()).hexdigest()
    if provenance.get('alphaDigest')!=digest:
        raise ValueError('Foreground estimate is stale after matte changes')
    if provenance.get('sourceDigest')!=hashlib.sha256(original.tobytes()).hexdigest():
        raise ValueError('Foreground estimate belongs to a different original image')
    if strength==0:return original.copy()
    if strength==1:out=candidate.copy()
    else:
        lo=rgb_to_linear(original[:,:,:3]/255);hi=rgb_to_linear(candidate[:,:,:3]/255)
        out=original.copy();out[:,:,:3]=np.floor(linear_to_rgb(lo+(hi-lo)*strength)*255+.5).astype(np.uint8)
    out[original[:,:,3]!=255]=original[original[:,:,3]!=255]
    out[a==1]=original[a==1]
    return out
