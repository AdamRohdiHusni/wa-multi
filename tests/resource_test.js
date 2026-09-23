// Measure the REAL resource behaviour with 5 accounts:
//   how many WA views stay alive, and what it costs in RAM.
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, '..', 'main.js'))

const { app, BrowserWindow } = require('electron')

const mb = (bytes) => Math.round(bytes / 1024 / 1024)

function snapshot (label) {
  const m = app.getAppMetrics()
  const total = m.reduce((a, p) => a + (p.memory ? p.memory.workingSetSize : 0), 0)
  const renderers = m.filter(p => p.type === 'Tab' || p.type === 'Renderer')
  return {
    label,
    liveWAViews: global.__wa.views.size,
    liveAccounts: [...global.__wa.views.keys()].map(id => (global.__wa.accounts.find(a => a.id === id) || {}).name),
    slots: Object.fromEntries([...global.__wa.slotOf].map(([id, s]) => [(global.__wa.accounts.find(a => a.id === id) || {}).name, s])),
    processes: m.length,
    rendererProcs: renderers.length,
    totalWorkingSetMB: mb(total),
    rendererWorkingSetMB: mb(renderers.reduce((a, p) => a + (p.memory ? p.memory.workingSetSize : 0), 0))
  }
}

app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)

  const names = ['Pribadi', 'Sweety 1', 'Sweety 2', 'Sweety 3', 'Sweety 4']
  const accs = []
  for (const n of names) accs.push(await js(`window.waMulti.addAccount(${JSON.stringify(n)})`))
  await wait(300)

  const report = []
  report.push(snapshot('0. 5 akun ditambah, belum ada yang dibuka'))

  // pin the personal account and open it
  await js(`window.waMulti.setPinned("${accs[0].id}")`)
  await js(`window.waMulti.openAccount("${accs[0].id}")`)
  await wait(2500)
  report.push(snapshot('1. Pribadi dibuka (mode 2 tab)'))

  // open office #1
  await js(`window.waMulti.openAccount("${accs[1].id}")`)
  await wait(2500)
  report.push(snapshot('2. Sweety 1 dibuka (jadi pasangan background)'))

  // now "open" the other three, one by one — like clicking through tabs
  for (let i = 2; i < 5; i++) {
    await js(`window.waMulti.openAccount("${accs[i].id}")`)
    await wait(2200)
    report.push(snapshot(`3.${i - 1} Sweety ${i} dibuka (menggantikan slot background)`))
  }

  // simulate a full pass: click every tab in turn twice
  for (let round = 0; round < 2; round++) {
    for (const a of accs) {
      await js(`window.waMulti.openAccount("${a.id}")`)
      await wait(900)
    }
  }
  report.push(snapshot('4. setelah keliling semua 5 tab 2x'))

  // solo mode = personal only
  await js('window.waMulti.setTabMode("solo")')
  await wait(900)
  report.push(snapshot('5. mode 1 tab (solo)'))
  await js('window.waMulti.setTabMode("dual")')
  await wait(600)

  console.log('RESOURCE_REPORT ' + JSON.stringify(report, null, 2))
  app.exit(0)
})
