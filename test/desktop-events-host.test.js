'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HOST_PATH = path.join(__dirname, '..', 'resources', 'dsh-plugin-center', 'lib', 'host.js');
const loadHost = () => import(pathToFileURL(HOST_PATH).href);

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(value) { this.body = value; },
  };
}

test('desktop event host records events and serves since cursor', async () => {
  const { apply } = await loadHost();
  const listeners = new Map();
  let route;
  const ctx = {
    get: () => ({ register(value) { route = value; } }),
    on(name, fn) { listeners.set(name, fn); },
  };
  apply(ctx);
  listeners.get('approval/request')({ description: 'Run shell command' }, () => Promise.resolve());
  listeners.get('agent/status')({ agent: { title: 'Build' }, status: 'idle' });
  listeners.get('agent/error')({ agent: { title: 'Tests' }, error: new Error('failed') });
  const response = fakeResponse();
  await route.handler({ method: 'GET', url: '/api/dsh-desktop-events?since=1' }, response);
  assert.equal(response.status, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, 'done');
  assert.equal(result.events[1].kind, 'error');
  assert.match(result.events[1].body, /failed/);
});

test('desktop event host rejects invalid requests and reports handler errors', async () => {
  const { apply } = await loadHost();
  let route;
  const ctx = { get: () => ({ register(value) { route = value; } }), on() {} };
  apply(ctx);
  const methodResponse = fakeResponse();
  await route.handler({ method: 'POST', url: '/' }, methodResponse);
  assert.equal(methodResponse.status, 400);
  const sinceResponse = fakeResponse();
  await route.handler({ method: 'GET', url: '/?since=nope' }, sinceResponse);
  assert.equal(sinceResponse.status, 400);
});
