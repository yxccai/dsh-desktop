'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_TEXT = 4 * 1024 * 1024;
const MAX_BINARY = 20 * 1024 * 1024;
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.dsh-desktop']);
const TEXT_EXT = new Set(['.txt','.md','.markdown','.js','.jsx','.ts','.tsx','.json','.jsonc','.css','.scss','.less','.html','.htm','.xml','.yml','.yaml','.toml','.ini','.env','.sh','.bash','.ps1','.py','.rb','.go','.rs','.java','.c','.h','.cpp','.hpp','.cs','.php','.sql','.diff','.patch','.csv','.tsv','.log']);
const IMAGE_EXT = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp','.ico']);
const OFFICE_EXT = new Set(['.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp']);

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

class ProjectPanelManager {
  constructor(options) {
    this.stateRoot = path.resolve(options.stateRoot);
    this.dshHome = options.dshHome ? path.resolve(options.dshHome) : null;
    this.gitPath = options.gitPath || 'git';
    this.queues = new Map();
  }

  allowedRoots() {
    if (!this.dshHome) return null;
    const registry = path.join(this.dshHome, 'storages', 'workspace.json');
    try {
      const data = JSON.parse(fs.readFileSync(registry, 'utf8'));
      const rows = Object.values(data?.tables?.workspaces || {});
      return new Set(rows.flatMap((row) => {
        try { return typeof row?.path === 'string' ? [fs.realpathSync.native(path.resolve(row.path)).toLowerCase()] : []; }
        catch { return []; }
      }));
    } catch { return new Set(); }
  }

