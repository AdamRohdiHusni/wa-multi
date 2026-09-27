#!/usr/bin/env node
// Compile main.js + license.js → V8 bytecode (.jsc).
//
// MUST run under Electron's own Node (ELECTRON_RUN_AS_NODE=1), because .jsc is
// V8-version-locked: compiling with the system node (V8 12.x) produces bytecode
// the Electron 33 runtime (V8 13.x) refuses to load.
//
// Usage:  ELECTRON_RUN_AS_NODE=1 npx electron scripts/compile-bytecode.js
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'build', 'bytecode')
const TARGETS = ['main.js', 'license.js']

const bytenode = require(path.join(ROOT, 'node_modules', 'bytenode'))

fs.mkdirSync(OUT, { recursive: true })

const info = { node: process.version, v8: process.versions.v8, electron: process.versions.electron || null, files: [] }

for (const f of TARGETS) {
  const src = path.join(ROOT, f)
  if (!fs.existsSync(src)) { console.error('missing source:', f); process.exit(1) }
  const out = path.join(OUT, f.replace(/\.js$/, '.jsc'))
  bytenode.compileFile({ filename: src, output: out, compileAsModule: true })
  info.files.push({ src: f, out: path.relative(ROOT, out), bytes: fs.statSync(out).size })
  console.log(`  compiled ${f} → ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
}

// bootstrap that the packaged app runs as `main`
fs.writeFileSync(path.join(OUT, 'main-entry.js'), `require('bytenode')\nrequire('./main.jsc')\n`)

fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify(info, null, 2))
console.log('  v8', info.v8, '| electron', info.electron || '(none)')
console.log('BYTECODE_OK')
