'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { upsertManagedBlock, stripManagedBlock } = require('./dsh-integration');

/**
 * Optional managed Web Profile plugin: the built-in community plugin market.
 *
 * The desktop shell vendors a FIXED upstream copy of
 * `@sanqi-normal/dsh-webui-market-plugin` under `resources/market-plugin`
 * (see VENDORED.md there). This manager mounts that bundle into the SHARED
 * DSH_HOME the way the shipped settings bridge is mounted:
 *
 *   1. transactionally copy the vendored package into
 *      `$DSH_HOME/node_modules/@sanqi-normal/dsh-webui-market-plugin`
 *      (with an ownership marker and a content digest), and
 *   2. add/remove a managed block in the HOME-LEVEL `$DSH_HOME/cordis.patch.yml`
 *      that inserts the `dsh-market-plugin` row (or marks it disabled).
 *
 * The shared `$DSH_HOME/profiles/web` directory is NEVER modified — the home
 * patch layer applies over every profile, so the market appears in the web
 * profile without touching profile-owned files. Install/uninstall/enable/
 * disable are exclusive and transactional: a failed step rolls back what the
 * step itself already changed, and a conflict (foreign package, damaged
 * patch) refuses to touch anything.
 */

const PACKAGE_NAME = '@sanqi-normal/dsh-webui-market-plugin';
const PACKAGE_SCOPE = '@sanqi-normal';
const PATCH_ID = 'dsh-market-plugin';
const START = '# >>> DSH Desktop Web Market >>>';
const END = '# <<< DSH Desktop Web Market <<<';
const MARKER_FILE = '.dsh-desktop-market.json';
const REQUIRED_FILES = [
  'package.json',
  path.join('lib', 'host.js'),
  path.join('lib', 'client.js'),
  path.join('data', 'catalog-snapshot.json'),
  'cordis.patch.yml',
];
/** Fixed digest of the vendored `resources/market-plugin` tree. */
const VENDORED_DIGEST = '2ea80b1c9dfc5c28a45c3108a95a0444da9ba1ecb0b22536b16dd2516cea182c';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function isDirectory(target) {
  try { return fs.statSync(target).isDirectory(); }
  catch { return false; }
}

function safeChildren(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
}

function digestDirectory(root) {
  const files = [];
  const walk = (directory, depth = 0) => {
    if (depth > 8) throw new Error('市场包目录层级过深');
    for (const entry of safeChildren(directory).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('市场包包含不支持的文件类型');
      if (entry.isDirectory()) walk(target, depth + 1);
      else {
        if (entry.name === MARKER_FILE) continue;
        if (stat.size > 1024 * 1024) throw new Error('市场文件过大');
        files.push({ relative: path.relative(root, target).replaceAll('\\', '/'), target, size: stat.size });
        if (files.length > 100) throw new Error('市场文件数量过多');
      }
    }
  };
  walk(root);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 5 * 1024 * 1024) throw new Error('市场包总大小过大');
  const listing = files.map((file) => `${file.relative}:${crypto.createHash('sha256').update(fs.readFileSync(file.target)).digest('hex')}`).join('\n');
  return crypto.createHash('sha256').update(listing).digest('hex');
}

function renderBlock(enabled) {
  if (enabled) {
    return `${START}\n- insert:\n    - id: ${PATCH_ID}\n      name: '${PACKAGE_NAME}'\n${END}`;
  }
  return `${START}\n- id: ${PATCH_ID}\n  name: '${PACKAGE_NAME}'\n  disabled: true\n${END}`;
}

class WebMarketManager {
  constructor(options) {
    this.dshHome = path.resolve(options.dshHome);
    this.bundleRoot = path.resolve(options.bundleRoot);
    this.patchPath = path.join(this.dshHome, 'cordis.patch.yml');
    this.packageDir = path.join(this.dshHome, 'node_modules', PACKAGE_SCOPE, 'dsh-webui-market-plugin');
    this.queue = Promise.resolve();
  }

