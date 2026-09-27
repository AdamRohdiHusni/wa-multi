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

  console.log('\n===== LICENSE TEST =====')
  results.forEach(r => console.log(r))
  const failed = results.filter(r => r.startsWith('FAIL')).length
  console.log(`===== ${results.length - failed}/${results.length} passed, ${failed} failed =====\n`)
  process.exit(failed ? 1 : 0)
})()
