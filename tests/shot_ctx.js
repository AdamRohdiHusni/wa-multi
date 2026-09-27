// Screenshot: solid right-click menu on a tab (dark theme) — evidence for Adam.
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

  await js('window.waMulti.setTheme("dark")')
  const A = await js('window.waMulti.addAccount("Pribadi")')
  await js('window.waMulti.addAccount("Sweety 1")')
  await js(`window.waMulti.setPinned("${A.id}", true)`)
  await wait(800)

  // open the ctx menu on Sweety 1 tab and leave it open
  await js(`(function(){
    const tabs = document.querySelectorAll('#tabs .tab')
    let target = null
    for (const t of tabs) { if (t.textContent.includes('Sweety 1')) { target = t; break } }
    if (!target) return 'NO_TAB'
    const r = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }))
    return 'ok'
  })()`)
  await wait(1500)
  const img = await win.webContents.capturePage()
  fs.writeFileSync('/tmp/v22-ctxmenu.png', img.toPNG())
  console.log('SHOT saved /tmp/v22-ctxmenu.png')
  app.exit(0)
})
