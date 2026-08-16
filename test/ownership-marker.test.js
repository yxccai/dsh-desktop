'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { RuntimeManager } = require('../src/runtime-manager');
const {
  writeMarker,
  readMarker,
  removeMarker,
  isPidAlive,
  probeProcess,
  validateOwnership,
} = require('../src/ownership-marker');

const DSH_HTML = '<script>window.__DSH_BOOT__={"id":"@deepseek-ai/dsh-client"}</script>';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-own-'));
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function startDshServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(DSH_HTML);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function serverUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A long-lived node process; its OS command line includes `extraArgs`.
 * `--` stops node option parsing so `--port`-style args land in process.argv
 * instead of being rejected as bad CLI options.
 */
function spawnSleeper(extraArgs = []) {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...extraArgs], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function markerFor(url, pid, command) {
  return {
    pid,
    url,
    command: command || path.basename(process.execPath).toLowerCase(),
    label: 'test',
    startedAt: new Date().toISOString(),
  };
}

function makeRuntime(tmp, url, markerPath, probe) {
  const logs = [];
  const runtime = new RuntimeManager(
    { url, launchMode: 'connect', candidateTimeoutMs: 10000, dshHome: tmp, workingDirectory: tmp },
    (line) => logs.push(String(line)),
    {},
    { markerPath, ...(probe ? { probeProcess: probe } : {}) },
  );
  return { runtime, logs };
}

