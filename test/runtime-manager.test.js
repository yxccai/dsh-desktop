'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectService, launchCandidates, quoteCmdArg } = require('../src/runtime-manager');
const { configDefaults, validateConfig } = require('../src/config');
const { bundledDshSpec } = require('../src/environment-detector');

const bundled = { command: 'electron', args: ['--expose-internals', 'bin.js', 'web'], label: 'bundled' };

test('auto launch uses system candidates then bundled fallback', () => {
  const result = launchCandidates({ launchMode: 'auto', dshVersion: '', runtimePreference: 'system-first', url: 'http://127.0.0.1:3080' }, 'win32', { globalDsh: true, npx: true, bundledSpec: bundled });
  assert.equal(result[0].command, 'dsh.cmd');
  assert.equal(result[0].viaCommandShell, true);
  assert.deepEqual(result[1].args, ['--yes', '@deepseek-ai/dsh', 'web', '--host', '127.0.0.1', '--port', '3080']);
  assert.equal(result[2].label, 'bundled');
  assert.deepEqual(result[2].args.slice(-4), ['--host', '127.0.0.1', '--port', '3080']);
});

test('auto can prefer bundled runtime', () => {
  const result = launchCandidates({ launchMode: 'auto', dshVersion: '', runtimePreference: 'bundled-first', url: 'http://127.0.0.1:3080' }, 'darwin', { globalDsh: true, npx: true, bundledSpec: bundled });
  assert.equal(result[0].label, 'bundled');
  assert.deepEqual(result[0].args.slice(-4), ['--host', '127.0.0.1', '--port', '3080']);
});

test('missing system environment leaves bundled fallback only', () => {
  const result = launchCandidates({ launchMode: 'auto', dshVersion: '', runtimePreference: 'system-first', url: 'http://127.0.0.1:3091' }, 'win32', { globalDsh: false, npx: false, bundledSpec: bundled });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].args.slice(-4), ['--host', '127.0.0.1', '--port', '3091']);
});

test('npx can pin a configured DSH version', () => {
  const [result] = launchCandidates({ launchMode: 'npx', dshVersion: '0.1.0-rc.6', url: 'http://127.0.0.1:3080' }, 'win32');
  assert.deepEqual(result.args, ['--yes', '@deepseek-ai/dsh@0.1.0-rc.6', 'web', '--host', '127.0.0.1', '--port', '3080']);
});

test('connect mode never launches a process', () => {
  assert.deepEqual(launchCandidates({ launchMode: 'connect' }, 'win32'), []);
});

test('bundled spec locates DSH and enables Node internals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-test-'));
  const script = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '');
  const result = bundledDshSpec({ appPath: root, resourcesPath: root, electronPath: '/electron' });
  assert.equal(result.command, '/electron');
  assert.deepEqual(result.args, ['--expose-internals', script, 'web']);
  assert.equal(result.env.ELECTRON_RUN_AS_NODE, '1');
  fs.rmSync(root, { recursive: true, force: true });
});

test('environment paths become defaults', () => {
  const value = configDefaults({ home: 'C:/User', localAppData: 'C:/Local' }, { DSH_HOME: 'E:/DSH', npm_config_cache: 'E:/cache' });
  assert.equal(value.dshHome, 'E:/DSH');
  assert.equal(value.npmCache, 'E:/cache');
  assert.equal(value.dshVersion, '0.1.0-rc.6');
});

test('configuration rejects remote origins and malformed args', () => {
  const base = configDefaults({ home: 'C:/User', localAppData: 'C:/Local' }, {});
  assert.throws(() => validateConfig({ ...base, url: 'https://example.com' }), /must use http/);
  assert.throws(() => validateConfig({ ...base, url: 'http://192.168.1.10:3080' }), /loopback/);
  assert.throws(() => validateConfig({ ...base, args: 'web' }), /string array/);
  assert.doesNotThrow(() => validateConfig({ ...base, launchMode: 'bundled' }));
});

test('cmd arguments are quoted when metacharacters are present', () => {
  assert.equal(quoteCmdArg('plain-value'), 'plain-value');
  assert.equal(quoteCmdArg('a&b'), '"a^&b"');
});

test('service inspection distinguishes DSH from other HTTP services', async () => {
  const server = http.createServer((request, response) => {
    response.end(request.url === '/dsh'
      ? '<script>window.__DSH_BOOT__={"id":"@deepseek-ai/dsh-client"}</script>'
      : '<h1>another service</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    assert.equal(await inspectService(`http://127.0.0.1:${port}/dsh`), 'dsh');
    assert.equal(await inspectService(`http://127.0.0.1:${port}/other`), 'other');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
