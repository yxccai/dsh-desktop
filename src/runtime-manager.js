'use strict';

const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');

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
  constructor(config, log, environment = {}) {
    this.config = config;
    this.log = log;
    this.environment = environment;
    this.child = null;
    this.owned = false;
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
        child.stdout.on('data', (data) => this.log(`DSH: ${String(data).trimEnd()}`));
        child.stderr.on('data', (data) => this.log(`DSH stderr: ${String(data).trimEnd()}`));
        child.on('exit', (code, signal) => {
          this.log(`DSH candidate exited: code=${code} signal=${signal}`);
          if (this.child === child) { this.child = null; this.owned = false; }
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

  async ensureReady() {
    const initial = await inspectService(this.config.url);
    if (initial === 'dsh') {
      this.log(`Connected to existing DSH service at ${this.config.url}`);
      return 'existing';
    }
    if (initial === 'other') throw new Error(`Port is occupied by a non-DSH HTTP service: ${this.config.url}`);
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

  runTaskkill(pid, force) {
    return new Promise((resolve) => {
      const args = ['/pid', String(pid), '/t'];
      if (force) args.push('/f');
      const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' });
      killer.once('exit', (code) => resolve(code));
      killer.once('error', () => resolve(-1));
    });
  }

  async stop() {
    if (!this.owned || !this.child) return;
    const child = this.child;
    const pid = child.pid;
    this.log(`Stopping owned DSH process tree ${pid}`);
    if (process.platform === 'win32') {
      const gracefulCode = await this.runTaskkill(pid, false);
      let exited = await this.waitForExit(child, 3000);
      if (!exited) {
        const forceCode = await this.runTaskkill(pid, true);
        exited = await this.waitForExit(child, 3000);
        if (!exited) this.log(`Failed to terminate process tree ${pid}; taskkill codes ${gracefulCode}/${forceCode}`);
      }
    } else {
      child.kill('SIGTERM');
      if (!await this.waitForExit(child, 3000)) child.kill('SIGKILL');
    }
    if (this.child === child) { this.child = null; this.owned = false; }
  }
}

module.exports = { inspectService, launchCandidates, quoteCmdArg, spawnSpec, buildChildEnv, RuntimeManager };
