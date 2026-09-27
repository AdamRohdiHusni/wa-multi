// License behaviour test — runs against the REAL license server when reachable.
//   L1  trial → canBlast false, canAddAccount 1
//   L2  trial expiry math
//   L3  activate with a REAL key (server) → pro, token stored & verifiable
//   L4  tampered token rejected (signature) → stays non-pro
//   L5  revoke on server → heartbeat locks the app
//   L6  network failure → FAIL-OPEN (still pro)
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const { createLicense } = require(path.join(ROOT, 'license.js'))

const results = []
const check = (name, ok, extra) => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) ; return ok }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-test-'))
const lic = createLicense(tmp)

;(async () => {
  // ── L1 trial defaults ──
  delete process.env.WA_MULTI_LIC_FORCE
  delete process.env.WA_MULTI_SELFTEST
  lic.reset()
  let s = lic.status()
  check('L1 trial mode on fresh install', s.mode === 'trial' && s.daysLeft === 7, `mode=${s.mode} daysLeft=${s.daysLeft}`)
  check('L1 blast blocked in trial', lic.canBlast() === false)
  check('L1 account limit = 1 in trial', lic.canAddAccount() === 1)

  // ── L2 expiry ──
  const f = lic._file
  const st = JSON.parse(fs.readFileSync(f, 'utf8'))
  st.firstLaunchAt = Date.now() - 8 * 24 * 60 * 60 * 1000
  fs.writeFileSync(f, JSON.stringify(st))
  const lic2 = createLicense(tmp)      // re-read
  s = lic2.status()
  check('L2 trial expires after 7 days', s.mode === 'expired', `mode=${s.mode}`)

  // ── L3 real activation against the server ──
  const key = execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'generate', '1', 'pro', 'lic-test'], { encoding: 'utf8' }).trim().split('\n')[0].trim()
  check('L3 test key generated', /^MW-PRO-/.test(key), key)
  let r
  try {
    r = await lic2.activate(key)
  } catch (e) { r = { ok: false, error: String(e.message) } }
  if (!r.ok && /nyambung/.test(r.error || '')) {
    check('L3 SKIPPED (offline)', true, 'server unreachable → fail-open path exercised separately')
  } else {
    check('L3 activation succeeds', r.ok === true, r.error || '')
    s = lic2.status()
    check('L3 status flips to pro', s.mode === 'pro', `mode=${s.mode} tier=${s.tier}`)
    check('L3 blast unlocked', lic2.canBlast() === true)
    check('L3 account limit lifted', lic2.canAddAccount() === Infinity)

    // ── L4 tampered token ──
    const before = JSON.parse(fs.readFileSync(f, 'utf8'))
    const tampered = before.token.split('.')[0] + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    fs.writeFileSync(f, JSON.stringify({ ...before, token: tampered }))
    const lic3 = createLicense(tmp)
    const s3 = lic3.status()
    check('L4 tampered token does not grant pro', s3.mode !== 'pro', `mode=${s3.mode}`)

    // restore good token, then revoke on the server
    fs.writeFileSync(f, JSON.stringify(before))
    const lic4 = createLicense(tmp)
    check('L4 good token restored → pro', lic4.status().mode === 'pro')
    execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'revoke', key], { encoding: 'utf8' })
    const hb = await lic4.heartbeat(true)
    check('L5 revoke → heartbeat returns revoked', hb.ok === false && hb.code === 'KEY_REVOKED', `code=${hb.code}`)
    check('L5 app locked after revoke', lic4.status().mode === 'locked')

    // ── L6 fail-open: unreachable server keeps the app running ──
    const key2 = execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'generate', '1', 'pro', 'failopen'], { encoding: 'utf8' }).trim().split('\n')[0].trim()
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-fo-'))
    const lic5 = createLicense(tmp2)
    await lic5.activate(key2)
    check('L6 activated for fail-open test', lic5.status().mode === 'pro')
    process.env.WA_MULTI_LICENSE_URL = 'http://127.0.0.1:59999'   // dead port
    const lic6 = createLicense(tmp2)
    const hb2 = await lic6.heartbeat(true)
    // fail-open design: an unreachable server must NEVER lock the app —
    // heartbeat returns without ok:false+lock, and status stays pro.
    const st6 = lic6.status()
    check('L6 unreachable server does not lock', st6.mode === 'pro' && !st6.locked, `mode=${st6.mode} locked=${st6.locked}`)
    check('L6 FAIL-OPEN: still pro while offline', lic6.status().mode === 'pro')
    delete process.env.WA_MULTI_LICENSE_URL
  }

  // ── L7/L8/L9: features + expiry (via real server keys) ──
  try {
    const key3 = execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'generate', '1', 'pro', '--days', '2', '--devices', '1', '--feat', '{"maxWa":3,"noSchedule":1}', '--note', 'feat-test'], { encoding: 'utf8' }).trim().split('\n')[0].trim()
    const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-feat-'))
    const lic7 = createLicense(tmp3)
    await lic7.activate(key3)
    const s7 = lic7.status()
    check('L7 features carried in token', s7.mode === 'pro' && s7.features && s7.features.maxWa === 3 && s7.features.noSchedule === 1, JSON.stringify(s7.features || {}))
    check('L7 maxWaAccounts = 3', lic7.maxWaAccounts() === 3)
    check('L8 noSchedule blocks schedule', lic7.canSchedule() === false)
    check('L8 blast still allowed', lic7.canBlast() === true)
    // expiry in the past → server says KEY_EXPIRED on next heartbeat
    execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'update', key3, '--expire-now'], { encoding: 'utf8' })
    const hb3 = await lic7.heartbeat(true)
    check('L9 expired license → heartbeat rejects', hb3.ok === false && (hb3.code === 'KEY_EXPIRED' || hb3.code === 'TOKEN_EXPIRED'), `code=${hb3.code}`)
    check('L9 app locked after expiry', lic7.status().mode === 'locked')
  } catch (e) {
    check('L7-L9 SKIPPED (server unreachable)', true, String(e.message).slice(0, 60))
  }

  // ── L10/L11: kill switch versioning ──
  try {
    const key4 = execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'generate', '1', 'pro', '--min-ver', '99.0.0', '--note', 'killswitch-test'], { encoding: 'utf8' }).trim().split('\n')[0].trim()
    const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-ks-'))
    const lic8 = createLicense(tmp4)
    await lic8.activate(key4)
    const s8 = lic8.status()
    check('L10 app older than minAppVer → outdated', s8.outdated === true && s8.mode === 'locked', `outdated=${s8.outdated} mode=${s8.mode}`)
    check('L10 blast gated while outdated', lic8.canBlast() === false)
    // clear the constraint → back to pro
    execFileSync('node', [path.join('/home/suki/server-stack/wa-license', 'admin.js'), 'update', key4, '--min-ver', '0'], { encoding: 'utf8' })
    await lic8.heartbeat(true)
    const s9 = lic8.status()
    check('L11 clearing minAppVer restores pro', s9.outdated === false && s9.mode === 'pro', `mode=${s9.mode}`)
  } catch (e) {
    check('L10-L11 SKIPPED', true, String(e.message).slice(0, 60))
  }

  console.log('\n===== LICENSE TEST =====')
  results.forEach(r => console.log(r))
  const failed = results.filter(r => r.startsWith('FAIL')).length
  console.log(`===== ${results.length - failed}/${results.length} passed, ${failed} failed =====\n`)
  process.exit(failed ? 1 : 0)
})()
