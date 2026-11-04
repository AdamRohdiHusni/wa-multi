// server-agent.js — WA Multi Server Agent (headless)
// Jalan di server (Xvfb), pegang sesi WA yang di-migrasi dari laptop.
// Expose HTTP API: /health /status /blast /stop /history
// License: reuse license.js (owner key) — mode pro.
const { app, BrowserWindow, WebContentsView } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')

const USERDATA = process.env.WA_MULTI_SRV_USERDATA || '/home/suki/wa-multi-server'
const ACCOUNT_ID = process.env.WA_MULTI_SRV_ACCOUNT || 'acc-muqzkzjdi2fu'
const ACCOUNT_NAME = process.env.WA_MULTI_SRV_NAME || 'Sweety 35'
const PORT = parseInt(process.env.WA_MULTI_SRV_PORT || '8790', 10)
const DELAY_MS = parseInt(process.env.WA_MULTI_SRV_DELAY || '25000', 10)
const DAILY_CAP = parseInt(process.env.WA_MULTI_SRV_CAP || '50', 10)
const WAJS_BUNDLE = fs.readFileSync(path.join(__dirname, 'vendor', 'wppconnect-wa.js'), 'utf8')
// versi bundle wa-js — biar gampang cek ini engine versi berapa (blast jebol = sering
// gara-gara bundle ketinggalan, lihat changelog wa-js 4.7.1: WhatsApp moved prepRawMedia)
const ENGINE_VER = (WAJS_BUNDLE.match(/wa-js v([0-9.]+)/) || [, 'unknown'])[1]

const HISTORY_FILE = path.join(USERDATA, 'agent-history.json')
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.setPath('userData', USERDATA)

const wait = (ms) => new Promise(r => setTimeout(r, ms))
const todayKey = () => new Date().toISOString().slice(0, 10)

function loadHistory () { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) } catch (_) { return [] } }
function saveHistory (h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2)) }
const history = loadHistory()

function sentToday () {
  const d = todayKey()
  return history.filter(h => h.date === d && h.status === 'sent').length
}
function log (msg) { const l = `[${new Date().toISOString()}] ${msg}`; console.log(l) }

// ── Engine (dari main.js, verified) ─────────────────────────────
async function ensureEngine (view, timeoutMs = 60000) {
  const wc = view.webContents
  const already = await wc.executeJavaScript('!!(window.WPP && window.WPP.isInjected)').catch(() => false)
  if (already) return { ok: true, injected: false }
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ready = await wc.executeJavaScript('!!(window.webpackChunkwhatsapp_webpack_modules || window.require)').catch(() => false)
    if (ready) break
    await wait(1000)
  }
  await wc.executeJavaScript(WAJS_BUNDLE).catch(() => {})
  const t1 = Date.now()
  while (Date.now() - t1 < timeoutMs) {
    const ok = await wc.executeJavaScript('!!(window.WPP && window.WPP.isInjected)').catch(() => false)
    if (ok) return { ok: true, injected: true }
    await wait(1000)
  }
  return { ok: false, injected: true }
}

async function isAuthenticated (view) {
  if (!view) return false
  return view.webContents.executeJavaScript(`(async () => {
    try {
      if (window.WPP && window.WPP.conn && typeof window.WPP.conn.isAuthenticated === 'function') {
        return !!(await window.WPP.conn.isAuthenticated())
      }
      const qr = document.querySelector('div[data-ref], canvas[aria-label*="Scan"]')
      const shell = document.querySelector('#side, [data-testid="chat-list"], .app-wrapper-web.two')
      return !qr && !!shell
    } catch (e) { return false }
  })()`).catch(() => false)
}

function normalizePhone (phone) {
  let d = String(phone || '').replace(/[^0-9]/g, '')
  if (!d) return null
  if (d.startsWith('0')) d = '62' + d.slice(1)
  else if (d.startsWith('8') && d.length <= 13) d = '62' + d
  if (d.length < 8) return null
  return d
}
function toJid (phone) { const d = normalizePhone(phone); return d ? d + '@c.us' : null }

