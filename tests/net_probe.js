// Is Electron's own network stack able to reach GitHub from this host right now?
const { app, net } = require('electron')

app.whenReady().then(async () => {
  const urls = [
    'https://github.com/AdamRohdiHusni/wa-multi/releases/latest/download/latest.yml',
    'https://api.github.com/repos/AdamRohdiHusni/wa-multi/releases?per_page=1',
    'https://example.com'
  ]
  for (const u of urls) {
    await new Promise((resolve) => {
      const req = net.request(u)
      let code = null
      req.on('response', (res) => { code = res.statusCode; res.on('data', () => {}); res.on('end', () => { console.log('NET|', code, u); resolve() }) })
      req.on('error', (e) => { console.log('NET|ERR', String(e.message), u); resolve() })
      req.end()
      setTimeout(() => { console.log('NET|TIMEOUT', u); resolve() }, 15000)
    })
  }
  app.exit(0)
})
