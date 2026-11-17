"""Independent application wrapper; no third-party model source is bundled."""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import sys
import threading
import types

_MANIFEST = json.loads(Path(__file__).with_name('manifest.json').read_text(encoding='utf8'))
CLASSES = tuple(_MANIFEST['classes'])
_CACHE = {}
_LOCK = threading.RLock()
_INTEROP_ATTEMPTED = False


class SegFaceError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def _fail(code, message):
    raise SegFaceError(code, message)


def _variant(config):
    variant = config.get('variant', 'mobilenet')
    if variant not in _MANIFEST['weights']['variants']:
        _fail('UNSUPPORTED_VARIANT', 'Only pinned CelebAMask-HQ MobileNet and Swin-B are supported.')
    return variant, _MANIFEST['weights']['variants'][variant]


def probe(manifest=None):
    """Metadata only: never imports torch/torchvision or reads checkpoint contents."""
    manifest = manifest or {}
    config = manifest.get('config', {})
    variant, asset = _variant(config)
    return {
        'adapter': 'segface', 'task': 'parse', 'status': 'not_validated',
        'variant': variant, 'classes': list(CLASSES),
        'codeRevision': _MANIFEST['code']['revision'],
        'weightsRevision': _MANIFEST['weights']['revision'],
        'expectedBytes': asset['bytes'], 'weightsSha256': asset['sha256'],
        'dependenciesPresent': {name: importlib.util.find_spec(name) is not None
                                for name in ('torch', 'torchvision', 'numpy', 'PIL')},
        'executionApproved': config.get('executionApproved') is True,
        'maxRoiPixels': _MANIFEST['maxRoiPixels'],
        'requires': ['explicit face ROI', 'opaque straight-alpha sRGB RGBA8',
                     'hash-pinned local checkpoint and reviewed source', 'separate execution approval'],
    }


def verify_file(path, expected, *, max_bytes=None):
    """Read and hash an existing regular local file, without deserializing it."""
    p = Path(path)
    if not p.is_file() or p.is_symlink():
        _fail('MISSING_ASSET', 'Expected a regular, non-symlink local asset.')
    size = p.stat().st_size
    if size != expected['bytes'] or (max_bytes is not None and size > max_bytes):
        _fail('ASSET_SIZE_MISMATCH', 'Asset byte count differs from the pinned source.')
    h = hashlib.sha256()
    with p.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    if h.hexdigest() != expected['sha256']:
        _fail('ASSET_HASH_MISMATCH', 'Asset SHA-256 differs from the pinned source.')
    return p.resolve()


def _positive_int(value, name):
    if type(value) is not int or value <= 0:
        _fail('INVALID_INPUT', name + ' must be a positive integer.')
    return value


def validate_request(request):
    if not isinstance(request, dict) or request.get('task') != 'parse':
        _fail('INVALID_TASK', 'SegFace supports parsing analysis only.')
    config = request.get('config', {})
    if not isinstance(config, dict):
        _fail('INVALID_INPUT', 'config must be trusted host configuration.')
    if config.get('executionApproved') is not True:
        _fail('EXECUTION_NOT_APPROVED', 'Research-code/model execution has not been enabled by the trusted host.')
    threads = config.get('threads', 2)
    if type(threads) is not int or not 1 <= threads <= 8:
        _fail('INVALID_CONFIG', 'Trusted CPU thread count must be an integer from 1 to 8.')
    variant, asset = _variant(config)
    source, roi, original = (request.get(k, {}) for k in ('source', 'roi', 'originalSize'))
    if any(not isinstance(value, dict) for value in (source, roi, original)):
        _fail('INVALID_INPUT', 'Source, ROI and originalSize must be explicit objects.')
    selection = request.get('selection', {})
    if (not isinstance(selection, dict) or selection.get('kind') not in ('detected-face', 'user-face-roi') or
            any(not isinstance(selection.get(k), str) or not selection[k] or len(selection[k]) > 256
                for k in ('faceId', 'revision'))):
        _fail('FACE_SELECTION_REQUIRED', 'An explicit detected-face or user-face-roi selection is required.')
    w = _positive_int(source.get('width'), 'source.width')
    h = _positive_int(source.get('height'), 'source.height')
    if w * h > _MANIFEST['maxRoiPixels']:
        _fail('ROI_TOO_LARGE', '19-channel parsing output exceeds the tested application memory budget.')
    if roi.get('width') != w or roi.get('height') != h:
        _fail('INVALID_ROI', 'Source dimensions must equal original-pixel ROI dimensions.')
    ow = _positive_int(original.get('width'), 'originalSize.width')
    oh = _positive_int(original.get('height'), 'originalSize.height')
    if any(type(roi.get(k)) is not int or roi[k] < 0 for k in ('x', 'y')):
        _fail('INVALID_ROI', 'ROI coordinates must be nonnegative integers.')
    if roi['x'] + w > ow or roi['y'] + h > oh:
        _fail('INVALID_ROI', 'ROI exceeds the original image.')
    raw = source.get('data')
    if not isinstance(raw, (bytes, bytearray)) or len(raw) != w * h * 4:
        _fail('INVALID_INPUT', 'Source must contain exact-size RGBA8 bytes.')
    if any(alpha != 255 for alpha in raw[3::4]):
        _fail('UNSUPPORTED_ALPHA', 'This parser currently requires an opaque crop; no hidden RGB interpretation is performed.')
    if request.get('mask') is not None:
        _fail('INVALID_INPUT', 'Parsing does not accept an edit mask.')
    model = request.get('model', {})
    if not isinstance(model, dict):
        _fail('INVALID_INPUT', 'Model descriptor must be an explicit object.')
    if model.get('weightsSha256') != asset['sha256']:
        _fail('MODEL_MISMATCH', 'Selected model digest does not match the variant.')
    device = model.get('device', {})
    kind = device.get('kind') if isinstance(device, dict) else device
    if kind not in ('cpu', 'cuda'):
        _fail('UNSUPPORTED_DEVICE', 'Only explicitly selected cpu or cuda is supported; no automatic fallback.')
    assets = request.get('assets', {})
    if not isinstance(assets, dict) or not assets.get('checkpoint') or not config.get('sourceDir'):
        _fail('MISSING_ASSET', 'Local checkpoint and reviewed sourceDir are required.')
    return variant, asset, w, h, bytes(raw), kind


