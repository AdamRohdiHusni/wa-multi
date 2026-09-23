// Verify the daily-cap guard and per-account stop on the real send path.
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, 'main.js'))

const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2200)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)
  const WA = global.__wa

  const A = await js('window.waMulti.addAccount("Pribadi")')
  await js(`window.waMulti.setPinned("${A.id}")`)
  await js(`window.waMulti.openAccount("${A.id}")`)
  await wait(1200)

  const MOCK = `(function(){
    if (window.__patched) return true
    window.__patched = true
    if (!window.__LEDGER) window.__LEDGER = []
    window.WPP = {
      isInjected: true,
      conn: { isAuthenticated: () => true },
      chat: { sendTextMessage: (jid, text) => { window.__LEDGER.push({ jid, text }); return Promise.resolve({}) } },
      contact: { list: () => Promise.resolve([]) },
      group: { getAllGroups: () => Promise.resolve([]) }
    }
    return true
  })()`
  const watcher = setInterval(() => { for (const [, v] of WA.views) v.webContents.executeJavaScript(MOCK).catch(() => {}) }, 150)
  await wait(600)

  // cap = 3, blast 6 targets → only 3 should go out
  await js('window.waMulti.setDailyCap(3)')
  const targets = [1, 2, 3, 4, 5, 6].map(i => ({ name: 'T' + i, phone: '62812345678' + i }))
  await js(`window.__ev = []; window.waMulti.onBlastProgress(p => window.__ev.push(p)); true`)
  await js(`window.waMulti.startBlast(${JSON.stringify({ kind: 'personal', targets, message: 'hai {nama}', accounts: [A.id], delaySec: 5, mode: 'split' })})`)

  const t0 = Date.now()
  while (Date.now() - t0 < 70000) {
    const s = await js('window.waMulti.getState()')
    if (!s.blasting) break
    await wait(800)
  }
  clearInterval(watcher)

  const events = JSON.parse(await js('JSON.stringify(window.__ev)') || '[]')
  const state = await js('window.waMulti.getState()')
  let ledger = []
  for (const [, v] of WA.views) {
    const raw = await v.webContents.executeJavaScript('JSON.stringify(window.__LEDGER || [])').catch(() => '[]')
    try { ledger.push(...JSON.parse(raw)) } catch (_) {}
  }
  const capErr = events.find(e => e.phase === 'accountError')

  // ── now the stop test: 4 targets, stop after the 2nd ──
  await js('window.waMulti.clearHistory()')
  await js('window.waMulti.setDailyCap(0)')
  const t2 = [1, 2, 3, 4].map(i => ({ name: 'S' + i, phone: '62898765432' + i }))
  await js(`window.__ev2 = []; window.waMulti.onBlastProgress(p => window.__ev2.push(p)); true`)
  await js(`window.waMulti.startBlast(${JSON.stringify({ kind: 'personal', targets: t2, message: 'stop test', accounts: [A.id], delaySec: 5, mode: 'split' })})`)
  await wait(7000)
  await js(`window.waMulti.stopBlast(null)`)
  const t1 = Date.now()
  while (Date.now() - t1 < 40000) {
    const s = await js('window.waMulti.getState()')
    if (!s.blasting) break
    await wait(700)
  }
  const ev2 = JSON.parse(await js('JSON.stringify(window.__ev2)') || '[]')
  const st2 = await js('window.waMulti.getState()')

  console.log('GUARDS ' + JSON.stringify({
    cap: {
      capSet: 3,
      targetsOffered: 6,
      actuallySent: ledger.length,
      stoppedByCap: !!capErr,
      capError: capErr ? capErr.error : null,
      recordedSent: state.history.filter(h => h.status === 'sent').length
    },
    stop: {
      targetsOffered: 4,
      recordedSent: st2.history.filter(h => h.status === 'sent').length,
      finalStatus: (ev2.find(e => e.phase === 'done') || {}).status
    }
  }, null, 2))
  app.exit(0)
})
