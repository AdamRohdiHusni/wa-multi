// Ground-truth probe for the WINDOWS auto-update path.
//
// Why this exists: on Linux, `require('electron-updater').autoUpdater` auto-selects the
// AppImage updater ("APPIMAGE env is not defined") and never touches the GitHub feed.
// The shipped app is a Windows NSIS build, so we must instantiate NsisUpdater directly —
// that is the exact class the packaged app runs, and it resolves the feed through
// GitHubProvider (GET .../releases/latest/download/latest.yml) + semver compare.
//
// Run: xvfb-run -a npx electron --no-sandbox tests/update_probe.js
const { app } = require('electron')
// Load the package entry FIRST so the whole module graph is initialised; requiring
// NsisUpdater in isolation hits a circular import ("Class extends value undefined").
require('electron-updater')
const { NsisUpdater } = require('electron-updater/out/NsisUpdater')
const path = require('path')
const fs = require('fs')

process.env.WA_MULTI_DEV = '1'

app.whenReady().then(async () => {
  // Read the SAME config electron-builder ships to users (dist/win-unpacked/resources/app-update.yml)
  const shipped = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app-update.yml')
  const cfgSrc = fs.existsSync(shipped) ? shipped : path.join(__dirname, '..', 'dev-app-update.yml')
  console.log('PROBE|config-source|', cfgSrc)
  console.log('PROBE|config-body|', fs.readFileSync(cfgSrc, 'utf8').trim().replace(/\n/g, ' | '))

  // Dev config path so NsisUpdater reads our yml instead of the (absent) installed one
  const devCfg = path.join(__dirname, '..', 'dev-app-update.yml')
  fs.copyFileSync(cfgSrc, devCfg)

  const up = new NsisUpdater()
  up.forceDevUpdateConfig = true
  up.autoDownload = false
  up.autoInstallOnAppQuit = false

  // This probe runs on Linux, but the shipped app is a Windows NSIS build. electron-updater
  // derives the channel filename from the provider's runtimeOptions.platform
  // (linux -> latest-linux.yml, win32 -> latest.yml). Force win32 so we request exactly
  // the file a real Windows install requests.
  const origRuntime = up.createProviderRuntimeOptions.bind(up)
  up.createProviderRuntimeOptions = () => ({ ...origRuntime(), platform: 'win32' })

  // Pretend we are an OLD install (2.5.2) so the feed has to actually offer 2.6.0.
  // An 'update-available' verdict with latest=2.6.0 is the strongest possible proof:
  // it exercises provider resolve + YAML parse + semver compare end-to-end.
  // Both `app.version` (string, used for blockmap/compare) and `currentVersion`
  // (SemVer instance) must agree, otherwise semver throws "Invalid version".
  try {
    // IMPORTANT: use electron-updater's OWN bundled semver instance. A different copy
    // from the top-level node_modules produces a SemVer object that fails the nested
    // module's `instanceof` check -> "Invalid version. Must be a string."
    const semver = require('electron-updater/node_modules/semver')
    Object.defineProperty(up.app, 'version', { value: '2.5.2', configurable: true })
    up.currentVersion = semver.parse('2.5.2')
    up.allowPrerelease = false
    console.log('PROBE|simulated-current| 2.5.2')
  } catch (e) { console.log('PROBE|semver-override-failed|', String(e.message)) }

  up.logger = {
    info: (m) => console.log('UPD|info|', typeof m === 'string' ? m : JSON.stringify(m)),
    warn: (m) => console.log('UPD|warn|', typeof m === 'string' ? m : JSON.stringify(m)),
    error: (m) => console.log('UPD|error|', typeof m === 'string' ? m : JSON.stringify(m)),
    debug: (m) => console.log('UPD|debug|', typeof m === 'string' ? m : JSON.stringify(m))
  }

  let verdict = null
  const finish = (v) => { if (verdict) return; verdict = v; console.log('PROBE_VERDICT ' + JSON.stringify(v)); setTimeout(() => app.exit(0), 300) }

  up.on('checking-for-update', () => console.log('UPD|event| checking-for-update'))
  up.on('update-available', (i) => finish({ ok: true, state: 'update-available', latest: i.version, current: up.currentVersion && up.currentVersion.version }))
  up.on('update-not-available', (i) => finish({ ok: true, state: 'update-not-available', latest: i && i.version, current: up.currentVersion && up.currentVersion.version }))
  up.on('error', (e) => finish({ ok: false, state: 'error', message: String((e && e.message) || e).slice(0, 400) }))

  setTimeout(async () => {
    try {
      console.log('PROBE|currentVersion|', up.currentVersion && up.currentVersion.version)
      const r = await up.checkForUpdates()
      console.log('PROBE|checkForUpdates-returned|', JSON.stringify({ version: r && r.updateInfo && r.updateInfo.version, files: (r && r.updateInfo && r.updateInfo.files || []).map(f => f.url) }))
    } catch (e) {
      finish({ ok: false, state: 'throw', message: String((e && e.message) || e).slice(0, 400) })
    }
  }, 1200)

  setTimeout(() => finish({ ok: false, state: 'timeout', message: 'no verdict within 45s' }), 45000)
})

app.on('window-all-closed', () => {})
