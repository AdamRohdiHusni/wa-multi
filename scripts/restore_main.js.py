#!/usr/bin/env python3
"""Restore main.js v2.6.0: HEAD source (v2.5.2 base) + v2.6.0 region-A features
+ IPC handlers + renderer-API wiring + section-19 self-tests.

The obfuscated build overwrote root main.js (asar extract-file writes to CWD).
All v2.6.0 UI files (app.js/app.css/index.html/preload.js) survived intact, so we
re-splice the main-process side against the HEAD source.
"""
import io, os, re, subprocess, sys

ROOT = '/home/suki/server-stack/wa-multi'
os.chdir(ROOT)

def read(p):
    with io.open(p, encoding='utf8') as f:
        return f.read()

def write(p, s):
    with io.open(p, 'w', encoding='utf8') as f:
        f.write(s)

src = subprocess.check_output(['git', 'show', 'HEAD:main.js'], cwd=ROOT).decode('utf8')
orig_len = len(src)

# ── 1. splice REGION A (INITIAL_ENGINE + updater helpers + prefs.initial) ──
region = read('scripts/v260-region-a.js').rstrip() + '\n'
anchor = '// prefs defaults\n'
assert src.count(anchor) == 1, 'anchor prefs-defaults count=%d' % src.count(anchor)
assert 'REGION A' not in src
src = src.replace(anchor, region + '\n' + anchor)

# ── 2. IPC handlers (insert before the first ipcMain.handle of the license block) ──
HANDLERS = '''
// ── v2.6.0 IPC: chat initials + auto-update ─────────────────────
ipcMain.handle('wa-multi:setInitials', async (_e, cfg) => {
  try {
    const c = cfg || {}
    prefs.initial = Object.assign({ enabled: false, code: '', name: '', append: true, skipGroups: true, showBadge: true }, prefs.initial || {}, {
      enabled: !!c.enabled,
      code: String(c.code == null ? (prefs.initial && prefs.initial.code) || '' : c.code).slice(0, 8),
      name: String(c.name == null ? (prefs.initial && prefs.initial.name) || '' : c.name).slice(0, 24)
    })
    persistPrefs()
    await pushInitialConfig()
    broadcastState()
    return { ok: true, initial: prefs.initial }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})

ipcMain.handle('wa-multi:appVersion', () => {
  try { return { ok: true, version: app.getVersion(), name: app.getName() } } catch (e) { return { ok: false, version: '' } }
})

ipcMain.handle('wa-multi:updateCheck', async (_e, manual) => {
  const r = await updaterCheck(!!manual)
  return r
})

ipcMain.handle('wa-multi:updateInstall', async () => {
  try {
    const u = initUpdater()
    if (!u) return { ok: false, error: 'updater tidak tersedia' }
    setImmediate(() => { try { u.quitAndInstall() } catch (_) {} })
    return { ok: true }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})
// ── END v2.6.0 IPC ─────────────────────────────────────────────
'''

# insert right before the license IPC section (stable marker)
m = re.search(r"\n// ── .*?[Ll]icense.*?──\n", src)
if not m:
    m = re.search(r"\nipcMain\.handle\('wa-multi:activateLicense'", src)
assert m, 'license-section anchor not found'
src = src[:m.start()] + '\n' + HANDLERS + src[m.start():]

# ── 3. boot: start the initials loop + expose version, after app.whenReady ──
BOOT = '''
  // ── v2.6.0 boot: chat-initials injection loop ──
  try { startInitialLoop() } catch (_) {}
'''
m = re.search(r"app\.whenReady\(\)\.then\(\s*(?:async\s*)?\(\)\s*=>\s*\{", src)
assert m, 'app.whenReady anchor not found'
src = src[:m.end()] + BOOT + src[m.end():]

write('main.js', src)
print('RESTORE OK  %d -> %d bytes (+%d)' % (orig_len, len(src), len(src) - orig_len))
print('REGION A  :', 'REGION A' in src)
print('handlers  :', src.count("wa-multi:setInitials"), src.count("wa-multi:updateCheck"), src.count("wa-multi:updateInstall"))
print('boot loop :', 'startInitialLoop()' in src)
