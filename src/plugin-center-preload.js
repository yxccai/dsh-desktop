'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pluginCenter', Object.freeze({
  list: () => ipcRenderer.invoke('plugin-center:list'),
  install: (id) => ipcRenderer.invoke('plugin-center:install', id),
  enable: (id) => ipcRenderer.invoke('plugin-center:enable', id),
  disable: (id) => ipcRenderer.invoke('plugin-center:disable', id),
  uninstall: (id) => ipcRenderer.invoke('plugin-center:uninstall', id),
  backgroundGet: () => ipcRenderer.invoke('plugin-center:background-get'),
  backgroundPick: () => ipcRenderer.invoke('plugin-center:background-pick'),
  backgroundOpacity: (opacity) => ipcRenderer.invoke('plugin-center:background-opacity', opacity),
  backgroundClear: () => ipcRenderer.invoke('plugin-center:background-clear'),
  openFolder: () => ipcRenderer.invoke('plugin-center:open-folder'),
}));
