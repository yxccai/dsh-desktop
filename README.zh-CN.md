# DSH Desktop

<p align="center">
  <img src="docs/images/social-preview.jpg" alt="DSH Desktop——探索未至之境" width="100%">
</p>

[English](README.md) | 简体中文

一个基于 DeepSeek Harness 的非官方开源桌面端，提供更简单、直观的桌面使用体验。

## 三大核心优势

### 一、真正的官方 Web 外壳——安全、完整、可持续

DSH Desktop 不是重新实现的桌面端，而是把官方 DSH Web 完整装进原生窗口。这一个决定带来三重价值：

- **功能完全一致**：直接继承官方 Web 的全部功能、插件、会话和工作区数据。不存在"桌面版缺功能"的问题，因为桌面端本身就是官方 Web。
- **结构安全隔离**：网页永远不直接获得 Node.js、文件系统或任意命令权限。通过 Electron 沙箱 + contextIsolation + 精确的 loopback 来源导航限制 + 白名单 IPC 实现。安全是架构的一部分，不是后来打补丁。
- **升级零重写**：官方 DSH 发布新版本时，桌面端只需改版本号重新打包——零自定义代码重写、零 API 不兼容。已有的 `DSH_HOME`、会话、Agent Preset 和持久化插件全部自动保留。

### 二、基础版保持简洁——只加两项真正有用的桌面增强

不塞满半用不上的功能，保留官方 Web 的简洁体验，只在桌面场景补上最常被需要的两项：

- **项目面板**（对话右侧，与聊天并排）：每轮回复自动列出本次实际修改或生成的文件。多标签预览支持 Markdown、HTML、代码、Diff、CSV、PDF、图片和文本，可分屏编辑并进行带冲突检测的原子保存。Git 工作区显示真实状态、Diff 和单文件撤销；非 Git 目录则使用内容 Blob 快照（不执行 `git init`、不污染项目目录）。每次回复自动记录可恢复的快照，恢复前会自动保存当前状态为恢复点。
- **内置插件**（开箱即用的官方精选能力）：多套配色主题（深海渐变蓝、极光绿紫、玫瑰落日粉、暖沙琥珀，支持明暗切换）、自定义图片背景（原生文件选择、透明度调节、随时停用），以及轻量桌面写作助手（写作、改写、总结、翻译 Agent）。没有堆砌多余功能，只把最常用、最值得做成桌面增强的内容做好。

### 三、可扩展、可创造——简洁的底座，够高的天花板

基础版轻量，但扩展能力直接可用：

- **内置插件持续上新**：官方精选插件以事务式方式交付，带 Digest 校验，可安装、停用、卸载，不覆盖用户内容，也不污染 `profiles/web`。
- **社区插件市场直接可用**：内置固定版本的 MIT 市场组件（`@sanqi-normal/dsh-webui-market-plugin`），挂载到共享的 `DSH_HOME` 后，Web 界面即可获得「设置 → 插件 → 插件市场」入口，浏览 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/) 的数百个社区插件，一键安装、更新、卸载。应用内置 `pnpm`，无需全局安装。桌面端和浏览器版共享同一 `DSH_HOME`，两边安装的插件互通生效。
- **一句话总结**：今天简洁好用，明天随官方插件生态、社区市场和持续更新的内置插件一起成长。

## 下载

