// Browser half of the persistent plugin market. Loaded through the web
// plugin loader (window.__ModuleLoader__); React comes from the platform
// module table. Talks to the Host half over the /api/dsh-market HTTP route.
//
// This client is an ORIGINAL, independently redesigned user interface for the
// DSH Desktop distribution of the market bundle: the UI/CSS is a from-scratch
// "command center / list" layout (see VENDORED.md) while the host API contract
// is preserved byte-for-byte — same POST /api/dsh-market methods (list, probe,
// installed, installedAll, updates, updateAll, update, op, kill, clear,
// clearAll, install, uninstall, disable, enable), same payloads, same op-queue
// polling protocol.
//
// Install/uninstall run as background ops on the Host: the panel submits, gets
// an op id, and polls. The op lives in a fixed modal overlay (never lost by
// scrolling), can be minimized to a status chip, and survives page refreshes.
window.__ModuleLoader__.load({ id: '@sanqi-normal/dsh-webui-market-plugin', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;

  const React = require('react')
  const { useState, useEffect, useRef } = React
  const h = React.createElement

  // Browser-side request timeout: the host is normally fast, but catalog /
  // update-detection endpoints can wait on external networks (plugins.json,
  // GitHub API, npm registry). Without a timeout a stuck proxy/gateway makes
  // the panel look frozen. 30s is generous for the slowest endpoint (updates)
  // while still failing visibly instead of hanging forever.
  const API_TIMEOUT_MS = 30000
  function api(method, params) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    return fetch('/api/dsh-market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ method }, params || {})),
      signal: ctrl.signal,
    }).then((r) => {
      clearTimeout(timer)
      return r.json()
    }).catch((e) => {
      clearTimeout(timer)
      if (e && e.name === 'AbortError') {
        const err = new Error('请求超时（' + Math.round(API_TIMEOUT_MS / 1000) + 's），请检查网络或稍后重试')
        err.name = 'AbortError'
        throw err
      }
      throw e
    })
  }

  function repoNameOf(url) {
    const t = String(url || '').replace(/\/+$/, '')
    const i = t.lastIndexOf('/')
    return i >= 0 ? t.slice(i + 1) : t
  }

  function repoOfValue(v) {
    const s = String(v || '').replace(/\/+$/, '')
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf(':'))
    return s.slice(i + 1).replace(/\.git$/, '').replace(/#.*$/, '')
  }

  // Full GitHub identity "owner/repo" (lowercased) from a url, github: spec,
  // dependency value or manifest repository field. Strips scheme/host, .git,
  // #fragment and monorepo sub-paths; scoped npm names (@scope/name) and
  // version/relative specs return null because an npm scope is not the same
  // as a GitHub owner — a null identity must never block the basename fallback.
  function repoPathOf(v) {
    const s = String(v || '').trim()
    if (!s) return null
    let t = s.replace(/^git\+/, '').replace(/^github:/i, '').replace(/#.*$/, '')
    t = t.replace(/^https?:\/\/[^/]+\//i, '')
    t = t.replace(/\.git$/, '').replace(/\/+$/, '')
    const parts = t.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const id = parts[0] + '/' + parts[1]
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) return null
    return id.toLowerCase()
  }

  // Installed state is keyed per profile (each plugin's install command may
  // target a different profile). installedPkgName matches one profile's
  // dependency keys/values against the plugin's GitHub identity, preferring
  // the full "owner/repo" identity over the repo basename: when the market
  // carries same-named plugins from different authors (e.g. two dsh-memory
  // repos), installing one must not mark the other author's card installed.
  // Pass 1 uses authoritative identities — the host-resolved repos map, then
  // github: values / "owner/repo"-shaped keys. If any dependency carries a
  // known identity, the result is decided by identity alone and the basename
  // fallback is disabled (a known different author must never match by name).
  // Pass 2 is the legacy basename rule (case-insensitive, issue #1) for
  // installs whose full identity cannot be resolved client-side (plain npm
  // deps, bundle entries) — kept so pre-existing npm installs still match.
  function installedPkgName(plugin, installed) {
    if (!installed) return null
    const repo = repoNameOf(plugin.url).toLowerCase()
    const ident = repoPathOf(plugin.url)
    const deps = installed.dependencies || {}
    const repos = (installed.repos && typeof installed.repos === 'object') ? installed.repos : null
    const depIdentity = (key) => {
      if (repos && repos[key]) return String(repos[key]).toLowerCase()
      const fromValue = repoPathOf(deps[key])
      if (fromValue) return fromValue
      return repoPathOf(key)
    }
    let knownIdentitySeen = false
    for (const key of Object.keys(deps)) {
      const di = depIdentity(key)
      if (!di) continue
      knownIdentitySeen = true
      if (ident && di === ident) return key
    }
    if (ident && knownIdentitySeen) return null
    for (const key of Object.keys(deps)) {
      const k = key.toLowerCase()
      if (k === repo || k.endsWith('/' + repo) || k === 'github:' + repo) return key
      if (repoOfValue(deps[key]).toLowerCase() === repo) return key
    }
    for (const b of installed.bundles || []) {
      const n = String(b || '').toLowerCase()
      if (n === repo || n.endsWith('/' + repo) || n === 'github:' + repo) return b
    }
    return null
  }

  // installed is a { profile: state } map; a plugin is installed when the state
  // of its own target profile matches.
  function isInstalled(plugin, installedMap) {
    const state = installedMap && installedMap[plugin.profile || 'web']
    return installedPkgName(plugin, state) !== null
  }

  // Rebuild the "本机插件" inventory from the older `installed` endpoint. Old
  // host versions (pre-installedAll) return "unknown method installedAll"; the
  // `installed` payload already has dependencies/bundles/repos/disabled, so we
  // can still show every dependency-managed plugin, including out-of-catalog
  // and non-bundle (client-only) plugins, without needing per-package manifests.
  function localFromInstalled(state, catalogPlugins) {
    if (!state) return { plugins: [], builtin: [] }
    const deps = state.dependencies || {}
    const bundles = Array.isArray(state.bundles) ? state.bundles : []
    const disabled = Array.isArray(state.disabled) ? state.disabled : []
    const repos = (state.repos && typeof state.repos === 'object') ? state.repos : {}
    const catalog = Array.isArray(catalogPlugins) ? catalogPlugins : []
    const plugins = Object.keys(deps).map((name) => {
      const spec = String(deps[name] || '')
      const kind = spec.startsWith('github:') ? 'github' : spec.startsWith('link:') ? 'link' : spec.startsWith('file:') ? 'file' : 'npm'
      const repo = repos[name] || repoPathOf(spec) || repoPathOf(name)
      return {
        name,
        spec,
        repo,
        version: null,
        kind,
        isBundle: false, // not available from `installed`; unused after the list shows all deps
        inBundles: bundles.includes(name),
        disabled: disabled.includes(name),
        inCatalog: catalog.some((p) => installedPkgName(p, state) === name),
      }
    })
    const builtin = bundles.filter((name) => deps[name] === undefined)
    return { plugins, builtin }
  }

  let LOCALE = 'en'
  try {
    const nl = String(navigator.language || navigator.userLanguage || '')
    if (nl.toLowerCase().startsWith('zh')) LOCALE = 'zh'
  } catch (e) {}

  // Set by apply() so the market panel can open a new DSH conversation with
  // the failed op's context when the user clicks "Ask DSH".
  let ROOT_CTX = null

  const STR = {
    zh: {
      search: '搜索插件…', all: '全部', instFilter: '已安装', detail: '详情', collapse: '收起',
      install: '安装', uninstall: '卸载', execute: '执行', cancel: '取消', close: '关闭',
      loading: '加载插件目录…', noMatch: '没有匹配的插件',
      binPlaceholder: 'dsh CLI 路径（自动探测失败时填写，已记住上次填写）', binHint: '未探测到 dsh：可在上面填写 dsh 仓库根目录下的 apps/cli/lib/bin.js（源码启动为 apps/cli/src/bin.ts），或设置 DSH_BIN 指向该文件后重启 web', reprobe: '重新探测',
      installOk: '安装成功，下次重启 Web 服务后生效', uninstallOk: '卸载成功，下次重启 Web 服务后生效', opFailed: '操作失败',
      askDsh: '询问 DSH', askDshUnavailable: '无法打开新对话：会话服务不可用', askDshSent: '已在新对话中发送问题，请查看新会话', askDshFailed: '发送到新对话失败',
      hotOk: '安装成功，已热挂载，即将自动刷新页面生效',
      updateOk: '更新成功，下次重启 Web 服务后生效', updateBtn: '更新', updating: '更新中…', upToDate: '已是最新',
      updateFail: '更新检测失败', updLocal: '本地链接',
      running: '执行中…（pnpm 安装可能需要一段时间）',
      cmdLabel: '安装命令（来自官网，含目标 profile）:', noCmd: '（无官方安装命令）',
      hint: '安装后需重启 Web 服务生效；GitHub 源会执行包内 prepare 脚本（pnpm allowBuilds 需放行）。安装进 web 前会做两层安全把关：① 只允许安装精选目录收录的源；② 试装验证——在临时环境实际启动一次，确认 web 能正常启动才写入真实 profile。验证失败会给出真实启动错误且不改动现有安装；简单插件装好后会自动热挂载（无需重启）。确实需要强制安装时可勾选"跳过安全检查"（风险自负）。',
      gh: 'GitHub ↗', envLine: '环境', parseFail: '解析失败', fetchFail: '抓取失败',
      submit: '提交任务…', probing: '试装验证中…（临时环境实际启动验证 web 可正常启动后才安装，约 1~6 分钟）', min: '最小化到后台', kill: '终止任务', back: '返回',
      stDone: '完成', stFailed: '失败', stKilled: '已终止', stTimeout: '超时终止',
      stPending: '排队中', stChecking: '校验中', stBusy: '已有任务进行中', stRefused: '已拒绝', liveChip: '插件任务',
      elapsed: '已耗时 {s}s（超过 {t}s 自动终止）', newOp: '新任务',
      site: '插件目录来源',
      sortDefault: '默认', sortHot: '最热', sortNew: '最新',
      queueTitle: '任务队列', queueProgress: '共 {total} 项 · {active} 项进行中/排队', log: '日志', clearTask: '清除', clearAll: '清空', cancelQueued: '取消排队', recentTasks: '最近任务',
      updateAll: '一键更新全部', noUpdatable: '没有可更新的插件',
      disable: '停用', enable: '启用', disabledState: '已停用',
      localPlugins: '本机插件', localPluginsCount: '本机插件 {n}', localBuiltin: '内置', localCatalog: '目录内', localExternal: '目录外',
      loadAll: '显示全部', loadedCount: '已显示 {shown}/{total}',
      localPlainDeps: '普通依赖（非 bundle，不在此列）', noLocal: '没有依赖管理的插件',
      kindGithub: 'GitHub', kindNpm: 'npm', kindLink: '本地链接', kindFile: '本地文件',
    },
    en: {
      search: 'Search plugins…', all: 'All', instFilter: 'Installed', detail: 'Details', collapse: 'Collapse',
      install: 'Install', uninstall: 'Uninstall', execute: 'Run', cancel: 'Cancel', close: 'Close',
      loading: 'Loading plugin directory…', noMatch: 'No matching plugins',
      binPlaceholder: 'dsh CLI path (fill when auto-detection fails; remembered)', binHint: 'dsh not detected: fill apps/cli/lib/bin.js under the dsh repo root (source: apps/cli/src/bin.ts), or set DSH_BIN to it and restart web', reprobe: 'Re-probe',
      installOk: 'Installed — restart the web server to activate', uninstallOk: 'Uninstalled — restart the web server to activate', opFailed: 'Operation failed',
      askDsh: 'Ask DSH', askDshUnavailable: 'Unable to open a new conversation: session service unavailable', askDshSent: 'Question sent to a new conversation', askDshFailed: 'Failed to send to the new conversation',
      hotOk: 'Installed and hot-mounted — refreshing the page now',
      updateOk: 'Updated — restart the web server to activate', updateBtn: 'Update', updating: 'Updating…', upToDate: 'Up to date',
      updateFail: 'Update check failed', updLocal: 'linked (dev)',
      running: 'Running… (pnpm install may take a while)',
      cmdLabel: 'Install command (from the site, incl. target profile):', noCmd: '(no official install command)',
      hint: 'Restart the web server after install. GitHub sources run the package prepare script (pnpm allowBuilds). Installing into web is gated twice: ① only sources from the curated catalog are accepted; ② a trial boot installs the plugin into a throwaway environment and starts it once — only a clean boot (the dsh web: readiness line) allows the install, and on failure the real boot error is shown with nothing modified. Simple plugins are hot-mounted after install (no restart). To force-install anyway, tick "skip safety checks" (at your own risk).',
      gh: 'GitHub ↗', envLine: 'Env', parseFail: 'Parse failed', fetchFail: 'Fetch failed',
      submit: 'Submitting…', probing: 'Trial-boot verifying… (installing into a throwaway env and starting it once to prove web still boots; ~1-6 min)', min: 'Minimize to background', kill: 'Kill task', back: 'Back',
      stDone: 'Done', stFailed: 'Failed', stKilled: 'Killed', stTimeout: 'Timed out',
      stPending: 'Queued', stChecking: 'Checking', stBusy: 'A task is already running', stRefused: 'Refused', liveChip: 'Plugin task',
      elapsed: '{s}s elapsed (auto-kill after {t}s)', newOp: 'New task',
      site: 'Plugin directory source',
      sortDefault: 'Default', sortHot: 'Top', sortNew: 'New',
      queueTitle: 'Task queue', queueProgress: '{total} total · {active} active/queued', log: 'Log', clearTask: 'Clear', clearAll: 'Clear all', cancelQueued: 'Cancel', recentTasks: 'Recent tasks',
      updateAll: 'Update all', noUpdatable: 'No updatable plugins',
      disable: 'Disable', enable: 'Enable', disabledState: 'Disabled',
      localPlugins: 'Local plugins', localPluginsCount: 'Local plugins {n}', localBuiltin: 'Built-in', localCatalog: 'In catalog', localExternal: 'External',
      loadAll: 'Show all', loadedCount: '{shown}/{total} shown',
      localPlainDeps: 'Plain dependencies (not bundles) are omitted here', noLocal: 'No dependency-managed plugins',
      kindGithub: 'GitHub', kindNpm: 'npm', kindLink: 'Local link', kindFile: 'Local file',
    },
  }
  const t = (k) => { const m = STR[LOCALE]; return (m && m[k] !== undefined) ? m[k] : (STR.zh[k] !== undefined ? STR.zh[k] : k) }
  const fmt = (k, map) => String(t(k)).replace(/\{(\w+)\}/g, (_, n) => String(map[n] !== undefined ? map[n] : ''))

  // Original command-center stylesheet for the DSH Desktop distribution. This
  // is an independent design: a status "banner" of KPIs, a command "palette"
  // (search / CLI path), a "rail" of category commands, and a numbered list of
  // plugin rows, with a docked op "deck" for the background task queue.
  const WMP_CSS = `
.wmp{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-primary);max-width:64rem}
.wmp-banner{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;margin-bottom:10px}
.wmp-kpi{background:var(--dsw-alias-bg-layer-2);padding:9px 12px;display:flex;flex-direction:column;gap:3px;min-width:0}
.wmp-kpi .wmp-k{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.wmp-kpi .wmp-v{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,monospace}
.wmp-kpi .wmp-v-bad{color:var(--dsw-alias-label-error)}
.wmp-kpi .wmp-v-ok{color:var(--dsw-alias-state-success-primary)}
.wmp-palette{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);margin-bottom:8px}
.wmp-search{flex:1 1 240px;min-width:0;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:7px 11px;caret-color:var(--dsw-alias-brand-primary)}
.wmp-search::placeholder,.wmp-bin::placeholder{color:var(--dsw-alias-label-tertiary)}
.wmp-search:focus-visible,.wmp-bin:focus-visible{outline:1px solid var(--dsw-alias-brand-primary)}
.wmp-bin{flex:1 1 220px;min-width:0;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,monospace;font-size:12px;padding:6px 10px;caret-color:var(--dsw-alias-brand-primary)}
.wmp-count{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.wmp-btn{appearance:none;background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);padding:5px 13px;cursor:pointer;white-space:nowrap}
.wmp-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.wmp-btn:disabled{opacity:.4;cursor:default}
.wmp-btn-primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.wmp-btn-primary:hover:not(:disabled){opacity:.85;color:var(--dsw-alias-bg-layer-3)}
.wmp-btn-danger{color:var(--dsw-alias-label-error)}
.wmp-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}
.wmp-btn-on{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.wmp-rail{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:4px 2px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:8px}
.wmp-chip{font-size:12px;color:var(--dsw-alias-label-secondary);background:none;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 11px;cursor:pointer}
.wmp-chip small{color:var(--dsw-alias-label-tertiary);font-size:10px}
.wmp-chip:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}
.wmp-chip:disabled{opacity:.4;cursor:default}
.wmp-chip-on{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.wmp-chip-on small{color:inherit;opacity:.8}
.wmp-sort{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px;margin-left:auto;flex-shrink:0}
.wmp-sort button{border:none;background:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);padding:3px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}
.wmp-sort button.on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);font-weight:600}
.wmp-list{display:flex;flex-direction:column;gap:14px}
.wmp-group-head{display:flex;align-items:baseline;gap:8px;padding:4px 2px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.wmp-group-head small{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.wmp-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:11px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s;align-items:start}
.wmp-row:hover{border-color:var(--dsw-alias-label-dimmed)}
.wmp-index{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:44px;padding-top:3px}
.wmp-main{min-width:0}
.wmp-name{font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);text-decoration:none}
.wmp-name:hover{color:var(--dsw-static-deepseek-500)}
.wmp-by{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:6px}
.wmp-stars{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:6px}
.wmp-gh{margin-left:8px;font-size:11px;color:var(--dsw-static-deepseek-500);text-decoration:none}
.wmp-gh:hover{text-decoration:underline}
.wmp-desc{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px;max-width:54em;overflow-wrap:break-word}
.wmp-detail{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.wmp-detail code{display:block;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;margin:6px 0;white-space:pre-wrap;word-break:break-all}
.wmp-actions{display:flex;flex-direction:row;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.wmp-state{font-size:11px;padding:1px 9px;border-radius:999px;line-height:18px;font-weight:500;white-space:nowrap}
.wmp-state-on{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}
.wmp-state-off{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.wmp-state-warn{background:color-mix(in srgb, var(--dsw-alias-state-warn-label) 14%, transparent);color:var(--dsw-alias-state-warn-label)}
.wmp-log{background:#1e1e1e;color:#d4d4d4;border-radius:8px;padding:8px 10px;margin-top:6px;white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:240px;overflow:auto}
.wmp-err{color:var(--dsw-alias-label-error);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);border-radius:8px;padding:6px 10px;margin-bottom:10px}
.wmp-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px}
.wmp-site{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0 2px 8px}
.wmp-site a{color:var(--dsw-static-deepseek-500);text-decoration:none}
.wmp-site a:hover{text-decoration:underline}
.wmp-modal-bg{position:fixed;inset:0;z-index:1000;background:color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 24px;overflow:auto}
.wmp-modal{width:min(760px,100%);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:16px 18px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.wmp-modal h4{margin:0 0 10px;font-size:15px;font-weight:600}
.wmp-cmdrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.wmp-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-static-deepseek-500);border-radius:50%;animation:wmp-spin .7s linear infinite;vertical-align:-2px;margin-right:7px}
@keyframes wmp-spin{to{transform:rotate(360deg)}}
.wmp-skipcheck{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:8px;cursor:pointer}
.wmp-deck{position:fixed;right:14px;bottom:14px;z-index:999;width:min(540px,calc(100vw - 28px));max-height:min(58vh,500px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 12px 40px rgba(0,0,0,.28)}
.wmp-deck-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px}
.wmp-deck-head small{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.wmp-deck-history{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wmp-deck-history summary{cursor:pointer;color:var(--dsw-alias-label-tertiary)}
.wmp-fab{position:fixed;right:14px;bottom:14px;z-index:999}
.wmp-livechip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-static-deepseek-500);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;cursor:pointer;white-space:nowrap;background:var(--dsw-alias-bg-layer-3)}
.wmp-livechip:hover{border-color:var(--dsw-alias-label-dimmed)}
.wmp-livechip-done{color:var(--dsw-alias-state-success-primary)}
.wmp-livechip-err{color:var(--dsw-alias-label-error)}
.wmp-qrow{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px}
.wmp-qmain{flex:1;min-width:0}
.wmp-qtitle{font-weight:500;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.wmp-qstatus{font-size:11px;padding:0 8px;border-radius:999px;line-height:17px;white-space:nowrap}
.wmp-qs-on{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}
.wmp-qs-wait{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.wmp-qs-err{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-label-error)}
.wmp-qs-running{color:var(--dsw-static-deepseek-500)}
.wmp-qactions{flex:none;display:flex;gap:4px}
.wmp-local{margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:10px 12px}
.wmp-local-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.wmp-local-item{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;margin-bottom:5px;font-size:12px;background:var(--dsw-alias-bg-layer-3);flex-wrap:wrap}
.wmp-local-name{font-weight:600;font-family:ui-monospace,monospace}
.wmp-local-meta{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,monospace;font-size:11px}
.wmp-tag{font-size:10.5px;padding:0 7px;border-radius:999px;line-height:16px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.wmp-tag-on{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}
.wmp-tag-off{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary)}
.wmp-tag-warn{color:var(--dsw-alias-label-error)}
`

  function MarketPanel() {
    const INITIAL_VISIBLE = 60
    const VISIBLE_STEP = 60
    const TERMINAL = ['done', 'failed', 'killed', 'timeout', 'refused']
    const [data, setData] = useState({ phase: 'loading', plugins: [], cats: [], installed: null, updates: null, error: null })
    const [envInfo, setEnvInfo] = useState(null)
    const [binPath, setBinPath] = useState((() => { try { return localStorage.getItem('mktsBin') || '' } catch (e) { return '' } })())
    const [query, setQuery] = useState('')
    const [cat, setCat] = useState('all')
    const [showInstalled, setShowInstalled] = useState(false)
    const [sortBy, setSortBy] = useState('default')
    const [open, setOpen] = useState(null)
    const [op, setOp] = useState(null) // confirmation modal for the next op
    const [ops, setOps] = useState([]) // server queue snapshot rows
    const [queueOpen, setQueueOpen] = useState(true)
    const [notice, setNotice] = useState(null)
    const [local, setLocal] = useState(null) // installedAll inventory
    const [localOpen, setLocalOpen] = useState(false)
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
    const pollStop = useRef(false)
    const pollingRef = useRef(false)
    const pollAgainRef = useRef(false)
    const wasActiveRef = useRef(false)
    const dismissedRef = useRef(new Set())
    const prefillDone = useRef(false)
    const askBusyRef = useRef(false)
    useEffect(() => () => { pollStop.current = true }, [])

    const changeBin = (v) => { setBinPath(v); try { localStorage.setItem('mktsBin', v) } catch (e) {} }

    const probe = () => {
      api('probe', { binPath }).then((r) => {
        setEnvInfo(r)
        // One-shot prefill: surface the CLI path actually in use (or the cwd
        // checkout candidate) in the input so it is visible and remembered.
        // The bare 'dsh' PATH fallback is skipped: it is a shell name, not a
        // node script path, so it must not be sent as an explicit bin.
        if (!prefillDone.current && !binPath) {
          const usable = r && r.dshBin && r.dshBin !== 'dsh' ? r.dshBin : ((r && r.cwdBin) || '')
          if (usable) {
            setBinPath(usable)
            try { localStorage.setItem('mktsBin', usable) } catch (e) {}
          }
          prefillDone.current = true
        }
      }).catch(() => setEnvInfo({ error: 'probe failed' }))
    }

    const loadInstalled = (plugins) => {
      const list = plugins || data.plugins || []
      const profiles = [...new Set(list.map((p) => p.profile || 'web').concat('web'))]
      Promise.all(profiles.map((profile) => api('installed', { profile }).then((r) => [profile, r]).catch(() => [profile, null])))
        .then((entries) => setData((d) => ({ ...d, installed: Object.fromEntries(entries) })))
        .catch(() => setData((d) => ({ ...d, installed: null })))
      Promise.all(profiles.map((profile) => api('updates', { profile }).then((r) => [profile, r && r.ok ? (r.updates || {}) : {}]).catch(() => [profile, {}])))
        .then((entries) => setData((d) => ({ ...d, updates: Object.fromEntries(entries) })))
        .catch(() => setData((d) => ({ ...d, updates: null })))
    }

    const loadLocal = () => {
      const openFallback = (state) => {
        setLocal(localFromInstalled(state, data.plugins || []))
        setLocalOpen(true)
      }
      api('installedAll', { profile: 'web' }).then((r) => {
        if (r && r.ok) {
          setLocal({ plugins: r.plugins || [], builtin: r.builtin || [] })
          setLocalOpen(true)
          return
        }
        // Older host without installedAll: fall back to `installed`, which has
        // existed since the first release. This keeps the "本机插件" button
        // working instead of surfacing "unknown method installedAll".
        const state = data.installed && data.installed.web
        if (state) {
          openFallback(state)
          return
        }
        api('installed', { profile: 'web' }).then((inst) => {
          if (inst && inst.ok) openFallback(inst)
          else setNotice(String((r && (r.error || r.output)) || (inst && (inst.error || inst.output)) || t('opFailed')))
        }).catch((e) => setNotice(String((e && e.message) || e)))
      }).catch((e) => setNotice(String((e && e.message) || e)))
    }

    useEffect(() => { probe() }, [])

    useEffect(() => {
      let alive = true
      setData((d) => ({ ...d, phase: 'loading', error: null }))
      const finish = (r) => {
        if (!alive || !r || !r.ok) throw new Error((r && r.error) || 'empty')
        setData((d) => ({ ...d, phase: 'ready', plugins: r.plugins || [], cats: r.cats || [], source: r.source || null }))
        loadInstalled(r.plugins || [])
      }
      api('list', { lang: LOCALE }).then(finish).catch((e) => {
        if (!alive) return
        setData((d) => ({ ...d, phase: 'error', error: t('fetchFail') + ': ' + String((e && e.message) || e) }))
      })
      return () => { alive = false }
    }, [])

    // Mitigate the "market tab jank": the catalog can hold hundreds of cards;
    // reveal them in small batches so React commits stay short and the browser
    // main thread never renders the whole directory in one frame.
    useEffect(() => {
      const total = (data.plugins || []).length
      setVisibleCount(INITIAL_VISIBLE)
      if (total <= INITIAL_VISIBLE) return
      let shown = INITIAL_VISIBLE
      const timer = setInterval(() => {
        shown = Math.min(shown + VISIBLE_STEP, total)
        setVisibleCount(shown)
        if (shown >= total) clearInterval(timer)
      }, 80)
      return () => clearInterval(timer)
    }, [data.plugins])

    function mergeOps(prev, server) {
      const byId = new Map()
      for (const o of server) {
        if (!dismissedRef.current.has(o.id)) byId.set(o.id, o)
      }
      const kept = prev.filter((o) => !byId.has(o.id))
      return [...byId.values(), ...kept]
    }

    function pollOps() {
      // One request in flight at a time; a call arriving while one is in
      // flight (e.g. right after enqueue) requests one immediate follow-up.
      if (pollingRef.current) { pollAgainRef.current = true; return }
      pollingRef.current = true
      api('op', {}).then((r) => {
        const again = pollAgainRef.current
        pollAgainRef.current = false
        pollingRef.current = false
        if (pollStop.current) return
        if (!r || !r.ok) {
          if (again) pollOps()
          else setTimeout(pollOps, 3000)
          return
        }
        const server = [
          ...(r.op ? [r.op] : []),
          ...(r.queue || []),
          ...(r.history || []),
        ]
        setOps((prev) => mergeOps(prev, server))
        const active = server.filter((o) => o.status === 'pending' || o.status === 'checking' || o.status === 'running')
        const wasActive = wasActiveRef.current
        wasActiveRef.current = active.length > 0
        if (again) {
          pollOps()
        } else if (active.length > 0) {
          setTimeout(pollOps, 2000)
        } else if (wasActive) {
          loadInstalled()
          const hotDone = server.some((o) => o.status === 'done' && o.hot === true && o.kind === 'install')
          if (hotDone) setTimeout(() => { try { location.reload() } catch (e) {} }, 1600)
        }
      }).catch(() => {
        const again = pollAgainRef.current
        pollAgainRef.current = false
        pollingRef.current = false
        if (pollStop.current) return
        if (again) pollOps()
        else setTimeout(pollOps, 3000)
      })
    }

    // Resume the server-side queue after a page refresh / tab switch.
    useEffect(() => { pollOps() }, [])

    const runOp = (kind, target, label, profile) => {
      setOp({ kind, target, label, profile: profile || 'web', phase: 'confirm' })
    }

    const executeOp = () => {
      if (!op) return
      setOp({ ...op, phase: 'starting', output: '' })
      const params = op.kind === 'install'
        ? { source: op.target, profile: op.profile, binPath, label: op.label, skipCheck: !!op.skipCheck }
        : op.kind === 'update'
          ? { name: op.target, profile: op.profile, binPath, label: op.label }
          : { pkg: op.target, profile: op.profile, binPath, label: op.label }
      api(op.kind === 'uninstall' ? 'uninstall' : (op.kind === 'update' ? 'update' : 'install'), params).then((r) => {
        if (!r || !r.ok) {
          // busy/refused are real rejections; a plain non-ok with no such
          // marker is treated conservatively as a failed submission.
          setOp({
            ...op, phase: 'done', status: r && r.busy ? 'busy' : (r && r.refused ? 'refused' : 'failed'),
            output: String((r && (r.output || r.error)) || t('opFailed')), ok: false,
          })
          return
        }
        // Enqueued: close the confirm modal and let the queue panel own the
        // status from now on.
        setOp(null)
        setOps((prev) => [...prev, {
          id: r.opId, kind: op.kind, profile: op.profile, target: op.target, label: op.label,
          status: 'pending', output: '', exitCode: null, hot: false,
          elapsedMs: 0, timeoutMs: r.timeoutMs, startedAt: Date.now(),
        }])
        wasActiveRef.current = true
        pollOps()
      }).catch((e) => {
        // The POST may have reached the server even though the response was
        // lost (network blip / proxy timeout). Before declaring failure, poll
        // the queue once: if the op is already there, resume normally.
        api('op', {}).then((r) => {
          if (pollStop.current) return
          const list = r && r.ok ? [...(r.op ? [r.op] : []), ...(r.queue || [])] : []
          const found = list.find((o) => o && o.kind === op.kind && o.profile === (op.profile || 'web')
            && o.target === op.target)
          if (found) {
            setOp(null)
            setOps((prev) => [...prev, {
              id: found.id, kind: op.kind, profile: op.profile || 'web', target: op.target, label: op.label,
              status: found.status || 'pending', output: found.output || '', exitCode: null, hot: false,
              elapsedMs: found.elapsedMs || 0, timeoutMs: found.timeoutMs || 120000, startedAt: Date.now(),
            }])
            wasActiveRef.current = true
            pollOps()
            return
          }
          setOp({ ...op, phase: 'done', status: 'failed', output: String((e && e.message) || e), ok: false })
        }).catch(() => {
          setOp({ ...op, phase: 'done', status: 'failed', output: String((e && e.message) || e), ok: false })
        })
      })
    }

    const killOpById = (opId) => {
      api('kill', opId ? { opId } : {}).then((r) => {
        if (!r || !r.ok) {
          setNotice(String((r && (r.output || r.error)) || t('opFailed')))
        } else {
          setNotice(null)
          pollOps()
        }
      }).catch((e) => setNotice(String((e && e.message) || e)))
    }

    const clearOpRow = (id) => {
      // Clear is persisted host-side, so a refresh or panel reopen no longer
      // resurrects dismissed finished tasks.
      api('clear', { opId: id }).then((r) => {
        if (r && r.ok) {
          dismissedRef.current.add(id)
          setOps((prev) => prev.filter((o) => o.id !== id))
        } else {
          setNotice(String((r && (r.output || r.error)) || t('opFailed')))
        }
      }).catch((e) => setNotice(String((e && e.message) || e)))
    }

    const clearAllOps = () => {
      api('clearAll', {}).then((r) => {
        if (r && r.ok) {
          const terminal = new Set(TERMINAL)
          // Keep only live/queued rows; the host has dismissed every terminal
          // op, so a refresh/reopen cannot resurrect them either.
          setOps((prev) => prev.filter((o) => !terminal.has(o.status)))
          setNotice(null)
        } else {
          setNotice(String((r && (r.output || r.error)) || t('opFailed')))
        }
      }).catch((e) => setNotice(String((e && e.message) || e)))
    }

    const askDsh = (o) => {
      const root = ROOT_CTX
      if (!root || !root.sessions) {
        setNotice(t('askDshUnavailable'))
        return
      }
      if (askBusyRef.current) return
      askBusyRef.current = true
      const kind = opKindText(o.kind)
      const target = o.label || o.target || o.kind
      const detail = [
        LOCALE === 'zh'
          ? '我在 dsh 插件市场中执行「' + kind + ' ' + target + '」失败，请帮我排查原因并给出解决方案。'
          : 'I hit a failure while running "' + kind + ' ' + target + '" in the dsh plugin market. Please help diagnose and fix it.',
        '',
        '- Operation: ' + (o.kind || ''),
        '- Plugin: ' + (o.label || ''),
        (o.target && o.target !== o.label) ? '- Target: ' + o.target : null,
        '- Profile: ' + (o.profile || 'web'),
        '- Status: ' + statusText(o.status) + (o.exitCode !== null && o.exitCode !== undefined ? ' (exit ' + o.exitCode + ')' : ''),
        envInfo ? '- Environment: DSH_HOME=' + (envInfo.dshHome || '?') + ', node=' + (envInfo.node ? 'yes' : 'no') + ', dsh=' + (binOk ? 'yes' : 'no') : null,
        '',
        LOCALE === 'zh' ? '错误日志：' : 'Error log:',
        '```',
        (o.output || (LOCALE === 'zh' ? '（无日志）' : '(no log)')).slice(0, 12000) + ((o.output || '').length > 12000 ? '\n...[truncated]' : ''),
        '```',
      ].filter(Boolean).join('\n')

      const send = (sessionId) => {
        try {
          root.sessions.open(sessionId)
          const binding = root.sessions.binding && root.sessions.binding(sessionId)
          const session = binding && binding.session
          if (!session) {
            askBusyRef.current = false
            setNotice(t('askDshUnavailable'))
            return
          }
          session.prompt([{ type: 'text', text: detail }], 'queue').then((r) => {
            askBusyRef.current = false
            if (r && r.ok) setNotice(t('askDshSent'))
            else setNotice(String((r && r.error && (r.error.message || r.error.code)) || t('askDshFailed')))
          }).catch((e) => {
            askBusyRef.current = false
            setNotice(String((e && e.message) || e))
          })
        } catch (e) {
          askBusyRef.current = false
          setNotice(String((e && e.message) || t('askDshFailed')))
        }
      }

      // Reuse the current/recent workspace when possible, so the new
      // conversation starts in the same context as the failed install.
      let workspaceId
      let cwd
      try {
        const wsList = root.workspaces && root.workspaces.list && root.workspaces.list.getSnapshot()
        const sList = root.sessions.list && root.sessions.list.getSnapshot()
        if (sList && sList.current !== undefined) {
          const current = sList.byId[sList.current]
          if (current && current.cwd) cwd = current.cwd
          if (wsList) workspaceId = wsList.items.find((w) => w.sessionIds.includes(sList.current))?.workspaceId
        }
        if (workspaceId === undefined && wsList) workspaceId = wsList.recentWorkspaceId
      } catch (e) {}

      const fail = (e) => {
        askBusyRef.current = false
        setNotice(String((e && e.message) || t('askDshFailed')))
      }
      if (workspaceId !== undefined && root.workspaces && root.workspaces.connectWorkspace) {
        root.workspaces.connectWorkspace(workspaceId).then(send, fail)
      } else if (cwd) {
        root.sessions.create({ cwd }).then(send, fail)
      } else {
        root.sessions.create({}).then(send, fail)
      }
    }

    const toggleQueue = () => setQueueOpen((v) => !v)
    const closeOp = () => setOp(null)

    const toggleDisabled = (name, profile, disable) => {
      api(disable ? 'disable' : 'enable', { name, profile: profile || 'web' }).then((r) => {
        if (r && r.ok) {
          setNotice(null)
          loadInstalled()
          if (localOpen) loadLocal()
        } else {
          setNotice(String((r && (r.output || r.error)) || t('opFailed')))
        }
      }).catch((e) => setNotice(String((e && e.message) || e)))
    }

    const runUpdateAll = () => {
      api('updateAll', { profile: 'web' }).then((r) => {
        if (!r || !r.ok) {
          setNotice(String((r && (r.output || r.error)) || t('opFailed')))
          return
        }
        setNotice(null)
        const ids = Array.isArray(r.opIds) ? r.opIds : []
        if (ids.length > 0) {
          const placeholders = ids.map((id) => ({
            id, kind: 'update', profile: 'web', target: '', label: t('updateAll'),
            status: 'pending', output: '', exitCode: null, hot: false,
            elapsedMs: 0, timeoutMs: 120000, startedAt: Date.now(),
          }))
          setOps((prev) => [...prev, ...placeholders])
          wasActiveRef.current = true
          pollOps()
        } else {
          setNotice(t('noUpdatable'))
        }
      }).catch((e) => setNotice(String((e && e.message) || e)))
    }

    const filtered = (data.plugins || []).filter((p) => {
      if (cat !== 'all' && p.cat !== cat) return false
      if (showInstalled && !isInstalled(p, data.installed)) return false
      const q = query.trim().toLowerCase()
      if (q && !((p.name || '').toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q) || (p.by || '').toLowerCase().includes(q))) return false
      return true
    })

    const installedCount = (data.plugins || []).filter((p) => isInstalled(p, data.installed)).length
    const updatableCount = (data.updates && data.updates.web
      ? Object.values(data.updates.web).filter((u) => u && u.updateAvailable && u.kind !== 'linked').length
      : 0)

    // Sort, mirroring dsh-market: 最热 = stars desc (unknown stars last),
    // 最新 = added date desc; 默认 keeps the site's own order.
    const sorted = sortBy === 'hot'
      ? [...filtered].sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
      : sortBy === 'new'
        ? [...filtered].sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')))
        : filtered
    const truncated = visibleCount < sorted.length

    // Build full groups (headers keep their real counts), then take the first
    // `visibleCount` cards across groups in display order — the batch-render
    // budget stays global while category counts stay truthful.
    let fullGroups = []
    if (cat === 'all' && !showInstalled) {
      for (const c of data.cats || []) {
        if (c.id === 'all') continue
        const items = sorted.filter((p) => p.cat === c.id)
        if (items.length > 0) fullGroups.push({ id: c.id, label: c.label, items })
      }
    } else {
      fullGroups.push({ id: 'sel', label: null, items: sorted })
    }
    let remaining = visibleCount
    const groups = fullGroups.map((g) => {
      const items = g.items.slice(0, remaining)
      remaining -= items.length
      return { id: g.id, label: g.label, items, total: g.items.length }
    })
    const shownCount = sorted.length - remaining

    const binOk = envInfo && (envInfo.dshBin || (envInfo.binProvided && envInfo.binValid))
    const envReady = envInfo && binOk && envInfo.node && envInfo.dshHome

    const statusText = (s) => ({
      done: t('stDone'), failed: t('stFailed'), killed: t('stKilled'),
      timeout: t('stTimeout'), busy: t('stBusy'), refused: t('stRefused'),
      pending: t('stPending'), checking: t('stChecking'),
    })[s] || (TERMINAL.includes(s) ? t('stFailed') : t('stPending'))

    const opKindText = (k) => (k === 'install' ? t('install') : k === 'update' ? t('updateBtn') : t('uninstall'))
    const opTitle = (op) => opKindText(op.kind) + ' ' + op.label

    const modal = op ? h('div', { className: 'wmp-modal-bg', onClick: () => { if (op.phase !== 'starting') closeOp() } },
      h('div', { className: 'wmp-modal', onClick: (e) => e.stopPropagation() },
        h('h4', null, opTitle(op)),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace,monospace' } },
          op.kind === 'uninstall'
            ? 'dsh plugin --profile ' + op.profile + ' remove ' + op.target
            : op.kind === 'update'
              ? 'dsh plugin --profile ' + op.profile + ' add <latest ' + op.target + '>'
              : 'dsh plugin --profile ' + op.profile + ' add ' + op.target),
        op.phase === 'confirm' ? h('div', null,
          h('div', { className: 'wmp-cmdrow' },
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '✓ ' + t('cmdLabel').replace(':', '') + ''),
            h('button', { className: 'wmp-btn wmp-btn-primary', onClick: executeOp }, t('execute')),
            h('button', { className: 'wmp-btn', onClick: closeOp }, t('cancel')),
          ),
          op.kind === 'install' ? h('label', { className: 'wmp-skipcheck' },
            h('input', { type: 'checkbox', checked: !!op.skipCheck, onChange: (e) => setOp((prev) => prev ? { ...prev, skipCheck: e.target.checked } : prev) }),
            h('span', null, LOCALE === 'zh' ? '跳过安全检查（来源白名单 + 试装验证，风险自负：可能装坏 web 启动）' : 'Skip safety checks (source whitelist + trial boot; risky: may break web boot)'),
          ) : null,
        ) : null,
        op.phase === 'starting' ? h('div', { className: 'wmp-cmdrow' },
          h('span', { className: 'wmp-spin' }), h('span', { style: { fontSize: 12 } },
            (op.kind === 'install' && op.profile === 'web' && !op.skipCheck) ? t('probing') : t('submit')),
        ) : null,
        op.phase === 'done' ? h('div', null,
          h('div', { style: { fontSize: 12, fontWeight: 600, color: op.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-error)' } },
            op.ok
              ? (op.kind === 'install'
                ? (op.hot ? t('hotOk') : t('installOk'))
                : op.kind === 'update'
                  ? t('updateOk')
                  : t('uninstallOk'))
              : statusText(op.status) + (op.exitCode !== null && op.exitCode !== undefined ? ' (exit ' + op.exitCode + ')' : '')),
          op.output ? h('div', { className: 'wmp-log' }, op.output) : null,
          h('div', { className: 'wmp-cmdrow' },
            !op.ok ? h('button', { className: 'wmp-btn wmp-btn-primary', onClick: () => askDsh(op) }, t('askDsh')) : null,
            h('button', { className: 'wmp-btn', onClick: closeOp }, t('close')),
          ),
        ) : null,
      )) : null

    const activeOps = ops.filter((o) => o.status === 'pending' || o.status === 'checking' || o.status === 'running')
    const localPlugins = local ? local.plugins : []
    const queueChip = ops.length > 0 ? h('button', {
      className: 'wmp-livechip' + (activeOps.length > 0 ? '' : (ops.some((o) => o.status === 'done') ? ' wmp-livechip-done' : ' wmp-livechip-err')),
      onClick: toggleQueue,
      title: t('queueTitle'),
    },
      t('liveChip'),
      ' · ' + (activeOps.length > 0 ? activeOps.length : '0'),
      ' / ' + ops.length,
    ) : null

    const activeRows = ops.filter((o) => !TERMINAL.includes(o.status))
    const historyRows = ops.filter((o) => TERMINAL.includes(o.status))
    const renderOpRow = (o) => {
      const terminal = TERMINAL.includes(o.status)
      const cls = o.status === 'done' ? ' wmp-qs-on' : terminal ? ' wmp-qs-err' : (o.status === 'pending' ? ' wmp-qs-wait' : ' wmp-qs-running')
      return h('div', { key: o.id, className: 'wmp-qrow' },
        h('div', { className: 'wmp-qmain' },
          h('div', { className: 'wmp-qtitle' },
            h('span', { className: 'wmp-qstatus' + cls }, statusText(o.status)),
            h('span', null, opKindText(o.kind) + ' ' + o.label),
            o.profile ? h('span', { className: 'wmp-local-meta' }, '@' + o.profile) : null,
            (o.status === 'running' || o.status === 'checking')
              ? h('span', { className: 'wmp-local-meta' }, fmt('elapsed', { s: Math.round((o.elapsedMs || 0) / 1000), t: o.timeoutMs ? Math.round(o.timeoutMs / 1000) : 120 }))
              : null,
          ),
          o.output ? h('details', null,
            h('summary', { style: { cursor: 'pointer', color: 'var(--dsw-alias-label-tertiary)' } }, t('log')),
            h('div', { className: 'wmp-log' }, o.output),
          ) : null,
        ),
        h('div', { className: 'wmp-qactions' },
          o.status === 'pending'
            ? h('button', { className: 'wmp-btn', onClick: () => killOpById(o.id) }, t('cancelQueued'))
            : null,
          (o.status === 'running' || o.status === 'checking')
            ? h('button', { className: 'wmp-btn wmp-btn-danger', onClick: () => killOpById(o.id) }, t('kill'))
            : null,
          terminal && o.status !== 'done' ? h('button', { className: 'wmp-btn wmp-btn-primary', onClick: () => askDsh(o) }, t('askDsh')) : null,
          terminal ? h('button', { className: 'wmp-btn', onClick: () => clearOpRow(o.id) }, t('clearTask')) : null,
        ),
      )
    }

    // Fixed bottom-right so the queue never scrolls out of sight; active rows
    // stay front and center, while terminal history is collapsed by default so
    // a previous failure cannot be mistaken for the just-enqueued op failing.
    const queuePanel = ops.length > 0 ? (
      queueOpen
        ? h('div', { className: 'wmp-deck' },
            h('div', { className: 'wmp-deck-head' },
              h('span', null, t('queueTitle')),
              h('small', null, fmt('queueProgress', { total: ops.length, active: activeOps.length })),
              h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
                h('button', { className: 'wmp-btn', disabled: historyRows.length === 0, onClick: clearAllOps, title: t('clearAll') }, t('clearAll')),
                h('button', { className: 'wmp-btn', onClick: toggleQueue }, t('collapse'))),
            ),
            activeRows.map(renderOpRow),
            historyRows.length > 0
              ? h('details', { className: 'wmp-deck-history' },
                  h('summary', null, t('recentTasks') + ' (' + historyRows.length + ')'),
                  historyRows.map(renderOpRow),
                )
              : null,
          )
        : h('div', { className: 'wmp-fab' },
            h('button', {
              className: 'wmp-livechip' + (activeRows.length > 0 ? '' : (historyRows.some((o) => o.status === 'done') ? ' wmp-livechip-done' : ' wmp-livechip-err')),
              onClick: toggleQueue,
              title: t('queueTitle'),
            }, t('liveChip'), ' · ' + activeRows.length + ' / ' + ops.length),
          )
    ) : null

    return h('div', { className: 'wmp' },
      // ── command-center banner: live environment readouts ──────────────
      h('div', { className: 'wmp-banner' },
        h('div', { className: 'wmp-kpi' },
          h('span', { className: 'wmp-k' }, t('envLine')),
          h('span', { className: 'wmp-v' + (envReady ? ' wmp-v-ok' : ' wmp-v-bad') },
            'DSH_HOME ' + (envInfo && envInfo.dshHome ? '✓' : '✗') + ' · node ' + (envInfo && envInfo.node ? '✓' : '✗') + ' · dsh ' + (binOk ? '✓' : '✗'))),
        h('div', { className: 'wmp-kpi' },
          h('span', { className: 'wmp-k' }, 'dsh CLI'),
          h('span', { className: 'wmp-v' + (binOk ? '' : ' wmp-v-bad') }, binOk ? ((envInfo.dshBin || '').split(/[\\/]/).pop() || envInfo.binProvided) : (LOCALE === 'zh' ? '未定位' : 'not found'))),
        h('div', { className: 'wmp-kpi' },
          h('span', { className: 'wmp-k' }, t('site')),
          h('span', { className: 'wmp-v' }, (data.plugins || []).length + ' ' + (LOCALE === 'zh' ? '个插件' : 'plugins') + (data.source ? ' · ' + data.source : ''))),
        h('div', { className: 'wmp-kpi' },
          h('span', { className: 'wmp-k' }, t('queueTitle')),
          h('span', { className: 'wmp-v' + (activeOps.length > 0 ? ' wmp-v-ok' : '') }, activeOps.length + ' / ' + ops.length)),
      ),
      // ── command palette: search, CLI path, actions ────────────────────
      h('div', { className: 'wmp-palette' },
        h('input', { className: 'wmp-search', placeholder: t('search'), value: query, onChange: (e) => setQuery(e.target.value) }),
        h('span', { className: 'wmp-count' }, filtered.length + ' / ' + (data.plugins || []).length),
        queueChip,
      ),
      envInfo ? h('div', { className: 'wmp-site' },
        h('span', null, t('site') + ': '),
        h('a', { href: LOCALE === 'zh' ? 'https://awesome-dsh-plugin.com/zh/' : 'https://awesome-dsh-plugin.com/', target: '_blank', rel: 'noopener noreferrer' },
          LOCALE === 'zh' ? 'https://awesome-dsh-plugin.com/zh/' : 'https://awesome-dsh-plugin.com/'),
        h('span', null, ' ↗'),
      ) : null,
      h('div', { className: 'wmp-palette' },
        h('input', { className: 'wmp-bin', placeholder: t('binPlaceholder'), value: binPath, onChange: (e) => changeBin(e.target.value) }),
        h('button', { className: 'wmp-btn', onClick: probe }, t('reprobe')),
        h('button', { className: 'wmp-btn' + (localOpen ? ' wmp-btn-on' : ''), onClick: localOpen ? () => setLocalOpen(false) : loadLocal }, t('localPlugins')),
      ),
      (!binPath && envInfo && !(envInfo.dshBin || (envInfo.binProvided && envInfo.binValid)))
        ? h('div', { className: 'wmp-hint' }, t('binHint'))
        : null,
      notice ? h('div', { className: 'wmp-err' }, notice) : null,
      localOpen && local ? h('div', { className: 'wmp-local' },
        h('div', { className: 'wmp-local-head' },
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('localPlugins')),
          h('small', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
            t('localPluginsCount').replace('{n}', String(localPlugins.length))),
        ),
        localPlugins.length === 0 ? h('div', { className: 'wmp-hint' }, t('noLocal')) : null,
        localPlugins.map((p) => h('div', { key: p.name, className: 'wmp-local-item' },
          h('span', { className: 'wmp-local-name' }, p.name),
          p.repo ? h('span', { className: 'wmp-local-meta' }, p.repo) : null,
          p.version ? h('span', { className: 'wmp-local-meta' }, 'v' + p.version) : null,
          h('span', { className: 'wmp-local-meta' }, ({ github: t('kindGithub'), npm: t('kindNpm'), link: t('kindLink'), file: t('kindFile') })[p.kind] || p.kind),
          h('span', { className: 'wmp-tag ' + (p.inCatalog ? 'wmp-tag-on' : 'wmp-tag-off') }, p.inCatalog ? t('localCatalog') : t('localExternal')),
          p.disabled ? h('span', { className: 'wmp-tag wmp-tag-warn' }, t('disabledState')) : null,
          h('span', { style: { flex: 1 } }),
          p.disabled
            ? h('button', { className: 'wmp-btn', onClick: () => toggleDisabled(p.name, 'web', false) }, t('enable'))
            : h('button', { className: 'wmp-btn', onClick: () => toggleDisabled(p.name, 'web', true) }, t('disable')),
          (p.kind !== 'link' && p.kind !== 'file')
            ? h('button', { className: 'wmp-btn wmp-btn-danger', onClick: () => runOp('uninstall', p.name, p.name, 'web') }, t('uninstall'))
            : null,
        )),
        local.builtin && local.builtin.length > 0
          ? h('div', { className: 'wmp-hint' }, local.builtin.map((n) => h('span', { key: n, className: 'wmp-tag wmp-tag-off', style: { marginRight: 4 } }, n + ' · ' + t('localBuiltin'))))
          : null,
      ) : null,
      modal,
      queuePanel,
      // ── command rail: category chips + filters + sort ─────────────────
      h('div', { className: 'wmp-rail' },
        (data.cats || []).map((c) => h('button', {
          key: c.id,
          className: 'wmp-chip' + (cat === c.id && !showInstalled ? ' wmp-chip-on' : ''),
          onClick: () => { setCat(c.id); setShowInstalled(false) },
        }, (c.id === 'all' ? t('all') : c.label), ' ', h('small', null, c.count))),
        h('button', {
          className: 'wmp-chip' + (showInstalled ? ' wmp-chip-on' : ''),
          onClick: () => { setShowInstalled(!showInstalled); setCat('all') },
        }, t('instFilter'), ' ', h('small', null, installedCount)),
        h('button', {
          className: 'wmp-chip',
          disabled: updatableCount === 0,
          onClick: runUpdateAll,
          title: t('updateAll'),
        }, t('updateAll'), ' ', h('small', null, updatableCount)),
        h('div', { className: 'wmp-sort' },
          [['default', t('sortDefault')], ['hot', t('sortHot')], ['new', t('sortNew')]].map(([key, label]) =>
            h('button', { key, className: sortBy === key ? 'on' : '', onClick: () => setSortBy(key) }, label))),
      ),
      data.phase === 'loading' ? h('div', null, t('loading')) : null,
      data.phase === 'error' ? h('div', { className: 'wmp-err' }, data.error) : null,
      data.phase === 'ready' && truncated ? h('div', { className: 'wmp-cmdrow' },
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          fmt('loadedCount', { shown: shownCount, total: sorted.length })),
        h('button', { className: 'wmp-btn', onClick: () => setVisibleCount(sorted.length) }, t('loadAll')),
      ) : null,
      data.phase === 'ready' ? h('div', { className: 'wmp-list' }, groups.map((g) => h('div', { key: g.id },
        g.label ? h('div', { className: 'wmp-group-head' }, g.label, h('small', null, g.total)) : null,
        g.items.map((p, i) => {
          const profile = p.profile || 'web'
          const state = data.installed && data.installed[profile]
          const pkgName = installedPkgName(p, state)
          const inst = pkgName !== null
          const disabled = inst && state && Array.isArray(state.disabled) && state.disabled.includes(pkgName)
          const queued = ops.find((o) => (o.status === 'pending' || o.status === 'checking' || o.status === 'running')
            && o.profile === profile
            && ((o.kind === 'install' && o.target === p.source) || ((o.kind === 'update' || o.kind === 'uninstall') && o.target === pkgName)))
          const isOpen = open === p.url
          return h('div', { key: p.url, className: 'wmp-row' },
            h('div', { className: 'wmp-main' },
              h('div', null,
                h('span', { className: 'wmp-index' }, '№ ' + String(i + 1).padStart(2, '0')),
                h('a', { className: 'wmp-name', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.name),
                typeof p.stars === 'number' ? h('span', { className: 'wmp-stars' }, '★ ' + p.stars) : null,
                p.by ? h('span', { className: 'wmp-by' }, '@' + p.by) : null,
                h('a', { className: 'wmp-gh', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, t('gh')),
              ),
              p.desc ? h('p', { className: 'wmp-desc' }, p.desc) : null,
              isOpen ? h('div', { className: 'wmp-detail' },
                h('div', null, t('cmdLabel')),
                h('code', null, p.cmd || t('noCmd')),
                h('div', { className: 'wmp-hint' }, t('hint')),
              ) : null,
            ),
            h('div', { className: 'wmp-actions' },
              h('span', { className: 'wmp-state ' + (inst ? (disabled ? 'wmp-state-warn' : 'wmp-state-on') : 'wmp-state-off') },
                inst ? (disabled ? t('disabledState') : t('instFilter')) : (LOCALE === 'zh' ? '未安装' : 'Not installed')),
              h('button', { className: 'wmp-btn', onClick: () => setOpen(isOpen ? null : p.url) }, isOpen ? t('collapse') : t('detail')),
              queued
                ? h('button', { className: 'wmp-btn', disabled: true }, t('liveChip') + ' · ' + statusText(queued.status))
                : inst
                  ? h(React.Fragment, null,
                      (() => {
                        const up = pkgName && data.updates && data.updates[profile] && data.updates[profile][pkgName]
                        if (!up) {
                          // No update status yet (still loading or check failed) —
                          // render a neutral disabled chip so the card always
                          // communicates its update state.
                          return h('button', { className: 'wmp-btn', disabled: true, title: t('updateFail') }, t('upToDate'))
                        }
                        if (up.kind === 'linked') {
                          return h('span', { className: 'wmp-state wmp-state-off' }, t('updLocal'))
                        }
                        if (up.updateAvailable) {
                          return h('button', {
                            className: 'wmp-btn',
                            onClick: () => runOp('update', pkgName, p.name, profile),
                          }, t('updateBtn') + (up.latest ? ' (' + String(up.latest).slice(0, 8) + ')' : ''))
                        }
                        return h('span', { className: 'wmp-state wmp-state-on' }, t('upToDate'))
                      })(),
                      h('button', { className: 'wmp-btn', onClick: () => toggleDisabled(pkgName, profile, !disabled) }, disabled ? t('enable') : t('disable')),
                      h('button', { className: 'wmp-btn wmp-btn-danger', onClick: () => runOp('uninstall', pkgName, p.name, profile) }, t('uninstall')))
                  : (p.source ? h('button', { className: 'wmp-btn wmp-btn-primary', onClick: () => runOp('install', p.source, p.name, profile) }, t('install')) : null),
            ),
          )
        }),
      ))) : null,
      data.phase === 'ready' && filtered.length === 0 ? h('div', { className: 'wmp-hint' }, t('noMatch')) : null,
    )
  }

  const inject = ['slots', 'sessions', 'workspaces']

  function apply(ctx) {
    ROOT_CTX = ctx
    const slots = ctx.get('slots')
    if (slots === undefined) return
    ctx.effect(() => {
      const id = 'dsh-market-style'
      if (!document.getElementById(id)) {
        const s = document.createElement('style')
        s.id = id
        s.textContent = WMP_CSS
        document.head.appendChild(s)
      }
      return () => { const el = document.getElementById(id); if (el) el.remove() }
    }, 'market-style')
    slots.inject('settings.plugins.tab', () => slots.register(
      { name: 'settings.plugins.tab', id: 'market', order: 5, label: () => (LOCALE === 'zh' ? '插件市场' : 'Plugin Market') },
      MarketPanel,
    ))
  }

  module.exports = { inject, apply }
  return module.exports;
} })
