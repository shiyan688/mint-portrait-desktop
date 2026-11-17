"""Local-only BiRefNet_HR-matting adapter for the bounded desktop worker.

This file is locally authored. Importing it never loads external model code.
Execution requires the host's separately approved, hash-verified model manifest.
It returns continuous alpha only; it does not silently whiten, recolor, refine
foreground RGB, threshold masks, replace failed inference, or call the network.
"""
from __future__ import annotations
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
import types
from typing import Any

_ASSET_NAMES = {"weights": "model.safetensors", "birefnetCode": "birefnet.py",
                "birefnetConfig": "BiRefNet_config.py", "modelConfig": "config.json"}
_MODEL_ID = "ZhengPeng7/BiRefNet_HR-matting"


def _options(config: dict[str, Any]) -> tuple[int, str, int, str]:
    side = config.get("inputSize", 2048)
    if type(side) is not int or side not in (512, 1024, 2048):
        raise ValueError("BiRefNet inputSize must explicitly be 512, 1024 or 2048")
    precision = config.get("precision", "float32")
    if precision not in ("float32", "float16", "bfloat16"):
        raise ValueError("Unsupported explicit model precision")
    threads = config.get("threads", 4)
    if type(threads) is not int or not 1 <= threads <= 8:
        raise ValueError("CPU thread budget must be between 1 and 8")
    revision = config.get("modelRevision")
    if not isinstance(revision, str) or not re.fullmatch("[a-f0-9]{40}", revision):
        raise ValueError("A pinned 40-hex official model revision is required")
    return side, precision, threads, revision


def probe(manifest: dict[str, Any]) -> dict[str, Any]:
    """Metadata-only capability description. Never announces hardware readiness."""
    side, precision, threads, revision = _options(manifest.get("config", {}))
    return {"adapter": "birefnet", "modelId": _MODEL_ID, "task": "matting",
            "output": "roi-original-pixels/unit-float32-le", "alphaOnly": True,
            "inputSize": side, "precision": precision, "threads": threads,
            "modelRevision": revision,
            "profile": "hr-2048" if side == 2048 else f"diagnostic-{side}",
            "loaded": False, "inferenceVerified": False, "downloads": False,
            "foregroundDecontamination": manifest.get("config", {}).get("foregroundRefinement") == "pymatting-1.1.16"}


def _checked_paths(request: dict[str, Any]) -> dict[str, Path]:
    # Host and worker validate the trusted per-file hashes before invoking us.
    # Defense in depth: do not import an extra relative .py from a different tree.
    paths = {}
    for asset, basename in _ASSET_NAMES.items():
        raw = request["assets"].get(asset)
        if not isinstance(raw, str):
            raise ValueError(f"Required validated asset absent: {asset}")
        path = Path(raw)
        if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.name != basename:
            raise ValueError(f"Unsafe or incorrectly named model asset: {asset}")
        paths[asset] = path.resolve(strict=True)
    roots = {p.parent for p in paths.values()}
    if len(roots) != 1:
        raise ValueError("Pinned model assets must share one directory")
    root = paths["weights"].parent
    allowed_code = {paths["birefnetCode"], paths["birefnetConfig"]}
    if any(path.is_symlink() or path.resolve() not in allowed_code for path in root.rglob("*.py")):
        raise ValueError("Unlisted executable Python in the model directory")
    config = json.loads(paths["modelConfig"].read_text("utf-8"))
    if config.get("architectures") != ["BiRefNet"] or config.get("bb_pretrained") is not False:
        raise ValueError("Model config must select BiRefNet with backbone downloads disabled")
    return paths


def _import_reviewed(paths: dict[str, Path], revision: str):
    """Explicit local import after hash/approval checks, no trust_remote_code."""
    package_name = "_mint_reviewed_birefnet_" + revision
    module_name = package_name + ".birefnet"
    if module_name in sys.modules:
        return sys.modules[module_name]
    package = types.ModuleType(package_name)
    package.__path__ = [str(paths["birefnetCode"].parent)]
    package.__package__ = package_name
    sys.modules[package_name] = package
    spec = importlib.util.spec_from_file_location(module_name, paths["birefnetCode"])
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not resolve reviewed local model code")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(module_name, None)
        sys.modules.pop(package_name, None)
        raise
    return module


