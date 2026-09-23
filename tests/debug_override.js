// Can we override WPP.conn.isAuthenticated on the REAL bundle? (mock design check)
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
  await wait(8000)

  const v = WA.views.get(A.id)
  const wc = v.webContents
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'wppconnect-wa.js'), 'utf8')
  await wc.executeJavaScript(bundle).catch(() => {})
  await wait(6000)

  const out = await wc.executeJavaScript(`(async function(){
    const r = {}
    try { window.WPP.conn.isAuthenticated = () => Promise.resolve(true); r.nestedSet = 'ok' } catch (e) { r.nestedSet = 'THREW: ' + e.message }
    try { r.nestedWorks = String(await window.WPP.conn.isAuthenticated()) } catch (e) { r.nestedWorks = 'err ' + e.message }
    const backup = window.WPP
    try {
      window.WPP = { isInjected: true, conn: { isAuthenticated: () => Promise.resolve(true) }, chat: {}, contact: {}, group: {} }
      r.replaceSet = 'ok'
      r.replaceWorks = String(await window.WPP.conn.isAuthenticated())
      r.replaceIsInjected = window.WPP.isInjected === true
      window.WPP = backup
    } catch (e) { r.replaceSet = 'THREW: ' + e.message; window.WPP = backup }
    return JSON.stringify(r)
  })()`)
  console.log('OVERRIDE ' + out)
  app.exit(0)
})
