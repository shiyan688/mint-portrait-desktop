"""One-shot approved local model runner. Default/missing models never simulate success."""
import array
import contextlib
import hashlib
import importlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import sys

# -I excludes user PYTHONPATH and user site packages; add only this bundled code directory.
BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))
sys.dont_write_bytecode = True
from protocol import ProtocolError, integer, read_frame, require, write_frame

ADAPTER_MODULES = {"segface": "adapters.segface", "birefnet": "adapters.birefnet", "generative": "adapters.generative"}
TASKS = {"parse", "retouch", "matting", "inpaint", "restore"}
REFINEMENT_CORE = {"kind": "classical-color-estimation", "implementation": "pymatting", "version": "1.1.16", "method": "estimate_foreground_ml"}


def execution_profile(manifest):
    config, adapter = manifest["config"], manifest["adapter"]
    if adapter == "birefnet":
        side, precision, threads = config.get("inputSize", 2048), config.get("precision", "float32"), config.get("threads", 4)
        require(type(side) is int and side in (512, 1024, 2048) and precision in ("float32", "float16", "bfloat16"), "INVALID_CONFIG", "Unsupported matting execution profile.")
        integer(threads, 1, 8, "model threads")
        profile = {"adapter": adapter, "inputSize": side, "precision": "mixed-bfloat16" if precision == "bfloat16" else precision, "threads": threads,
                   "qualityProfile": "hr-2048" if side == 2048 else f"diagnostic-{side}"}
        if precision == "bfloat16":
            profile["operatorPrecision"] = {"deformConv2d": "float32", "weights": "float32"}
        return profile
    if adapter == "segface":
        variant, threads = config.get("variant", "mobilenet"), config.get("threads", 2)
        require(variant in ("mobilenet", "swin_base"), "INVALID_CONFIG", "Unsupported parsing variant.")
        integer(threads, 1, 8, "model threads")
        return {"adapter": adapter, "variant": variant, "inputSize": 512, "precision": "float32", "threads": threads, "qualityProfile": "face-parsing-512"}
    return {"adapter": adapter}


