// WA Multi v2.0 — renderer UI
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

let state = { accounts: [], pinnedId: null, tabMode: 'dual', layoutMode: 'full', activeAccountId: null, theme: 'dark', dailyCap: 40, schedules: [], blasting: false, history: [] }
const unreadMap = new Map()          // accountId -> unread count
let currentView = 'chat'             // chat | blast | schedule

// blast form state
let targetKind = 'personal'
let targets = []                     // [{name, phone}] | [{name, jid}]
let media = null
let blastSel = new Set()             // accountIds checked for blast
let ctxMenu = null

// ── theme ─────────────────────────────────────────────────────
function applyTheme (theme) {
  document.documentElement.setAttribute('data-theme', theme)
  $('iconMoon').classList.toggle('hidden', theme === 'light')
  $('iconSun').classList.toggle('hidden', theme !== 'light')
}

// ── state ─────────────────────────────────────────────────────
async function refreshState () {
  state = await window.waMulti.getState()
  applyTheme(state.theme)
  // keep blast selection valid (drop deleted accounts, auto-check new ones once)
  const ids = new Set(state.accounts.map(a => a.id))
  for (const id of [...blastSel]) if (!ids.has(id)) blastSel.delete(id)
  if (blastSel.size === 0) {
    state.accounts.forEach(a => { if (!a.isPinned) blastSel.add(a.id) })
  }
  renderTabs()
  renderTabMode()
  renderBlastAccounts()
  renderSchedules()
  renderHistory()
  renderTargetSummary()
  syncStage()
}

function renderTabMode () {
  document.querySelectorAll('#tabMode .tm-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === state.tabMode))
  document.querySelectorAll('#layoutSeg .lay-opt').forEach(b => b.classList.toggle('active', b.dataset.layout === (state.layoutMode || 'full')))
  // layout switch only matters with 2 tabs
  $('layoutSeg').style.display = state.tabMode === 'dual' ? '' : 'none'
}

function syncStage () {
  // welcome shows only on the chat view with nothing on stage (and no accounts yet)
  const anyOnStage = state.accounts.some(a => a.slot)
  const show = currentView === 'chat' && !anyOnStage && state.accounts.length === 0
  $('welcome').classList.toggle('hidden', !show)
}

// ── tab bar ───────────────────────────────────────────────────
function renderTabs () {
  const wrap = $('tabs')
  wrap.innerHTML = ''
  for (const a of state.accounts) {
    const isActive = state.activeAccountId === a.id && a.slot
    const t = document.createElement('div')
    t.className = 'tab' + (a.slot ? ' on' : '') + (isActive ? ' active' : '')
    const unread = unreadMap.get(a.id) || 0
    t.innerHTML = `
      <span class="tdot" style="background:${a.color || 'var(--accent)'}"></span>
      ${a.isPinned ? '<span class="pin" title="Akun pribadi">📌</span>' : ''}
      <span class="tname">${esc(a.name)}</span>
      ${unread ? `<span class="tbadge">${unread}</span>` : ''}`
    t.title = a.slot
      ? (isActive ? `${a.name} — lagi dibuka` : `${a.name} — hidup di background (klik = langsung pindah, tanpa loading)`)
      : `${a.name} — parkir (klik buat nyalain)`
    t.addEventListener('click', async () => {
      closeCtxMenu()
      switchView('chat')
      if (a.slot && state.activeAccountId !== a.id) {
        await window.waMulti.activateAccount(a.id)   // instant switch, no reload
      } else if (!a.slot) {
        await window.waMulti.openAccount(a.id)       // spin up (QR first time)
      }
      refreshState()
    })
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); openCtxMenu(e.clientX, e.clientY, a) })
    wrap.appendChild(t)
  }
}

