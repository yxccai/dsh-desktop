'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { RuntimeManager } = require('./runtime-manager');
const { configDefaults, loadConfig } = require('./config');
const { detectEnvironment } = require('./environment-detector');
const { pnpmRuntimeEnv } = require('./pnpm-runtime');
const { PluginManager } = require('./plugin-manager');
const { WebMarketManager } = require('./web-market-manager');
const { ensureDshIntegration, installBridgePackage } = require('./dsh-integration');
const { isPluginCenterSender, isWebMarketSender } = require('./ipc-guards');
const { ProjectPanelManager } = require('./project-panel-manager');
const { allowsDesktopPermission } = require('./desktop-permissions');

// Keep desktop-only state separate from DSH_HOME. Users who avoid the system
// drive can set DSH_DESKTOP_HOME before launching the app.
if (process.env.DSH_DESKTOP_HOME) {
  app.setPath('userData', path.resolve(process.env.DSH_DESKTOP_HOME));
}

let mainWindow = null;
let pluginCenterWindow = null;
let tray = null;
let runtime = null;
let pluginManager = null;
let webMarketManager = null;
let projectPanelManager = null;
let config = null;

/** Simple startup page shown while the DSH service is starting. */
const STARTUP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center;
         background: #101820; color: #d8e6f0; font-family: system-ui, "Segoe UI", sans-serif; }
  .box { text-align: center; }
  .spinner { width: 36px; height: 36px; margin: 0 auto 18px;
             border: 3px solid rgba(72, 215, 238, .25); border-top-color: #48d7ee;
             border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
  .hint { font-size: 13px; color: #8fa6b3; }
</style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <div class="title">DSH Desktop 正在启动…</div>
    <div class="hint">正在准备 DeepSeek Harness 运行环境</div>
  </div>
</body>
</html>`;

/** Navigate the main window to the real DSH URL (no-op when already there). */
function loadMainUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = mainWindow.webContents.getURL();
  if (current === config.url || current.startsWith(config.url + '/')) return;
  mainWindow.loadURL(config.url).catch((error) => log(`loadURL failed: ${error.message}`));
}
let quitting = false;

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(userFile('dsh-desktop.log'), line);
  } catch {}
}

function configuredOrigin() {
  return new URL(config.url).origin;
}

function isAllowedNavigation(target) {
  try { return new URL(target).origin === configuredOrigin(); }
  catch { return false; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const permissionAllowed = (contents, permission, details = {}) => allowsDesktopPermission({ permission, senderUrl: details.requestingUrl || contents?.getURL?.() || '', appOrigin: configuredOrigin(), isMainWindow: contents === mainWindow?.webContents });
  mainWindow.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => permissionAllowed(contents, permission, { ...details, requestingUrl: details?.requestingUrl || requestingOrigin }));
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(permissionAllowed(contents, permission, details)));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`Renderer exited: ${details.reason}, code=${details.exitCode}`);
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (quitting) return;
    if (config.closeBehavior === 'tray') {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    event.preventDefault();
    requestQuit(config.closeBehavior !== 'keep');
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // Show a local startup page immediately so the window never appears blank
  // while the DSH service is starting; start() switches to the real URL once
  // ensureReady() returns.
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(STARTUP_HTML)}`)
    .catch((error) => log(`startup page failed: ${error.message}`));
}

function createPluginCenterWindow() {
  if (pluginCenterWindow && !pluginCenterWindow.isDestroyed()) {
    pluginCenterWindow.show();
    pluginCenterWindow.focus();
    return;
  }
  pluginCenterWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'DSH 插件中心',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'plugin-center-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  pluginCenterWindow.webContents.session.setPermissionCheckHandler(() => false);
  pluginCenterWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pluginCenterWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pluginCenterWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== pluginCenterWindow.webContents.getURL()) event.preventDefault();
  });
  pluginCenterWindow.on('closed', () => { pluginCenterWindow = null; });
  pluginCenterWindow.loadFile(path.join(__dirname, 'plugin-center.html'));
}

function senderContext(event) {
  return { pluginCenterWindow, mainWindow, sender: event.sender, isAllowedNavigation };
}

