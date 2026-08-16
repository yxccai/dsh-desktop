# DSH Desktop

<p align="center">
  <img src="docs/images/social-preview.jpg" alt="DSH Desktop — Explore the Uncharted" width="100%">
</p>

English | [简体中文](README.zh-CN.md)

An unofficial open-source desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), designed to provide a simpler and more convenient desktop experience.

## Highlights

### A true shell of the official DSH Web — safe, complete, and future-proof

DSH Desktop is not a separate implementation — it is the official DSH Web wrapped in a native desktop window. That single design choice gives it three concrete strengths:

- **Full feature parity**: It inherits every capability, plugin, session, and workspace setting from the official Web UI. There is no "desktop version is missing something" gap, because the desktop is the Web.
- **Safe isolation by construction**: The web page never receives direct Node.js, filesystem, or arbitrary command access. The desktop enforces Electron sandbox + context isolation + precise loopback-only navigation origins + a whitelisted IPC layer. Security is structural, not added later.
- **Upgrades stay simple**: When the official DSH releases a new version, the desktop updates with a version-number change and rebuilt bundle — zero rewrites, zero broken custom code. Existing `DSH_HOME`, sessions, Agent Presets, and persistent plugins carry over unchanged.

### Foundation stays lean — only two real desktop enhancements

Instead of stuffing the app with half-used features, DSH Desktop keeps the official Web experience clean and adds exactly two things that matter at a desk:

- **Project panel** (conversation-aware, beside the chat): Every turn shows the files actually modified or produced. Multi-tab previews cover Markdown, HTML, source code, diff, CSV, PDF, images, and plain text — with split editing and conflict-aware atomic saves. Git workspaces show real status, diff, and per-file discard; non-Git directories use content-blob snapshots (no `git init`, no pollution). Each reply records a recoverable snapshot; restoring always saves the current state as a recovery point first.
- **Built-in plugins** (ready out of the box): Official curated capabilities — multiple color themes (Deep Ocean Blue gradient, Aurora Green-Purple, Rose Sunset Pink, Warm Sand Amber; light and dark modes), custom image backgrounds with native picker, transparency control, and instant disable, plus a lightweight desktop writing assistant (drafting, rewriting, summarizing, translating Agent). Nothing extra crowds the experience; these are the features people actually reach for.

### Extensible and creative — a high ceiling from day one

The foundation is minimal; the ceiling is high:

- **Built-in plugins keep growing**: New official curated plugins are delivered as transactionally managed updates with digest verification. They can be installed, disabled, or uninstalled without touching your user content or profiles.
- **Community plugin market inside the app**: A fixed, digest-verified copy of the MIT-licensed market component mounts into your shared `DSH_HOME`. Once mounted, the Web GUI gains a **Settings → Plugins → Plugin Market** tab that browses awesome-dsh-plugin.com — browse, install, update, and uninstall community plugins in one click. The app bundles its own `pnpm`, so nothing needs to be installed globally. Because the desktop and the browser version share the same `DSH_HOME`, plugins installed from either side work in both.
- **Shared data, shared growth**: Sessions, Agent Presets, persistent plugins, workspace settings — everything lives in one place. The desktop enhances it; it never replaces or fragments it.

In short: clean today, expandable tomorrow — official plugin ecosystem, community market, and continuously updated built-in plugins all work out of the box.

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
