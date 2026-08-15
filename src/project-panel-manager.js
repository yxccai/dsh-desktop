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

  async gitStatus(rootValue) {
    const root = this.resolveRoot(rootValue);
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
    return { root, branch, changes };
  }

  async gitDiff(rootValue, relative, staged = false) {
    const { root, target, relative: clean } = this.resolvePath(rootValue, relative);
    const status = await this.gitStatus(root);
    const change = status.changes.find((item) => item.path === clean);
    if (change?.untracked) {
      const content = fs.statSync(target).size <= MAX_TEXT ? fs.readFileSync(target, 'utf8') : '[binary or oversized untracked file]';
      return { path: clean, staged: false, content: `diff --git a/${clean} b/${clean}\nnew file mode 100644\n--- /dev/null\n+++ b/${clean}\n@@ -0,0 +1,${content.split(/\r?\n/).length} @@\n${content.split(/\r?\n/).map((line) => `+${line}`).join('\n')}` };
    }
    const useStaged = staged || (change && change.index !== ' ' && change.index !== '?' && change.worktree === ' ');
    const args = ['diff','--no-ext-diff','--no-color'];
    if (useStaged) args.push('--cached');
    args.push('--', clean);
    const { stdout } = await this.git(root, args, { maxBuffer: 8 * 1024 * 1024 });
    return { path: clean, staged: useStaged, content: stdout };
  }

  async discard(rootValue, relative) {
    const { root, target, relative: clean } = this.resolvePath(rootValue, relative);
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

  async snapshot(rootValue, label, turn) {
    const root = this.resolveRoot(rootValue);
    const queue = this.queues.get(root) || Promise.resolve();
    const task = queue.then(async () => {
      await this.git(root, ['rev-parse','--is-inside-work-tree']);
      const tempIndex = path.join(this.stateRoot, 'indexes', `${this.projectKey(root)}-${process.pid}-${Date.now()}.index`);
      fs.mkdirSync(path.dirname(tempIndex), { recursive: true });
      const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
      try {
        try { await this.git(root, ['read-tree','HEAD'], { env }); } catch { await this.git(root, ['read-tree','--empty'], { env }); }
        await this.git(root, ['add','-A'], { env });
        const tree = (await this.git(root, ['write-tree'], { env })).stdout.trim();
        const history = this.history(root);
        if (history[0]?.tree === tree) return history;
        const id = crypto.randomUUID();
        await this.git(root, ['update-ref', `refs/dsh-desktop/snapshots/${id}`, tree]);
        history.unshift({ id, tree, label: String(label || '修改快照').slice(0,120), turn: Number.isInteger(turn) ? turn : null, createdAt: new Date().toISOString() });
        const trimmed = history.slice(0,50);
        for (const removed of history.slice(50)) {
          try { await this.git(root, ['update-ref','-d',`refs/dsh-desktop/snapshots/${removed.id}`]); } catch {}
        }
        atomicJson(this.historyFile(root), trimmed);
        return trimmed;
      } finally { fs.rmSync(tempIndex, { force: true }); }
    });
    this.queues.set(root, task.catch(() => {}));
    return task;
  }

  async revertSnapshot(rootValue, snapshotId) {
    const root = this.resolveRoot(rootValue);
    const history = this.history(root);
    const target = history.find((item) => item.id === snapshotId);
    if (!target) throw new Error('找不到修改快照');
    const before = await this.snapshot(root, '撤销前自动备份', null);
    const currentTree = before[0]?.tree;
    if (!currentTree) throw new Error('无法创建撤销前快照');
    const patch = (await this.git(root, ['diff','--binary',currentTree,target.tree], { maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' })).stdout;
    if (!patch?.length) return this.history(root);
    const patchFile = path.join(this.stateRoot, 'patches', `${crypto.randomUUID()}.patch`);
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    fs.writeFileSync(patchFile, patch);
    try { await this.git(root, ['apply','--binary',patchFile], { maxBuffer: 32 * 1024 * 1024 }); }
    finally { fs.rmSync(patchFile, { force: true }); }
    return this.snapshot(root, `已撤销到：${target.label}`, target.turn);
  }
}

module.exports = { ProjectPanelManager, isInside };
