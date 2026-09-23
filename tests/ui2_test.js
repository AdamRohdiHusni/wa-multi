// UI check v2: right-click ctx menu (bg/z-order/labels) + picker batch/search.
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


  await wait(1200)
  await js(`(function(){
    const tabs = document.querySelectorAll('#tabs .tab')
    let target = null
    for (const t of tabs) { if (t.textContent.includes('Sweety 1')) { target = t; break } }
    if (!target) return 'NO_TAB'
    const r = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }))
    return 'dispatched'
  })()`).then(v => console.log('CTX_DISPATCH ' + v)).catch(e => console.log('CTX_ERR ' + String(e).slice(0, 100)))
  await wait(1200) // let the append-after-hide round-trip finish
  const out = {}
  out.menu = await js(`(function(){
    const m = document.querySelector('.acc-menu')
    if (!m) return 'NO_MENU'
    const cs = getComputedStyle(m)
    const items = [...m.querySelectorAll('.acc-item')].map(x => x.textContent.trim())
    return { bg: cs.backgroundColor, z: cs.zIndex, items }
  })()`).catch(e => 'ERR ' + String(e).slice(0, 80))
  await js('closeCtxMenu()')

  // ── 2. picker UI: seed the pool directly (the WA→pool path is covered by
  // blastfix_test S3; here we verify the batch/search/select UI logic only) ──
  await js('switchView("blast")')
  await js(`(function(){
    contactPool = []
    for (let i = 1; i <= 23; i++) contactPool.push({ id: '6281110000' + String(100 + i), name: 'Kontak ' + i })
    contactShown = 7
    targets = []
    renderContactBatch()
    return contactPool.length
  })()`).then(v => console.log('SEEDED ' + v)).catch(e => console.log('SEED_ERR ' + String(e).slice(0, 120)))
  await wait(300)
  out.picker = await js(`(function(){
    const rows = document.querySelectorAll('#contactPick .mini-item').length
    const foot = document.querySelector('#contactPick .mini-foot')
    return { rows, foot: foot ? foot.textContent.trim().replace(/\\s+/g, ' ') : null }
  })()`).catch(e => 'ERR ' + String(e).slice(0, 80))

  // search filter
  await js(`(function(){ var i = document.getElementById('contactSearch'); i.value = 'Kontak 1'; i.dispatchEvent(new Event('input')); return 1 })()`)
  await wait(300)
  out.search = await js(`(function(){
    return { rows: document.querySelectorAll('#contactPick .mini-item').length,
             names: [...document.querySelectorAll('#contactPick .mn')].map(x => x.textContent).join(',') }
  })()`).catch(e => 'ERR')
  await js(`(function(){ var i = document.getElementById('contactSearch'); i.value = ''; i.dispatchEvent(new Event('input')); return 1 })()`)
  await wait(200)

  // select all filtered
  await js(`(function(){ var i = document.getElementById('contactSearch'); i.value = 'Kontak 2'; i.dispatchEvent(new Event('input')); return 1 })()`)
  await wait(200)
  await js(`(function(){ var b = document.querySelector('#contactPick [data-all]'); if (b) b.click(); return b ? 1 : 0 })()`)
  await wait(300)
  out.targetsAfterAll = await js('(function(){ try { return targets.length } catch(e){ return -1 } })()')

  console.log('UI2 ' + JSON.stringify(out, null, 2))
  app.exit(0)
})
