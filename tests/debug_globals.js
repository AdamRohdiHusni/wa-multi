// Which webpack globals does today's WA Web expose? (drives the vendor patch)
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
  await wait(7000)

  const v = WA.views.get(A.id)
  const probe = await v.webContents.executeJavaScript(`(function(){
    try {
      const names = Object.keys(window).filter(k => /webpack|require|__d|chunk/i.test(k))
      const out = { globals: names.slice(0, 20) }
      const g = window.webpackChunkwhatsapp_webpack_modules
      out.wwmExists = !!g
      if (g) { out.wwmIsArray = Array.isArray(g); out.wwmLen = g.length; out.wwmSample = typeof g[0] }
      out.windowRequire = typeof window.require
      out.windowD = typeof window.__d
      // try pushing a test chunk into wwm like wa-js would
      if (Array.isArray(g)) {
        try {
          g.push([[999001], {}, (req) => { out.hijackCalled = true; out.reqType = typeof req }])
        } catch (e) { out.pushErr = e.message }
      }
      return JSON.stringify(out)
    } catch (e) { return 'ERR ' + e.message }
  })()`)
  console.log('GLOBALS ' + probe)
  await wait(2000)
  const probe2 = await v.webContents.executeJavaScript(`JSON.stringify({ hijackCalled: window.__hijackCalled || false })`).catch(() => 'n/a')
  const final = await v.webContents.executeJavaScript(`(function(){ try {
    const g = window.webpackChunkwhatsapp_webpack_modules
    const out = {}
    if (Array.isArray(g)) {
      for (const item of g) {
        if (Array.isArray(item) && item.length === 3 && typeof item[2] === 'function' && item[0] && item[0][0] === 999001) { out.hijackStillQueued = true }
      }
      out.totalEntries = g.length
    }
    return JSON.stringify(out)
  } catch (e) { return 'ERR ' + e.message } })()`)
  console.log('HIJACK2 ' + final)
  app.exit(0)
})
