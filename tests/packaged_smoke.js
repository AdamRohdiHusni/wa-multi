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

// prove main.js source is NOT in the shipped payload
if (fs.existsSync(path.join(MOUNT, 'main.js'))) { console.error('LEAK: main.js shipped!'); process.exit(1) }
if (fs.existsSync(path.join(MOUNT, 'license.js'))) { console.error('LEAK: license.js shipped!'); process.exit(1) }
console.log('CLEAN: no main.js / license.js source in shipped payload')

// bytenode must be resolvable from the mount → symlink node_modules
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(MOUNT, 'node_modules'))

// run the bootstrap under electron
console.log('RUNNING packaged bootstrap (self-test via bytecode)...')
const { spawnSync } = require('child_process')
const r = spawnSync('npx', ['electron', '--no-sandbox', path.join(MOUNT, 'index.js')], {
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
