// UI state regression: renders every view against sparse API payloads and
// against an empty (no instance) profile, then reports visible
// undefined/null/NaN text, broken attributes and blank labels.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fields the UI treats as optional are deliberately missing here.
const FIXTURES = {
  '/api/catalog/package': { package: { identifier: 'sparse.one', name: null, version: null, author: null, license: null, abstract: null, description: null, ksp_version: null, resources: null, depends: null }, versions: null },
  '/api/installed': { instance: { id: 'demo' }, installed: [{ identifier: '', name: null, folder: '', installedVersion: null, updateAvailable: true, managedBy: null, size: null }], updates: [{}] },
  '/api/catalog': { items: [{ identifier: 'sparse.one', name: null, abstract: null, version: null, kind: null, tags: null, compatibility: null, installed: true }], total: 1, page: null, pageCount: null, facets: { tags: null } },
  '/api/jobs': { jobs: [{ id: 'job-1', status: 'running', progress: null, logs: null }] },
  '/api/diagnostics': { diagnostics: { health: null, counts: null, issues: [{ severity: 'warning' }], log: null }, repairs: { operations: null } },
  '/api/relationships': { package: { identifier: 'sparse.one' }, relationships: { depends: [{ identifier: 'x', displayName: null, name: null, minVersion: '2.0', installedVersion: null }] } },
  '/api/settings': { settings: { install: null, network: null, catalog: null, ui: null } },
  '/api/resolve': { plan: { ok: true, kspVersion: null, summary: { total: 1, install: 1, downloadBytes: null }, nodes: [{ identifier: 'sparse.one', name: null, version: null, action: null, compatibility: null }], installOrder: ['sparse.one'], conflicts: null, missing: null, warnings: null } },
};

const SCAN = `JSON.stringify((() => {
  const textHits = [];
  const attrHits = [];
  const emptyLabels = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').trim();
    if (/undefined|\\bnull\\b|NaN/.test(text)) textHits.push(text.slice(0, 90));
  }
  for (const el of document.querySelectorAll('[href],[src],[title],[aria-label],[placeholder]')) {
    for (const name of ['href', 'src', 'title', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(name);
      if (value && /undefined|\\bnull\\b|NaN/.test(value)) attrHits.push(name + '=' + value.slice(0, 90));
    }
  }
  const emptySelectors = ['.metric-value', '.badge', '.tag', '.mod-page-sub', '.mod-detail-list dd', '.job-title strong', '.issue-copy strong', '.version', '.table-mod strong'];
  for (const selector of emptySelectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (!(el.textContent || '').trim()) emptyLabels.push(selector + ' empty');
    }
  }
  return { textHits: [...new Set(textHits)], attrHits: [...new Set(attrHits)], emptyLabels: [...new Set(emptyLabels)] };
})())`;

async function connect(debugPort) {
  const profile = mkdtempSync(path.join(tmpdir(), 'kanmod-states-'));
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  let target = null;
  for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find((item) => item.type === 'page');
    } catch { /* devtools not ready */ }
  }
  if (!target) throw new Error('no devtools target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let nextId = 1;
  const pending = new Map();
  const problems = [];
  let send;
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const key = Object.keys(FIXTURES).find((prefix) => url.pathname.startsWith(prefix));
      if (!key) { send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
      const body = Buffer.from(JSON.stringify(FIXTURES[key])).toString('base64');
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body }).catch(() => {});
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('console: ' + message.params.args.map((arg) => arg.value ?? arg.description).join(' ').slice(0, 200));
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (message) => { if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolve(message.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const close = () => { try { ws.close(); } catch { /* already closed */ } edge.kill(); };
  return { send, close, problems };
}

async function runScenario({ empty, fixtures }) {
  const port = 4800 + Math.floor(Math.random() * 60);
  const debugPort = 9300 + Math.floor(Math.random() * 120);
  const spawnArgs = empty
    ? ['bin/kanmod.js', '--no-open', `--port=${port}`]
    : ['bin/kanmod.js', '--demo', '--fresh', '--no-open', `--port=${port}`];
  const spawnEnv = {
    ...process.env,
    KANMOD_DATA_DIR: mkdtempSync(path.join(tmpdir(), empty ? 'kanmod-empty-' : 'kanmod-sparse-')),
    ...(empty ? {} : { KANMOD_DEMO_DIR: mkdtempSync(path.join(tmpdir(), 'kanmod-sparse-demo-')) }),
  };
  const server = spawn(process.execPath, spawnArgs, { cwd: process.cwd(), env: spawnEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  server.stdout.setEncoding('utf8');
  const token = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server timeout')), 25000);
    server.stdout.on('data', (chunk) => {
      out += chunk;
      const match = /token=([a-f0-9]{32,})/.exec(out);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.on('exit', (code) => reject(new Error(`server exit ${code}`)));
  });

  const client = await connect(debugPort);
  const evaluate = async (expression) => (await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  if (fixtures) {
    await client.send('Fetch.enable', { patterns: Object.keys(FIXTURES).map((prefix) => ({ urlPattern: `*${prefix}*`, requestStage: 'Request' })) });
  }
  await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/?token=${token}` });
  await sleep(4500);

  const report = [];
  const navCount = Number(await evaluate('document.querySelectorAll(".nav-item").length'));
  for (let index = 0; index < navCount; index += 1) {
    await evaluate(`document.querySelectorAll('.nav-item')[${index}].click()`);
    await sleep(900);
    const view = await evaluate(`document.querySelector('.nav-item.active')?.textContent.trim().split('\\n')[0] || ''`);
    report.push({ view, ...JSON.parse(await evaluate(SCAN)) });
  }

  if (fixtures) {
    await evaluate(`document.querySelectorAll('.nav-item')[1].click()`);
    await sleep(1200);
    const opened = await evaluate(`(() => { const button = document.querySelector('[data-action="open-mod-page"]'); if (!button) return false; button.click(); return true; })()`);
    if (opened) {
      await sleep(2500);
      report.push({ view: '模组简介', ...JSON.parse(await evaluate(SCAN)) });
    }
    await evaluate(`document.querySelectorAll('.nav-item')[1].click()`);
    await sleep(1200);
    const planned = await evaluate(`(() => { const button = document.querySelector('[data-action="plan-install"]'); if (!button) return false; button.click(); return true; })()`);
    if (planned) {
      await sleep(2000);
      report.push({ view: '安装计划', ...JSON.parse(await evaluate(SCAN)) });
    }
  }

  client.close();
  server.kill();
  return { report, problems: client.problems, label: empty ? 'empty' : 'sparse' };
}

let failures = 0;
for (const scenario of [
  { empty: false, fixtures: true },
  { empty: true, fixtures: false },
]) {
  const { report, problems, label } = await runScenario(scenario);
  console.log(`# scenario: ${label}`);
  for (const entry of report) {
    if (entry.textHits.length || entry.attrHits.length || entry.emptyLabels.length) {
      failures += 1;
      console.log(`[${entry.view}] text=${JSON.stringify(entry.textHits)} attr=${JSON.stringify(entry.attrHits)} empty=${JSON.stringify(entry.emptyLabels)}`);
    } else {
      console.log(`[${entry.view}] clean`);
    }
  }
  if (problems.length) {
    failures += 1;
    console.log('runtime problems:', problems.slice(0, 6));
  }
}
console.log(`ui states: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} problem group(s))`);
process.exit(failures === 0 ? 0 : 1);
