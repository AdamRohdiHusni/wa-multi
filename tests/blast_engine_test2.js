// Persist the blast-engine mock's view registry so we can read the OTHER
// account's sends after its temporary view is destroyed. Instead, keep a
// global ledger in the main process that survives view teardown.
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
  const B = await js('window.waMulti.addAccount("Sweety 1")')
  await js(`window.waMulti.setPinned("${A.id}")`)
  // keep BOTH accounts alive (dual mode, full layout) so their views are REUSED by
  // the blast worker instead of being spun up/destroyed — mirrors real usage
  await js(`window.waMulti.openAccount("${A.id}")`)
  await wait(900)
  await js(`window.waMulti.openAccount("${B.id}")`)
  await wait(1200)

  // global ledger shared by ALL views (main process holds it, views push into it)
  global.__LEDGER = []
  const MOCK = `
    (function(){
      if (window.__patched) return true
      window.__patched = true
      if (!window.__LEDGER) window.__LEDGER = []
      window.WPP = {
        isInjected: true,
        conn: { isAuthenticated: () => true },
        chat: {
          sendTextMessage: (jid, text, opts) => { window.__LEDGER.push({ jid, text }); return Promise.resolve({ id: { _serialized: 'x' } }) },
          sendFileMessage: (jid, data, opts) => { window.__LEDGER.push({ jid, text: opts && opts.caption, file: true }); return Promise.resolve({}) }
        },
        contact: { list: () => Promise.resolve([{ id: { _serialized: '628111@c.us' }, name: 'Kontak Tes' }]) },
        group: { getAllGroups: () => Promise.resolve([{ id: { _serialized: '123-456@g.us' }, name: 'Grup Tes' }]) }
      }
      return true
    })()`

  const watcher = setInterval(() => {
    for (const [id, v] of WA.views) v.webContents.executeJavaScript(MOCK).catch(() => {})
  }, 200)

  const targets = [
    { name: 'Budi', phone: '6281234567890', custom: 'AFF-BUDI' },
    { name: 'Sari', phone: '6281234567891', custom: 'AFF-SARI' },
    { name: 'Tono', phone: '6281234567892', custom: 'AFF-TONO' },
    { name: 'Rina', phone: '6281234567893', custom: 'AFF-RINA' },
    { name: 'Wati', phone: '6281234567894', custom: 'AFF-WATI' }
  ]

  await js(`window.__ev = []; window.waMulti.onBlastProgress(p => window.__ev.push(p)); true`)
  await js(`window.waMulti.startBlast(${JSON.stringify({
    kind: 'personal', targets, message: 'Hai {nama}, ini link kamu: {custom} (no {nomor})',
    custom: 'FALLBACK', accounts: [A.id, B.id], delaySec: 5, mode: 'split'
  })})`)

  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    const s = await js('window.waMulti.getState()')
    if (!s.blasting) break
    await wait(1000)
  }
  clearInterval(watcher)
  await wait(400)

  const events = JSON.parse(await js('JSON.stringify(window.__ev)') || '[]')
  const state = await js('window.waMulti.getState()')
  // both views are still alive → read their own send ledgers
  const ledger = []
  for (const [id, v] of WA.views) {
    const raw = await v.webContents.executeJavaScript('JSON.stringify(window.__LEDGER || [])').catch(() => '[]')
    try { ledger.push(...JSON.parse(raw)) } catch (_) {}
  }
  const texts = ledger.map(m => m.text).sort()

  console.log('BLAST_ENGINE2 ' + JSON.stringify({
    ledgerCount: ledger.length,
    messages: texts,
    allCustomReal: texts.length === 5 && texts.every(t => /AFF-(BUDI|SARI|TONO|RINA|WATI)/.test(t)),
    noLeftoverBraces: texts.every(t => !t.includes('{')),
    jidsValid: ledger.every(m => /@c\.us$/.test(m.jid)),
    done: events.find(e => e.phase === 'done') && events.find(e => e.phase === 'done').status,
    historySent: state.history.filter(h => h.status === 'sent').length,
    historyCustomKept: state.history.filter(h => h.custom).length,
    viewsLeftAlive: WA.views.size
  }, null, 2))
  app.exit(0)
})
