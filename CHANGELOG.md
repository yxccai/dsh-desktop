# Changelog

## 0.4.0 - Project Panel, Themes, and Snapshot Preview

- Allow clipboard writes from the identity-verified loopback DSH page so built-in copy icons and Copy buttons work in the desktop shell, while continuing to deny clipboard reads and untrusted origins.
- Anchor the project-panel resize handle to the right-side Grid track instead of a cached frame-width pixel offset, preventing divider hit-target drift after layout changes.
- Add an optional Codex-inspired project panel beside project conversations without replacing DSH tool details.
- Show only files actually modified or produced by each conversation turn; remove the full project file tree from the panel.
- Open conversation files in top filename tabs with close buttons and multi-tab previews for Markdown, HTML, source code, diff, CSV, PDF, images, and text.
- Shrink the chat layout while the panel is open instead of covering the conversation.
- Add source/preview switching, split editing, atomic saves, external-change protection, and system opening for Office/binary files.
- Add real Git status, file diffs, safe single-file discard, and assistant-turn project snapshots that do not modify the user's Git index.
- Add non-Git workspace support with content-blob snapshots stored outside the project, full-context diffs, per-file undo, and snapshot restore without running `git init`.
- Add recoverable snapshot restore with an automatic pre-restore checkpoint.
- Persist width, collapsed state, and active panel section per project; support drag resize and double-click reset.
- Confine filesystem IPC to canonical roots registered in the DSH Workspace registry, reject escaping symlinks, cap preview sizes, and avoid shell command execution.
- Disable interactive Git prompts, bound Git command duration/output, and keep Git invocation on fixed argument arrays.
- Require the DSH workspace root to exactly match the Git repository root, preventing nested workspaces from reaching ancestor repository files.
- Serialize snapshot mutations and preflight snapshot patches before applying them, so a rejected restore leaves the workspace unchanged.
- Add managed Ocean and custom image background themes with native image selection, reversible token overrides, and noninteractive background layers.

## 0.3.0 - Plugin Center Preview

- Add the Plugin Center inside DSH Settings → Plugins, with the system tray window retained as a fallback shortcut.
- Install, enable, disable, and uninstall allowlisted Agent Preset packages.
- Keep user and external Presets read-only and never modify shipped DSH Presets.
- Verify bundled plugin digests and use transactional filesystem operations.
- Refuse destructive uninstall after a user modifies installed plugin content.
- Add the lightweight Desktop Writing preset as the first bundled recommendation.

## 0.2.0 - Hybrid Runtime Preview

- Bundle the complete production dependency graph of `@deepseek-ai/dsh` 0.1.0-rc.6.
- Run the bundled DSH CLI using Electron's embedded Node runtime with required internals enabled.
- Detect and prefer an existing DSH service, global DSH, or system npx before bundled fallback.
- Add explicit `bundled` launch mode and system-first/bundled-first preferences.
- Preserve existing `DSH_HOME` and npm cache environment paths.
- Add Windows NSIS/portable and macOS x64/arm64 DMG/ZIP build targets.
- Add Windows/macOS GitHub Actions build matrix and third-party notices.
- Expand hybrid-runtime tests and verify an isolated bundled DSH service on Windows.

## 0.1.2 - Developer Preview

- Destroy the tray and main window before a hard Electron exit so the single-instance lock is released reliably.
- Recreate a missing window when a second-instance event reaches a still-running process.
- Verify on Windows that closing leaves zero desktop processes and a second launch succeeds.
- Prefer the E-drive unpacked build for the local desktop shortcut, avoiding portable extraction into the system Temp directory.

## 0.1.1 - Developer Preview

- Execute Windows npm command shims through `ComSpec` instead of spawning `.cmd` files directly.
- Verify DSH bootstrap markers before connecting to a local HTTP service.
- Fall back from an unsuccessful global command to npx after cleaning its process tree.
- Clean up owned processes on startup failure and strengthen termination fallback.
- Validate configuration types, loopback URL, enums, arguments, and timeouts.
- Deny renderer permission requests and all Electron popup windows by default.
- Add optional DSH version pinning and expand tests from 3 to 7.

## 0.1.0 - Developer Preview

- Connect to an existing local DSH Web service without taking process ownership.
- Launch DSH through a global command, npx, or trusted custom configuration.
- Pass configurable `DSH_HOME` and npm cache paths to owned child processes.
- Load the unmodified upstream Web UI in a sandboxed Electron window.
- Restrict top-level navigation and open external links in the system browser.
- Add tray controls, logging, single-instance behavior, and owned-process shutdown.
- Add Windows NSIS and portable build targets.

### Known limitations

- No graphical settings editor yet; configuration is JSON.
- No bundled Node.js or DSH runtime.
- No code signing or automatic updates.
- Client plugin compatibility follows the DSH/Cordis Web version served locally.
- The Electron development dependency currently pulls `extract-zip` with the npm advisory GHSA-jmr9-qjv8-65gv and no upstream fix. `npm audit --omit=dev` reports zero production vulnerabilities; release builders should use trusted archives and revisit this before a stable release.
