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

function bridgeDigest(directory) {
  const hash = crypto.createHash('sha256');
  for (const name of ['package.json', path.join('lib', 'index.js'), path.join('lib', 'client.js')]) {
    hash.update(name.replaceAll('\\', '/'));
    hash.update(fs.readFileSync(path.join(directory, name)));
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
  let next;
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + END.length)}`;
  } else {
    const trimmed = current.trim();
    next = trimmed === '[]' || trimmed === '' ? `${block}\n` : `${current.trimEnd()}\n\n${block}\n`;
  }
  if (next === current) return { changed: false, patchPath };
  const temp = `${patchPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, patchPath);
  return { changed: true, patchPath };
}

module.exports = { ensureDshIntegration, installBridgePackage, renderBlock, START, END };
