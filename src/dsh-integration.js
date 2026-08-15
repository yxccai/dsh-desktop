'use strict';

const fs = require('node:fs');
const path = require('node:path');
const START = '# >>> DSH Desktop Plugin Center >>>';
const END = '# <<< DSH Desktop Plugin Center <<<';

function renderBlock(packageName) {
  if (packageName !== '@yxccai/dsh-desktop-plugin-center') throw new Error('不允许的 DSH 集成包');
  return `${START}\n- insert:\n    - id: desktop-plugin-center\n      name: '${packageName}'\n${END}`;
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

module.exports = { ensureDshIntegration, renderBlock, START, END };
