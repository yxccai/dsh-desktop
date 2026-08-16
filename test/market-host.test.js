'use strict';

// Unit tests for the market host's lockfile-integrity auto-heal
// (resources/market-plugin/lib/host.js). host.js is ESM, so the plain-CJS
// test file loads it through a dynamic import resolved to an absolute
// file:// URL; the module has no import-time side effects (apply() is what
// registers the HTTP route, and it is never invoked here).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HOST_PATH = path.join(__dirname, '..', 'resources', 'market-plugin', 'lib', 'host.js');

function loadHost() {
  return import(pathToFileURL(HOST_PATH).href);
}

const ARCHIVE = 'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz';

// ── githubArchiveToSpec ──────────────────────────────────────────────────────

test('githubArchiveToSpec converts bare GitHub tag archives to github: specs', async () => {
  const { githubArchiveToSpec } = await loadHost();
  assert.equal(githubArchiveToSpec(ARCHIVE), 'github:owner/repo#v1.2.3');
  // Multi-segment-ish tags and repo names with dots/dashes survive verbatim.
  assert.equal(
    githubArchiveToSpec('https://github.com/SomeOrg/My-Plugin/archive/refs/tags/v0.5.2-beta.1.tar.gz'),
    'github:SomeOrg/My-Plugin#v0.5.2-beta.1'
  );
  assert.equal(
    githubArchiveToSpec('https://github.com/scope.name/repo.name/archive/refs/tags/v2024.1.0.tar.gz'),
    'github:scope.name/repo.name#v2024.1.0'
  );
  // Host matching is case-insensitive; owner/repo/tag are preserved as written.
  assert.equal(
    githubArchiveToSpec('https://GITHUB.com/A/B/archive/refs/tags/v2.0.0.tar.gz'),
    'github:A/B#v2.0.0'
  );
});

test('githubArchiveToSpec returns null for non-matching specs', async () => {
  const { githubArchiveToSpec } = await loadHost();
  const nonMatching = [
    '', null, undefined, 0, 42,
    'github:owner/repo#v1.2.3',                                   // already shorthand
    'github:owner/repo',                                          // bare shorthand
    'owner/repo',                                                 // bare identity
    'https://github.com/owner/repo/archive/refs/heads/main.tar.gz', // branch, not tag
    'https://github.com/owner/repo/archive/refs/pull/1.tar.gz',   // not refs/tags
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.zip', // zip, not tar.gz
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.bz2',
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3',     // no archive extension
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz/extra',
    'https://github.com/owner/repo/archive/refs/tags/a/b.tar.gz', // tag with slash
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz?foo=1', // query string
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz#frag',
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz ', // trailing space
    'https://gitlab.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz', // wrong host
    'https://github.com/owner/repo/archive/refs/tags/v1.2.3.tgz',
    'http://github.com/owner/repo/archive/refs/tags/v1.2.3.tar.gz', // http, not https
    'https://github.com/owner/repo/releases/download/v1.2.3/source.tar.gz',
    'https://codeload.github.com/owner/repo/tar.gz/v1.2.3',
  ];
  for (const spec of nonMatching) {
    assert.equal(githubArchiveToSpec(spec), null, `expected null for ${JSON.stringify(spec)}`);
  }
});

// ── isTarballIntegrityFailure ────────────────────────────────────────────────

test('isTarballIntegrityFailure detects ERR_PNPM_MISSING_TARBALL_INTEGRITY', async () => {
  const { isTarballIntegrityFailure } = await loadHost();
  assert.equal(isTarballIntegrityFailure('ERR_PNPM_MISSING_TARBALL_INTEGRITY'), true);
  assert.equal(
    isTarballIntegrityFailure(
      'Lockfile is not up to date with package.json. Missing tarball integrity for '
      + ARCHIVE + '. ERR_PNPM_MISSING_TARBALL_INTEGRITY'
    ),
    true
  );
  // Substring semantics: a longer token containing the code still counts.
  assert.equal(isTarballIntegrityFailure('... ERR_PNPM_MISSING_TARBALL_INTEGRITY (extra)'), true);
});

test('isTarballIntegrityFailure rejects unrelated output', async () => {
  const { isTarballIntegrityFailure } = await loadHost();
  for (const text of ['', null, undefined, 0, 'all good', 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION',
    'err_pnpm_missing_tarball_integrity', // case-sensitive
    'ERR_PNPM_MISSING_INTEGRITY', 'tarball integrity ok', 'GET https://registry.npmjs.org/x error',
    'ERR_PNPM_UNEXPECTED_STORE']) {
    assert.equal(isTarballIntegrityFailure(text), false, `expected false for ${JSON.stringify(text)}`);
  }
});

// ── healTarballIntegrity ─────────────────────────────────────────────────────

// The heal resolves the profile through DSH_HOME, so each test gets its own
// throwaway home and restores the previous value afterwards.
function withDshHome(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-heal-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function writeProfile(home, profile, text) {
  const dir = path.join(home, 'profiles', profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), text);
  return dir;
}