function registerPluginCenterIpc() {
  const handle = (channel, operation) => ipcMain.handle(channel, async (event, value) => {
    if (!isPluginCenterSender(senderContext(event))) throw new Error('不允许的插件中心请求');
    return operation(value);
  });
  handle('plugin-center:list', () => pluginManager.list());
  handle('plugin-center:install', (id) => pluginManager.install(id));
  handle('plugin-center:enable', (id) => pluginManager.setEnabled(id, true));
  handle('plugin-center:disable', (id) => pluginManager.setEnabled(id, false));
  handle('plugin-center:uninstall', (id) => pluginManager.uninstall(id));
  const normalizeBackgroundOpacity = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(100, Math.max(10, Math.round(parsed)));
  };
  handle('plugin-center:background-get', () => {
    const file = userFile('custom-background.json');
    try { const meta = JSON.parse(fs.readFileSync(file, 'utf8')); const image = userFile(path.join('themes', meta.file)); if (!fs.existsSync(image)) return null; return { name: meta.name, dataUrl: `data:${meta.mime};base64,${fs.readFileSync(image).toString('base64')}`, opacity: normalizeBackgroundOpacity(meta.opacity) }; } catch { return null; }
  });
  handle('plugin-center:background-pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow || pluginCenterWindow, { title: '选择主题背景图片', properties: ['openFile'], filters: [{ name: '背景图片', extensions: ['png','jpg','jpeg','webp','gif'] }] });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const source = result.filePaths[0]; const stat = fs.statSync(source); if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('背景图片必须小于 20 MB');
    const ext = path.extname(source).toLowerCase(); const mime = ({ '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif' })[ext]; if (!mime) throw new Error('不支持的背景图片格式');
    const themes = userFile('themes'); fs.mkdirSync(themes, { recursive: true }); const name = `custom-background${ext}`; const target = path.join(themes, name); fs.copyFileSync(source, target); atomicWriteJson(userFile('custom-background.json'), { file: name, name: path.basename(source), mime, opacity: 100 });
    return { name: path.basename(source), dataUrl: `data:${mime};base64,${fs.readFileSync(target).toString('base64')}`, opacity: 100 };
  });
  handle('plugin-center:background-opacity', (value) => {
    const opacity = normalizeBackgroundOpacity(value);
    const file = userFile('custom-background.json');
    try {
      const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
      const next = { ...meta, opacity };
      atomicWriteJson(file, next);
      const image = userFile(path.join('themes', meta.file));
      if (!fs.existsSync(image)) return null;
      return { name: meta.name, dataUrl: `data:${meta.mime};base64,${fs.readFileSync(image).toString('base64')}`, opacity };
    } catch { throw new Error('尚未设置自定义背景'); }
  });
  handle('plugin-center:background-clear', () => { try { const meta = JSON.parse(fs.readFileSync(userFile('custom-background.json'), 'utf8')); fs.rmSync(userFile(path.join('themes', meta.file)), { force: true }); } catch {} fs.rmSync(userFile('custom-background.json'), { force: true }); return null; });
  handle('plugin-center:open-folder', async () => {
    fs.mkdirSync(path.join(config.dshHome, '.agent-presets'), { recursive: true });
    const result = await shell.openPath(path.join(config.dshHome, '.agent-presets'));
    if (result) throw new Error(result);
    return true;
  });
}

function normalizeNotifyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.title !== 'string' || typeof payload.body !== 'string') return null;
  const title = payload.title.trim();
  const body = payload.body.trim();
  if (!title || !body || title.length > 120 || body.length > 500) return null;
  return { kind: typeof payload.kind === 'string' ? payload.kind.slice(0, 40) : '', title, body };
}

function registerDesktopNotificationIpc() {
  const handle = (channel, operation) => ipcMain.handle(channel, async (event, value) => {
    if (!isWebMarketSender(senderContext(event))) throw new Error('不允许的桌面通知请求');
    return operation(value);
  });
  handle('desktop:notify', (payload) => {
    const normalized = normalizeNotifyPayload(payload);
    if (!normalized || !config.notifications.enabled) return false;
    // Windows notifications do not play a sound by default; beep so the user
    // actually notices. shell.beep() uses the system default notification
    // sound on Windows.
    try { shell.beep(); } catch {}
    const notification = new Notification({ title: normalized.title, body: normalized.body });
    notification.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
    notification.show();
    return true;
  });
  handle('desktop:notify-config-get', () => ({ enabled: config.notifications.enabled === true }));
  handle('desktop:notify-config-set', (value) => {
    if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new Error('通知配置无效');
    config.notifications.enabled = value.enabled;
    atomicWriteJson(userFile('config.json'), config);
    return { enabled: config.notifications.enabled };
  });
}

