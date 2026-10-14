// REGRESSION E2E — Adam's v2.6.2 field bug (fixed in v2.6.3).
//
// Symptom reported by Adam:
//   "betul kakk ... minimal 2 jam/sesi
//    ⌃DM⌃ dengan SOW 4 Sesi yaaa kakk"          <- tag landed MID-MESSAGE
//
// Root cause: lexAppend() drove the editor through the CURRENT Lexical selection.
// When the caret sat in the middle of a long message, insertLineBreak() split the
// paragraph AT THE CARET, so insertText(marker) landed before the remaining text.
// Every earlier test typed the whole message and hit Enter with the caret already at
// the END — that is why this shipped.
//
// This test drives the REAL Lexical editor and parks the selection mid-text.
// Invariant asserted: the tag is ALWAYS on its own bottom line, regardless of caret.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = '/tmp/lexrepro/MIDCARET_E2E.txt'
const lines = []
let pass = 0, fail = 0
const log = (s) => { console.log(s); lines.push(s) }
const check = (name, ok, detail) => {
  if (ok) pass++; else fail++
  log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''))
}

app.disableHardwareAcceleration()

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const i = src.indexOf('const INITIAL_ENGINE =')
const j = src.indexOf('\n\nconst UPDATER_OWNER', i)
const ENGINE = new Function(src.slice(i, j) + '; return INITIAL_ENGINE')()

const HEAD = 'betul kakk untuk waktu bebas kok kakk untuk durasi nya sendiri minimal 2 jam/sesi'
const TAIL = ' dengan SOW 4 Sesi yaaa kakk'
const MSG = HEAD + TAIL

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1000, height: 600 })
  await win.loadFile('/tmp/lexrepro/index.html')
  for (let k = 0; k < 40; k++) {
    if (await win.webContents.executeJavaScript('window.__ready === true').catch(() => false)) break
    await new Promise(r => setTimeout(r, 400))
  }
  const ready = await win.webContents.executeJavaScript('window.__ready').catch(e => 'ERR ' + e.message)
  check('lexical harness ready', ready === true, String(ready))
  win.webContents.on('render-process-gone', (_e, d) => log('RENDER-GONE: ' + JSON.stringify(d)))

  const run = (code, label, ms = 15000) => Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))
  ]).catch(e => 'THROW ' + e.message)

  log('install: ' + await run(ENGINE, 'install'))
  await run(`window.__WA_MULTI_INITIAL_ENGINE__.setCfg({enabled:true,code:'DM',skipGroups:false})`, 'cfg')

  // Put the message in and park Lexical's REAL selection at `offset`.
  const place = (offset) => run(`(function(){
    var el = window.__lex.root(); el.focus()
    window.__lex.setText(${JSON.stringify(MSG)})
    var ed = el.__lexicalEditor
    ed.update(function(){
      var st = ed._pendingEditorState || ed._editorState
      var root = st._nodeMap.get('root')
      var p = root.getFirstChild(), t = p.getFirstChild()
      t.select(${offset}, ${offset})
    }, {discrete:true})
    var s = ed._editorState._selection
    return JSON.stringify({anchorOff:s.anchor.offset, collapsed:s.isCollapsed()})
  })()`, 'place')

  const fireEnter = () => run(`(function(){
    window.__lex.root().focus()
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}))
    return 'fired'
  })()`, 'enter')

  // The invariant: tag on its own bottom line; message body otherwise intact.
  const assertBottomLine = async (label, offset) => {
    const sel = await place(offset)
    await fireEnter()
    await new Promise(r => setTimeout(r, 500))
    const flat = await run(`window.__lex.flat()`, 'flat')
    const text = await run(`window.__lex.text()`, 'text')
    const parts = flat.split('|BR|')
    const ownLine = parts.some(p => p === 'DM')
    const bodyIntact = text.indexOf(HEAD) === 0
    const noMidSplit = !/jam\/sesiDM|jam\/sesi\s*DM/.test(text)
    check('caret@' + offset + ' (' + label + '): tag on its own line', ownLine, JSON.stringify(flat))
    check('caret@' + offset + ' (' + label + '): message body intact', bodyIntact, JSON.stringify(text.slice(0, 60)))
    check('caret@' + offset + ' (' + label + '): no mid-message split', noMidSplit, JSON.stringify(text))
    return { flat, text, ownLine, noMidSplit }
  }

  log('')
  log('--- selection placed mid-message (the field bug) ---')
  const a = await assertBottomLine('ADAM: caret after "jam/sesi"', HEAD.length)
  const b = await assertBottomLine('caret at START', 0)
  const c = await assertBottomLine('caret at END', MSG.length)
  const d = await assertBottomLine('caret 10 chars in', 10)

  log('')
  log('--- exact reproduction of Adam\'s output must NOT occur ---')
  const adamBug = 'betul kakk untuk waktu bebas kok kakk untuk durasi nya sendiri minimal 2 jam/sesi\nDM dengan SOW 4 Sesi yaaa kakk'
  check('Adam\'s exact broken output is gone', a.text !== adamBug, JSON.stringify(a.text))
  check('tag is the LAST line', a.flat.replace(/\|BR\|$/,'').endsWith('|BR|DM'), JSON.stringify(a.flat))

  log('')
  log('===== ' + pass + '/' + (pass + fail) + ' passed, ' + fail + ' failed =====')
  try { fs.writeFileSync(OUT, lines.join('\n') + '\n') } catch (_) {}
  app.exit(fail ? 1 : 0)
})
app.on('window-all-closed', () => {})
