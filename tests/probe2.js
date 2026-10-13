// Probe 2 — cari titik hook pesan keluar di WA Web (wa-js 4.6.0).
// Hasil ditulis ke /tmp/probe2.json dari MAIN process (biar gak ketelan).
process.env.WA_MULTI_DEV = '1'
const fs = require('fs')
const path = require('path')
const { app, WebContentsView } = require('electron')

const log = (o) => fs.writeFileSync('/tmp/probe2.json', JSON.stringify(o, null, 2))
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const WAJS = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'wppconnect-wa.js'), 'utf8')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const out = { steps: [] }
  const view = new WebContentsView({
    webPreferences: { partition: 'persist:probe2', contextIsolation: true, nodeIntegration: false }
  })
  win0 = view
  view.webContents.setUserAgent(CHROME_UA)
  view.webContents.loadURL('https://web.whatsapp.com', { userAgent: CHROME_UA })

  const js = (code) => view.webContents.executeJavaScript(code).catch(e => 'ERR: ' + e.message)

  // tunggu DOM hidup
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const ready = await js('document.readyState')
    if (ready === 'complete') break
  }
  out.steps.push('dom complete')

  // 1) apakah webpack runtime ada SEBELUM wa-js di-inject?
  out.preWebpack = await js(`({
    webpackChunk: typeof window.webpackChunkwhatsapp_webpack_modules,
    require: typeof window.require,
    metro_d: typeof window.__d,
    wpp: typeof window.WPP
  })`)

  // 2) QR page atau app shell?
  out.preDom = await js(`({
    qrCanvas: !!document.querySelector('canvas[aria-label*="Scan"], div[data-ref]'),
    side: !!document.querySelector('#side'),
    appWrapper: !!document.querySelector('.app-wrapper-web, #app .two'),
    title: document.title,
    bodyLen: document.body ? document.body.innerHTML.length : 0
  })`)

  // 3) inject wa-js, tunggu
  await js(WAJS)
  let injected = false
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    injected = await js('!!(window.WPP && window.WPP.isInjected)')
    if (injected === true) break
  }
  out.injected = injected

  // 4) dump permukaan API yang relevan buat intercept
  out.surface = await js(`(() => {
    const R = {}
    R.wppKeys = window.WPP ? Object.keys(window.WPP).slice(0, 60) : null
    try { R.waKeys = window.WPP.whatsapp ? Object.keys(window.WPP.whatsapp).slice(0, 80) : null } catch(e) { R.waKeys = 'ERR ' + e.message }
    try { R.fnKeys = window.WPP.whatsapp && window.WPP.whatsapp.functions ? Object.keys(window.WPP.whatsapp.functions).slice(0, 120) : null } catch(e) { R.fnKeys = 'ERR ' + e.message }
    R.chatKeys = window.WPP.chat ? Object.keys(window.WPP.chat).slice(0, 80) : null
    R.evKeys = window.WPP.ev ? Object.keys(window.WPP.ev) : null
    // composer DOM
    R.composer = {
      contenteditable: !!document.querySelector('div[contenteditable="true"][data-tab]'),
      footer: !!document.querySelector('footer'),
      sendBtn: !!document.querySelector('span[data-icon="send"], button[aria-label*="Send"], button[aria-label*="Kirim"]'),
      msgIn: !!document.querySelector('div[contenteditable="true"]')
    }
    return R
  })()`)

  // 5) cari module addAndSendMsgToChat lewat webpack (kalau runtime tersedia)
  out.hookProbe = await js(`(() => {
    const R = {}
    const chunk = window.webpackChunkwhatsapp_webpack_modules
    R.hasChunk = !!chunk
    R.numModules = 0
    try {
      const mods = R.hasChunk ? chunk.push([[Symbol('probe')], {}, (req) => { R.hasReq = typeof req; R.reqType = typeof req === 'function' ? 'fn' : 'other' }]) : null
    } catch (e) { R.chunkErr = e.message }
    return R
  })()`)

  log(out)
  console.log('PROBE2 DONE')
  app.exit(0)
}).catch(e => {
  log({ fatal: e.message, stack: e.stack })
  app.exit(1)
})