// WA Multi v2.0 — Multi-account WhatsApp Web desktop shell + multi-account blast
// Architecture:
//   • Accounts are opened as WebContentsView, assigned to 1 of 2 stage slots
//   • Slot A = pinned personal account (always alive)  |  Slot B = office account
//   • Blast runs by injecting the wppconnect/wa-js engine into a logged-in WA Web page
//     (no second QR, no parallel session). Accounts are rotated ONE AT A TIME to keep RAM low.
const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, Menu, Tray, Notification, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const IS_DEV = !!process.env.WA_MULTI_DEV
const userDataDir = IS_DEV
  ? path.join(__dirname, 'dev-userdata')
  : path.join(app.getPath('userData'), 'data')
const SESSIONS_DIR = path.join(userDataDir, 'sessions')
const ACCOUNTS_FILE = path.join(userDataDir, 'accounts.json')
const PREFS_FILE = path.join(userDataDir, 'prefs.json')
const SCHEDULES_FILE = path.join(userDataDir, 'schedules.json')
const HISTORY_FILE = path.join(userDataDir, 'history.json')
const TMP_DIR = path.join(userDataDir, 'tmp')

app.commandLine.appendSwitch('disable-gpu') // lightweight on weak laptops
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
// keep background tabs REAL-TIME: stop Chromium from freezing/occlusion-throttling
// the stacked (non-front) WA view in full layout mode
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const WAJS_BUNDLE = fs.readFileSync(path.join(__dirname, 'vendor', 'wppconnect-wa.js'), 'utf8')

function ensureDirs () {
  for (const d of [userDataDir, SESSIONS_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true })
}
// the self-test must always start from a clean slate, otherwise leftovers from a
// previous run break the persistence assertions (counts, "removed" accounts, etc.)
if (process.env.WA_MULTI_SELFTEST) {
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch (_) {}
}
ensureDirs()

// ── Stores ────────────────────────────────────────────────────
function readJson (file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed
  } catch (_) { return fallback }
}
function writeJson (file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)) } catch (_) {}
}

let accounts = readJson(ACCOUNTS_FILE, [])
let prefs = readJson(PREFS_FILE, {})
let schedules = readJson(SCHEDULES_FILE, [])
let history = readJson(HISTORY_FILE, [])
if (!Array.isArray(accounts)) accounts = []
if (!Array.isArray(schedules)) schedules = []
if (!Array.isArray(history)) history = []

const saveAccounts = () => writeJson(ACCOUNTS_FILE, accounts)
const savePrefs = () => writeJson(PREFS_FILE, prefs)
const saveSchedules = () => writeJson(SCHEDULES_FILE, schedules)
const saveHistory = () => writeJson(HISTORY_FILE, history)

// prefs defaults
if (!prefs.tabMode) prefs.tabMode = 'dual'   // 'dual' = pinned + 1 office | 'solo' = pinned only
if (!prefs.layoutMode) prefs.layoutMode = 'full' // 'full' = tab-by-tab full screen (bg stays alive) | 'split' = kiri-kanan
if (!prefs.theme) prefs.theme = 'dark'
if (typeof prefs.dailyCap !== 'number') prefs.dailyCap = 40
if (!prefs.pinnedId) prefs.pinnedId = null
if (!prefs.pin2Id) prefs.pin2Id = null

// ── Main window ───────────────────────────────────────────────
let win = null
let tray = null

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: prefs.theme === 'light' ? '#ffffff' : '#0b141a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  Menu.setApplicationMenu(null)
  win.loadFile(path.join(__dirname, 'index.html'))
  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' })
  attachResizeHandler()

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // closing the window hides to tray when schedules are pending, else quits
  win.on('close', (e) => {
    const pending = schedules.some(s => s.status === 'pending')
    if (pending && !app.isQuitting) {
      e.preventDefault()
      win.hide()
      notifyTray('WA Multi masih jalan', 'Ada jadwal blast yang belum jalan. App disembunyikan ke tray.')
    }
  })
}

app.isQuitting = false
app.on('before-quit', () => { app.isQuitting = true })

app.whenReady().then(() => {
  createWindow()
  buildTray()
  startScheduleTicker()
  if (process.env.WA_MULTI_SELFTEST) runSelfTest()
})

app.on('window-all-closed', () => app.quit())
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else win.show() })

// ── Tray ──────────────────────────────────────────────────────
function trayIconPath () {
  const ico = path.join(__dirname, 'build', 'icon.ico')
  const png = path.join(__dirname, 'build', 'icon.png')
  if (process.platform === 'win32' && fs.existsSync(ico)) return ico
  return fs.existsSync(png) ? png : ico
}
function buildTray () {
  try {
    tray = new Tray(trayIconPath())
    tray.setToolTip('WA Multi')
    tray.on('click', () => { if (win) { win.show(); win.focus() } })
    refreshTrayMenu()
  } catch (_) { tray = null }
}
function refreshTrayMenu () {
  if (!tray) return
  const pending = schedules.filter(s => s.status === 'pending')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Buka WA Multi', click: () => { if (win) { win.show(); win.focus() } } },
    { type: 'separator' },
    { label: `Jadwal pending: ${pending.length}`, enabled: false },
    { type: 'separator' },
    { label: 'Keluar', click: () => { app.isQuitting = true; app.quit() } }
  ]))
}
function notifyTray (title, body) {
  try { new Notification({ title, body }).show() } catch (_) {}
}

// ── View registry & stage layout ──────────────────────────────
// slot 'a' = left (or full width in solo mode) | slot 'b' = right (dual mode only)
const views = new Map()        // accountId -> WebContentsView (alive)
const slotOf = new Map()       // accountId -> 'a' | 'b'
const engines = new Map()      // accountId -> { injected: bool, promise }
let uiTop = 88
let overlayOpen = false
let activeAccountId = null     // which alive view is shown on top (full layout) / focused

function stageRect () {
  if (!win) return { x: 0, y: 0, width: 0, height: 0 }
  const b = win.getContentBounds()
  return { x: 0, y: uiTop, width: b.width, height: Math.max(1, b.height - uiTop) }
}

function FULL () {
  const r = stageRect()
  return { x: 0, y: r.y, width: r.width, height: r.height }
}
const HIDDEN = { x: 0, y: 0, width: 0, height: 0 }

function viewBounds (accountId) {
  if (!win || overlayOpen) return HIDDEN
  const isSlot = slotOf.has(accountId)
  const isActive = accountId === activeAccountId
  // alive = pinned (slot) or the active transient tab; everything else hidden
  if (!isSlot && !isActive) return HIDDEN
  const r = stageRect()
  // split layout only applies in dual tab mode when two slots are actually occupied
  const s = slotOf.get(accountId)
  if (prefs.tabMode === 'dual' && prefs.layoutMode === 'split' && hasSlot('a') && hasSlot('b') && (s === 'a' || s === 'b')) {
    const half = Math.floor(r.width / 2)
    return s === 'a'
      ? { x: 0, y: r.y, width: half, height: r.height }
      : { x: half, y: r.y, width: r.width - half, height: r.height }
  }
  return FULL() // tab-by-tab: every alive view covers the full stage; z-order decides who is visible
}

// raise a view above the others (instant, no reload — the page never left memory)
function bringToFront (accountId) {
  const v = views.get(accountId)
  if (!v || !win) return
  try {
    win.contentView.removeChildView(v)
    win.contentView.addChildView(v)
    v.setBounds(viewBounds(accountId))
  } catch (_) {}
}

function hasSlot (slot) {
  for (const s of slotOf.values()) if (s === slot) return true
  return false
}

