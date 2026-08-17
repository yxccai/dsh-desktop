# DSH Desktop

<p align="center">
  <img src="docs/images/social-preview.jpg" alt="DSH Desktop — Explore the Uncharted" width="100%">
</p>

English | [简体中文](README.zh-CN.md)

An unofficial open-source desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), designed to provide a simpler and more convenient desktop experience.

## Highlights

### A desktop shell around the official DSH Web — inherited features, secure, and easy to keep current

DSH Desktop does not reimplement anything; it wraps the official DSH Web in a native window:

- **Launch by double-click**: No browser tab, no URL, no command line — double-click the desktop icon and enter the same working environment as the official Web.
- **Feature inheritance**: The official DSH Web runs as the host runtime, loading its full UI and plugin system while sessions, workspace data, and the plugin ecosystem are preserved as-is; the Web plugin market component among the built-in plugins manages plugins for both the desktop and the Web version from one place.
- **Safe isolation**: The web page never receives direct Node.js, filesystem, or arbitrary command access; Electron sandbox, contextIsolation, loopback-only navigation, and a whitelisted IPC layer form the boundary.
- **Simple upgrades**: When the official DSH ships a new version, the desktop updates with a version bump and a rebuilt bundle. Existing `DSH_HOME`, sessions, Agent Presets, and persistent plugins carry over unchanged.

### Foundation stays lean — two practical desktop enhancements, nothing more

The base build does not pile on features; it keeps the official Web experience and adds only the two enhancements most useful at a desk:

- **Project panel**: Beside the chat, it lists the files actually modified or produced by each reply. Multi-tab previews cover Markdown, HTML, source code, diff, CSV, PDF, images, and text, with split editing and conflict-aware atomic saves. Git workspaces show real status and per-file discard; non-Git directories use content snapshots (no `git init`, nothing written into the project). Each reply records a recoverable snapshot, and restoring always saves the current state as a recovery point first.
- **Built-in plugins (optional install)**: Built-ins are offered as a selectable catalog rather than pre-installed. Available now: multiple color themes (Deep Ocean Blue, Aurora Green-Purple, Rose Sunset Pink, Warm Sand Amber, each with light and dark modes), a custom image background (native file picker, adjustable opacity, instant disable), and a lightweight writing assistant (drafting, rewriting, summarizing, translating). Each can be installed, disabled, or uninstalled on demand.

### Extensible and creative — a complete plugin ecosystem on a lean base

The base stays light; the extension options are available from day one:

- **Built-in plugins keep growing**: Official curated plugins ship through a trusted channel with integrity verification, and can be installed, disabled, or uninstalled without touching user content.
- **Community plugin market**: A fixed, verified copy of the community market component is included. Once enabled, Settings → Plugins → Plugin Market browses [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/) — browse, install, update, and uninstall community plugins in one click, with a bundled `pnpm` so nothing needs to be installed globally. Installs go into the shared `DSH_HOME` and work in both the desktop and the browser version.
- **Scale on demand**: Add capabilities from the built-in and community catalogs when you need them; keep the base experience lean when you do not.

## Download

