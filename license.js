// ═══════════════════════════════════════════════════════════════
// license.js — client-side licensing for the WA Multi app
//
// Model:
//   • TRIAL: 7 days from first launch, 1 WA account, blast+schedule LOCKED
//   • ACTIVATED: key bound to this machine, signed token cached locally,
//     works fully offline; heartbeat every 7 days (grace 14 days offline)
//   • FAIL-OPEN: any network/parse failure keeps the app running. The app
//     only locks when the server explicitly says the key is dead.
// ═══════════════════════════════════════════════════════════════
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const LICENSE_URL = process.env.WA_MULTI_LICENSE_URL || 'https://license.mysuki.web.id'
const TRIAL_DAYS = Number(process.env.WA_MULTI_TRIAL_DAYS || 7)
const HEARTBEAT_EVERY = 7 * 24 * 60 * 60 * 1000   // 7 days
const OFFLINE_GRACE = 14 * 24 * 60 * 60 * 1000     // 14 days
// get the app's own version from package.json (works both dev & packaged)
let APP_VERSION = '0.0.0'
try { APP_VERSION = require('./package.json').version } catch (_) {}

function cmpSemver (a, b) {
  const pa = String(a || '0').split('.').map(Number)
  const pb = String(b || '0').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

const PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzfk7YR89A0+YIEX1nscHWUYaWlvz5eN1zabWZsQM1tM=
-----END PUBLIC KEY-----`

function machineId () {
  // Windows MachineGuid (survives app reinstall; changes on OS reinstall only)
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true })
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
      if (m) return crypto.createHash('sha256').update(m[1]).digest('hex').slice(0, 32)
    }
  } catch (_) {}
  // fallback: stable per-user hash (hostname + platform + homedir)
  return crypto.createHash('sha256').update(`${os.hostname()}|${process.platform}|${os.homedir()}`).digest('hex').slice(0, 32)
}

function createLicense (userDataDir) {
  const FILE = path.join(userDataDir, 'license.json')
  let st = readState()

  function readState () {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { return {} }
  }
  function writeState (s) { try { fs.writeFileSync(FILE, JSON.stringify(s, null, 2)) } catch (_) {} }

  function firstLaunchAt () {
    if (!st.firstLaunchAt) { st.firstLaunchAt = Date.now(); writeState(st) }
    return st.firstLaunchAt
  }

  function verifyToken (token) {
    try {
      const [bodyB64, sigB64] = String(token).split('.')
      const ok = crypto.verify(null, Buffer.from(bodyB64), crypto.createPublicKey(PUBKEY), Buffer.from(sigB64, 'base64url'))
      if (!ok) return null
      return JSON.parse(Buffer.from(bodyB64, 'base64url').toString())
    } catch (_) { return null }
  }

  function status () {
    const mid = machineId()
    const now = Date.now()
    // test/dev override: WA_MULTI_LIC_FORCE=pro|trial|expired|locked
    // (self-test defaults to 'pro' so the app-level suites exercise real features)
    const forced = process.env.WA_MULTI_LIC_FORCE || (process.env.WA_MULTI_SELFTEST ? 'pro' : null)
    if (forced) {
      if (forced === 'pro') return { mode: 'pro', tier: 'pro', key: 'TEST-PRO', locked: false, machineId: mid, daysLeft: null, forced: true }
      if (forced === 'trial') return { mode: 'trial', daysLeft: 5, machineId: mid, forced: true }
      if (forced === 'expired') return { mode: 'expired', daysLeft: 0, machineId: mid, forced: true }
      if (forced === 'locked') return { mode: 'locked', locked: true, machineId: mid, forced: true }
    }
    // ── activated? ──
    if (st.token) {
      const payload = verifyToken(st.token)
      if (payload && payload.machineId === mid) {
        const offlineFor = now - (st.lastCheckAt || payload.iat || now)
        const locked = !!st.locked            // set only when server said dead
        const stale = offlineFor > OFFLINE_GRACE
        const licExpired = !!(payload.licExp && now > payload.licExp)
        // kill switch versioning: app lebih tua dari minAppVer → downgrade ke trial
        const outdated = !!(payload.minAppVer && cmpSemver(APP_VERSION, payload.minAppVer) < 0)
        const feat = payload.features || {}
        // feature gating: noBlast (multi-akun doang) < noSchedule < maxWa
        const mode = (locked || licExpired || outdated) ? 'locked' : 'pro'
        return {
          mode,
          outdated,
          minAppVer: payload.minAppVer || null,
          tier: payload.tier || 'basic',
          key: payload.key,
          locked,
          licExpired,
          licExp: payload.licExp || null,
          features: feat,                     // {noSchedule, noBlast, maxWa}
          offlineFor,
          stale,                              // warn in UI, still runs (fail-open)
          machineId: mid,
          daysLeft: null
        }
      }
    }
    // ── trial ──
    const started = firstLaunchAt()
    const elapsed = now - started
    const msLeft = TRIAL_DAYS * 24 * 60 * 60 * 1000 - elapsed
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
    if (msLeft <= 0) return { mode: 'expired', daysLeft: 0, machineId: mid, canBlast: false }
    return { mode: 'trial', daysLeft, machineId: mid }
  }

  // blast/schedule allowed only in pro (and not disabled per feature)
  function canBlast () {
    const s = status()
    if (s.mode !== 'pro') return false
    if (s.features && s.features.noBlast) return false
    return true
  }
  function canSchedule () {
    const s = status()
    return s.mode === 'pro' && !(s.features && s.features.noSchedule)
  }
  function maxWaAccounts () {
    const s = status()
    if (s.mode !== 'pro') return 1
    return (s.features && s.features.maxWa) ? s.features.maxWa : Infinity
  }
  const canAddAccount = () => {
    const s = status()
    return s.mode === 'pro' ? Infinity : 1   // trial: 1 WA account max
  }

  async function post (pathname, body) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15000)
    try {
      const r = await fetch(LICENSE_URL + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal
      })
      return await r.json()
    } finally { clearTimeout(t) }
  }

  async function activate (key) {
    const mid = machineId()
    let res
    try {
      res = await post('/activate', { key: String(key || '').trim().toUpperCase(), machineId: mid, machineName: os.hostname() })
    } catch (e) {
      return { ok: false, error: 'Gak bisa nyambung ke server lisensi. Cek internet lu, terus coba lagi.' }
    }
    if (!res.ok) {
      const msg = {
        KEY_NOT_FOUND: 'Key gak dikenali. Cek lagi huruf/angkanya (typo sering: O vs 0, I vs 1).',
        KEY_REVOKED: 'Key ini udah dinonaktifin. Hubungi penjual.',
        DEVICE_LIMIT: `Key ini udah kepake di ${res.maxDevices} laptop. Hubungi penjual kalau mau pindah laptop.`,
        BAD_REQUEST: 'Data aktivasi gak lengkap. Coba lagi.'
      }[res.code] || `Aktivasi gagal (${res.code || 'unknown'}).`
      return { ok: false, error: msg, code: res.code }
    }
    st.token = res.token
    st.lastCheckAt = Date.now()
    st.locked = false
    st.key = String(key).trim().toUpperCase()
    writeState(st)
    return { ok: true, tier: res.tier, status: status() }
  }

  async function heartbeat (force = false) {
    if (!st.token) return { ok: false, skipped: 'no token' }
    const now = Date.now()
    if (!force && now - (st.lastCheckAt || 0) < HEARTBEAT_EVERY) return { ok: true, skipped: 'not due' }
    try {
      const res = await post('/heartbeat', { token: st.token })
      if (res.ok) {
        st.token = res.token || st.token       // rolling refresh
        st.lastCheckAt = now
        st.locked = false
        writeState(st)
        return { ok: true, status: status() }
      }
      // server explicitly rejected → real lock (revoked / expired / bad sig)
      if (['KEY_REVOKED', 'KEY_EXPIRED', 'KEY_NOT_FOUND', 'BAD_SIGNATURE', 'TOKEN_EXPIRED', 'BAD_TOKEN'].includes(res.code)) {
        st.locked = true
        st.lockReason = res.code
        writeState(st)
        return { ok: false, code: res.code, status: status() }
      }
      return { ok: false, code: res.code, unreachable: true }  // fail-open
    } catch (_) {
      st.lastCheckAt = st.lastCheckAt || now
      writeState(st)
      return { ok: false, unreachable: true }                  // fail-open
    }
  }

  async function deactivate () {
    try { await post('/deactivate', { key: st.key, machineId: machineId() }) } catch (_) {}
    st.token = null; st.key = null; st.locked = false
    writeState(st)
    return { ok: true, status: status() }
  }

  function reset () { st = {}; writeState(st); return status() }   // self-test helper

  return { status, activate, heartbeat, deactivate, canBlast, canSchedule, maxWaAccounts, canAddAccount, machineId, reset, _st: () => st, _file: FILE }
}

module.exports = { createLicense, machineId }
