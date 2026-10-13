// Debug 2: capture the EXACT error from injecting the engine string
process.env.WA_MULTI_DEV = '1'
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')
const m = src.match(/const INITIAL_ENGINE = \[[\s\S]*?\]\.join\(''\)/)
let INITIAL_ENGINE = ''
eval(m[0].replace('const INITIAL_ENGINE', 'INITIAL_ENGINE'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(path.join(ROOT, 'index.html'))
  await new Promise(r => setTimeout(r, 800))
  const out = []
  // wrap: build a function inside the page and call it, capturing the error
  const wrapped = `(function(){ try { return { ok: true, val: (function(){${INITIAL_ENGINE}})() } }
    catch (e) { return { ok: false, err: String(e && e.stack || e) } } })()`
  try {
    const r = await win.webContents.executeJavaScript(wrapped)
    out.push('WRAPPED RESULT: ' + JSON.stringify(r, null, 1))
  } catch (e) { out.push('WRAPPED THREW: ' + e.message) }
  // also test a trivial IIFE returning a string
  try {
    const r2 = await win.webContents.executeJavaScript(`(function(){return 'plain-ok'})()`)
    out.push('TRIVIAL IIFE: ' + JSON.stringify(r2))
  } catch (e) { out.push('TRIVIAL IIFE THREW: ' + e.message) }
  fs.writeFileSync('/tmp/engine_debug2.txt', out.join('\n'))
  app.exit(0)
})