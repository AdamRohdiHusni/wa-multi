const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('waMulti', {
  getState: () => ipcRenderer.invoke('wa-multi:getState'),
  addAccount: (name) => ipcRenderer.invoke('wa-multi:addAccount', name),
  renameAccount: (id, name) => ipcRenderer.invoke('wa-multi:renameAccount', { id, name }),
  removeAccount: (id) => ipcRenderer.invoke('wa-multi:removeAccount', id),
  openAccount: (id) => ipcRenderer.invoke('wa-multi:openAccount', id),
  closeAccount: () => ipcRenderer.invoke('wa-multi:closeAccount'),
  setTheme: (theme) => ipcRenderer.invoke('wa-multi:setTheme', theme),
  setUITop: (top) => ipcRenderer.invoke('wa-multi:setUITop', top),
  setOverlayOpen: (open) => ipcRenderer.invoke('wa-multi:setOverlayOpen', open),
  onUnread: (cb) => ipcRenderer.on('wa-multi:unread', (_e, data) => cb(data)),
  onLiveClosed: (cb) => ipcRenderer.on('wa-multi:liveClosed', () => cb()),
  onStateChanged: (cb) => ipcRenderer.on('wa-multi:stateChanged', () => cb())
})
