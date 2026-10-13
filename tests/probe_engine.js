// Debug: inject the initials engine into the real renderer and report the exact error.
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
  const tryRun = async (label, code) => {
    try { const r = await win.webContents.executeJavaScript(code); out.push(`OK   ${label} → ${JSON.stringify(r)}`) }
    catch (e) { out.push(`ERR  ${label} → ${e.message}`) }
  }
  await tryRun('inject engine', INITIAL_ENGINE)
  await tryRun('typeof', 'typeof window.WAM_INITIAL')
  await tryRun('set cfg', 'window.WAM_INITIAL && window.WAM_INITIAL.set({on:true,code:"DM",skipGroups:true})')
  await tryRun('get cfg', 'window.WAM_INITIAL && window.WAM_INITIAL.get()')
  await tryRun('tag test', `(() => {
    const d = document.createElement('div'); d.contentEditable = 'true';
    document.body.appendChild(d); d.focus(); d.textContent = 'Halo kak';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const t = d.textContent; d.remove(); return t;
  })()`)
  out.push('--- engine first 80 chars: ' + INITIAL_ENGINE.slice(0, 80))
  fs.writeFileSync('/tmp/engine_debug.txt', out.join('\n'))
  app.exit(0)
})