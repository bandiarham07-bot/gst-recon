const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (opts) => ipcRenderer.invoke('open-file-dialog', opts),
  saveFileDialog: (opts) => ipcRenderer.invoke('save-file-dialog', opts),
  api: (opts) => ipcRenderer.invoke('api', opts),
});
