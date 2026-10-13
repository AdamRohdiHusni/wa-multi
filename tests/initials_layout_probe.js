// Probe 4: real index.html + engine installed the SAME way the app does
// (webContents.executeJavaScript, which bypasses CSP), then exercise append.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const m = mainSrc.match(/const INITIAL_ENGINE = ([\s\S]*?"return 'installed'\}\)\(\)")/)
if (!m) { console.error('could not extract INITIAL_ENGINE'); process.exit(1) }
const pageCode = eval(m[1])

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 700 })
  await win.loadFile(path.join(__dirname, '..', 'index.html'))
  await new Promise(r => setTimeout(r, 800))

  // Install exactly like the app does.
  const installRes = await win.webContents.executeJavaScript(pageCode)
  console.log('install:', installRes)

  const out = await win.webContents.executeJavaScript(`(function(){
    var log=[];
    function say(s){log.push(s)}
    try{
      var E=window.__WA_MULTI_INITIAL_ENGINE__
      E.setCfg({enabled:true,code:'/DM',append:true,skipGroups:true})
      var host=document.getElementById('__eng_host')
      if(!host){host=document.createElement('div');host.id='__eng_host';
        host.setAttribute('contenteditable','true');host.style.cssText='position:fixed;left:-9999px;top:0';
        document.body.appendChild(host)}
      function put(t){host.innerHTML=t;host.focus();var r=document.createRange();
        r.selectNodeContents(host);r.collapse(false);var s=window.getSelection();
        s.removeAllRanges();s.addRange(r)}
      function flat(){return host.innerHTML.split('<br>').join('|BR|').replace(/<[^>]+>/g,'')}

      // raw capability test in THIS document
      put('halo')
      var raw;try{raw=document.execCommand('insertHTML',false,'<br>ZZ')}catch(e){raw='ERR:'+e.message}
      say('raw insertHTML ret='+raw+' html='+JSON.stringify(host.innerHTML))

      put('halo')
      var raw2;try{raw2=document.execCommand('insertText',false,'\\nZZ')}catch(e){raw2='ERR:'+e.message}
      say('raw insertText ret='+raw2+' html='+JSON.stringify(host.innerHTML))

      // now the engine path
      put('halo')
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))
      say('engine keydown: html='+JSON.stringify(host.innerHTML)+' flat='+JSON.stringify(flat()))
      say('engine get: '+JSON.stringify(E.get()))
    }catch(e){say('EXCEPTION: '+e.message)}
    return log.join('\\n')
  })()`)
  console.log(out)

  // Visual proof: the settings dialog with the initials tag rendered BELOW the
  // message (not beside it), then the topbar update badge.
  await win.webContents.executeJavaScript(`(function(){
    var E=window.__WA_MULTI_INITIAL_ENGINE__
    if(E)E.setCfg({enabled:true,code:'/DM',skipGroups:true})
    document.getElementById('settingsDlg').showModal()
    var on=document.getElementById('initOn');if(on){on.checked=true;on.dispatchEvent(new Event('change'))}
    var c=document.getElementById('initCode');if(c){c.value='/DM';c.dispatchEvent(new Event('input'))}
    var b=document.getElementById('updBadge');if(b)b.classList.remove('hidden')
    document.getElementById('updStatus').textContent='🎉 Versi baru v2.6.1 udah ada — klik "Update sekarang" kalau mau'
    document.getElementById('btnInstallUpdate').classList.remove('hidden')
  })()`)
  await new Promise(r => setTimeout(r, 600))
  const shot = process.env.WA_MULTI_SHOT || '/tmp/wa-multi-settings'
  fs.writeFileSync(shot + '.png', (await win.webContents.capturePage()).toPNG())
  console.log('shot:', shot + '.png')

  app.quit()
})
