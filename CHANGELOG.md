# Changelog

## 0.5.0 - Project Panel, Themes, Plugin Center, and Community Market

- Add the conversation-aware **project panel**: files actually modified or produced by each reply appear below the response; click to open multi-tab previews (Markdown/HTML/code/Diff/CSV/PDF/images/text) with split editing and conflict-aware atomic saves. Git workspaces get real status/diff/single-file discard; non-Git directories use content-blob snapshots stored outside the project (no `git init`, no metadata written into the workspace). Every reply records a recoverable snapshot with an automatic pre-restore checkpoint; per-file undo and full-context diffs are supported in both modes.
- Add managed **built-in plugins**: four color themes (Ocean blue, Aurora green/violet, Rose sunset pink, Sand warm amber) with light/dark token overrides and reversible gradient backgrounds; a custom image background with native picker, opacity control, and enable/disable; and the Desktop Writing assistant preset — all install/enable/disable/uninstall transactionally with digest verification.
- Add the optional **community plugin market**: a fixed, vendored MIT copy of `@sanqi-normal/dsh-webui-market-plugin` mounts into the shared `DSH_HOME` on demand, adding a Settings → Plugins → Plugin Market tab that browses awesome-dsh-plugin.com and installs/uninstalls community plugins into the shared web profile (browser Web and DSH Desktop share the same installs). The desktop shell bundles pnpm (PATH shim, Electron-as-Node), pins the profile pnpm store, allows git-hosted build scripts, and auto-heals lockfiles missing tarball integrity — so installs work without any global pnpm or manual fixes.
- Harden the shell: ownership markers persist across restarts so an owned DSH service is adopted and stopped correctly even after the desktop was force-killed; IPC sender guards accept only the plugin-center window and the exact trusted DSH origin; clipboard writes are allowed only from the identity-verified loopback page; renderer stays sandboxed with contextIsolation and loopback-only navigation.
- Rebrand the settings bridge to 内置插件 (Built-in Plugins) with a managed market card; redesigned the market client UI into an original command-center layout (`.wmp-*`) while keeping the upstream host API contract; all market operations are transactional with rollback, conflict refusal, and digest pinning.

## Unreleased

- Make the vendored market Host resolve the bundled pnpm for DSH services started outside the desktop too: the pnpm shim is now written under `$DSH_HOME/bin` and the Host's `pnpmEnv()` falls back to that directory when `DSH_MARKET_PNPM_DIR` is absent, so manually-started `dsh web` processes find the bundled pnpm without any env injection.
- Allow git-hosted plugin build scripts during market installs (`npm_config_dangerously_allow_all_builds=true`) — pnpm ≥10 otherwise blocks them with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`; the catalog whitelist and trial-boot verification are unchanged.
- Pin the profile pnpm store for market ops: the Host reads `node_modules/.modules.yaml`'s `storeDir` and sets `npm_config_store_dir` so profiles created under a different pnpm store (e.g. after `DSH_HOME` moved) no longer fail with `ERR_PNPM_UNEXPECTED_STORE`.
- Auto-heal lockfiles with missing tarball integrity: when an op fails with `ERR_PNPM_MISSING_TARBALL_INTEGRITY` (pnpm ≥10.3x refuses old bare-GitHub-archive-URL lockfile entries), the Host rewrites those dependencies to `github:` syntax and retries the op once; profile manifests are read/written BOM-free so the dsh CLI JSON parser never chokes on `\uFEFF`.
- Add `test/market-host.test.js` covering the archive-URL→`github:` rewrite, the integrity-failure detector, the manifest heal (BOM-free, idempotent), and the export surface.
- Bundle `pnpm` as a dependency and surface it on PATH through a generated shim (`src/pnpm-runtime.js`) so the community market's `dsh plugin` installs resolve `pnpm` even when nothing installed it globally — fixing market installs on Windows across npx/global/bundled launches. The packaged app runs the bundled `pnpm.cjs` under Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`), `RuntimeManager` passes the augmented PATH plus `DSH_MARKET_PNPM_DIR` to every owned DSH process, and the market Host re-prepends the shim for the CLI children it spawns.
- Make the vendored market Host pnpm-aware: a fast pre-flight pnpm check fails ops with a clean Chinese hint, and a mojibake-safe close handler replaces raw "command not found" output (which arrives as GBK mojibake on Windows) — a missing pnpm now never surfaces as garbage. Recompute the pinned vendored digest and update `VENDORED.md` provenance (the Host is now upstream plus these two DSH Desktop portability patches; the client remains the original redesign).
- Simplify the Web settings bridge market card: remove the technical status badge, third-party risk paragraph, author/version/source/mount meta, and the dense restart note, replacing them with clear user wording (browse awesome-dsh-plugin.com; installed plugins are shared between browser DSH Web and DSH Desktop), friendly button labels (安装/停用/启用/卸载插件市场), and a simple "更改后重启 DSH 即可生效" note; bump `@yxccai/dsh-desktop-plugin-center` to 0.5.2.
- Add an optional managed Web plugin market (`@sanqi-normal/dsh-webui-market-plugin`, vendored MIT at `resources/market-plugin`) that is mounted into the shared `DSH_HOME` on demand, giving the Web GUI a Settings → Plugins → Plugin Market tab without ever touching `profiles/web`.
- Manage the market transactionally from the desktop Plugin Center (new Web 插件市场 tab) and from the Web settings bridge: install / enable / disable / uninstall via `src/web-market-manager.js`, with a fixed content digest, foreign-package conflict refusal, and rollback on failure.
- Expose `dshDesktop.webMarket` in the main-window preload and accept IPC calls from the exact trusted main DSH page (in addition to the plugin-center window) through pure, unit-tested sender guards in `src/ipc-guards.js`.
- Rename the Web settings bridge tab from 插件中心 to 内置插件 and add a managed market card there (status, install/enable/disable/uninstall, explicit third-party warning, restart note); bump `@yxccai/dsh-desktop-plugin-center` to 0.5.1.
- Redesign the vendored market client UI/CSS from the upstream grid cards into an original command-center/list layout (`.wmp-*` styles: environment KPI banner, command palette, category rail, numbered plugin list, docked task deck) while preserving the upstream host API contract byte-for-byte; update `VENDORED.md` to state that the host is based on upstream while the client is independently redesigned under MIT.
- Add documentation and tests: `THIRD_PARTY_LICENSES.md` entry, README/README.zh-CN Web market sections, CHANGELOG entries, IPC-guard tests, and extended WebMarketManager / vendored-bundle tests.
- Add three bundled managed color themes alongside the Ocean theme — Aurora (green/violet), Rose (sunset pink), and Sand (warm amber) — each with light/dark token overrides and a reversible gradient background, selectable and swatch-previewed in the Plugin Center.
- Generalize the managed theme bridge so Plugin Center lists every bundled theme, applies token overrides for the enabled theme, and fully removes the previous theme's token layer and background styles when switching or disabling.

## 0.4.1 - macOS Test Build

- Add GitHub Actions builds for unsigned macOS Intel and Apple Silicon DMG/ZIP prereleases with SHA-256 manifests.
- Document the first-launch Gatekeeper override for unsigned test packages.

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
