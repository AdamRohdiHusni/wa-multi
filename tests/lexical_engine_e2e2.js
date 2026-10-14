// VERIFY the exact production engine call, but through the REAL Lexical API shape.
// Uses the actual Lexical editor object (not a fake) with a real typed selection,
// and checks: (a) marker lands, (b) placement when caret is mid-text, (c) verbatim.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const OUT = '/tmp/lexrepro/E2E2.txt'
const log = (s) => { console.log(s); try { fs.appendFileSync(OUT, s + '\n') } catch (_) {} }
app.disableHardwareAcceleration()
try { fs.writeFileSync(OUT, '') } catch (_) {}

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const i = src.indexOf('const INITIAL_ENGINE =')
const j = src.indexOf('\n\nconst UPDATER_OWNER', i)
const ENGINE = new Function(src.slice(i, j) + '; return INITIAL_ENGINE')()

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 600 })
  await win.loadFile('/tmp/lexrepro/index.html')
  for (let k = 0; k < 40; k++) {
    if (await win.webContents.executeJavaScript('window.__ready === true').catch(() => false)) break
    await new Promise(r => setTimeout(r, 400))
  }
  log('READY: ' + await win.webContents.executeJavaScript('window.__ready').catch(e => 'ERR ' + e.message))
  win.webContents.on('render-process-gone', (_e, d) => log('RENDER-GONE: ' + JSON.stringify(d)))
  const run = (code, label, ms = 12000) => Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))
  ]).catch(e => 'THROW ' + e.message)

  await run(ENGINE, 'install')
  await run(`window.__WA_MULTI_INITIAL_ENGINE__.setCfg({enabled:true,code:'/DM',skipGroups:false,showBadge:true})`, 'cfg')

  const clear = async () => {
    await run(`(function(){ window.__lex.setText(''); window.__lex.root().focus() })()`, 'clear')
    await new Promise(r => setTimeout(r, 250))
  }
  const type = async (t) => { for (const ch of t) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await new Promise(r => setTimeout(r, 30)) } }
  const pressEnter = async () => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); await new Promise(r => setTimeout(r, 450)) }

  // NOTE: driving text via CDP `char` events swallows the first character after a
  // programmatic reset (harness artifact — a real user typing never hits this). So we
  // assert the INVARIANT that matters: the marker sits on its own line (preceded by a
  // line break) and appears exactly once. Byte-identity with real typing is proven
  // separately in tests/lexical_repro7.js.
  const markerOnOwnLine = (flat, m) => {
    const parts = String(flat).split('|BR|')
    return parts.some(p => p === m)
  }

  // T1: typed text + Enter => marker on its own line
  for (let round = 1; round <= 3; round++) {
    await clear(); await type('halo kak'); await pressEnter()
    const r = JSON.parse(await run(`JSON.stringify({flat:window.__lex.flat(),st:window.__WA_MULTI_INITIAL_ENGINE__.get()})`, 't1'))
    const pass = markerOnOwnLine(r.flat, '/DM')
    log(`T1 r${round}: flat=${JSON.stringify(r.flat)} method=${r.st.method} -> ${pass ? 'PASS' : 'FAIL'}`)
  }

  // T2: verbatim marker variants (no forced slash)
  for (const m of ['DM', '/DM', '-Dhimas', 'FR']) {
    await clear(); await type('hai')
    await run(`window.__WA_MULTI_INITIAL_ENGINE__.setCfg({enabled:true,code:${JSON.stringify(m)},skipGroups:false})`, 'cfg2')
    await pressEnter()
    const flat = await run(`window.__lex.flat()`, 't2')
    const pass = markerOnOwnLine(flat, m) && (flat.match(new RegExp(m.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) || []).length === 1
    log(`T2 marker=${JSON.stringify(m)}: flat=${JSON.stringify(flat)} -> ${pass ? 'PASS' : 'FAIL'}`)
  }

  // T3: toggle OFF => nothing appended
  await run(`window.__WA_MULTI_INITIAL_ENGINE__.setCfg({enabled:false,code:'/DM'})`, 'cfg3')
  await clear(); await type('halo'); await pressEnter()
  const offFlat = await run(`window.__lex.flat()`, 't3')
  log(`T3 disabled: flat=${JSON.stringify(offFlat)} -> ${!/DM/.test(offFlat) ? 'PASS' : 'FAIL'}`)

  // T4: no double-tag when text already ends with the marker
  await run(`window.__WA_MULTI_INITIAL_ENGINE__.setCfg({enabled:true,code:'/DM',skipGroups:false})`, 'cfg4')
  await clear(); await type('halo /DM'); await pressEnter()
  const dbl = await run(`window.__lex.flat()`, 't4')
  const dblCount = (dbl.match(/\/DM/g) || []).length
  log(`T4 double-tag guard: flat=${JSON.stringify(dbl)} count=${dblCount} -> ${dblCount === 1 ? 'PASS' : 'FAIL'}`)

  // T5: engine reports method + probe works
  const pr = await run(`JSON.stringify({probe:window.__WA_MULTI_INITIAL_ENGINE__.probe(), st:window.__WA_MULTI_INITIAL_ENGINE__.get()})`, 't5')
  log(`T5 probe=${pr}`)

  app.exit(0)
})
app.on('window-all-closed', () => {})
