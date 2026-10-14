// ROUND 7 — GOLD STANDARD COMPARISON.
// A: real user types "halo kak", presses real Shift+Enter, types "/DM" (CDP input events).
// B: our production injection on freshly typed "halo kak".
// If A and B produce the SAME lexical HTML structure, the fix is correct.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const OUT = '/tmp/lexrepro/RESULT7.txt'
const log = (s) => { console.log(s); try { fs.appendFileSync(OUT, s + '\n') } catch (_) {} }
app.disableHardwareAcceleration()
try { fs.writeFileSync(OUT, '') } catch (_) {}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 600 })
  await win.loadFile('/tmp/lexrepro/index.html')
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript('window.__ready === true').catch(() => false)) break
    await new Promise(r => setTimeout(r, 400))
  }
  log('READY: ' + await win.webContents.executeJavaScript('window.__ready').catch(e => 'ERR ' + e.message))
  win.webContents.on('render-process-gone', (_e, d) => log('RENDER-GONE: ' + JSON.stringify(d)))
  const run = (code, label, ms = 12000) => Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))
  ]).catch(e => 'THROW ' + e.message)

  const clear = () => run(`(function(){ window.__lex.setText(''); window.__lex.root().focus() })()`, 'clear')
  const type = async (text, delay = 30) => {
    for (const ch of text) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await new Promise(r => setTimeout(r, delay)) }
  }
  const realShiftEnter = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['shift'] })
    await new Promise(r => setTimeout(r, 60))
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['shift'] })
    await new Promise(r => setTimeout(r, 200))
  }

  const snap = () => run(`JSON.stringify({ html: window.__lex.html(), flat: window.__lex.flat() })`, 'snap')

  // ---- A: pure real user input ----
  log('=== A: REAL user typing ===')
  for (let round = 1; round <= 3; round++) {
    await clear()
    await type('halo kak')
    await realShiftEnter()
    await type('/DM')
    await new Promise(r => setTimeout(r, 400))
    const a = JSON.parse(await snap())
    log(`A r${round}: html=${a.html}`)
    log(`A r${round}: flat=${JSON.stringify(a.flat)}`)
  }

  // ---- B: our production injection ----
  log('=== B: OUR INJECTION ===')
  for (let round = 1; round <= 3; round++) {
    await clear()
    await type('halo kak')
    const res = await run(`(function(){
      var el = window.__lex.root(), ed = el.__lexicalEditor
      var out = { ok: false, err: null }
      try {
        ed.update(function(){
          var sel = ed._pendingEditorState && ed._pendingEditorState._selection
          if (!sel) sel = ed._editorState && ed._editorState._selection
          if (!sel) { out.err = 'no-sel'; return }
          sel.insertLineBreak()
          sel.insertText('/DM')
          out.ok = true
        }, { discrete: true })
      } catch (e) { out.err = String(e && e.message || e) }
      return JSON.stringify(out)
    })()`, 'inject-r' + round)
    await new Promise(r => setTimeout(r, 400))
    const b = JSON.parse(await snap())
    log(`B r${round}: ret=${res} html=${b.html}`)
    log(`B r${round}: flat=${JSON.stringify(b.flat)}`)
  }

  app.exit(0)
})
app.on('window-all-closed', () => {})
