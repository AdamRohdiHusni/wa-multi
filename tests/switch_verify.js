// Independent verification of the "instant tab switch, no reload" requirement.
// Counts real navigations per WA view and measures switch latency.
process.env.WA_MULTI_DEV = '1'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, 'main.js'))

const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2500)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)

  const A = await js('window.waMulti.addAccount("Pribadi")')
  const B = await js('window.waMulti.addAccount("Sweety 1")')
  await wait(200)
  await js(`window.waMulti.setPinned("${A.id}")`)
  await js(`window.waMulti.openAccount("${A.id}")`)
  await wait(1200)
  await js(`window.waMulti.openAccount("${B.id}")`)
  await wait(1500)

  // find the live views from the main process side via the renderer-reported state
  const st = await js('window.waMulti.getState()')
  const accs = st.accounts

  // instrument navigations: attach to each view's webContents
  const navs = {}
  const { WebContentsView } = require('electron')
  // reach into the module's registry through the window's contentView children
  const children = win.contentView.children
  const live = children.filter(c => c.constructor && c.constructor.name === 'WebContentsView')
  live.forEach((v, i) => {
    navs['view' + i] = 0
    v.webContents.on('did-start-loading', () => { navs['view' + i]++ })
    v.webContents.on('did-navigate', () => { navs['view' + i]++ })
  })

  const before = JSON.stringify(navs)

  // measure the switch: A -> B -> A, twice
  const times = []
  for (let i = 0; i < 4; i++) {
    const target = i % 2 === 0 ? accs[1].id : accs[0].id
    const t0 = Date.now()
    await js(`window.waMulti.activateAccount("${target}")`)
    times.push(Date.now() - t0)
    await wait(250)
  }
  const after = JSON.stringify(navs)

  // z-order + bounds check in full mode
  const order = win.contentView.children.map(c => c.constructor.name)
  const final = await js('window.waMulti.getState()')
  const bounds = live.map(v => v.getBounds())

  console.log('SWITCH_VERIFY ' + JSON.stringify({
    accounts: accs.map(a => ({ name: a.name, slot: a.slot })),
    layoutMode: final.layoutMode,
    navCountersBefore: JSON.parse(before),
    navCountersAfter: JSON.parse(after),
    noReload: before === after,
    switchTimesMs: times,
    avgSwitchMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    maxSwitchMs: Math.max(...times),
    bounds,
    bothFullStage: bounds.every(b => b.width > 1000 && b.height > 500),
    childOrder: order,
    activeIsLast: final.activeAccountId === accs[0].id
  }, null, 2))

  app.exit(0)
})
