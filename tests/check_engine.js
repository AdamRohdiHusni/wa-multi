// validate the injected engine string standalone (no electron needed)
const fs = require('fs')
const src = fs.readFileSync('/home/suki/server-stack/wa-multi/main.js', 'utf8')
const m = src.match(/const INITIAL_ENGINE = \[[\s\S]*?\]\.join\(''\)/)
if (!m) { console.log('ENGINE BLOCK NOT FOUND'); process.exit(1) }
eval(m[0].replace('const INITIAL_ENGINE', 'var INITIAL_ENGINE'))
console.log('engine length:', INITIAL_ENGINE.length)
console.log('--- engine source ---')
console.log(INITIAL_ENGINE)
console.log('--- syntax check ---')
try { new Function(INITIAL_ENGINE); console.log('SYNTAX OK') } catch (e) { console.log('SYNTAX ERR:', e.message) }