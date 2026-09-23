// Focus: does wa-js inject into a fresh QR-page view? Can conn.isAuthenticated be overridden?
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
  await wait(4000)

  const v = WA.views.get(A.id)
  const wc = v.webContents

  // poll: webpack global + inject attempt
  for (let i = 0; i < 30; i++) {
    const s = await wc.executeJavaScript(`(function(){
      try {
        return JSON.stringify({
          wp: !!(window.webpackChunkwhatsapp_webpack_modules || window.require),
          wpp: !!(window.WPP && window.WPP.isInjected)
        })
      } catch (e) { return 'ERR ' + e.message }
    })()`).catch(e => 'EXECE ' + String(e).slice(0, 60))
    if (i % 3 === 0) console.log('P' + i + ' ' + s)
    if (s && s.includes('"wpp":true')) { console.log('INJECTED at P' + i); break }
    await wait(1000)
  }

  // now check the shape of conn.isAuthenticated and try to override
  const probe = await wc.executeJavaScript(`(async function(){
    try {
      const out = {}
      out.hasConn = !!(window.WPP && window.WPP.conn)
      if (out.hasConn) {
        const d = Object.getOwnPropertyDescriptor(window.WPP.conn, 'isAuthenticated')
        out.desc = d ? { writable: d.writable, hasGet: !!d.get, configurable: d.configurable } : 'plain-or-inherited'
        out.protoDesc = (() => {
          const pd = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.WPP.conn) || {}, 'isAuthenticated')
          return pd ? { writable: pd.writable, hasGet: !!pd.get, configurable: pd.configurable } : null
        })()
        try {
          window.WPP.conn.isAuthenticated = () => Promise.resolve(true)
          out.overrideStuck = window.WPP.conn.isAuthenticated.toString().includes('Promise.resolve(true)')
        } catch (e) { out.overrideErr = e.message }
        try { out.callRes = String(await window.WPP.conn.isAuthenticated()).slice(0, 40) } catch (e) { out.callErr = e.message }
      }
      return JSON.stringify(out)
    } catch (e) { return 'ERR ' + e.message }
  })()`)
  console.log('PROBE ' + probe)
  app.exit(0)
})
