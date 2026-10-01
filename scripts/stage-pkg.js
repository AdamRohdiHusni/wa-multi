#!/usr/bin/env node
// Stage pack-src/package.json for electron-builder:
//   • main = index.js (bytecode bootstrap)
//   • bytenode as PRODUCTION dependency (required at buyer runtime!)
//   • self-contained build config (files: everything staged)
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const p = { ...root, main: 'main.js' }
// obfuscated core = plain JS → no runtime loader deps needed
delete p.dependencies
p.devDependencies = { electron: root.devDependencies.electron }
delete p.scripts
// self-contained build config for the staged dir
p.build = {
  ...root.build,
  files: ['**/*'],
  directories: { output: '../dist' }
}
fs.writeFileSync(path.join(ROOT, 'pack-src', 'package.json'), JSON.stringify(p, null, 2))
console.log(`staged pkg: main=${p.main} deps=${JSON.stringify(p.dependencies)}`)