function openCtxMenu (x, y, account) {
  closeCtxMenu()
  window.waMulti.setOverlayOpen(true)
  const m = document.createElement('div')
  m.className = 'acc-menu'
  m.style.position = 'fixed'
  m.style.left = Math.min(x, window.innerWidth - 220) + 'px'
  m.style.top = Math.min(y, window.innerHeight - 160) + 'px'
  m.style.minWidth = '200px'
  m.innerHTML = `
    <div class="acc-item" data-act="pin">${account.isPinned ? '📌 Lepas status pribadi' : '📌 Jadikan akun pribadi'}</div>
    ${account.slot && !account.isPinned ? '<div class="acc-item" data-act="park">💤 Parkir tab ini</div>' : ''}
    <div class="acc-item" data-act="ren">✎ Ganti nama</div>
    <div class="acc-item" data-act="del">🗑 Hapus akun</div>`
  m.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    closeCtxMenu()
    if (act === 'pin') { await window.waMulti.setPinned(account.id); refreshState() }
    if (act === 'park') { await window.waMulti.parkAccount(account.id); refreshState() }
    if (act === 'ren') openRenameDialog(account.id, account.name)
    if (act === 'del') {
      if (!confirm2(m, account)) return
      await window.waMulti.removeAccount(account.id)
      unreadMap.delete(account.id)
      refreshState()
    }
  })
  document.body.appendChild(m)
  ctxMenu = m
}
let confirmArmed = null
function confirm2 (menuEl, account) {
  const row = menuEl.querySelector('[data-act="del"]')
  if (confirmArmed !== account.id) {
    confirmArmed = account.id
    row.textContent = '❗ Klik lagi buat hapus permanen'
    setTimeout(() => { if (row.isConnected) { confirmArmed = null; row.textContent = '🗑 Hapus akun' } }, 3000)
    return false
  }
  confirmArmed = null
  return true
}
function closeCtxMenu () {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null }
  if (currentView === 'chat' && !document.querySelector('dialog[open]')) window.waMulti.setOverlayOpen(false)
}

// ── view switching ────────────────────────────────────────────
function switchView (v) {
  currentView = v
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v))
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'view-' + v))
  window.waMulti.setOverlayOpen(v !== 'chat')
  syncStage()
}

// ── targets ───────────────────────────────────────────────────
function renderTargetSummary () {
  $('targetCount').textContent = targets.length
}
function addTargets (list) {
  const seen = new Set(targets.map(t => t.jid || t.phone))
  let added = 0
  for (const t of list) {
    const key = t.jid || t.phone
    if (!key || seen.has(key)) continue
    seen.add(key)
    targets.push(t)
    added++
  }
  renderTargetSummary()
  return added
}
function toast (msg) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

