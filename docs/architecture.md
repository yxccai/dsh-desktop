# Architecture

## Components

- `src/main.js`: Electron lifecycle, secure BrowserWindow, navigation policy, tray, shutdown behavior.
- `src/runtime-manager.js`: probes the configured URL and optionally launches a global or npx DSH runtime.
- `src/config.js`: creates and reads the desktop-only JSON configuration.
- `src/preload.js`: intentionally minimal, read-only desktop metadata.
- `src/plugin-manager.js`: manages bundled Agent Presets in `$DSH_HOME/.agent-presets` (enabled) and `$DSH_HOME/.desktop-plugin-disabled` (disabled).
- `src/web-market-manager.js`: optional managed Web Profile plugin — transactionally copies the vendored community market bundle (`resources/market-plugin`, fixed upstream MIT version) into `$DSH_HOME/node_modules` and adds/removes a managed block in the home-level `$DSH_HOME/cordis.patch.yml`. See [web-market.md](web-market.md).
- `src/dsh-integration.js`: installs the settings bridge package and patches the home-level `cordis.patch.yml`; also exports the shared `upsertManagedBlock` / `stripManagedBlock` patch helpers used by every DSH Desktop-managed block.

## Ownership rule

A service already listening at the configured URL is considered external and is never stopped by the shell. Only a child process started by the current desktop process is owned and eligible for shutdown.

## Data boundaries

`DSH_HOME` belongs to DeepSeek Harness. This project neither copies nor rewrites its contents. Desktop preferences and logs live under Electron's user-data directory. The npm cache is passed to a spawned DSH command but is not managed or deleted.

Two exceptions are deliberate and ownership-marked: the settings bridge and the optional web market install into `$DSH_HOME/node_modules` and manage a marker-delimited block in `$DSH_HOME/cordis.patch.yml` (home-level patch layer). Both are transactional, digest-verified, removable, and never touch `$DSH_HOME/profiles/web`.

## Compatibility

The shell displays the original upstream Web UI. Cordis Host and Client compatibility is therefore determined by the DSH runtime/Web assets actually served at the configured URL.
