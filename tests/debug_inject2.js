// Capture the REAL error from injecting the vendored wa-js bundle.
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, '..', 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, '..', 'main.js'))

const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)
  const WA = global.__wa

  const A = await js('window.waMulti.addAccount("Pribadi")')
  await js(`window.waMulti.setPinned("${A.id}", true)`)
  await js(`window.waMulti.openAccount("${A.id}")`)
  await wait(6000)

  const v = WA.views.get(A.id)
  const wc = v.webContents

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'wppconnect-wa.js'), 'utf8')
  console.log('BUNDLE_BYTES ' + bundle.length)

  const res = await wc.executeJavaScript(`(async () => {
    const out = {}
    out.wpBefore = !!(window.webpackChunkwhatsapp_webpack_modules || window.require)
    try {
      const src = ${JSON.stringify(bundle)}
      // evaluate exactly like the app does
      window.eval(src)
      out.evalOk = true
    } catch (e) { out.evalErr = String(e && e.message || e).slice(0, 300) }
    await new Promise(r => setTimeout(r, 3000))
    out.hasWPP = !!(window.WPP)
    out.isInjected = !!(window.WPP && window.WPP.isInjected)
    out.hasConn = !!(window.WPP && window.WPP.conn)
    if (out.hasWPP) {
      out.keys = Object.keys(window.WPP).slice(0, 12)
      try { out.authType = typeof window.WPP.conn.isAuthenticated } catch (e) { out.authErr = e.message }
    }
    return JSON.stringify(out)
  })()`)
  console.log('INJECT ' + res)
  app.exit(0)
})
