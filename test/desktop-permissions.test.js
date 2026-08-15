'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { allowsDesktopPermission } = require('../src/desktop-permissions');

const base = { appOrigin: 'http://127.0.0.1:3080', senderUrl: 'http://127.0.0.1:3080/session/1', isMainWindow: true };

test('allows clipboard writes only from the trusted main DSH page', () => {
  assert.equal(allowsDesktopPermission({ ...base, permission: 'clipboard-sanitized-write' }), true);
  assert.equal(allowsDesktopPermission({ ...base, permission: 'clipboard-write' }), true);
  assert.equal(allowsDesktopPermission({ ...base, permission: 'clipboard-read' }), false);
  assert.equal(allowsDesktopPermission({ ...base, permission: 'media' }), false);
  assert.equal(allowsDesktopPermission({ ...base, permission: 'clipboard-write', senderUrl: 'https://example.com' }), false);
  assert.equal(allowsDesktopPermission({ ...base, permission: 'clipboard-write', isMainWindow: false }), false);
});
