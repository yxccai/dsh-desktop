'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDshIntegration, installBridgePackage, START, END } = require('../src/dsh-integration');

const PACKAGE = '@yxccai/dsh-desktop-plugin-center';

test('adds a user-level DSH patch without editing profile or shipped files', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-integration-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = ensureDshIntegration(home);
  const text = fs.readFileSync(result.patchPath, 'utf8');
  assert.equal(result.changed, true);
  assert.match(text, /id: desktop-plugin-center/);
  assert.match(text, /@yxccai\/dsh-desktop-plugin-center/);
});

test('preserves existing patches and updates its managed block idempotently', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-integration-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), '- id: existing\n  disabled: true\n');
  ensureDshIntegration(home);
  const second = ensureDshIntegration(home);
  const text = fs.readFileSync(second.patchPath, 'utf8');
  assert.match(text, /id: existing/);
  assert.equal((text.match(new RegExp(START, 'g')) || []).length, 1);
  assert.equal((text.match(new RegExp(END, 'g')) || []).length, 1);
  assert.match(text, new RegExp(PACKAGE.replace('/', '\\/')));
  assert.equal(second.changed, false);
});

test('rejects any untrusted integration package name', () => {
  assert.throws(() => ensureDshIntegration('x', 'other-package'), /不允许/);
});

test('installs the bridge package under DSH_HOME node_modules transactionally', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: PACKAGE, version: '1.0.0' }));
  fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'host');
  fs.writeFileSync(path.join(source, 'lib', 'client.js'), 'client');
  const first = installBridgePackage(path.join(root, 'home'), source);
  assert.equal(first.changed, true);
  assert.equal(fs.readFileSync(path.join(first.target, 'lib', 'client.js'), 'utf8'), 'client');
  assert.equal(installBridgePackage(path.join(root, 'home'), source).changed, false);
  fs.writeFileSync(path.join(source, 'lib', 'client.js'), 'updated client');
  const refreshed = installBridgePackage(path.join(root, 'home'), source);
  assert.equal(refreshed.changed, true);
  assert.equal(fs.readFileSync(path.join(refreshed.target, 'lib', 'client.js'), 'utf8'), 'updated client');
});
