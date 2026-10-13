// Probe: what is the send-message interception surface in WA Web (wa-js 4.6.0) ?
process.env.WA_MULTI_DEV = '1'
process.env.WA_MULTI_TESTHOOK = '1'
const fs = require('fs')
const path = require('path')
try { fs.rmSync(path.join(__dirname, '..', 'dev-userdata'), { recursive: true, force: true }) } catch (_) {}
require(path.join(__dirname, '..', 'main.js'))

const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await wait(2500)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c)
  const A = await js('window.waMulti.addAccount("Probe")')
  await js(`window.waMulti.setPinned("${A.id}", true)`)
  await js(`window.waMulti.openAccount("${A.id}")`)

  const v = global.__wa.views.get(A.id)
  const wc = v.webContents

  let injected = false
  for (let i = 0; i < 40; i++) {
    const s = await wc.executeJavaScript(`(function(){try{return !!(window.WPP&&window.WPP.isInjected)}catch(e){return false}})()`).catch(() => false)
    if (s === true) { injected = true; console.log('INJECTED at poll ' + i); break }
    await wait(1000)
  }
  console.log('injected=' + injected)
  if (!injected) { app.exit(0) }

  const dump = await wc.executeJavaScript(`(function(){
    const out = {}
    const keys = (o) => { try { return Object.keys(o || {}) } catch(e) { return ['ERR:'+e.message] } }
    // 1. wa-js top level
    out.WPP_keys = keys(window.WPP)
    out.WPP_version = window.WPP && window.WPP.version ? String(window.WPP.version) : null
    // 2. whatsapp namespace
    out.whatsapp_keys = keys(window.WPP && window.WPP.whatsapp)
    // 3. wa-js public API namespaces of interest
    for (const ns of ['chat','msg','contact','group','whatsapp','webpack','util']) {
      out['ns_'+ns] = keys(window.WPP && window.WPP[ns]).slice(0, 60)
    }
    // 4. internal functions namespace - hunt for send/msg verbs
    const fns = (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.functions) || {}
    const fk = keys(fns)
    out.functions_total = fk.length
    out.functions_sendish = fk.filter(k => /send|msg|message/i.test(k)).slice(0, 80)
    // 5. legacy Store (may be undefined pre-auth)
    out.has_Store = typeof window.Store
    out.Store_sendish = (typeof window.Store === 'object' && window.Store) ? keys(window.Store).filter(k => /send|msg/i.test(k)).slice(0, 60) : null
    // 6. webpack registry
    out.has_webpack = !!(window.webpackChunkwhatsapp_webpack_modules)
    out.webpack_mCount = window.webpackChunkwhatsapp_webpack_modules ? window.webpackChunkwhatsapp_webpack_modules.length : null
    // 7. wa-js webpack search helper available?
    out.webpack_helpers = keys(window.WPP && window.WPP.webpack)
    // 8. does WPP.chat expose sendTextMessage + is it overridable?
    try {
      const d = Object.getOwnPropertyDescriptor(window.WPP.chat || {}, 'sendTextMessage')
      out.chat_sendTextMessage_desc = d ? { writable: d.writable, hasGet: !!d.get, hasValue: !!d.value, configurable: d.configurable } : 'none'
      out.chat_sendTextMessage_type = typeof (window.WPP.chat && window.WPP.chat.sendTextMessage)
      let proto = window.WPP.chat && Object.getPrototypeOf(window.WPP.chat)
      while (proto) {
        const pd = Object.getOwnPropertyDescriptor(proto, 'sendTextMessage')
        if (pd) { out.chat_stm_on_proto = { writable: pd.writable, hasGet: !!pd.get, configurable: pd.configurable }; break }
        proto = Object.getPrototypeOf(proto)
      }
    } catch (e) { out.chat_stm_err = e.message }
    // 9. DOM composer present?
    out.dom_composer = !!document.querySelector('div[contenteditable="true"][data-tab]')
    out.dom_sendbtn = !!document.querySelector('button[data-testid="send"], span[data-icon="send"], button[aria-label*="Send"], button[aria-label*="Kirim"]')
    out.dom_title = document.title
    return JSON.stringify(out)
  })()`).catch(e => 'DUMPERR ' + String(e).slice(0, 200))
  console.log('DUMP ' + dump)
  app.exit(0)
})