function layoutViews () {
  for (const [id, v] of views) {
    try { v.setBounds(viewBounds(id)) } catch (_) {}
  }
}

// ── Account engine runtime ────────────────────────────────────
function createView (accountId) {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:wa-' + accountId,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  view.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const u = details.url
    if (/google-analytics|googletagmanager|doubleclick|facebook\.net|scorecardresearch|quantserve/i.test(u)) {
      return cb({ cancel: true })
    }
    cb({ cancel: false })
  })
  // WA Web blocks the Electron UA ("works with Chrome 100+" page) → spoof standard Chrome
  view.webContents.setUserAgent(CHROME_UA)
  view.webContents.loadURL('https://web.whatsapp.com', { userAgent: CHROME_UA })
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  views.set(accountId, view)
  win.contentView.addChildView(view)
  view.setBounds(viewBounds(accountId))
  return view
}

function destroyView (accountId) {
  const view = views.get(accountId)
  if (!view) return
  try { win.contentView.removeChildView(view) } catch (_) {}
  try { view.webContents.close() } catch (_) {}
  views.delete(accountId)
  slotOf.delete(accountId)
  engines.delete(accountId)
  if (activeAccountId === accountId) {
    activeAccountId = null
    for (const id of views.keys()) {
      if (id === prefs.pinnedId) { activeAccountId = id; break }
    }
    if (!activeAccountId && views.size) activeAccountId = [...views.keys()][0]
  }
}

// Assign an account to a stage slot and make sure a view exists for it
function showInSlot (accountId, slot) {
  const acc = accounts.find(a => a.id === accountId)
  if (!acc) return { ok: false, error: 'akun tidak ada' }
  // free the target slot from whoever holds it
  for (const [id, s] of [...slotOf]) {
    if (s === slot && id !== accountId) {
      const other = accounts.find(a => a.id === id)
      const isPinned = prefs.pinnedId === id
      if (slot === 'a' && isPinned) return { ok: false, error: 'slot pribadi dikunci' }
      if (isPinned) { // pinned account can never leave slot a
        continue
      }
      slotOf.delete(id)
      // park it: destroy the view so we don't pay RAM for a hidden account
      destroyView(id)
      if (other) other.lastOpened = Date.now()
    }
  }
  if (!views.has(accountId)) createView(accountId)
  slotOf.set(accountId, slot)
  acc.lastOpened = Date.now()
  saveAccounts()
  layoutViews()
  activeAccountId = accountId
  bringToFront(accountId)
  notifyStateChanged()
  return { ok: true, slot }
}

// Non-pinned accounts live as the active transient tab (no slot).
// Only ONE transient stays alive: opening another parks the previous one.
// Pinned accounts (personal + pin2) are never evicted by transients.
function showTransient (accountId) {
  const acc = accounts.find(a => a.id === accountId)
  if (!acc) return { ok: false, error: 'akun tidak ada' }
  if (prefs.pinnedId === accountId) return showInSlot(accountId, 'a')
  if (prefs.pin2Id === accountId) return showInSlot(accountId, 'b')
  const worker = activeJob && activeJob.currentWorker
  for (const [id, s] of [...slotOf]) {
    if (s !== 'a' && s !== 'b' && id !== accountId) {
      if (id === worker) continue // blast worker stays alive until the job releases it
      slotOf.delete(id)
      destroyView(id) // park previous transient
    }
  }
  // a transient that is currently active but slot-less is also parked
  for (const id of [...views.keys()]) {
    if (id !== accountId && id !== prefs.pinnedId && id !== prefs.pin2Id && !slotOf.has(id) && id !== worker) {
      destroyView(id)
    }
  }
  if (!views.has(accountId)) createView(accountId)
  acc.lastOpened = Date.now()
  saveAccounts()
  layoutViews()
  activeAccountId = accountId
  bringToFront(accountId)
  notifyStateChanged()
  return { ok: true }
}

function openAccount (accountId) {
  const isPinned = prefs.pinnedId === accountId
  const isPin2 = prefs.pin2Id === accountId
  if (isPinned) return showInSlot(accountId, 'a')
  if (isPin2) return showInSlot(accountId, 'b')
  if (prefs.tabMode === 'solo') {
    // solo = "cuma pribadi". Opening another account implies 2-tab mode.
    prefs.tabMode = 'dual'
    savePrefs()
  }
  // dual mode: non-pinned account becomes the active tab (pins stay alive)
  return showTransient(accountId)
}

function parkAccount (accountId) {
  if (prefs.pinnedId === accountId) return { ok: false, error: 'akun pribadi gak bisa diparkir — lepas pin dulu' }
  if (prefs.pin2Id === accountId) return { ok: false, error: 'akun ini ke-pin — lepas pin dulu buat parkir' }
  destroyView(accountId)
  if (!activeAccountId && views.size) activeAccountId = [...views.keys()][0]
  if (activeAccountId) bringToFront(activeAccountId)
  notifyStateChanged()
  return { ok: true }
}

// ── Engine injection ──────────────────────────────────────────
async function ensureEngine (view, timeoutMs = 60000) {
  const wc = view.webContents
  const already = await wc.executeJavaScript('!!(window.WPP && window.WPP.isInjected)').catch(() => false)
  if (already) return { ok: true, injected: false }

  // wait for WA Web's webpack runtime to boot
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ready = await wc.executeJavaScript('!!(window.webpackChunkwhatsapp_webpack_modules || window.require)').catch(() => false)
    if (ready) break
    await wait(1000)
  }
  await wc.executeJavaScript(WAJS_BUNDLE).catch(() => {})
  // WA Web 2026 uses metro-style globals (__d/require); wa-js's meta loader
  // attaches a few seconds after the bundle executes → poll, don't sleep once.
  const t1 = Date.now()
  while (Date.now() - t1 < timeoutMs) {
    const ok = await wc.executeJavaScript('!!(window.WPP && window.WPP.isInjected)').catch(() => false)
    if (ok) return { ok: true, injected: true }
    await wait(1000)
  }
  return { ok: false, injected: true }
}

async function isAuthenticated (view) {
  // wa-js's isAuthenticated() returns a PROMISE — await it properly.
  // Before the engine is injected, fall back to DOM signals (QR page vs app shell).
  return view.webContents.executeJavaScript(`(async () => {
    try {
      if (window.WPP && window.WPP.conn && typeof window.WPP.conn.isAuthenticated === 'function') {
        return !!(await window.WPP.conn.isAuthenticated())
      }
      const qr = document.querySelector('div[data-ref], canvas[aria-label*="Scan"]')
      const shell = document.querySelector('#side, [data-testid="chat-list"], .app-wrapper-web.two')
      return !qr && !!shell
    } catch (e) { return false }
  })()`).catch(() => false)
}

async function waitAuthenticated (view, timeoutMs = 90000, abort = null, accountId = null, job = null) {
  const t0 = Date.now()
  let lastBeat = 0
  while (Date.now() - t0 < timeoutMs) {
    if (abort && abort()) return false
    if (await isAuthenticated(view)) return true
    if (job && accountId && Date.now() - lastBeat > 10000) {
      lastBeat = Date.now()
      const a = accounts.find(x => x.id === accountId)
      emitProgress({ phase: 'accountWait', jobId: job.id, accountId, name: a ? a.name : accountId, elapsedSec: Math.round((Date.now() - t0) / 1000) })
    }
    await wait(1500)
  }
  return false
}

