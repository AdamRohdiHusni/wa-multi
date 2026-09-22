// WA Multi — Multi-account WhatsApp Web desktop shell
// Design: 1 live account at a time (lazy-load), sessions persisted per account.
const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const IS_DEV = !!process.env.WA_MULTI_DEV
const userDataDir = IS_DEV
  ? path.join(__dirname, 'dev-userdata')
  : path.join(app.getPath('userData'), 'data')
const SESSIONS_DIR = path.join(userDataDir, 'sessions')
const ACCOUNTS_FILE = path.join(userDataDir, 'accounts.json')
const PREFS_FILE = path.join(userDataDir, 'prefs.json')

app.commandLine.appendSwitch('disable-gpu') // lightweight on weak laptops
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force_high_performance_gpu') // no-op when GPU off

function ensureDirs () {
  for (const d of [userDataDir, SESSIONS_DIR]) fs.mkdirSync(d, { recursive: true })
}
ensureDirs()

// ── Accounts store ────────────────────────────────────────────
function loadAccounts () {
  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch (_) {}
  return []
}
function saveAccounts (list) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2))
}

// ── Prefs (theme, last account) ───────────────────────────────
function loadPrefs () {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) } catch (_) { return {} }
}
function savePrefs (p) {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2))
}

let accounts = loadAccounts()
let prefs = loadPrefs()

// ── Main window ───────────────────────────────────────────────
let win = null
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
  win.loadFile('index.html')
  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' })
  attachResizeHandler()

  // External links open in system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  if (process.env.WA_MULTI_SELFTEST) runSelfTest()
})

