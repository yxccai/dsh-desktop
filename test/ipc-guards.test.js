'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPluginCenterSender, isWebMarketSender, isMainDshPage } = require('../src/ipc-guards');

// Fake BrowserWindow / webContents stand-ins: enough surface for the guards.
function fakeWindow(webContents, destroyed = false) {
  return { webContents, isDestroyed: () => destroyed };
}
function fakeSender(id, url) {
  return { id, getURL: () => url };
}

const TRUSTED_ORIGIN = 'https://dsh.example';

test('plugin-center window is accepted by every guard', () => {
  const sender = fakeSender('pc', 'file:///plugin-center.html');
  const state = { pluginCenterWindow: fakeWindow(sender), mainWindow: fakeWindow(fakeSender('main', TRUSTED_ORIGIN)), sender, isAllowedNavigation: () => true };
  assert.equal(isPluginCenterSender(state), true);
  assert.equal(isWebMarketSender(state), true);
});

test('main DSH page on the exact trusted origin is accepted', () => {
  const mainContents = fakeSender('main', TRUSTED_ORIGIN + '/settings/plugins');
  const state = { pluginCenterWindow: null, mainWindow: fakeWindow(mainContents), sender: mainContents, isAllowedNavigation: () => true };
  assert.equal(isPluginCenterSender(state), true);
  assert.equal(isWebMarketSender(state), true);
  assert.equal(isMainDshPage(state), true);
});

test('main DSH page on a foreign origin is rejected', () => {
  const mainContents = fakeSender('main', 'https://evil.example/phish');
  const state = { pluginCenterWindow: null, mainWindow: fakeWindow(mainContents), sender: mainContents, isAllowedNavigation: () => false };
  assert.equal(isPluginCenterSender(state), false);
  assert.equal(isWebMarketSender(state), false);
  assert.equal(isMainDshPage(state), false);
});

test('web-market IPC allows the trusted main DSH page even when the plugin-center window is closed', () => {
  const mainContents = fakeSender('main', TRUSTED_ORIGIN + '/settings/plugins');
  const state = { pluginCenterWindow: null, mainWindow: fakeWindow(mainContents), sender: mainContents, isAllowedNavigation: () => true };
  assert.equal(isWebMarketSender(state), true);
});

test('unknown senders (no matching window) are rejected', () => {
  const sender = fakeSender('ghost', 'file:///whatever');
  const state = { pluginCenterWindow: fakeWindow(fakeSender('pc', 'file:///plugin-center.html')), mainWindow: fakeWindow(fakeSender('main', TRUSTED_ORIGIN)), sender, isAllowedNavigation: () => true };
  assert.equal(isPluginCenterSender(state), false);
  assert.equal(isWebMarketSender(state), false);
});

test('destroyed windows are never accepted', () => {
  const sender = fakeSender('pc', 'file:///plugin-center.html');
  const state = { pluginCenterWindow: fakeWindow(sender, true), mainWindow: null, sender, isAllowedNavigation: () => true };
  assert.equal(isPluginCenterSender(state), false);
  assert.equal(isWebMarketSender(state), false);
});

test('the URL check runs only against the main window and receives its exact URL', () => {
  const mainContents = fakeSender('main', TRUSTED_ORIGIN + '/conversation');
  const calls = [];
  const isAllowedNavigation = (url) => { calls.push(url); return url === TRUSTED_ORIGIN + '/conversation'; };
  const state = { pluginCenterWindow: fakeWindow(fakeSender('pc', 'file:///plugin-center.html')), mainWindow: fakeWindow(mainContents), sender: mainContents, isAllowedNavigation };
  assert.equal(isWebMarketSender(state), true);
  assert.deepEqual(calls, [TRUSTED_ORIGIN + '/conversation']);
});

test('guards are pure: missing windows and missing URL checks fail closed', () => {
  const sender = fakeSender('main', TRUSTED_ORIGIN);
  const state = { pluginCenterWindow: null, mainWindow: null, sender, isAllowedNavigation: () => true };
  assert.equal(isPluginCenterSender(state), false);
  assert.equal(isWebMarketSender(state), false);
  assert.throws(() => isMainDshPage({ pluginCenterWindow: null, mainWindow: fakeWindow(sender), sender }), TypeError);
});
