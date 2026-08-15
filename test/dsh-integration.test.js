'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDshIntegration, START, END } = require('../src/dsh-integration');

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
