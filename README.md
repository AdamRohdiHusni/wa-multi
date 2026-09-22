# WA Multi

Aplikasi desktop (Electron) buat buka **banyak akun WhatsApp dalam satu window**. Pindah akun tinggal toggle dropdown di pojok kiri atas. Session per akun tersimpan permanen — scan QR **sekali** per nomor, abis itu selalu login.

Dibuat buat yang megang beberapa nomor WA (mis. 5 nomor toko) tapi males buka 5 window/browser.

![preview](build/icon.png)

## Fitur

- **Multi-akun tanpa batas** dalam 1 window, pindah via dropdown
- **Ringan** — cuma 1 akun yang hidup di satu waktu; akun lain "parkir" (session di disk). RAM seukuran 1 WhatsApp Desktop biasa, bukan 5× lipat
- **Session persist** — QR sekali per akun; restart/tutup app pun tetep login
- **Unread badge per akun** (update saat akun dibuka)
- **Mode gelap & terang**
- Semua fitur WA Web asli: chat, gambar, voice note, stiker, dokumen, grup, status
- Hemat resource: GPU off, tracker WA (analytics/doubleclick) di-block

## Install (Windows)

1. Download `WA Multi Setup 1.0.0.exe` dari [Releases](../../releases)
2. Kalau muncul warning SmartScreen biru ("Windows protected your PC"): klik **More info** → **Run anyway** (installer belum di-sign, normal)
3. Next-next → selesai. Muncul di Start Menu sebagai **WA Multi**

## Cara pakai

1. Buka app → **+ Tambah akun pertama**
2. Kasih nama (mis. "Sweety 1") → **QR muncul** → scan dari HP-nya
3. Tambah nomor lain: dropdown kiri atas → **+ Tambah akun** → ulangi
4. Pindah akun: klik dropdown → pilih akun (~3-4 detik)
5. Ganti tema: ikon 🌙/☀️ pojok kanan atas
6. Rename akun: ✎ di baris akun · Hapus akun: 🗑 lalu klik lagi buat konfirmasi

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
main.js       proses utama: window, WebContentsView per akun, IPC, self-test
preload.js    contextBridge → window.waMulti
index.html    shell UI (topbar, dropdown akun, dialog, welcome)
app.css       tema gelap/terang via CSS variables
app.js        logika renderer
```

**Desain hemat resource** — 1 akun hidup sebagai `WebContentsView`; pindah akun = destroy view lama + bikin baru. Session dipertahankan lewat Electron partition `persist:wa-<accountId>`, jadi login gak perlu diulang.

**Data app** (Windows): `%APPDATA%/wa-multi/` — `accounts.json`, `prefs.json`, plus session WA per akun.

### Gotcha penting (kalau mau modif)

1. **Electron 33 menghapus `BrowserView`** → pakai `WebContentsView` + `win.contentView.addChildView()`.
2. **`WebContentsView` selalu digambar DI ATAS HTML renderer** → dropdown/dialog bakal ketutupan + klik-nya ke-makan. Solusi: saat overlay kebuka, kirim `setOverlayOpen(true)` → bounds view jadi `0x0`. Ini **bukan** masalah z-index, gak bisa diakalin pakai CSS.
3. **WA Web nolak user agent Electron** → nampilin halaman "WhatsApp works with Google Chrome 100+" dan QR gak muncul. FIX: spoof UA jadi Chrome standar sebelum `loadURL`.
4. **`prompt()` / `confirm()` gak didukung** di renderer Electron → pakai `<dialog>` sendiri.
5. **`WebContentsView` gak punya `setAutoResize`** → handler `resize`/`maximize`/`fullscreen` harus dipasang **setelah** window dibuat, plus self-heal bounds.

### Self-test

App punya self-test bawaan (27 check: IPC, persistensi, swap view, tema, regresi overlay):

```bash
WA_MULTI_DEV=1 WA_MULTI_SELFTEST=1 xvfb-run -a npx electron --no-sandbox .
```

`WA_MULTI_SHOT=/tmp/prefix` = sekalian capture screenshot (dark/light/menu).

## Catatan

- **Bukan buat blast massal** — ini inbox manual kayak WhatsApp Desktop biasa. Blast massal dari akun personal berisiko kena restrict WhatsApp.
- Belum ada code signing → SmartScreen warning saat install (normal).

## Lisensi

MIT
