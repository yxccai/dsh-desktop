# DSH Desktop 0.2.0

English | [简体中文](README.zh-CN.md)

Unofficial open-source Electron desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> This community project is not affiliated with or endorsed by DeepSeek.

## One-click hybrid runtime

DSH Desktop keeps the upstream Web UI unchanged and selects a runtime in this order:

1. Connect to an already-running, identity-verified local DSH Web service.
2. Reuse an existing global `dsh` command.
3. Reuse the system `npx`/npm environment and existing cache.
4. Fall back to the bundled `@deepseek-ai/dsh` 0.1.0-rc.6 runtime, executed by Electron's embedded Node runtime.

A new computer therefore does not need Node.js, npm, npx, or a previous DSH installation. Public network access is still required for the user's model provider and optional plugins. Existing `DSH_HOME` and `npm_config_cache` environment values are preserved when present.

## Data

- `DSH_HOME` remains owned by DeepSeek Harness. Existing data, profiles, sessions, and compatible persistent plugins are reused.
- Desktop-only state can be moved with `DSH_DESKTOP_HOME`.
- On a new machine, normal user defaults are used until a graphical setup wizard is added.
- Uninstalling the desktop app does not delete DSH data.

## Development

```powershell
npm ci
npm run check
npm test
npm start
```

## Build

Windows x64:

```powershell
npm run build:win
```

macOS Intel and Apple Silicon (must run on macOS):

```bash
npm run build:mac
```

GitHub Actions configuration is included under `.github/workflows/build.yml`. Unsigned preview builds trigger Windows SmartScreen or macOS Gatekeeper warnings. Public releases should be code-signed and macOS builds notarized.

## Configuration

The desktop `config.json` supports:

- `url`: loopback DSH URL.
- `dshHome`, `npmCache`: data/cache paths.
- `launchMode`: `auto`, `global`, `npx`, `bundled`, or `connect`.
- `runtimePreference`: `system-first` (default) or `bundled-first`.
- `dshVersion`: pinned package version used by npx.
- trusted-local `command` and `args` override.
- `candidateTimeoutMs` and `closeBehavior`.

## Compatibility

The bundled runtime pins DSH 0.1.0-rc.6 so Host/Web/Cordis components are version-aligned. Existing system runtimes may be newer or older. Plugins using official Cordis services, events, slots, and theme APIs are the most portable; DOM-dependent, browser-extension-dependent, or development-HMR workflows still require testing.

## Security

The DSH renderer has no Node integration. Context isolation, Chromium sandboxing, loopback-only navigation, DSH bootstrap identity checks, denied permission requests, and denied Electron popups are enabled. The loaded page receives no process-launch or filesystem IPC.

See `SECURITY.md`, `THIRD_PARTY_LICENSES.md`, and `docs/architecture.md`.
