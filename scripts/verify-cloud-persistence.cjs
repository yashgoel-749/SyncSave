const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const Y = require('yjs');
const { PrismaClient } = require('@syncspace/db');
require('dotenv').config({ path: path.join(__dirname, '../apps/web/.env'), quiet: true });

const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const root = path.join(process.env.LOCALAPPDATA, 'Temp/opencode');
const artifacts = fs.mkdtempSync(path.join(root, 'syncsave-cloud-'));
const prisma = new PrismaClient();

async function main() {
  let user;
  let chrome;
  let ws;
  let docId;
  const results = [];
  try {
    user = await prisma.user.create({ data: { email: `cloud-check-${Date.now()}@example.invalid`, name: 'Temporary cloud verifier' } });
    const { encode } = await import('next-auth/jwt');
    const cookieName = 'authjs.session-token';
    const token = await encode({ secret: process.env.AUTH_SECRET, salt: cookieName, token: { sub: user.id, id: user.id, email: user.email, name: user.name }, maxAge: 3600 });
    const created = await fetch(base + '/api/documents', {
      method: 'POST', headers: { Cookie: `${cookieName}=${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Temporary cloud persistence verification' }),
    });
    if (!created.ok) throw new Error(`Create document: HTTP ${created.status}`);
    docId = (await created.json()).document.id;
    chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${artifacts}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 20000);
      chrome.stderr.on('data', data => {
        output += data;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on('error', reject);
    });
    ws = new WebSocket(endpoint);
    await new Promise(resolve => ws.on('open', resolve));
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 40000);
      pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = expression => evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+30000;const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}else if(Date.now()>end){clearInterval(timer);reject(Error('Condition timed out'))}},100)})`);
    const editor = `document.querySelector('.ProseMirror')?.editor`;
    const saved = `Array.from(document.querySelectorAll('header button')).some(button=>button.textContent.trim()==='Saved to cloud')`;
    await call('Runtime.enable');
    await call('Network.setCookie', { name: cookieName, value: token, url: base, httpOnly: true, sameSite: 'Lax' });
    await call('Page.navigate', { url: base + '/documents/' + docId });
    await wait(`${editor}?.isEditable`);
    await wait(saved);
    results.push('Initial empty binary baseline verified');

    await evaluate(`${editor}.commands.focus('end')`);
    await wait(`document.activeElement===document.querySelector('.ProseMirror')`);
    await call('Input.insertText', { text: 'Neon must contain this latest text.' });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    if (!await evaluate(`${editor}.getText().includes('Neon must contain this latest text.')`)) throw new Error('Typing did not reach the editor');
    if (await evaluate(saved)) throw new Error('New edit still marked saved');
    await wait(saved);
    const confirmDatabase = async expected => {
      const row = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
      const persisted = new Y.Doc();
      Y.applyUpdate(persisted, new Uint8Array(row.yjsState));
      const text = persisted.getXmlFragment('default').toString();
      if (!text.includes(expected)) throw new Error('Neon state does not contain expected text: ' + expected);
      persisted.destroy();
      const readback = await fetch(base + `/api/documents/${docId}/persistence`, { headers: { Cookie: `${cookieName}=${token}` } });
      if (readback.headers.get('cache-control') !== 'private, no-store') throw new Error('Readback can be cached');
      if (!Buffer.from(await readback.arrayBuffer()).equals(Buffer.from(row.yjsState))) throw new Error('HTTP readback differs from Neon');
    };
    await confirmDatabase('Neon must contain this latest text.');
    results.push('Typed text verified against actual Neon binary and HTTP readback');

    await evaluate(`${editor}.commands.selectAll();${editor}.commands.deleteSelection()`);
    await wait(saved);
    const empty = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    if (empty.content.includes('Neon must contain')) throw new Error('Empty-document JSON snapshot retained deleted text');
    results.push('Deletion saved; JSON snapshot no longer contains deleted text');

    await evaluate(`document.querySelector('button[title="Click to view detailed synchronization & persistence status"]').click()`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Simulate going offline').click()`);
    await evaluate(`${editor}.commands.focus('end')`);
    await wait(`document.activeElement===document.querySelector('.ProseMirror')`);
    await call('Input.insertText', { text: 'Offline change reaches Neon after reconnect.' });
    if (await evaluate(saved)) throw new Error('Offline edit marked cloud saved');
    await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Document title"]');input.focus();input.select()})()`);
    await call('Input.insertText', { text: 'Renamed while content is offline' });
    await evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+15000;const timer=setInterval(async()=>{const response=await fetch('/api/documents/${docId}');const data=await response.json();if(data.document?.title==='Renamed while content is offline'){clearInterval(timer);resolve(true)}else if(Date.now()>end){clearInterval(timer);reject(Error('Title did not save independently'))}},500)})`);
    if (await evaluate(saved)) throw new Error('Title PATCH incorrectly marked offline content cloud saved');
    results.push('Title saves independently without falsely verifying offline content');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Reconnect to collaboration server').click()`);
    await wait(saved);
    await confirmDatabase('Offline change reaches Neon after reconnect.');
    results.push('Offline edits not marked saved until reconnect and database confirmation');
    await call('Page.reload');
    await wait(`${editor}?.getText().includes('Offline change reaches Neon after reconnect.')`);
    await wait(saved);
    results.push('Reload preserves content and verifies current database state');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifacts, 'cloud-verified.png'), Buffer.from(screenshot.data, 'base64'));
    if ((await fetch(base + `/api/documents/${docId}/persistence`)).status !== 401) throw new Error('Anonymous readback allowed');
    if (exceptions.length) throw new Error(exceptions.join('\n'));
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ results, exceptions }, null, 2));
    console.log(JSON.stringify({ results, artifacts }, null, 2));
  } finally {
    ws?.close();
    chrome?.kill();
    // Only records created by this run are removed; existing user documents are untouched.
    if (docId) await prisma.document.delete({ where: { id: docId } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
