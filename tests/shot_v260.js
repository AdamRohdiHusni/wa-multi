// Capture the v2.6.0 UI: settings dialog (inisial + update) and the toolbar.
process.env.WA_MULTI_DEV = '1'
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const ROOT = path.join(__dirname, '..')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(path.join(ROOT, 'index.html'))
  await new Promise(r => setTimeout(r, 900))
  const js = (c) => win.webContents.executeJavaScript(c)

  // seed an initials config so the dialog shows real values
  await js('window.waMulti.setInitials({ on: true, code: "DM", skipGroups: true })')
  await js('openSettingsDialog()')
  await new Promise(r => setTimeout(r, 700))
  let img = await win.webContents.capturePage()
  fs.writeFileSync('/tmp/v260-settings.png', img.toPNG())

  await js('document.getElementById("settingsClose").click()')
  await new Promise(r => setTimeout(r, 400))
  // toggle on the quick toolbar chip if present
  await js(`(() => { const b = document.getElementById('initChip'); if (b) b.click() })()`)
  await new Promise(r => setTimeout(r, 400))
  img = await win.webContents.capturePage()
  fs.writeFileSync('/tmp/v260-topbar.png', img.toPNG())

  console.log('SHOTS_OK')
  app.exit(0)
})
