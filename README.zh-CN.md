# DSH Desktop 0.2.0

[English](README.md) | 简体中文

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方、开源、跨平台 Electron 桌面端。

> 本项目由社区维护，与 DeepSeek 官方不存在隶属、授权或背书关系。

## 项目简介

DSH Desktop 不会重新实现或修改 DeepSeek Harness Web，而是在桌面窗口中加载原始 DSH Web，并负责检测、启动和管理本地 DSH Runtime。

它采用混合运行时策略：已有环境时优先复用，没有安装过 DSH、Node.js、npm 或 npx 时，则使用安装包内置的固定版 DSH Runtime。

## 主要功能

- Windows 一键安装版和便携版；
- 不要求新电脑预先安装 Node.js、npm、npx 或 DSH；
- 自动复用已经运行的 DSH Web；
- 自动复用全局 `dsh` 或系统 `npx`；
- 无系统环境时使用内置 `@deepseek-ai/dsh` 0.1.0-rc.6；
- 继承已有 `DSH_HOME`、会话、Agent Preset 和兼容的持久插件；
- 区分外部 DSH 进程与桌面端启动的进程，不会误杀外部服务；
- 支持托盘、单实例、日志和安全退出；
- 限制为本机 DSH 地址，并验证 DSH Bootstrap 身份；
- 已配置 macOS Intel 和 Apple Silicon 构建流程。

## 运行时选择顺序

默认 `system-first` 模式按照以下顺序工作：

1. 连接已经运行并通过身份验证的本地 DSH Web；
2. 使用系统中已有的全局 `dsh` 命令；
3. 使用系统已有的 `npx`/npm 环境及缓存；
4. 使用安装包内置的固定版 DSH Runtime。

因此：

- 已经使用过 DSH 的电脑会优先继承原有环境和数据；
- 全新电脑不需要预先安装 Node.js、npm、npx 或 DSH；
- 用户仍需配置自己的模型服务、账号或 API Key；
- 公共网络通常仍用于访问模型、安装插件和使用联网工具。

## 下载

请从 GitHub Releases 下载：

- [Windows x64 安装版](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/DSH-Desktop-Setup-0.2.0-win-x64.exe)
- [Windows x64 便携版](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/DSH-Desktop-Portable-0.2.0-win-x64.exe)
- [SHA-256 校验文件](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/SHA256SUMS-0.2.0.txt)

当前版本属于预览版，尚未进行 Windows 代码签名。Windows SmartScreen 可能显示“未知发布者”。请只从本仓库 Releases 下载，并核对 SHA-256。

## 数据与继承

### 已有 DSH 用户

桌面端会读取已有环境变量：

```text
DSH_HOME
npm_config_cache
```

只要继续使用同一个 `DSH_HOME`，通常可以继承：

- 会话和设置；
- Agent Preset；
- 持久化 Cordis 插件；
- 模型配置；
- 其他 DSH 用户数据。

桌面端不会复制、迁移、覆盖或删除 `DSH_HOME`。

### 新用户

如果没有配置环境变量，DSH 会使用正常的用户默认目录。当前版本尚未提供图形化数据目录选择向导。

可以在启动前自行设置：

```powershell
[Environment]::SetEnvironmentVariable('DSH_HOME', 'E:\DSH', 'User')
[Environment]::SetEnvironmentVariable('DSH_DESKTOP_HOME', 'E:\DSH-Desktop', 'User')
[Environment]::SetEnvironmentVariable('npm_config_cache', 'E:\npm-cache', 'User')
```

其中：

- `DSH_HOME`：DSH 会话、配置和 Preset；
- `DSH_DESKTOP_HOME`：桌面端设置、日志和 Chromium 数据；
- `npm_config_cache`：系统 npx/npm 模式使用的缓存。

卸载桌面应用不会自动删除 DSH 数据。

## 插件兼容性

兼容性最好的插件通常包括：

- 使用官方 Cordis Service、Event 和 Tool 的 Host 插件；
- 使用官方 Slot 注册的 Client UI 插件；
- 使用官方 Theme Token 的主题插件；
- 持久化 Agent Preset 插件。

以下类型需要单独验证：

- 依赖精确 DSH/Cordis 版本的插件；
- 直接查找或修改固定 DOM 结构的插件；
- 依赖 Chrome 扩展 API 的插件；
- 依赖开发环境 HMR 的插件；
- 当前进程内临时创建的 Dynamic Plugin。

内置运行时固定为 DSH 0.1.0-rc.6，使 Host、Web 和 Cordis 组件保持成套版本。使用系统现有 Runtime 时，其版本可能不同。

## 配置

桌面端的 `config.json` 支持：

| 字段 | 说明 |
|---|---|
| `url` | 本机 DSH Web 地址，仅允许 Loopback HTTP |
| `dshHome` | DSH 用户数据目录 |
| `npmCache` | npm/npx 缓存目录 |
| `launchMode` | `auto`、`global`、`npx`、`bundled` 或 `connect` |
| `runtimePreference` | `system-first` 或 `bundled-first` |
| `dshVersion` | npx 模式使用的固定 DSH 版本 |
| `command` / `args` | 受信任的本地自定义启动命令 |
| `candidateTimeoutMs` | 每个启动候选的等待时间 |
| `closeBehavior` | 退出、保留服务或最小化到托盘 |

修改配置前请先退出桌面端。

## 安全设计

当前 Electron 窗口启用了：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
```

此外：

- 只允许加载本机 Loopback DSH 地址；
- 连接前验证 DSH Bootstrap 标识；
- 默认拒绝 Electron 权限请求；
- 默认拒绝 Electron 弹出窗口；
- 外部链接交给系统浏览器；
- 不向 DSH 页面暴露文件系统或任意命令执行 IPC；
- 只停止由当前桌面端启动的 DSH 进程。

更多信息参见 [SECURITY.md](SECURITY.md)。

## 开发

需要 Node.js 20 或更高版本：

```powershell
npm ci
npm run check
npm test
npm start
```

## 构建

### Windows x64

```powershell
npm run build:win:setup
npm run build:win:portable
```

### macOS Intel

必须在 macOS 上运行：

```bash
npm run build:mac:x64
```

### macOS Apple Silicon

必须在 Apple Silicon macOS 或对应 CI Runner 上运行：

```bash
npm run build:mac:arm64
```

仓库包含 `.github/workflows/build.yml`，用于 Windows 和 macOS 构建。macOS 正式公开发布还需要 Apple Developer ID 签名和 Notarization。

## 项目状态

当前 `0.2.0` 是 Hybrid Runtime Preview：

- Windows x64 安装包已构建并实际验证；
- Windows 内置 DSH Runtime 已在独立端口和独立数据目录中验证；
- 自动测试 10 项全部通过；
- 生产依赖审计为 0 个已知漏洞；
- macOS 构建配置已加入，但仍需要真实 Mac/CI 构建、签名和运行验证；
- 尚无图形化首次启动向导、自动更新和正式应用图标。

## 贡献

欢迎提交 Issue 和 Pull Request。请先阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [架构说明](docs/architecture.md)
- [Runtime 选择与准备](docs/runtime-provisioning.md)
- [故障排查](docs/troubleshooting.md)

## 许可证

本桌面壳代码采用 [MIT License](LICENSE)。

DeepSeek Harness、Electron 和其他依赖仍分别遵循其自身许可证，详见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
