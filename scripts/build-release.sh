#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# build-release.sh — one-command production build for WA Multi
#
# Steps:
#   1. compile main.js + license.js → V8 bytecode (MUST run under
#      Electron's own node — V8-version-locked)
#   2. stage a "pack-src" dir: bytecode + bootstrap + UI assets
#      (main.js source is NOT shipped)
#   3. electron-builder against the staged dir → NSIS installer
#
# Usage:  ./scripts/build-release.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "── 1/3 compiling bytecode (electron runtime) ──────────────"
rm -rf build/bytecode pack-src
ELECTRON_RUN_AS_NODE=1 npx electron scripts/compile-bytecode.js

echo "── 2/3 staging pack-src ───────────────────────────────────"
mkdir -p pack-src
cp build/bytecode/main.jsc build/bytecode/license.jsc pack-src/
# license.js is require('./license')d from main.jsc → the .jsc next to it wins.
# Ship the bootstrap + UI + vendor. NO main.js / license.js source.
cat > pack-src/index.js <<'EOF'
// bootstrap: loads the compiled main module (bytecode)
require('bytenode')
require('./main.jsc')
EOF
cp package.json pack-src/package.json
# patch staged package.json: entry = bootstrap, no devDeps needed inside asar
node -e "
const fs = require('fs')
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const p = { ...root, main: 'index.js' }
p.devDependencies = { electron: root.devDependencies.electron }
p.build = p.build || {}
delete p.scripts
// self-contained build config for the staged dir
p.build = {
  ...root.build,
  files: ['**/*'],
  directories: { output: '../dist' }
}
fs.writeFileSync('pack-src/package.json', JSON.stringify(p, null, 2))
"
cp -r vendor pack-src/vendor
cp index.html app.css app.js preload.js pack-src/
mkdir -p pack-src/build && cp build/icon.png pack-src/build/ 2>/dev/null || true
cp build/icon.ico pack-src/build/ 2>/dev/null || true
ls -la pack-src/

echo "── 3/3 electron-builder (nsis x64) ────────────────────────"
cd pack-src
ln -sfn "$ROOT/node_modules" node_modules
npx electron-builder --win nsis --x64
cd "$ROOT"

echo "── done ───────────────────────────────────────────────────"
ls -la dist/*.exe
