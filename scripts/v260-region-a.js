// ── v2.6.0 REGION A — disisipkan ke main.js sebelum blok "// prefs defaults" ──
// Fitur: Inisial Chat (kolaborasi multi-admin) + Auto-Update (electron-updater)
// Semua self-contained & fail-safe: kalau ada yang gagal, app tetap jalan normal.

// Engine yang diinjeksi ke dalam WebContentsView WA Web (tanpa preload).
// Dipakai string concat (bukan template literal) supaya aman saat di-obfuscate.
const INITIAL_ENGINE = "(function(){" +
  "if(window.__WA_MULTI_INITIAL_ENGINE__){return 'exists'}" +
  "var CFG={enabled:false,code:'',name:'',append:true,skipGroups:true,showBadge:true};" +
  "var STATE={last:0,appended:0};" +
  "function isGroupChat(){try{var h=document.querySelector('#main header');if(h){" +
  "if(h.querySelector('[data-icon=\\\"default-group\\\"],[data-icon=\\\"group\\\"]'))return true;" +
  "var t=(h.innerText||'');if(/group info|info grup/i.test(t))return true;" +
  "if(h.querySelector('img[src*=\\\"g.us\\\"]'))return true}}catch(e){}return false}" +
  "function composerEl(){try{var ae=document.activeElement;if(ae&&ae.isContentEditable)return ae;" +
  "var q=document.querySelector('#main footer div[contenteditable=\\\"true\\\"]');return q||null}catch(e){return null}}" +
  "function textOf(el){try{return (el.innerText||el.textContent||'')}catch(e){return ''}}" +
  "function appendCode(el,code){try{var marker='/'+code;var t=textOf(el).trim();" +
  "if(!t)return false;" +
  "if(t.length>=marker.length&&t.slice(0-marker.length)===marker)return false;" +
  "el.focus();var sel=window.getSelection();var r=document.createRange();" +
  "r.selectNodeContents(el);r.collapse(false);sel.removeAllRanges();sel.addRange(r);" +
  "document.execCommand('insertText',false,' '+marker);STATE.last=Date.now();return true}catch(e){return false}}" +
  "function shouldAppend(){if(!CFG.enabled||!CFG.append)return false;if(!CFG.code)return false;" +
  "if(CFG.skipGroups&&isGroupChat())return false;return true}" +
  "function onKey(e){try{if(e.key!=='Enter'||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey)return;" +
  "if(!shouldAppend())return;var el=composerEl();if(!el)return;" +
  "if(appendCode(el,CFG.code))STATE.appended++}catch(err){}}" +
  "function onClick(e){try{if(!shouldAppend())return;var t=e.target;" +
  "var btn=t&&t.closest?t.closest('[data-testid=\\\"send\\\"],button[aria-label*=\\\"Send\\\"],button[aria-label*=\\\"Kirim\\\"],[data-icon=\\\"send\\\"]'):null;" +
  "if(!btn)return;var el=composerEl();if(!el)return;" +
  "if(appendCode(el,CFG.code))STATE.appended++}catch(err){}}" +
  "window.__WA_MULTI_INITIAL_ENGINE__={setCfg:function(c){try{CFG=Object.assign(CFG,c||{})}catch(e){}}," +
  "get:function(){return {enabled:!!CFG.enabled,code:CFG.code||'',name:CFG.name||''," +
  "isGroup:isGroupChat(),appended:STATE.appended,lastAppend:STATE.last,ts:Date.now()}}};" +
  "document.addEventListener('keydown',onKey,true);" +
  "document.addEventListener('click',onClick,true);" +
  "return 'installed'})()"

const UPDATER_OWNER = 'AdamRohdiHusni'
const UPDATER_REPO = 'wa-multi'

function sendToWin(channel, payload) {
  try {
    const w = BrowserWindow.getAllWindows()[0]
    if (w && !w.isDestroyed() && w.webContents) w.webContents.send(channel, payload)
  } catch (e) {}
}

function waAllViews() {
  try {
    const out = []
    if (views && typeof views.forEach === 'function') {
      views.forEach((v) => { try { if (v && v.webContents && !v.webContents.isDestroyed()) out.push(v) } catch (e) {} })
    } else if (views && typeof views === 'object') {
      for (const k of Object.keys(views)) { const v = views[k]; try { if (v && v.webContents) out.push(v) } catch (e) {} }
    }
    return out
  } catch (e) { return [] }
}

function persistPrefs() {
  try { if (typeof savePrefs === 'function') { savePrefs(); return } } catch (e) {}
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'prefs.json'), JSON.stringify(prefs, null, 2))
  } catch (e) {}
}

function initialCfgJSON() {
  try { return JSON.stringify(prefs.initial || {}) } catch (e) { return '{}' }
}