function waitExit(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

async function assertStillServing(url) {
  const status = await new Promise((resolve) => {
    http.get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', () => resolve(0));
  });
  assert.equal(status, 200, `external service at ${url} must keep serving`);
}

// ---------------------------------------------------------------------------
// marker module primitives
// ---------------------------------------------------------------------------

test('marker write/read/remove round-trips and cleans temp siblings', () => {
  const dir = tempDir();
  const file = path.join(dir, 'dsh-ownership.json');
  assert.equal(readMarker(file), null);
  writeMarker(file, { pid: 1234, url: 'http://127.0.0.1:3080', command: 'node.exe', label: 'npx' });
  assert.deepEqual(readMarker(file), { pid: 1234, url: 'http://127.0.0.1:3080', command: 'node.exe', label: 'npx' });
  // a leftover atomic-write temp must be removed too
  fs.writeFileSync(`${file}.tmp-999-1`, 'x');
  removeMarker(file);
  assert.equal(readMarker(file), null);
  assert.equal(fs.existsSync(`${file}.tmp-999-1`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isPidAlive rejects invalid pids and reports live processes', async () => {
  assert.equal(isPidAlive(null), false);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-1), false);
  assert.equal(isPidAlive(99999999), false);
  const child = spawnSleeper();
  assert.equal(isPidAlive(child.pid), true);
  child.kill();
  await waitExit(child);
  assert.equal(isPidAlive(child.pid), false);
});

test('probeProcess reports the live image without throwing', async () => {
  const info = await probeProcess(process.pid);
  assert.equal(info.alive, true);
  assert.ok(info.image, 'image name should be resolved');
  assert.equal(info.image, path.basename(process.execPath).toLowerCase());
});

test('validateOwnership accepts only plausible live markers', async () => {
  const url = 'http://127.0.0.1:3080';
  assert.equal((await validateOwnership(null, { url })).valid, false);
  assert.equal((await validateOwnership({ pid: 'abc', url }, { url })).valid, false);
  assert.equal((await validateOwnership({ pid: 42, url: 'http://127.0.0.1:9999' }, { url })).valid, false);
  assert.equal((await validateOwnership({ pid: 42, url }, { url, info: { alive: false } })).valid, false);
  const imageMismatch = await validateOwnership(
    { pid: 42, url, command: 'node.exe' },
    { url, info: { alive: true, image: 'calc.exe', commandLine: '--port 3080' } },
  );
  assert.equal(imageMismatch.valid, false);
  const noPort = await validateOwnership(
    { pid: 42, url, command: 'node.exe' },
    { url, info: { alive: true, image: 'node.exe', commandLine: 'node unrelated.js' } },
  );
  assert.equal(noPort.valid, false);
  const good = await validateOwnership(
    { pid: 42, url, command: 'node.exe' },
    { url, info: { alive: true, image: 'node.exe', commandLine: 'node web --host 127.0.0.1 --port 3080' } },
  );
  assert.equal(good.valid, true);
});

// ---------------------------------------------------------------------------
// persist
// ---------------------------------------------------------------------------

test('starting a candidate persists the marker and stop() removes it', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const logs = [];
  const runtime = new RuntimeManager(
    { url: 'http://127.0.0.1:3080', dshHome: tmp, workingDirectory: tmp, launchMode: 'auto', candidateTimeoutMs: 5000 },
    (line) => logs.push(String(line)),
    {},
    { markerPath },
  );
  const spec = { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], viaCommandShell: false, label: 'test' };
  await runtime.startOne(spec);
  const pid = runtime.child.pid;

  const marker = readMarker(markerPath);
  assert.ok(marker, 'marker must be written when a candidate starts');
  assert.equal(marker.pid, pid);
  assert.equal(marker.url, 'http://127.0.0.1:3080');
  assert.equal(marker.command, path.basename(process.execPath).toLowerCase());
  assert.equal(marker.label, 'test');
  assert.equal(runtime.owned, true);
  assert.equal(runtime.adopted, null);

  assert.equal(await runtime.stop(), true);
  assert.equal(readMarker(markerPath), null, 'marker removed after stop');
  assert.equal(runtime.owned, false);
  assert.equal(isPidAlive(pid), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// adopt
// ---------------------------------------------------------------------------

test('adopts an existing DSH service when the marker is valid and stop() kills it', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);
  const sleeper = spawnSleeper(['--port', String(server.address().port)]);
  writeMarker(markerPath, markerFor(url, sleeper.pid));

  const { runtime, logs } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: path.basename(process.execPath).toLowerCase(),
    commandLine: `${process.execPath} -e setInterval(() => {}, 1000) -- --port ${server.address().port}`,
  }));

  const mode = await runtime.ensureReady();
  assert.equal(mode, 'adopted');
  assert.equal(runtime.owned, true);
  assert.equal(runtime.adopted.pid, sleeper.pid);
  assert.ok(logs.some((line) => /Adopted owned DSH service/.test(line)), 'adoption is logged');

  // stop() must kill the stored root process tree (taskkill /t on Windows)
  // even though no ChildProcess handle exists for it, and remove the marker.
  assert.equal(await runtime.stop(), true);
  assert.equal(readMarker(markerPath), null, 'marker removed after stopping adopted tree');
  assert.equal(isPidAlive(sleeper.pid), false, 'adopted root process must be dead');
  await assertStillServing(url);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stop() kills the adopted root process tree including grandchildren on Windows', { skip: process.platform !== 'win32' }, async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);
  const port = server.address().port;

  const rootScript = [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    'fs.writeFileSync(process.argv[1], String(child.pid));',
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const grandchildFile = path.join(tmp, 'grandchild.pid');
  const root = spawn(process.execPath, ['-e', rootScript, '--', grandchildFile, '--port', String(port)], { stdio: 'ignore' });

  let grandchildPid = null;
  for (let i = 0; i < 50 && !grandchildPid; i += 1) {
    try { grandchildPid = Number(fs.readFileSync(grandchildFile, 'utf8').trim()); } catch { await delay(100); }
  }
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, 'grandchild should have reported its pid');
  assert.equal(isPidAlive(grandchildPid), true);

  writeMarker(markerPath, markerFor(url, root.pid));
  const { runtime } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: path.basename(process.execPath).toLowerCase(),
    commandLine: `${process.execPath} -e <root script> -- ${grandchildFile} --port ${port}`,
  }));
  assert.equal(await runtime.ensureReady(), 'adopted');

  assert.equal(await runtime.stop(), true);
  assert.equal(isPidAlive(root.pid), false, 'adopted root must be dead');
  assert.equal(isPidAlive(grandchildPid), false, 'grandchild must be killed with the tree');
  await assertStillServing(url);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('waits for and adopts a marked DSH process that is still starting', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  const sleeper = spawnSleeper(['--port', String(port)]);
  writeMarker(markerPath, markerFor(url, sleeper.pid));

  // Start the DSH server only after a short delay so the first probes see the
  // port unreachable and exercise the "still starting" wait. The listen
  // callback (not a bare setTimeout) gates the ready state.
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(DSH_HTML);
  });
  let listening = false;
  const serverReady = new Promise((resolve) => {
    setTimeout(() => {
      server.listen(port, '127.0.0.1', () => { listening = true; resolve(); });
    }, 600);
  });

  const { runtime, logs } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: path.basename(process.execPath).toLowerCase(),
    commandLine: `${process.execPath} -e setInterval(() => {}, 1000) -- --port ${port}`,
  }));

  try {
    const mode = await runtime.ensureReady();
    await serverReady;
    assert.equal(mode, 'adopted');
    assert.equal(runtime.adopted.pid, sleeper.pid);
    assert.ok(logs.some((line) => /Waiting for marked DSH process/.test(line)), 'waiting is logged');
    assert.ok(logs.some((line) => /Adopted owned DSH service/.test(line)), 'adoption is logged');
  } finally {
    if (listening) await new Promise((resolve) => server.close(resolve));
    else server.close();
    if (runtime.adopted) await runtime.stop();
    sleeper.kill();
    await waitExit(sleeper);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// stale markers
// ---------------------------------------------------------------------------

test('ignores and removes a stale marker whose pid is dead', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);

  const dead = spawnSleeper();
  const deadPid = dead.pid;
  dead.kill();
  await waitExit(dead);
  assert.equal(isPidAlive(deadPid), false);
  writeMarker(markerPath, markerFor(url, deadPid));

  const { runtime, logs } = makeRuntime(tmp, url, markerPath);
  const mode = await runtime.ensureReady();
  assert.equal(mode, 'existing');
  assert.equal(runtime.owned, false);
  assert.equal(runtime.adopted, null);
  assert.equal(readMarker(markerPath), null, 'stale marker removed');
  assert.ok(logs.some((line) => /Ignoring invalid ownership marker/.test(line)), 'stale marker rejection is logged');

  await runtime.stop();
  await assertStillServing(url);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('removes a marker whose pid dies while waiting for it to serve', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  const sleeper = spawnSleeper(['--port', String(port)]);
  writeMarker(markerPath, markerFor(url, sleeper.pid));

  const { runtime, logs } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: path.basename(process.execPath).toLowerCase(),
    commandLine: `${process.execPath} -e setInterval(() => {}, 1000) -- --port ${port}`,
  }));

  const pending = runtime.waitForMarked();
  await delay(300);
  sleeper.kill();
  await waitExit(sleeper);

  assert.equal(await pending, false, 'wait must give up when the marked process dies');
  assert.equal(readMarker(markerPath), null, 'marker removed after the process died');
  assert.ok(logs.some((line) => /exited while waiting/.test(line)), 'death during wait is logged');
  await runtime.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// external services and pid reuse