// Normalize an Indonesian phone number to international form (62xxx)
function normalizePhone (phone) {
  let d = String(phone || '').replace(/[^0-9]/g, '')
  if (!d) return null
  if (d.startsWith('0')) d = '62' + d.slice(1)            // 08xx -> 628xx
  else if (d.startsWith('8') && d.length <= 13) d = '62' + d
  if (d.length < 8) return null
  return d
}

// Normalize a phone number to a WhatsApp JID
function toJid (phone) {
  const d = normalizePhone(phone)
  return d ? d + '@c.us' : null
}

async function fetchContacts (view) {
  await ensureEngine(view)
  const raw = await view.webContents.executeJavaScript(`(async () => {
    try {
      const list = await window.WPP.contact.list({ onlyMyContacts: true })
      return (list || []).map(c => ({
        id: (c.id && (c.id._serialized || c.id.user)) || null,
        name: c.name || c.pushname || c.shortName || c.formattedName || '',
        isMe: !!(c.isMe)
      })).filter(c => c.id && !c.isMe)
    } catch (e) { return { __err: String(e).slice(0,200) } }
  })()`).catch(e => ({ __err: String(e).slice(0, 200) }))
  if (raw && raw.__err) return { ok: false, error: raw.__err }
  return { ok: true, contacts: raw || [] }
}

async function fetchGroups (view) {
  await ensureEngine(view)
  const raw = await view.webContents.executeJavaScript(`(async () => {
    try {
      const list = await window.WPP.group.getAllGroups()
      return (list || []).map(g => ({
        id: (g.id && (g.id._serialized || g.id.user)) || null,
        name: g.name || g.formattedTitle || ''
      })).filter(g => g.id)
    } catch (e) { return { __err: String(e).slice(0,200) } }
  })()`).catch(e => ({ __err: String(e).slice(0, 200) }))
  if (raw && raw.__err) return { ok: false, error: raw.__err }
  return { ok: true, groups: raw || [] }
}

async function groupFromInvite (view, link) {
  await ensureEngine(view)
  const code = String(link || '').replace(/^.*chat\.whatsapp\.com\//i, '').replace(/[^A-Za-z0-9]/g, '')
  if (!code) return { ok: false, error: 'link undangan tidak valid' }
  const raw = await view.webContents.executeJavaScript(`(async () => {
    try {
      const info = await window.WPP.group.getGroupInfoFromInviteCode(${JSON.stringify(code)})
      const g = info && (info.groupMetadata || info)
      const id = g && g.id && (g.id._serialized || g.id.user)
      return { id: id || null, name: (g && (g.name || g.subject)) || '' }
    } catch (e) { return { __err: String(e).slice(0,200) } }
  })()`).catch(e => ({ __err: String(e).slice(0, 200) }))
  if (raw && raw.__err) return { ok: false, error: raw.__err }
  if (!raw || !raw.id) return { ok: false, error: 'grup tidak ketemu' }
  return { ok: true, group: raw }
}

const SEND_TIMEOUT_MS = Math.max(10000, parseInt(process.env.WA_MULTI_SEND_TIMEOUT, 10) || 60000)

function withTimeout (p, ms, errMsg) {
  return Promise.race([
    Promise.resolve(p),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, error: errMsg }), ms))
  ])
}

async function sendText (view, jid, text) {
  const res = await withTimeout(view.webContents.executeJavaScript(`(async () => {
    try {
      await window.WPP.chat.sendTextMessage(${JSON.stringify(jid)}, ${JSON.stringify(text)}, { createChat: true, waitForAck: false })
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0,200) } }
  })()`).catch(e => ({ ok: false, error: String(e).slice(0, 200) })), SEND_TIMEOUT_MS, 'timeout: WA gak selesai kirim dalam 60 dtk')
  return res || { ok: false, error: 'unknown' }
}

async function sendFile (view, jid, file, caption) {
  const res = await withTimeout(view.webContents.executeJavaScript(`(async () => {
    try {
      const opts = { createChat: true, waitForAck: false, type: 'auto-detect', filename: ${JSON.stringify(file.filename || 'file')} }
      if (${JSON.stringify(caption || '')}) opts.caption = ${JSON.stringify(caption || '')}
      await window.WPP.chat.sendFileMessage(${JSON.stringify(jid)}, ${JSON.stringify(file.dataUrl)}, opts)
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0,200) } }
  })()`).catch(e => ({ ok: false, error: String(e).slice(0, 200) })), Math.max(SEND_TIMEOUT_MS, 120000), 'timeout: upload gak selesai dalam 120 dtk')
  return res || { ok: false, error: 'unknown' }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Resolve per-target placeholders. {custom} falls back to the blast-level custom
// text, so you can either give every target its own value (CSV column) or one
// value for all (the "custom" field in the UI).
function resolveMessage (template, target, fallbackCustom) {
  const custom = (target && target.custom) || fallbackCustom || ''
  return String(template || '')
    .replace(/\{nama\}/gi, (target && target.name) || '')
    .replace(/\{name\}/gi, (target && target.name) || '')
    .replace(/\{nomor\}/gi, (target && (target.phone || target.jid)) || '')
    .replace(/\{phone\}/gi, (target && (target.phone || target.jid)) || '')
    .replace(/\{custom\}/gi, custom)
    .replace(/\{kustom\}/gi, custom)
}

// ── Daily send counters (per account) ─────────────────────────
function todayKey () { return new Date().toISOString().slice(0, 10) }
function sentToday (accountId) {
  const d = todayKey()
  return history.filter(h => h.date === d && h.accountId === accountId && h.status === 'sent').length
}

// ── Blast job runner ──────────────────────────────────────────
let activeJob = null
let jobSeq = 0

function emitProgress (payload) {
  try { win.webContents.send('wa-multi:blastProgress', payload) } catch (_) {}
}

// Acquire a ready-to-send view for an account: reuse a live view if present,
// otherwise spin up a temporary one (and tear it down afterwards).
async function acquireWorker (accountId, job = null) {
  const existing = views.get(accountId)
  const temp = !existing
  const view = existing || createView(accountId)
  if (temp) { slotOf.delete(accountId); view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) }
  const abort = () => !!job && (job.stopAll || (job.stopped && job.stopped.has(accountId)))
  // inject engine FIRST — wa-js loads fine on the QR page (webpack already booted),
  // and once injected we get the REAL promise-based auth signal.
  await ensureEngine(view, 45000)
  const authTimeout = Math.max(5000, parseInt(process.env.WA_MULTI_AUTH_TIMEOUT, 10) || 90000)
  const auth = await waitAuthenticated(view, authTimeout, abort, accountId, job)
  if (!auth) {
    if (temp) destroyView(accountId)
    return { ok: false, error: abort() ? 'dihentikan' : 'akun belum login / belum siap (cek QR di tab akun itu)', temp }
  }
  const eng = await ensureEngine(view, 60000)
  if (!eng.ok) {
    if (temp) destroyView(accountId)
    return { ok: false, error: 'gagal inject mesin blast', temp }
  }
  return { ok: true, view, temp }
}
function releaseWorker (accountId, temp) {
  if (temp) destroyView(accountId)
}

// Round-robin split: every target handled by exactly one account
function splitTargets (targets, accountIds) {
  const buckets = new Map(accountIds.map(id => [id, []]))
  targets.forEach((t, i) => buckets.get(accountIds[i % accountIds.length]).push(t))
  return buckets
}

async function interruptibleWait (ms, job, accountId) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (job.stopAll || job.stopped.has(accountId)) return
    await wait(500)
  }
}