test('healTarballIntegrity rewrites archive URL deps to github: specs, BOM-free', async (t) => {
  const { healTarballIntegrity } = await loadHost();
  const home = withDshHome(t);
  const manifest = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      'plugin-a': 'https://github.com/one/alpha/archive/refs/tags/v1.2.3.tar.gz',
      'plugin-b': 'github:two/beta#v2.0.0',   // already the target syntax
      'plugin-c': '^1.0.0',                   // npm range
      'plugin-d': 'https://github.com/three/gamma/archive/refs/tags/v0.1.0.tar.gz',
      'plugin-e': 'link:../local',            // local link
    },
    dsh: { profile: { bundles: ['plugin-a', 'plugin-b'] } },
  };
  // A UTF-8 BOM must not survive the heal (JSON.parse would reject it).
  const dir = writeProfile(home, 'web', '\uFEFF' + JSON.stringify(manifest, null, 2) + '\n');

  const rewritten = healTarballIntegrity('web');
  assert.deepEqual([...rewritten].sort(), ['plugin-a', 'plugin-d'], 'only archive URL deps are rewritten');

  const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  assert.notEqual(raw.charCodeAt(0), 0xFEFF, 'BOM must be stripped by the heal');
  const after = JSON.parse(raw); // parses only when the BOM is gone
  assert.equal(after.dependencies['plugin-a'], 'github:one/alpha#v1.2.3');
  assert.equal(after.dependencies['plugin-d'], 'github:three/gamma#v0.1.0');
  assert.equal(after.dependencies['plugin-b'], 'github:two/beta#v2.0.0', 'valid specs untouched');
  assert.equal(after.dependencies['plugin-c'], '^1.0.0', 'npm ranges untouched');
  assert.equal(after.dependencies['plugin-e'], 'link:../local', 'local links untouched');
  assert.deepEqual(after.dsh.profile.bundles, ['plugin-a', 'plugin-b'], 'non-dependency structure intact');
  assert.equal(raw, JSON.stringify(after, null, 2) + '\n', 'file is pretty JSON plus trailing newline');

  // Idempotent: a second pass rewrites nothing and leaves the bytes alone.
  assert.deepEqual(healTarballIntegrity('web'), []);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), raw);

  // The atomic rename must not leave .heal- temp files behind.
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.heal-'));
  assert.deepEqual(leftovers, [], 'no temp files may remain after the heal');
});

test('healTarballIntegrity reports [] without rewriting when there is nothing to heal', async (t) => {
  const { healTarballIntegrity } = await loadHost();
  const home = withDshHome(t);
  const manifest = {
    name: 'dsh-profile-web',
    dependencies: { 'plugin-a': 'github:one/alpha#v1.2.3', 'plugin-b': '^2.0.0' },
  };
  // Keep a BOM on purpose: with nothing to heal the file must not be touched.
  const text = '\uFEFF' + JSON.stringify(manifest, null, 2) + '\n';
  const dir = writeProfile(home, 'web', text);

  assert.deepEqual(healTarballIntegrity('web'), []);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), text, 'file must stay byte-identical');
});

test('healTarballIntegrity tolerates missing or malformed manifests', async (t) => {
  const { healTarballIntegrity } = await loadHost();
  const home = withDshHome(t);

  // No profile manifest at all.
  assert.deepEqual(healTarballIntegrity('web'), []);

  // Manifest without a dependencies field.
  const dir1 = writeProfile(home, 'web', JSON.stringify({ name: 'x' }) + '\n');
  assert.deepEqual(healTarballIntegrity('web'), []);

  // dependencies present but not an object.
  writeProfile(home, 'web2', JSON.stringify({ name: 'x', dependencies: 'github:one/alpha#v1.0.0' }) + '\n');
  assert.deepEqual(healTarballIntegrity('web2'), []);

  // Corrupt JSON (unparseable) — must not throw, must not write.
  const dir3 = writeProfile(home, 'web3', '\uFEFF{not json\n');
  assert.deepEqual(healTarballIntegrity('web3'), []);
  assert.equal(fs.readFileSync(path.join(dir3, 'package.json'), 'utf8'), '\uFEFF{not json\n');

  // A dependency whose spec is a non-string value must not crash the scan.
  const dir4 = writeProfile(home, 'web4', JSON.stringify({ name: 'x', dependencies: { 'plugin-a': null, 'plugin-b': ARCHIVE } }) + '\n');
  const rewritten = healTarballIntegrity('web4');
  assert.deepEqual([...rewritten].sort(), ['plugin-b']);
  const after = JSON.parse(fs.readFileSync(path.join(dir4, 'package.json'), 'utf8'));
  assert.equal(after.dependencies['plugin-a'], null);
  assert.equal(after.dependencies['plugin-b'], 'github:owner/repo#v1.2.3');
});

// The exported surface must expose the heal hooks the ops path relies on, so a
// future refactor cannot silently drop the wiring between the close handler
// and the heal without the digest-pinned bundle test catching it too.
test('host exports the tarball-integrity helpers', async () => {
  const host = await loadHost();
  assert.equal(typeof host.githubArchiveToSpec, 'function');
  assert.equal(typeof host.healTarballIntegrity, 'function');
  assert.equal(typeof host.isTarballIntegrityFailure, 'function');
  assert.equal(host.name, 'dsh-market-plugin');
});
