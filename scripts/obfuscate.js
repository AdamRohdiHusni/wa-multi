#!/usr/bin/env node
// Obfuscate main.js + license.js → pack-src/main.js + pack-src/license.js
//
// Why not bytecode: V8 cachedData is NOT portable across OS (Linux build vs
// Windows buyer = "Invalid or incompatible cached data"). Obfuscation keeps
// plain JS (runs anywhere Electron runs) while destroying readability:
// names mangled, strings encoded, control-flow flattened.
//
// Tuning: controlFlowFlattening + stringArray on; selfDefending OFF (breaks
// when asar bytes differ); transformObjectKeys ON for extra scrambling.
'use strict'
const fs = require('fs')
const path = require('path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'pack-src')

const opts = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: false,
  debugProtection: false,          // OFF — would break devtools debugging forever & hurt support
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,             // mangle top-level fn names (ensureEngine dst)
  selfDefending: false,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
}

for (const f of ['main.js', 'license.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  const res = JavaScriptObfuscator.obfuscate(src, { ...opts, inputFileName: f })
  fs.writeFileSync(path.join(OUT, f), res.getObfuscatedCode())
  const kb = (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)
  console.log(`  obfuscated ${f} → ${kb} KB`)
}
console.log('OBFUSCATE_OK')
