const { contextBridge } = require('electron');

// Intentionally expose no privileged APIs. This marker only lets diagnostics
// distinguish the desktop shell from a normal browser without granting access.
contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({ shell: true }));
