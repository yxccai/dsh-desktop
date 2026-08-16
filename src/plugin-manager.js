'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
const MARKER_FILE = '.dsh-desktop-plugin.json';
const REQUIRED_FILE = 'agent.cordis.yml';

/** Text-file line endings are normalized before hashing so a bundled preset's
 * digest is identical no matter how the checkout or packaging wrote it (git
 * core.autocrlf, zip, asar, NSIS). Everything else is hashed byte-for-byte. */
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.yml', '.yaml', '.md', '.txt']);

function normalizedBytes(target, name) {
  if (TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    const raw = fs.readFileSync(target);
    if (!raw.includes(0)) return raw.toString('latin1').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  return fs.readFileSync(target);
}

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

class PluginManager {
  constructor(options) {
    this.dshHome = path.resolve(options.dshHome);
    this.catalogPath = path.resolve(options.catalogPath);
    this.bundleRoot = path.resolve(options.bundleRoot);
    this.enabledRoot = path.join(this.dshHome, '.agent-presets');
    this.disabledRoot = path.join(this.dshHome, '.desktop-plugin-disabled');
    this.catalog = this.loadCatalog();
    this.queue = Promise.resolve();
  }

  loadCatalog() {
    const document = readJson(this.catalogPath, null);
    if (!document || document.schemaVersion !== 1 || !Array.isArray(document.plugins)) {
      throw new Error('插件中心清单无效');
    }
    const seen = new Set();
    return document.plugins.map((plugin) => {
      if (!plugin || !ID_PATTERN.test(plugin.id) || seen.has(plugin.id)) throw new Error('插件中心包含无效或重复 ID');
      if (typeof plugin.name !== 'string' || typeof plugin.description !== 'string' || typeof plugin.version !== 'string') throw new Error(`插件 ${plugin.id} 的元数据不完整`);
      seen.add(plugin.id);
      return Object.freeze({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: typeof plugin.author === 'string' ? plugin.author : 'DSH Desktop',
        source: typeof plugin.source === 'string' ? plugin.source : 'Bundled',
        permissions: Array.isArray(plugin.permissions) ? plugin.permissions.filter((x) => typeof x === 'string') : [],
        bundledDir: plugin.bundledDir,
        digest: plugin.digest,
      });
    });
  }

  digestDirectory(root) {
    const files = [];
    const walk = (directory, depth = 0) => {
      if (depth > 8) throw new Error('插件目录层级过深');
      for (const entry of safeChildren(directory).sort((a, b) => a.name.localeCompare(b.name))) {
        const target = path.join(directory, entry.name);
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('插件包包含不支持的文件类型');
        if (entry.isDirectory()) walk(target, depth + 1);
        else {
          if (entry.name === MARKER_FILE) continue;
          if (stat.size > 1024 * 1024) throw new Error('插件文件过大');
          files.push({ relative: path.relative(root, target).replaceAll('\\', '/'), target, size: stat.size });
          if (files.length > 100) throw new Error('插件文件数量过多');
        }
      }
    };
    walk(root);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > 5 * 1024 * 1024) throw new Error('插件包总大小过大');
    const listing = files.map((file) => `${file.relative}:${crypto.createHash('sha256').update(normalizedBytes(file.target, file.relative)).digest('hex')}`).join('\n');
    return crypto.createHash('sha256').update(listing).digest('hex');
  }

  catalogPlugin(id) {
    if (!ID_PATTERN.test(id)) throw new Error('插件 ID 无效');
    const plugin = this.catalog.find((item) => item.id === id);
    if (!plugin) throw new Error('插件不在受信任清单中');
    return plugin;
  }

  target(root, id) {
    if (!ID_PATTERN.test(id)) throw new Error('插件 ID 无效');
    return path.join(root, id);
  }

  inspectAt(root, id) {
    const dir = this.target(root, id);
    if (!isDirectory(dir)) return null;
    const marker = readJson(path.join(dir, MARKER_FILE), null);
    return {
      dir,
      owned: Boolean(marker && marker.owner === 'dsh-desktop' && marker.id === id),
      version: marker?.version,
      installedDigest: marker?.digest,
      valid: fs.existsSync(path.join(dir, REQUIRED_FILE)),
    };
  }

  list() {
    const recommended = this.catalog.map((plugin) => {
      const enabled = this.inspectAt(this.enabledRoot, plugin.id);
      const disabled = this.inspectAt(this.disabledRoot, plugin.id);
      let status = 'available';
      let owned = false;
      let valid = true;
      let installedVersion = null;
      if (enabled) {
        status = enabled.owned ? 'enabled' : 'conflict';
        owned = enabled.owned;
        valid = enabled.valid;
        installedVersion = enabled.version || null;
      } else if (disabled) {
        status = disabled.owned ? 'disabled' : 'conflict';
        owned = disabled.owned;
        valid = disabled.valid;
        installedVersion = disabled.version || null;
      }
      return { ...plugin, status, owned, valid, installedVersion };
    });
    const catalogIds = new Set(this.catalog.map((plugin) => plugin.id));
    const external = safeChildren(this.enabledRoot)
      .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name) && !catalogIds.has(entry.name))
      .map((entry) => ({ id: entry.name, name: entry.name, status: 'external', owned: false, valid: fs.existsSync(path.join(this.enabledRoot, entry.name, REQUIRED_FILE)) }));
    return { dshHome: this.dshHome, recommended, external };
  }

  runExclusive(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  install(id) {
    return this.runExclusive(async () => {
      const plugin = this.catalogPlugin(id);
      const source = path.resolve(this.bundleRoot, plugin.bundledDir);
      if (!source.startsWith(`${this.bundleRoot}${path.sep}`) || !isDirectory(source) || !fs.existsSync(path.join(source, REQUIRED_FILE))) throw new Error('内置插件包不完整');
      if (typeof plugin.digest !== 'string' || this.digestDirectory(source) !== plugin.digest) throw new Error('内置插件包校验失败');
      const enabled = this.target(this.enabledRoot, id);
      const disabled = this.target(this.disabledRoot, id);
      if (fs.existsSync(enabled) || fs.existsSync(disabled)) throw new Error('同名插件或 Preset 已存在');
      fs.mkdirSync(this.enabledRoot, { recursive: true });
      const temp = `${enabled}.installing-${process.pid}-${Date.now()}`;
      try {
        fs.cpSync(source, temp, { recursive: true, errorOnExist: true, force: false, dereference: true });
        fs.writeFileSync(path.join(temp, MARKER_FILE), JSON.stringify({ owner: 'dsh-desktop', id, version: plugin.version, digest: plugin.digest, installedAt: new Date().toISOString() }, null, 2));
        fs.renameSync(temp, enabled);
      } catch (error) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw error;
      }
      return this.list();
    });
  }

  setEnabled(id, enabled) {
    return this.runExclusive(async () => {
      this.catalogPlugin(id);
      const fromRoot = enabled ? this.disabledRoot : this.enabledRoot;
      const toRoot = enabled ? this.enabledRoot : this.disabledRoot;
      const current = this.inspectAt(fromRoot, id);
      if (!current?.owned) throw new Error('只能管理由 DSH Desktop 安装的插件');
      const target = this.target(toRoot, id);
      if (fs.existsSync(target)) throw new Error('目标位置已有同名 Preset');
      fs.mkdirSync(toRoot, { recursive: true });
      fs.renameSync(current.dir, target);
      return this.list();
    });
  }

  uninstall(id) {
    return this.runExclusive(async () => {
      this.catalogPlugin(id);
      const current = this.inspectAt(this.enabledRoot, id) || this.inspectAt(this.disabledRoot, id);
      if (!current?.owned) throw new Error('只能卸载由 DSH Desktop 安装的插件');
      if (!current.installedDigest || this.digestDirectory(current.dir) !== current.installedDigest) throw new Error('插件内容已被修改，为防止数据丢失已取消卸载');
      const trash = `${current.dir}.removing-${process.pid}-${Date.now()}`;
      fs.renameSync(current.dir, trash);
      fs.rmSync(trash, { recursive: true, force: true });
      return this.list();
    });
  }
}

module.exports = { PluginManager, ID_PATTERN, MARKER_FILE };
