# 许可说明

应用自有源码沿用原项目的 `UNLICENSED` 标记。公开可读不代表已授予自由使用、修改或再分发的开源许可；本次没有替项目所有者新增许可条款。

第三方内容不受上述自有源码标记替代：

- Electron 45.0.0：MIT；便携包根目录保留 `LICENSE` 和 `LICENSES.chromium.html`。
- MediaPipe Tasks Vision 1.1.1、Face Landmarker 和 Selfie Segmenter：保留原包的来源、散列及 Apache 2.0 许可文件，见 `assets/licenses/`、`docs/offline-assets.json`。
- Sharp 0.35.5 及 libvips 等依赖：运行包保留 `resources/app.asar` 与 `resources/app.asar.unpacked` 中依赖的原始许可、版权声明及第三方声明。

研究后端目录只包含代码及模型描述；未额外打包 SegFace、BiRefNet、Stable Diffusion 等权重。各权重的使用和分发条件不能从本仓库代码的可见性推定。
