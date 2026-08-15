# DSH Desktop

[English](README.md) | 简体中文

一个基于 DeepSeek Harness 的非官方开源桌面端，提供更简单、直观的桌面使用体验。

## 项目优势

- **一键使用**：Windows 安装后即可启动，无需手动配置命令行。
- **自带运行环境**：没有 Node.js、npm、npx 或 DSH 也能运行。
- **自动继承**：如果电脑已有 DSH，会优先复用原来的数据、配置、会话和兼容插件。
- **完整 Web 功能**：直接使用原始 DSH Web，尽可能保持功能和插件兼容性。
- **安全隔离**：网页不直接获得 Node.js、文件系统或任意命令执行权限。
- **插件中心**：安装、启用、停用和管理推荐的 Agent Preset，不覆盖已有用户内容。
- **持续扩展**：后续将完善首次启动向导、自动更新、更多桌面功能和跨平台支持。

## 下载

请从 [GitHub Releases](https://github.com/yxccai/dsh-desktop/releases) 下载。

- [Windows x64 安装版](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/DSH-Desktop-Setup-0.2.0-win-x64.exe)
- [Windows x64 便携版](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/DSH-Desktop-Portable-0.2.0-win-x64.exe)
- [SHA-256 校验文件](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/SHA256SUMS-0.2.0.txt)

## 工作方式

DSH Desktop 会自动选择可用环境：

1. 连接已运行的 DSH；
2. 复用全局 `dsh`；
3. 复用系统 `npx/npm`；
4. 使用应用内置的 DSH Runtime。

已有用户通常可以继续使用原来的 `DSH_HOME`、会话、Agent Preset 和持久化插件；新用户无需预先安装 DSH 或 Node.js。

## 插件兼容

遵循官方 DSH/Cordis 接口的 Host 插件、Slot UI、主题和持久化 Preset 通常具有较好的兼容性。依赖固定 DOM、浏览器扩展或开发 HMR 的插件需要单独测试。

## 平台支持

- **Windows x64**：安装版和便携版已发布并验证。
- **macOS Intel / Apple Silicon**：构建流程已配置，等待进一步测试、签名和发布。
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
