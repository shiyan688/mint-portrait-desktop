"""Hash-pinned SegFace parsing adapter. Import/probe are stdlib-only.

This is an analysis backend, not a retouching model. Real execution requires
separate user approval and trusted host configuration; the flag below is only
a fail-closed application guard, not evidence of consent or a security sandbox.
"""
from .adapter import SegFaceError, infer, probe, close

__all__ = ['SegFaceError', 'infer', 'probe', 'close']
