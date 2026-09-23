// Hard resource numbers with 5 accounts + leak detection over many tab swaps.
// Reads real RSS from /proc (app.getAppMetrics is unreliable under xvfb).
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, '..', 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, '..', 'main.js'))

const { app, BrowserWindow } = require('electron')

function rssTree () {
  // sum RSS of this process and all its descendants
  const me = process.pid
  const kids = {}
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8')
      const ppid = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]
      kids[d] = ppid
    } catch (_) {}
  }
  const isDesc = (pid) => {
    let p = pid, hops = 0
    while (p && p !== '0' && hops++ < 10) {
      if (p === String(me)) return true
      p = kids[p]
    }
    return false
  }
  let total = 0, n = 0, renderers = 0, rendererRss = 0
  for (const pid of Object.keys(kids)) {
    if (!isDesc(pid)) continue
    let rss = 0
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
      rss = parseInt((status.match(/VmRSS:\s+(\d+)/) || [0, 0])[1], 10) * 1024
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      if (/--type=renderer/.test(cmd)) { renderers++; rendererRss += rss }
    } catch (_) { continue }
    total += rss; n++
  }
  return { procs: n, totalMB: Math.round(total / 1048576), rendererProcs: renderers, rendererMB: Math.round(rendererRss / 1048576) }
}

app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2500)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)

  const names = ['Pribadi', 'Sweety 1', 'Sweety 2', 'Sweety 3', 'Sweety 4']
  const accs = []
  for (const n of names) accs.push(await js(`window.waMulti.addAccount(${JSON.stringify(n)})`))
  await wait(400)
  await js(`window.waMulti.setPinned("${accs[0].id}")`)

  const rows = []
  const rec = async (label) => {
    await wait(600)
    const st = await js('window.waMulti.getState()')
    rows.push({
      label,
      liveWA: global.__wa.views.size,
      live: [...global.__wa.views.keys()].map(id => (global.__wa.accounts.find(a => a.id === id) || {}).name),
      ...rssTree()
    })
  }

  await rec('baseline (5 akun terdaftar, belum dibuka)')

  // open personal
  await js(`window.waMulti.openAccount("${accs[0].id}")`)
  await wait(4000)
  await rec('1 akun hidup (Pribadi)')

  // open each of the other 4 in turn (each replaces the background slot)
  for (let i = 1; i < 5; i++) {
    await js(`window.waMulti.openAccount("${accs[i].id}")`)
    await wait(4000)
    await rec(`2 akun hidup (Pribadi + Sweety ${i})`)
  }

  // LEAK TEST: swap between the 5 tabs 30 times
  const beforeSwap = rssTree()
  for (let i = 0; i < 30; i++) {
    await js(`window.waMulti.openAccount("${accs[i % 5].id}")`)
    await wait(700)
  }
  await wait(3000)
  const afterSwap = rssTree()
  await rec('setelah 30x gonta-ganti tab')

  // solo mode
  await js('window.waMulti.setTabMode("solo")')
  await wait(3000)
  await rec('mode 1 tab (solo, cuma Pribadi)')

  console.log('RESOURCE_HARD ' + JSON.stringify({
    rows,
    leakCheck: {
      beforeMB: beforeSwap.totalMB,
      afterMB: afterSwap.totalMB,
      deltaMB: afterSwap.totalMB - beforeSwap.totalMB,
      procsBefore: beforeSwap.procs,
      procsAfter: afterSwap.procs
    }
  }, null, 2))
  app.exit(0)
})