async function runBlastJob (job) {
  const startedAt = Date.now()
  const accountIds = job.accounts.filter(id => accounts.some(a => a.id === id))
  if (!accountIds.length) { finishJob(job, 'failed', 'tidak ada akun terpilih'); return }
  if (!job.targets.length) { finishJob(job, 'failed', 'tidak ada target'); return }

  const buckets = job.mode === 'all'
    ? new Map(accountIds.map(id => [id, job.targets.slice()]))
    : splitTargets(job.targets, accountIds)

  emitProgress({
    phase: 'start', jobId: job.id, kind: job.kind, total: job.targets.length,
    accounts: accountIds.map(id => {
      const a = accounts.find(x => x.id === id)
      return { id, name: a ? a.name : id, total: buckets.get(id).length, sent: 0, failed: 0, status: 'nunggu' }
    })
  })

  for (const accountId of accountIds) {
    if (activeJob !== job || job.stopAll) break
    const acc = accounts.find(a => a.id === accountId)
    const accName = acc ? acc.name : accountId
    const slice = buckets.get(accountId)

    emitProgress({ phase: 'accountStart', jobId: job.id, accountId, name: accName, total: slice.length, status: 'nyalain' })

    const w = await acquireWorker(accountId, job)
    if (!w.ok) {
      emitProgress({ phase: 'accountError', jobId: job.id, accountId, name: accName, error: w.error })
      slice.forEach(t => recordHistory(job, accountId, accName, t, 'failed', w.error))
      emitProgress({ phase: 'accountDone', jobId: job.id, accountId, name: accName, sent: 0, failed: slice.length, status: 'gagal: ' + w.error })
      continue
    }
    job.currentWorker = accountId

    let sent = 0, failed = 0
    for (let i = 0; i < slice.length; i++) {
      if (activeJob !== job || job.stopAll || job.stopped.has(accountId)) break
      const t = slice[i]

      // daily cap guard — skip remaining targets if the account hit its limit
      if (prefs.dailyCap > 0 && sentToday(accountId) >= prefs.dailyCap) {
        emitProgress({ phase: 'accountError', jobId: job.id, accountId, name: accName, error: `batas harian ${prefs.dailyCap} pesan tercapai` })
        break
      }

      const jid = job.kind === 'group' ? t.jid : (t.jid || toJid(t.phone))
      const text = resolveMessage(job.message, t, job.custom)
      let res
      if (!jid) res = { ok: false, error: 'nomor tidak valid' }
      else if (job.media) res = await sendFile(w.view, jid, job.media, text)
      else res = await sendText(w.view, jid, text)

      if (res.ok) {
        sent++
        recordHistory(job, accountId, accName, t, 'sent', null)
      } else {
        failed++
        recordHistory(job, accountId, accName, t, 'failed', res.error)
      }
      emitProgress({
        phase: 'progress', jobId: job.id, accountId, name: accName,
        index: i + 1, total: slice.length, target: t.name || t.phone || t.jid, custom: t.custom || null,
        status: res.ok ? 'sent' : 'failed', error: res.error || null, sent, failed
      })

      if (i < slice.length - 1 && !job.stopAll && !job.stopped.has(accountId)) {
        await interruptibleWait(Math.max(5, job.delaySec || 30) * 1000, job, accountId)
      }
    }

    releaseWorker(accountId, w.temp)
    if (job.currentWorker === accountId) job.currentWorker = null
    emitProgress({ phase: 'accountDone', jobId: job.id, accountId, name: accName, sent, failed, status: 'selesai' })
  }

  const status = job.stopAll ? 'stopped' : 'done'
  finishJob(job, status, null, startedAt)
}

function recordHistory (job, accountId, accName, target, status, error) {
  history.push({
    date: todayKey(),
    ts: Date.now(),
    jobId: job.id,
    kind: job.kind,
    accountId,
    accountName: accName,
    target: target.name || target.phone || target.jid,
    jid: target.jid || toJid(target.phone) || null,
    custom: target.custom || null,
    status,
    error: error || null
  })
  if (history.length > 20000) history = history.slice(-15000)
  saveHistory()
}

function finishJob (job, status, error, startedAt) {
  job.status = status
  job.finishedAt = Date.now()
  job.error = error || null
  if (job.scheduleId) {
    const s = schedules.find(x => x.id === job.scheduleId)
    if (s) { s.status = status === 'done' ? 'done' : (status === 'failed' ? 'failed' : 'cancelled'); s.ranAt = Date.now(); saveSchedules(); refreshTrayMenu() }
  }
  const totalSent = history.filter(h => h.jobId === job.id && h.status === 'sent').length
  const totalFailed = history.filter(h => h.jobId === job.id && h.status === 'failed').length
  emitProgress({ phase: 'done', jobId: job.id, status, error: error || null, sent: totalSent, failed: totalFailed, elapsedMs: startedAt ? Date.now() - startedAt : null })
  notifyTray('Blast selesai', `${job.label || job.kind}: ${totalSent} terkirim, ${totalFailed} gagal`)
  if (activeJob === job) activeJob = null
}

// ── Schedule ticker ───────────────────────────────────────────
const SKIP_GRACE_MS = 5 * 60 * 1000 // if we're more than 5 min late, the laptop was off → skip
function startScheduleTicker () {
  setInterval(() => {
    const now = Date.now()
    for (const s of schedules) {
      if (s.status !== 'pending') continue
      if (s.when > now) continue
      if (now - s.when > SKIP_GRACE_MS) {
        s.status = 'skipped'
        s.note = 'laptop mati / app gak jalan pas waktunya'
        saveSchedules(); refreshTrayMenu()
        emitProgress({ phase: 'scheduleSkipped', scheduleId: s.id, label: s.label })
        continue
      }
      if (activeJob) continue // wait for the running job to finish
      s.status = 'running'
      saveSchedules(); refreshTrayMenu()
      startBlastFromSchedule(s)
    }
  }, 30000)
}

function startBlastFromSchedule (s) {
  const job = {
    id: 'job-' + (++jobSeq) + '-' + Date.now().toString(36),
    scheduleId: s.id,
    label: s.label,
    kind: s.kind,
    targets: s.targets,
    message: s.message,
    custom: s.custom || '',
    media: s.media || null,
    accounts: s.accounts,
    delaySec: s.delaySec,
    mode: s.mode,
    stopAll: false,
    stopped: new Set(),
    status: 'running'
  }
  activeJob = job
  runBlastJob(job).catch(e => finishJob(job, 'failed', String(e).slice(0, 200)))
}

// ── IPC ───────────────────────────────────────────────────────
function notifyStateChanged () {
  try { win.webContents.send('wa-multi:stateChanged') } catch (_) {}
}

ipcMain.handle('wa-multi:getState', () => ({
  accounts: accounts.map(a => ({
    id: a.id, name: a.name, color: a.color || null,
    lastOpened: a.lastOpened || null,
    isPinned: prefs.pinnedId === a.id,
    slot: slotOf.get(a.id) || null,
    alive: views.has(a.id),
    sentToday: sentToday(a.id)
  })),
  pinnedId: prefs.pinnedId,
  pin2Id: prefs.pin2Id || null,
  tabMode: prefs.tabMode,
  layoutMode: prefs.layoutMode,
  activeAccountId,
  dailyCap: prefs.dailyCap,
  theme: prefs.theme,
  schedules: schedules.map(s => ({
    id: s.id, label: s.label, kind: s.kind, when: s.when, status: s.status,
    accountIds: s.accounts, targetCount: s.targets.length, note: s.note || null
  })),
  blasting: !!activeJob,
  history: history.slice(-50).reverse()
}))

