#!/usr/bin/env node
// Stage pack-src/package.json for electron-builder:
//   • main = main.js (obfuscated, plain JS — no runtime loader needed)
//   • KEEP production dependencies: electron-updater ships inside app.asar and is
//     `require`d at buyer runtime. Deleting dependencies here means the updater
//     crashes with "Cannot find module 'electron-updater'" on every user laptop.
//   • self-contained build config (files: everything staged)
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const p = { ...root, main: 'main.js' }
// electron + build tooling stay dev-only; runtime deps (electron-updater) MUST ship
p.dependencies = {
  'electron-updater': (root.dependencies && root.dependencies['electron-updater']) || '^6.3.9'
}
p.devDependencies = { electron: root.devDependencies.electron }
delete p.scripts
// self-contained build config for the staged dir
p.build = {
  ...root.build,
  files: [
    '**/*',
    '!node_modules/**/{test,__tests__,tests,example,examples,docs,doc}/**',
    '!node_modules/**/*.{md,map,ts,tsx}',
    '!node_modules/**/{.eslintrc,.editorconfig,.npmignore,.travis.yml}'
  ],
  directories: { output: '../dist' }
}
fs.writeFileSync(path.join(ROOT, 'pack-src', 'package.json'), JSON.stringify(p, null, 2))
console.log(`staged pkg: main=${p.main} deps=${JSON.stringify(p.dependencies)}`)