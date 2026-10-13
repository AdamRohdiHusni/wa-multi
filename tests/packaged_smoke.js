// Smoke-test the PACKAGED app: extract app.asar and boot the OBFUSCATED main.js
// under Electron's own runtime, then read the self-test verdict from stdout.
// Proves: (a) obfuscated code actually runs, (b) electron-updater ships, (c) all checks pass.
//
// ⚠️ NEVER run `asar extract-file <asar> main.js` from the repo root — asar writes the
// extracted file to the CURRENT WORKING DIRECTORY (ignoring the 3rd arg) and will
// silently overwrite the real source main.js with the obfuscated build. Always
// `asar extract` into a scratch dir (as below), or pass an explicit output dir.
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_SELFTEST = '1'
process.env.WA_MULTI_LIC_FORCE = 'pro'

const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = '/home/suki/server-stack/wa-multi'
const MOUNT = '/tmp/asar-mount'

fs.rmSync(MOUNT, { recursive: true, force: true })
fs.mkdirSync(MOUNT, { recursive: true })
execSync(`${ROOT}/node_modules/.bin/asar extract ${ROOT}/dist/win-unpacked/resources/app.asar ${MOUNT}`)

// 1. obfuscated, not readable source
const mainShipped = fs.readFileSync(path.join(MOUNT, 'main.js'), 'utf8')
if (/function ensureEngine|function runBlastJob|const CHROME_UA/.test(mainShipped)) {
  console.error('LEAK: main.js masih source kebaca!'); process.exit(1)
}
console.log('CLEAN: core shipped obfuscated (bukan source kebaca)')

// 2. electron-updater must be inside the asar or auto-update crashes at runtime
const upd = path.join(MOUNT, 'node_modules/electron-updater/out/main.js')
if (!fs.existsSync(upd)) { console.error('FATAL: electron-updater tidak ada di asar → auto-update crash'); process.exit(1) }
console.log('CLEAN: electron-updater bundled in asar')

// 3. electron must resolve from the mount (deps live outside the asar for a real install).
// The asar already contains node_modules/electron-updater; the extract leaves a real dir
// there, so swap it for a symlink to the full root node_modules (adds electron itself).
const nm = path.join(MOUNT, 'node_modules')
fs.rmSync(nm, { recursive: true, force: true })
fs.symlinkSync(path.join(ROOT, 'node_modules'), nm, 'dir')

console.log('RUNNING packaged main (self-test via obfuscated code)...')
// Boot the MOUNT as the app directory (not `electron main.js`): Electron then reads
// MOUNT/package.json, so app.getVersion() returns 2.6.0 like a real install would.
const r = spawnSync('npx', ['electron', '--no-sandbox', MOUNT], {
  cwd: MOUNT, encoding: 'utf8', timeout: 300000, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe']
})
const out = (r.stdout || '') + (r.stderr || '')
const m = out.match(/=====\s*(\d+\/\d+ passed[^=]*)/)
console.log('PACKAGED TEST:', m ? m[1] : 'harness output not found')
if (!m) console.log(out.slice(-2000))
const fails = out.split('\n').filter(l => l.startsWith('FAIL'))
if (fails.length) console.log('FAILURES:\n' + fails.join('\n'))
