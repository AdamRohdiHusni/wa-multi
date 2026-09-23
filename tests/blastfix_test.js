// Blast-fix verification with REAL wa-js semantics:
// the app injects the REAL wa-js bundle (ensureEngine), we overlay only
// auth/sends/lists. Verdicts come from main-process HISTORY (survives view teardown).
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
process.env.WA_MULTI_AUTH_TIMEOUT = '15000'
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
  const WA = global.__wa

  const A = await js('window.waMulti.addAccount("Pribadi")')
  const B = await js('window.waMulti.addAccount("Sweety 1")')
  await js(`window.waMulti.setPinned("${A.id}", true)`)

  let LOGIN_DELAY = 4000
  const LOGIN_START = Date.now()
  // CRITICAL mock design note (proven in tests/debug_override.js): wa-js's
  // internal code closes over its own module references, so assigning
  // window.WPP.conn.isAuthenticated does NOT affect what the app calls — the
  // assignment sticks but the original function keeps being used. The mock
  // must REPLACE window.WPP entirely (a fresh plain object). The app's calls
  // go through window.WPP.* at call time, so this works.
  const REAL = `window.__realWPP = window.WPP`
  const MOCK = `
    (function(){
      if (!window.WPP || !window.WPP.isInjected) return false   // wait for the real attach
      if (window.__mocked) { window.__loggedIn = __LOGGEDIN__; return true }
      if (!window.__realWPP) window.__realWPP = window.WPP
      window.__mocked = true
      window.__LEDGER = []
      window.__loggedIn = __LOGGEDIN__
      window.WPP = {
        isInjected: true,
        conn: { isAuthenticated: () => Promise.resolve(window.__loggedIn === true) },
        chat: {
          sendTextMessage: (jid, text) => { window.__LEDGER.push({ jid, text }); return Promise.resolve({ id: { _serialized: 'x' } }) },
          sendFileMessage: (jid, d, o) => { window.__LEDGER.push({ jid, file: true }); return Promise.resolve({}) }
        },
        contact: { list: () => Promise.resolve([{ id: { _serialized: '628000000001@c.us' }, name: 'Kontak A' }, { id: { _serialized: '628000000002@c.us' }, name: 'Kontak B' }]) },
        group: { getAllGroups: () => Promise.resolve([{ id: { _serialized: '111-222@g.us' }, name: 'Grup Satu' }, { id: { _serialized: '333-444@g.us' }, name: 'Grup Dua' }]) }
      }
      return true
    })()`
  const watcher = setInterval(() => {
    const logged = Date.now() >= LOGIN_START + LOGIN_DELAY
    for (const [, v] of WA.views) {
      if (v.webContents.isDestroyed()) continue
      v.webContents.executeJavaScript(REAL).catch(() => {})
      v.webContents.executeJavaScript(MOCK.replace(/__LOGGEDIN__/g, String(logged))).catch(() => {})
    }
  }, 250)

  // executeJavaScript auto-resolves promises → await getState() directly
  const state = async () => {
    try { return await js('window.waMulti.getState()') } catch (e) { console.log('STATE_ERR ' + String(e).slice(0, 120)); return { history: [] } }
  }
  const waitDone = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await state(); if (!s.blasting) break; await wait(700) } }

  // ── S1: blast 2 targets right after login ──
  await js('window.__ev = []; window.waMulti.onBlastProgress(p => window.__ev.push(p)); true')
  await js('window.waMulti.clearHistory()')
  const t1 = Date.now()
  await js(`window.waMulti.startBlast(${JSON.stringify({ kind: 'personal', targets: [{ name: 'Andi', phone: '6281234500001' }, { name: 'Bela', phone: '6281234500002' }], message: 'hai {nama}', accounts: [B.id], delaySec: 5, mode: 'split' })})`)
  await waitDone(90000)
  const ev1 = (await js('window.__ev || []').then(r => r).catch(() => [])) || []
  const st1 = await state()
  if (!st1.history) console.log('ST1_KEYS ' + JSON.stringify(Object.keys(st1)))
  const s1 = {
    elapsedSec: Math.round((Date.now() - t1) / 1000),
    jobDone: ev1.some(e => e.phase === 'done'),
    historySent: st1.history.filter(h => h.status === 'sent').length,
    historyFailed: st1.history.filter(h => h.status === 'failed').length,
    waitHeartbeats: ev1.filter(e => e.phase === 'accountWait').length,
    sentTo: st1.history.filter(h => h.status === 'sent').map(h => h.target).sort(),
    errors: st1.history.filter(h => h.status === 'failed').map(h => h.error)
  }

  // ── S2: stop while waiting for login (was impossible before) ──
  LOGIN_DELAY = 999999999
  await js('window.__ev2 = []; window.waMulti.onBlastProgress(p => window.__ev2.push(p)); true')
  const t2 = Date.now()
  await js(`window.waMulti.startBlast(${JSON.stringify({ kind: 'personal', targets: [{ name: 'Cici', phone: '6281234500003' }], message: 'x', accounts: [B.id], delaySec: 5, mode: 'split' })})`)
  await wait(3500)
  await js('window.waMulti.stopBlast(null)')
  await waitDone(40000)
  const ev2 = (await js('window.__ev2 || []').catch(() => [])) || []
  const s2 = {
    totalSec: Math.round((Date.now() - t2) / 1000),
    status: (ev2.find(e => e.phase === 'done') || {}).status || 'STILL_RUNNING',
    waitHeartbeats: ev2.filter(e => e.phase === 'accountWait').length
  }

  // ── S3: contacts/groups fetch (logged in now) — fast, not blocked ──
  LOGIN_DELAY = 0
  await wait(1500) // let the watcher flip __loggedIn
  const t3 = Date.now()
  const contacts = await js(`window.waMulti.fetchContacts("${B.id}")`)
  const groups = await js(`window.waMulti.fetchGroups("${B.id}")`)
  const s3 = {
    contactsOk: contacts.ok === true,
    contactsN: (contacts.contacts || []).length,
    contactsSec: Math.round((Date.now() - t3) / 1000),
    groupsOk: groups.ok === true,
    groupsN: (groups.groups || []).length,
    groupNames: (groups.groups || []).map(g => g.name).sort(),
    contactErr: contacts.error || null,
    groupErr: groups.error || null
  }

  clearInterval(watcher)
  console.log('BLASTFIX ' + JSON.stringify({ S1_send: s1, S2_stop: s2, S3_fetch: s3 }, null, 2))
  app.exit(0)
})