def runtime_probe(packages):
    require(type(packages) is list and len(packages) <= 64 and all(type(p) is str and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", p) for p in packages),
            "INVALID_INPUT", "Invalid package probe list.")
    versions = {}
    for package in packages:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    cpu = {"kind": "cpu", "name": f"CPU ({platform.machine() or 'host'})", "available": True}
    cuda = {"kind": "cuda", "name": "CUDA", "available": False, "reason": "PyTorch CUDA availability has not been established."}
    try:
        importlib.metadata.version("torch")
    except importlib.metadata.PackageNotFoundError:
        cuda["reason"] = "Approved PyTorch runtime is not installed."
    else:
        try:
            # Only the separately installed official runtime is probed; no vendor/model code is imported.
            with contextlib.redirect_stdout(sys.stderr):
                import torch
                if torch.cuda.is_available():
                    device = torch.cuda.get_device_properties(0)
                    cuda = {"kind": "cuda", "name": device.name, "available": True, "memoryBytes": int(device.total_memory), "index": 0}
                else:
                    cuda["reason"] = "PyTorch reports no available CUDA device. No automatic CPU fallback."
        except Exception:
            cuda["reason"] = "Official PyTorch device probe failed; CUDA is unavailable until repaired."
    adapters = {}
    for name in ADAPTER_MODULES:
        adapters[name] = (BACKEND_ROOT / "adapters" / f"{name}.py").is_file() or (BACKEND_ROOT / "adapters" / name / "__init__.py").is_file()
    return {"runtime": {"available": True, "version": platform.python_version(), "implementation": platform.python_implementation()},
            "devices": [cpu, cuda], "packages": versions, "adapters": adapters}


def verify_assets(manifest):
    try:
        root = Path(manifest["modelRoot"]).resolve(strict=True)
    except (KeyError, OSError, RuntimeError):
        raise ProtocolError("ASSET_MISSING", "Configured model root is missing.")
    require(root.is_dir(), "ASSET_PATH_INVALID", "Model root must be a directory.")
    entries = manifest.get("assets")
    require(type(entries) is list and 0 < len(entries) <= 512, "INVALID_CONFIG", "Pinned assets are required.")
    assets = {}
    approved_paths = set()
    for entry in entries:
        require(type(entry) is dict, "INVALID_CONFIG", "Invalid asset entry.")
        name, relative, digest = entry.get("name"), entry.get("relativePath"), entry.get("sha256")
        require(type(name) is str and name and name not in assets and type(relative) is str and relative and
                not any(part in ("", ".", "..") for part in relative.split("/")) and not any(c in relative for c in ("\\", "\0", ":")) and
                not Path(relative).is_absolute() and type(digest) is str and re.fullmatch(r"[a-f0-9]{64}", digest),
                "INVALID_CONFIG", "Unsafe asset path, name or digest.")
        try:
            asset = (root / relative).resolve(strict=True)
            require(asset.is_relative_to(root) and asset.is_file(), "ASSET_PATH_INVALID", "Asset escapes its model root or is not a file.")
            hasher = hashlib.sha256()
            with asset.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    hasher.update(block)
        except OSError as exc:
            raise ProtocolError("ASSET_MISSING", f"Cannot read required model asset: {name}.") from exc
        require(hasher.hexdigest() == digest, "ASSET_HASH_MISMATCH", f"SHA-256 mismatch for model asset: {name}.")
        assets[name] = str(asset)
        approved_paths.add(asset)
    weights = next((entry for entry in entries if entry["name"] == manifest.get("weightsAsset")), None)
    require(weights and weights["sha256"] == manifest.get("weightsSha256"), "INVALID_CONFIG", "Weights identity does not match its pinned asset.")
    source_dir = manifest.get("config", {}).get("sourceDir")
    if source_dir is not None:
        source = Path(source_dir).resolve(strict=True)
        require(source.is_relative_to(root) and source.is_dir(), "ASSET_PATH_INVALID", "Vendor source must be within the model root.")
        for directory, subdirs, files in os.walk(source, followlinks=False):
            require("__pycache__" not in subdirs, "ASSET_UNPINNED_CODE", "Remove vendor source caches from the approved source tree.")
            for name in subdirs + files:
                candidate = Path(directory) / name
                require(not candidate.is_symlink(), "ASSET_PATH_INVALID", "Vendor source cannot contain symlinks.")
            for name in files:
                candidate = Path(directory) / name
                if candidate.suffix.lower() in (".py", ".pyc", ".pyd", ".so", ".dll"):
                    require(candidate in approved_paths, "ASSET_UNPINNED_CODE", "Executable vendor source was not pinned in the asset manifest.")
    return assets


def floats_le(data):
    require(len(data) % 4 == 0, "INVALID_OUTPUT", "Float payload is misaligned.")
    values = array.array("f")
    require(values.itemsize == 4, "RUNTIME_UNAVAILABLE", "Runtime float32 format is unsupported.")
    values.frombytes(data)
    if sys.byteorder != "little":
        values.byteswap()
    require(all(math.isfinite(value) and 0 <= value <= 1 for value in values), "INVALID_OUTPUT", "Probabilities must be finite in [0,1].")
    return values


def infer(header, payload):
    manifest, request = header.get("manifest"), header.get("request")
    require(type(manifest) is dict and type(request) is dict, "INVALID_INPUT", "Manifest and request are required.")
    require(manifest.get("adapter") in ADAPTER_MODULES, "INVALID_CONFIG", "Adapter key is not allowlisted.")
    require(manifest.get("enabled") is True and manifest.get("config", {}).get("executionApproved") is True,
            "EXECUTION_DISABLED", "Local model/code execution is not approved in trusted host configuration.")
    require(manifest.get("qualityStatus") != "blocked", "EXECUTION_DISABLED", "Model quality review is blocked in trusted host configuration.")
    require(manifest.get("license", {}).get("status") == "approved", "LICENSE_NOT_APPROVED", "Model/code license review is not approved.")
    refine = manifest["config"].get("foregroundRefinement", False)
    require(refine is False or (refine == "pymatting-1.1.16" and manifest["adapter"] == "birefnet" and request.get("task") == "matting"),
            "INVALID_CONFIG", "Foreground color estimation must be separately opted in for matting.")
    task, model = request.get("task"), request.get("model")
    require(task in TASKS and task in manifest.get("tasks", []) and type(model) is dict, "INCOMPATIBLE_TASK", "Model does not support the requested task.")
    require(model.get("id") == manifest.get("id") and model.get("version") == manifest.get("version") and
            model.get("weightsSha256") == manifest.get("weightsSha256") and model.get("kind") == manifest.get("kind") and
            model.get("device", {}).get("kind") in manifest.get("devices", []), "INVALID_PROVENANCE", "Request identity does not match its manifest.")
    roi, size = request.get("roi"), request.get("originalSize")
    require(type(roi) is dict and type(size) is dict, "INVALID_INPUT", "Original ROI geometry is required.")
    budget = integer(header.get("maxPixels"), 1, 67108864, "pixel budget")
    max_payload = integer(header.get("maxPayloadBytes"), 1024, 536870912, "payload budget")
    width = integer(size.get("width"), 1, budget, "original width")
    height = integer(size.get("height"), 1, budget, "original height")
    require(width * height <= budget, "INVALID_INPUT", "Original exceeds pixel budget.")
    rw = integer(roi.get("width"), 1, width, "ROI width")
    rh = integer(roi.get("height"), 1, height, "ROI height")
    integer(roi.get("x"), 0, width - rw, "ROI x")
    integer(roi.get("y"), 0, height - rh, "ROI y")
    pixels = rw * rh
    source_bytes = integer(request.get("sourceBytes"), pixels * 4, pixels * 4, "source length")
    mask_bytes = 0 if task == "parse" else pixels * 4
    require(request.get("maskBytes") == mask_bytes and len(payload) == source_bytes + mask_bytes and len(payload) <= max_payload,
            "INVALID_INPUT", "RGBA/mask payload does not match original ROI dimensions.")
    require(type(request.get("jobId")) is str and 0 < len(request["jobId"]) <= 256, "INVALID_INPUT", "Job ID is required.")
    selection = request.get("selection")
    if task == "parse":
        require(type(selection) is dict and selection.get("kind") in ("detected-face", "user-face-roi") and
                all(type(selection.get(key)) is str and 0 < len(selection[key]) <= 128 and selection[key].strip() == selection[key] for key in ("faceId", "revision")),
                "INVALID_INPUT", "Parsing requires an explicit face selection and revision.")
    assets = verify_assets(manifest)
    local_probe = runtime_probe(manifest.get("requiredPackages", []))
    require(all(local_probe["packages"].values()), "RUNTIME_UNAVAILABLE", "Required approved runtime packages are missing.")
    selected_device = next((d for d in local_probe["devices"] if d["kind"] == model["device"]["kind"]), None)
    require(selected_device and selected_device["available"] and selected_device["name"] == model["device"].get("name"),
            "DEVICE_UNAVAILABLE", "Selected device is unavailable or changed; no device fallback was used.")
    model_request = {"jobId": request["jobId"], "task": task, "model": model, "roi": roi, "originalSize": size,
                     "source": {"width": rw, "height": rh, "data": payload[:source_bytes]},
                     "mask": None if task == "parse" else {"width": rw, "height": rh, "data": floats_le(payload[source_bytes:])},
                     "selection": selection, "assets": assets, "config": manifest["config"]}
    # Only reached after the trusted execution gate and pinned asset checks. All adapter prints go to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        adapter = importlib.import_module(ADAPTER_MODULES[manifest["adapter"]])
        require(callable(getattr(adapter, "infer", None)), "ADAPTER_UNAVAILABLE", "Local adapter has no inference implementation.")
        result = adapter.infer(model_request)
    require(type(result) is dict and result.get("width") == rw and result.get("height") == rh and type(result.get("data")) is bytes,
            "INVALID_OUTPUT", "Adapter must return bytes at the exact original ROI dimensions.")
    data = result["data"]
    require(len(data) <= max_payload, "PAYLOAD_TOO_LARGE", "Adapter result exceeds transport capacity.")
    kind = "parsing" if task == "parse" else "matte" if task == "matting" else "image"
    require(result.get("kind") == kind, "INVALID_OUTPUT", "Adapter returned an incompatible result kind.")
    response = {"ok": True, "kind": kind, "width": rw, "height": rh,
                "provenance": {"jobId": request["jobId"], "task": task, "modelId": model["id"], "modelVersion": model["version"],
                               "weightsSha256": model["weightsSha256"], "kind": model["kind"], "device": model["device"],
                               "executionProfile": execution_profile(manifest)}}
    if kind == "parsing":
        response["provenance"]["selection"] = selection
        classes = result.get("classes")
        require(type(classes) is list and 0 < len(classes) <= 64 and all(type(c) is str and 0 < len(c) <= 256 for c in classes) and len(set(classes)) == len(classes),
                "INVALID_OUTPUT", "Parsing must declare unique class labels.")
        require(len(data) == pixels * len(classes) * 4, "INVALID_OUTPUT", "Parsing probability planes have incorrect size.")
        floats_le(data)
        response["classes"] = classes
    elif kind == "matte":
        require(len(data) == pixels * 4, "INVALID_OUTPUT", "Matte dimensions are invalid.")
        alpha = floats_le(data)
        if refine:
            foreground, declaration = result.get("foreground"), result.get("foregroundRefinement")
            require(type(foreground) is dict and foreground.get("width") == rw and foreground.get("height") == rh and foreground.get("format") == "rgba8" and
                    foreground.get("alphaMode") == "straight" and foreground.get("colorSpace") == "srgb" and type(foreground.get("data")) is bytes and len(foreground["data"]) == pixels * 4,
                    "INVALID_OUTPUT", "Expected a separate exact-ROI straight-sRGB foreground plane.")
            require(type(declaration) is dict and all(declaration.get(key) == value for key, value in REFINEMENT_CORE.items()) and
                    len(json.dumps(declaration, allow_nan=False).encode("utf-8")) <= 4096,
                    "INVALID_OUTPUT", "Foreground refinement provenance must identify approved classical PyMatting 1.1.16.")
            fg = foreground["data"]
            require(declaration.get("alphaDigest") == hashlib.sha256(data).hexdigest(), "INVALID_OUTPUT", "Foreground refinement was estimated from a different alpha plane.")
            require(declaration.get("sourceDigest") == hashlib.sha256(payload[:source_bytes]).hexdigest(), "INVALID_OUTPUT", "Foreground refinement was estimated from a different source image.")
            require(fg[3::4] == payload[3:source_bytes:4], "INVALID_OUTPUT", "Foreground refinement changed original alpha.")
            for i in range(pixels):
                offset = i * 4
                if payload[offset + 3] < 255 or alpha[i] == 1:
                    require(fg[offset:offset + 3] == payload[offset:offset + 3], "INVALID_OUTPUT", "Foreground refinement changed protected source RGB.")
            response["matteBytes"] = len(data)
            response["foreground"] = {"width": rw, "height": rh, "format": "rgba8", "alphaMode": "straight", "colorSpace": "srgb", "payloadBytes": len(fg)}
            response["provenance"]["foregroundRefinement"] = declaration
            require(len(data) + len(fg) <= max_payload, "PAYLOAD_TOO_LARGE", "Alpha plus foreground exceed the configured payload budget.")
            data += fg
        else:
            require("foreground" not in result and "foregroundRefinement" not in result, "INVALID_OUTPUT", "Unrequested foreground color estimation is forbidden.")
    else:
        require(len(data) == pixels * 4 and data[3::4] == payload[3:source_bytes:4], "INVALID_OUTPUT", "RGBA output size or original alpha changed.")
    if kind != "matte":
        require("foreground" not in result and "foregroundRefinement" not in result, "INVALID_OUTPUT", "Foreground refinement is not a parsing or retouch result.")
    return response, data


def main():
    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE"):
        os.environ[name] = "1"
    try:
        header, payload = read_frame(sys.stdin.buffer)
        if header.get("op") == "probe":
            require(not payload, "INVALID_INPUT", "Probe has no binary payload.")
            response, data = {"ok": True, "probe": runtime_probe(header.get("requiredPackages", []))}, b""
        elif header.get("op") == "infer":
            response, data = infer(header, payload)
        else:
            raise ProtocolError("PROTOCOL_ERROR", "Unknown worker operation.")
        write_frame(sys.stdout.buffer, response, data)
    except Exception as exc:
        code = exc.code if isinstance(exc, ProtocolError) else "INFERENCE_FAILED"
        # No traceback, photo bytes, environment, credentials or speculative fallback response.
        message = str(exc)[:1024] if isinstance(exc, ProtocolError) else "Local adapter failed; no fallback result was generated."
        write_frame(sys.stdout.buffer, {"ok": False, "error": {"code": code, "message": message}})


if __name__ == "__main__":
    main()
