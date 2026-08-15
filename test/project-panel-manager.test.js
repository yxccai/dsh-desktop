'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ProjectPanelManager } = require('../src/project-panel-manager');

function fixture(t, git = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-project-panel-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Hello\n');
  fs.writeFileSync(path.join(workspace, 'src', 'app.js'), 'console.log("one")\n');
  if (git) {
    execFileSync('git', ['init'], { cwd: workspace });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace });
    execFileSync('git', ['add', '.'], { cwd: workspace });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace });
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, workspace, manager: new ProjectPanelManager({ stateRoot: path.join(root, 'state') }) };
}

test('lists, searches, reads, and atomically saves workspace files', async (t) => {
  const { workspace, manager } = fixture(t);
  const listing = manager.list(workspace, '');
  assert.deepEqual(listing.items.map((x) => x.name), ['src', 'README.md']);
  assert.equal(manager.search(workspace, 'app')[0].path, 'src/app.js');
  const file = manager.read(workspace, 'README.md');
  assert.equal(file.kind, 'markdown');
  const saved = manager.save(workspace, 'README.md', '# Updated\n', file.modifiedAt);
  assert.equal(saved.path, 'README.md');
  assert.equal(fs.readFileSync(path.join(workspace, 'README.md'), 'utf8'), '# Updated\n');
});

test('rejects traversal and stale saves', (t) => {
  const { workspace, manager } = fixture(t);
  assert.throws(() => manager.read(workspace, '../outside.txt'), /超出工作区/);
  const file = manager.read(workspace, 'README.md');
  fs.writeFileSync(path.join(workspace, 'README.md'), 'external\n');
  assert.throws(() => manager.save(workspace, 'README.md', 'overwrite', file.modifiedAt), /外部修改/);
});

test('persists panel state per project with clamped width', (t) => {
  const { workspace, manager } = fixture(t);
  assert.equal(manager.getState(workspace).width, 520);
  manager.setState(workspace, { width: 5000, collapsed: true, activeTab: 'changes' });
  assert.deepEqual(manager.getState(workspace), { width: 1000, collapsed: true, activeTab: 'changes' });
});

test('reports real git changes, diffs, discard, and snapshots', async (t) => {
  const { workspace, manager } = fixture(t, true);
  const initial = await manager.snapshot(workspace, '开始前', 0);
  fs.writeFileSync(path.join(workspace, 'src', 'app.js'), 'console.log("two")\n');
  fs.writeFileSync(path.join(workspace, 'new.txt'), 'new\n');
  const status = await manager.gitStatus(workspace);
  assert.equal(status.changes.length, 2);
  const diff = await manager.gitDiff(workspace, 'src/app.js');
  assert.match(diff.content, /console\.log\("two"\)/);
  const history = await manager.snapshot(workspace, '回复 1', 1);
  assert.equal(history[0].turn, 1);
  await manager.revertSnapshot(workspace, initial[0].id);
  assert.equal(fs.readFileSync(path.join(workspace, 'src', 'app.js'), 'utf8').replaceAll('\r\n', '\n'), 'console.log("one")\n');
  assert.equal(fs.existsSync(path.join(workspace, 'new.txt')), false);
  fs.writeFileSync(path.join(workspace, 'src', 'app.js'), 'console.log("two")\n');
  await manager.discard(workspace, 'src/app.js');
  assert.equal(fs.readFileSync(path.join(workspace, 'src', 'app.js'), 'utf8').replaceAll('\r\n', '\n'), 'console.log("one")\n');
});
