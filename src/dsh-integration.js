'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const START = '# >>> DSH Desktop Plugin Center >>>';
const END = '# <<< DSH Desktop Plugin Center <<<';

function renderBlock(packageName) {
  if (packageName !== '@yxccai/dsh-desktop-plugin-center') throw new Error('不允许的 DSH 集成包');
  return `${START}\n- insert:\n    - id: desktop-plugin-center\n      name: '${packageName}'\n${END}`;
}

/**
 * Replace (or append) one managed marker-delimited block in a patch document.
 * Shared by every DSH Desktop-owned insertion so multiple managers can
 * coexist in the same home-level `cordis.patch.yml` without touching each
 * other's content. Pure string helper.
 * @param {string} current - full current patch text.
 * @param {string} start - block start marker.
 * @param {string} end - block end marker.
 * @param {string} block - replacement block (markers included).
 * @returns the patched document text.
 */
function upsertManagedBlock(current, start, end, block) {
  const s = current.indexOf(start);
  const e = current.indexOf(end);
  if (s >= 0 && e > s) return `${current.slice(0, s)}${block}${current.slice(e + end.length)}`;
  const trimmed = current.trim();
  if (trimmed === '' || trimmed === '[]') return `${block}\n`;
  return `${current.trimEnd()}\n\n${block}\n`;
}

/**
 * Remove one managed marker-delimited block from a patch document, tidying
 * leftover blank lines and keeping the document a valid YAML list.
 * @param {string} current - full current patch text.
 * @param {string} start - block start marker.
 * @param {string} end - block end marker.
 * @returns the patched document text without the block.
 */
function stripManagedBlock(current, start, end) {
  const s = current.indexOf(start);
  const e = current.indexOf(end);
  if (s < 0 || e <= s) return current;
  let next = `${current.slice(0, s)}${current.slice(e + end.length)}`;
  next = next.replace(/\n{3,}/g, '\n\n');
  if (next.trim() === '') return '[]\n';
  next = next.replace(/\n+$/, '\n');
  return next;
}

function bridgeDigest(directory) {
  const hash = crypto.createHash('sha256');
  for (const name of ['package.json', path.join('lib', 'index.js'), path.join('lib', 'host.js'), path.join('lib', 'client.js')]) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) continue;
    hash.update(name.replaceAll('\\', '/'));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function installBridgePackage(dshHome, sourceDir) {
  const home = path.resolve(dshHome);
  const source = path.resolve(sourceDir);
  const target = path.join(home, 'node_modules', '@yxccai', 'dsh-desktop-plugin-center');
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (sourceManifest.name !== '@yxccai/dsh-desktop-plugin-center') throw new Error('插件中心桥接包身份无效');
  const currentManifest = fs.existsSync(path.join(target, 'package.json'))
    ? JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
    : null;
  if (currentManifest?.name === sourceManifest.name && currentManifest.version === sourceManifest.version && bridgeDigest(target) === bridgeDigest(source)) return { changed: false, target };
  if (fs.existsSync(target) && currentManifest?.name !== sourceManifest.name) throw new Error('DSH_HOME 中存在冲突的插件中心包');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.installing-${process.pid}-${Date.now()}`;
  const backup = `${target}.backup-${process.pid}-${Date.now()}`;
  try {
    fs.cpSync(source, temp, { recursive: true, dereference: true, errorOnExist: true, force: false });
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    fs.renameSync(temp, target);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
  return { changed: true, target };
}

function ensureDshIntegration(dshHome, packageName = '@yxccai/dsh-desktop-plugin-center') {
  const home = path.resolve(dshHome);
  const patchPath = path.join(home, 'cordis.patch.yml');
  fs.mkdirSync(home, { recursive: true });
  const current = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '[]\n';
  const block = renderBlock(packageName);
  const next = upsertManagedBlock(current, START, END, block);
  if (next === current) return { changed: false, patchPath };
  const temp = `${patchPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, patchPath);
  return { changed: true, patchPath };
}

module.exports = { ensureDshIntegration, installBridgePackage, renderBlock, START, END, upsertManagedBlock, stripManagedBlock };
