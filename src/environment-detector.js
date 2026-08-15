'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function bundledDshSpec(options) {
  const packagedBin = path.join(options.appPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const unpackedBin = path.join(options.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const script = fileExists(unpackedBin) ? unpackedBin : packagedBin;
  if (!fileExists(script)) return null;
  return {
    command: options.electronPath,
    args: ['--expose-internals', script, 'web'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    label: 'bundled',
    viaCommandShell: false,
  };
}

function commandProbe(command, args, platform = process.platform) {
  return new Promise((resolve) => {
    const spec = platform === 'win32'
      ? { command: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', `${command} ${args.join(' ')}`] }
      : { command, args };
    const child = spawn(spec.command, spec.args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

async function detectEnvironment(options) {
  const bundled = bundledDshSpec(options);
  const [globalDsh, npx] = await Promise.all([
    commandProbe(options.platform === 'win32' ? 'dsh.cmd' : 'dsh', ['--version'], options.platform),
    commandProbe(options.platform === 'win32' ? 'npx.cmd' : 'npx', ['--version'], options.platform),
  ]);
  return {
    existingDshHome: options.env.DSH_HOME || '',
    existingNpmCache: options.env.npm_config_cache || '',
    globalDsh,
    npx,
    bundled: Boolean(bundled),
    bundledSpec: bundled,
  };
}

module.exports = { fileExists, bundledDshSpec, commandProbe, detectEnvironment };
