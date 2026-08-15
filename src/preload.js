'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose only the allowlisted Plugin Center operations. The renderer cannot
// supply filesystem paths, commands, URLs, or arbitrary IPC channel names.
contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  shell: true,
  pluginCenter: Object.freeze({
    list: () => ipcRenderer.invoke('plugin-center:list'),
    install: (id) => ipcRenderer.invoke('plugin-center:install', id),
    enable: (id) => ipcRenderer.invoke('plugin-center:enable', id),
    disable: (id) => ipcRenderer.invoke('plugin-center:disable', id),
    uninstall: (id) => ipcRenderer.invoke('plugin-center:uninstall', id),
  }),
}));
