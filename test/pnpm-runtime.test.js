'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { bundledPnpmCjs, pnpmShimDir, pnpmRuntimeEnv } = require('../src/pnpm-runtime');
const { buildChildEnv } = require('../src/runtime-manager');

const REPO = path.join(__dirname, '..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Resolve the platform shim filename the same way cmd/POSIX shells do. */
function shimName() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

/** Run one pnpm command the same way the dsh CLI does (shell on Windows). */
function runPnpm(args, env) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', args, {
      cwd: os.tmpdir(),
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => resolve({ code: -1, out, err: err + String(e && e.message) }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('bundledPnpmCjs locates the checkout pnpm in dev mode', () => {
  const cjs = bundledPnpmCjs({ appPath: REPO, resourcesPath: '', stateRoot: '' });
  assert.ok(cjs, 'expected the dev checkout pnpm to resolve');
  assert.equal(cjs, path.join(REPO, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  assert.ok(fs.existsSync(cjs));
});

test('bundledPnpmCjs prefers the unpacked packaged path over the app path', (t) => {
  const root = fixture(t);
  const resources = path.join(root, 'resources');
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules', 'pnpm', 'bin');
  fs.mkdirSync(unpacked, { recursive: true });
  fs.writeFileSync(path.join(unpacked, 'pnpm.cjs'), 'packaged');
  const app = path.join(root, 'app');
  fs.mkdirSync(path.join(app, 'node_modules', 'pnpm', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), 'dev');
  const cjs = bundledPnpmCjs({ appPath: app, resourcesPath: resources, stateRoot: '' });
  assert.equal(cjs, path.join(unpacked, 'pnpm.cjs'));
});

test('bundledPnpmCjs returns null when pnpm is not installed', (t) => {
  const root = fixture(t);
  const cjs = bundledPnpmCjs({ appPath: root, resourcesPath: root, stateRoot: root });
  assert.equal(cjs, null);
});

test('pnpmShimDir materializes a shim pinned to the bundled pnpm and runtime exe', (t) => {
  const root = fixture(t);
  const dir = pnpmShimDir({ appPath: REPO, resourcesPath: '', stateRoot: root });
  assert.ok(dir, 'expected the shim dir to be created');
  assert.equal(dir, path.join(root, 'bin'));
  const script = path.join(dir, shimName());
  const content = fs.readFileSync(script, 'utf8');
  assert.ok(content.includes('ELECTRON_RUN_AS_NODE=1'), 'shim must run Electron as Node (harmless for plain Node)');
  assert.ok(content.includes(path.join('node_modules', 'pnpm', 'bin', 'pnpm.cjs')), 'shim must point at the bundled pnpm.cjs');
  assert.ok(content.includes(process.execPath), 'shim must invoke the runtime that launched the desktop');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(script).mode & 0o111, 0o111, 'POSIX shim must be executable');
  }
});

test('pnpmShimDir is idempotent (content stable across calls)', (t) => {
  const root = fixture(t);
  const options = { appPath: REPO, resourcesPath: '', stateRoot: root };
  const first = pnpmShimDir(options);
  const script = path.join(first, shimName());
  const before = fs.readFileSync(script, 'utf8');
  const second = pnpmShimDir(options);
  assert.equal(first, second);
  assert.equal(fs.readFileSync(script, 'utf8'), before, 're-running must not rewrite the shim');
});

test('pnpmRuntimeEnv augments PATH with the shim dir first and exposes the dir', (t) => {
  const root = fixture(t);
  const base = { PATH: 'C:/original' + path.delimiter + 'C:/more' };
  const env = pnpmRuntimeEnv({ appPath: REPO, resourcesPath: '', stateRoot: root }, base);
  assert.ok(env, 'expected pnpm env additions with a bundled pnpm');
  assert.ok(env.PATH.startsWith(path.join(root, 'bin') + path.delimiter), 'shim dir must lead PATH');
  assert.ok(env.PATH.endsWith('C:/more'));
  assert.equal(env.DSH_MARKET_PNPM_DIR, path.join(root, 'bin'));
});

test('pnpmRuntimeEnv returns null without a bundled pnpm', (t) => {
  const root = fixture(t);
  const env = pnpmRuntimeEnv({ appPath: root, resourcesPath: root, stateRoot: root }, { PATH: 'C:/x' });
  assert.equal(env, null);
});

test('the shim actually resolves pnpm the way `dsh plugin` does', async (t) => {
  const root = fixture(t);
  const dir = pnpmShimDir({ appPath: REPO, resourcesPath: '', stateRoot: root });
  const env = { ...process.env, PATH: dir + path.delimiter + (process.env.PATH || '') };
  const result = await runPnpm(['--version'], env);
  assert.equal(result.code, 0, `pnpm --version failed: ${result.err || result.out}`);
  assert.match(result.out, /\d+\.\d+\.\d+/);
});

test('buildChildEnv passes the augmented PATH and pnpm dir to the DSH process', () => {
  const config = { dshHome: 'C:/dsh-home', npmCache: 'C:/npm-cache' };
  const environment = { pnpmPath: 'C:/shim' + path.delimiter + 'C:/orig', pnpmDir: 'C:/shim' };
  const env = buildChildEnv(config, environment);
  assert.equal(env.DSH_HOME, 'C:/dsh-home');
  assert.equal(env.npm_config_cache, 'C:/npm-cache');
  assert.equal(env.PATH, 'C:/shim' + path.delimiter + 'C:/orig');
  assert.equal(env.DSH_MARKET_PNPM_DIR, 'C:/shim');
});

test('buildChildEnv leaves PATH untouched when no pnpm env was provisioned', () => {
  const config = { dshHome: 'C:/dsh-home', npmCache: 'C:/npm-cache' };
  const env = buildChildEnv(config, {});
  // Windows exposes the path variable as `Path`; check either casing.
  assert.ok(env.PATH || env.Path);
  assert.equal(env.DSH_MARKET_PNPM_DIR, undefined);
});
