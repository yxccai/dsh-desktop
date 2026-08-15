# Runtime selection and provisioning

## Selection order

In `system-first` auto mode the desktop app uses:

1. An already-running local service that passes DSH bootstrap identity checks.
2. A working global `dsh` command.
3. A working system `npx` command with the configured pinned DSH version.
4. The bundled DSH dependency executed with Electron in Node mode.

`bundled-first` swaps steps 2/3 with step 4. Explicit `global`, `npx`, `bundled`, and `connect` modes are also available.

## New computers

The release contains the complete npm production dependency graph of `@deepseek-ai/dsh` 0.1.0-rc.6. Electron's embedded Node process starts its CLI using `ELECTRON_RUN_AS_NODE=1` and `--expose-internals`. The user does not need a system Node/npm installation.

The bundled runtime writes only through `DSH_HOME`, npm cache, and normal tool-controlled workspace paths. It is a fallback runtime, not a second copy of user data.

## Existing computers

Environment variables `DSH_HOME` and `npm_config_cache` are used as defaults. Existing DSH services are never stopped. A global/npx process started by the app is owned and stopped according to desktop close behavior.

## macOS

The same Electron Node-mode mechanism is cross-platform. Native dependencies must be rebuilt separately for x64 and arm64 on macOS. GitHub Actions uses Intel and Apple Silicon runners. Actual public DMG files require Apple code signing and notarization for normal Gatekeeper behavior.
