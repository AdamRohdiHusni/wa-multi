// Screenshots: trial badge + license dialog + locked pro buttons (fixed shots).
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
process.env.WA_MULTI_LIC_FORCE = 'trial'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, '..', 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, '..', 'main.js'))

const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2500)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)

  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`/tmp/lic-${name}.png`, img.toPNG())
    console.log('SHOT', name)
  }

  await js('window.waMulti.setTheme("dark")')
  await js('window.waMulti.addAccount("Pribadi")')
  await wait(800)
  // add a 2nd account → should be blocked in trial
  const blocked = await js('window.waMulti.addAccount("Sweety 1").then(r => JSON.stringify(r))')
  console.log('TRIAL_2ND_ACCOUNT', blocked)
  await js('switchView("blast")')
  await wait(1500)
  await shot('trial-blast')

  // try starting a blast → gated + dialog opens
  const gate = await js(`window.waMulti.startBlast({ targets:[{phone:'628111'}], accounts:[state.accounts[0].id], message:'hai' }).then(r => JSON.stringify(r))`)
  console.log('TRIAL_BLAST_GATE', gate)

  await js('refreshState()')
  await wait(500)
  await js('openLicenseDialog()')
  await wait(900)
  await shot('dialog')
  console.log('BADGE', await js('document.getElementById("licenseBadge").textContent'))
  console.log('BADGE_CLASS', await js('document.getElementById("licenseBadge").className'))
  console.log('START_LOCKED', await js('document.getElementById("btnStart").className'))

  app.exit(0)
})