function resolveMessage (template, target, fallbackCustom) {
  const custom = (target && target.custom) || fallbackCustom || ''
  return String(template || '')
    .replace(/\{nama\}/gi, (target && target.name) || '')
    .replace(/\{name\}/gi, (target && target.name) || '')
    .replace(/\{nomor\}/gi, (target && (target.phone || target.jid)) || '')
    .replace(/\{phone\}/gi, (target && (target.phone || target.jid)) || '')
    .replace(/\{custom\}/gi, custom)
    .replace(/\{kustom\}/gi, custom)
}

const SEND_TIMEOUT = 60000
function withTimeout (p, ms, errMsg) {
  return Promise.race([Promise.resolve(p), new Promise(resolve => setTimeout(() => resolve({ ok: false, error: errMsg }), ms))])
}
async function sendText (view, jid, text) {
  return withTimeout(view.webContents.executeJavaScript(`(async () => {
    try {
      await window.WPP.chat.sendTextMessage(${JSON.stringify(jid)}, ${JSON.stringify(text)}, { createChat: true, waitForAck: false })
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0,200) } }
  })()`).catch(e => ({ ok: false, error: String(e).slice(0, 200) })), SEND_TIMEOUT, 'timeout: WA gak selesai kirim dalam 60 dtk')
}

// ── State ───────────────────────────────────────────────────────
let view = null
let win = null   // v2.7.0 — di-hoist biar bisa diakses handler /migrate (rebuild view)
let activeJob = null
let bootLog = []

