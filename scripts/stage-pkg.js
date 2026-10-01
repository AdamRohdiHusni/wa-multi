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
const p = { ...root, main: 'index.js' }
// bytenode WAJIB jadi production dependency — bootstrap require('bytenode')
// di runtime buyer. Kalau cuma devDep, electron-builder gak masukin ke asar
// → app mati di laptop bersih: "Cannot find module 'bytenode'".
p.dependencies = { bytenode: root.devDependencies.bytenode }
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
