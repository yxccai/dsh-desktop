'use strict';

const fs = require('node:fs');
const path = require('node:path');

function configDefaults(paths, env = process.env) {
  return {
    url: 'http://127.0.0.1:3080',
    dshHome: env.DSH_HOME || path.join(paths.home, '.dsh'),
    npmCache: env.npm_config_cache || path.join(paths.localAppData, 'npm-cache'),
    launchMode: 'auto',
    runtimePreference: 'system-first',
    dshVersion: '0.1.0-rc.6',
    command: '',
    args: [],
    workingDirectory: '',
    candidateTimeoutMs: 30000,
    closeBehavior: 'quit-owned',
    notifications: { enabled: false },
  };
}

function validateConfig(value) {
  const result = { ...value };
  let parsed;
  try { parsed = new URL(result.url); } catch { throw new Error('url must be a valid URL'); }
  if (parsed.protocol !== 'http:') throw new Error('url must use http for the local DSH service');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('url must point to a loopback host');
  if (!['auto', 'npx', 'global', 'bundled', 'connect'].includes(result.launchMode)) throw new Error('invalid launchMode');
  if (!['system-first', 'bundled-first'].includes(result.runtimePreference)) throw new Error('invalid runtimePreference');
  if (!['quit-owned', 'keep', 'tray'].includes(result.closeBehavior)) throw new Error('invalid closeBehavior');
  if (!result.notifications || typeof result.notifications !== 'object' || Array.isArray(result.notifications) || typeof result.notifications.enabled !== 'boolean') throw new Error('notifications.enabled must be a boolean');
  for (const field of ['dshHome', 'npmCache', 'workingDirectory', 'command', 'dshVersion', 'runtimePreference']) {
    if (typeof result[field] !== 'string') throw new Error(`${field} must be a string`);
  }
  if (!Array.isArray(result.args) || !result.args.every((arg) => typeof arg === 'string')) throw new Error('args must be a string array');
  if (!Number.isInteger(result.candidateTimeoutMs) || result.candidateTimeoutMs < 3000 || result.candidateTimeoutMs > 300000) throw new Error('candidateTimeoutMs must be an integer from 3000 to 300000');
  return result;
}

function loadConfig(file, defaults) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validateConfig({ ...defaults, ...value });
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid config ${file}: ${error.message}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`);
    return validateConfig({ ...defaults });
  }
}

module.exports = { configDefaults, validateConfig, loadConfig };
