'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE_NAME, PATCH_ID, VENDORED_DIGEST, digestDirectory } = require('../src/web-market-manager');

const ROOT = path.join(__dirname, '..', 'resources', 'market-plugin');

test('vendors the fixed upstream version with MIT attribution', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.version, '0.5.2');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.main, 'lib/host.js');
  assert.ok(manifest.exports['./client']);
  assert.ok(manifest.dsh.bundle.patch, 'cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
});

test('vendored artifact contains every runtime file', () => {
  for (const file of ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'VENDORED.md', 'lib/host.js', 'lib/client.js', 'data/catalog-snapshot.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `missing vendored file ${file}`);
  }
});

test('vendored bundle patch mounts the market under the web profile', () => {
  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, new RegExp(`id: ${PATCH_ID}`));
  assert.match(patch, new RegExp(PACKAGE_NAME.replace('/', '\\/')));
});

test('vendored host and client declare the expected contract', () => {
  const host = fs.readFileSync(path.join(ROOT, 'lib', 'host.js'), 'utf8');
  assert.match(host, /export const name = 'dsh-market-plugin'/);
  assert.match(host, /export function apply\(ctx\)/);
  assert.match(host, /\/api\/dsh-market/);
  const client = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  assert.match(client, /window\.__ModuleLoader__\.load/);
  assert.match(client, /settings\.plugins\.tab/);
});

test('offline catalog snapshot is present and non-empty', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog-snapshot.json'), 'utf8'));
  assert.ok(Array.isArray(snapshot.plugins) && snapshot.plugins.length > 100, 'snapshot should carry the community catalog');
  assert.ok(Array.isArray(snapshot.cats) && snapshot.cats.length > 5, 'snapshot should carry categories');
  const first = snapshot.plugins[0];
  for (const field of ['cat', 'name', 'url', 'cmd', 'profile', 'source']) {
    assert.equal(typeof first[field], 'string', `plugin entry missing ${field}`);
  }
});

test('vendored bundle matches the pinned digest and contains no forbidden files', () => {
  assert.equal(digestDirectory(ROOT), VENDORED_DIGEST, 'vendored tree must stay byte-stable');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
  const files = walk(ROOT).map((file) => path.basename(file).toLowerCase());
  assert.ok(!files.includes('helloworld.cpp'), 'no unrelated source file may ride inside the vendored bundle');
});

// The client is an ORIGINAL redesigned UI (DSH Desktop distribution) while the
// host API contract it drives stays identical to upstream. These tests pin the
// provenance so a future revert to the upstream UI cannot go unnoticed.
test('vendored client is the original command-center redesign, not the upstream UI', () => {
  const client = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  assert.ok(!client.includes('.mkts-'), 'upstream .mkts- UI classes must not appear in the redesigned client');
  assert.ok(client.includes('.wmp-banner') && client.includes('.wmp-palette') && client.includes('.wmp-rail') && client.includes('.wmp-list'), 'redesigned client uses its own .wmp- command-center/list classes');
  assert.ok(!client.includes('mkts-item') && !client.includes('mkts-search'), 'no upstream card markup survives in the redesign');
});

test('vendored client preserves every host API method', () => {
  const client = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  // Direct call sites: api('method', ...)
  const direct = ['list', 'probe', 'installed', 'installedAll', 'updates', 'updateAll', 'op', 'kill', 'clear', 'clearAll'];
  for (const method of direct) {
    assert.match(client, new RegExp(`api\\(['"]${method}['"]`), `client must still call the ${method} host method`);
  }
  // Dispatched through ternaries: the quoted literals must still exist.
  for (const method of ['install', 'uninstall', 'update', 'disable', 'enable']) {
    assert.match(client, new RegExp(`['"]${method}['"]`), `client must still dispatch the ${method} host method`);
  }
  assert.match(client, /\/api\/dsh-market/);
  assert.match(client, /settings\.plugins\.tab/);
});

test('VENDORED.md states host-from-upstream and client-redesigned provenance', () => {
  const text = fs.readFileSync(path.join(ROOT, 'VENDORED.md'), 'utf8');
  assert.ok(!/fixed,\s*unmodified/i.test(text), 'VENDORED.md must not claim the whole bundle is unmodified');
  assert.match(text, /independently redesigned/i);
  assert.match(text, /byte-for-byte/);
  assert.match(text, /MIT/);
  assert.match(text, /lib\/host\.js/);
  assert.match(text, /lib\/client\.js/);
});
