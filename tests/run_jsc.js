// Verify the .jsc actually RUNS in the Electron runtime: load main.jsc via a
// bootstrap and confirm the self-test harness boots to completion.
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_SELFTEST = '1'
process.env.WA_MULTI_LIC_FORCE = 'pro'
const bytenode = require('bytenode')
// license.js is required by main.jsc — copy it next to the .jsc so require('./license') resolves
const fs = require('fs'); const path = require('path')
const bcDir = path.join(__dirname, '..', 'build', 'bytecode')
fs.copyFileSync(path.join(__dirname, '..', 'license.js'), path.join(bcDir, 'license.js'))
require(path.join(bcDir, 'main.jsc'))
