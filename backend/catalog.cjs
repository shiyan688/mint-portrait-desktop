'use strict';
const path = require('node:path');
// Trusted application catalogue. Not loaded from a renderer or user plugin.
// SegFace is approved for personal local parsing; this is not a retouch model.
function manifestsFor(backendRoot) {
 const modelRoot = path.join(backendRoot, 'models', 'segface-mobilenet-celeba-512');
 const parser = {
  "id": "segface-mobilenet-celeba-512",
  "version": "9416628e-7c6077ee",
  "kind": "model",
  "adapter": "segface",
  "tasks": [
    "parse"
  ],
  "weightsAsset": "checkpoint",
  "weightsSha256": "4d67ea7d8c33849272b293b421fa3d20d54d9987f1bca8c1ef0eebe4534993e8",
  "assets": [
    {
      "name": "checkpoint",
      "relativePath": "model_299.pt",
      "sha256": "4d67ea7d8c33849272b293b421fa3d20d54d9987f1bca8c1ef0eebe4534993e8"
    },
    {
      "name": "segface_celeb",
      "relativePath": "source/network/models/segface_celeb.py",
      "sha256": "9258ad3e8f102dfb4d0cbbd4bc41b83f5eeaa011a79c71c001355b3d107f33c4"
    },
    {
      "name": "transformer",
      "relativePath": "source/network/models/transformer.py",
      "sha256": "df8ac36e5bd9d367837efc3012b9c2e675b75ab6983a2ea25e2a85dba6d0b237"
    }
  ],
  "devices": [
    "cpu",
    "cuda"
  ],
  "license": {
    "id": "MIT; retained upstream notices",
    "url": "https://huggingface.co/kartiknarayan/SegFace/blob/5e093b03c0523f7f32a9845bbbc75ecb027c8bee/README.md",
    "status": "approved"
  },
  "requiredPackages": [
    "torch",
    "torchvision",
    "numpy",
    "Pillow"
  ],
  "enabled": true,
  "config": {
    "executionApproved": true,
    "variant": "mobilenet",
    "roiPolicy": "explicit-face-roi",
    "threads": 2
  }
};
 parser.modelRoot = modelRoot; parser.config.sourceDir = path.join(modelRoot, 'source');
 parser.qualityStatus = 'experimental';
 const matte = {
  "id": "ZhengPeng7/BiRefNet_HR-matting",
  "version": "5d6b6f8adcb5b417c871b1d84ceaae9871355b7f",
  "kind": "model",
  "adapter": "birefnet",
  "tasks": [
    "matting"
  ],
  "weightsAsset": "weights",
  "weightsSha256": "a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55",
  "assets": [
    {
      "name": "weights",
      "relativePath": "model.safetensors",
      "sha256": "a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55"
    },
    {
      "name": "birefnetCode",
      "relativePath": "birefnet.py",
      "sha256": "2a45b4e0ece72d7c4212bca1a988e7d7e52bfe9f98ec59c58b8809c8a8b7a831"
    },
    {
      "name": "birefnetConfig",
      "relativePath": "BiRefNet_config.py",
      "sha256": "e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52"
    },
    {
      "name": "modelConfig",
      "relativePath": "config.json",
      "sha256": "d0b779ee9a76bf079673c5852c346f439591f016ca0d778a87bbd1dcbe24398a"
    },
    {
      "name": "license",
      "relativePath": "LICENSE-BiRefNet.txt",
      "sha256": "92a7089e0915fc32bc40067560b398f1e6a7a5958abd7d04eda393629a5acefb"
    }
  ],
  "devices": [
    "cpu",
    "cuda"
  ],
  "license": {
    "id": "MIT",
    "url": "https://github.com/ZhengPeng7/BiRefNet/blob/97e4f35d74043427b0e9ba935ca10991853a36bc/LICENSE",
    "status": "approved"
  },
  "requiredPackages": [
    "torch",
    "torchvision",
    "numpy",
    "Pillow",
    "timm",
    "transformers",
    "kornia",
    "einops",
    "safetensors"
  ],
  "enabled": false,
  "config": {
    "executionApproved": true,
    "modelRevision": "5d6b6f8adcb5b417c871b1d84ceaae9871355b7f",
    "inputSize": 2048,
    "precision": "bfloat16",
    "threads": 4,
    "foregroundRefinement": false
  },
  "qualityStatus": "blocked",
  "disabledReason": "复杂衣物误删/发缘灰雾，尚未通过质量验收"
};
 matte.modelRoot = path.join(backendRoot, 'models', 'birefnet-hr-matting');
 matte.config.sourceDir = matte.modelRoot;
 return [parser, matte];
}
module.exports = { manifestsFor };
