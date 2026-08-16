'use strict';

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  writeMarker,
  readMarker,
  removeMarker,
  isPidAlive,
  probeProcess,
  validateOwnership,
} = require('./ownership-marker');

function inspectService(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { resolve('unreachable'); return; }
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(parsed, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 256 * 1024) body += chunk;
        if (body.length >= 256 * 1024) response.destroy();
      });
      response.on('end', () => {
        const isDsh = response.statusCode === 200
          && body.includes('window.__DSH_BOOT__')
          && body.includes('@deepseek-ai/dsh-');
        resolve(isDsh ? 'dsh' : 'other');
      });
      response.on('error', () => resolve('other'));
    });
    request.once('error', () => resolve('unreachable'));
    request.setTimeout(timeoutMs, () => { request.destroy(); resolve('unreachable'); });
  });
}

function launchCandidates(config, platform = process.platform, environment = {}) {
  if (config.launchMode === 'connect') return [];
  if (config.command) return [{ command: config.command, args: config.args || [], viaCommandShell: false, label: 'custom' }];
  const target = new URL(config.url || 'http://127.0.0.1:3080');
  const host = target.hostname === '[::1]' ? '::1' : target.hostname;
  const port = target.port || '3080';
  const webArgs = ['web', '--host', host, '--port', port];
  const version = config.dshVersion ? `@deepseek-ai/dsh@${config.dshVersion}` : '@deepseek-ai/dsh';
  const global = { command: platform === 'win32' ? 'dsh.cmd' : 'dsh', args: webArgs, viaCommandShell: platform === 'win32', label: 'global' };
  const npx = { command: platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--yes', version, ...webArgs], viaCommandShell: platform === 'win32', label: 'npx' };
  const bundled = environment.bundledSpec
    ? [{ ...environment.bundledSpec, args: [...environment.bundledSpec.args, '--host', host, '--port', port] }]
    : [];
  if (config.launchMode === 'global') return [global];
  if (config.launchMode === 'npx') return [npx];
  if (config.launchMode === 'bundled') return bundled;
  const system = [];
  if (environment.globalDsh !== false) system.push(global);
  if (environment.npx !== false) system.push(npx);
  return config.runtimePreference === 'bundled-first'
    ? [...bundled, ...system]
    : [...system, ...bundled];
}

function quoteCmdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@./:\\=-]+$/.test(text)) return text;
  return `"${text.replace(/(["^&|<>%!])/g, '^$1')}"`;
}

function spawnSpec(spec, options, platform = process.platform) {
  if (platform === 'win32' && spec.viaCommandShell) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    const line = [spec.command, ...spec.args].map(quoteCmdArg).join(' ');
    return spawn(comspec, ['/d', '/s', '/c', line], options);
  }
  return spawn(spec.command, spec.args, options);
}

/**
 * Executable image name of the *root* process spawn() actually creates for a
 * spec. On Windows a viaCommandShell spec becomes cmd.exe; everything else is
 * the spec command's basename. Recorded in the ownership marker so adoption
 * can verify the live process image matches.
 */
function spawnedExecutable(spec, platform = process.platform) {
  if (platform === 'win32' && spec.viaCommandShell) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    return path.basename(comspec).toLowerCase();
  }
  return path.basename(String(spec.command || '')).toLowerCase();
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Environment for one owned DSH child. Always pins DSH_HOME and the npm
 * cache; when the desktop provisioned the bundled-pnpm shim (see
 * src/pnpm-runtime.js), the augmented PATH leads with the shim directory so
 * the dsh CLI can resolve `pnpm` even when nothing installed it globally
 * (npx/global/bundled launches). DSH_MARKET_PNPM_DIR lets the market host
 * re-prepend the same directory for the CLI children it spawns inside the
 * web process.
 * @param {object} config - the resolved desktop config.
 * @param {object} environment - the detected launch environment (may carry
 * pnpmPath/pnpmDir set by main.js).
 * @param {object} [extra] - per-spec env overrides (e.g. ELECTRON_RUN_AS_NODE).
 */
function buildChildEnv(config, environment, extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    DSH_HOME: config.dshHome,
    npm_config_cache: config.npmCache,
  };
  if (environment && environment.pnpmPath) env.PATH = environment.pnpmPath;
  if (environment && environment.pnpmDir) env.DSH_MARKET_PNPM_DIR = environment.pnpmDir;
  return env;
}

