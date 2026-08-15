# Architecture

## Components

- `src/main.js`: Electron lifecycle, secure BrowserWindow, navigation policy, tray, shutdown behavior.
- `src/runtime-manager.js`: probes the configured URL and optionally launches a global or npx DSH runtime.
- `src/config.js`: creates and reads the desktop-only JSON configuration.
- `src/preload.js`: intentionally minimal, read-only desktop metadata.

## Ownership rule

A service already listening at the configured URL is considered external and is never stopped by the shell. Only a child process started by the current desktop process is owned and eligible for shutdown.

## Data boundaries

`DSH_HOME` belongs to DeepSeek Harness. This project neither copies nor rewrites its contents. Desktop preferences and logs live under Electron's user-data directory. The npm cache is passed to a spawned DSH command but is not managed or deleted.

## Compatibility

The shell displays the original upstream Web UI. Cordis Host and Client compatibility is therefore determined by the DSH runtime/Web assets actually served at the configured URL.
