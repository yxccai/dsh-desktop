'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Bundled pnpm runtime support.
 *
 * `dsh plugin` manages profile plugins by forwarding to the real `pnpm`
 * binary resolved from PATH, so community market installs fail on machines
 * where nothing installed pnpm globally — the normal case for the
 * npx/global/bundled DSH launches this app performs. To make the market (and
 * any other `dsh plugin` usage) work everywhere, DSH Desktop bundles pnpm as
 * a dependency and materializes a tiny PATH shim directory:
 *
 *   <stateRoot>/bin/pnpm.cmd   (Windows)
 *   <stateRoot>/bin/pnpm       (POSIX)
 *
 * Each shim forwards to the bundled `node_modules/pnpm/bin/pnpm.cjs` under
 * the runtime that launched the desktop — plain Node in dev/tests, and the
 * Electron binary with ELECTRON_RUN_AS_NODE=1 in the packaged app (the same
 * trick the bundled DSH runtime uses). Prepending the shim directory to PATH
 * makes `pnpm` resolvable for every spawned `dsh` child; DSH_MARKET_PNPM_DIR
 * additionally lets the market host re-prepend it for the CLI children it
 * spawns inside the web process.
 */

/** The pnpm entry inside the bundled package, relative to node_modules. */
const PNPM_RELATIVE = path.join('node_modules', 'pnpm', 'bin', 'pnpm.cjs');

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

/** The bundled pnpm entry script, or null when pnpm is not installed. */
function bundledPnpmCjs(options) {
  const candidates = [
    // Packaged: electron-builder unpacks node_modules beside the asar.
    path.join(options.resourcesPath || '', 'app.asar.unpacked', PNPM_RELATIVE),
    // Dev / tests: the checkout's own node_modules.
    path.join(options.appPath || '', PNPM_RELATIVE),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

/** The two shim scripts, pinned to the resolved pnpm entry and runtime exe. */
function shimScripts(pnpmCjs) {
  const exe = process.execPath;
  const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
  return {
    cmd:
      '@echo off\r\n'
      + 'setlocal\r\n'
      // Electron needs this flag to act as plain Node; harmless for real Node.
      + 'set "ELECTRON_RUN_AS_NODE=1"\r\n'
      + `${quote(exe)} ${quote(pnpmCjs)} %*\r\n`
      + 'exit /b %errorlevel%\r\n',
    sh:
      '#!/bin/sh\n'
      + 'export ELECTRON_RUN_AS_NODE=1\n'
      + `exec ${quote(exe)} ${quote(pnpmCjs)} "$@"\n`,
  };
}

/** Atomically write a file when its content changed. */
function writeIfChanged(file, content, mode) {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return false;
  } catch { /* missing or unreadable — write */ }
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content, { encoding: 'utf8', mode });
  fs.renameSync(temp, file);
  return true;
}

/**
 * Materialize the pnpm PATH shim directory and return it, or null when no
 * bundled pnpm is installed. Idempotent: re-running only rewrites files whose
 * content changed (the shim content pins the resolved pnpm path and the
 * runtime executable, so a moved install self-heals on the next launch).
 *
 * The shim lives in `$DSH_HOME/bin` (falling back to userData/bin when the
 * caller does not pass dshHome) so that ANY DSH web process — including one
 * started manually from a terminal — can resolve the bundled pnpm via the
 * market host's `$DSH_HOME/bin` fallback, even when the desktop never
 * injected DSH_MARKET_PNPM_DIR into that process.
 */
function pnpmShimDir(options) {
  const pnpmCjs = bundledPnpmCjs(options);
  if (!pnpmCjs) return null;
  const dir = path.join(options.dshHome || options.stateRoot, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const scripts = shimScripts(pnpmCjs);
  writeIfChanged(path.join(dir, 'pnpm.cmd'), scripts.cmd, 0o600);
  writeIfChanged(path.join(dir, 'pnpm'), scripts.sh, 0o755);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(path.join(dir, 'pnpm'), 0o755); } catch { /* best effort */ }
  }
  return dir;
}

/**
 * Environment additions that make `pnpm` resolvable by the DSH process and
 * its children: an augmented PATH (shim directory first, so it wins over any
 * system pnpm) plus DSH_MARKET_PNPM_DIR for the market host's own children.
 * @returns {{PATH: string, DSH_MARKET_PNPM_DIR: string} | null} null when no
 * bundled pnpm is installed (the caller should then fall back to whatever
 * PATH already provides).
 */
function pnpmRuntimeEnv(options, baseEnv = process.env) {
  const dir = pnpmShimDir(options);
  if (!dir) return null;
  const basePath = baseEnv.PATH || '';
  return {
    PATH: basePath ? dir + path.delimiter + basePath : dir,
    DSH_MARKET_PNPM_DIR: dir,
  };
}

module.exports = { bundledPnpmCjs, pnpmShimDir, pnpmRuntimeEnv, PNPM_RELATIVE };
