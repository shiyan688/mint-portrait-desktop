"""Offline evaluation helpers. Metrics do not imply benchmark leadership.

Ground-truth alpha metrics require a real supplied ground truth. The public
NASA visual fixtures have no such ground truth and must not get fake scores.
"""
from __future__ import annotations
import numpy as np
from PIL import Image


def alpha_metrics(predicted: np.ndarray, target: np.ndarray) -> dict:
    if predicted.shape != target.shape or predicted.ndim != 2:
        raise ValueError("Prediction and real reference must have identical 2D geometry")
    p, t = np.asarray(predicted, np.float64), np.asarray(target, np.float64)
    if p.size == 0 or not np.isfinite(p).all() or not np.isfinite(t).all() or min(p.min(),t.min()) < 0 or max(p.max(),t.max()) > 1:
        raise ValueError("Alpha must be finite [0,1]")
    error = p-t
    unknown = (t > .01) & (t < .99)
    return {"pixels":int(p.size), "MAD":float(np.abs(error).mean()),
            "MSE":float((error**2).mean()), "SAD_sum_abs_div_1000":float(np.abs(error).sum()/1000),
            "softReferencePixels":int(unknown.sum()),
            "softReferenceMAD":float(np.abs(error[unknown]).mean()) if unknown.any() else None,
            "softReferenceMSE":float((error[unknown]**2).mean()) if unknown.any() else None}


def rgb_to_linear(value: np.ndarray) -> np.ndarray:
    value = np.asarray(value,np.float64)
    return np.where(value <= .04045, value/12.92, ((value+.055)/1.055)**2.4)


def linear_to_rgb(value: np.ndarray) -> np.ndarray:
    value = np.clip(np.asarray(value,np.float64),0,1)
    return np.where(value <= .0031308, value*12.92, 1.055*value**(1/2.4)-.055)


def composite(foreground: np.ndarray, alpha: np.ndarray, background: np.ndarray) -> np.ndarray:
    """Linear-light diagnostic composite; foreground is straight, not premultiplied."""
    if foreground.dtype != np.uint8 or foreground.ndim != 3 or foreground.shape[2] != 3:
        raise ValueError("Foreground must be RGB8")
    if alpha.shape != foreground.shape[:2] or not np.isfinite(alpha).all() or alpha.min()<0 or alpha.max()>1:
        raise ValueError("Invalid continuous alpha geometry/range")
    if background.shape == (3,):
        background = np.broadcast_to(background,foreground.shape)
    if background.shape != foreground.shape or background.dtype != np.uint8:
        raise ValueError("Background must be RGB8, same size or a constant RGB color")
    a=alpha[:,:,None].astype(np.float64)
    result=rgb_to_linear(foreground/255)*a+rgb_to_linear(background/255)*(1-a)
    return np.floor(linear_to_rgb(result)*255+.5).astype(np.uint8)


def diagnostic_grid(source_rgb: np.ndarray, alpha: np.ndarray, *, foreground_rgb: np.ndarray | None = None, cell=512) -> Image.Image:
    """Source/alpha/black/white/green/purple panels; label externally with provenance."""
    from .birefnet_support import validate_alpha
    h,w=source_rgb.shape[:2];alpha=validate_alpha(alpha,w,h)
    fg=source_rgb if foreground_rgb is None else foreground_rgb
    panels=[source_rgb,np.repeat(np.floor(alpha[:,:,None]*255+.5).astype(np.uint8),3,axis=2)]
    panels.extend(composite(fg,alpha,np.array(bg,np.uint8)) for bg in [(0,0,0),(255,255,255),(12,160,60),(94,20,130)])
    canvas=Image.new('RGB',(cell*3,cell*2),(25,25,25))
    for i,p in enumerate(panels):
        image=Image.fromarray(p,'RGB');image.thumbnail((cell,cell),Image.Resampling.LANCZOS)
        x=(i%3)*cell+(cell-image.width)//2;y=(i//3)*cell+(cell-image.height)//2
        canvas.paste(image,(x,y))
    return canvas