ipcMain.handle('wa-multi:addAccount', (e, name) => {
  const id = 'acc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const palette = ['#25d366', '#34b7f1', '#f15f6d', '#f2a33c', '#a78bfa', '#2dd4bf']
  const color = palette[accounts.length % palette.length]
  accounts.push({ id, name: String(name || ('Akun ' + (accounts.length + 1))).trim(), color })
  saveAccounts()
  notifyStateChanged()
  return { ok: true, id }
})

ipcMain.handle('wa-multi:renameAccount', (e, { id, name }) => {
  const a = accounts.find(x => x.id === id)
  if (a && name) { a.name = String(name).trim(); saveAccounts(); notifyStateChanged() }
  return { ok: true }
})

ipcMain.handle('wa-multi:removeAccount', (e, id) => {
  destroyView(id)
  accounts = accounts.filter(a => a.id !== id)
  if (prefs.pinnedId === id) prefs.pinnedId = null
  if (prefs.pin2Id === id) { prefs.pin2Id = null; slotOf.delete(id) }
  saveAccounts(); savePrefs()
  try { fs.rmSync(path.join(SESSIONS_DIR, id), { recursive: true, force: true }) } catch (_) {}
  try { fs.rmSync(path.join(app.getPath('userData'), 'Partitions', 'wa-' + id), { recursive: true, force: true }) } catch (_) {}
  notifyStateChanged()
  return { ok: true }
})

ipcMain.handle('wa-multi:openAccount', (e, id) => openAccount(id))
ipcMain.handle('wa-multi:parkAccount', (e, id) => parkAccount(id))

// Pin = the account stays ALIVE in the background (max 2: personal slot a +
// second pin slot b). Pinning the account that already holds the target slot
// is a no-op. Un-pin frees its slot (parks it).
ipcMain.handle('wa-multi:setPinned', (e, arg) => {
  const { id, on } = typeof arg === 'string' ? { id: arg, on: true } : (arg || {})
  const a = accounts.find(x => x.id === id)
  if (!a) return { ok: false, error: 'akun tidak ada' }
  const isPersonal = prefs.pinnedId === id
  const isPin2 = prefs.pin2Id === id

  if (on === false) {
    // unpin
    if (isPersonal) {
      prefs.pinnedId = null
    } else if (isPin2) {
      prefs.pin2Id = null
      slotOf.delete(id)
      destroyView(id)
      if (activeAccountId === id) {
        activeAccountId = views.size ? [...views.keys()][0] : null
        if (activeAccountId) bringToFront(activeAccountId)
      }
    } else {
      return { ok: false, error: 'akun ini gak ke-pin' }
    }
    savePrefs(); layoutViews(); notifyStateChanged()
    return { ok: true }
  }

  // pin ON
  if (isPersonal) return { ok: true } // already the personal pin
  if (isPin2) return { ok: true }    // already the second pin
  if (!prefs.pinnedId) {
    prefs.pinnedId = id
    savePrefs()
    showInSlot(id, 'a')
    notifyStateChanged()
    return { ok: true }
  }
  if (!prefs.pin2Id) {
    prefs.pin2Id = id
    savePrefs()
    showInSlot(id, 'b')
    notifyStateChanged()
    return { ok: true }
  }
  return { ok: false, error: 'maksimal 2 pin — lepas salah satu pin dulu (klik kanan tab → lepas pin)' }
})

ipcMain.handle('wa-multi:setTabMode', (e, mode) => {
  prefs.tabMode = mode === 'solo' ? 'solo' : 'dual'
  savePrefs()
  if (prefs.tabMode === 'solo') {
    // park everything except pinned accounts (personal + pin2)
    for (const id of [...views.keys()]) {
      if (id !== prefs.pinnedId && id !== prefs.pin2Id) destroyView(id)
    }
    if (!activeAccountId && prefs.pinnedId && views.has(prefs.pinnedId)) activeAccountId = prefs.pinnedId
  }
  layoutViews()
  if (activeAccountId) bringToFront(activeAccountId)
  notifyStateChanged()
  return { ok: true, tabMode: prefs.tabMode }
})

ipcMain.handle('wa-multi:setTheme', (e, theme) => {
  prefs.theme = theme === 'light' ? 'light' : 'dark'
  savePrefs()
  nativeTheme.themeSource = prefs.theme
  notifyStateChanged()
  return { ok: true, theme: prefs.theme }
})

ipcMain.handle('wa-multi:setDailyCap', (e, cap) => {
  prefs.dailyCap = Math.max(0, Number(cap) || 0)
  savePrefs(); notifyStateChanged()
  return { ok: true, dailyCap: prefs.dailyCap }
})

ipcMain.handle('wa-multi:setLayoutMode', (e, mode) => {
  prefs.layoutMode = mode === 'split' ? 'split' : 'full'
  savePrefs()
  layoutViews()
  if (prefs.layoutMode === 'full' && activeAccountId) bringToFront(activeAccountId)
  notifyStateChanged()
  return { ok: true, layoutMode: prefs.layoutMode }
})

ipcMain.handle('wa-multi:activateAccount', (e, id) => {
  if (!views.has(id)) return { ok: false, error: 'tab belum nyala' }
  activeAccountId = id
  bringToFront(id)
  notifyStateChanged()
  return { ok: true }
})

ipcMain.handle('wa-multi:setUITop', (e, top) => {
  uiTop = Number(top) || 88
  layoutViews()
  return { ok: true }
})

ipcMain.handle('wa-multi:setOverlayOpen', (e, open) => {
  overlayOpen = !!open
  layoutViews()
  return { ok: true }
})

// ── file pickers (CSV contacts + media) ───────────────────────
ipcMain.handle('wa-multi:pickCsv', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Pilih file kontak (CSV)',
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
  const file = res.filePaths[0]
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { return { ok: false, error: 'gagal baca file' } }
  const rows = parseCsv(text)
  if (!rows.length) return { ok: false, error: 'file kosong / format gak kebaca' }
  return { ok: true, file: path.basename(file), rows, headers: Object.keys(rows[0]) }
})