  resolveRoot(value) {
    if (typeof value !== 'string' || value.length < 2 || value.length > 2048 || value.includes('\0')) throw new Error('工作区路径无效');
    const root = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(root).isDirectory()) throw new Error('工作区不是目录');
    const allowed = this.allowedRoots();
    if (allowed && !allowed.has(root.toLowerCase())) throw new Error('工作区未在 DSH 中注册');
    return root;
  }

  resolvePath(rootValue, relativeValue = '') {
    const root = this.resolveRoot(rootValue);
    if (typeof relativeValue !== 'string' || relativeValue.length > 4096 || relativeValue.includes('\0') || path.isAbsolute(relativeValue)) throw new Error('相对路径无效');
    const target = path.resolve(root, relativeValue || '.');
    if (!isInside(root, target)) throw new Error('路径超出工作区');
    if (fs.existsSync(target)) {
      const real = fs.realpathSync.native(target);
      if (!isInside(root, real)) throw new Error('符号链接超出工作区');
      return { root, target: real, relative: path.relative(root, real).replaceAll('\\', '/') };
    }
    const parent = fs.realpathSync.native(path.dirname(target));
    if (!isInside(root, parent)) throw new Error('目标父目录超出工作区');
    return { root, target, relative: path.relative(root, target).replaceAll('\\', '/') };
  }

  projectKey(root) {
    return crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 24);
  }

  stateFile(root) { return path.join(this.stateRoot, 'projects', `${this.projectKey(root)}.json`); }
  historyFile(root) { return path.join(this.stateRoot, 'history', `${this.projectKey(root)}.json`); }
  blobFile(hash) { return path.join(this.stateRoot, 'blobs', hash.slice(0, 2), hash); }
  hasExactRepo(rootValue) {
    const root = this.resolveRoot(rootValue);
    let cursor = root;
    while (true) {
      if (fs.existsSync(path.join(cursor, '.git'))) {
        if (cursor.toLowerCase() !== root.toLowerCase()) throw new Error('Git 仓库根必须与 DSH 工作区根一致');
        return true;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) return false;
      cursor = parent;
    }
  }
  captureFiles(root) {
    const files = {};
    const walk = (directory, depth = 0) => {
      if (depth > 30) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (IGNORE_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) { walk(target, depth + 1); continue; }
        if (!entry.isFile()) continue;
        const stat = fs.statSync(target);
        if (stat.size > MAX_BINARY) continue;
        const data = fs.readFileSync(target);
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        const blob = this.blobFile(hash);
        if (!fs.existsSync(blob)) { fs.mkdirSync(path.dirname(blob), { recursive: true }); fs.writeFileSync(blob, data); }
        files[path.relative(root, target).replaceAll('\\', '/')] = { hash, size: stat.size, mode: stat.mode };
      }
    };
    walk(root);
    return files;
  }

  getState(rootValue) {
    const root = this.resolveRoot(rootValue);
    try { return { width: 520, collapsed: false, activeTab: 'files', ...JSON.parse(fs.readFileSync(this.stateFile(root), 'utf8')) }; }
    catch { return { width: 520, collapsed: false, activeTab: 'files' }; }
  }

  setState(rootValue, input) {
    const root = this.resolveRoot(rootValue);
    const old = this.getState(root);
    const next = {
      width: Number.isFinite(input?.width) ? Math.max(320, Math.min(1000, Math.round(input.width))) : old.width,
      collapsed: typeof input?.collapsed === 'boolean' ? input.collapsed : old.collapsed,
      activeTab: ['files','changes'].includes(input?.activeTab) ? input.activeTab : old.activeTab,
    };
    atomicJson(this.stateFile(root), next);
    return next;
  }

  list(rootValue, relative = '') {
    const { root, target, relative: clean } = this.resolvePath(rootValue, relative);
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error('目标不是目录');
    const items = fs.readdirSync(target, { withFileTypes: true }).filter((entry) => entry.name !== '.git').map((entry) => {
      const child = path.join(target, entry.name);
      const childStat = fs.lstatSync(child);
      const rel = path.relative(root, child).replaceAll('\\', '/');
      return { name: entry.name, path: rel, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'link', size: entry.isFile() ? childStat.size : null, modifiedAt: childStat.mtimeMs };
    }).sort((a,b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
    return { path: clean, items };
  }

  search(rootValue, query) {
    const root = this.resolveRoot(rootValue);
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const results = [];
    let visited = 0;
    const walk = (directory, depth) => {
      if (depth > 12 || results.length >= 200 || visited > 10000) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        visited++;
        if (IGNORE_DIRS.has(entry.name)) continue;
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        const rel = path.relative(root, target).replaceAll('\\', '/');
        if (entry.name.toLowerCase().includes(needle)) results.push({ name: entry.name, path: rel, kind: entry.isDirectory() ? 'directory' : 'file' });
        if (entry.isDirectory()) walk(target, depth + 1);
        if (results.length >= 200) break;
      }
    };
    walk(root, 0);
    return results;
  }

  read(rootValue, relative) {
    const { target, relative: clean } = this.resolvePath(rootValue, relative);
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('目标不是文件');
    const ext = path.extname(target).toLowerCase();
    const kind = IMAGE_EXT.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : OFFICE_EXT.has(ext) ? 'office' : ext === '.md' || ext === '.markdown' ? 'markdown' : ext === '.html' || ext === '.htm' ? 'html' : ext === '.csv' || ext === '.tsv' ? 'csv' : ext === '.diff' || ext === '.patch' ? 'diff' : TEXT_EXT.has(ext) || stat.size < 256 * 1024 ? 'text' : 'binary';
    if (kind === 'image' || kind === 'pdf') {
      if (stat.size > MAX_BINARY) throw new Error('文件过大，无法内置预览');
      const mime = kind === 'pdf' ? 'application/pdf' : ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.bmp':'image/bmp','.ico':'image/x-icon'})[ext] || 'application/octet-stream';
      return { path: clean, name: path.basename(target), kind, size: stat.size, modifiedAt: stat.mtimeMs, mime, data: fs.readFileSync(target).toString('base64'), editable: false };
    }
    if (kind === 'office' || kind === 'binary') return { path: clean, name: path.basename(target), kind, size: stat.size, modifiedAt: stat.mtimeMs, editable: false };
    if (stat.size > MAX_TEXT) throw new Error('文本文件过大，无法内置编辑');
    return { path: clean, name: path.basename(target), kind, size: stat.size, modifiedAt: stat.mtimeMs, content: fs.readFileSync(target, 'utf8'), editable: true };
  }

  save(rootValue, relative, content, expectedModifiedAt) {
    const { target, relative: clean } = this.resolvePath(rootValue, relative);
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_TEXT) throw new Error('保存内容过大');
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('目标不是文件');
    if (Number.isFinite(expectedModifiedAt) && Math.abs(stat.mtimeMs - expectedModifiedAt) > 1) throw new Error('文件已在外部修改，请重新加载');
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.dsh-save-${process.pid}-${Date.now()}`);
    fs.writeFileSync(temp, content, { encoding: 'utf8', mode: stat.mode });
    fs.renameSync(temp, target);
    const next = fs.statSync(target);
    return { path: clean, modifiedAt: next.mtimeMs, size: next.size };
  }

  async git(root, args, options = {}) {
    try {
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_PAGER: 'cat', GIT_EDITOR: 'true', ...(options.env || {}) };
      return await execFileAsync(this.gitPath, ['-C', root, ...args], { encoding: options.encoding || 'utf8', maxBuffer: options.maxBuffer || 16 * 1024 * 1024, windowsHide: true, timeout: 15000, killSignal: 'SIGKILL', env });
    } catch (error) {
      const message = String(error.stderr || error.message || 'Git 操作失败').trim();
      throw new Error(message.slice(0, 2000));
    }
  }

  async requireRepoRoot(rootValue) {
    const root = this.resolveRoot(rootValue);
    const top = (await this.git(root, ['rev-parse','--show-toplevel'])).stdout.trim();
    const repo = fs.realpathSync.native(path.resolve(top));
    if (repo.toLowerCase() !== root.toLowerCase()) throw new Error('Git 仓库根必须与 DSH 工作区根一致');
    return root;
  }

  async gitStatus(rootValue) {
    const root = this.resolveRoot(rootValue);
    if (!this.hasExactRepo(root)) return { root, branch: '', changes: [], available: false };
    await this.requireRepoRoot(root);
    let branch = '';
    try { branch = (await this.git(root, ['branch','--show-current'])).stdout.trim(); } catch {}
    const { stdout } = await this.git(root, ['status','--porcelain=v1','-z','--untracked-files=all']);
    const records = stdout.split('\0').filter(Boolean);
    const changes = [];
    for (let i=0;i<records.length;i++) {
      const record = records[i];
      const xy = record.slice(0,2); let file = record.slice(3); let original = null;
      if (xy.includes('R') || xy.includes('C')) original = records[++i] || null;
      changes.push({ path: file.replaceAll('\\','/'), originalPath: original?.replaceAll('\\','/') || null, index: xy[0], worktree: xy[1], untracked: xy === '??' });
    }
    return { root, branch, changes, available: true };
  }

  async gitDiff(rootValue, relative, staged = false) {
    const { root, target, relative: clean } = this.resolvePath(rootValue, relative);
    await this.requireRepoRoot(root);
    const status = await this.gitStatus(root);
    const change = status.changes.find((item) => item.path === clean);
    if (change?.untracked) {
      const content = fs.statSync(target).size <= MAX_TEXT ? fs.readFileSync(target, 'utf8') : '[binary or oversized untracked file]';
      return { path: clean, staged: false, content: `diff --git a/${clean} b/${clean}\nnew file mode 100644\n--- /dev/null\n+++ b/${clean}\n@@ -0,0 +1,${content.split(/\r?\n/).length} @@\n${content.split(/\r?\n/).map((line) => `+${line}`).join('\n')}` };
    }
    const useStaged = staged || (change && change.index !== ' ' && change.index !== '?' && change.worktree === ' ');
    const args = ['diff','--no-ext-diff','--no-color','--unified=999999'];
    if (useStaged) args.push('--cached');
    args.push('--', clean);
    const { stdout } = await this.git(root, args, { maxBuffer: 8 * 1024 * 1024 });
    return { path: clean, staged: useStaged, content: stdout };
  }

  async committedFileDiff(rootValue, relative) {
    const { root, relative: clean } = this.resolvePath(rootValue, relative);
    await this.requireRepoRoot(root);
    const { stdout } = await this.git(root, ['log','-1','-p','--no-ext-diff','--no-color','--format=','--unified=999999','--',clean], { maxBuffer: 16 * 1024 * 1024 });
    return { path: clean, staged: false, content: stdout };
  }

  async discard(rootValue, relative) {
    const { root, target, relative: clean } = this.resolvePath(rootValue, relative);
    await this.requireRepoRoot(root);
    const status = await this.gitStatus(root);
    const change = status.changes.find((item) => item.path === clean);
    if (!change) throw new Error('没有可撤销的变更');
    if (change.untracked) fs.rmSync(target, { recursive: true, force: false });
    else {
      if (change.index !== ' ' && change.index !== '?') await this.git(root, ['restore','--staged','--',clean]);
      await this.git(root, ['restore','--worktree','--',clean]);
    }
    return this.gitStatus(root);
  }

  history(rootValue) {
    const root = this.resolveRoot(rootValue);
    try { return JSON.parse(fs.readFileSync(this.historyFile(root), 'utf8')); }
    catch { return []; }
  }

  enqueue(root, operation) {
    const queue = this.queues.get(root) || Promise.resolve();
    const task = queue.then(operation);
    this.queues.set(root, task.catch(() => {}));
    return task;
  }

  async createSnapshot(root, label, turn) {
    await this.requireRepoRoot(root);
    const tempIndex = path.join(this.stateRoot, 'indexes', `${this.projectKey(root)}-${process.pid}-${Date.now()}-${crypto.randomUUID()}.index`);
    fs.mkdirSync(path.dirname(tempIndex), { recursive: true });
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    try {
      try { await this.git(root, ['read-tree','HEAD'], { env }); } catch { await this.git(root, ['read-tree','--empty'], { env }); }
      await this.git(root, ['add','-A'], { env });
      const tree = (await this.git(root, ['write-tree'], { env })).stdout.trim();
      const history = this.history(root);
      const id = crypto.randomUUID();
      await this.git(root, ['update-ref', `refs/dsh-desktop/snapshots/${id}`, tree]);
      const baseTree = history.find((item) => item.tree !== tree)?.tree || history[0]?.tree || null;
      history.unshift({ id, tree, baseTree, label: String(label || '修改快照').slice(0,120), turn: Number.isInteger(turn) ? turn : null, createdAt: new Date().toISOString() });
      const trimmed = history.slice(0,50);
      for (const removed of history.slice(50)) {
        try { await this.git(root, ['update-ref','-d',`refs/dsh-desktop/snapshots/${removed.id}`]); } catch {}
      }
      atomicJson(this.historyFile(root), trimmed);
      return trimmed;
    } finally { fs.rmSync(tempIndex, { force: true }); }
  }

  async createFileSnapshot(root, label, turn) {
    const files = this.captureFiles(root);
    const manifestHash = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
    const history = this.history(root);
    const id = crypto.randomUUID();
    history.unshift({ id, kind: 'files', files, manifestHash, baseId: history[0]?.id || null, label: String(label || '修改快照').slice(0,120), turn: Number.isInteger(turn) ? turn : null, createdAt: new Date().toISOString() });
    const trimmed = history.slice(0, 50);
    atomicJson(this.historyFile(root), trimmed);
    return trimmed;
  }

  async snapshot(rootValue, label, turn) {
    const root = this.resolveRoot(rootValue);
    return this.enqueue(root, () => this.hasExactRepo(root) ? this.createSnapshot(root, label, turn) : this.createFileSnapshot(root, label, turn));
  }

  async snapshotDiff(rootValue, snapshotId, relative) {
    const root = this.resolveRoot(rootValue);
    const history = this.history(root);
    const index = history.findIndex((item) => item.id === snapshotId);
    if (index < 0) throw new Error('找不到修改快照');
    const current = history[index];
    if (current.kind === 'files') {
      const previous = history.find((item) => item.id === current.baseId) || history.slice(index + 1).find((item) => item.kind === 'files' && item.manifestHash !== current.manifestHash);
      const clean = this.resolvePath(root, relative).relative;
      const before = previous?.files?.[clean]; const after = current.files?.[clean];
      if (!before && !after) return { path: clean, staged: false, content: '' };
      const oldText = before ? fs.readFileSync(this.blobFile(before.hash), 'utf8') : '';
      const newText = after ? fs.readFileSync(this.blobFile(after.hash), 'utf8') : '';
      const tempRoot = path.join(this.stateRoot, 'diff-temp', crypto.randomUUID()); fs.mkdirSync(tempRoot, { recursive: true });
      const oldFile = path.join(tempRoot, 'before'); const newFile = path.join(tempRoot, 'after'); fs.writeFileSync(oldFile, oldText); fs.writeFileSync(newFile, newText);
      try { const { stdout } = await execFileAsync(this.gitPath, ['diff','--no-index','--no-color','--unified=999999','--',oldFile,newFile], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 15000 }); return { path: clean, staged: false, content: stdout }; }
      catch (error) { if (error.code === 1 && typeof error.stdout === 'string') return { path: clean, staged: false, content: error.stdout }; throw error; }
      finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
    }
    await this.requireRepoRoot(root);
    const previousTree = current.baseTree || history.slice(index + 1).find((item) => item.tree !== current.tree)?.tree;
    if (!previousTree) return { path: relative || '', staged: false, content: '' };
    if (!/^[0-9a-f]{40,64}$/.test(String(current.tree)) || !/^[0-9a-f]{40,64}$/.test(String(previousTree))) throw new Error('修改快照无效');
    const args = ['diff','--binary','--no-color','--unified=999999',previousTree,current.tree];
    if (relative) { const { relative: clean } = this.resolvePath(root, relative); args.push('--',clean); }
    const { stdout } = await this.git(root, args, { maxBuffer: 16 * 1024 * 1024 });
    return { path: relative || '', staged: false, content: stdout };
  }

  async revertSnapshotFile(rootValue, snapshotId, relative) {
    const root = this.resolveRoot(rootValue);
    const history = this.history(root);
    const index = history.findIndex((item) => item.id === snapshotId);
    if (index < 0) throw new Error('找不到修改前快照');
    const current = history[index];
    const { target, relative: clean } = this.resolvePath(root, relative);
    if (current.kind === 'files') {
      const previous = history.find((item) => item.id === current.baseId) || history.slice(index + 1).find((item) => item.kind === 'files' && item.manifestHash !== current.manifestHash);
      const entry = previous?.files?.[clean];
      if (!entry) fs.rmSync(target, { recursive: true, force: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, fs.readFileSync(this.blobFile(entry.hash))); }
      return this.gitStatus(root);
    }
    await this.requireRepoRoot(root);
    const previousTree = current.baseTree || history.slice(index + 1).find((item) => item.tree !== current.tree)?.tree;
    if (!/^[0-9a-f]{40,64}$/.test(String(previousTree))) throw new Error('修改前快照无效');
    try {
      const { stdout } = await this.git(root, ['show', `${previousTree}:${clean}`], { maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.dsh-${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temp, stdout);
      fs.renameSync(temp, target);
    } catch (error) {
      try { await this.git(root, ['cat-file','-e',`${current.tree}:${clean}`]); fs.rmSync(target, { recursive: true, force: true }); }
      catch { throw error; }
    }
    return this.gitStatus(root);
  }

  async restoreFileManifest(root, target) {
    const current = this.captureFiles(root);
    for (const relative of Object.keys(current)) if (!target.files?.[relative]) fs.rmSync(this.resolvePath(root, relative).target, { force: true });
    for (const [relative, entry] of Object.entries(target.files || {})) { const resolved = this.resolvePath(root, relative).target; fs.mkdirSync(path.dirname(resolved), { recursive: true }); fs.writeFileSync(resolved, fs.readFileSync(this.blobFile(entry.hash))); }
    return this.createFileSnapshot(root, `已恢复到：${target.label}`, target.turn);
  }

  async revertSnapshot(rootValue, snapshotId) {
    const root = this.resolveRoot(rootValue);
    return this.enqueue(root, async () => {
      const history = this.history(root);
      const target = history.find((item) => item.id === snapshotId);
      if (target?.kind === 'files') { await this.createFileSnapshot(root, '撤销前自动备份', null); return this.restoreFileManifest(root, target); }
      await this.requireRepoRoot(root);
      if (!target || !/^[0-9a-f]{40,64}$/.test(String(target.tree))) throw new Error('找不到有效的修改快照');
      await this.git(root, ['cat-file','-e',`${target.tree}^{tree}`]);
      const before = await this.createSnapshot(root, '撤销前自动备份', null);
      const currentTree = before[0]?.tree;
      if (!currentTree) throw new Error('无法创建撤销前快照');
      const patch = (await this.git(root, ['diff','--binary',currentTree,target.tree], { maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' })).stdout;
      if (!patch?.length) return this.history(root);
      const patchFile = path.join(this.stateRoot, 'patches', `${crypto.randomUUID()}.patch`);
      fs.mkdirSync(path.dirname(patchFile), { recursive: true });
      fs.writeFileSync(patchFile, patch);
      try {
        await this.git(root, ['apply','--check','--binary',patchFile], { maxBuffer: 32 * 1024 * 1024 });
        await this.git(root, ['apply','--binary',patchFile], { maxBuffer: 32 * 1024 * 1024 });
      } finally { fs.rmSync(patchFile, { force: true }); }
      return this.createSnapshot(root, `已撤销到：${target.label}`, target.turn);
    });
  }
}

module.exports = { ProjectPanelManager, isInside };
