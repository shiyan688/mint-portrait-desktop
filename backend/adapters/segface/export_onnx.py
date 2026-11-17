"""Opt-in offline fixed-shape ONNX export/parity harness. Never run on import.

Requires separate execution approval, local hash-pinned source/checkpoint, and
installed official torch/torchvision/numpy/Pillow/onnx/onnxruntime packages.
This uses synthetic input only, not private portraits. Does not install/download.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

if __package__:
    from .adapter import _MANIFEST, _load_network, SegFaceError
else:
    # Resolve only our own adapter, not a user-selected Python module.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from segface.adapter import _MANIFEST, _load_network, SegFaceError


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-dir', required=True)
    p.add_argument('--checkpoint', required=True)
    p.add_argument('--variant', choices=('mobilenet', 'swin_base'), default='mobilenet')
    p.add_argument('--output', required=True)
    p.add_argument('--execution-approved', action='store_true', help='Host guard only, not proof of consent')
    args = p.parse_args(argv)
    if not args.execution_approved:
        p.error('separate research-code/model execution approval is required')
    out = Path(args.output).resolve()
    if out.exists() or out.with_suffix(out.suffix + '.json').exists():
        p.error('refusing to overwrite existing export or manifest')
    # Heavy runtime imports happen only after the explicit guard.
    import numpy as np
    import torch
    import torch.nn.functional as F
    import onnx
    import onnxruntime as ort
    asset = _MANIFEST['weights']['variants'][args.variant]
    request = {'assets': {'checkpoint': str(Path(args.checkpoint).resolve())},
               'config': {'sourceDir': str(Path(args.source_dir).resolve()), 'executionApproved': True}}
    model = _load_network(request, args.variant, asset, 'cpu')

    class Logits(torch.nn.Module):
        def __init__(self, source):
            super().__init__()
            self.source = source
        def forward(self, image):
            return F.interpolate(self.source(image, None, None), size=(512, 512), mode='bilinear', align_corners=False)

    wrapped = Logits(model).eval()
    torch.manual_seed(0)
    fixtures = [torch.zeros(1, 3, 512, 512), torch.rand(1, 3, 512, 512) * 2 - 1]
    out.parent.mkdir(parents=True, exist_ok=True)
    with torch.inference_mode():
        torch.onnx.export(wrapped, fixtures[0], str(out), input_names=['image'],
                          output_names=['logits'], opset_version=17, dynamo=False)
    # ONNX checker/parity are required, not an optional claim based on export success.
    onnx.checker.check_model(str(out))
    session = ort.InferenceSession(str(out), providers=['CPUExecutionProvider'])
    results = []
    for fixture in fixtures:
        with torch.inference_mode():
            expected = wrapped(fixture).cpu().numpy()
        actual = session.run(['logits'], {'image': fixture.numpy()})[0]
        if actual.shape != expected.shape or not np.isfinite(actual).all():
            raise SegFaceError('EXPORT_PARITY_FAILED', 'Nonfinite or incorrectly shaped ONNX output')
        delta = np.abs(actual - expected)
        record = {'maxAbsoluteError': float(delta.max()), 'meanAbsoluteError': float(delta.mean()),
                  'argmaxAgreement': float(np.mean(actual.argmax(1) == expected.argmax(1)))}
        results.append(record)
        if record['maxAbsoluteError'] > 5e-4 or record['meanAbsoluteError'] > 1e-5:
            raise SegFaceError('EXPORT_PARITY_FAILED', 'Synthetic logits differ beyond the preregistered tolerance')
    metadata = {'schemaVersion': 1, 'status': 'synthetic-parity-only', 'variant': args.variant,
                'codeRevision': _MANIFEST['code']['revision'], 'sourceWeightsSha256': asset['sha256'],
                'onnx': {'file': out.name, 'bytes': out.stat().st_size,
                         'sha256': hashlib.sha256(out.read_bytes()).hexdigest()},
                'input': _MANIFEST['input'], 'classes': _MANIFEST['classes'], 'opset': 17,
                'runtime': {'torch': torch.__version__, 'onnx': onnx.__version__, 'onnxruntime': ort.__version__},
                'syntheticParity': results, 'visualQualityValidated': False, 'webgpuValidated': False}
    out.with_suffix(out.suffix + '.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf8')
    print(json.dumps(metadata))


if __name__ == '__main__':
    main()