ipcMain.handle('wa-multi:pickMedia', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Pilih gambar / file',
    filters: [{ name: 'Gambar & Dokumen', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp4', 'docx', 'xlsx'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
  const file = res.filePaths[0]
  const buf = fs.readFileSync(file)
  const ext = path.extname(file).slice(1).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  return {
    ok: true,
    media: {
      filename: path.basename(file),
      mimetype: mime,
      size: buf.length,
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`
    }
  }
})

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', mp4: 'video/mp4', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

// Minimal robust CSV parser (handles quotes, commas, semicolons, CRLF)
function parseCsv (text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
  const splitLine = (line) => {
    const out = []; let cur = ''; let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === delim) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }
  const header = splitLine(lines[0]).map(h => h.toLowerCase())
  const hasHeader = header.some(h => /nama|name|phone|nomor|no_?hp|telepon|whatsapp|wa/.test(h))
  const idxPhone = hasHeader ? header.findIndex(h => /phone|nomor|no_?hp|telepon|whatsapp|wa|hp/.test(h)) : -1
  const idxName = hasHeader ? header.findIndex(h => /nama|name|kreator|creator/.test(h)) : -1
  // {custom} column: anything the sender wants to inject per target
  // (link affiliate, kode voucher, catatan pribadi, dst.)
  const idxCustom = hasHeader ? header.findIndex(h => /custom|kustom|catatan|note|pesan|link|aff|voucher|kode/.test(h)) : -1
  const body = hasHeader ? lines.slice(1) : lines
  const rows = []
  for (const line of body) {
    const cells = splitLine(line)
    let phone = idxPhone >= 0 ? cells[idxPhone] : cells.find(c => /[0-9]{8,}/.test(c.replace(/[^0-9]/g, '')))
    let name = idxName >= 0 ? cells[idxName] : (cells.find(c => c !== phone) || '')
    if (!phone) continue
    const digits = normalizePhone(phone)
    if (!digits) continue
    const custom = idxCustom >= 0 ? String(cells[idxCustom] || '').trim() : ''
    rows.push({ name: String(name || '').trim() || digits, phone: digits, custom })
  }
  return rows
}

ipcMain.handle('wa-multi:fetchContacts', async (e, accountId) => {
  const w = await getFetchView(accountId)
  if (!w.ok) return w
  const r = await fetchContacts(w.view)
  releaseWorker(accountId, w.temp)
  return r
})

ipcMain.handle('wa-multi:fetchGroups', async (e, accountId) => {
  const w = await getFetchView(accountId)
  if (!w.ok) return w
  const r = await fetchGroups(w.view)
  releaseWorker(accountId, w.temp)
  return r
})

ipcMain.handle('wa-multi:groupFromInvite', async (e, { accountId, link }) => {
  const w = await getFetchView(accountId)
  if (!w.ok) return w
  const r = await groupFromInvite(w.view, link)
  releaseWorker(accountId, w.temp)
  return r
})

// For contact/group fetching we only need an injected page — the account can
// even be mid-login. No auth wait, so it never blocks; 10-min safety timeout.
async function getFetchView (accountId) {
  const existing = views.get(accountId)
  const temp = !existing
  const view = existing || createView(accountId)
  if (temp) { slotOf.delete(accountId); view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) }
  const eng = await withTimeout(ensureEngine(view, 45000), 120000, 'injeksi mesin lama, coba lagi')
  if (!eng || !eng.ok) {
    if (temp) destroyView(accountId)
    return { ok: false, error: (eng && eng.error) || 'gagal inject mesin blast' }
  }
  return { ok: true, view, temp }
}

// ── blast start / stop ────────────────────────────────────────
ipcMain.handle('wa-multi:startBlast', async (e, cfg) => {
  if (activeJob) return { ok: false, error: 'masih ada blast yang jalan' }
  const targets = (cfg.targets || []).map(t => ({
    jid: t.jid || null,
    phone: t.phone || null,
    name: t.name || t.phone || t.jid || '',
    custom: t.custom || ''
  })).filter(t => t.jid || t.phone)
  if (!targets.length) return { ok: false, error: 'target kosong' }
  if (!cfg.accounts || !cfg.accounts.length) return { ok: false, error: 'pilih minimal 1 akun' }
  if (!cfg.message && !cfg.media) return { ok: false, error: 'pesan / media kosong' }

  const job = {
    id: 'job-' + (++jobSeq) + '-' + Date.now().toString(36),
    label: cfg.label || (cfg.kind === 'group' ? 'Blast Grup' : 'Blast Personal'),
    kind: cfg.kind === 'group' ? 'group' : 'personal',
    targets,
    message: String(cfg.message || ''),
    custom: String(cfg.custom || ''),
    media: cfg.media || null,
    accounts: cfg.accounts,
    delaySec: Math.max(5, Number(cfg.delaySec) || 30),
    mode: cfg.mode === 'all' ? 'all' : 'split',
    stopAll: false,
    stopped: new Set(),
    status: 'running'
  }
  activeJob = job
  runBlastJob(job).catch(e => finishJob(job, 'failed', String(e).slice(0, 200)))
  return { ok: true, jobId: job.id }
})

ipcMain.handle('wa-multi:stopBlast', (e, accountId) => {
  if (!activeJob) return { ok: false, error: 'gak ada blast jalan' }
  if (accountId) activeJob.stopped.add(accountId)
  else activeJob.stopAll = true
  return { ok: true }
})

// ── schedules ─────────────────────────────────────────────────
ipcMain.handle('wa-multi:addSchedule', (e, cfg) => {
  const when = Number(cfg.when)
  if (!when || when < Date.now() - 60000) return { ok: false, error: 'waktu jadwal tidak valid' }
  const s = {
    id: 'sch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    label: cfg.label || (cfg.kind === 'group' ? 'Blast Grup' : 'Blast Personal'),
    kind: cfg.kind === 'group' ? 'group' : 'personal',
    when,
    targets: (cfg.targets || []).map(t => ({ jid: t.jid || null, phone: t.phone || null, name: t.name || t.phone || t.jid || '', custom: t.custom || '' })).filter(t => t.jid || t.phone),
    message: String(cfg.message || ''),
    custom: String(cfg.custom || ''),
    media: cfg.media || null,
    accounts: cfg.accounts || [],
    delaySec: Math.max(5, Number(cfg.delaySec) || 30),
    mode: cfg.mode === 'all' ? 'all' : 'split',
    status: 'pending',
    createdAt: Date.now()
  }
  if (!s.targets.length) return { ok: false, error: 'target kosong' }
  if (!s.accounts.length) return { ok: false, error: 'pilih minimal 1 akun' }
  schedules.push(s)
  saveSchedules(); refreshTrayMenu(); notifyStateChanged()
  return { ok: true, id: s.id }
})

ipcMain.handle('wa-multi:cancelSchedule', (e, id) => {
  const s = schedules.find(x => x.id === id)
  if (s && s.status === 'pending') { s.status = 'cancelled'; saveSchedules(); refreshTrayMenu(); notifyStateChanged() }
  return { ok: true }
})

ipcMain.handle('wa-multi:deleteSchedule', (e, id) => {
  schedules = schedules.filter(x => x.id !== id)
  saveSchedules(); refreshTrayMenu(); notifyStateChanged()
  return { ok: true }
})

ipcMain.handle('wa-multi:clearHistory', () => {
  history = []
  saveHistory(); notifyStateChanged()
  return { ok: true }
})

// ── resize handling ───────────────────────────────────────────
function attachResizeHandler () {
  if (!win) return
  win.removeAllListeners('resize')
  win.on('resize', () => layoutViews())
  win.on('maximize', () => layoutViews())
  win.on('unmaximize', () => layoutViews())
  win.on('enter-full-screen', () => layoutViews())
  win.on('leave-full-screen', () => layoutViews())
}

// self-heal bounds + forward unread badge from the pinned/live view title
setInterval(() => {
  if (!win || win.isDestroyed()) return
  layoutViews()
  for (const [id, view] of views) {
    if (!view.webContents || view.webContents.isDestroyed()) continue
    const title = view.webContents.getTitle()
    if (!title) continue
    const m = title.match(/^\((\d+)\)/)
    win.webContents.send('wa-multi:unread', { accountId: id, unread: m ? parseInt(m[1], 10) : 0 })
  }
}, 4000)

// ── Test hook (only when explicitly enabled) ──────────────────
// lets a probe replace the WA page with a mock so the whole blast pipeline
// (rotation, placeholders, delay, daily cap, history) can be verified without
// a real logged-in WhatsApp session.
if (process.env.WA_MULTI_TESTHOOK) {
  global.__wa = {
    get views () { return views },
    get slotOf () { return slotOf },
    get accounts () { return accounts },
    get history () { return history },
    get prefs () { return prefs },
    get activeJob () { return activeJob },
    set accounts (v) { accounts = v },
    resolveMessage,
    normalizePhone,
    splitTargets,
    toJid,
    sentToday,
    recordHistory,
    saveAccounts,
    saveHistory
  }
}

// ── Self-test harness ─────────────────────────────────────────
function runSelfTest () {
  const results = []
  const check = (name, cond, extra) => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(400)
      const js = (code) => win.webContents.executeJavaScript(code)

      // 1. bridge + theme
      check('preload bridge exposed', (await js('typeof window.waMulti === "object"')) === true)
      check('default theme is dark', (await js('document.documentElement.getAttribute("data-theme")')) === 'dark')

      // 2. views / tabs
      check('tab bar rendered', (await js('!!document.getElementById("tabbar")')) === true)
      const addA = await js('window.waMulti.addAccount("Pribadi")')
      const addB = await js('window.waMulti.addAccount("Sweety 1")')
      check('addAccount returns id', !!(addA && addA.id) && !!(addB && addB.id))
      check('accounts persisted', JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')).length === 2)

      // 3. pin
      await js(`window.waMulti.setPinned("${addA.id}")`)
      let st = await js('window.waMulti.getState()')
      check('pinned account flagged', st.pinnedId === addA.id, st.pinnedId)
      await js(`window.waMulti.openAccount("${addA.id}")`)
      await wait(700)
      check('pinned opens in slot a', slotOf.get(addA.id) === 'a', String(slotOf.get(addA.id)))
      check('pinned account has a live view', views.has(addA.id) === true)

      // 4. dual mode: office opens as the active tab; personal pin stays alive
      await js(`window.waMulti.openAccount("${addB.id}")`)
      await wait(700)
      check('office becomes active tab (no slot needed)', slotOf.get(addB.id) == null && activeAccountId === addB.id, `slot=${String(slotOf.get(addB.id))} active=${String(activeAccountId)}`)
      check('personal pin stays alive in background', views.has(addA.id) === true)
      check('max 2 live views (pin + active tab)', views.size === 2, `n=${views.size}`)

      // 4b. DEFAULT layout = full screen tab-by-tab (user requirement: no forced split)
      const baFull = views.get(addA.id).getBounds()
      const bbFull = views.get(addB.id).getBounds()
      check('default layout is full', prefs.layoutMode === 'full', String(prefs.layoutMode))
      check('full layout: no split (both full width)',
        baFull.width > 1000 && bbFull.width > 1000 && baFull.x === 0 && bbFull.x === 0,
        `a=${baFull.width}@${baFull.x} b=${bbFull.width}@${bbFull.x}`)
      check('newly opened account becomes active', activeAccountId === addB.id, String(activeAccountId))

      // 4c. background tab STAYS ALIVE and is NOT reloaded when switching (instant switch)
      await views.get(addA.id).webContents.executeJavaScript('window.__keep = 4242')
      await js(`window.waMulti.activateAccount("${addA.id}")`)
      await wait(400)
      check('activateAccount sets active', activeAccountId === addA.id, String(activeAccountId))
      check('background view stays alive after switch', views.has(addB.id) === true)
      check('background page not reloaded (marker intact)',
        (await views.get(addA.id).webContents.executeJavaScript('window.__keep')) === 4242)
      // active view must be the topmost child so it is actually visible
      const order = win.contentView.children.map(c => [...views.entries()].find(([, v]) => v === c)?.[0] || null)
      check('active view is on top of the stack', order[order.length - 1] === addA.id, JSON.stringify(order))

      // 4e. second pin: stays alive in slot b; max 2 pins enforced
      const pinB = await js(`window.waMulti.setPinned("${addB.id}", true)`)
      check('second pin accepted', pinB.ok === true, JSON.stringify(pinB))
      await wait(500)
      check('pin2 lives in slot b', slotOf.get(addB.id) === 'b', String(slotOf.get(addB.id)))
      check('pin2 stays alive', views.has(addB.id) === true)
      const addC = await js('window.waMulti.addAccount("Toko C")')
      const pinC = await js(`window.waMulti.setPinned("${addC.id}", true)`)
      check('third pin rejected (max 2)', pinC.ok === false, JSON.stringify(pinC))
      const unpinB = await js(`window.waMulti.setPinned("${addB.id}", false)`)
      check('unpin frees slot b', unpinB.ok === true && slotOf.get(addB.id) == null && !views.has(addB.id), JSON.stringify({ slot: String(slotOf.get(addB.id)), alive: views.has(addB.id) }))
      const repinB = await js(`window.waMulti.setPinned("${addB.id}", true)`)
      check('re-pin after unpin works', repinB.ok === true && views.has(addB.id) === true)

      // 4d. split layout is an OPTION (both pins alive → side-by-side)
      await js('window.waMulti.setLayoutMode("split")')
      await wait(400)
      const bs1 = views.get(addA.id).getBounds()
      const bs2 = views.get(addB.id).getBounds()
      check('split layout: side by side', bs1.width > 100 && bs2.width > 100 && bs2.x >= bs1.width - 2, `a=${bs1.width} b.x=${bs2.x}`)
      await js('window.waMulti.setLayoutMode("full")')
      await wait(300)
      check('layout mode persisted', JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).layoutMode === 'full')

      // 5. solo mode parks the office account
      await js('window.waMulti.setTabMode("solo")')
      await wait(400)
      check('solo mode keeps both pins alive', views.has(addA.id) && views.has(addB.id), `n=${views.size}`)
      check('solo keeps personal alive', views.has(addA.id))
      const bSolo = views.get(addA.id).getBounds()
      check('solo gives pinned full width', bSolo.width > 1000, JSON.stringify(bSolo))
      await js('window.waMulti.setTabMode("dual")')
      await wait(300)
      check('tabMode persisted', JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).tabMode === 'dual')

      // 6. overlay hides views (WebContentsView paints above HTML)
      await js('window.waMulti.setOverlayOpen(true)')
      await wait(250)
      check('overlay hides views', [...views.values()].every(v => v.getBounds().width === 0))
      await js('window.waMulti.setOverlayOpen(false)')
      await wait(250)
      check('overlay close restores views', [...views.values()].every(v => v.getBounds().width > 100))

      // 7. park
      const parkPin2 = await js(`window.waMulti.parkAccount("${addB.id}")`)
      check('pin2 cannot be parked directly', parkPin2.ok === false, JSON.stringify(parkPin2))
      await js(`window.waMulti.setPinned("${addB.id}", false)`)
      await wait(300)
      await js(`window.waMulti.openAccount("${addB.id}")`)
      await wait(500)
      await js(`window.waMulti.parkAccount("${addB.id}")`)
      check('parkAccount destroys parked view', !views.has(addB.id))
      const parkPinned = await js(`window.waMulti.parkAccount("${addA.id}")`)
      check('pinned account cannot be parked', parkPinned.ok === false, JSON.stringify(parkPinned))

      // 8. blast view (nav)
      await js('switchView("blast")')
      await wait(300)
      check('blast view reachable', (await js('document.getElementById("view-blast").classList.contains("active")')) === true)
      check('blast account checklist rendered', /Sweety 1/.test(await js('document.getElementById("blastAccounts").innerHTML')))
      await js('switchView("chat")')
      await wait(200)

      // 9. CSV parser
      const csv = parseCsv('Name,Phone\nelsa,83180503972\nnisca,081211679557\n"Ada, Sari",089652171242\n')
      check('csv parses rows', csv.length === 3, `n=${csv.length}`)
      check('csv normalizes 0-prefix', csv[1].phone === '6281211679557', csv[1].phone)
      check('csv handles quoted comma', csv[2].name === 'Ada, Sari', csv[2].name)
      const csv2 = parseCsv('nama;nomor\nbudi;628123456789\n')
      check('csv detects semicolon delimiter', csv2.length === 1 && csv2[0].phone === '628123456789', JSON.stringify(csv2))

      // 9b. {custom} placeholders
      check('resolveMessage {nama}',
        resolveMessage('Hai {nama}!', { name: 'Budi' }, '') === 'Hai Budi!',
        resolveMessage('Hai {nama}!', { name: 'Budi' }, ''))
      check('resolveMessage {nomor}',
        resolveMessage('no {nomor}', { phone: '628123' }, '') === 'no 628123')
      check('resolveMessage {custom} from target wins',
        resolveMessage('link: {custom}', { custom: 'aff-A' }, 'fallback') === 'link: aff-A')
      check('resolveMessage {custom} falls back to blast-level',
        resolveMessage('link: {custom}', { name: 'x' }, 'aff-B') === 'link: aff-B')
      check('resolveMessage {custom} empty when nothing set',
        resolveMessage('link: {custom}', {}, '') === 'link: ')
      check('resolveMessage leaves unknown braces alone',
        resolveMessage('{harga} tetap', { name: 'a' }, '') === '{harga} tetap')
      const csvC = parseCsv('nama,phone,custom\nbudi,6281234567890,https://aff/1\nsari,6281234567891,\n')
      check('csv reads custom column', csvC[0] && csvC[0].custom === 'https://aff/1', JSON.stringify(csvC[0]))
      check('csv custom empty when blank', csvC[1] && csvC[1].custom === '', JSON.stringify(csvC[1]))
      const csvC2 = parseCsv('nama,nomor,link aff\nbudi,6281234567892,https://aff/9\n')
      check('csv detects "link aff" header as custom', csvC2[0] && csvC2[0].custom === 'https://aff/9', JSON.stringify(csvC2[0]))

      // 10. jid normalization
      check('toJid 08xx -> 628xx@c.us', toJid('085284771336') === '6285284771336@c.us', toJid('085284771336'))
      check('toJid rejects junk', toJid('abc') === null)

      // 11. distribution = split (round robin, no overlap)
      const tg = [{ phone: '1' }, { phone: '2' }, { phone: '3' }, { phone: '4' }, { phone: '5' }]
      const buckets = splitTargets(tg, ['a1', 'a2'])
      check('split covers all targets once', buckets.get('a1').length + buckets.get('a2').length === 5)
      check('split is balanced', buckets.get('a1').length === 3 && buckets.get('a2').length === 2)

      // 12. schedule add + skip-on-late logic
      const schRes = await js(`window.waMulti.addSchedule({ label:"Test Jadwal", kind:"personal", when: Date.now()+3600000, targets:[{phone:"628123456789", custom:"aff-X"}], message:"hi {custom}", custom:"aff-Y", accounts:["${addA.id}"], delaySec:30, mode:"split" })`)
      check('schedule added', schRes.ok === true, JSON.stringify(schRes))
      check('schedule persisted to disk', JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')).length === 1)
      const schDisk = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'))[0]
      check('schedule keeps per-target custom', schDisk.targets[0].custom === 'aff-X', JSON.stringify(schDisk.targets[0]))
      check('schedule keeps blast-level custom', schDisk.custom === 'aff-Y', String(schDisk.custom))
      const badSch = await js('window.waMulti.addSchedule({ when: 1, targets:[], accounts:[] })')
      check('schedule rejects past time', badSch.ok === false, JSON.stringify(badSch))
      await js(`window.waMulti.cancelSchedule("${schRes.id}")`)
      check('schedule cancel works', JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'))[0].status === 'cancelled')
      await js(`window.waMulti.deleteSchedule("${schRes.id}")`)
      check('schedule delete works', JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')).length === 0)

      // 13. daily cap guard
      await js('window.waMulti.setDailyCap(25)')
      check('daily cap persisted', JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).dailyCap === 25)
      check('sentToday starts at 0', sentToday(addA.id) === 0)

      // 14. history + counters
      const fakeJob = { id: 'job-test', kind: 'personal', label: 'test' }
      recordHistory(fakeJob, addA.id, 'Pribadi', { phone: '628111', name: 'x' }, 'sent', null)
      recordHistory(fakeJob, addA.id, 'Pribadi', { phone: '628112', name: 'y' }, 'failed', 'boom')
      check('history records sent', sentToday(addA.id) === 1, `n=${sentToday(addA.id)}`)
      check('history file written', JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).length === 2)
      await js('window.waMulti.clearHistory()')
      check('history cleared', JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).length === 0)

      // 15. engine bundle vendored + injectable API names present
      check('wa-js bundle vendored', WAJS_BUNDLE.length > 100000, `bytes=${WAJS_BUNDLE.length}`)
      check('engine exposes sendTextMessage', /sendTextMessage/.test(WAJS_BUNDLE))
      check('engine exposes getAllGroups', /getAllGroups/.test(WAJS_BUNDLE))
      check('engine exposes getGroupInfoFromInviteCode', /getGroupInfoFromInviteCode/.test(WAJS_BUNDLE))

      // 16. blast guard rails
      const noAcc = await js('window.waMulti.startBlast({ kind:"personal", targets:[{phone:"628123"}], accounts:[], message:"x" })')
      check('blast needs an account', noAcc.ok === false, JSON.stringify(noAcc))
      const noTgt = await js(`window.waMulti.startBlast({ kind:"personal", targets:[], accounts:["${addA.id}"], message:"x" })`)
      check('blast needs targets', noTgt.ok === false, JSON.stringify(noTgt))
      const noMsg = await js(`window.waMulti.startBlast({ kind:"personal", targets:[{phone:"628123"}], accounts:["${addA.id}"], message:"" })`)
      check('blast needs a message', noMsg.ok === false, JSON.stringify(noMsg))

      // 17. remove account cleans up (B already parked & unpinned, C never opened)
      await js(`window.waMulti.removeAccount("${addB.id}")`)
      await js(`window.waMulti.removeAccount("${addC.id}")`)
      check('removeAccount drops it', (await js('window.waMulti.getState()')).accounts.length === 1)

      // 18. dialogs (prompt() unsupported in Electron)
      await js('openAddDialog()')
      await wait(200)
      check('add dialog opens', (await js('document.getElementById("addDlg").open')) === true)
      check('dialog hides views', [...views.values()].every(v => v.getBounds().width === 0))
      await js('document.getElementById("addCancel").click()')
      await wait(250)
      check('dialog close restores views', [...views.values()].every(v => v.getBounds().width > 100))
    } catch (e) {
      check('harness completed without exception', false, e.message)
    }

    console.log('\n===== WA MULTI SELFTEST =====')
    results.forEach(r => console.log(r))
    const failed = results.filter(r => r.startsWith('FAIL')).length
    console.log(`===== ${results.length - failed}/${results.length} passed, ${failed} failed =====\n`)

    if (process.env.WA_MULTI_SHOT) {
      const cap = async (name) => {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(`${process.env.WA_MULTI_SHOT}-${name}.png`, img.toPNG())
        console.log('shot:', `${process.env.WA_MULTI_SHOT}-${name}.png`)
      }
      await win.webContents.executeJavaScript('document.documentElement.setAttribute("data-theme","dark"); window.waMulti.setTheme("dark"); switchView("blast")')
      await wait(500)
      await cap('dark-blast')
      await win.webContents.executeJavaScript('document.documentElement.setAttribute("data-theme","light"); window.waMulti.setTheme("light")')
      await wait(400)
      await cap('light-blast')
      await win.webContents.executeJavaScript('switchView("schedule")')
      await wait(400)
      await cap('light-schedule')
      await win.webContents.executeJavaScript('switchView("chat"); document.documentElement.setAttribute("data-theme","dark"); window.waMulti.setTheme("dark")')
      await wait(400)
      await cap('dark-chat')
    }

    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch (_) {}
    app.exit(failed ? 1 : 0)
  })
}
