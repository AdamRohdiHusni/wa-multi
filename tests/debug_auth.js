// Debug: what does the app's isAuthenticated see, second by second?
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
  await wait(3000)

  const v = WA.views.get(A.id)
  if (!v) { console.log('DEBUG no view!'); app.exit(1); return }

  // wait for the app's own engine injection, watching state each second
  for (let i = 0; i < 20; i++) {
    const st = await v.webContents.executeJavaScript(`(function(){
      try {
        return JSON.stringify({
          url: location.href.slice(0, 60),
          hasWPP: !!(window.WPP && window.WPP.isInjected),
          authType: window.WPP && window.WPP.conn ? typeof window.WPP.conn.isAuthenticated : 'none',
          __patched: !!window.__patched,
          qrVisible: !!document.querySelector('div[data-ref], canvas[aria-label*="Scan"]'),
          shellVisible: !!document.querySelector('#side, [data-testid="chat-list"], .app-wrapper-web.two')
        })
      } catch (e) { return 'PAGE_ERR ' + e.message }
    })()`).catch(e => 'EXEC_ERR ' + String(e).slice(0, 80))
    console.log('T' + i + ' ' + st)
    await wait(1000)
  }
  app.exit(0)
})
