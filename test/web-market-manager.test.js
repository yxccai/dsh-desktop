'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebMarketManager, PACKAGE_NAME, PATCH_ID, START, END, MARKER_FILE, VENDORED_DIGEST, digestDirectory, renderBlock } = require('../src/web-market-manager');
const { ensureDshIntegration, upsertManagedBlock, stripManagedBlock } = require('../src/dsh-integration');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_BUNDLE = path.join(REPO_ROOT, 'resources', 'market-plugin');
const BRIDGE = '@yxccai/dsh-desktop-plugin-center';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-market-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dshHome = path.join(root, 'home');
  fs.mkdirSync(dshHome, { recursive: true });
  return { manager: new WebMarketManager({ dshHome, bundleRoot: REAL_BUNDLE }), dshHome, root };
}

function readPatch(dshHome) {
  const file = path.join(dshHome, 'cordis.patch.yml');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function profileWeb(dshHome) {
  return path.join(dshHome, 'profiles', 'web');
}

test('managed-block helpers upsert and strip cleanly', () => {
  const start = '# >>> A >>>';
  const end = '# <<< A <<<';
  const blockA = `${start}\n- insert:\n    - id: a\n      name: 'pkg-a'\n${end}`;
  const blockB = `${start}\n- id: a\n  disabled: true\n${end}`;
  assert.equal(upsertManagedBlock('[]\n', start, end, blockA), `${blockA}\n`);
  const withOther = `- id: existing\n  disabled: true\n`;
  const mixed = upsertManagedBlock(withOther, start, end, blockA);
  assert.match(mixed, /id: existing/);
  assert.equal(mixed.indexOf(start), mixed.lastIndexOf(start));
  assert.equal(upsertManagedBlock(mixed, start, end, blockB), mixed.replace(blockA, blockB));
  assert.equal(stripManagedBlock(mixed, start, end), withOther);
  assert.equal(stripManagedBlock(withOther, start, end), withOther);
  assert.equal(stripManagedBlock(`${blockA}\n`, start, end), '[]\n');
});

test('installs, disables, enables, and uninstalls the web market transactionally', async (t) => {
  const { manager, dshHome } = fixture(t);
  assert.equal(manager.list().entry.status, 'available');

  const afterInstall = await manager.install();
  assert.equal(afterInstall.entry.status, 'enabled');
  assert.ok(fs.existsSync(path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin', 'lib', 'host.js')));
  assert.ok(fs.existsSync(path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin', MARKER_FILE)));
  const patch = readPatch(dshHome);
  assert.match(patch, /- insert:/);
  assert.match(patch, new RegExp(`id: ${PATCH_ID}`));
  assert.match(patch, new RegExp(PACKAGE_NAME.replace('/', '\\/')));

  const afterDisable = await manager.setEnabled(false);
  assert.equal(afterDisable.entry.status, 'disabled');
  assert.match(readPatch(dshHome), /disabled:\s*true/);
  // package copy stays in place while disabled
  assert.ok(fs.existsSync(path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin', 'package.json')));

  assert.equal((await manager.setEnabled(true)).entry.status, 'enabled');
  assert.doesNotMatch(readPatch(dshHome), /disabled:\s*true/);

  const afterUninstall = await manager.uninstall();
  assert.equal(afterUninstall.entry.status, 'available');
  assert.equal(fs.existsSync(path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin')), false);
  assert.doesNotMatch(readPatch(dshHome), new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('never touches the shared profiles/web directory', async (t) => {
  const { manager, dshHome } = fixture(t);
  fs.mkdirSync(profileWeb(dshHome), { recursive: true });
  const marker = path.join(profileWeb(dshHome), 'sentinel.txt');
  fs.writeFileSync(marker, 'keep me');
  await manager.install();
  await manager.setEnabled(false);
  await manager.setEnabled(true);
  await manager.uninstall();
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep me');
  assert.ok(fs.existsSync(path.join(profileWeb(dshHome), 'sentinel.txt')));
});

test('coexists with the settings bridge block and user patch content', async (t) => {
  const { manager, dshHome } = fixture(t);
  ensureDshIntegration(dshHome);
  fs.appendFileSync(path.join(dshHome, 'cordis.patch.yml'), '- id: user-row\n  disabled: true\n');
  await manager.install();
  const mixed = readPatch(dshHome);
  assert.equal((mixed.match(new RegExp(START, 'g')) || []).length, 1);
  assert.equal((mixed.match(new RegExp(END, 'g')) || []).length, 1);
  assert.match(mixed, /desktop-plugin-center/);
  assert.match(mixed, /id: user-row/);
  await manager.uninstall();
  const remaining = readPatch(dshHome);
  assert.match(remaining, /desktop-plugin-center/);
  assert.match(remaining, /id: user-row/);
  assert.doesNotMatch(remaining, /dsh-market-plugin/);
});

test('rejects a foreign package in node_modules as a conflict', async (t) => {
  const { manager, dshHome } = fixture(t);
  const dir = path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '9.9.9' }));
  assert.equal(manager.list().entry.status, 'conflict');
  await assert.rejects(manager.install(), /冲突/);
  await assert.rejects(manager.setEnabled(true), /冲突/);
  await assert.rejects(manager.uninstall(), /冲突/);
});

test('rolls the package copy back when the patch write fails', async (t) => {
  const { manager, dshHome } = fixture(t);
  fs.mkdirSync(path.join(dshHome, 'cordis.patch.yml')); // make the patch path un-writable (a directory)
  await assert.rejects(manager.install(), /失败|错误|EISDIR|EPERM|EEXIST/);
  assert.equal(fs.existsSync(path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin')), false);
  assert.equal(manager.list().entry.status, 'available');
});

test('refuses to uninstall an owned copy after user modification', async (t) => {
  const { manager, dshHome } = fixture(t);
  await manager.install();
  fs.appendFileSync(path.join(dshHome, 'node_modules', '@sanqi-normal', 'dsh-webui-market-plugin', 'lib', 'host.js'), '\n// user edit\n');
  await assert.rejects(manager.uninstall(), /内容已被修改/);
  assert.equal(manager.list().entry.status, 'enabled');
});

test('rejects a tampered vendored bundle at install time', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-market-fake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = path.join(root, 'bundle');
  fs.mkdirSync(path.join(fake, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(fake, 'data'), { recursive: true });
  fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '0.5.2' }));
  fs.writeFileSync(path.join(fake, 'lib', 'host.js'), 'export const apply = () => {}');
  fs.writeFileSync(path.join(fake, 'lib', 'client.js'), 'window.__ModuleLoader__.load({})');
  fs.writeFileSync(path.join(fake, 'data', 'catalog-snapshot.json'), '{}');
  fs.writeFileSync(path.join(fake, 'cordis.patch.yml'), '- insert:\n');
  const dshHome = path.join(root, 'home');
  const manager = new WebMarketManager({ dshHome, bundleRoot: fake });
  await assert.rejects(manager.install(), /校验失败/);
  assert.equal(manager.list().entry.status, 'available');
});

test('vendored bundle digest is pinned and stable', () => {
  assert.equal(typeof VENDORED_DIGEST, 'string');
  assert.match(VENDORED_DIGEST, /^[0-9a-f]{64}$/);
  assert.equal(digestDirectory(REAL_BUNDLE), VENDORED_DIGEST, 'resources/market-plugin must match the pinned digest');
});

test('renderBlock produces the enabled insert and disabled forms', () => {
  const enabled = renderBlock(true);
  assert.match(enabled, /- insert:/);
  assert.match(enabled, new RegExp(`id: ${PATCH_ID}`));
  assert.match(enabled, new RegExp(PACKAGE_NAME.replace('/', '\\/')));
  assert.doesNotMatch(enabled, /disabled:\s*true/);
  const disabled = renderBlock(false);
  assert.match(disabled, /disabled:\s*true/);
  assert.match(disabled, new RegExp(`id: ${PATCH_ID}`));
  assert.match(disabled, new RegExp(PACKAGE_NAME.replace('/', '\\/')));
  assert.doesNotMatch(disabled, /- insert:/);
});

test('list() exposes the managed-market metadata for the UI card', async (t) => {
  const { manager } = fixture(t);
  const entry = manager.list().entry;
  assert.equal(entry.id, 'web-market');
  assert.equal(entry.patchId, PATCH_ID);
  assert.equal(entry.packageName, PACKAGE_NAME);
  assert.equal(entry.thirdParty, true);
  assert.equal(entry.restartRequired, true);
  assert.match(entry.profile, /web/);
  assert.equal(entry.owned, false);
  await manager.install();
  const owned = manager.list().entry;
  assert.equal(owned.owned, true);
  assert.equal(owned.status, 'enabled');
  assert.equal(typeof owned.version, 'string');
  assert.ok(owned.packageDir.includes(path.join('@sanqi-normal', 'dsh-webui-market-plugin')));
});

test('reports a conflict when the patch references the market but the package is gone', async (t) => {
  const { manager, dshHome } = fixture(t);
  fs.appendFileSync(path.join(dshHome, 'cordis.patch.yml'), `${START}\n- insert:\n    - id: ${PATCH_ID}\n      name: '${PACKAGE_NAME}'\n${END}\n`);
  assert.equal(manager.list().entry.status, 'conflict');
  await assert.rejects(manager.install(), /冲突/);
});

test('runExclusive serializes concurrent mutations', async (t) => {
  const { manager } = fixture(t);
  const [first, second] = await Promise.allSettled([manager.install(), manager.install()]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.match(String(second.reason && second.reason.message), /已安装/);
  assert.equal(manager.list().entry.status, 'enabled');
});

test('digestDirectory ignores the ownership marker file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-market-marker-'));
  try {
    fs.cpSync(REAL_BUNDLE, path.join(root, 'bundle'), { recursive: true });
    const before = digestDirectory(path.join(root, 'bundle'));
    fs.writeFileSync(path.join(root, 'bundle', MARKER_FILE), JSON.stringify({ owner: 'dsh-desktop' }));
    assert.equal(digestDirectory(path.join(root, 'bundle')), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
