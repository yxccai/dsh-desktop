# Troubleshooting

## Startup fails

Open the log directory from the tray, or inspect `dsh-desktop.log` in Electron's DSH Desktop user-data folder.

Verify the service manually:

```powershell
$env:DSH_HOME = 'E:\DSH'
$env:npm_config_cache = 'E:\npm-cache'
npx @deepseek-ai/dsh web
```

Then open `http://127.0.0.1:3080`.

## Existing service

When the URL already responds, DSH Desktop connects to it and does not own or stop that process.

## Change configuration

Close DSH Desktop, edit its `config.json`, then restart. `launchMode` values:

- `auto`: try global `dsh`, then `npx`.
- `global`: run `dsh web`.
- `npx`: run `npx --yes @deepseek-ai/dsh web`.
- `connect`: never launch; connect only.

A non-empty `command` and `args` override the standard commands.

## Plugins

Persistent plugins need the same `DSH_HOME` and a compatible DSH/Cordis runtime. Dynamic plugins are process-scoped and do not survive restart. DOM-dependent and HMR-dependent plugins require separate testing.