// ── Self-test harness (dev only, enabled via WA_MULTI_SELFTEST=1) ──
function runSelfTest () {
  const results = []
  const check = (name, cond, extra) => {
    results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms))

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(400)
      // 1. renderer boots & preload bridge exposed
      const bridged = await win.webContents.executeJavaScript('typeof window.waMulti === "object"')
      check('preload bridge exposed', bridged === true)

      // 2. topbar rendered with dark theme default
      const theme = await win.webContents.executeJavaScript('document.documentElement.getAttribute("data-theme")')
      check('default theme is dark', theme === 'dark', `got=${theme}`)

      // 3. empty state -> welcome visible
      const welcomeShown = await win.webContents.executeJavaScript('!document.getElementById("welcome").classList.contains("hidden")')
      check('welcome screen visible when no accounts', welcomeShown === true)

      // 4. add account through the real IPC path
      const addRes = await win.webContents.executeJavaScript('window.waMulti.addAccount("SelfTest 1")')
      check('addAccount returns id', !!(addRes && addRes.id), JSON.stringify(addRes))

      // 5. state reflects the new account
      const st = await win.webContents.executeJavaScript('window.waMulti.getState()')
      check('getState lists 1 account', st.accounts.length === 1, `n=${st.accounts.length}`)
      check('account name persisted', st.accounts[0] && st.accounts[0].name === 'SelfTest 1')

      // 6. accounts.json written to disk
      const onDisk = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))
      check('accounts.json on disk', onDisk.length === 1 && onDisk[0].name === 'SelfTest 1')

      // 7. theme toggle persists
      await win.webContents.executeJavaScript('window.waMulti.setTheme("light")')
      const prefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'))
      check('theme pref persisted', prefs.theme === 'light', JSON.stringify(prefs))
      await win.webContents.executeJavaScript('window.waMulti.setTheme("dark")')

      // 8. openAccount creates a live BrowserView (WA Web may be offline; we only
      //    assert the view exists + bounds are sane, not that it logged in)
      await win.webContents.executeJavaScript(`window.waMulti.openAccount("${addRes.id}")`)
      await wait(1200)
      check('live BrowserView created', !!liveView)
      check('live account tracked', liveAccountId === addRes.id, `live=${liveAccountId}`)
      if (liveView) {
        const b = liveView.getBounds()
        check('live view bounds sane', b.width > 100 && b.height > 100 && b.y >= 40, JSON.stringify(b))
        check('live view url is WA Web', /web\.whatsapp\.com/.test(liveView.webContents.getURL()), liveView.webContents.getURL())
        check('session partition per account', liveView.webContents.session === require('electron').session.fromPartition('persist:wa-' + addRes.id))
      }

      // 9. switching accounts swaps the view
      const add2 = await win.webContents.executeJavaScript('window.waMulti.addAccount("SelfTest 2")')
      await win.webContents.executeJavaScript(`window.waMulti.openAccount("${add2.id}")`)
      await wait(1000)
      check('switch swaps live account', liveAccountId === add2.id, `live=${liveAccountId}`)
      check('only one view at a time', BrowserWindow.getAllWindows().length === 1)

      // 10. close + remove cleans up
      await win.webContents.executeJavaScript('window.waMulti.closeAccount()')
      check('closeAccount destroys view', !liveView)
      await win.webContents.executeJavaScript(`window.waMulti.removeAccount("${add2.id}")`)
      const st2 = await win.webContents.executeJavaScript('window.waMulti.getState()')
      check('removeAccount drops it', st2.accounts.length === 1, `n=${st2.accounts.length}`)

      // 11. UI menu renders account rows + unread badge slot
      const menuHtml = await win.webContents.executeJavaScript('document.getElementById("accMenu").innerHTML')
      check('menu renders account row', /SelfTest 1/.test(menuHtml))
      check('menu has add row', /Tambah akun/.test(menuHtml))

      // 12. light theme applies CSS variables
      await win.webContents.executeJavaScript('window.waMulti.setTheme("light"); document.documentElement.setAttribute("data-theme","light")')
      const bg = await win.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor')
      check('light theme background applied', bg === 'rgb(255, 255, 255)', bg)

      // 13. theme toggle button flips state in the real UI
      await win.webContents.executeJavaScript('document.getElementById("themeBtn").click()')
      await wait(300)
      const themeAfter = await win.webContents.executeJavaScript('document.documentElement.getAttribute("data-theme")')
      check('theme button toggles to dark', themeAfter === 'dark', `got=${themeAfter}`)

      // 14. REGRESSION: dropdown must hide the WA view while open — WebContentsView
      // paints ABOVE the HTML, so without this the menu is invisible/unclickable
      await win.webContents.executeJavaScript(`window.waMulti.openAccount("${addRes.id}")`)
      await wait(600)
      await win.webContents.executeJavaScript('document.getElementById("accBtn").click()')
      await wait(350)
      const hiddenB = liveView.getBounds()
      check('menu open hides WA view', hiddenB.width === 0 && hiddenB.height === 0, JSON.stringify(hiddenB))
      await win.webContents.executeJavaScript('document.getElementById("accBtn").click()')
      await wait(350)
      const shownB = liveView.getBounds()
      check('menu close restores WA view', shownB.width > 100 && shownB.height > 100, JSON.stringify(shownB))

      // 15. REGRESSION: rename via dialog (prompt() is unsupported in Electron)
      await win.webContents.executeJavaScript('document.querySelector(".acc-item .ren").click()')
      await wait(250)
      const dlgOpen = await win.webContents.executeJavaScript('document.getElementById("renameDlg").open')
      check('rename dialog opens', dlgOpen === true)
      await win.webContents.executeJavaScript('document.getElementById("renameInput").value = "Renamed Acc"; document.querySelector("#renameDlg form").requestSubmit()')
      await wait(400)
      const st3 = await win.webContents.executeJavaScript('window.waMulti.getState()')
      check('rename applied via dialog', st3.accounts[0].name === 'Renamed Acc', st3.accounts[0].name)

      // 16. dialog covers stage too (WA view hidden while addDlg open)
      await win.webContents.executeJavaScript('openAddDialog()')
      await wait(300)
      const dlgB = liveView.getBounds()
      check('add dialog hides WA view', dlgB.width === 0 && dlgB.height === 0, JSON.stringify(dlgB))
      await win.webContents.executeJavaScript('document.getElementById("addCancel").click()')
      await wait(300)
      const dlgB2 = liveView.getBounds()
      check('add dialog close restores WA view', dlgB2.width > 100, JSON.stringify(dlgB2))
    } catch (e) {
      check('harness completed without exception', false, e.message)
    }

    console.log('\n===== WA MULTI SELFTEST =====')
    results.forEach(r => console.log(r))
    const failed = results.filter(r => r.startsWith('FAIL')).length
    console.log(`===== ${results.length - failed}/${results.length} passed, ${failed} failed =====\n`)

    // optional visual capture: WA_MULTI_SHOT=/path/prefix
    if (process.env.WA_MULTI_SHOT) {
      const cap = async (name) => {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(`${process.env.WA_MULTI_SHOT}-${name}.png`, img.toPNG())
        console.log('shot:', `${process.env.WA_MULTI_SHOT}-${name}.png`)
      }
      const capView = async (name) => {
        if (!liveView) return
        const img = await liveView.webContents.capturePage()
        fs.writeFileSync(`${process.env.WA_MULTI_SHOT}-${name}.png`, img.toPNG())
        console.log('shot:', `${process.env.WA_MULTI_SHOT}-${name}.png`)
      }
      await win.webContents.executeJavaScript('document.documentElement.setAttribute("data-theme","dark"); window.waMulti.setTheme("dark")')
      await win.webContents.executeJavaScript('document.getElementById("accMenu").classList.remove("hidden")')
      await wait(300)
      await cap('dark-menu')
      await win.webContents.executeJavaScript('document.documentElement.setAttribute("data-theme","light"); window.waMulti.setTheme("light")')
      await wait(300)
      await cap('light-menu')
      await win.webContents.executeJavaScript('document.getElementById("accMenu").classList.add("hidden")')
      await win.webContents.executeJavaScript('document.getElementById("welcome").classList.remove("hidden")')
      await wait(200)
      await cap('light-welcome')

      // capture the LIVE WA Web view itself (proves QR renders, not the Chrome-block page)
      const addShot = await win.webContents.executeJavaScript('window.waMulti.addAccount("ShotAcc")')
      await win.webContents.executeJavaScript(`window.waMulti.openAccount("${addShot.id}")`)
      await wait(9000)
      await capView('wa-web')
      // maximize test: bounds must follow the window
      win.maximize()
      await wait(1500)
      const mb = liveView ? liveView.getBounds() : null
      const cb = win.getContentBounds()
      console.log(`MAXIMIZE CHECK: view=${JSON.stringify(mb)} window=${cb.width}x${cb.height}`)
      await capView('wa-web-maximized')
      win.unmaximize()
      await wait(800)
    }
    // cleanup test artifacts
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch (_) {}
    app.exit(failed ? 1 : 0)
  })
}

