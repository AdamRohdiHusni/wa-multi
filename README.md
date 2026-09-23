# WA Multi

Aplikasi desktop (Electron) buat buka **banyak akun WhatsApp dalam satu window** — plus **blast multi-akun** (personal & grup) dan **schedule**. Session per akun tersimpan permanen — scan QR **sekali** per nomor, abis itu selalu login.

Dibuat buat yang megang beberapa nomor WA (mis. 5 nomor toko) tapi males buka 5 window/browser — dan butuh kirim pesan ke banyak nomor dari beberapa akun sekaligus.

![preview](build/icon.png)

## Fitur

### Tab & akun
- **Multi-akun tanpa batas** dalam 1 window (tab bar di atas)
- **Mode 2 tab**: akun pribadi (📌, wajib nyala) + 1 akun office nyala barengan — atau **mode 1 tab** (pribadi doang)
- **Layout Penuh / Split**: default **penuh** (tab-by-tab full screen — WA lain tetap hidup di background, pindah tab **instan tanpa loading**, real-time); opsi **split** kiri-kanan kalau mau lihat 2 WA berdampingan
- **Ringan** — max ~2 akun hidup; akun lain "parkir" (session di disk). RAM seukuran 1-2 WhatsApp Desktop, bukan 5× lipat
- **Session persist** — QR sekali per akun; restart/tutup app pun tetep login
- **Unread badge per akun** (update saat akun dibuka)
- **Mode gelap & terang**
- Semua fitur WA Web asli: chat, gambar, voice note, stiker, dokumen, grup, status
- Hemat resource: GPU off, tracker WA (analytics/doubleclick) di-block

### Blast (v2)
- **Blast personal**: upload CSV (nama+nomor) atau pilih dari kontak akun
- **Blast grup**: ambil daftar grup akun, atau paste link undangan
- **Multi-akun**: centang akun mana aja yang ikut kirim (yang gak dicentang gak ngirim apa-apa)
- **Bagi rata**: target dibagi merata ke akun terpilih (round-robin) — atau mode "semua akun kirim ke semua"
- **Template pesan**: sisipkan `{nama}` / `{nomor}` / **`{custom}`**; bisa lampirkan gambar/file (PDF, dokumen, video)
- **{custom}**: isi beda-beda per target lewat kolom `custom` di CSV (mis. link affiliate tiap orang) — atau satu nilai buat semua lewat kolom "isi {custom}" di form
- **Jeda antar pesan** (default 30 detik) + **batas harian per akun** (default 40)
- **Progress live per akun** + log + Stop 1 akun / Stop Semua
- Akun dirotasi **satu-satu** (nyala → kirim jatahnya → parkir) biar RAM aman di laptop lemah

### Schedule (v2)
- Jadwalkan blast di tanggal & jam tertentu
- App ke **tray** selama ada jadwal pending (tutup window ≠ mati)
- **Laptop mati pas waktunya?** Jadwal di-**skip** (gak nyusul) — aman buat HP/akun
- Notifikasi Windows saat blast mulai/selesai

## Install (Windows)

1. Download `WA Multi Setup 2.0.0.exe` dari [Releases](../../releases)
2. Kalau muncul warning SmartScreen biru ("Windows protected your PC"): klik **More info** → **Run anyway** (installer belum di-sign, normal)
3. Next-next → selesai. Muncul di Start Menu sebagai **WA Multi**

## Cara pakai

1. Buka app → **+ Tambah akun pertama** → kasih nama → **scan QR** dari HP-nya
2. Klik kanan tab akun → **📌 Jadikan akun pribadi** (ini yang selalu nyala)
3. Tambah nomor lain: **＋** di tab bar → scan QR lagi
4. **Blast**: tab **Blast** → pilih target (CSV/kontak/grup) → tulis pesan → centang akun → **Mulai**
5. **Jadwal**: isi blast kayak biasa → **⏰ Jadwalkan** → pilih waktu
6. Ganti tema: ikon 🌙/☀️ · Mode tab: tombol **2/1** di atas
7. Rename akun: klik kanan tab → ✎ · Hapus akun: klik kanan → 🗑 lalu klik lagi

## Build sendiri

```bash
npm install
npm start          # jalanin langsung
npm run dist       # build installer Windows → dist/
```

Build installer Windows dari Linux butuh `wine` (dipakai buat embed icon + metadata ke .exe):

```bash
sudo apt install wine64
npx electron-builder --win nsis --x64
```

## Arsitektur

