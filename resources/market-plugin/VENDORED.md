# Vendored: dsh-webui-market-plugin

This directory vendors the upstream community plugin market package used by
DSH Desktop as an optional managed Web Profile plugin.

| Field | Value |
| --- | --- |
| Package | `@sanqi-normal/dsh-webui-market-plugin` |
| Version | `0.5.2` (tag `v0.5.2`) |
| Commit | `0a09c21bae41318bc2fed51c274b2496b22988d5` |
| Upstream | https://github.com/Sanqi-normal/dsh-webui-market-plugin |
| License | MIT (see `LICENSE` in this directory; Copyright (c) 2026 Sanqi-normal) |

## What is vendored — and how it was changed

The **Host half is based on upstream**: `lib/host.js` is copied byte-for-byte
from the fixed tag and used as-is. It registers the `/api/dsh-market` route
(catalog listing with offline snapshot fallback, install/uninstall/update FIFO
queue via the `dsh plugin` CLI, whitelist + trial-boot checks,
disable/enable persistence, op queue/kill). The API contract the browser talks
to is therefore identical to upstream.

The **Client half is independently redesigned**: `lib/client.js` is modified
from the upstream client under the MIT license. Its user interface and CSS
were redesigned substantially into an original command-center/list layout (a
status banner of environment KPIs, a command palette for search and the dsh
CLI path, a command rail of category filters, a numbered plugin list, and a
docked background-task deck). The host API behavior it drives is preserved
byte-for-byte: same `POST /api/dsh-market` methods (`list`, `probe`,
`installed`, `installedAll`, `updates`, `updateAll`, `update`, `op`, `kill`,
`clear`, `clearAll`, `install`, `uninstall`, `disable`, `enable`), same
payloads, same op-queue polling protocol, same whitelist/trial-boot gating
and "ask DSH" failure workflow. No upstream source code was removed from the
contract; only the presentation layer was replaced.

The following files are unmodified upstream copies:

- `package.json`, `cordis.patch.yml`, `README.md`, `LICENSE`
- `lib/host.js` — Host half (byte-for-byte)
- `data/catalog-snapshot.json` — offline catalog snapshot used when the
  awesome-dsh-plugin.com JSON API is unreachable

Upstream `scripts/`, `tests/`, and `img/` are development artifacts excluded
from the published package and are intentionally not vendored.

## Attribution

This vendored copy is MIT-licensed third-party software. The full license text
is preserved in `LICENSE` and is also referenced from
`THIRD_PARTY_LICENSES.md` at the repository root. DSH Desktop's own market
management UI, the desktop-side `WebMarketManager`, and the redesigned client
presentation are original DSH Desktop work under the MIT license and are not
part of the upstream package.

## Desktop integration (original DSH Desktop work)

DSH Desktop treats this bundle as an **optional managed Web Profile plugin**
(`src/web-market-manager.js`). Install/enable/disable/uninstall are
transactional operations that:

1. Copy this directory into `$DSH_HOME/node_modules/@sanqi-normal/dsh-webui-market-plugin`
   with an ownership marker and digest.
2. Add/remove a managed block in the home-level `$DSH_HOME/cordis.patch.yml`
   that inserts the `dsh-market-plugin` row (or marks it `disabled: true`).

The shared `$DSH_HOME/profiles/web` directory is never modified. Restarting the
DSH web service is required for changes to take effect. The upstream Host's
install behavior (spawning the `dsh plugin` CLI inside the web process) is used
as-is only when the running web runtime can resolve a `dsh` CLI (`$DSH_BIN` or
PATH); the desktop shell itself never needs it, because it mounts the bundle
directly.

## Verify

Reproduce the upstream portions of this copy at any time:

```powershell
git clone --depth 1 --branch v0.5.2 https://github.com/Sanqi-normal/dsh-webui-market-plugin.git $tmp
# copy package.json cordis.patch.yml README.md LICENSE lib/host.js data/ into resources/market-plugin
# lib/client.js in this directory is the DSH Desktop redesign (MIT), not the upstream file
```
