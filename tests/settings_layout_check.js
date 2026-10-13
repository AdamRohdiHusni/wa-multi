// Verify the settings dialog markup: tag must be on its OWN LINE below the
// message, and the update block must be manual (no auto-download wording).
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    // Attach the REAL preload so window.waMulti exists exactly like in the app.
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  })
  await win.loadFile(path.join(__dirname, '..', 'index.html'))
  await new Promise(r => setTimeout(r, 1000))

  const out = await win.webContents.executeJavaScript(`(function(){
    var res={}
    document.getElementById('settingsDlg').showModal()
    var on=document.getElementById('initOn'); on.checked=true; on.dispatchEvent(new Event('change'))
    var c=document.getElementById('initCode'); c.value='/DM'; c.dispatchEvent(new Event('input'))
    var p=document.getElementById('initPreview')
    res.previewHTML = p ? p.innerHTML : null
    // The sample and the tag must be separated by a <br>, not a space.
    res.tagBelow = /halo kak<\\/i>\\s*<br\\s*\\/?>\\s*<b>\\/DM<\\/b>/i.test(p?p.innerHTML:'')
    res.hasUpdateBlock = !!document.getElementById('btnCheckUpdate')
    res.installBtnLabel = (document.getElementById('btnInstallUpdate')||{}).textContent
    res.hintText = (document.querySelector('#settingsDlg .set-block:last-of-type .hint')||{}).textContent
    res.badgeExists = !!document.getElementById('updBadge')
    res.version = (document.getElementById('setVersion')||{}).textContent
    return JSON.stringify(res,null,1)
  })()`)
  console.log(out)
  app.quit()
})
