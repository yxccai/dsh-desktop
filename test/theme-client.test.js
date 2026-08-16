'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.join(__dirname, '..', 'resources', 'dsh-plugin-center', 'lib', 'client.js');

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Boot the Plugin Center client factory with stubbed DOM/API and return a harness. */
function boot() {
  const layers = [];
  const theme = {
    overrideTokens(source, tokens) {
      const layer = { source, tokens, disposed: false };
      layers.push(layer);
      return () => { layer.disposed = true; };
    },
  };
  let catalog = { recommended: [] };
  let background = null;
  const api = {
    pluginCenter: {
      list: async () => catalog,
      backgroundGet: async () => background,
    },
    projectPanel: {},
  };
  const listeners = new Map();
  const windowLike = {
    dshDesktop: api,
    __ModuleLoader__: { load() {} },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type);
      if (set) for (const listener of Array.from(set)) listener(event);
    },
  };
  const appended = [];
  const documentLike = {
    createElement(tag) {
      if (tag === 'style') return { dataset: {}, style: {}, textContent: '', removed: false, remove() { this.removed = true; } };
      return { dataset: {}, style: { cssText: '' }, setAttribute() {}, append() {}, remove() {} };
    },
    head: { appended, appendChild(el) { appended.push(el); } },
    body: {},
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const previous = { window: global.window, document: global.document, MutationObserver: global.MutationObserver, getComputedStyle: global.getComputedStyle, requestAnimationFrame: global.requestAnimationFrame, cancelAnimationFrame: global.cancelAnimationFrame };
  global.window = windowLike;
  global.document = documentLike;
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.getComputedStyle = () => ({ position: 'static' });
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};

  let capturedFactory = null;
  windowLike.__ModuleLoader__ = { load(spec) { capturedFactory = spec.factory; } };
  const source = fs.readFileSync(CLIENT_PATH, 'utf8');
  vm.runInThisContext(source, { filename: CLIENT_PATH });
  assert.equal(typeof capturedFactory, 'function', 'client factory should register itself');

  const mod = capturedFactory((id) => {
    if (id === 'react') return { createElement: () => null, useState: () => [], useEffect: () => {}, Fragment: 'fragment' };
    if (id === 'react-dom') return { createPortal: (node) => node };
    throw new Error(`unexpected require: ${id}`);
  });
  assert.equal(typeof mod.apply, 'function');

  const disposers = [];
  const ctx = {
    get(name) {
      if (name === 'slots') return { inject() {} };
      if (name === 'theme') return theme;
      return undefined;
    },
    effect(fn) {
      try {
        const disposer = fn();
        if (typeof disposer === 'function') disposers.push(disposer);
      } catch (error) {
        // Side-effect effects (project column, click interception) need a full
        // DOM; the managed-theme effect is the one under test.
        if (String(error && error.message).includes('managed')) throw error;
      }
    },
  };
  mod.apply(ctx);

  return {
    layers,
    appended,
    themeStyles() {
      return appended.filter((el) => el.dataset.dshDesktopTheme);
    },
    disposers,
    async setCatalog(recommended, nextBackground = null) {
      catalog = { recommended };
      background = nextBackground;
      windowLike.dispatchEvent({ type: 'dsh-desktop-plugin-catalog-change' });
      await tick();
      await tick();
    },
    async flush() {
      await tick();
      await tick();
    },
    teardown() {
      for (const dispose of disposers) {
        try { dispose(); } catch {}
      }
      Object.assign(global, previous);
    },
  };
}

test('managed theme applies token overrides and cleans them on switch and disable', async () => {
  const harness = boot();
  try {
    const enabled = (id) => ({ id, status: 'enabled' });
    await harness.flush();
    assert.equal(harness.layers.length, 0, 'no theme layer before any theme is enabled');

    // Enable Ocean -> one override layer plus a background style.
    await harness.setCatalog([enabled('desktop-ocean-theme')]);
    assert.equal(harness.layers.length, 1);
    assert.equal(harness.layers[0].source, 'dsh-desktop-ocean-theme');
    assert.equal(harness.layers[0].disposed, false);
    assert.equal(harness.layers[0].tokens['--dsw-alias-brand-primary'].light, '#087f9d');
    assert.equal(harness.themeStyles().length, 1);
    assert.equal(harness.themeStyles()[0].dataset.dshDesktopTheme, 'desktop-ocean-theme');

    // Switch to Rose -> previous layer disposed, old style removed, new layer applied.
    await harness.setCatalog([enabled('desktop-rose-theme')]);
    assert.equal(harness.layers[0].disposed, true, 'ocean layer must be disposed on switch');
    assert.equal(harness.themeStyles()[0].removed, true, 'ocean style must be removed on switch');
    assert.equal(harness.layers[1].source, 'dsh-desktop-rose-theme');
    assert.equal(harness.layers[1].disposed, false);
    assert.equal(harness.themeStyles()[1].dataset.dshDesktopTheme, 'desktop-rose-theme');

    // Switch to Aurora -> Rose cleaned, Aurora applied.
    await harness.setCatalog([enabled('desktop-aurora-theme')]);
    assert.equal(harness.layers[1].disposed, true);
    assert.equal(harness.layers[2].source, 'dsh-desktop-aurora-theme');
    assert.equal(harness.themeStyles()[1].removed, true);
    assert.equal(harness.themeStyles()[2].dataset.dshDesktopTheme, 'desktop-aurora-theme');

    // Disable all themes -> layer disposed, style removed.
    await harness.setCatalog([]);
    assert.equal(harness.layers[2].disposed, true, 'aurora layer must be disposed on disable');
    assert.equal(harness.themeStyles()[2].removed, true, 'aurora style must be removed on disable');
    assert.equal(harness.layers.length, 3, 'no new layer after disable');
  } finally {
    harness.teardown();
  }
});

test('custom background still overrides tokens on top of the enabled theme', async () => {
  const harness = boot();
  try {
    await harness.setCatalog(
      [{ id: 'desktop-sand-theme', status: 'enabled' }, { id: 'desktop-custom-background', status: 'enabled' }],
      { dataUrl: 'data:image/png;base64,AA==', opacity: 70 },
    );
    const sources = harness.layers.map((layer) => layer.source);
    assert.ok(sources.includes('dsh-desktop-sand-theme'), 'theme layer should be applied');
    assert.ok(sources.includes('dsh-desktop-custom-background'), 'custom background layer should be applied');
    const backgroundLayer = harness.layers.find((layer) => layer.source === 'dsh-desktop-custom-background');
    assert.match(backgroundLayer.tokens['--dsw-alias-bg-base'].light, /^rgba\(/, 'background tokens stay translucent');
    assert.equal(backgroundLayer.disposed, false);

    // Disabling the custom background removes only its layer, not the theme's.
    await harness.setCatalog([{ id: 'desktop-sand-theme', status: 'enabled' }]);
    assert.equal(backgroundLayer.disposed, true, 'background layer disposed when disabled');
    const themeLayer = harness.layers.find((layer) => layer.source === 'dsh-desktop-sand-theme');
    assert.equal(themeLayer.disposed, false, 'theme layer survives background disable');
  } finally {
    harness.teardown();
  }
});
