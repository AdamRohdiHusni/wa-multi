const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('waMulti', {
  // state
  getState: () => ipcRenderer.invoke('wa-multi:getState'),
  // accounts
  addAccount: (name) => ipcRenderer.invoke('wa-multi:addAccount', name),
  renameAccount: (id, name) => ipcRenderer.invoke('wa-multi:renameAccount', { id, name }),
  removeAccount: (id) => ipcRenderer.invoke('wa-multi:removeAccount', id),
  openAccount: (id) => ipcRenderer.invoke('wa-multi:openAccount', id),
  parkAccount: (id) => ipcRenderer.invoke('wa-multi:parkAccount', id),
  setPinned: (id) => ipcRenderer.invoke('wa-multi:setPinned', id),
  // prefs
  setTabMode: (mode) => ipcRenderer.invoke('wa-multi:setTabMode', mode),
  setTheme: (theme) => ipcRenderer.invoke('wa-multi:setTheme', theme),
  setDailyCap: (cap) => ipcRenderer.invoke('wa-multi:setDailyCap', cap),
  setUITop: (top) => ipcRenderer.invoke('wa-multi:setUITop', top),
  setOverlayOpen: (open) => ipcRenderer.invoke('wa-multi:setOverlayOpen', open),
  // data sources
  pickCsv: () => ipcRenderer.invoke('wa-multi:pickCsv'),
  pickMedia: () => ipcRenderer.invoke('wa-multi:pickMedia'),
  fetchContacts: (accountId) => ipcRenderer.invoke('wa-multi:fetchContacts', accountId),
  fetchGroups: (accountId) => ipcRenderer.invoke('wa-multi:fetchGroups', accountId),
  groupFromInvite: (accountId, link) => ipcRenderer.invoke('wa-multi:groupFromInvite', { accountId, link }),
  // blast
  startBlast: (cfg) => ipcRenderer.invoke('wa-multi:startBlast', cfg),
  stopBlast: (accountId) => ipcRenderer.invoke('wa-multi:stopBlast', accountId || null),
  // schedules
  addSchedule: (cfg) => ipcRenderer.invoke('wa-multi:addSchedule', cfg),
  cancelSchedule: (id) => ipcRenderer.invoke('wa-multi:cancelSchedule', id),
  deleteSchedule: (id) => ipcRenderer.invoke('wa-multi:deleteSchedule', id),
  clearHistory: () => ipcRenderer.invoke('wa-multi:clearHistory'),
  // events
  onStateChanged: (cb) => ipcRenderer.on('wa-multi:stateChanged', () => cb()),
  onUnread: (cb) => ipcRenderer.on('wa-multi:unread', (_e, payload) => cb(payload)),
  onBlastProgress: (cb) => ipcRenderer.on('wa-multi:blastProgress', (_e, payload) => cb(payload))
})