  runExclusive(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  inspectPackage() {
    const dir = this.packageDir;
    if (!isDirectory(dir)) return null;
    const marker = readJson(path.join(dir, MARKER_FILE), null);
    const manifest = readJson(path.join(dir, 'package.json'), null);
    const owned = Boolean(marker && marker.owner === 'dsh-desktop' && marker.package === PACKAGE_NAME);
    return {
      dir,
      owned,
      version: owned ? (marker.version || manifest?.version || null) : (manifest?.version || null),
      installedDigest: marker?.digest || null,
      installedAt: marker?.installedAt || null,
      valid: manifest?.name === PACKAGE_NAME && fs.existsSync(path.join(dir, 'lib', 'host.js')) && fs.existsSync(path.join(dir, 'lib', 'client.js')),
    };
  }

  inspectPatch() {
    let text;
    try { text = fs.readFileSync(this.patchPath, 'utf8'); } catch { return { present: false }; }
    const start = text.indexOf(START);
    const end = text.indexOf(END);
    if (start < 0 || end <= start) return { present: false };
    const block = text.slice(start, end + END.length);
    const hasId = block.includes(`id: ${PATCH_ID}`);
    const enabled = hasId && !/disabled:\s*true/.test(block);
    const nameOk = block.includes(PACKAGE_NAME);
    return { present: true, enabled, hasId, nameOk };
  }

  state() {
    const pkg = this.inspectPackage();
    const patch = this.inspectPatch();
    if (!pkg) {
      if (patch.present) return { status: 'conflict', detail: '补丁中存在市场行，但 $DSH_HOME/node_modules 中没有对应的包' };
      return { status: 'available', detail: null };
    }
    if (!pkg.owned) return { status: 'conflict', detail: 'node_modules 中存在同名包，但不是由 DSH Desktop 管理，拒绝修改' };
    if (!pkg.valid) return { status: 'conflict', detail: '已安装的市场包不完整或身份异常' };
    if (patch.present && !patch.nameOk) return { status: 'conflict', detail: '市场补丁内容异常（缺少包名）' };
    if (patch.present && patch.enabled) return { status: 'enabled', detail: null };
    return { status: 'disabled', detail: '包已保留，补丁行已停用（当前未挂载到 web profile）' };
  }

  list() {
    const st = this.state();
    const pkg = this.inspectPackage();
    const manifest = readJson(path.join(this.bundleRoot, 'package.json'), null);
    const entry = {
      id: 'web-market',
      patchId: PATCH_ID,
      packageName: PACKAGE_NAME,
      name: '社区插件市场（Web）',
      description: '在 DSH Web 界面（设置 → 插件 → 插件市场）浏览 awesome-dsh-plugin.com 社区目录，并把插件安装到共享的 web profile；内置离线目录快照兜底。',
      author: 'Sanqi-normal（内置 MIT 副本）',
      source: 'Bundled · MIT',
      version: manifest?.version || null,
      status: st.status,
      detail: st.detail,
      owned: st.status === 'enabled' || st.status === 'disabled',
      thirdParty: true,
      restartRequired: true,
      profile: 'web（共享 DSH_HOME，不修改 profiles/web）',
      patchPath: this.patchPath,
      packageDir: this.packageDir,
      installedAt: pkg?.installedAt || null,
    };
    return { entry };
  }

  writePatch(next) {
    fs.mkdirSync(this.dshHome, { recursive: true });
    const temp = `${this.patchPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.patchPath);
  }

  install() {
    return this.runExclusive(async () => {
      const st = this.state();
      if (st.status === 'enabled' || st.status === 'disabled') throw new Error('Web 市场已安装');
      if (st.status === 'conflict') throw new Error('检测到冲突，拒绝安装');
      const source = this.bundleRoot;
      if (!isDirectory(source)) throw new Error('内置市场包缺失');
      const manifest = readJson(path.join(source, 'package.json'), null);
      if (manifest?.name !== PACKAGE_NAME || typeof manifest.version !== 'string') throw new Error('内置市场包身份无效');
      for (const name of REQUIRED_FILES) {
        if (!fs.existsSync(path.join(source, name))) throw new Error(`内置市场包不完整：缺少 ${name}`);
      }
      const digest = digestDirectory(source);
      if (digest !== VENDORED_DIGEST) throw new Error('内置市场包校验失败（与固定版本不一致）');
      fs.mkdirSync(path.dirname(this.packageDir), { recursive: true });
      const temp = `${this.packageDir}.installing-${process.pid}-${Date.now()}`;
      try {
        fs.cpSync(source, temp, { recursive: true, errorOnExist: true, force: false, dereference: true });
        fs.writeFileSync(path.join(temp, MARKER_FILE), JSON.stringify({ owner: 'dsh-desktop', package: PACKAGE_NAME, version: manifest.version, digest, installedAt: new Date().toISOString() }, null, 2));
        fs.renameSync(temp, this.packageDir);
      } catch (error) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw error;
      }
      try {
        const current = fs.existsSync(this.patchPath) ? fs.readFileSync(this.patchPath, 'utf8') : '[]\n';
        this.writePatch(upsertManagedBlock(current, START, END, renderBlock(true)));
      } catch (error) {
        try { fs.rmSync(this.packageDir, { recursive: true, force: true }); } catch {}
        throw error;
      }
      return this.list();
    });
  }

  setEnabled(enabled) {
    return this.runExclusive(async () => {
      const st = this.state();
      if (st.status === 'conflict') throw new Error('检测到冲突，拒绝修改');
      if (st.status === 'available') throw new Error('Web 市场未安装');
      if (st.status === 'enabled' && enabled) return this.list();
      if (st.status === 'disabled' && !enabled) return this.list();
      const current = fs.existsSync(this.patchPath) ? fs.readFileSync(this.patchPath, 'utf8') : '[]\n';
      this.writePatch(upsertManagedBlock(current, START, END, renderBlock(enabled)));
      return this.list();
    });
  }

  uninstall() {
    return this.runExclusive(async () => {
      const st = this.state();
      if (st.status === 'available') throw new Error('Web 市场未安装');
      if (st.status === 'conflict') throw new Error('检测到冲突，拒绝卸载');
      const pkg = this.inspectPackage();
      if (!pkg?.installedDigest || digestDirectory(pkg.dir) !== pkg.installedDigest) throw new Error('市场包内容已被修改，为防止数据丢失已取消卸载');
      const trash = `${this.packageDir}.removing-${process.pid}-${Date.now()}`;
      fs.renameSync(this.packageDir, trash);
      try {
        const current = fs.existsSync(this.patchPath) ? fs.readFileSync(this.patchPath, 'utf8') : '[]\n';
        const next = stripManagedBlock(current, START, END);
        if (next !== current) this.writePatch(next);
      } catch (error) {
        try { fs.renameSync(trash, this.packageDir); } catch {}
        throw error;
      }
      try { fs.rmSync(trash, { recursive: true, force: true }); } catch {}
      return this.list();
    });
  }
}

module.exports = { WebMarketManager, PACKAGE_NAME, PACKAGE_SCOPE, PATCH_ID, START, END, MARKER_FILE, VENDORED_DIGEST, digestDirectory, renderBlock };
