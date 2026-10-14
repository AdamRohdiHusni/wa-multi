// END-TO-END: the REAL INITIAL_ENGINE string from main.js, in a REAL Lexical editor,
// driven by REAL key input. This is the test that would have caught the v2.6.1 bug.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const OUT = '/tmp/lexrepro/E2E.txt'
const log = (s) => { console.log(s); try { fs.appendFileSync(OUT, s + '\n') } catch (_) {} }
app.disableHardwareAcceleration()
try { fs.writeFileSync(OUT, '') } catch (_) {}

// extract INITIAL_ENGINE from main.js without loading electron-dependent main
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
  log('ENGINE len=' + ENGINE.length)
  win.webContents.on('render-process-gone', (_e, d) => log('RENDER-GONE: ' + JSON.stringify(d)))
  const run = (code, label, ms = 12000) => Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))
  ]).catch(e => 'THROW ' + e.message)

  // install the REAL engine
  log('install: ' + await run(ENGINE, 'install'))
  log('setCfg: ' + await run(`JSON.stringify(window.__WA_MULTI_INITIAL_ENGINE__.setCfg({enabled:true,code:'/DM',skipGroups:false,showBadge:true}))`, 'cfg'))
  log('probe: ' + await run(`JSON.stringify(window.__WA_MULTI_INITIAL_ENGINE__.probe())`, 'probe'))

  const clear = () => run(`(function(){ window.__lex.setText(''); window.__lex.root().focus() })()`, 'clear')
  const type = async (t) => { for (const ch of t) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await new Promise(r => setTimeout(r, 30)) } }

  for (let round = 1; round <= 3; round++) {
    await clear()
    await type('halo kak')
    const before = await run(`window.__lex.flat()`, 'before')
    // REAL Enter press — engine's capture listener fires, then Lexical's own handler
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    await new Promise(r => setTimeout(r, 450))
    const after = await run(`JSON.stringify({ flat: window.__lex.flat(), html: window.__lex.html(), st: window.__WA_MULTI_INITIAL_ENGINE__.get() })`, 'after')
    let a; try { a = JSON.parse(after) } catch (_) { a = { flat: after } }
    const pass = /\/DM/.test(a.flat || '')
    log(`r${round} BEFORE=${JSON.stringify(before)}`)
    log(`r${round} AFTER =${JSON.stringify(a.flat)}  method=${a.st && a.st.method}  appended=${a.st && a.st.appended}`)
    log(`r${round} html=${a.html}`)
    log(`r${round} VERDICT: ${pass ? 'PASS — marker persisted' : 'FAIL — marker lost'}`)
  }
  app.exit(0)
})
app.on('window-all-closed', () => {})
