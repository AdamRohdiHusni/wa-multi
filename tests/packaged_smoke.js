// Smoke-test the PACKAGED app tree: run the win-unpacked app's JS stack.
// The win-unpacked is a Windows build, but its app.asar is platform-neutral —
// we mount it against the local Electron + bytenode to prove the bytecode
// loads and the app boots (self-test harness runs from inside the asar).
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_SELFTEST = '1'
process.env.WA_MULTI_LIC_FORCE = 'pro'

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = '/home/suki/server-stack/wa-multi'
const MOUNT = '/tmp/asar-mount'

fs.rmSync(MOUNT, { recursive: true, force: true })
fs.mkdirSync(MOUNT, { recursive: true })
// extract asar (simulates what the packaged app does at require-time)
execSync(`${ROOT}/node_modules/.bin/asar extract ${ROOT}/dist/win-unpacked/resources/app.asar ${MOUNT}`)

// main.js/license.js ship OBFUSCATED — verify they're not readable source
const mainShipped = fs.readFileSync(path.join(MOUNT, 'main.js'), 'utf8')
if (/function ensureEngine|function runBlastJob|const CHROME_UA/.test(mainShipped)) { console.error('LEAK: main.js masih source kebaca!'); process.exit(1) }
console.log('CLEAN: core shipped as obfuscated code (bukan source kebaca)')

// bytenode must be resolvable from the mount → symlink node_modules
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(MOUNT, 'node_modules'))

// run the app (obfuscated main.js) under electron
console.log('RUNNING packaged main (self-test via obfuscated code)...')
const { spawnSync } = require('child_process')
const r = spawnSync('npx', ['electron', '--no-sandbox', path.join(MOUNT, 'main.js')], {
  cwd: MOUNT,
  encoding: 'utf8',
  timeout: 240000,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe']
})
const out = (r.stdout || '') + (r.stderr || '')
const m = out.match(/=====\s*(\d+\/\d+ passed[^=]*)/)
console.log('PACKAGED TEST:', m ? m[1] : 'harness output not found')
console.log(out.split('\n').filter(l => /passed|FAIL/.test(l)).slice(-3).join('\n'))