app.on('window-all-closed', () => app.quit())
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Live WA Web view management ───────────────────────────────
// One BrowserView at a time, swap on account switch. Session persisted via
// partition per account id so login survives restarts.
let liveView = null
let liveAccountId = null

function destroyLiveView () {
  if (!liveView) return
  try { win.contentView.removeChildView(liveView) } catch (_) {}
  try { liveView.webContents.close() } catch (_) {}
  liveView = null
  liveAccountId = null
}

function viewBounds () {
  if (!win) return { x: 0, y: 0, width: 0, height: 0 }
  if (overlayOpen) return { x: 0, y: 0, width: 0, height: 0 } // popup has the stage
  const b = win.getContentBounds()
  const top = typeof uiTop === 'number' ? uiTop : 48
  return { x: 0, y: top, width: b.width, height: Math.max(1, b.height - top) }
}

let uiTop = 48
let overlayOpen = false
let currentTheme = prefs.theme === 'light' ? 'light' : 'dark'

function createLiveView (accountId) {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:wa-' + accountId,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  // Resource dieting: block heavy third-party trackers inside WA Web
  view.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const u = details.url
    if (/google-analytics|googletagmanager|doubleclick|facebook\.net|scorecardresearch|quantserve/i.test(u)) {
      return cb({ cancel: true })
    }
    cb({ cancel: false })
  })
  view.setBounds(viewBounds())
  // WA Web blocks the Electron UA ("works with Chrome 100+" page) →
  // spoof a standard Chrome UA. Electron 33 = Chromium 130, so Chrome/130 is honest.
  view.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')
  view.webContents.loadURL('https://web.whatsapp.com')
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  return view
}

// ── IPC: renderer <-> main ────────────────────────────────────
function notifyStateChanged () {
  try { win.webContents.send('wa-multi:stateChanged') } catch (_) {}
}

ipcMain.handle('wa-multi:getState', () => {
  return {
    accounts: accounts.map(a => ({
      id: a.id,
      name: a.name,
      color: a.color || null,
      lastOpened: a.lastOpened || null
    })),
    liveAccountId,
    theme: currentTheme
  }
})