Download from [GitHub Releases](https://github.com/yxccai/dsh-desktop/releases/tag/v0.5.0):

- [Windows x64 Setup](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/DSH-Desktop-Setup-0.5.0-win-x64.exe)
- [Windows x64 Portable](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/DSH-Desktop-Portable-0.5.0-win-x64.exe)
- [SHA-256 checksums](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/SHA256SUMS-0.5.0.txt)

### macOS (test build)

Apple Silicon (M-series):

- [macOS arm64 DMG](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/DSH-Desktop-0.5.0-mac-arm64.dmg)
- [macOS arm64 ZIP](https://github.com/yxccai/dsh-desktop/releases/download/v0.5.0/DSH-Desktop-0.5.0-mac-arm64.zip)

The Intel (x64) build appears on the [Releases page](https://github.com/yxccai/dsh-desktop/releases/tag/v0.5.0) once the runner finishes.

On first launch, Control-click the app in Finder and choose **Open**. If macOS still blocks it, go to **System Settings → Privacy & Security → Open Anyway**. Signing and notarization are planned for a future release.

## Screenshots

### Conversation-aware project panel

![Project panel with full-context file changes](docs/images/project-panel.png)

### Conversation snapshots and per-file rollback

![Conversation snapshots and rollback controls](docs/images/conversation-snapshots.png)

### Managed Plugin Center

![DSH Desktop Plugin Center](docs/images/plugin-center.png)

## How it works

DSH Desktop automatically selects an available runtime:

1. Connect to an existing DSH service.
2. Reuse a global `dsh` installation.
3. Reuse the system `npx/npm` environment.
4. Fall back to the bundled DSH runtime.

Existing users can usually keep their original `DSH_HOME`, sessions, Agent Presets, and persistent plugins. New users do not need to install DSH or Node.js first.

## Project panel

Files actually modified or produced by a conversation appear below the relevant response. Clicking one opens it in a right-side multi-tab preview with a filename and close button; the chat layout shrinks instead of being covered. Previews support Markdown, HTML, source code, diff, CSV, PDF, images, and text, plus split editing with conflict-aware atomic saves. Git workspaces expose real status/diff/discard controls; ordinary non-Git directories use DSH Desktop content-blob snapshots instead, without running `git init` or writing metadata into the project. Both modes retain turn changes, full-context diffs, per-file undo, and recoverable snapshots; restoring a snapshot first records the current state as a recovery point.

Office files currently open through their system application; native DOCX/XLSX/PPTX rendering remains planned.

## Web plugin market (optional)

DSH Desktop bundles the community plugin market [`@sanqi-normal/dsh-webui-market-plugin`](https://github.com/Sanqi-normal/dsh-webui-market-plugin) (MIT, vendored at `resources/market-plugin`) and mounts it into the shared `DSH_HOME` on demand, so the DSH Web GUI gains a **Settings → Plugins → Plugin Market** tab that browses [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/) and installs/uninstalls community plugins into the web profile.

- **Manage it from two places**: the desktop Plugin Center window (Web 插件市场 tab) and the Web settings bridge (内置插件 tab card in the GUI). Install, enable, disable, and uninstall are exclusive, transactional operations on `$DSH_HOME/cordis.patch.yml` plus `$DSH_HOME/node_modules/@sanqi-normal/dsh-webui-market-plugin`; `$DSH_HOME/profiles/web` is never modified.
- **Works without a global pnpm**: the app bundles pnpm and provisions a PATH shim (`src/pnpm-runtime.js`) that every DSH process inherits, so in-web installs succeed on Windows even when pnpm was never installed globally (npx/global/bundled launches). DSH services started manually from a terminal also fall back to the bundled pnpm under `$DSH_HOME/bin`. If pnpm is genuinely unavailable, the market reports a clear message instead of raw console garbage.
- **Common install problems are handled automatically**: git-hosted build scripts are allowed (`dangerously-allow-all-builds`); migrated profiles reuse their recorded pnpm store (`npm_config_store_dir`); lockfiles missing tarball integrity (bare GitHub archive URLs written by older pnpm) are rewritten to `github:` syntax and the op is retried once.
- **Third-party warning**: market plugins are written by community authors and run inside the DSH process with host privileges (files, network, commands). Only install sources you trust. The desktop app ships a fixed, digest-verified copy and refuses to operate on foreign or tampered content, but takes no responsibility for third-party plugin behavior.
- **Restart required**: changes take effect after the DSH web service restarts; running conversations are not interrupted.
- Provenance and reproduction: `resources/market-plugin/VENDORED.md` — the Host half is upstream plus two DSH Desktop portability patches (bundled-pnpm PATH shim and human-readable pnpm errors), the Client half is an original redesigned UI under MIT.

## Plugin compatibility

Plugins built on official DSH/Cordis services, Host tools, UI slots, themes, and persistent Presets generally offer the best compatibility. Plugins that depend on fixed DOM structures, browser extensions, or development HMR require separate testing.

## Platform support

- **Windows x64**: Setup and portable builds are available and tested.
- **macOS Intel / Apple Silicon**: Unsigned test builds are published as prereleases. On first launch, Control-click the app in Finder and choose **Open**; if macOS still blocks it, use **System Settings → Privacy & Security → Open Anyway**. Signing and notarization are planned.
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