function registerWebMarketIpc() {
  const handle = (channel, operation) => ipcMain.handle(channel, async (event) => {
    // Trusted from the plugin-center window AND the exact main DSH page (the
    // Web settings bridge's 内置插件 tab card calls through src/preload.js).
    if (!isWebMarketSender(senderContext(event))) throw new Error('不允许的 Web 市场请求');
    return operation();
  });
  handle('web-market:list', () => webMarketManager.list());
  handle('web-market:install', () => webMarketManager.install());
  handle('web-market:enable', () => webMarketManager.setEnabled(true));
  handle('web-market:disable', () => webMarketManager.setEnabled(false));
  handle('web-market:uninstall', () => webMarketManager.uninstall());
}

function registerProjectPanelIpc() {
  const handle = (channel, operation) => ipcMain.handle(channel, async (event, input) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || !isAllowedNavigation(event.sender.getURL())) throw new Error('不允许的项目面板请求');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('项目面板参数无效');
    return operation(input);
  });
  handle('project-panel:list', (x) => projectPanelManager.list(x.root, x.path));
  handle('project-panel:search', (x) => projectPanelManager.search(x.root, x.query));
  handle('project-panel:read', (x) => projectPanelManager.read(x.root, x.path));
  handle('project-panel:save', (x) => projectPanelManager.save(x.root, x.path, x.content, x.modifiedAt));
  handle('project-panel:state-get', (x) => projectPanelManager.getState(x.root));
  handle('project-panel:state-set', (x) => projectPanelManager.setState(x.root, x.state));
  handle('project-panel:git-status', (x) => projectPanelManager.gitStatus(x.root));
  handle('project-panel:git-diff', (x) => projectPanelManager.gitDiff(x.root, x.path, x.staged === true));
  handle('project-panel:discard', (x) => projectPanelManager.discard(x.root, x.path));
  handle('project-panel:history', (x) => projectPanelManager.history(x.root));
  handle('project-panel:snapshot', (x) => projectPanelManager.snapshot(x.root, x.label, x.turn));
  handle('project-panel:snapshot-diff', (x) => projectPanelManager.snapshotDiff(x.root, x.id, x.path));
  handle('project-panel:committed-file-diff', (x) => projectPanelManager.committedFileDiff(x.root, x.path));
  handle('project-panel:revert-snapshot-file', (x) => projectPanelManager.revertSnapshotFile(x.root, x.id, x.path));
  handle('project-panel:revert-snapshot', (x) => projectPanelManager.revertSnapshot(x.root, x.id));
  handle('project-panel:open-external', async (x) => {
    const { target } = projectPanelManager.resolvePath(x.root, x.path);
    const result = await shell.openPath(target);
    if (result) throw new Error(result);
    return true;
  });
}

function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect rx="7" width="32" height="32" fill="#182230"/><text x="16" y="22" font-family="Arial" font-size="16" text-anchor="middle" fill="white">DS</text></svg>';
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('DSH Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 DSH', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '在浏览器中打开', click: () => shell.openExternal(config.url) },
    { label: '插件中心', click: createPluginCenterWindow },
    { label: '打开日志目录', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '退出', click: () => requestQuit(true) },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

async function requestQuit(stopOwned) {
  if (quitting) return;
  quitting = true;
  log(`Desktop exit requested; stopOwned=${stopOwned}${runtime?.adopted ? `; adopted DSH pid ${runtime.adopted.pid}` : ''}`);
  try { if (stopOwned) await runtime?.stop(); }
  catch (error) { log(`Failed to stop DSH: ${error.message}`); }
  // Destroy hidden UI resources before a hard app exit so portable builds do
  // not retain the single-instance lock after the visible window is closed.
  try { tray?.destroy(); } catch {}
  tray = null;
  try { pluginCenterWindow?.destroy(); } catch {}
  pluginCenterWindow = null;
  try { mainWindow?.destroy(); } catch {}
  mainWindow = null;
  app.exit(0);
}

