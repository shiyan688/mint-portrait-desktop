"""Pure, locally authored BiRefNet adapter helpers. No model code is imported here.

These tests establish transport/preprocessing correctness, NOT learned-model quality.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from typing import Any
import numpy as np
from PIL import Image

MODEL_ID = "ZhengPeng7/BiRefNet_HR-matting"
MAX_PIXELS = 16_777_216
REQUIRED_ASSETS = ("birefnet.py", "BiRefNet_config.py", "config.json", "model.safetensors")
HEX64 = re.compile(r"^[a-f0-9]{64}$")

class MattingError(ValueError):
    pass

def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def verify_bundle(root: str | Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Verify a trusted application manifest before importing any vendor Python.

    A manifest is not user consent or a security sandbox. Its digests must come
    from the reviewed, pinned developer package, never photo metadata.
    """
    root = Path(root).resolve(strict=True)
    if not root.is_dir() or manifest.get("modelId") != MODEL_ID:
        raise MattingError("Unsupported or absent model bundle")
    revision = manifest.get("revision")
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise MattingError("A full pinned model revision is required")
    files = manifest.get("files")
    if not isinstance(files, dict) or any(name not in files for name in REQUIRED_ASSETS):
        raise MattingError("Manifest must hash every required code/config/weights asset")
    for name, digest in files.items():
        if not isinstance(name, str) or Path(name).name != name or not isinstance(digest, str) or not HEX64.fullmatch(digest):
            raise MattingError("Invalid pinned asset entry")
        path = root / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != root:
            raise MattingError(f"Missing or unsafe asset: {name}")
        if file_sha256(path) != digest:
            raise MattingError(f"Asset digest mismatch: {name}")
    config = json.loads((root / "config.json").read_text("utf-8"))
    if config.get("bb_pretrained") is not False:
        raise MattingError("Backbone auto-download must be explicitly disabled")
    if config.get("architectures") != ["BiRefNet"]:
        raise MattingError("Unexpected model architecture")
    # Extra Python files could be imported relatively. Reject them rather than
    # treating a four-file manifest as permission to execute a different tree.
    for path in root.rglob("*.py"):
        if path.parent != root or path.name not in files:
            raise MattingError("Unlisted executable source in model directory")
    return {"modelId": MODEL_ID, "revision": revision,
            "weightsSha256": files["model.safetensors"], "root": str(root)}

def rgba_array(value: np.ndarray) -> np.ndarray:
    if not isinstance(value, np.ndarray) or value.dtype != np.uint8 or value.ndim != 3 or value.shape[2] != 4:
        raise MattingError("Expected uint8 HxWx4 straight-sRGB pixels")
    h, w = value.shape[:2]
    if min(h, w) < 1 or h * w > MAX_PIXELS:
        raise MattingError("Image exceeds explicit original-ROI pixel budget")
    return np.ascontiguousarray(value).copy()

def prepare_rgb(source: np.ndarray, input_side: int = 2048) -> tuple[np.ndarray, dict[str, Any]]:
    """Official image-style RGB resize and ImageNet normalization, no alpha mask.

    Input resolution is explicit provenance. 512/1024 diagnostics are not
    silently substituted for 2048-quality inference. No min/max normalization.
    """
    source = rgba_array(source)
    if type(input_side) is not int or input_side not in (512, 1024, 2048):
        raise MattingError("Explicit supported input size must be 512, 1024 or 2048")
    h, w = source.shape[:2]
    rgb = Image.fromarray(source[:, :, :3], "RGB").resize((input_side, input_side), Image.Resampling.BILINEAR)
    tensor = np.asarray(rgb, dtype=np.float32) / np.float32(255)
    tensor = (tensor - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    tensor = np.ascontiguousarray(tensor.transpose(2, 0, 1)[None])
    return tensor, {"sourceWidth": w, "sourceHeight": h, "networkWidth": input_side,
                    "networkHeight": input_side, "resize": "bilinear-stretch",
                    "normalization": "imagenet-mean-std", "orientation": "caller-normalized",
                    "profile": "hr-2048" if input_side == 2048 else f"diagnostic-{input_side}"}

def validate_alpha(value: np.ndarray, width: int, height: int) -> np.ndarray:
    if not isinstance(value, np.ndarray) or value.dtype != np.float32 or value.shape != (height, width):
        raise MattingError("Alpha must be original-ROI HxW float32")
    if not np.isfinite(value).all() or np.any(value < 0) or np.any(value > 1):
        raise MattingError("Alpha must be finite and in [0,1]")
    return np.ascontiguousarray(value).copy()

def alpha_statistics(alpha: np.ndarray) -> dict[str, Any]:
    if alpha.ndim != 2:
        raise MattingError("Expected 2D alpha")
    alpha = validate_alpha(alpha, alpha.shape[1], alpha.shape[0])
    return {"minimum": float(alpha.min()), "maximum": float(alpha.max()),
            "mean": float(alpha.mean()), "softPixelCount": int(((alpha > .01) & (alpha < .99)).sum()),
            "pixelCount": int(alpha.size), "outputSha256": hashlib.sha256(alpha.astype("<f4").tobytes()).hexdigest()}

def source_alpha_cutout(source: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Evaluation-only alpha composition; keeps source RGB, including hidden RGB.

    This is deliberately NOT foreground decontamination: backgrounds must be
    inspected separately and this method must not be labelled halo-free.
    """
    result = rgba_array(source)
    h, w = result.shape[:2]
    matte = validate_alpha(alpha, w, h)
    result[:, :, 3] = np.floor(result[:, :, 3].astype(np.float32) * matte + .5).astype(np.uint8)
    return result