def infer(request: dict[str, Any]) -> dict[str, Any]:
    """Full-strength learned alpha prediction, original ROI size, little-endian f32.

    Cancellation/timeout is process-owned by the worker, not a pretend flag here.
    The runner alone applies edit mask and strength, once.
    """
    if request.get("task") != "matting":
        raise ValueError("BiRefNet only implements matting")
    config = request.get("config", {})
    if config.get("executionApproved") is not True:
        raise PermissionError("Research model execution has not been explicitly approved")
    side, precision, threads, revision = _options(config)
    refinement = config.get("foregroundRefinement", False)
    if refinement not in (False, None, "pymatting-1.1.16"):
        raise ValueError("Unsupported explicit foreground refinement profile")
    model_descriptor = request.get("model", {})
    if model_descriptor.get("id") != _MODEL_ID:
        raise ValueError("Unexpected model ID")
    device_kind = model_descriptor.get("device", {}).get("kind")
    if device_kind not in ("cpu", "cuda") or (device_kind == "cpu" and precision not in ("float32", "bfloat16")) or (device_kind == "cuda" and precision == "bfloat16"):
        raise ValueError("Only explicit CPU-float32/bfloat16 or CUDA-float32/float16 is supported")
    paths = _checked_paths(request)
    # Defense in depth for direct invocation outside worker. The worker also
    # verifies every code/config digest before any adapter import.
    from .birefnet_support import file_sha256, prepare_rgb, rgba_array, validate_alpha
    if file_sha256(paths["weights"]) != model_descriptor.get("weightsSha256"):
        raise ValueError("Model weights digest does not match selected descriptor")
    # No network is needed for this local code + safetensors load. The process
    # supervisor also owns outbound isolation; environment flags are not a sandbox.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import numpy as np
    import torch
    from safetensors.torch import load_file
    if device_kind == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("Requested CUDA is unavailable; CPU fallback is forbidden")
    torch.set_num_threads(threads)
    source = request.get("source", {})
    width, height = source.get("width"), source.get("height")
    if type(width) is not int or type(height) is not int or min(width, height) < 1 or width * height > 16_777_216:
        raise ValueError("Invalid original ROI dimensions")
    if (width, height) != (request["roi"]["width"], request["roi"]["height"]):
        raise ValueError("Source and ROI dimensions differ")
    raw = source.get("data")
    if not isinstance(raw, bytes) or len(raw) != width * height * 4:
        raise ValueError("Source must contain exact RGBA8 bytes")
    rgba = rgba_array(np.frombuffer(raw, np.uint8).reshape(height, width, 4))
    prepared, transform = prepare_rgb(rgba, side)
    vendor = _import_reviewed(paths, revision)
    dtype = torch.float16 if precision == "float16" else torch.float32
    # Explicit CPU mixed-bfloat16 profile, never a hidden fallback. Torchvision's
    # CPU deformable convolution has no bfloat16 kernel: keep that exact operator
    # in float32 while allowing supported conv/attention kernels to use bfloat16.
    # Model code and parameters remain pinned and unchanged.
    if precision == "bfloat16":
        original_deform = vendor.deform_conv2d
        def deform_float32(*args, **kwargs):
            output_dtype = (args[0] if args else kwargs["input"]).dtype
            cast = lambda value: value.float() if isinstance(value, torch.Tensor) and value.is_floating_point() else value
            with torch.autocast("cpu", enabled=False):
                result = original_deform(*(cast(value) for value in args), **{key:cast(value) for key,value in kwargs.items()})
            return result.to(output_dtype)
        vendor.deform_conv2d = deform_float32
    # Explicit False prevents the vendor's optional torch.load/backbone download.
    model = vendor.BiRefNet(config=vendor.BiRefNetConfig(bb_pretrained=False))
    state = load_file(str(paths["weights"]), device="cpu")
    model.load_state_dict(state, strict=True)
    del state
    model.eval().requires_grad_(False).to(device=device_kind, dtype=dtype)
    tensor = torch.from_numpy(prepared).to(device=device_kind, dtype=dtype)
    started = time.perf_counter()
    with torch.inference_mode(), (torch.autocast("cpu", dtype=torch.bfloat16) if precision == "bfloat16" else contextlib.nullcontext()):
        outputs = model(tensor)
        if not isinstance(outputs, (list, tuple)) or not outputs:
            raise RuntimeError("Unexpected learned model output")
        logits = outputs[-1]
        if not isinstance(logits, torch.Tensor) or logits.ndim != 4 or tuple(logits.shape[:2]) != (1, 1):
            raise RuntimeError("Unexpected learned alpha logits geometry")
        # Sigmoid, then bilinear inverse transform preserves soft alpha; no
        # threshold, erosion, min-max stretch, blur or binary-mask substitution.
        alpha = torch.nn.functional.interpolate(logits.float().sigmoid(), size=(height, width), mode="bilinear", align_corners=False)
        alpha = alpha[0, 0].cpu().numpy().astype(np.float32, copy=False)
    alpha = validate_alpha(alpha, width, height)
    elapsed = time.perf_counter() - started
    print(json.dumps({"component":"birefnet", "seconds":elapsed, "device":device_kind,
                      "precision":precision,"transform":transform,"foregroundDecontamination":False}), file=sys.stderr, flush=True)
    result = {"kind":"matte", "width":width, "height":height, "data":alpha.astype("<f4", copy=False).tobytes()}
    if refinement == "pymatting-1.1.16":
        from .birefnet_foreground import estimate_foreground
        foreground, metadata = estimate_foreground(rgba, alpha, enabled=True)
        result["foreground"] = {"width":width,"height":height,"format":"rgba8","alphaMode":"straight","colorSpace":"srgb","data":foreground.tobytes()}
        result["foregroundRefinement"] = metadata
    return result