请从 [GitHub Releases](https://github.com/yxccai/dsh-desktop/releases/tag/v0.5.0) 下载：

- [Windows x64 安装版](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/DSH-Desktop-Setup-0.5.0-win-x64.exe)
- [Windows x64 便携版](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/DSH-Desktop-Portable-0.5.0-win-x64.exe)
- [SHA-256 校验文件](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/SHA256SUMS-0.5.0.txt)

### macOS 测试版

- [macOS 预发布版（Intel / Apple Silicon）](https://github.com/yxccai/dsh-desktop/releases/tag/v0.5.0)

首次启动时，请在 Finder 中按住 Control 点击应用并选择「打开」；若 macOS 仍阻止运行，请前往「系统设置 → 隐私与安全性 → 仍要打开」。正式签名与公证将在后续版本加入。

## 界面截图

### 对话文件与项目预览面板

![支持完整上下文变更的项目面板](docs/images/project-panel.png)

### 对话快照与单文件回原

![对话快照和回原控制](docs/images/conversation-snapshots.png)

### 可管理的插件中心

![DSH Desktop 插件中心](docs/images/plugin-center.png)

## 工作方式

DSH Desktop 会自动选择可用环境：

1. 连接已运行的 DSH；
2. 复用全局 `dsh`；
3. 复用系统 `npx/npm`；
4. 使用应用内置的 DSH Runtime。

已有用户通常可以继续使用原来的 `DSH_HOME`、会话、Agent Preset 和持久化插件；新用户无需预先安装 DSH 或 Node.js。

## 项目面板

项目会话会在每次回复下方显示本次对话实际修改或生成的文件；点击文件名后在右侧以多标签打开，标签顶部显示文件名并可用 `×` 关闭。预览支持 Markdown、HTML、代码、Diff、CSV、PDF、图片和文本，以及源码/预览切换、分屏编辑和带外部修改检测的原子保存；面板打开时聊天区会同步缩窄，不会被遮挡。“变更”页提供真实 Git 状态、Diff 和单文件撤销。面板宽度、折叠状态和当前页面均按项目保存。

每次助手回复完成后，Git 项目会通过独立临时索引记录可恢复的 Tree 快照，不会改动用户暂存区；普通非 Git 目录则使用 DSH Desktop 数据目录中的内容 Blob 快照，不会执行 `git init` 或污染项目目录。两种模式都会在恢复前自动保存当前状态作为恢复点。Office 文件目前使用系统应用打开，后续再增加 DOCX/XLSX/PPTX 内置渲染。

## Web 插件市场（可选）

DSH Desktop 内置社区插件市场 [`@sanqi-normal/dsh-webui-market-plugin`](https://github.com/Sanqi-normal/dsh-webui-market-plugin)（MIT，vendored 于 `resources/market-plugin`），可按需挂载到共享的 `DSH_HOME`，让 DSH Web 界面获得「设置 → 插件 → 插件市场」入口：浏览 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/) 社区目录，把插件安装/卸载到 web profile。

- **两个管理入口**：桌面插件中心窗口的「Web 插件市场」页，以及 Web 设置桥的「内置插件」页卡片。安装 / 启用 / 停用 / 卸载都是互斥的事务操作，作用于 `$DSH_HOME/cordis.patch.yml` 与 `$DSH_HOME/node_modules/@sanqi-normal/dsh-webui-market-plugin`；`$DSH_HOME/profiles/web` 永不被修改。
- **无需全局安装 pnpm**：应用内置 pnpm 并生成 PATH 垫片（`src/pnpm-runtime.js`），随每个 DSH 进程继承，因此 Windows 上即使从未全局安装 pnpm（npx / global / bundled 启动方式），市场安装也能正常执行；手动在终端启动的 DSH 服务也会自动回退到 `$DSH_HOME/bin` 下的内置 pnpm。若 pnpm 确实不可用，市场会给出清晰的中文提示，而不是一堆乱码。
- **自动处理常见安装问题**：git 依赖的构建脚本自动放行（`dangerously-allow-all-builds`）；迁移过的 profile 自动沿用原 pnpm store（`npm_config_store_dir`）；锁文件缺少 tarball 完整性校验（旧版 pnpm 生成的裸 GitHub URL 条目）时自动改写为 `github:` 语法并重试一次。
- **第三方风险提示**：市场中的插件由社区作者编写，安装后会在 DSH 进程内以宿主权限运行（文件、网络、命令行）。请只安装你信任的来源。桌面应用内置的是固定版本并校验包完整性，拒绝操作外来或已被篡改的内容，但对第三方插件的行为不承担任何责任。
- **需要重启**：变更在 DSH web 服务重启后生效，当前运行的会话不会被中断。
- 来源与复现说明见 `resources/market-plugin/VENDORED.md`：Host 半端是上游副本加上 DSH Desktop 的两处可移植性补丁（内置 pnpm 的 PATH 垫片、人性化的 pnpm 缺失报错），Client 半端是独立重设计的原创 UI（MIT）。

## 插件兼容

遵循官方 DSH/Cordis 接口的 Host 插件、Slot UI、主题和持久化 Preset 通常具有较好的兼容性。依赖固定 DOM、浏览器扩展或开发 HMR 的插件需要单独测试。

## 平台支持

- **Windows x64**：安装版和便携版已发布并验证。
- **macOS Intel / Apple Silicon**：已提供未签名测试版预发布包。首次启动时请在 Finder 中按住 Control 点击应用，选择“打开”；如果 macOS 仍然阻止运行，请前往“系统设置 → 隐私与安全性 → 仍要打开”。正式签名和公证将在后续加入。
- 其他平台将在后续版本中评估。

## 开发

```powershell
npm ci
npm run check
npm test
npm start
```

更多信息：

- [更新记录](CHANGELOG.md)
- [安全说明](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [Runtime 说明](docs/runtime-provisioning.md)

## 许可证

本项目采用 [MIT License](LICENSE)。DeepSeek Harness、Electron 及其他依赖遵循各自许可证。
