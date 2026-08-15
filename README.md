# DSH Desktop

English | [简体中文](README.zh-CN.md)

An unofficial open-source desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), designed to provide a simpler and more convenient desktop experience.

## Highlights

- **One-click setup**: Install and launch on Windows without manual command-line setup.
- **Bundled runtime**: Works even when Node.js, npm, npx, and DSH are not installed.
- **Automatic reuse**: Prefers existing DSH data, settings, sessions, and compatible plugins.
- **Full Web experience**: Uses the original DSH Web UI for maximum feature and plugin compatibility.
- **Secure isolation**: The Web page receives no direct Node.js, filesystem, or arbitrary command access.
- **Plugin Center**: Install, enable, disable, and manage recommended Agent Presets without overwriting existing user content.
- **Built to grow**: Setup guidance, updates, more desktop features, and broader platform support are planned.

## Download

Download from [GitHub Releases](https://github.com/yxccai/dsh-desktop/releases):

- [Windows x64 Setup](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/DSH-Desktop-Setup-0.2.0-win-x64.exe)
- [Windows x64 Portable](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/DSH-Desktop-Portable-0.2.0-win-x64.exe)
- [SHA-256 checksums](https://github.com/yxccai/dsh-desktop/releases/download/v0.2.0/SHA256SUMS-0.2.0.txt)

## How it works

DSH Desktop automatically selects an available runtime:

1. Connect to an existing DSH service.
2. Reuse a global `dsh` installation.
3. Reuse the system `npx/npm` environment.
4. Fall back to the bundled DSH runtime.

Existing users can usually keep their original `DSH_HOME`, sessions, Agent Presets, and persistent plugins. New users do not need to install DSH or Node.js first.

## Plugin compatibility

Plugins built on official DSH/Cordis services, Host tools, UI slots, themes, and persistent Presets generally offer the best compatibility. Plugins that depend on fixed DOM structures, browser extensions, or development HMR require separate testing.

## Platform support

- **Windows x64**: Setup and portable builds are available and tested.
- **macOS Intel / Apple Silicon**: Build workflows are configured; testing, signing, and release work are ongoing.
- Additional platforms may be considered in future versions.

## Development

```powershell
npm ci
npm run check
npm test
npm start
```

More information:

- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Runtime provisioning](docs/runtime-provisioning.md)

## License

This project is licensed under the [MIT License](LICENSE). DeepSeek Harness, Electron, and other dependencies remain under their respective licenses.
