// Headless UI smoke test through the Edge DevTools protocol.
// Boots a demo server, opens the app, waits for the SPA to render, then
// reports visible markers plus any uncaught exceptions or console errors.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => existsSync(candidate));
if (!EDGE) {
  console.log('NO_EDGE');
  process.exit(0);
}

const port = 4700 + Math.floor(Math.random() * 60);
const debugPort = 9300 + Math.floor(Math.random() * 60);

const server = spawn(process.execPath, ['bin/kanmod.js', '--demo', '--fresh', '--no-open', `--port=${port}`], {
  cwd: process.cwd(),
  env: { ...process.env, KANMOD_DEMO_DIR: mkdtempSync(path.join(tmpdir(), 'kanmod-ui-demo-')) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.setEncoding('utf8');
const token = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server timeout')), 20000);
  server.stdout.on('data', (chunk) => {
    out += chunk;
    const match = /token=([a-f0-9]{32,})/.exec(out);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  server.on('exit', (code) => reject(new Error(`server exit ${code}`)));
});

const profile = mkdtempSync(path.join(tmpdir(), 'kanmod-edge-'));
const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-proxy-server',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let targets = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(250);
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const list = await response.json();
    const page = list.find((item) => item.type === 'page');
    if (page) {
      targets = page;
      break;
    }
  } catch {
    // DevTools endpoint not ready yet.
  }
}
if (!targets) {
  console.log('NO_TARGET');
  server.kill();
  edge.kill();
  process.exit(1);
}

const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    exceptions.push(details.exception?.description || details.text);
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleErrors.push(message.params.type + ': ' + message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  }
  if (message.method === 'Log.entryAdded') {
    consoleErrors.push('log ' + message.params.entry.level + ': ' + message.params.entry.text);
  }
  if (message.method === 'Network.loadingFailed') {
    consoleErrors.push('netfail: ' + message.params.errorText + ' ' + (message.params.requestId || ''));
  }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (message) => {
    if (message.error) reject(new Error(`${method}: ${message.error.message}`));
    else resolve(message.result);
  });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/?token=${token}` });
await sleep(4500);

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value;
};

const snapshot = await evaluate('document.documentElement.outerHTML');
writeFileSync(path.join(tmpdir(), 'kanmod-dom-last.html'), String(snapshot || ''));
const markers = await evaluate(`JSON.stringify({
  nav: document.querySelectorAll('.nav-item').length,
  hero: Boolean(document.querySelector('.hero')),
  metrics: document.querySelectorAll('.metric').length,
  modCards: document.querySelectorAll('.mod-card').length,
  boot: Boolean(document.querySelector('.boot-screen')),
  fatal: Boolean(document.querySelector('.fatal')),
  title: document.title,
  view: document.querySelector('.view-name')?.textContent || null
})`);

const navCount = Number(await evaluate('document.querySelectorAll(".nav-item").length'));
const viewResults = [];
for (let index = 0; index < navCount; index += 1) {
  await evaluate(`document.querySelectorAll('.nav-item')[${index}].click()`);
  await sleep(700);
  const info = await evaluate(`JSON.stringify({ view: document.querySelector('.nav-item.active')?.textContent.trim() || null, len: document.querySelector('#view-root')?.innerHTML.length || 0, text: (document.querySelector('#view-root')?.textContent || '').trim().slice(0, 40) })`);
  viewResults.push(JSON.parse(info));
}
console.log('views:', JSON.stringify(viewResults));

console.log('dom bytes:', String(snapshot || '').length);
console.log('markers:', markers);
console.log('exceptions:', exceptions.slice(0, 5));
console.log('console errors:', consoleErrors.slice(0, 5));

ws.close();
server.kill();
edge.kill();
process.exit(0);