async function pushInitialConfig() {
  const js = 'window.__WA_MULTI_INITIAL_ENGINE__ && window.__WA_MULTI_INITIAL_ENGINE__.setCfg(' + initialCfgJSON() + ')'
  for (const v of waAllViews()) { try { await v.webContents.executeJavaScript(js) } catch (e) {} }
}

async function ensureInitialEngine() {
  try {
    const cfg = prefs.initial || {}
    if (!cfg.enabled) return
    for (const v of waAllViews()) {
      try {
        const engineReady = await v.webContents.executeJavaScript('!!(window.WPP && window.WPP.isInjected)').catch(() => false)
        if (!engineReady) continue
        const has = await v.webContents.executeJavaScript('!!window.__WA_MULTI_INITIAL_ENGINE__').catch(() => false)
        if (!has) await v.webContents.executeJavaScript(INITIAL_ENGINE).catch(() => {})
        await v.webContents.executeJavaScript('window.__WA_MULTI_INITIAL_ENGINE__ && window.__WA_MULTI_INITIAL_ENGINE__.setCfg(' + initialCfgJSON() + ')').catch(() => {})
      } catch (e) {}
    }
  } catch (e) {}
}

let initialTimer = null
function startInitialLoop() {
  if (initialTimer) return
  initialTimer = setInterval(async () => {
    try {
      const cfg = prefs.initial || {}
      if (!cfg.enabled) return
      await ensureInitialEngine()
      if (cfg.showBadge) {
        for (const v of waAllViews()) {
          const r = await v.webContents.executeJavaScript('window.__WA_MULTI_INITIAL_ENGINE__ && window.__WA_MULTI_INITIAL_ENGINE__.get()').catch(() => null)
          if (r) sendToWin('initial:attribution', r)
        }
      }
    } catch (e) {}
  }, 7000)
  try { if (initialTimer.unref) initialTimer.unref() } catch (e) {}
}

// Sembunyikan view WA saat dialog app dibuka (view = layer di atas renderer).
// Simpan status visible sebelumnya supaya pas ditutup balik persis seperti semula.
let initialOverlayPrev = null
function setInitialOverlay(open) {
  try {
    if (open) {
      initialOverlayPrev = []
      for (const [id, v] of viewsMapEntries()) {
        let vis = true
        try { if (typeof v.getVisible === 'function') vis = v.getVisible() } catch (e) {}
        initialOverlayPrev.push([id, vis])
        try { v.setVisible(false) } catch (e) {}
      }
    } else if (initialOverlayPrev) {
      for (const [id, vis] of initialOverlayPrev) {
        try { const v = mapGet(id); if (v) v.setVisible(vis) } catch (e) {}
      }
      initialOverlayPrev = null
    }
  } catch (e) {}
}

function viewsMapEntries() {
  try {
    if (views && typeof views.forEach === 'function') { const out = []; views.forEach((v, k) => out.push([k, v])); return out }
    if (views && typeof views === 'object') return Object.keys(views).map((k) => [k, views[k]])
  } catch (e) {}
  return []
}
function mapGet(id) {
  try {
    if (views && typeof views.get === 'function') return views.get(id)
    if (views && typeof views === 'object') return views[id]
  } catch (e) {}
  return null
}

let waUpdater = null
function initUpdater() {
  if (waUpdater) return waUpdater
  try {
    const eu = require('electron-updater')
    waUpdater = eu && eu.autoUpdater
    if (!waUpdater) throw new Error('autoUpdater tidak tersedia')
    try { waUpdater.autoDownload = true } catch (e) {}
    try { waUpdater.autoInstallOnAppQuit = true } catch (e) {}
    try { waUpdater.setFeedURL({ provider: 'github', owner: UPDATER_OWNER, repo: UPDATER_REPO }) } catch (e) {}
    waUpdater.on('checking-for-update', () => sendToWin('update:status', { state: 'checking' }))
    waUpdater.on('update-available', (i) => sendToWin('update:status', { state: 'available', version: (i && i.version) || '' }))
    waUpdater.on('update-not-available', () => sendToWin('update:status', { state: 'latest', version: app.getVersion() }))
    waUpdater.on('download-progress', (p) => sendToWin('update:status', { state: 'downloading', percent: Math.round((p && p.percent) || 0) }))
    waUpdater.on('update-downloaded', (i) => sendToWin('update:status', { state: 'ready', version: (i && i.version) || '' }))
    waUpdater.on('error', (e) => sendToWin('update:status', { state: 'error', message: String((e && e.message) || e) }))
  } catch (e) {
    sendToWin('update:status', { state: 'error', message: 'auto-update tidak tersedia' })
    waUpdater = null
  }
  return waUpdater
}

if (!prefs.initial) prefs.initial = { enabled: false, code: '', name: '', append: true, skipGroups: true, showBadge: true }
// ── END REGION A ──