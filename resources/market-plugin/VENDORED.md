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

The **Host half is based on upstream**: `lib/host.js` is copied from the fixed
tag and kept API-compatible with it — the `/api/dsh-market` route, the catalog
listing with offline snapshot fallback, the install/uninstall/update FIFO
queue via the `dsh plugin` CLI, the whitelist + trial-boot checks,
disable/enable persistence, and the op queue/kill contract are all
byte-for-byte identical to upstream. On top of that, DSH Desktop adds two
small portability patches to the Host:

- a **bundled-pnpm PATH shim fallback**: `pnpmEnv()` re-prepends the
  `DSH_MARKET_PNPM_DIR` shim directory (created by the desktop, see
  `src/pnpm-runtime.js`) to the PATH of every spawned dsh/pnpm child, so
  `dsh plugin` can resolve `pnpm` even when nothing installed it globally on
  Windows; and
- a **human-readable pnpm-missing failure**: a fast pre-flight pnpm check plus
  a mojibake-safe close handler replace the raw "command not found" output
  (which arrives as GBK mojibake on Windows) with a clean Chinese hint.

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
- `data/catalog-snapshot.json` — offline catalog snapshot used when the
  awesome-dsh-plugin.com JSON API is unreachable

`lib/host.js` is upstream with the two DSH Desktop portability patches listed
above; everything else in the Host's API contract is unchanged.

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
directly. For in-web installs, DSH Desktop additionally provisions the bundled
pnpm via a PATH shim (`src/pnpm-runtime.js`) and passes the augmented PATH and
`DSH_MARKET_PNPM_DIR` to the DSH process it launches, so `dsh plugin`'s pnpm
forwarding works under npx/global/bundled launches even when pnpm was never
installed globally.

## Verify

Reproduce the upstream portions of this copy at any time:

```powershell
git clone --depth 1 --branch v0.5.2 https://github.com/Sanqi-normal/dsh-webui-market-plugin.git $tmp
# copy package.json cordis.patch.yml README.md LICENSE data/ into resources/market-plugin
# lib/client.js in this directory is the DSH Desktop redesign (MIT), not the upstream file
# lib/host.js is upstream plus the DSH Desktop pnpm portability patches described above
```