// v2.7.0 — bikin (atau bikin ulang) view WA dari partition yang ada di disk.
// Dipakai saat boot DAN setelah /migrate (sesi baru masuk).
function buildView () {
  if (view) { try { win.contentView.removeChildView(view); view.webContents.close() } catch (_) {} view = null }
  view = new WebContentsView({
    webPreferences: {
      partition: 'persist:wa-' + ACCOUNT_ID,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  view.webContents.setUserAgent(CHROME_UA)
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
  view.webContents.loadURL('https://web.whatsapp.com', { userAgent: CHROME_UA })
  return view
}

// v2.7.3 — CRITICAL: sesi dobel-pegang. Kalau sesi akun ini lagi dipegang LAPTOP
// (flag `released-<id>` ada), server TIDAK BOLEH membangun view dari partition —
// dulu boot selalu buildView() tanpa cek flag, jadi setelah reboot server nyamber
// sesi balik diam-diam padahal laptop juga login → 2 perangkat pegang sesi WA yang
// sama (WhatsApp nendang salah satu) DAN dua-duanya saling nolak blast:
//   laptop  → guard "akun lagi di server"
//   server  → 409 "sesi udah ditarik ke laptop"
// Akibatnya Adam lapor "ga bisa blast" + "ga masukin ke server" di waktu yang sama.
function isReleased () { return fs.existsSync(path.join(USERDATA, 'released-' + ACCOUNT_ID)) }

// ── HTTP API ────────────────────────────────────────────────────
function json (res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b) }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  try {
    if (req.method === 'GET' && u.pathname === '/health') {
      const authed = view ? await isAuthenticated(view) : false
      const released = fs.existsSync(path.join(USERDATA, 'released-' + ACCOUNT_ID))
      return json(res, 200, { ok: true, account: ACCOUNT_NAME, accountId: ACCOUNT_ID, authed, released, hasView: !!view, sentToday: sentToday(), cap: DAILY_CAP, engineVer: ENGINE_VER, job: activeJob ? { id: activeJob.id, status: activeJob.status, sent: activeJob.sent, failed: activeJob.failed, total: activeJob.total } : null, boot: bootLog.slice(-5) })
    }
    if (req.method === 'GET' && u.pathname === '/status') {
      const authed = view ? await isAuthenticated(view) : false
      const released = fs.existsSync(path.join(USERDATA, 'released-' + ACCOUNT_ID))
      return json(res, 200, { ok: true, authed, released, hasView: !!view, account: ACCOUNT_NAME, accountId: ACCOUNT_ID, sentToday: sentToday(), cap: DAILY_CAP, engineVer: ENGINE_VER, history: history.slice(-20) })
    }
    if (req.method === 'POST' && u.pathname === '/blast') {
      if (activeJob) return json(res, 409, { ok: false, error: 'blast lagi jalan' })
      let body = ''
      for await (const c of req) body += c
      let data = {}
      try { data = JSON.parse(body) } catch (_) { return json(res, 400, { ok: false, error: 'body bukan JSON' }) }
      const targets = Array.isArray(data.targets) ? data.targets : []
      const message = String(data.message || '')
      const delaySec = parseInt(data.delaySec || String(DELAY_MS / 1000), 10)
      const cap = parseInt(data.cap || String(DAILY_CAP), 10)
      if (!targets.length || !message) return json(res, 400, { ok: false, error: 'targets & message wajib' })
      // v2.7.1 — sesi udah dilepas ke laptop → jangan blast dari server
      if (fs.existsSync(path.join(USERDATA, 'released-' + ACCOUNT_ID))) {
        return json(res, 409, { ok: false, error: 'sesi udah ditarik ke laptop — kirim balik dulu ke server' })
      }
      if (!(await isAuthenticated(view))) return json(res, 409, { ok: false, error: 'akun belum login di server' })
      const job = { id: 'job-' + Date.now().toString(36), status: 'running', targets, message, sent: 0, failed: 0, total: targets.length, delayMs: delaySec * 1000, cap, stop: false, startedAt: Date.now() }
      activeJob = job
      log(`BLAST_START ${job.id} total=${job.total} delay=${delaySec}s cap=${cap}`)
      ;(async () => {
        try {
          for (const t of targets) {
            if (job.stop) break
            if (sentToday() >= cap) { job.status = 'capped'; log('BLAST_CAPPED cap=' + cap); break }
            const jid = toJid(t.phone || t.jid || t.nomor)
            if (!jid) { job.failed++; continue }
            const text = resolveMessage(message, t, data.custom)
            const r = await sendText(view, jid, text)
            const rec = { date: todayKey(), ts: Date.now(), jid, name: t.name || '', status: r.ok ? 'sent' : 'failed', error: r.error || '' }
            history.push(rec)
            if (r.ok) job.sent++; else job.failed++
            log(`BLAST_SEND ${r.ok ? 'OK' : 'FAIL'} ${jid} ${t.name || ''}${r.error ? ' :: ' + r.error : ''}`)
            if (job.sent + job.failed < job.total && !job.stop) await wait(job.delayMs)
          }
        } catch (e) { log('BLAST_ERR ' + e.message) }
        if (job.status === 'running') job.status = 'done'
        saveHistory(history)
        activeJob = null
        log(`BLAST_DONE ${job.id} sent=${job.sent} failed=${job.failed} status=${job.status}`)
      })()
      return json(res, 202, { ok: true, jobId: job.id, total: job.total })
    }
    if (req.method === 'POST' && u.pathname === '/stop') {
      if (activeJob) { activeJob.stop = true; log('BLAST_STOP requested') }
      return json(res, 200, { ok: true })
    }
    // v2.7.3 — "kirim balik ke server": hapus flag released → server pegang sesi
    // lagi (view dibangun + engine). Dipanggil dari panel Server di laptop pas user
    // pilih "tarik balik ke server" — lawan dari /pull.
    if (req.method === 'POST' && u.pathname === '/reclaim') {
      if (isReleased()) {
        try { fs.unlinkSync(path.join(USERDATA, 'released-' + ACCOUNT_ID)) } catch (_) {}
        log('RECLAIM sesi diambil balik oleh server')
        if (!view) { buildView(); log('RECLAIM view dibangun') }
        ;(async () => {
          for (let i = 0; i < 40; i++) {
            await wait(5000)
            try {
              if (view && await isAuthenticated(view)) { await ensureEngine(view, 60000); log('ENGINE OK (post-reclaim)'); break }
            } catch (_) {}
          }
        })()
        return json(res, 200, { ok: true, note: 'sesi diambil balik — server pegang lagi' })
      }
      return json(res, 200, { ok: true, note: 'sesi emang udah di server' })
    }
    if (req.method === 'GET' && u.pathname === '/whoami') {
      const authed = view ? await isAuthenticated(view) : false
      const info = view ? await view.webContents.executeJavaScript(`(async () => {
        try {
          const eng = !!(window.WPP && window.WPP.isInjected)
          let me = null
          try { me = await window.WPP.conn.getMyUserWid() } catch (e) {}
          return { engine: eng, me: me ? (me._serialized || me.user || String(me)) : null }
        } catch (e) { return { err: String(e).slice(0,150) } }
      })()`).catch(e => ({ err: String(e).slice(0, 150) })) : {}
      return json(res, 200, { ok: true, authed, ...info })
    }
    if (req.method === 'POST' && u.pathname === '/selftest') {
      if (!view) return json(res, 503, { ok: false, error: 'view belum siap' })
      const authed = await isAuthenticated(view)
      if (!authed) return json(res, 409, { ok: false, error: 'belum login' })
      let body = ''
      for await (const c of req) body += c
      let data = {}; try { data = JSON.parse(body || '{}') } catch (_) {}
      const eng = await ensureEngine(view, 60000)
      const result = await view.webContents.executeJavaScript(`(async () => {
        try {
          const me = await window.WPP.conn.getMyUserWid()
          const myJid = me && (me._serialized || (me.user + '@c.us'))
          const txt = ${JSON.stringify('✅ Tes WA Multi Server — pesan ini dikirim dari SERVER (bukan laptop). Balas apa saja buat konfirmasi.')}
          await window.WPP.chat.sendTextMessage(myJid, txt, { createChat: true, waitForAck: false })
          return { ok: true, myJid, sentTo: myJid }
        } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0,250) } }
      })()`).catch(e => ({ ok: false, error: String(e).slice(0, 250) }))
      log('SELFTEST ' + JSON.stringify(result))
      return json(res, 200, { ok: !!result.ok, engine: eng.ok, ...result })
    }
    if (req.method === 'GET' && u.pathname === '/history') {
      return json(res, 200, { ok: true, history: history.slice(-50) })
    }
    // ── v2.7.0 — terima sesi hasil migrasi dari laptop (raw gzip tar) ──
    if (req.method === 'POST' && u.pathname === '/migrate') {
      const accountId = req.headers['x-account-id']
      if (!accountId || !/^[a-z0-9-]+$/i.test(accountId)) return json(res, 400, { ok: false, error: 'X-Account-Id tidak valid' })
      const tmp = path.join(USERDATA, 'incoming-' + accountId + '.tar.gz')
      const out = fs.createWriteStream(tmp)
      let bytes = 0
      req.on('data', c => { bytes += c.length })
      req.pipe(out)
      out.on('finish', async () => {
        try {
          if (bytes < 100000) { fs.unlinkSync(tmp); return json(res, 400, { ok: false, error: 'arsip terlalu kecil (' + bytes + ' B)' }) }
          const destRoot = path.join(USERDATA, 'Partitions')
          const dest = path.join(destRoot, 'wa-' + accountId)
          // 1) MATIKAN view DULU — Chromium nahan handle IndexedDB/SharedStorage.
          //    Swap folder pas view hidup = sesi korup (kejadian nyata 30 Okt).
          if (view) { try { win.contentView.removeChildView(view); view.webContents.close() } catch (_) {} view = null }
          await wait(2500)   // kasih waktu Chromium lepas file handle
          // 2) ekstrak ke temp, baru tukar
          const stage = path.join(USERDATA, 'stage-' + accountId)
          fs.rmSync(stage, { recursive: true, force: true })
          fs.mkdirSync(stage, { recursive: true })
          const { execFileSync } = require('child_process')
          execFileSync('tar', ['-xzf', tmp, '-C', stage], { stdio: 'pipe' })
          const inner = path.join(stage, 'wa-' + accountId)
          const src = fs.existsSync(inner) ? inner : stage
          // tahan folder lama sebagai cadangan (jangan langsung hapus)
          const backup = path.join(USERDATA, 'Partitions', 'wa-' + accountId + '.bak')
          try { fs.rmSync(backup, { recursive: true, force: true }) } catch (_) {}
          if (fs.existsSync(dest)) fs.renameSync(dest, backup)
          fs.renameSync(src, dest)
          fs.rmSync(stage, { recursive: true, force: true })
          execFileSync('chmod', ['-R', 'u+rwX', dest], { stdio: 'pipe' })
          fs.unlinkSync(tmp)
          // v2.7.1 — sesi diterima lagi → hapus penanda "released" (server megang lagi)
          try { fs.unlinkSync(path.join(USERDATA, 'released-' + accountId)) } catch (_) {}
          log(`MIGRATE_IN ${accountId} ${bytes} bytes`)
          // 3) bangun ulang view dari sesi baru, lalu re-inject engine setelah login
          buildView()
          ;(async () => {
            for (let i = 0; i < 40; i++) {
              await wait(5000)
              try {
                if (view && await isAuthenticated(view)) { await ensureEngine(view, 60000); log('ENGINE OK (post-migrate)'); break }
              } catch (_) {}
            }
          })()
          json(res, 200, { ok: true, accountId, bytes, note: 'sesi diterima — view dibangun ulang' })
        } catch (e) {
          log('MIGRATE_ERR ' + e.message)
          json(res, 500, { ok: false, error: String(e.message).slice(0, 200) })
        }
      })
      out.on('error', e => json(res, 500, { ok: false, error: e.message }))
      return
    }
    // ── v2.7.0 — kirim sesi balik ke laptop (tar.gz) ──
    if (req.method === 'GET' && u.pathname.startsWith('/pull/')) {
      const accountId = decodeURIComponent(u.pathname.slice('/pull/'.length))
      if (!/^[a-z0-9-]+$/i.test(accountId)) return json(res, 400, { ok: false, error: 'accountId tidak valid' })
      const partDir = path.join(USERDATA, 'Partitions', 'wa-' + accountId)
      if (!fs.existsSync(partDir)) return json(res, 404, { ok: false, error: 'sesi gak ada di server' })
      const tarPath = path.join(USERDATA, 'outgoing-' + accountId + '.tar.gz')
      try {
        // MATIKAN view DULU — sama kayak /migrate. Tar pas view hidup = Chromium
        // nahan handle IndexedDB/SharedStorage → tar bisa error / file ke-skip =
        // sesi korup (kejadian nyata 30 Okt di arah migrate).
        if (view) { try { win.contentView.removeChildView(view); view.webContents.close() } catch (_) {} view = null }
        await wait(2500)   // kasih waktu Chromium lepas file handle
        const { execFileSync } = require('child_process')
        execFileSync('tar', ['-czf', tarPath, '-C', path.join(USERDATA, 'Partitions'), 'wa-' + accountId], { stdio: 'pipe' })
        // JANGAN bangun ulang view — sesi ini bakal dipakai di laptop. Kalau
        // server login juga = 2 perangkat pegang sesi WA yang sama = WhatsApp
        // nendang salah satu. Server "release" sesi: status jadi released.
        fs.writeFileSync(path.join(USERDATA, 'released-' + accountId), String(Date.now()))
        log(`PULL_RELEASE ${accountId} sesi dilepas — laptop yang megang sekarang`)
      } catch (e) { return json(res, 500, { ok: false, error: 'gagal tar: ' + e.message }) }
      const size = fs.statSync(tarPath).size
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': size, 'X-Filename': 'wa-' + accountId + '.tar.gz' })
      const rs = fs.createReadStream(tarPath)
      rs.pipe(res)
      rs.on('end', () => { try { fs.unlinkSync(tarPath) } catch (_) {} log(`PULL_OUT ${accountId} ${size} bytes`) })
      return
    }
    return json(res, 404, { ok: false, error: 'not found' })
  } catch (e) {
    log('HTTP_ERR ' + e.message)
    return json(res, 500, { ok: false, error: String(e).slice(0, 200) })
  }
})

// ── Boot ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1280, height: 800 })
  server.listen(PORT, '0.0.0.0', () => log(`HTTP_LISTEN :${PORT}`))
  log('BOOT userData=' + USERDATA + ' account=' + ACCOUNT_ID + ' (' + ACCOUNT_NAME + ')')

  // v2.7.3 — kalau sesi lagi dipegang laptop (released), JANGAN bangun view.
  // Kalau view dibangun, WhatsApp bakal ngelogout salah satu dari 2 perangkat.
  if (isReleased()) {
    log('BOOT_SKIP sesi lagi dipegang laptop (released) — server tidak buka view')
    return
  }
  buildView()

  // poll auth sampai login
  for (let i = 0; i < 40; i++) {
    await wait(5000)
    const authed = await isAuthenticated(view)
    log(`AUTH_CHECK ${i} authed=${authed}`)
    if (authed) {
      const eng = await ensureEngine(view, 60000)
      log('ENGINE ' + (eng.ok ? 'OK' : 'FAIL'))
      break
    }
  }
}).catch(e => { log('FATAL ' + e.message); app.quit() })