ipcMain.handle('wa-multi:addAccount', (e, name) => {
  const id = 'acc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const palette = ['#25d366', '#34b7f1', '#f15f6d', '#f2a33c', '#a78bfa', '#2dd4bf']
  const color = palette[accounts.length % palette.length]
  accounts.push({ id, name: String(name || ('Akun ' + (accounts.length + 1))).trim(), color })
  saveAccounts(accounts)
  notifyStateChanged()
  return { ok: true, id }
})

ipcMain.handle('wa-multi:renameAccount', (e, { id, name }) => {
  const a = accounts.find(x => x.id === id)
  if (a && name) { a.name = String(name).trim(); saveAccounts(accounts); notifyStateChanged() }
  return { ok: true }
})

ipcMain.handle('wa-multi:removeAccount', (e, id) => {
  const wasLive = liveAccountId === id
  accounts = accounts.filter(a => a.id !== id)
  saveAccounts(accounts)
  // wipe session dir so re-adding gets a fresh login
  const dir = path.join(SESSIONS_DIR, id)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}
  // also clear the partition's localStorage/indexeddb (stored in userData/Partitions)
  try {
    const partDir = path.join(app.getPath('userData'), 'Partitions', 'wa-' + id)
    fs.rmSync(partDir, { recursive: true, force: true })
  } catch (_) {}
  if (wasLive) { destroyLiveView(); win.webContents.send('wa-multi:liveClosed') }
  notifyStateChanged()
  return { ok: true }
})

ipcMain.handle('wa-multi:openAccount', async (e, id) => {
  if (!accounts.some(a => a.id === id)) return { ok: false, error: 'akun tidak ada' }
  if (liveAccountId === id && liveView) return { ok: true, alreadyOpen: true }
  destroyLiveView()
  liveView = createLiveView(id)
  liveAccountId = id
  const a = accounts.find(x => x.id === id)
  a.lastOpened = Date.now()
  saveAccounts(accounts)
  win.contentView.addChildView(liveView)
  liveView.setBounds(viewBounds())
  notifyStateChanged()
  return { ok: true }
})

ipcMain.handle('wa-multi:closeAccount', () => {
  destroyLiveView()
  notifyStateChanged()
  return { ok: true }
})

ipcMain.handle('wa-multi:setTheme', (e, theme) => {
  currentTheme = theme === 'light' ? 'light' : 'dark'
  prefs.theme = currentTheme
  savePrefs(prefs)
  nativeTheme.themeSource = currentTheme
  notifyStateChanged()
  return { ok: true, theme: currentTheme }
})

ipcMain.handle('wa-multi:setUITop', (e, top) => {
  uiTop = Number(top) || 48
  if (liveView) liveView.setBounds(viewBounds())
  return { ok: true }
})

// WebContentsView always paints above the renderer HTML. When a native-feel
// popup (dropdown menu / dialog) is open, we must get the WA view OUT of the
// way or it visually covers and eats clicks on the popup.
ipcMain.handle('wa-multi:setOverlayOpen', (e, open) => {
  overlayOpen = !!open
  if (liveView) liveView.setBounds(viewBounds())
  return { ok: true }
})

// let renderer know when window resized (setAutoResize handles most; belt & suspenders)
function attachResizeHandler () {
  if (!win) return
  win.removeAllListeners('resize')
  win.on('resize', () => { if (liveView) liveView.setBounds(viewBounds()) })
  win.on('maximize', () => { if (liveView) liveView.setBounds(viewBounds()) })
  win.on('unmaximize', () => { if (liveView) liveView.setBounds(viewBounds()) })
  win.on('enter-full-screen', () => { if (liveView) liveView.setBounds(viewBounds()) })
  win.on('leave-full-screen', () => { if (liveView) liveView.setBounds(viewBounds()) })
}
attachResizeHandler()

// ── unread badge per account (updated when account is opened) ─
// The renderer reads the title of the live view (WA Web sets unread count in
// document title like "(3) WhatsApp"). We forward it to the shell.
setInterval(() => {
  if (!win || win.isDestroyed()) return
  // self-heal bounds every tick too (covers maximize/fullscreen edge cases)
  if (liveView) liveView.setBounds(viewBounds())
  if (!liveView || liveView.webContents.isDestroyed()) return
  const title = liveView.webContents.getTitle()
  if (!title) return
  const m = title.match(/^\((\d+)\)/)
  const unread = m ? parseInt(m[1], 10) : 0
  win.webContents.send('wa-multi:unread', { accountId: liveAccountId, unread })
}, 4000)