async function start() {
  const paths = { home: app.getPath('home'), localAppData: app.getPath('appData') };
  const defaults = configDefaults(paths);
  config = loadConfig(userFile('config.json'), defaults);
  if (!fs.existsSync(config.dshHome)) fs.mkdirSync(config.dshHome, { recursive: true });
  const resourceRoot = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
  projectPanelManager = new ProjectPanelManager({ stateRoot: path.join(app.getPath('userData'), 'project-panel'), dshHome: config.dshHome });
  pluginManager = new PluginManager({
    dshHome: config.dshHome,
    catalogPath: path.join(resourceRoot, 'plugin-catalog.json'),
    bundleRoot: path.join(resourceRoot, 'plugins'),
  });
  webMarketManager = new WebMarketManager({
    dshHome: config.dshHome,
    bundleRoot: path.join(resourceRoot, 'market-plugin'),
  });
  const bridge = installBridgePackage(config.dshHome, path.join(resourceRoot, 'dsh-plugin-center'));
  if (bridge.changed) log(`Installed DSH settings bridge package at ${bridge.target}`);
  const integration = ensureDshIntegration(config.dshHome);
  if (integration.changed || bridge.changed) log(`Enabled DSH settings Plugin Center in ${integration.patchPath}; DSH restart required`);
  registerPluginCenterIpc();
  registerDesktopNotificationIpc();
  registerWebMarketIpc();
  registerProjectPanelIpc();
  const environment = await detectEnvironment({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    electronPath: process.execPath,
    platform: process.platform,
    env: process.env,
  });
  log(`Environment: globalDsh=${environment.globalDsh} npx=${environment.npx} bundled=${environment.bundled}`);
  // Bundle pnpm and surface a PATH shim so the dsh CLI (and the market host
  // inside it) can resolve `pnpm` on machines with no global pnpm — the norm
  // for npx/global/bundled launches on Windows. RuntimeManager passes the
  // augmented PATH down to every owned DSH process.
  const pnpmEnv = pnpmRuntimeEnv({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    dshHome: config.dshHome,
    stateRoot: app.getPath('userData'),
  });
  if (pnpmEnv) {
    environment.pnpmPath = pnpmEnv.PATH;
    environment.pnpmDir = pnpmEnv.DSH_MARKET_PNPM_DIR;
    log(`Bundled pnpm shim ready at ${environment.pnpmDir}`);
  } else {
    log('Bundled pnpm not found; market installs will rely on a system pnpm on PATH');
  }
  runtime = new RuntimeManager(config, log, environment, { markerPath: userFile('dsh-ownership.json') });
  // Create the window (showing the local startup page) BEFORE waiting for the
  // DSH service, so a slow first start on a cold boot never looks frozen or
  // spawns a second blank window from a stray double-click.
  createWindow();
  createTray();
  const mode = await runtime.ensureReady();
  log(`Runtime ready (${mode}) at ${config.url}`);
  loadMainUrl();
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => {
    // Never create a second window here: during startup mainWindow may exist
    // but still show the startup page, and createWindow() would otherwise
    // produce a blank duplicate. Just surface the existing window, or rebuild
    // it when it was closed but the app is still running (tray/keep modes).
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (config && !quitting) {
      createWindow();
      loadMainUrl();
    }
  });
  app.whenReady().then(start).catch(async (error) => {
    log(error.stack || error.message);
    try { await runtime?.stop(); } catch (stopError) { log(`Startup cleanup failed: ${stopError.message}`); }
    dialog.showErrorBox('DSH Desktop 启动失败', `${error.message}\n\n日志目录：${app.getPath('userData')}`);
    quitting = true;
    app.quit();
  });
  app.on('activate', () => { if (!mainWindow && config) createWindow(); else mainWindow?.show(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !quitting && config?.closeBehavior !== 'tray') requestQuit(config?.closeBehavior !== 'keep'); });
}
