// tests/engine_lid_getter_test.js
//
// REGRESI v2.7.4 — blast mati: "n.UserPrefs.getMeLidUserOrThrow is not a function"
//
// WhatsApp Web MEMBUANG `UserPrefs.getMeLidUserOrThrow`. Bundle wa-js lama manggil getter
// itu TANPA guard → TypeError di jalur kirim → SEMUA blast gagal.
// Fix baru ADA DI 4.8.2 — changelog 4.8.2 (2026-11-18): "conn: fall back to nullable account
// LID getter (#3796)". CATATAN: entry 4.8.0 "tolerate removed LID getter" itu getter LAIN —
// 4.8.0 & 4.8.1 MASIH jebol (diuji: keduanya ngelempar error yang sama).
//
// Tes ini extract fungsi `getMyUserLid` ASLI dari file bundle (bukan nulis ulang),
// jalanin lawan stub UserPrefs yang getter LID-nya udah dibuang, terus assert:
//   - bundle < 4.8.2 → WAJIB ngelempar "... is not a function" (reproduksi bug lapangan)
//   - bundle >= 4.8.2 → WAJIB gak ngelempar (fallback getMaybeMeLidUser jalan)
//
// Pakai: node tests/engine_lid_getter_test.js [path-bundle] (default: vendor kita)

const fs = require('fs')
const path = require('path')

function extractGetMyUserLid (bundlePath) {
  const src = fs.readFileSync(bundlePath, 'utf8')
  const mi = src.indexOf('getMyUserLid=function')
  if (mi < 0) return null
  const before = src.slice(0, mi)
  const starts = [...before.matchAll(/(\d+)\((e,t,r)\)\{/g)]
  if (!starts.length) return null
  const start = starts[starts.length - 1].index + starts[starts.length - 1][0].length
  const after = src.slice(start)
  const endRel = after.search(/\},\d+\((?:e,t,r|e,t)\)\{/)
  if (endRel < 0) return null
  return after.slice(0, endRel)
}

// Stub UserPrefs versi WA Web BARU: getMeLidUserOrThrow DIBUANG, sisain getMaybeMeLidUser
function newWaWebUserPrefs () {
  return { getMaybeMeLidUser: () => '1234567890:5@lid' }
}

function bundleVersion (bundlePath) {
  const m = fs.readFileSync(bundlePath, 'utf8').match(/wa-js v([0-9.]+)/)
  return m ? m[1] : 'unknown'
}

function verGte482 (v) {
  const [a, b, c] = String(v).split('.').map(Number)
  return a > 4 || (a === 4 && (b > 8 || (b === 8 && c >= 2)))
}

function run (bundlePath) {
  const body = extractGetMyUserLid(bundlePath)
  if (!body) return { ver: bundleVersion(bundlePath), ok: false, why: 'getMyUserLid module gak ketemu' }
  const ver = bundleVersion(bundlePath)
  const exportsObj = {}
  const factory = new Function('e', 't', 'r', body) // eslint-disable-line no-new-func
  const fakeRequire = () => ({ UserPrefs: newWaWebUserPrefs() })
  try {
    factory({}, exportsObj, fakeRequire)
    const val = exportsObj.getMyUserLid()
    return { ver, ok: true, val }
  } catch (err) {
    return { ver, ok: false, why: err.message }
  }
}

// ── jalan ───────────────────────────────────────────────────────
const target = process.argv[2] || path.join(__dirname, '..', 'vendor', 'wppconnect-wa.js')
const r = run(target)
const expectOk = verGte482(r.ver) // >= 4.8.2 harus tahan; < 4.8.2 harus jebol

const pass = expectOk ? r.ok === true : r.ok === false

console.log(`bundle = ${target}`)
console.log(`versi  = ${r.ver}`)
console.log(r.ok ? `hasil  = SUKSES, getMyUserLid() → ${JSON.stringify(r.val)}` : `hasil  = ERROR: ${r.why}`)
console.log(`ekspektasi (${expectOk ? '>=4.8.2 harus tahan' : '<4.8.2 harus jebol'}) → ${pass ? 'SESUAI' : 'MENYIMPANG'}`)

if (!pass) {
  console.error('\n❌ TES GAGAL — perilaku bundle gak sesuai harapan')
  process.exit(1)
}
console.log('\n✅ TES LULUS')