class RuntimeManager {
  constructor(config, log, environment = {}, options = {}) {
    this.config = config;
    this.log = log;
    this.environment = environment;
    this.options = options;
    this.markerPath = options.markerPath || null;
    this.probeProcess = options.probeProcess || probeProcess;
    this.child = null;
    this.owned = false;
    // Non-null when ownership came from a persisted marker (adopted an
    // already-running DSH service) rather than from a process we spawned.
    this.adopted = null;
  }

  writeMarker(spec, pid) {
    if (!this.markerPath) return;
    try {
      writeMarker(this.markerPath, {
        pid,
        url: this.config.url,
        command: spawnedExecutable(spec, process.platform),
        label: spec.label || '',
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.log(`Failed to write ownership marker: ${error.message}`);
    }
  }

  readMarker() {
    if (!this.markerPath) return null;
    return readMarker(this.markerPath);
  }

  removeMarker() {
    if (!this.markerPath) return;
    removeMarker(this.markerPath);
  }

  async startOne(spec) {
    const env = buildChildEnv(this.config, this.environment, spec.env || {});
    return new Promise((resolve, reject) => {
      this.log(`Starting ${spec.label}: ${spec.command} ${spec.args.join(' ')}`);
      const child = spawnSpec(spec, {
        env,
        cwd: this.config.workingDirectory || this.config.dshHome,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let spawned = false;
      child.once('spawn', () => {
        spawned = true;
        this.child = child;
        this.owned = true;
        this.adopted = null;
        // Persist ownership before the service is reachable: if this desktop
        // is force-killed or rebuilt, the next launch adopts this pid.
        this.writeMarker(spec, child.pid);
        child.stdout.on('data', (data) => this.log(`DSH: ${String(data).trimEnd()}`));
        child.stderr.on('data', (data) => this.log(`DSH stderr: ${String(data).trimEnd()}`));
        child.on('exit', (code, signal) => {
          this.log(`DSH candidate exited: code=${code} signal=${signal}`);
          if (this.child === child) { this.child = null; this.owned = false; }
          // Root process gone: the marker can no longer describe a live tree.
          this.removeMarker();
        });
        resolve();
      });
      child.once('error', (error) => {
        if (!spawned) reject(error);
        else this.log(`DSH process error: ${error.message}`);
      });
    });
  }

  async waitForCandidate(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await inspectService(this.config.url);
      if (state === 'dsh') return true;
      if (state === 'other') throw new Error(`Port is occupied by a non-DSH HTTP service: ${this.config.url}`);
      if (!this.child) return false;
      await delay(500);
    }
    return false;
  }

  /**
   * A DSH service is already responding. Adopt it as owned only when a valid
   * Desktop marker proves we started it: URL matches, pid alive, process
   * plausible. Otherwise it is an external service — connect without owning.
   * @returns {'adopted'|'existing'}
   */
  async adoptOrConnect() {
    const marker = this.readMarker();
    if (marker) {
      const verdict = await validateOwnership(marker, { url: this.config.url, probe: this.probeProcess });
      if (verdict.valid) {
        this.adopted = { pid: marker.pid, label: marker.label || '', command: marker.command || '' };
        this.owned = true;
        this.log(`Adopted owned DSH service at ${this.config.url} (pid ${marker.pid}${this.adopted.label ? `, ${this.adopted.label}` : ''})`);
        return 'adopted';
      }
      this.log(`Ignoring invalid ownership marker: ${verdict.reason}`);
      this.removeMarker();
    }
    this.log(`Connected to existing DSH service at ${this.config.url}`);
    return 'existing';
  }

  /**
   * The service is not up yet, but a valid marker describes a live process we
   * spawned. That happens when the desktop was force-killed while DSH was
   * still starting: the child survives and will bind the port shortly. Wait
   * for it instead of spawning a conflicting candidate. Removes the marker
   * (never kills) when the process dies or never serves.
   * @returns {Promise<boolean>} true when the marked process came up.
   */
  async waitForMarked() {
    const marker = this.readMarker();
    if (!marker) return false;
    const verdict = await validateOwnership(marker, { url: this.config.url, probe: this.probeProcess });
    if (!verdict.valid) {
      this.log(`Removing stale ownership marker: ${verdict.reason}`);
      this.removeMarker();
      return false;
    }
    const timeoutMs = Math.min(this.config.candidateTimeoutMs || 30000, 30000);
    const deadline = Date.now() + timeoutMs;
    this.log(`Waiting for marked DSH process ${marker.pid} to serve ${this.config.url}`);
    while (Date.now() < deadline) {
      if (!isPidAlive(marker.pid)) {
        this.log(`Marked DSH process ${marker.pid} exited while waiting; removing marker`);
        this.removeMarker();
        return false;
      }
      const state = await inspectService(this.config.url);
      if (state === 'dsh') return true;
      if (state === 'other') throw new Error(`Port is occupied by a non-DSH HTTP service: ${this.config.url}`);
      await delay(500);
    }
    this.log(`Marked DSH process ${marker.pid} never served ${this.config.url}; removing marker`);
    this.removeMarker();
    return false;
  }

  async ensureReady() {
    const initial = await inspectService(this.config.url);
    if (initial === 'dsh') return this.adoptOrConnect();
    if (initial === 'other') throw new Error(`Port is occupied by a non-DSH HTTP service: ${this.config.url}`);
    if (await this.waitForMarked()) return this.adoptOrConnect();
    const candidates = launchCandidates(this.config, process.platform, this.environment);
    if (!candidates.length) throw new Error(`Connect-only mode: no DSH service at ${this.config.url}`);
    let lastError;
    for (const candidate of candidates) {
      try {
        await this.startOne(candidate);
        if (await this.waitForCandidate(this.config.candidateTimeoutMs || 30000)) return 'started';
        lastError = new Error(`${candidate.label} did not start DSH at ${this.config.url}`);
      } catch (error) {
        lastError = error;
        this.log(`Launch candidate failed: ${error.message}`);
        if (/non-DSH HTTP service/.test(error.message)) throw error;
      }
      await this.stop();
    }
    throw lastError || new Error(`Unable to start DSH at ${this.config.url}`);
  }

  waitForExit(child, timeoutMs) {
    if (!child || child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
  }

  /**
   * Wait until pid is gone. Uses the child exit event when we hold the handle,
   * otherwise polls liveness — the path used for adopted marker pids that
   * belong to a previous desktop instance.
   */
  async waitForPidExit(pid, timeoutMs) {
    if (this.child && this.child.pid === pid && this.child.exitCode === null) {
      return this.waitForExit(this.child, timeoutMs);
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) return true;
      await delay(200);
    }
    return !isPidAlive(pid);
  }

  runTaskkill(pid, force) {
    return new Promise((resolve) => {
      const args = ['/pid', String(pid), '/t'];
      if (force) args.push('/f');
      const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' });
      killer.once('exit', (code) => resolve(code));
      killer.once('error', () => resolve(-1));
    });
  }

  /**
   * Stop whatever we own. When ownership was adopted from a marker, kill the
   * stored root process tree (taskkill /t on Windows) even though we never
   * held a ChildProcess handle for it. Never kills a process we cannot prove
   * we own: without an owned pid this only clears stale markers. Always
   * removes the marker afterwards so a killed tree is not re-adopted later.
   * @returns {Promise<boolean>} whether the target process exited.
   */
  async stop() {
    const adopted = this.adopted;
    const child = this.child;
    const pid = adopted ? adopted.pid : (this.owned && child ? child.pid : null);
    if (!pid) {
      this.removeMarker();
      return false;
    }
    const origin = adopted ? 'adopted' : 'owned';
    this.log(`Stopping ${origin} DSH process tree ${pid}`);
    let exited = false;
    if (process.platform === 'win32') {
      const gracefulCode = await this.runTaskkill(pid, false);
      exited = await this.waitForPidExit(pid, 3000);
      if (!exited) {
        const forceCode = await this.runTaskkill(pid, true);
        exited = await this.waitForPidExit(pid, 3000);
        if (!exited) this.log(`Failed to terminate process tree ${pid}; taskkill codes ${gracefulCode}/${forceCode}`);
      }
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch (error) { this.log(`SIGTERM failed for ${pid}: ${error.message}`); }
      exited = await this.waitForPidExit(pid, 3000);
      if (!exited) {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { this.log(`SIGKILL failed for ${pid}: ${error.message}`); }
        exited = await this.waitForPidExit(pid, 3000);
      }
    }
    if (exited) this.log(`Stopped ${origin} DSH process tree ${pid}`);
    this.removeMarker();
    this.adopted = null;
    if (this.child === child) { this.child = null; this.owned = false; }
    return exited;
  }
}

module.exports = { inspectService, launchCandidates, quoteCmdArg, spawnSpec, spawnedExecutable, buildChildEnv, RuntimeManager };