// ---------------------------------------------------------------------------

test('connects to an external DSH service without adopting or killing it', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);

  const { runtime, logs } = makeRuntime(tmp, url, markerPath);
  const mode = await runtime.ensureReady();
  assert.equal(mode, 'existing');
  assert.equal(runtime.owned, false);
  assert.equal(runtime.adopted, null);
  assert.equal(readMarker(markerPath), null);
  assert.ok(logs.some((line) => /Connected to existing DSH service/.test(line)), 'external connect is logged');

  await runtime.stop();
  await assertStillServing(url);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('refuses a marker whose url does not match the configured service', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);
  const sleeper = spawnSleeper(['--port', String(server.address().port)]);
  writeMarker(markerPath, { ...markerFor(url, sleeper.pid), url: 'http://127.0.0.1:9999' });

  const { runtime } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: 'node.exe',
    commandLine: '--port 9999',
  }));
  const mode = await runtime.ensureReady();
  assert.equal(mode, 'existing');
  assert.equal(runtime.owned, false);
  assert.equal(readMarker(markerPath), null, 'mismatched marker removed');

  await runtime.stop();
  assert.equal(isPidAlive(sleeper.pid), true, 'process behind a mismatched marker must survive');
  sleeper.kill();
  await waitExit(sleeper);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('never kills a process whose image does not match the marker', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);
  const sleeper = spawnSleeper(['--port', String(server.address().port)]);
  writeMarker(markerPath, markerFor(url, sleeper.pid, 'node.exe'));

  const { runtime } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: 'totally-unrelated.exe',
    commandLine: 'unrelated --port 3080',
  }));
  const mode = await runtime.ensureReady();
  assert.equal(mode, 'existing');
  assert.equal(runtime.owned, false);
  assert.equal(readMarker(markerPath), null, 'implausible marker removed');

  await runtime.stop();
  assert.equal(isPidAlive(sleeper.pid), true, 'unrelated process must survive');
  sleeper.kill();
  await waitExit(sleeper);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('refuses adoption when the command line does not reference our port', async () => {
  const tmp = tempDir();
  const markerPath = path.join(tmp, 'dsh-ownership.json');
  const server = await startDshServer();
  const url = serverUrl(server);
  const sleeper = spawnSleeper(['--port', String(server.address().port)]);
  writeMarker(markerPath, markerFor(url, sleeper.pid, 'node.exe'));

  const { runtime } = makeRuntime(tmp, url, markerPath, async () => ({
    alive: true,
    image: path.basename(process.execPath).toLowerCase(),
    commandLine: 'node some-unrelated-server.js',
  }));
  const mode = await runtime.ensureReady();
  assert.equal(mode, 'existing');
  assert.equal(runtime.owned, false);
  assert.equal(readMarker(markerPath), null);

  await runtime.stop();
  assert.equal(isPidAlive(sleeper.pid), true, 'process with a foreign command line must survive');
  sleeper.kill();
  await waitExit(sleeper);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});