class _OfflinePatch(ast.NodeTransformer):
    """Narrow reviewed transformation of one exact-hash upstream source file."""
    def __init__(self):
        self.removed_imports = 0
        self.removed_paths = 0
        self.disabled_initializers = 0

    def visit_ImportFrom(self, node):
        if node.module in ('network.models.transformer', 'network.models.utils_models'):
            self.removed_imports += 1
            return None
        return node

    def visit_Expr(self, node):
        call = node.value
        if isinstance(call, ast.Call) and ast.unparse(call.func) == 'sys.path.insert':
            self.removed_paths += 1
            return None
        return self.generic_visit(node)

    def visit_Call(self, node):
        self.generic_visit(node)
        factories = {'swin_b', 'swin_v2_b', 'swin_v2_s', 'swin_v2_t',
                     'convnext_base', 'convnext_small', 'mobilenet_v3_large',
                     'efficientnet_v2_m', 'models.resnet101'}
        if ast.unparse(node.func) in factories:
            for keyword in node.keywords:
                if keyword.arg in ('pretrained', 'weights'):
                    keyword.arg = 'weights'
                    keyword.value = ast.Constant(value=None)
                    self.disabled_initializers += 1
        return node


def patched_network_ast(source):
    tree = ast.parse(source)
    patch = _OfflinePatch()
    tree = patch.visit(tree)
    if (patch.removed_imports, patch.removed_paths, patch.disabled_initializers) != (2, 1, 10):
        _fail('SOURCE_PATCH_MISMATCH', 'Reviewed source transformation no longer matches expectations.')
    return ast.fix_missing_locations(tree)


def _verified_source_bytes(source_dir, relative):
    root = Path(source_dir).resolve()
    p = root / relative
    if not p.resolve().is_relative_to(root):
        _fail('INVALID_ASSET_PATH', 'Source path escapes its reviewed root.')
    expected = _MANIFEST['code']['files'][relative]
    verify_file(p, expected, max_bytes=100000)
    # Read again and verify the same bytes that will be compiled, closing TOCTOU.
    b = p.read_bytes()
    if len(b) != expected['bytes'] or hashlib.sha256(b).hexdigest() != expected['sha256']:
        _fail('ASSET_HASH_MISMATCH', 'Source changed after verification.')
    return b


def _build_network(source_dir, variant):
    # Called only after the host approval guard. Neither upstream __init__.py,
    # dataset loader nor training/evaluation script is imported.
    transformer = _verified_source_bytes(source_dir, 'network/models/transformer.py')
    celeb = _verified_source_bytes(source_dir, 'network/models/segface_celeb.py')
    transformer_module = types.ModuleType('_mint_segface_transformer')
    sys.modules[transformer_module.__name__] = transformer_module
    exec(compile(transformer, '<verified-segface-transformer>', 'exec'), transformer_module.__dict__)
    module = types.ModuleType('_mint_segface_reviewed')
    module.__dict__.update({k: transformer_module.__dict__[k] for k in ('TwoWayTransformer', 'LayerNorm2d')})
    sys.modules[module.__name__] = module
    exec(compile(patched_network_ast(celeb), '<verified-segface-celeb-offline>', 'exec'), module.__dict__)
    return module.SegFaceCeleb(512, variant)


def extract_state_dict(checkpoint, torch):
    if not isinstance(checkpoint, dict) or 'state_dict_backbone' not in checkpoint:
        _fail('INVALID_CHECKPOINT', 'Expected the official state_dict_backbone wrapper.')
    state = checkpoint['state_dict_backbone']
    if not isinstance(state, dict) or not state:
        _fail('INVALID_CHECKPOINT', 'State dictionary is empty or malformed.')
    for name, tensor in state.items():
        if not isinstance(name, str) or not name or not torch.is_tensor(tensor):
            _fail('INVALID_CHECKPOINT', 'Only named tensors are allowed in model state.')
    return state


