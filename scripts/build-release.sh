#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# build-release.sh — one-command production build for WA Multi
#
# Steps:
#   1. obfuscate main.js + license.js → pack-src/  (portable plain JS:
#      runs on any OS; source is NOT shipped readable)
#   2. stage pack-src: UI assets + vendor bundle + staged package.json
#      (stage-pkg.js keeps production deps so electron-updater ships)
#   3. electron-builder --win nsis x64  → installer + latest.yml
#
# Usage:  ./scripts/build-release.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VER="$(node -p "require('./package.json').version")"

echo "── 0/3 pre-flight: source integrity ───────────────────────"
# Guard against the classic footgun: `asar extract-file X main.js` writes to CWD and
# silently overwrites the real source with the obfuscated build. Catch it before we build.
node -e "
const fs=require('fs');
const src=fs.readFileSync('main.js','utf8');
const bad=[];
if(!/REGION A/.test(src)) bad.push('main.js kehilangan v2.6.0 REGION A');
if(/\b_0x[0-9a-f]{4,}\b/.test(src)) bad.push('main.js keliatan sudah ter-obfuscate (_0x…)');
if(src.length>200000) bad.push('main.js kegedean ('+src.length+' bytes) — kemungkinan ketimpa build');
if(!/app.whenReady/.test(src)) bad.push('main.js tidak punya app.whenReady');
if(!/require\('\.\/license'\)/.test(src)) bad.push('main.js tidak require license.js');
if(bad.length){console.error('FATAL pre-flight:');bad.forEach(b=>console.error('  - '+b));
  console.error('  -> restore: python3 scripts/restore_main.js.py  (atau git checkout main.js)');process.exit(1)}
console.log('  main.js source OK ('+src.length+' bytes)');
"
echo "── 1/3 obfuscating core (portable JS — runs on any OS) ────"
rm -rf pack-src dist
mkdir -p pack-src
node scripts/obfuscate.js

echo "── 2/3 staging pack-src ───────────────────────────────────"
cp package.json pack-src/package.json
node scripts/stage-pkg.js          # keep deps (electron-updater) + strip dev-only keys
cp -r vendor pack-src/vendor
cp index.html app.css app.js preload.js pack-src/
mkdir -p pack-src/build
cp build/icon.png pack-src/build/ 2>/dev/null || true
cp build/icon.ico pack-src/build/ 2>/dev/null || true
[ -f pack-src/package.json ] || { echo "FATAL: pack-src/package.json hilang"; exit 1; }
# electron-builder resolves production deps relative to the app dir → it needs
# node_modules reachable from pack-src (symlink keeps the tree small).
ln -sfn "$ROOT/node_modules" pack-src/node_modules
node -e "const p=require('$ROOT/pack-src/package.json'); if(!p.dependencies||!p.dependencies['electron-updater']){console.error('FATAL: electron-updater tidak ada di staged deps → auto-update bakal crash');process.exit(1)}; console.log('  staged deps ok:', JSON.stringify(p.dependencies))"

echo "── 3/3 electron-builder (nsis x64) ────────────────────────"
cd pack-src
npx electron-builder --win nsis --x64
cd "$ROOT"

echo "── done ───────────────────────────────────────────────────"
ls -la dist/*.exe dist/latest.yml 2>/dev/null || ls -la dist/
echo "VERSION=$VER"