# Built-in Community Plugin Market (Web)

DSH Desktop ships an **optional managed Web Profile plugin**: a fixed, vendored
copy of the community plugin market
[`@sanqi-normal/dsh-webui-market-plugin`](https://github.com/Sanqi-normal/dsh-webui-market-plugin)
(v0.5.2, MIT) under `resources/market-plugin/`. When installed and enabled, the
DSH Web GUI gains a **Settings → Plugins → Plugin Market** tab that browses the
[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) catalog and installs
community plugins into the shared `web` profile.

## Managing the market from the desktop

Open the desktop **Plugin Center** (tray menu → 插件中心) and switch to the
**Web 插件市场** tab. It is a compact command-center/card layout with:

- a status strip (market status, vendored version, mount target, patch file);
- a console card with **install / enable / disable / uninstall** actions;
- a capability card describing what the in-web market provides;
- an explicit **third-party risk warning**; and
- a **restart-required** note.

Operations:

| Action | What happens |
| --- | --- |
| 安装 (install) | Transactionally copies `resources/market-plugin` into `$DSH_HOME/node_modules/@sanqi-normal/dsh-webui-market-plugin` (with an ownership marker and a content digest) and adds a managed block to `$DSH_HOME/cordis.patch.yml` that inserts the `dsh-market-plugin` row. |
| 停用 (disable) | Keeps the copied package on disk, rewrites the managed block to `disabled: true` so the Loader skips the row. |
| 启用 (enable) | Rewrites the managed block back to `- insert:` so the row is mounted again. |
| 卸载 (uninstall) | Verifies the installed copy still matches its recorded digest (refuses if modified), then removes the package and strips the managed block. |

Every operation is serialized (FIFO) and transactional:

- install rolls the copied package back if the patch write fails;
- uninstall restores the package if the patch removal fails;
- a foreign package in `node_modules`, a damaged managed block, or a tampered
  bundle is reported as **冲突 (conflict)** and nothing is modified.

## What is preserved

- The shared **`$DSH_HOME/profiles/web`** directory is never touched. The
  market is mounted through the home-level `cordis.patch.yml` layer, which
  applies over every profile, so the web profile's own files stay byte-identical.
- Existing DSH Desktop managed blocks (e.g. the settings Plugin Center bridge)
  and user-written patch content are preserved — each manager owns a
  marker-delimited block.
- The desktop **PluginManager** (bundled Agent Presets) is unchanged; the
  market is a separate entry in the same Plugin Center window.

## Restart required

Install, enable, disable, and uninstall take effect only after **restarting
DSH** (quit and reopen the desktop app, or restart the web service). Running
sessions are not interrupted.

## Third-party risk

Community plugins are written by third parties and run inside the DSH process
with host access (files, network, command line). Only install plugins you
trust. DSH Desktop pins and digest-verifies its own bundled market copy, but
takes no responsibility for the behavior of plugins installed through the
market.

## In-web install behavior (upstream Host + DSH Desktop pnpm patches)

The vendored Host half registers `/api/dsh-market` and performs community
installs by spawning the `dsh plugin` CLI with a source whitelist, trial-boot
verification, and a FIFO task queue; its API contract is byte-for-byte
identical to upstream. On top of that, DSH Desktop adds two portability
patches to the Host (see `VENDORED.md`):

- **bundled pnpm**: the app bundles `pnpm` as a dependency and materializes a
  PATH shim (`src/pnpm-runtime.js`) whose `pnpm.cmd`/`pnpm` forwards to the
  bundled `node_modules/pnpm/bin/pnpm.cjs` — under plain Node in dev and under
  Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`) in packaged builds. `RuntimeManager`
  passes the augmented PATH and `DSH_MARKET_PNPM_DIR` to every owned DSH
  process, and the Host's `pnpmEnv()` re-prepends that directory for the CLI
  children it spawns, so `dsh plugin`'s pnpm forwarding works even when pnpm
  was never installed globally (npx/global/bundled launches on Windows).
- **human-readable pnpm failures**: a fast pre-flight `pnpm --version` check
  plus a mojibake-safe close handler replace the raw "command not found"
  output (which arrives as GBK mojibake on Windows) with a clean Chinese hint.

The CLI itself is resolved from the process entry, `$DSH_BIN`, or PATH. When
the desktop launches DSH through npx/bundled runtime without `$DSH_BIN`, the
panel may report the upstream "CLI not found" hint; setting `$DSH_BIN` to a
`dsh` CLI entry and restarting enables in-web installs. The desktop-side
install/enable/disable/uninstall of the market bundle itself never depends on
the CLI.

## Files

- `resources/market-plugin/` — vendored upstream package (see `VENDORED.md`
  for attribution, pinned tag/commit, reproduction, and the two DSH Desktop
  Host patches).
- `src/pnpm-runtime.js` — bundled-pnpm PATH shim provisioning.
- `src/web-market-manager.js` — desktop-side transactional manager.
- `src/dsh-integration.js` — shared `upsertManagedBlock` / `stripManagedBlock`
  patch helpers.
- `src/main.js`, `src/plugin-center-preload.js` — IPC (`web-market:*`) wiring.
- `src/plugin-center.html`, `src/plugin-center.js` — the command-center/card UI.
- `test/web-market-manager.test.js`, `test/market-vendor.test.js` — tests.
