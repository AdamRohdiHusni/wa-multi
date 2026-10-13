// prepended into main.js before the "// prefs defaults" block
// ── v2.6.0 FEATURES: chat initials (multi-admin attribution) + auto-update ──
// Chat initials: 1 nomor WA dipakai rame-rame di banyak laptop. WA itself cannot
// tell which *device* sent a message (all devices see own messages as "me"), so
// attribution has to live in the message text. Append a short tag (/DM, /FR, ...)
// to every outgoing message. Visibility only — send button is NEVER locked.

const INITIAL_ENGINE = [
  "(function(){",
  "if(window.WAM_INITIAL){return 'exists'}",
  "var C={on:false,code:'',skipGroups:true},S={n:0,last:0};",
  "function active(){try{var a=document.activeElement;if(a&&a.isContentEditable)return a}catch(e){}",
  "var q=document.querySelector('#main footer div[contenteditable=\\\"true\\\"]');return q||null}",
  "function isGroup(){try{var h=document.querySelector('#main header');if(!h)return false;",
  "if(h.querySelector('[data-icon=\\\"default-group\\\"],[data-icon=\\\"group\\\"]'))return true;",
  "var t=h.innerText||'';return /group info|info grup/i.test(t)}catch(e){return false}}",
  "function txt(el){try{return el.innerText||el.textContent||''}catch(e){return ''}}",
  "function tag(el){try{var m='/'+C.code,t=txt(el).trim();if(!t||!m)return false;",
  "if(t.length>=m.length&&t.slice(-m.length)===m)return false;el.focus();",
  "var s=window.getSelection(),r=document.createRange();r.selectNodeContents(el);",
  "r.collapse(false);s.removeAllRanges();s.addRange(r);",
  "document.execCommand('insertText',false,' '+m);S.n++;S.last=Date.now();return true}catch(e){return false}}",
  "function want(){return !!(C.on&&C.code&&!(C.skipGroups&&isGroup()))}",
  "function key(e){try{if(e.key!=='Enter'||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey)return;",
  "if(!want())return;var el=active();if(el)tag(el)}catch(err){}}",
  "function clk(e){try{if(!want())return;var b=e.target&&e.target.closest?",
  "e.target.closest('[data-testid=\\\"send\\\"],[data-icon=\\\"send\\\"]'):null;if(!b)return;",
  "var el=active();if(el)tag(el)}catch(err){}}",
  "window.WAM_INITIAL={set:function(c){try{C=Object.assign(C,c||{})}catch(e){}},",
  "get:function(){return {on:!!C.on,code:C.code||'',group:isGroup(),n:S.n,last:S.last}}}();",
  "document.addEventListener('keydown',key,true);document.addEventListener('click',clk,true);",
  "return 'installed'})()"
].join('')

function ipcSend (channel, payload) {
  try {
    const w = BrowserWindow.getAllWindows()[0]
    if (w && !w.isDestroyed() && w.webContents) w.webContents.send(channel, payload)
  } catch (_) {}
}

function liveViews () {
  const out = []
  try {
    for (const [id, v] of views) {
      try { if (v && v.webContents && !v.webContents.isDestroyed()) out.push([id, v]) } catch (_) {}
    }
  } catch (_) {}
  return out
}

function initialsCfg () {
  const i = prefs.initials || {}
  return { on: !!i.on, code: String(i.code || ''), skipGroups: i.skipGroups !== false }
}

function initialsCfgJS () {
  return 'window.WAM_INITIAL&&window.WAM_INITIAL.set(' + JSON.stringify(initialsCfg()) + ')'
}

// inject + configure the tag engine in every live WA view (called from the ticker)
async function ensureInitialEngine () {
  if (!(prefs.initials && prefs.initials.on && prefs.initials.code)) return
  for (const [, v] of liveViews()) {
    try {
      const injected = await v.webContents.executeJavaScript('!!(window.WPP&&window.WPP.isInjected)').catch(() => false)
      if (!injected) continue
      const has = await v.webContents.executeJavaScript('!!window.WAM_INITIAL').catch(() => false)
      if (!has) await v.webContents.executeJavaScript(INITIAL_ENGINE).catch(() => {})
      await v.webContents.executeJavaScript(initialsCfgJS()).catch(() => {})
    } catch (_) {}
  }
}

let initialsTimer = null
function startInitialsLoop () {
  if (initialsTimer) return
  initialsTimer = setInterval(async () => {
    try {
      if (!(prefs.initials && prefs.initials.on)) return
      await ensureInitialEngine()
    } catch (_) {}
  }, 7000)
  try { if (initialsTimer.unref) initialsTimer.unref() } catch (_) {}
}

// ── auto-update (electron-updater + GitHub Releases feed) ──────
const UPD_OWNER = 'AdamRohdiHusni'
const UPD_REPO = 'wa-multi'
let waUpdater = null

function initUpdater () {
  if (waUpdater) return waUpdater
  try {
    const eu = require('electron-updater')
    waUpdater = eu && eu.autoUpdater
    if (!waUpdater) throw new Error('autoUpdater missing')
    try { waUpdater.autoDownload = true } catch (_) {}
    try { waUpdater.autoInstallOnAppQuit = true } catch (_) {}
    try { waUpdater.setFeedURL({ provider: 'github', owner: UPD_OWNER, repo: UPD_REPO }) } catch (_) {}
    waUpdater.on('checking-for-update', () => ipcSend('update:status', { state: 'checking' }))
    waUpdater.on('update-available', (i) => ipcSend('update:status', { state: 'available', version: (i && i.version) || '' }))
    waUpdater.on('update-not-available', () => ipcSend('update:status', { state: 'latest', version: app.getVersion() }))
    waUpdater.on('download-progress', (p) => ipcSend('update:status', { state: 'downloading', percent: Math.round((p && p.percent) || 0) }))
    waUpdater.on('update-downloaded', (i) => ipcSend('update:status', { state: 'ready', version: (i && i.version) || '' }))
    waUpdater.on('error', (e) => ipcSend('update:status', { state: 'error', message: String((e && e.message) || e).slice(0, 200) }))
    if (process.env.WA_MULTI_DEV || process.env.WA_MULTI_SELFTEST) { waUpdater.forceDevUpdateConfig = false }
  } catch (_) { waUpdater = null }
  return waUpdater
}

async function updaterCheck (manual) {
  const u = initUpdater()
  if (!u) { ipcSend('update:status', { state: 'unavailable' }); return { ok: false, error: 'updater tidak tersedia' } }
  try { await u.checkForUpdates(); return { ok: true } } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}
// ── END v2.6.0 FEATURES ──