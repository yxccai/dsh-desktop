'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, input) => ipcRenderer.invoke(channel, input);

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  shell: true,
  pluginCenter: Object.freeze({
    list: () => call('plugin-center:list'),
    install: (id) => call('plugin-center:install', id),
    enable: (id) => call('plugin-center:enable', id),
    disable: (id) => call('plugin-center:disable', id),
    uninstall: (id) => call('plugin-center:uninstall', id),
  }),
  projectPanel: Object.freeze({
    list: (root, path) => call('project-panel:list', { root, path }),
    search: (root, query) => call('project-panel:search', { root, query }),
    read: (root, path) => call('project-panel:read', { root, path }),
    save: (root, path, content, modifiedAt) => call('project-panel:save', { root, path, content, modifiedAt }),
    getState: (root) => call('project-panel:state-get', { root }),
    setState: (root, state) => call('project-panel:state-set', { root, state }),
    gitStatus: (root) => call('project-panel:git-status', { root }),
    gitDiff: (root, path, staged) => call('project-panel:git-diff', { root, path, staged }),
    discard: (root, path) => call('project-panel:discard', { root, path }),
    history: (root) => call('project-panel:history', { root }),
    snapshot: (root, label, turn) => call('project-panel:snapshot', { root, label, turn }),
    snapshotDiff: (root, id, path) => call('project-panel:snapshot-diff', { root, id, path }),
    committedFileDiff: (root, path) => call('project-panel:committed-file-diff', { root, path }),
    revertSnapshotFile: (root, id, path) => call('project-panel:revert-snapshot-file', { root, id, path }),
    revertSnapshot: (root, id) => call('project-panel:revert-snapshot', { root, id }),
    openExternal: (root, path) => call('project-panel:open-external', { root, path }),
  }),
}));
