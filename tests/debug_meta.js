// Does wa-js attach via its META loader (window.__d + window.require) on real WA Web?
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

  await wc.executeJavaScript(bundle).catch(e => console.log('EXECJS_ERR ' + String(e).slice(0, 150)))

  // poll for attach for up to 40s (meta loader settles after page fully boots)
  for (let i = 0; i < 20; i++) {
    const st = await wc.executeJavaScript(`(function(){ try {
      return JSON.stringify({ wpp: !!(window.WPP), injected: !!(window.WPP && window.WPP.isInjected), loader: window.WPP ? (window.WPP.loaderType || 'n/a') : null, conn: !!(window.WPP && window.WPP.conn) })
    } catch(e){ return 'ERR '+e.message } })()`)
    console.log('M' + i + ' ' + st)
    if (st.includes('"injected":true')) break
    await wait(2000)
  }

  // full check: can we actually call an API?
  const final = await wc.executeJavaScript(`(async function(){ try {
    if (!window.WPP || !window.WPP.conn) return JSON.stringify({ fail: 'no conn' })
    const auth = typeof window.WPP.conn.isAuthenticated === 'function' ? await window.WPP.conn.isAuthenticated() : 'no-fn'
    return JSON.stringify({ auth: String(auth), hasChat: !!(window.WPP.chat && window.WPP.chat.sendTextMessage) })
  } catch (e) { return JSON.stringify({ err: e.message }) } })()`)
  console.log('FINAL ' + final)
  app.exit(0)
})
