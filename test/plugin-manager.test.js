'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PluginManager } = require('../src/plugin-manager');

function digestDirectory(root) {
  const files = fs.readdirSync(root).sort().map((name) => {
    const file = path.join(root, name);
    return `${name}:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  }).join('\n');
  return crypto.createHash('sha256').update(files).digest('hex');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-center-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dshHome = path.join(root, 'home');
  const bundleRoot = path.join(root, 'bundles');
  const source = path.join(bundleRoot, 'sample');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'agent.cordis.yml'), '- id: persona\n  name: test-plugin\n');
  fs.writeFileSync(path.join(source, 'preset.yml'), 'name: Sample\n');
  const catalogPath = path.join(root, 'catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({ schemaVersion: 1, plugins: [{ id: 'sample-plugin', name: 'Sample', description: 'Test', version: '1.0.0', bundledDir: 'sample', digest: digestDirectory(source) }] }));
  return { manager: new PluginManager({ dshHome, bundleRoot, catalogPath }), dshHome, source };
}

test('installs, disables, enables, and uninstalls an owned preset', async (t) => {
  const { manager, dshHome } = fixture(t);
  assert.equal(manager.list().recommended[0].status, 'available');
  assert.equal((await manager.install('sample-plugin')).recommended[0].status, 'enabled');
  assert.ok(fs.existsSync(path.join(dshHome, '.agent-presets', 'sample-plugin', 'agent.cordis.yml')));
  assert.equal((await manager.setEnabled('sample-plugin', false)).recommended[0].status, 'disabled');
  assert.equal((await manager.setEnabled('sample-plugin', true)).recommended[0].status, 'enabled');
  assert.equal((await manager.uninstall('sample-plugin')).recommended[0].status, 'available');
});

test('never overwrites or removes an external preset with the same id', async (t) => {
  const { manager, dshHome } = fixture(t);
  const external = path.join(dshHome, '.agent-presets', 'sample-plugin');
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, 'agent.cordis.yml'), '[]\n');
  assert.equal(manager.list().recommended[0].status, 'conflict');
  await assert.rejects(manager.install('sample-plugin'), /已存在/);
  await assert.rejects(manager.uninstall('sample-plugin'), /只能卸载/);
  assert.equal(fs.readFileSync(path.join(external, 'agent.cordis.yml'), 'utf8'), '[]\n');
});

test('rejects a bundled preset after content tampering', async (t) => {
  const { manager, source } = fixture(t);
  fs.appendFileSync(path.join(source, 'agent.cordis.yml'), '# changed\n');
  await assert.rejects(manager.install('sample-plugin'), /校验失败/);
});

test('refuses to uninstall an owned preset after user modification', async (t) => {
  const { manager, dshHome } = fixture(t);
  await manager.install('sample-plugin');
  fs.appendFileSync(path.join(dshHome, '.agent-presets', 'sample-plugin', 'agent.cordis.yml'), '# user edit\n');
  await assert.rejects(manager.uninstall('sample-plugin'), /内容已被修改/);
  assert.ok(fs.existsSync(path.join(dshHome, '.agent-presets', 'sample-plugin', 'agent.cordis.yml')));
});

test('lists unrelated user presets as external and read-only', (t) => {
  const { manager, dshHome } = fixture(t);
  const external = path.join(dshHome, '.agent-presets', 'my-preset');
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, 'agent.cordis.yml'), '[]\n');
  const item = manager.list().external[0];
  assert.deepEqual({ id: item.id, status: item.status, owned: item.owned, valid: item.valid }, { id: 'my-preset', status: 'external', owned: false, valid: true });
});
