'use strict';

/**
 * Ownership persistence for the DSH child process the desktop spawned.
 *
 * A tiny marker file lives under Electron's userData directory (the path is
 * chosen by main.js). It records the *root* process the desktop actually
 * spawned (pid + url + executable), so that after the Electron parent is
 * force-killed or rebuilt the child is still recognised as ours on the next
 * launch — and, crucially, so that we never kill a process we cannot prove we
 * own. `ensureReady` adopts an already-running DSH service only when the
 * marker is present, the URL matches, the pid is alive, and the live process
 * looks plausible (image name and command line reference the expected
 * executable/port). Stale markers are removed without killing anything.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function writeMarker(file, payload) {
  atomicWriteJson(file, payload);
}

/**
 * Read the marker file. Returns the parsed object or null when the file is
 * missing, corrupt, or holds a non-object value.
 */
function readMarker(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Remove the marker file and any leftover atomic-write temp siblings. Always
 * safe: removing a marker never kills anything.
 */
function removeMarker(file) {
  if (!file) return;
  fs.rmSync(file, { force: true });
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`${base}.tmp-`)) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch { /* directory already gone */ }
}

/**
 * Cheap liveness probe: signal 0 does not deliver a signal, it only asks the
 * OS whether the process exists. EPERM still counts as alive (exists, but we
 * may not signal it).
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/**
 * Probe a live process for the facts needed to judge plausibility:
 *  - image: executable image name (e.g. "node.exe", "cmd.exe")
 *  - commandLine: full command line, when the platform can provide it
 * Never throws; every field defaults to null/false so callers can treat an
 * unprobeable process as implausible.
 *
 * @param {number} pid
 * @param {string} [platform]
 * @returns {Promise<{alive: boolean, image: string|null, commandLine: string|null}>}
 */
async function probeProcess(pid, platform = process.platform) {
  const info = { alive: false, image: null, commandLine: null };
  if (!Number.isInteger(pid) || pid <= 0 || !isPidAlive(pid)) return info;
  info.alive = true;
  if (platform === 'win32') {
    try {
      const out = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8', windowsHide: true, timeout: 3000,
      });
      const match = /^"([^"]+)"/.exec(String(out).trim());
      if (match) info.image = match[1].toLowerCase();
    } catch { /* not probeable */ }
    try {
      const out = execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object -ExpandProperty CommandLine`],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      if (String(out).trim()) info.commandLine = String(out).trim();
    } catch { /* not probeable */ }
  } else {
    try {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 3000 });
      // macOS `comm=` returns a full path; normalize to the basename so the
      // image matches both the marker's command and the Windows short name.
      info.image = String(out).trim().toLowerCase().replace(/^.*[\\/]/, '');
    } catch { /* not probeable */ }
    try {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 3000 });
      info.commandLine = String(out).trim();
    } catch { /* not probeable */ }
  }
  return info;
}

/**
 * Decide whether a marker grants ownership of the process behind it.
 *
 * Options:
 *  - url: the configured service URL; when given, the marker URL must match.
 *  - info: precomputed probe result ({alive, image, commandLine}); when
 *    omitted, `options.probe` (defaults to `probeProcess`) is invoked for the
 *    marker pid.
 *
 * A marker is valid only when all of these hold:
 *  1. it has a sane integer pid,
 *  2. its url equals the configured url,
 *  3. the pid is alive,
 *  4. the process image matches the executable recorded in the marker,
 *  5. the process command line references the configured port (guards against
 *     pid reuse by an unrelated process).
 *
 * @returns {Promise<{valid: boolean, reason?: string, info?: object}>}
 */
async function validateOwnership(marker, options = {}) {
  const { url } = options;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return { valid: false, reason: 'marker missing or corrupt' };
  }
  if (!Number.isInteger(marker.pid) || marker.pid <= 0) {
    return { valid: false, reason: `marker pid ${marker.pid} is not a valid pid` };
  }
  if (url && marker.url !== url) {
    return { valid: false, reason: `marker url ${marker.url} does not match ${url}` };
  }
  let info = options.info;
  if (!info) {
    try {
      info = await (options.probe || probeProcess)(marker.pid);
    } catch {
      return { valid: false, reason: 'process probe failed' };
    }
  }
  if (!info || !info.alive) return { valid: false, reason: `pid ${marker.pid} is not alive` };
  const expected = String(marker.command || '').toLowerCase().replace(/^.*[\\/]/, '');
  if (expected && info.image) {
    const image = String(info.image).toLowerCase();
    const matches = image === expected || image.includes(expected) || expected.includes(image);
    if (!matches) {
      return { valid: false, reason: `process image ${image} does not match marker command ${expected}` };
    }
  }
  if (info.commandLine) {
    let port = '3080';
    try { port = new URL(url).port || '3080'; } catch { /* keep default */ }
    if (!info.commandLine.includes(port)) {
      return { valid: false, reason: `command line does not reference port ${port}` };
    }
  }
  return { valid: true, info };
}

module.exports = {
  atomicWriteJson,
  writeMarker,
  readMarker,
  removeMarker,
  isPidAlive,
  probeProcess,
  validateOwnership,
};
