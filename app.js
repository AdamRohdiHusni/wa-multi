// WA Multi — renderer UI
const $ = (id) => document.getElementById(id)

let state = { accounts: [], liveAccountId: null, theme: 'dark' }
const unreadMap = new Map() // accountId -> unread count (as of when that account was last open)

function applyTheme (theme) {
  document.documentElement.setAttribute('data-theme', theme)
  $('iconMoon').classList.toggle('hidden', theme === 'light')
  $('iconSun').classList.toggle('hidden', theme !== 'light')
  document.querySelector('meta[name="color-scheme"]')?.remove()
  const meta = document.createElement('meta')
  meta.name = 'color-scheme'
  meta.content = theme
  document.head.appendChild(meta)
}

async function refreshState () {
  state = await window.waMulti.getState()
  applyTheme(state.theme)
  renderMenu()
  renderTopbar()
  $('welcome').classList.toggle('hidden', state.accounts.length === 0 && !state.liveAccountId ? false : !!state.liveAccountId)
}

// main process is the source of truth: re-render whenever it changes state
// (covers changes made by IPC calls from anywhere, including other windows)
window.waMulti.onStateChanged(() => refreshState())

function renderTopbar () {
  const acc = state.accounts.find(a => a.id === state.liveAccountId)
  $('accName').textContent = acc ? acc.name : (state.accounts.length ? 'Pilih akun' : 'Belum ada akun')
  const dot = $('accDot')
  if (acc) {
    dot.style.background = acc.color || 'var(--accent)'
    dot.classList.add('live')
  } else {
    dot.style.background = 'var(--fg2)'
    dot.classList.remove('live')
  }
}

function renderMenu () {
  const menu = $('accMenu')
  menu.innerHTML = ''
  for (const a of state.accounts) {
    const row = document.createElement('div')
    row.className = 'acc-item' + (a.id === state.liveAccountId ? ' active' : '')
    const unread = unreadMap.get(a.id) || 0
    row.innerHTML = `
      <span class="dot" style="background:${a.color || 'var(--accent)'}"></span>
      <span class="name">${escapeHtml(a.name)}</span>
      ${unread ? `<span class="badge">${unread}</span>` : ''}
      <span class="actions">
        <button class="mini-btn ren" title="Rename">✎</button>
        <button class="mini-btn del" title="Hapus akun">🗑</button>
      </span>`
    row.addEventListener('click', async (ev) => {
      if (ev.target.closest('.mini-btn')) return
      await openAccount(a.id)
    })
    row.querySelector('.ren').addEventListener('click', () => openRenameDialog(a.id, a.name))
    row.querySelector('.del').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1'
        btn.textContent = '❗'
        btn.title = 'Klik lagi buat hapus permanen'
        setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = '🗑' } }, 2500)
        return
      }
      unreadMap.delete(a.id)
      await window.waMulti.removeAccount(a.id)
      refreshState()
    })
    menu.appendChild(row)
  }
  const divider = document.createElement('div')
  divider.className = 'divider'
  menu.appendChild(divider)
  const addRow = document.createElement('div')
  addRow.className = 'add-row'
  addRow.innerHTML = '+ Tambah akun'
  addRow.addEventListener('click', () => { toggleMenu(false); openAddDialog() })
  menu.appendChild(addRow)
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function openAccount (id) {
  toggleMenu(false)
  // hide welcome
  $('welcome').classList.add('hidden')
  await window.waMulti.openAccount(id)
  await window.waMulti.setUITop(48)
  state.liveAccountId = id
  renderTopbar()
  renderMenu()
}

function toggleMenu (force) {
  const menu = $('accMenu')
  const show = force !== undefined ? force : menu.classList.contains('hidden')
  menu.classList.toggle('hidden', !show)
  // get the live WA view out of the way while the dropdown is open
  window.waMulti.setOverlayOpen(show)
}

function openAddDialog () {
  window.waMulti.setOverlayOpen(true)
  $('addDlg').showModal()
  $('newName').value = ''
  setTimeout(() => $('newName').focus(), 50)
}

$('addDlg').addEventListener('close', () => {
  // only hand the stage back if the dropdown isn't also open
  if ($('accMenu').classList.contains('hidden')) window.waMulti.setOverlayOpen(false)
})

// rename via dialog (prompt() is unsupported in Electron)
let renameTargetId = null
function openRenameDialog (id, current) {
  renameTargetId = id
  window.waMulti.setOverlayOpen(true)
  $('renameDlg').showModal()
  $('renameInput').value = current || ''
  setTimeout(() => $('renameInput').focus(), 50)
}

$('addCancel').addEventListener('click', () => $('addDlg').close())
$('renameCancel').addEventListener('click', () => $('renameDlg').close())
$('renameDlg').addEventListener('close', () => {
  if ($('accMenu').classList.contains('hidden')) window.waMulti.setOverlayOpen(false)
})
$('renameDlg').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('renameInput').value.trim()
  if (!name || !renameTargetId) return
  await window.waMulti.renameAccount(renameTargetId, name)
  renameTargetId = null
  $('renameDlg').close()
  refreshState()
})
$('addDlg').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('newName').value.trim()
  if (!name) return
  const res = await window.waMulti.addAccount(name)
  $('addDlg').close()
  if (res && res.id) await openAccount(res.id)
  refreshState()
})

$('accBtn').addEventListener('click', () => toggleMenu())
document.addEventListener('click', (e) => {
  if (!e.target.closest('.acc-switch')) toggleMenu(false)
})

$('themeBtn').addEventListener('click', async () => {
  const next = state.theme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  await window.waMulti.setTheme(next)
  state.theme = next
})

$('welcomeAdd').addEventListener('click', openAddDialog)

window.waMulti.onUnread(({ accountId, unread }) => {
  unreadMap.set(accountId, unread)
  renderMenu()
})

window.waMulti.onLiveClosed(() => {
  state.liveAccountId = null
  $('welcome').classList.remove('hidden')
  renderTopbar()
  renderMenu()
})

refreshState()
