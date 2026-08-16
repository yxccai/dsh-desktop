'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PluginManager } = require('../src/plugin-manager');

const ROOT = path.join(__dirname, '..');

test('every bundled catalog entry has a valid id and a digest matching its preset directory', () => {
  const manager = new PluginManager({
    dshHome: path.join(ROOT, '.catalog-test-home'),
    catalogPath: path.join(ROOT, 'resources', 'plugin-catalog.json'),
    bundleRoot: path.join(ROOT, 'resources', 'plugins'),
  });
  assert.ok(manager.catalog.length >= 3, 'catalog should expose bundled plugins');
  const ids = new Set();
  for (const plugin of manager.catalog) {
    assert.ok(!ids.has(plugin.id), `duplicate catalog id ${plugin.id}`);
    ids.add(plugin.id);
    assert.equal(typeof plugin.bundledDir, 'string', `${plugin.id} needs bundledDir`);
    const dir = path.join(ROOT, 'resources', 'plugins', plugin.bundledDir);
    assert.equal(manager.digestDirectory(dir), plugin.digest, `digest mismatch for ${plugin.id}`);
  }
});

test('all bundled theme presets are listed in the catalog', () => {
  const manager = new PluginManager({
    dshHome: path.join(ROOT, '.catalog-test-home'),
    catalogPath: path.join(ROOT, 'resources', 'plugin-catalog.json'),
    bundleRoot: path.join(ROOT, 'resources', 'plugins'),
  });
  const ids = manager.catalog.map((plugin) => plugin.id);
  for (const theme of ['desktop-ocean-theme', 'desktop-aurora-theme', 'desktop-rose-theme', 'desktop-sand-theme']) {
    assert.ok(ids.includes(theme), `catalog should list ${theme}`);
  }
});