def _load_network(request, variant, asset, device):
    import torch
    if device == 'cuda' and not torch.cuda.is_available():
        _fail('DEVICE_UNAVAILABLE', 'CUDA was requested but is unavailable; CPU fallback is not implicit.')
    path = verify_file(request['assets']['checkpoint'], asset)
    key = (variant, str(path), str(Path(request['config']['sourceDir']).resolve()), device)
    if key in _CACHE:
        return _CACHE[key]
    model = _build_network(request['config']['sourceDir'], variant)
    # Restrict loading to tensors/primitives. Never add globals or retry with
    # weights_only=False when this fails. mmap is optional, not a safety bypass.
    try:
        with path.open('rb') as stream:
            # Hash the same open file handle before deserializing.
            if hashlib.file_digest(stream, 'sha256').hexdigest() != asset['sha256']:
                _fail('ASSET_HASH_MISMATCH', 'Checkpoint changed before loading.')
            stream.seek(0)
            checkpoint = torch.load(stream, map_location='cpu', weights_only=True)
        state = extract_state_dict(checkpoint, torch)
        model.load_state_dict(state, strict=True)
    except SegFaceError:
        raise
    except Exception as exc:
        _fail('SAFE_LOAD_FAILED', 'Restricted checkpoint loading failed; no unrestricted fallback: ' + type(exc).__name__)
    del checkpoint, state
    model.eval().to(device)
    _CACHE.clear()
    _CACHE[key] = model
    return model


def preprocess_rgba(raw, width, height):
    """Official Celeb path: RGB PIL bicubic resize, ToTensor, ImageNet normalize."""
    import numpy as np
    import torch
    from PIL import Image
    image = Image.frombytes('RGBA', (width, height), raw).convert('RGB')
    image = image.resize((512, 512), resample=Image.Resampling.BICUBIC)
    rgb = np.array(image, dtype=np.float32, copy=True) / 255.0
    tensor = torch.from_numpy(rgb.transpose(2, 0, 1).copy()).unsqueeze(0)
    mean = torch.tensor(_MANIFEST['input']['mean'], dtype=torch.float32).view(1, 3, 1, 1)
    std = torch.tensor(_MANIFEST['input']['std'], dtype=torch.float32).view(1, 3, 1, 1)
    return (tensor - mean) / std


def pack_probabilities(values, width, height):
    """Dependency-free output validation/fixture helper, channel-major float32LE."""
    pixels = _positive_int(width, 'width') * _positive_int(height, 'height')
    if len(values) != len(CLASSES) * pixels:
        _fail('INVALID_OUTPUT', 'Wrong parsing tensor length.')
    sums = [0.0] * pixels
    out = bytearray(len(values) * 4)
    for i, value in enumerate(values):
        if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            _fail('INVALID_OUTPUT', 'Probabilities must be finite and within [0,1].')
        sums[i % pixels] += value
        struct.pack_into('<f', out, i * 4, value)
    if any(abs(total - 1.0) > 1e-4 for total in sums):
        _fail('INVALID_OUTPUT', 'Class probabilities must sum to one for each pixel.')
    return bytes(out)


def infer(request):
    variant, asset, width, height, raw, device = validate_request(request)
    # The service must serialize inference or terminate the worker process on
    # cancel. Lock prevents mutable upstream forward hooks racing in-process.
    with _LOCK:
        import torch
        import torch.nn.functional as F
        import numpy as np
        _configure_threads(torch, request['config'].get('threads', 2))
        model = _load_network(request, variant, asset, device)
        tensor = preprocess_rgba(raw, width, height).to(device)
        with torch.inference_mode():
            logits = model(tensor, None, None)
            if logits.ndim != 4 or logits.shape[0] != 1 or logits.shape[1] != len(CLASSES):
                _fail('INVALID_OUTPUT', 'Model returned unexpected logits shape.')
            # Restore logits to explicit original ROI dimensions before softmax.
            # At 512-square this equals the author's evaluation postprocessing.
            logits = F.interpolate(logits, size=(height, width), mode='bilinear', align_corners=False)
            probabilities = torch.softmax(logits, dim=1)[0]
            if not torch.isfinite(probabilities).all().item():
                _fail('INVALID_OUTPUT', 'Model returned nonfinite probabilities.')
            output = probabilities.cpu().numpy().astype(np.dtype('<f4'), copy=False).tobytes(order='C')
        return {'kind': 'parsing', 'width': width, 'height': height,
                'classes': list(CLASSES), 'data': output}


def _configure_threads(torch, threads):
    """Bound intra-op work; inter-op is set once before work in a fresh worker."""
    global _INTEROP_ATTEMPTED
    torch.set_num_threads(threads)
    if not _INTEROP_ATTEMPTED:
        _INTEROP_ATTEMPTED = True
        if torch.get_num_interop_threads() != 1:
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                # Existing in-process consumers may have initialized inter-op.
                # A fresh supervised worker is the supported isolation boundary.
                pass


def close():
    with _LOCK:
        _CACHE.clear()
    # Do not import a runtime merely to clean up a metadata-only worker.
    torch = sys.modules.get('torch')
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()
