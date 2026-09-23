// UI check: batch rendering (7), search filter, show-more, select-all-filtered.
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
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

  const MOCK = `
    (function(){
      // WA views host web.whatsapp.com — they never contain the app DOM.
      // Gate only on the real bundle being attached.
      if (!window.WPP || !window.WPP.isInjected) return false
      if (window.__mocked) return true
      window.__mocked = true
      const cs = []
      for (let i = 1; i <= 23; i++) cs.push({ id: '62811100000' + String(i).padStart(2, '0') + '@c.us', name: 'Kontak ' + i })
      window.WPP = {
        isInjected: true,
        conn: { isAuthenticated: () => Promise.resolve(true) },
        chat: { sendTextMessage: () => Promise.resolve({}), sendFileMessage: () => Promise.resolve({}) },
        contact: { list: () => Promise.resolve(cs) },
        group: { getAllGroups: () => Promise.resolve([{ id: '111-1@g.us', name: 'Grup A' }, { id: '222-2@g.us', name: 'Grup B' }]) }
      }
      return true
    })()`
  const poll = setInterval(() => { for (const [, v] of WA.views) { if (!v.webContents.isDestroyed()) v.webContents.executeJavaScript(MOCK).catch(() => {}) } }, 400)

  // switch to blast view, fetch contacts via the real UI button
  console.log('STAGE switchView')
  await js('switchView("blast")').catch(e => console.log('STAGE_FAIL switchView: ' + String(e).slice(0, 120)))
  await wait(300)
  // make sure the account dropdown is populated (state load may race the test)
  await js('refreshState()').catch(e => console.log('RS_ERR ' + String(e).slice(0, 80)))
  for (let i = 0; i < 15; i++) {
    const n = await js('(function(){ var s = document.getElementById("contactAccSel"); return s ? s.options.length : -1 })()').catch(() => -1)
    if (n > 0) break
    await wait(600)
  }
  console.log('STAGE select-account')
  await js('(function(){ var s = document.getElementById("contactAccSel"); if (!s) return "NO_SEL"; if (!s.options.length) return "EMPTY_OPTS"; s.value = ${JSON.stringify(B.id)}; return "set=" + s.value })()').then(v => console.log('SEL_SET ' + v)).catch(e => console.log('E1 ' + String(e).slice(0, 140)))
  await js('(function(){ var s = document.getElementById("contactAccSel"); var b = document.getElementById("btnFetchContacts"); var r = { selVal: s ? s.value : "no-sel", selOpts: s ? s.options.length : -1, btn: !!b, btnDisabled: b ? b.disabled : null }; window.__probe1 = r; return JSON.stringify(r) })()').then(v => console.log('PROBE1 ' + v)).catch(e => console.log('E2 ' + String(e).slice(0, 140)))
  for (let attempt = 0; attempt < 20; attempt++) {
    await js('(function(){ document.getElementById("btnFetchContacts").click(); return "clicked" })()').catch(e => console.log('E2b ' + String(e).slice(0, 100)))
    await wait(2500)
    const got = await js('(function(){ try { return contactPool.length } catch(e){ return -1 } })()').catch(() => -1)
    if (got > 0) { console.log('POOL_GOT ' + got); break }
  }
  // wait for injection+fetch
  let rows = 0, info = ''
  let toastMsg = ''
  // capture toasts (fetch errors surface there)
  await js('(function(){ if (!window.__toasts) { window.__toasts = []; var orig = window.toast; window.toast = function(m){ window.__toasts.push(String(m)); if (orig) try { orig(m) } catch(_){} }; } return "hooked" })()').catch(e => console.log('THOOK ' + String(e).slice(0, 80)))
  for (let i = 0; i < 40; i++) {
    await wait(1500)
    rows = await js('(function(){ return document.querySelectorAll("#contactPick .mini-item").length })()').catch(e => { console.log('E3 ' + String(e).slice(0, 80)); return 0 })
    info = await js('(function(){ var el = document.querySelector("#contactPick .mini-foot .sub.small"); return el ? el.textContent : "" })()').catch(e => { console.log('E4 ' + String(e).slice(0, 80)); return '' })
    toastMsg = await js('(function(){ try { return (window.__toasts || []).join(" | ") } catch(e){ return "" } })()').catch(() => '')
    if (rows > 0) break
  }
  const res1 = { batchRows: rows, footInfo: info, toasts: toastMsg, expected: '7/23' }

  // search filter
  await wait(500)
  console.log('STAGE search')
  await js(`(function(){ var i = document.getElementById('contactSearch'); if (!i) return 'NO_INPUT'; i.value = 'kontak 1'; i.dispatchEvent(new Event('input')); return 'ok' })()`).catch(e => console.log('STAGE_FAIL search: ' + String(e).slice(0, 120)))
  await wait(300)
  const res2 = {
    filteredRows: await js('(function(){ return document.querySelectorAll("#contactPick .mini-item").length })()').catch(() => -1),
    names: await js('(function(){ var els = document.querySelectorAll("#contactPick .mn"); var out = []; for (var i=0;i<els.length;i++) out.push(els[i].textContent); return out.join(",") })()').catch(() => 'ERR')
  }

  // show more
  await js(`(function(){ var i = document.getElementById('contactSearch'); if (!i) return 'NO_INPUT'; i.value = ''; i.dispatchEvent(new Event('input')); return 'ok' })()`).catch(e => console.log('STAGE_FAIL clear: ' + String(e).slice(0, 120)))
  await wait(200)
  await js('(function(){ var b = document.querySelector("#contactPick [data-more]"); if (b) b.click(); return b ? "clicked" : "no-btn" })()').catch(e => console.log('STAGE_FAIL more: ' + String(e).slice(0, 120)))
  await wait(200)
  const res3 = { afterMore: await js('(function(){ return document.querySelectorAll("#contactPick .mini-item").length })()').catch(() => -1), expected: 14 }

  // select all filtered
  await js(`(function(){ var i = document.getElementById('contactSearch'); if (!i) return 'NO_INPUT'; i.value = 'kontak 2'; i.dispatchEvent(new Event('input')); return 'ok' })()`).catch(e => console.log('STAGE_FAIL search2: ' + String(e).slice(0, 120)))
  await wait(200)
  await js('(function(){ var b = document.querySelector("#contactPick [data-all]"); if (b) b.click(); return b ? "clicked" : "no-btn" })()').catch(e => console.log('STAGE_FAIL all: ' + String(e).slice(0, 120)))
  await wait(300)
  const res4 = { targetCount: await js('(function(){ try { return targets.length } catch(e){ return "no-targets:" + e.message } })()').catch(e => { console.log('E6 ' + String(e).slice(0, 80)); return -2 }), expected: 3 }

  clearInterval(poll)
  console.log('PICKER_UI ' + JSON.stringify({ res1, res2, res3, res4 }, null, 2))
  app.exit(0)
})
