const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const WebSocket = require('ws');

const repo = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const tempRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp/opencode') : require('node:os').tmpdir();
fs.mkdirSync(tempRoot, { recursive: true });
const artifacts = fs.mkdtempSync(path.join(tempRoot, 'syncsave-launch-'));
const pdfPythonPath = process.env.PDF_VERIFY_PYTHON_PATH;

async function main() {
  const bundle = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import DocumentEditor from './apps/web/src/components/editor/DocumentEditor';
        import DashboardView from './apps/web/src/components/DashboardView';
        import * as Y from 'yjs';
        import {THEME_INIT_SCRIPT} from './apps/web/src/lib/theme';
        import ThemeToggle from './apps/web/src/components/ThemeToggle';
        window.themeBootstrapScript=THEME_INIT_SCRIPT;
        window.readSharedBytes=()=>Array.from(Y.encodeStateAsUpdate(document.querySelector('.ProseMirror').editor.extensionManager.extensions.find(extension=>extension.name==='collaboration').options.document));
        window.fetch = async (url,options) => {
          if(location.pathname==='/dashboard-test'&&String(url).startsWith('/api/documents')) {
            if(options?.method==='POST') {window.createdDocument=JSON.parse(options.body);return Response.json({document:{id:'new-test',...window.createdDocument,updatedAt:new Date().toISOString()}})}
            const documents=[{id:'browser-fixture',title:'Browser verification document',preview:'Isolated API fixture for checking card spacing, typography, and responsive layout.',workspaceId:'test',ownerId:'tester',isArchived:false,deletedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),_count:{collaborators:2}}];
            return Response.json({documents,pagination:{page:1,totalPages:1,total:documents.length}});
          }
          return new Response('{}', {status:503});
        };
        createRoot(document.getElementById('root')).render(location.pathname==='/dashboard-test'
          ? <div className='mx-auto max-w-7xl p-4 sm:p-6'><div className='mb-4 flex justify-end'><ThemeToggle /></div><DashboardView userId='tester' initialWorkspaces={[{id:'test',name:'Test workspace',description:null,ownerId:'tester'}]} /></div>
          : <DocumentEditor document={{id:'launch-'+Date.now(),title:'Launch verification',content:null,isArchived:false,updatedAt:new Date().toISOString(),userRole:'OWNER'}} userId='tester' />);`,
      resolveDir: repo, loader: 'tsx',
    }, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': path.join(repo, 'apps/web/src') },
    plugins: [{ name: 'next-boundaries', setup(build) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
        contents: args.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}` : `export function useRouter(){return {push(){},refresh(){}}}`,
        loader: 'jsx', resolveDir: repo,
      }));
    } }],
  });
  const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const liveHTML = await fetch(publicBase + '/demo').then(response => response.text());
  const cssPaths = [...liveHTML.matchAll(/href="([^"]+\.css[^"]*)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
  if (!cssPaths.length) throw new Error('No live application stylesheets found');
  const css = (await Promise.all(cssPaths.map(cssPath => fetch(new URL(cssPath, publicBase)).then(response => response.text())))).join('\n');
  let printMarkup = '';
  let themeBootstrap = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url === '/export-check') { res.setHeader('Content-Type', 'text/html'); res.end(printMarkup); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>${themeBootstrap}</script><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${artifacts}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
      chrome.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      chrome.on('error', error => { clearTimeout(timeout); reject(error); });
    });
    ws = new WebSocket(endpoint);
    await new Promise(resolve => ws.on('open', resolve));
    let nextId = 0;
    const pending = new Map();
    const consoleErrors = [];
    let pageLoaded;
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.method === 'Page.loadEventFired' && pageLoaded) pageLoaded();
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map(arg => arg.value || arg.description || '').join(' ');
        if (/Encountered a script tag|Hydration failed/.test(text)) consoleErrors.push(text);
      }
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const loadPage = async (method, params) => {
      let timeout;
      const loaded = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Page did not load')), 20000);
        pageLoaded = () => { clearTimeout(timeout); pageLoaded = undefined; resolve(); };
      });
      await call(method, params);
      await loaded;
    };
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const paint = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const clickText = async text => { await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.getBoundingClientRect().width>0&&b.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button: '+${JSON.stringify(text)});button.click()})()`); await paint(); };
    await call('Page.enable');
    await call('Runtime.enable');
    await loadPage('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('.ProseMirror')?.editor?.isEditable&&Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='History')){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Editor not ready'))}},100)})`);
    themeBootstrap = await evaluate('window.themeBootstrapScript');
    await evaluate(`document.querySelector('.ProseMirror').editor.commands.setContent({type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'Launch plan'}]},{type:'heading',attrs:{level:2},content:[{type:'text',text:'Decisions'}]},{type:'heading',attrs:{level:3},content:[{type:'text',text:'Next steps'}]},...Array.from({length:100},(_,i)=>({type:'paragraph',content:[{type:'text',text:'Paragraph '+i+' — Long document scrolling verification. '.repeat(8),marks:i===0?[{type:'bold'}]:[]}]}))]})`);
    await paint();
    const layouts = [];
    await evaluate(`window.editorBeforeTheme=document.querySelector('.ProseMirror').editor;window.bytesBeforeTheme=JSON.stringify(window.readSharedBytes())`);
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await paint();
    for (const expected of [false, true]) {
      await clickText('Outline');
      const actual = await evaluate(`document.querySelector('aside[aria-label="Outline sidebar"]').getBoundingClientRect().width>0`);
      if (actual !== expected) throw new Error('Desktop Outline toggle does not match its visible sidebar');
    }
    await evaluate(`window.scrollTo({top:1200,behavior:'instant'})`); await paint();
    await evaluate(`document.querySelector('aside[aria-label="Outline sidebar"] button[title="Decisions"]').click()`);
    await evaluate(`new Promise(resolve=>setTimeout(resolve,700))`);
    if (!await evaluate(`(()=>{const target=document.querySelector('.ProseMirror h2').getBoundingClientRect();const header=document.querySelector('[data-editor-header]').getBoundingClientRect();return target.top>=header.bottom&&target.top<header.bottom+60})()`)) throw new Error('Outline heading navigation is hidden under the sticky header');
    if (!await evaluate(`document.querySelector('[aria-label="Document tools"]').getBoundingClientRect().bottom<=document.querySelector('[role="toolbar"]').getBoundingClientRect().top`)) throw new Error('Document tools must be above formatting toolbar');
    for (const theme of ['dark', 'light']) {
      await evaluate(`(()=>{if((document.documentElement.dataset.theme||'dark')!==${JSON.stringify(theme)})document.querySelector('button[aria-label^="Switch to"]').click()})()`); await paint();
      for (const [width, height] of [[1440,900], [768,1024], [640,800], [375,812], [320,640]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 }); await paint();
      for (const offset of [0,1200,999999]) {
        await evaluate(`window.scrollTo({top:${offset},behavior:'instant'})`); await paint();
        const metrics = await evaluate(`(()=>{const header=document.querySelector('header').getBoundingClientRect();const toolbar=document.querySelector('[role="toolbar"]').getBoundingClientRect();return {scrollY,headerTop:header.top,headerBottom:header.bottom,toolbarBottom:toolbar.bottom,overflow:document.documentElement.scrollWidth>innerWidth,visible:Array.from(document.querySelectorAll('header button,header input')).filter(el=>el.getBoundingClientRect().width>0).every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})}})()`);
        if (metrics.headerTop !== 0 || metrics.overflow || !metrics.visible || metrics.toolbarBottom > height || (offset > 0 && metrics.scrollY < 1000)) throw new Error('Layout failure: ' + JSON.stringify({ width, height, offset, ...metrics }));
        layouts.push({ theme, width, height, offset, ...metrics });
      }
      if (width < 640) { await evaluate(`document.querySelector('[aria-label="More formatting options"]').click()`); await paint(); }
      await evaluate(`document.querySelector('[aria-label="Add Link"]').click()`); await paint();
      const modal = await evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').parentElement.getBoundingClientRect();return r.top===0&&r.left===0&&r.height===innerHeight&&r.width===innerWidth})()`);
      if (!modal) throw new Error('Link modal is not viewport-sized');
      await evaluate(`document.querySelector('[role="dialog"] [data-modal-close]').click()`); await paint();
      if (width < 640) { await evaluate(`document.querySelector('[aria-label="More formatting options"]').click()`); await paint(); }
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(artifacts, `editor-${theme}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
    if (!await evaluate(`window.editorBeforeTheme===document.querySelector('.ProseMirror').editor&&window.bytesBeforeTheme===JSON.stringify(window.readSharedBytes())`)) throw new Error('Theme or responsive UI replaced the editor or changed shared content');
    await clickText('Outline');
    if (!await evaluate(`document.querySelector('dialog[open] [aria-label="Document outline"]').textContent.includes('Launch plan')`)) throw new Error('Mobile outline failed');
    await evaluate(`document.querySelector('dialog[open] button[aria-label="Close outline"]').click()`); await paint();
    await clickText('Find');
    await evaluate(`(()=>{const input=document.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Paragraph 42');input.dispatchEvent(new Event('input',{bubbles:true}))})()`); await paint();
    await clickText('Show match');
    if (!await evaluate(`(()=>{const e=document.querySelector('.ProseMirror').editor;return e.state.doc.textBetween(e.state.selection.from,e.state.selection.to)==='Paragraph 42'})()`)) throw new Error('Find did not select live text');
    await clickText('Export');
    if (!await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('whiteboard drawings are not included')`)) throw new Error('Export scope missing');
    await evaluate(`(()=>{
      const blobs=new Map();const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url};
      window.exportDownloads=[];const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.exportDownloads.push({filename:this.download,blob:blobs.get(this.href)});click.call(this)};
      new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLIFrameElement)window.printFrame=node}).observe(document.body,{childList:true});
    })()`);
    for (const format of ['docx','txt','md','html','json']) {
      await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.querySelector('span')?.textContent.toLowerCase().includes(${JSON.stringify(format === 'md' ? 'markdown' : format)}));if(!button)throw Error('Export option missing');button.click()})()`);
      await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(window.exportDownloads.some(item=>item.filename.endsWith('.${format}'))){clearInterval(timer);resolve(true)}else if(++attempts>200){clearInterval(timer);reject(Error('Export failed: ${format}'))}},50)})`);
      const exported = await evaluate(`(async()=>{const item=window.exportDownloads.find(item=>item.filename.endsWith('.${format}'));const bytes=new Uint8Array(await item.blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return {filename:item.filename,data:btoa(binary)}})()`);
      fs.writeFileSync(path.join(artifacts, exported.filename), Buffer.from(exported.data, 'base64'));
    }
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent.includes('PDF')).click()`);
    await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(window.printFrame?.contentDocument?.body.textContent.includes('Launch plan')){clearInterval(timer);resolve(true)}else if(++attempts>200){clearInterval(timer);reject(Error('Print frame failed'))}},50)})`);
    printMarkup = await evaluate(`window.printFrame.contentDocument.documentElement.outerHTML`);
    if (!printMarkup.includes('Launch plan') || printMarkup.includes('Working offline:')) throw new Error('Print document lost content or includes application chrome');
    await clickText('Close');
    await clickText('History');
    if (!await evaluate(`document.querySelector('[role="dialog"]').textContent.toLowerCase().includes('snapshot')`)) throw new Error('History panel missing');
    await evaluate(`(()=>{const input=document.querySelector('[role="dialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Launch snapshot');input.dispatchEvent(new Event('input',{bubbles:true}))})()`); await paint();
    await clickText('Save snapshot');
    await evaluate(`document.querySelector('.ProseMirror').editor.commands.setContent('<p>Changed after checkpoint</p>')`); await paint();
    await clickText('Preview');
    if (!await evaluate(`document.querySelector('[role="dialog"] pre').textContent.includes('Launch plan')`)) throw new Error('Snapshot preview failed');
    await clickText('Back to history');
    await clickText('Restore');
    await clickText('Restore shared text');
    if (!await evaluate(`document.querySelector('.ProseMirror').editor.getText().includes('Launch plan')&&document.querySelector('[role="dialog"]').textContent.includes('Before restore')`)) throw new Error('Shared restore or safety snapshot failed');
    await clickText('Close');
    await clickText('Comments');
    await evaluate(`(()=>{const input=document.querySelector('[role="dialog"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Launch feedback');input.dispatchEvent(new Event('input',{bubbles:true}))})()`); await paint();
    await clickText('Post comment');
    await clickText('Resolve');
    if (!await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).some(b=>b.textContent.trim()==='Reopen')&&document.querySelector('[role="dialog"]').textContent.includes('Launch feedback')`)) throw new Error('Comment posting or resolution failed');
    await loadPage('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/export-check` });
    await evaluate(`new Promise(resolve=>document.readyState==='complete'?resolve():window.addEventListener('load',resolve,{once:true}))`);
    const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    const pdfPath = path.join(artifacts, 'Launch verification.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(pdf.data, 'base64'));
    if (pdfPythonPath) {
      const result = execFileSync('python', ['-c', `import sys;sys.path.insert(0,sys.argv[1]);from pypdf import PdfReader;r=PdfReader(sys.argv[2]);text=''.join(p.extract_text() for p in r.pages);assert len(r.pages)>1;assert all(s in text for s in ['Launch plan','Decisions','Next steps','Paragraph 99']);assert 'Working offline:' not in text;print(str(len(r.pages))+' PDF pages: formatted content verified')`, pdfPythonPath, pdfPath], { encoding: 'utf8' });
      console.log(result.trim());
    }
    await loadPage('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/dashboard-test` });
    await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Templates')){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Dashboard not ready'))}},100)})`);
    if (!await evaluate(`document.documentElement.dataset.theme==='light'&&document.documentElement.scrollWidth<=innerWidth`)) throw new Error('Dashboard theme persistence or mobile overflow failed');
    for (const theme of ['light', 'dark']) {
      await evaluate(`(()=>{if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('button[aria-label^="Switch to"]').click()})()`);
      for (const width of [1440, 375, 320]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 }); await paint();
        if (!await evaluate(`document.documentElement.scrollWidth<=innerWidth`)) throw new Error('Dashboard overflow: ' + theme + ' ' + width);
        if (width < 640) {
          await evaluate(`document.querySelector('[aria-controls="dashboard-navigation"]').click()`); await paint();
          if (!await evaluate(`document.querySelector('[aria-controls="dashboard-navigation"]').getAttribute('aria-expanded')==='true'&&document.querySelector('#dashboard-navigation').getBoundingClientRect().height>0`)) throw new Error('Mobile dashboard navigation failed');
        }
        const screenshot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(artifacts, `dashboard-${theme}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        if (width < 640) { await evaluate(`document.querySelector('[aria-controls="dashboard-navigation"]').click()`); await paint(); }
      }
    }
    await loadPage('Page.reload');
    await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('button[aria-label="Switch to light mode"]')){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Dashboard theme reload failed'))}},50)})`);
    if (!await evaluate(`document.documentElement.dataset.theme==='dark'&&localStorage.getItem('syncspace:theme')==='dark'`)) throw new Error('Dashboard theme reload persistence failed');
    await clickText('Templates');
    await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.includes('Meeting notes'));if(!b)throw Error('Template missing');b.click()})()`); await paint();
    if (!await evaluate(`window.createdDocument?.title==='Meeting notes'&&JSON.parse(window.createdDocument.content).content.some(n=>n.type==='heading')`)) throw new Error('Template creation payload failed');
    await loadPage('Page.reload');
    await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Import')){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Dashboard import not ready'))}},100)})`);
    await clickText('Import');
    await evaluate(`(()=>{const input=document.querySelector('input[type="file"]');const data=new DataTransfer();data.items.add(new File(['Literal <b>notes</b>'],'Notes.txt',{type:'text/plain'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(window.createdDocument){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Import did not create a document'))}},50)})`);
    if (!await evaluate(`window.createdDocument.title==='Notes'&&JSON.parse(window.createdDocument.content).content[0].content[0].text==='Literal <b>notes</b>'`)) throw new Error('Literal TXT import failed');
    for (const route of ['/', '/contact', '/help', '/privacy', '/terms', '/demo']) {
      const response = await fetch(publicBase + route);
      if (response.status !== 200 || !await response.text().then(text => text.includes('goelyash749@gmail.com'))) throw new Error('Public route failed: ' + route);
      await loadPage('Page.navigate', { url: publicBase + route });
      await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'&&document.querySelector('h1')&&document.querySelector('footer')){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Public page not ready'))}},100)})`);
      await paint();
      await evaluate(`Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))`);
      await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.readyState==='complete'&&document.querySelector('h1')&&Array.from(document.querySelectorAll('a[href^="mailto:"]')).some(a=>a.textContent.includes('goelyash749@gmail.com'))){clearInterval(timer);resolve(true)}else if(++attempts>200){clearInterval(timer);reject(Error('Public page changed during hydration: '+location.href))}},100)})`);
      if (!await evaluate(`document.documentElement.scrollWidth<=innerWidth&&Array.from(document.querySelectorAll('a[href^="mailto:"]')).some(a=>a.textContent.includes('goelyash749@gmail.com'))`)) {
        const diagnostic = await evaluate(`({url:location.href,title:document.querySelector('h1')?.textContent,footer:document.querySelector('footer')?.textContent,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mail:Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(a=>a.textContent),overflow:Array.from(document.querySelectorAll('body *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>({tag:el.tagName,classes:el.className}))})`);
        throw new Error('Mobile public layout or contact failed: ' + route + ' ' + JSON.stringify(diagnostic) + ' console: ' + consoleErrors.join('\n'));
      }
      if (route === '/' && !await evaluate(`(()=>{const selectors=['#hero-heading','#hero-cta-primary','#hero-cta-secondary'];return selectors.every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})})()`)) throw new Error('Homepage headline or actions are clipped');
      if (route === '/demo') {
        await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('.ProseMirror')?.editor){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Demo not ready'))}},100)})`);
        await evaluate(`document.querySelector('.ProseMirror').editor.commands.setContent('<p>Changed local sample</p>')`);
        await clickText('Reset sample');
        if (!await evaluate(`document.querySelector('.ProseMirror').textContent.includes('A space to try your next idea')`)) throw new Error('Demo reset failed');
        for (const theme of ['light', 'dark']) {
          await evaluate(`localStorage.setItem('syncspace:theme',${JSON.stringify(theme)})`);
          await loadPage('Page.reload');
          await evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('.ProseMirror')?.editor&&document.documentElement.dataset.theme===${JSON.stringify(theme)}){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(Error('Live theme bootstrap failed'))}},50)})`);
          const background = await evaluate(`getComputedStyle(document.body).backgroundColor`);
          if (background !== (theme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(15, 15, 15)')) throw new Error('Expected neutral ' + theme + ' background, got ' + background);
        }
      }
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(artifacts, `public-${route.replace(/\//g, '') || 'home'}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    if (consoleErrors.length) throw new Error('Browser console errors: ' + consoleErrors.join('\n'));
    console.log(JSON.stringify({ result: 'PASS', boundaries: ['Next routing stubbed for isolated editor/dashboard', 'offline editor API and isolated dashboard fixtures', 'PDF bytes generated from captured print-frame HTML via Chrome; native save destination remains user-controlled'], checks: ['real TipTap/Yjs editor identity and unchanged shared content across themes', 'both themes at five viewport sizes and long-document scrolling', 'mobile More and link dialog', 'left outline and mobile drawer/find', 'snapshot capture/preview/restore with safety copy', 'comment posting/resolution', 'DOCX/TXT/Markdown/HTML/JSON download bytes and PDF print content', 'both-theme responsive dashboard and theme reload persistence', 'dashboard template and literal TXT import', 'six live public routes on mobile', 'real demo reset'], layouts, artifacts }, null, 2));
  } finally {
    if (ws) ws.close(); chrome.kill(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