// ── blast: accounts checklist ─────────────────────────────────
function renderBlastAccounts () {
  const box = $('blastAccounts')
  box.innerHTML = ''
  if (!state.accounts.length) {
    box.innerHTML = '<div class="sub small">Belum ada akun. Tambah akun dulu di tab atas.</div>'
    return
  }
  for (const a of state.accounts) {
    const row = document.createElement('label')
    const checked = blastSel.has(a.id)
    row.className = 'acc-check' + (checked ? ' checked' : '')
    row.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} />
      <span class="cd" style="background:${a.color || 'var(--accent)'}"></span>
      <span class="cn">${esc(a.name)}${a.isPinned ? ' <span class="warn-tag">(pribadi)</span>' : ''}</span>
      <span class="cmeta">${a.sentToday}/${state.dailyCap || '∞'} hari ini</span>`
    const cb = row.querySelector('input')
    cb.addEventListener('change', () => {
      if (cb.checked) blastSel.add(a.id); else blastSel.delete(a.id)
      row.classList.toggle('checked', cb.checked)
      updateSchedSummary()
    })
    box.appendChild(row)
  }
}

// ── blast: sources ────────────────────────────────────────────
$('kindSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-opt')
  if (!b) return
  targetKind = b.dataset.kind
  document.querySelectorAll('#kindSeg .seg-opt').forEach(x => x.classList.toggle('active', x === b))
  $('targetPersonal').classList.toggle('hidden', targetKind !== 'personal')
  $('targetGroup').classList.toggle('hidden', targetKind !== 'group')
  targets = []
  renderTargetSummary()
})

$('btnUploadCsv').addEventListener('click', async () => {
  const r = await window.waMulti.pickCsv()
  if (!r.ok) { if (!r.canceled) toast(r.error || 'gagal baca CSV'); return }
  const rows = r.rows.map(x => ({ name: x.name, phone: x.phone }))
  const n = addTargets(rows)
  $('csvNote').textContent = `${r.file} — ${n} nomor ditambah`
  toast(`${n} nomor dari CSV`)
})

$('btnClearTargets').addEventListener('click', () => {
  targets = []
  $('contactPick').innerHTML = ''
  $('groupPick').innerHTML = ''
  $('csvNote').textContent = 'belum ada file'
  renderTargetSummary()
})

function fillAccSelect (sel) {
  sel.innerHTML = ''
  for (const a of state.accounts) {
    const o = document.createElement('option')
    o.value = a.id
    o.textContent = a.name + (a.isPinned ? ' (pribadi)' : '')
    sel.appendChild(o)
  }
}

$('btnFetchContacts').addEventListener('click', async () => {
  const id = $('contactAccSel').value
  if (!id) return toast('pilih akun dulu')
  const btn = $('btnFetchContacts')
  btn.disabled = true; btn.textContent = 'ngambil…'
  const r = await window.waMulti.fetchContacts(id)
  btn.disabled = false; btn.textContent = 'Ambil kontak'
  if (!r.ok) return toast('gagal: ' + r.error)
  const box = $('contactPick')
  box.innerHTML = ''
  if (!r.contacts.length) { box.innerHTML = '<div class="sub small">kontak kosong</div>'; return }
  r.contacts.forEach(c => {
    const phone = String(c.id).replace(/@.*$/, '')
    const row = document.createElement('label')
    row.className = 'mini-item'
    row.innerHTML = `<input type="checkbox" /><span class="mn">${esc(c.name || phone)}</span><span class="mp">${esc(phone)}</span>`
    const cb = row.querySelector('input')
    cb.addEventListener('change', () => {
      row.classList.toggle('on', cb.checked)
      if (cb.checked) addTargets([{ name: c.name || phone, phone }])
      else { targets = targets.filter(t => t.phone !== phone); renderTargetSummary() }
    })
    box.appendChild(row)
  })
  toast(`${r.contacts.length} kontak diambil`)
})

$('btnFetchGroups').addEventListener('click', async () => {
  const id = $('groupAccSel').value
  if (!id) return toast('pilih akun dulu')
  const btn = $('btnFetchGroups')
  btn.disabled = true; btn.textContent = 'ngambil…'
  const r = await window.waMulti.fetchGroups(id)
  btn.disabled = false; btn.textContent = 'Ambil daftar grup'
  if (!r.ok) return toast('gagal: ' + r.error)
  const box = $('groupPick')
  box.innerHTML = ''
  if (!r.groups.length) { box.innerHTML = '<div class="sub small">gak ada grup</div>'; return }
  r.groups.forEach(g => {
    const row = document.createElement('label')
    row.className = 'mini-item'
    row.innerHTML = `<input type="checkbox" /><span class="mn">${esc(g.name || g.id)}</span>`
    const cb = row.querySelector('input')
    cb.addEventListener('change', () => {
      row.classList.toggle('on', cb.checked)
      if (cb.checked) addTargets([{ name: g.name || g.id, jid: g.id }])
      else { targets = targets.filter(t => t.jid !== g.id); renderTargetSummary() }
    })
    box.appendChild(row)
  })
  toast(`${r.groups.length} grup diambil`)
})

$('btnAddInvite').addEventListener('click', async () => {
  const link = $('inviteLink').value.trim()
  if (!link) return
  const id = $('groupAccSel').value
  if (!id) return toast('pilih akun dulu buat baca link')
  const btn = $('btnAddInvite')
  btn.disabled = true; btn.textContent = '…'
  const r = await window.waMulti.groupFromInvite(id, link)
  btn.disabled = false; btn.textContent = 'Tambah'
  if (!r.ok) return toast('gagal: ' + r.error)
  addTargets([{ name: r.group.name || r.group.id, jid: r.group.id }])
  $('inviteLink').value = ''
  toast('grup ditambah: ' + (r.group.name || r.group.id))
})

// ── blast: message + media ────────────────────────────────────
$('varChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip')
  if (!c) return
  const ta = $('blastMsg')
  const pos = ta.selectionStart || ta.value.length
  ta.value = ta.value.slice(0, pos) + c.dataset.var + ta.value.slice(ta.selectionEnd || pos)
  ta.focus()
})

$('btnMedia').addEventListener('click', async () => {
  const r = await window.waMulti.pickMedia()
  if (!r.ok) { if (!r.canceled) toast(r.error || 'gagal baca file'); return }
  media = r.media
  $('mediaNote').textContent = `${media.filename} (${(media.size / 1024).toFixed(0)} KB)`
  $('btnMediaClear').classList.remove('hidden')
})
$('btnMediaClear').addEventListener('click', () => {
  media = null
  $('mediaNote').textContent = 'tanpa lampiran'
  $('btnMediaClear').classList.add('hidden')
})

// ── blast: start ──────────────────────────────────────────────
function collectCfg () {
  return {
    kind: targetKind,
    targets,
    message: $('blastMsg').value,
    custom: $('customInput').value.trim(),
    media,
    accounts: [...blastSel],
    delaySec: Number($('delaySec').value) || 30,
    mode: $('splitMode').value
  }
}

$('btnStart').addEventListener('click', async () => {
  const cfg = collectCfg()
  if (!cfg.targets.length) return toast('target masih kosong')
  if (!cfg.accounts.length) return toast('pilih minimal 1 akun')
  if (!cfg.message.trim() && !cfg.media) return toast('tulis pesan atau lampirkan file')
  if (state.accounts.some(a => a.isPinned && cfg.accounts.includes(a.id))) {
    toast('⚠️ akun pribadi ikut ke-centang — hati-hati')
  }
  $('btnStart').disabled = true
  const r = await window.waMulti.startBlast(cfg)
  $('btnStart').disabled = false
  if (!r.ok) return toast('gagal: ' + r.error)
  $('progressCard').classList.remove('hidden')
  $('progLog').innerHTML = ''
  toast('blast jalan…')
})

$('btnStopAll').addEventListener('click', async () => {
  await window.waMulti.stopBlast(null)
  toast('stop diminta — nunggu pesan yang lagi jalan')
})

// ── blast: schedule dialog ────────────────────────────────────
function updateSchedSummary () {
  const sel = [...blastSel].map(id => state.accounts.find(a => a.id === id)).filter(Boolean).map(a => a.name)
  $('schedSummary').textContent = `${targets.length} target · ${sel.length} akun (${sel.join(', ') || '-'})`
}

$('btnSchedule').addEventListener('click', () => {
  const cfg = collectCfg()
  if (!cfg.targets.length) return toast('target masih kosong')
  if (!cfg.accounts.length) return toast('pilih minimal 1 akun')
  if (!cfg.message.trim() && !cfg.media) return toast('tulis pesan atau lampirkan file')
  updateSchedSummary()
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  $('schedWhen').value = d.toISOString().slice(0, 16)
  $('schedLabel').value = ''
  window.waMulti.setOverlayOpen(true)
  $('scheduleDlg').showModal()
})

$('schedCancel').addEventListener('click', () => $('scheduleDlg').close())
$('scheduleDlg').addEventListener('close', () => { if (currentView === 'chat') window.waMulti.setOverlayOpen(false) })
$('scheduleDlg').addEventListener('submit', async (e) => {
  e.preventDefault()
  const when = new Date($('schedWhen').value).getTime()
  const cfg = collectCfg()
  cfg.when = when
  cfg.label = $('schedLabel').value.trim()
  const r = await window.waMulti.addSchedule(cfg)
  $('scheduleDlg').close()
  if (!r.ok) return toast('gagal: ' + r.error)
  toast('jadwal disimpan')
  switchView('schedule')
  refreshState()
})

// ── cap dialog ────────────────────────────────────────────────
$('btnCap').addEventListener('click', () => {
  $('capInput').value = state.dailyCap
  window.waMulti.setOverlayOpen(true)
  $('capDlg').showModal()
})
$('capCancel').addEventListener('click', () => $('capDlg').close())
$('capDlg').addEventListener('close', () => { if (currentView === 'chat') window.waMulti.setOverlayOpen(false) })
$('capDlg').addEventListener('submit', async (e) => {
  e.preventDefault()
  await window.waMulti.setDailyCap(Number($('capInput').value) || 0)
  $('capDlg').close()
  refreshState()
})

// ── progress ──────────────────────────────────────────────────
const prog = new Map()  // accountId -> {name,total,sent,failed,status}
function renderProg () {
  const box = $('progList')
  box.innerHTML = ''
  for (const [id, p] of prog) {
    const done = p.sent + p.failed
    const pct = p.total ? Math.round(done / p.total * 100) : 0
    const row = document.createElement('div')
    row.className = 'prog-row'
    row.innerHTML = `
      <span class="pn">${esc(p.name)}</span>
      <span class="prog-bar"><i style="width:${pct}%"></i></span>
      <span class="pstat">${done}/${p.total} · ✅${p.sent} ❌${p.failed} · ${esc(p.status)}</span>`
    box.appendChild(row)
  }
}

window.waMulti.onBlastProgress((p) => {
  if (p.phase === 'start') {
    $('progressCard').classList.remove('hidden')
    prog.clear()
    for (const a of p.accounts) prog.set(a.id, { name: a.name, total: a.total, sent: 0, failed: 0, status: 'nunggu' })
    logLine(`blast mulai — ${p.total} target dari ${p.accounts.length} akun`)
    renderProg()
  } else if (p.phase === 'accountStart') {
    const e = prog.get(p.accountId)
    if (e) { e.status = 'jalan'; e.total = p.total }
    logLine(`▶ ${p.name} mulai (${p.total} target)`)
    renderProg()
  } else if (p.phase === 'progress') {
    const e = prog.get(p.accountId)
    if (e) { e.sent = p.sent; e.failed = p.failed }
    logLine(`${p.status === 'sent' ? '✅' : '❌'} ${p.name} → ${p.target}${p.error ? ' (' + p.error + ')' : ''}`, p.status === 'sent')
    renderProg()
  } else if (p.phase === 'accountError') {
    const e = prog.get(p.accountId)
    if (e) e.status = 'error'
    logLine(`⚠️ ${p.name}: ${p.error}`, false, true)
    renderProg()
  } else if (p.phase === 'accountDone') {
    const e = prog.get(p.accountId)
    if (e) { e.status = p.status; e.sent = p.sent; e.failed = p.failed }
    logLine(`■ ${p.name} selesai — ✅${p.sent} ❌${p.failed}`)
    renderProg()
    refreshState()
  } else if (p.phase === 'done') {
    logLine(`═ blast ${p.status} — total ✅${p.sent} ❌${p.failed}`)
    toast(`blast selesai: ${p.sent} terkirim, ${p.failed} gagal`)
    refreshState()
  } else if (p.phase === 'scheduleSkipped') {
    logLine(`⏰ jadwal "${p.label}" di-skip (laptop mati pas waktunya)`, false, true)
    refreshState()
  }
})

function logLine (text, ok, bad) {
  const el = document.createElement('div')
  if (ok) el.className = 'ok'
  if (bad) el.className = 'bad'
  el.textContent = text
  const log = $('progLog')
  log.appendChild(el)
  log.scrollTop = log.scrollHeight
  while (log.childElementCount > 300) log.removeChild(log.firstChild)
}

// ── schedules ─────────────────────────────────────────────────
function fmtWhen (ts) {
  const d = new Date(ts)
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function renderSchedules () {
  const box = $('schedList')
  const list = state.schedules.slice().sort((a, b) => a.when - b.when)
  if (!list.length) { box.innerHTML = '<div class="sched-empty">Belum ada jadwal. Bikin dari tab Blast → ⏰ Jadwalkan.</div>'; return }
  box.innerHTML = ''
  for (const s of list) {
    const names = (s.accountIds || []).map(id => state.accounts.find(a => a.id === id)).filter(Boolean).map(a => a.name).join(', ')
    const item = document.createElement('div')
    item.className = 'sched-item'
    item.innerHTML = `
      <span class="swhen">${fmtWhen(s.when)}</span>
      <span class="sbody">
        <div class="slabel">${esc(s.label)} · ${s.kind === 'group' ? 'Grup' : 'Personal'}</div>
        <div class="smeta">${s.targetCount} target · ${esc(names || '-')}${s.note ? ' · ' + esc(s.note) : ''}</div>
      </span>
      <span class="sstatus ${s.status}">${({ pending: 'nunggu', running: 'jalan', done: 'selesai', failed: 'gagal', cancelled: 'dibatalin', skipped: 'di-skip' })[s.status] || s.status}</span>`
    const act = document.createElement('span')
    if (s.status === 'pending') {
      const b = document.createElement('button')
      b.className = 'link-btn'; b.textContent = 'batalin'
      b.addEventListener('click', async () => { await window.waMulti.cancelSchedule(s.id); refreshState() })
      act.appendChild(b)
    }
    const d = document.createElement('button')
    d.className = 'link-btn'; d.textContent = 'hapus'
    d.addEventListener('click', async () => { await window.waMulti.deleteSchedule(s.id); refreshState() })
    act.appendChild(d)
    item.appendChild(act)
    box.appendChild(item)
  }
}

// ── history ───────────────────────────────────────────────────
function renderHistory () {
  const box = $('histList')
  if (!state.history.length) { box.innerHTML = '<div class="sub small">belum ada riwayat</div>'; return }
  box.innerHTML = ''
  for (const h of state.history) {
    const row = document.createElement('div')
    row.className = 'hist-row'
    row.innerHTML = `
      <span class="h1">${new Date(h.ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="h2">${esc(h.accountName)} → ${esc(h.target)}</span>
      <span class="h3 ${h.status === 'sent' ? 'ok' : 'bad'}">${h.status === 'sent' ? '✅ terkirim' : '❌ gagal'}</span>`
    box.appendChild(row)
  }
}
$('btnClearHist').addEventListener('click', async () => { await window.waMulti.clearHistory(); refreshState() })

// ── dialogs: add / rename ─────────────────────────────────────
function openAddDialog () {
  window.waMulti.setOverlayOpen(true)
  $('newName').value = ''
  $('addDlg').showModal()
  setTimeout(() => $('newName').focus(), 50)
}
$('addCancel').addEventListener('click', () => $('addDlg').close())
$('addDlg').addEventListener('close', () => { if (currentView === 'chat' && !ctxMenu) window.waMulti.setOverlayOpen(false) })
$('addDlg').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('newName').value.trim()
  if (!name) return
  const res = await window.waMulti.addAccount(name)
  $('addDlg').close()
  switchView('chat')
  if (res && res.id) await window.waMulti.openAccount(res.id)
  refreshState()
})

let renameTargetId = null
function openRenameDialog (id, current) {
  renameTargetId = id
  window.waMulti.setOverlayOpen(true)
  $('renameInput').value = current || ''
  $('renameDlg').showModal()
  setTimeout(() => $('renameInput').focus(), 50)
}
$('renameCancel').addEventListener('click', () => $('renameDlg').close())
$('renameDlg').addEventListener('close', () => { if (currentView === 'chat' && !ctxMenu) window.waMulti.setOverlayOpen(false) })
$('renameDlg').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('renameInput').value.trim()
  if (!name || !renameTargetId) return
  await window.waMulti.renameAccount(renameTargetId, name)
  renameTargetId = null
  $('renameDlg').close()
  refreshState()
})

// ── nav / theme / events ──────────────────────────────────────
document.querySelector('.views-nav').addEventListener('click', (e) => {
  const b = e.target.closest('.nav-btn')
  if (!b) return
  switchView(b.dataset.view)
  if (b.dataset.view === 'blast') { fillAccSelect($('contactAccSel')); fillAccSelect($('groupAccSel')); renderBlastAccounts(); $('capVal').textContent = state.dailyCap }
})
$('tabAdd').addEventListener('click', openAddDialog)
$('welcomeAdd').addEventListener('click', openAddDialog)
$('themeBtn').addEventListener('click', async () => {
  const next = state.theme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  await window.waMulti.setTheme(next)
  state.theme = next
})
$('tabMode').addEventListener('click', async (e) => {
  const b = e.target.closest('.tm-opt')
  if (!b) return
  await window.waMulti.setTabMode(b.dataset.mode)
  refreshState()
})
$('layoutSeg').addEventListener('click', async (e) => {
  const b = e.target.closest('.lay-opt')
  if (!b) return
  await window.waMulti.setLayoutMode(b.dataset.layout)
  refreshState()
})
document.addEventListener('click', (e) => { if (ctxMenu && !e.target.closest('.acc-menu')) closeCtxMenu() })
// v1 bug hardening: a stray click (mis-click onto the WA web area while a menu is
// open) must ALWAYS close the menu cleanly. mousedown runs before the click can
// fall through anywhere, and window blur (alt-tab / click outside app) closes too.
document.addEventListener('mousedown', (e) => { if (ctxMenu && !e.target.closest('.acc-menu')) closeCtxMenu() }, true)
window.addEventListener('blur', () => { if (ctxMenu) closeCtxMenu() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu() })

window.waMulti.onStateChanged(() => refreshState())
window.waMulti.onUnread(({ accountId, unread }) => {
  unreadMap.set(accountId, unread)
  renderTabs()
})

// ── boot ──────────────────────────────────────────────────────
async function boot () {
  await refreshState()
  // the WA views live above the HTML; make sure they don't cover the top bars
  window.waMulti.setUITop(88)
  $('capVal').textContent = state.dailyCap
  renderProg()
}
boot()