```
main.js            proses utama: window, WebContentsView per akun, mesin blast (wa-js), IPC, schedule, self-test
preload.js         contextBridge → window.waMulti
index.html         shell UI (topbar, tab bar, panel blast/jadwal, dialog)
app.css            tema gelap/terang via CSS variables
app.js             logika renderer
vendor/wppconnect-wa.js  engine blast — di-inject ke WA Web yang udah login (no second QR)
```

**Mesin blast** — bukan whatsapp-web.js / sesi kedua. Bundle [wppconnect/wa-js](https://github.com/wppconnect-team/wa-js) di-inject ke halaman WA Web yang **sudah login** di dalam app (mekanisme sama dgn dashboard WA resmi). Nol QR tambahan, nol RAM tambahan; pesan dikirim dari session yang sama persis dgn yang lu lihat.

**Desain hemat resource** — max 2 akun hidup sebagai `WebContentsView` (slot pribadi + office); akun lain parkir (destroy view, session tetap di disk via Electron partition `persist:wa-<accountId>`). Saat blast, akun dirotasi satu-satu: nyalakan → kirim → parkir → lanjut ke akun berikutnya.

**Data app** (Windows): `%APPDATA%/wa-multi/` — `accounts.json`, `prefs.json`, `schedules.json`, `history.json`, plus session WA per akun.

### Gotcha penting (kalau mau modif)

1. **Layout full = view bertumpuk, bukan di-destroy** — pindah tab = `bringToFront` (remove+add child view, tanpa reload). Chromium harus dilarang freeze tab background: `disable-backgrounding-occluded-windows` + `disable-features=CalculateNativeWinOcclusion`. Tanpa ini, WA di background bisa nyangkut di layar pas window restore/minimize (Windows).
2. **Electron 33 menghapus `BrowserView`** → pakai `WebContentsView` + `win.contentView.addChildView()`.
2. **`WebContentsView` selalu digambar DI ATAS HTML renderer** → dropdown/dialog bakal ketutupan + klik-nya ke-makan. Solusi: saat overlay kebuka, kirim `setOverlayOpen(true)` → bounds view jadi `0x0`. Ini **bukan** masalah z-index, gak bisa diakalin pakai CSS.
3. **WA Web nolak user agent Electron** → nampilin halaman "WhatsApp works with Google Chrome 100+" dan QR gak muncul. FIX: spoof UA jadi Chrome standar sebelum `loadURL`.
4. **`prompt()` / `confirm()` gak didukung** di renderer Electron → pakai `<dialog>` sendiri.
5. **`WebContentsView` gak punya `setAutoResize`** → handler `resize`/`maximize`/`fullscreen` harus dipasang **setelah** window dibuat, plus self-heal bounds.
6. **Nama API wa-js ke-minify di bundle** → jangan grep nama fungsi di `vendor/wppconnect-wa.js` buat verifikasi; cek langsung di runtime (`WPP.chat`, `WPP.contact`, `WPP.group`) atau baca d.ts-nya.
7. **wa-js butuh webpack runtime WA Web udah jalan** → tunggu `window.webpackChunkwhatsapp_webpack_modules` ada sebelum inject (udah di-handle `ensureEngine`).

### Self-test

App punya self-test bawaan (69 check: IPC, persistensi, slot, layout full/split, switch tanpa reload, tema, regresi overlay, CSV + kolom custom, template {nama}/{nomor}/{custom}, jadwal, guard blast):

```bash
WA_MULTI_DEV=1 WA_MULTI_SELFTEST=1 xvfb-run -a npx electron --no-sandbox .
```

`WA_MULTI_SHOT=/tmp/prefix` = sekalian capture screenshot (dark/light/panel).

Tes tambahan di `tests/` (jalanin manual, butuh hook `WA_MULTI_TESTHOOK=1`):
- `switch_verify.js` — bukti pindah tab tanpa reload (0 navigasi) + latensi (~41-95ms)
- `blast_engine_test2.js` — mesin blast dgn WA Web di-mock: template {custom} per target, rotasi akun, bagi rata
- `guards_test.js` — batas harian berhenti tepat + stop blast berhenti di tengah

## Catatan

- **Blast dari akun personal ada risiko** — WhatsApp bisa restrict nomor yang kirim massal. Makanya ada jeda antar pesan, batas harian per akun, dan akun pribadi default **gak** ikut blast. Cukup 1 centang yang bikin pribadi ikut, jangan asal centang.
- Pastikan penerima udah kenal / opt-in (mis. daftar via Google Form) — kirim ke nomor acak = laporan spam = restrict.
- Belum ada code signing → SmartScreen warning saat install (normal).

## Lisensi

MIT
