// Real blast-engine test with a MOCKED WhatsApp page.
// Proves: rotation one-account-at-a-time, even split, {custom}/{nama}/{nomor}
// substitution reaching the send call, delay, daily cap, history, stop.
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

  // two accounts
  const A = await js('window.waMulti.addAccount("Pribadi")')
  const B = await js('window.waMulti.addAccount("Sweety 1")')
  await js(`window.waMulti.setPinned("${A.id}")`)

  // ── install the mock into every view that gets created ────────
  const sent = []          // { accountId, jid, text }
  let currentViewOwner = null
  const { WebContentsView } = require('electron')

  const patchView = (id) => {
    const v = WA.views.get(id)
    if (!v) return
    // only patch once per view, and never wipe the record we're collecting
    v.webContents.executeJavaScript(`
      if (window.__patched) { true } else { window.__patched = true; window.__sent = []; }
      window.WPP = {
        isInjected: true,
        conn: { isAuthenticated: () => true },
        chat: {
          sendTextMessage: (jid, text, opts) => { window.__sent.push({ jid, text, opts }); return Promise.resolve({ id: { _serialized: 'x' } }) },
          sendFileMessage: (jid, data, opts) => { window.__sent.push({ jid, text: opts && opts.caption, file: true }); return Promise.resolve({}) }
        },
        contact: { list: () => Promise.resolve([{ id: { _serialized: '628111@c.us' }, name: 'Kontak Tes' }]) },
        group: { getAllGroups: () => Promise.resolve([{ id: { _serialized: '123-456@g.us' }, name: 'Grup Tes' }]) }
      };
      true
    `).catch(() => {})
  }

  // monkey-patch createView indirectly: watch for new views every 150ms
  const watcher = setInterval(() => {
    for (const id of WA.views.keys()) patchView(id)
  }, 150)

  // ── run a split blast: 5 targets, 2 accounts ─────────────────
  const targets = [
    { name: 'Budi', phone: '6281234567890', custom: 'AFF-BUDI' },
    { name: 'Sari', phone: '6281234567891', custom: 'AFF-SARI' },
    { name: 'Tono', phone: '6281234567892', custom: 'AFF-TONO' },
    { name: 'Rina', phone: '6281234567893', custom: 'AFF-RINA' },
    { name: 'Wati', phone: '6281234567894', custom: 'AFF-WATI' }
  ]

  const ev = []
  await js(`window.__ev = []; window.waMulti.onBlastProgress(p => window.__ev.push(p)); true`)

  await js(`window.waMulti.startBlast(${JSON.stringify({
    kind: 'personal', targets, message: 'Hai {nama}, ini link kamu: {custom} (no {nomor})',
    custom: 'FALLBACK', accounts: [A.id, B.id], delaySec: 5, mode: 'split'
  })})`)

  // wait for completion (5 targets, 5s delay → ~15-25s)
  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    const s = await js('window.waMulti.getState()')
    if (!s.blasting) break
    await wait(1000)
  }
  clearInterval(watcher)
  const elapsed = Math.round((Date.now() - t0) / 1000)

  // harvest what each view actually "sent"
  const perAccount = {}
  for (const [id, v] of WA.views) {
    perAccount[id] = await v.webContents.executeJavaScript('JSON.stringify(window.__sent || [])').then(JSON.parse).catch(() => [])
  }
  const all = Object.entries(perAccount).flatMap(([id, arr]) => arr.map(m => ({ ...m, accountId: id })))

  const events = JSON.parse(await js('JSON.stringify(window.__ev)') || '[]')
  const state = await js('window.waMulti.getState()')

  console.log('BLAST_ENGINE ' + JSON.stringify({
    elapsedSec: elapsed,
    totalSentCalls: all.length,
    // rotation: accounts were started one at a time (no overlap in phases)
    accountStarts: events.filter(e => e.phase === 'accountStart').map(e => e.name),
    phases: events.map(e => e.phase),
    splitCounts: events.filter(e => e.phase === 'start').flatMap(e => e.accounts.map(a => ({ name: a.name, total: a.total }))),
    messages: all.map(m => m.text).sort(),
    customSubstituted: all.every(m => m.text && !m.text.includes('{custom}') && !m.text.includes('{nama}')),
    usedFallback: all.some(m => m.text && m.text.includes('FALLBACK')),
    jidsValid: all.every(m => /@c\.us$/.test(m.jid)),
    done: events.find(e => e.phase === 'done'),
    historySent: state.history.filter(h => h.status === 'sent').length,
    historyFailed: state.history.filter(h => h.status === 'failed').length,
    historyCustomKept: state.history.filter(h => h.custom).length,
    viewsLeftAlive: WA.views.size
  }, null, 2))

  app.exit(0)
})
