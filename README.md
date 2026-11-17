# 薄荷人像 Desktop

Windows 桌面人像修图软件，当前公开的是 **0.2.9 未签名开发候选版的恢复源码与便携快照**。这是独立的 Electron 桌面项目；安卓版「薄荷修图」位于 [shiyan688/mint-photo](https://github.com/shiyan688/mint-photo)。

## 下载与使用

到 [Releases](https://github.com/shiyan688/mint-portrait-desktop/releases) 下载 Windows x64 便携 ZIP，完整解压到可写目录后运行 `MintPortrait.exe`。本次发布对应已安装桌面程序的文件快照，原安装器不随此次发布；无需覆盖现有安装目录。请先用照片副本测试。

版本号仍为 0.2.9。它是开发候选版，未签名；本次上传没有完成新的 Windows 安装、性能或修图质量验收，也不代表已达到商业精修产品水平。历史文档中的测试记录属于当时环境，不能当作本次重新通过的结果。

## 已有功能范围

- 本地 JPEG、PNG、WebP 导入；PNG / JPEG 导出，保留原始照片。
- 基础调色、明暗/白平衡、色阶、曲线/HSL、局部调整及可撤销编辑。
- 本地关键点辅助的人像调整、逐人选择、传统修肤/塑形与手动修复。
- 裁切、旋转、调平、四角透视、留白、文字、图片贴图、绘画和遮盖。
- 选片标记、参数同步、工程保存与可选的本地恢复草稿。

传统修肤和分割在复杂发丝、持物、饰品及不同肤色上仍有局限。输出为 8 位 sRGB，不是完整 RAW / 16 位工作流。研究用后端适配代码不表示模型、Python 环境或联网生成服务已随程序提供；没有在本次上传中新增这些能力。

## 源码来源

本仓库由现有 0.2.9 源码检查点恢复。64 个应用源码文件与已安装程序逐字节一致；`src/index.html` 采用当前安装版，另加入安装版的 `src/ui-shell.js` 和 `src/ui-shell.css`。开发用 `package.json` 和锁文件保留源码检查点中的版本，以恢复开发命令。具体散列和遗漏清单见 [上传溯源记录](docs/UPLOAD-PROVENANCE.json)。

包含源码、开发工具、测试代码及已安装程序自带的离线 MediaPipe 资源；不包含个人照片、用户工程、AppData、依赖目录和原始运行日志。部分历史 QA 素材属于外部资料库且没有出现在源档案中，完整历史测试可能因此缺少夹具；本次实际检查结果见 [上传验证记录](docs/UPLOAD-VALIDATION.md)。

## 本地开发

```sh
npm ci
npm start
```

依赖版本按现有锁文件固定，包括 Electron 45.0.0、MediaPipe Tasks Vision 1.1.1 和 Sharp 0.35.5。本仓库保留的是历史快照，未在上传时升级依赖。`npm ci` 会执行依赖的安装步骤和下载 Electron；开发者应使用适合自己环境的 Node.js 与 Windows x64 环境。

`npm test` 是原检查点的完整测试入口；部分历史素材没有包含，不能保证该入口在全新环境中全部通过。`npm run build:win` 为原打包脚本，还依赖文档描述的 Windows 原生依赖准备步骤，不等同于本次已重新构建了安装器。

## 许可

原项目 `package.json` 标记为 `UNLICENSED`，此次公开源码没有另行授予 MIT、Apache 或其他开源许可。第三方运行库和模型按其各自许可证提供，见 [许可说明](LICENSE-NOTICE.md)。
