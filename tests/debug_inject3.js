// Does wc.executeJavaScript(bundle) — the app's actual path — attach WPP despite CSP?
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

  const wp = await wc.executeJavaScript('!!(window.webpackChunkwhatsapp_webpack_modules || window.require)').catch(e => 'E')
  console.log('WEBPACK_READY ' + wp)

  // exact app path: executeJavaScript(bundle)
  try {
    await wc.executeJavaScript(bundle)
    console.log('EXECJS_NO_THROW true')
  } catch (e) {
    console.log('EXECJS_NO_THROW false: ' + String(e).slice(0, 200))
  }
  await wait(3000)
  const st = await wc.executeJavaScript(`(function(){ try {
    return JSON.stringify({ hasWPP: !!(window.WPP), isInjected: !!(window.WPP && window.WPP.isInjected), hasConn: !!(window.WPP && window.WPP.conn) })
  } catch(e){ return 'ERR '+e.message } })()`)
  console.log('AFTER_EXECJS ' + st)
  app.exit(0)
})
