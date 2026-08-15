'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { RuntimeManager } = require('./runtime-manager');
const { configDefaults, loadConfig } = require('./config');
const { detectEnvironment } = require('./environment-detector');
const { PluginManager } = require('./plugin-manager');
const { ensureDshIntegration, installBridgePackage } = require('./dsh-integration');
const { ProjectPanelManager } = require('./project-panel-manager');

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
let projectPanelManager = null;
let config = null;
let quitting = false;

function userFile(name) {
  return path.join(app.getPath('userData'), name);
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

  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
  mainWindow.loadURL(config.url).catch((error) => log(`loadURL failed: ${error.message}`));
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

function isPluginCenterSender(event) {
  if (pluginCenterWindow && !pluginCenterWindow.isDestroyed() && event.sender === pluginCenterWindow.webContents) return true;
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && isAllowedNavigation(event.sender.getURL()));
}

function registerPluginCenterIpc() {
  const handle = (channel, operation) => ipcMain.handle(channel, async (event, value) => {
    if (!isPluginCenterSender(event)) throw new Error('不允许的插件中心请求');
    return operation(value);
  });
  handle('plugin-center:list', () => pluginManager.list());
  handle('plugin-center:install', (id) => pluginManager.install(id));
  handle('plugin-center:enable', (id) => pluginManager.setEnabled(id, true));
  handle('plugin-center:disable', (id) => pluginManager.setEnabled(id, false));
  handle('plugin-center:uninstall', (id) => pluginManager.uninstall(id));
  handle('plugin-center:open-folder', async () => {
    fs.mkdirSync(path.join(config.dshHome, '.agent-presets'), { recursive: true });
    const result = await shell.openPath(path.join(config.dshHome, '.agent-presets'));
    if (result) throw new Error(result);
    return true;
  });
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
  log(`Desktop exit requested; stopOwned=${stopOwned}`);
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
  const bridge = installBridgePackage(config.dshHome, path.join(resourceRoot, 'dsh-plugin-center'));
  if (bridge.changed) log(`Installed DSH settings bridge package at ${bridge.target}`);
  const integration = ensureDshIntegration(config.dshHome);
  if (integration.changed || bridge.changed) log(`Enabled DSH settings Plugin Center in ${integration.patchPath}; DSH restart required`);
  registerPluginCenterIpc();
  registerProjectPanelIpc();
  const environment = await detectEnvironment({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    electronPath: process.execPath,
    platform: process.platform,
    env: process.env,
  });
  log(`Environment: globalDsh=${environment.globalDsh} npx=${environment.npx} bundled=${environment.bundled}`);
  runtime = new RuntimeManager(config, log, environment);
  const mode = await runtime.ensureReady();
  log(`Runtime ready (${mode}) at ${config.url}`);
  createWindow();
  createTray();
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow && config && !quitting) createWindow();
    mainWindow?.restore();
    mainWindow?.show();
    mainWindow?.focus();
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
