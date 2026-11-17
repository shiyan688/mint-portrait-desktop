---
license: mit
language:
- en
---

# <i>SegFace</i> Model Card

<div align="center">

[**Project Page**](https://kartik-3004.github.io/SegFace/) **|** [**Paper (ArXiv)**](https://arxiv.org/abs/2412.08647) **|** [**Code**](https://github.com/Kartik-3004/SegFace)


</div>

## Introduction

The key contributions of our work are,
1. We introduce a lightweight transformer decoder with learnable class-specific tokens, that ensures each token is dedicated to a specific class, thereby enabling independent modeling of classes. The design effectively addresses the challenge of poor segmentation performance of long-tail classes, prevalent in existing methods. 
2. Our multi-scale feature extraction and MLP fusion strategy, combined with a transformer decoder that leverages learnable class-specific tokens, mitigates the dominance of head classes during training and enhances the feature representation of long-tail classes. 
3. <i>SegFace</i> establishes a new state-of-the-art performance on the LaPa dataset (93.03 mean F1 score) and the CelebAMask-HQ dataset (88.96 mean F1 score). Moreover, our model can be adapted for fast inference by simply swapping the backbone with a MobileNetV3 backbone. The mobile version achieves a mean F1 score of 87.91 on the CelebAMask-HQ dataset with 95.96 FPS.



## Training Framework
<div  align="center">
<img src='assets/segface.png'>
</div>

The proposed architecture, <i>SegFace</i>, addresses face segmentation by enhancing the performance on long-tail classes through a transformer-based approach. Specifically, multi-scale features are first extracted from an image encoder and then fused using an MLP fusion module to form face tokens. These tokens, along with class-specific tokens, undergo self-attention, face-to-token, and token-to-face cross-attention operations, refining both class and face tokens to enhance class-specific features. Finally, the upscaled face tokens and learned class tokens are combined to produce segmentation maps for each facial region.



## Usage

The trained weights can be downloaded directly from this repository or using python:
```python
from huggingface_hub import hf_hub_download

# The filename "convnext_celeba_512" indicates that the model has a convnext bakcbone and trained
# on celeba dataset at 512 resolution.
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="convnext_celeba_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="efficientnet_celeba_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="mobilenet_celeba_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="resnet_celeba_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_celeba_224/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_celeba_256/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_celeba_448/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_celeba_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_lapa_224/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_lapa_256/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_lapa_448/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_lapa_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinv2b_celeba_512/model_299.pt", local_dir="./weights")
hf_hub_download(repo_id="kartiknarayan/SegFace", filename="swinb_helen_512/model_299.pt", local_dir="./weights")
```

## Citation
```bibtex
@inproceedings{narayan2025segface,
  title={Segface: Face segmentation of long-tail classes},
  author={Narayan, Kartik and Vs, Vibashan and Patel, Vishal M},
  booktitle={Proceedings of the AAAI Conference on Artificial Intelligence},
  volume={39},
  number={6},
  pages={6182--6190},
  year={2025}
}
```

Please check our [GitHub repository](https://github.com/Kartik-3004/SegFace) for complete instructions.