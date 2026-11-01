// End-to-end API smoke test: boots the demo server (real HTTP) and exercises
// every API group. Run with `node test/e2e.js` or `npm run e2e`.
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 4600 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'kanmod-e2e-demo-'));

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function boot() {
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'kanmod.js'), '--demo', '--fresh', '--no-open', `--port=${PORT}`], {
    cwd: ROOT,
    env: { ...process.env, KANMOD_E2E: '1', KANMOD_DEMO_DIR: DEMO_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  let token = null;
  while (Date.now() < deadline) {
    const match = output.match(/token=([a-f0-9]{32,})/i);
    if (match) token = match[1];
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok && token) return { child, token };
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`demo server did not start on ${BASE}\n${output.slice(-2000)}`);
}

async function rawHostRequest(host) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/api/health', method: 'GET', headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

async function api(token, pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-kanmod-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, headers: response.headers };
}

async function main() {
  const { child, token } = await boot();
  const appVersion = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;

  try {
    // health & auth
    const health = await api(token, '/api/health');
    check('health 200', health.status === 200);
    check('health version', health.json?.version === appVersion, `${health.json?.version} !== ${appVersion}`);
    const unauth = await fetch(`${BASE}/api/bootstrap`, { headers: {} });
    check('unauthorized without token', unauth.status === 401, String(unauth.status));
    const badHost = await rawHostRequest('evil.example');
    check('bad host rejected', badHost === 403, String(badHost));

    // bootstrap
    const boot0 = await api(token, '/api/bootstrap');
    check('bootstrap 200', boot0.status === 200);
    check('bootstrap demo', boot0.json?.demo === true);
    check('bootstrap instance', Boolean(boot0.json?.instance?.path));
    check('bootstrap catalog packages', (boot0.json?.catalog?.count || 0) >= 7, JSON.stringify(boot0.json?.catalog));
    check('bootstrap tag labels', Object.keys(boot0.json?.tagLabels || {}).length > 10);
    check('bootstrap stats', (boot0.json?.stats?.installed || 0) >= 1);

    // instances
    const instances = await api(token, '/api/instances');
    check('instances list', Array.isArray(instances.json?.instances) && instances.json.instances.length >= 1);

    const detect = await api(token, '/api/instances/detect', { method: 'POST', body: { path: boot0.json?.demoKspPath } });
    check('instances detect', detect.status === 200 && Array.isArray(detect.json?.instances), `${detect.status} ${detect.text.slice(0, 160)}`);

    const savedSettings = await api(token, '/api/settings', { method: 'POST', body: { install: { allowWarning: true } } });
    check('settings save', savedSettings.status === 200 && savedSettings.json?.settings?.install?.allowWarning === true, `${savedSettings.status} ${savedSettings.text.slice(0, 160)}`);

    const demoRefresh = await api(token, '/api/catalog/refresh', { method: 'POST' });
    check('refresh demo guard', demoRefresh.status === 409 && demoRefresh.json?.error?.code === 'DEMO_REFRESH', `${demoRefresh.status} ${demoRefresh.text.slice(0, 160)}`);

    // catalog search
    const search = await api(token, '/api/catalog?q=module');
    check('catalog search 200', search.status === 200);
    check('catalog search finds ModuleManager', (search.json?.items || []).some((item) => item.identifier === 'ModuleManager'));
    check('catalog facets', Array.isArray(search.json?.facets?.tags));
    const emptySearch = await api(token, '/api/catalog?q=%E6%8F%92%E4%BB%B6');
    check('chinese tag query', emptySearch.status === 200 && emptySearch.json?.queryTranslation === 'plugin', JSON.stringify(emptySearch.json?.queryTranslation));
    const tagged = await api(token, '/api/catalog?tag=plugin');
    check('tag filter', tagged.status === 200);

    // package + relationships
    const pkg = await api(token, '/api/catalog/package?identifier=KSPCommunityFixes');
    check('package 200', pkg.status === 200 && pkg.json?.package?.identifier === 'KSPCommunityFixes');
    check('package relations', Array.isArray(pkg.json?.relationships?.depends));
    check('package versions', Array.isArray(pkg.json?.versions));
    const rel = await api(token, '/api/relationships?identifier=KSPCommunityFixes');
    check('relationships 200', rel.status === 200 && Array.isArray(rel.json?.relationships?.depends));
    check('relationships dependents', Array.isArray(rel.json?.relationships?.dependents));
    const missingPkg = await api(token, '/api/catalog/package?identifier=NoSuchMod');
    check('package 404', missingPkg.status === 404 && missingPkg.json?.error?.code === 'PACKAGE_NOT_FOUND');

    // installed + diagnostics
    const installed = await api(token, '/api/installed');
    check('installed 200', installed.status === 200 && Array.isArray(installed.json?.installed) && installed.json.installed.length >= 1);
    const diagnostics = await api(token, '/api/diagnostics');
    const diag = diagnostics.json?.diagnostics;
    check('diagnostics 200', diagnostics.status === 200);
    check('diagnostics health score', typeof diag?.health?.score === 'number');
    check('diagnostics missing dependency', (diag?.issues || []).some((issue) => issue.code === 'missing-dependency'));
    check('diagnostics log parsed', Boolean(diag?.log));

    // resolve & repair
    const resolve = await api(token, '/api/resolve', { method: 'POST', body: { roots: ['KSPCommunityFixes'] } });
    check('resolve 200', resolve.status === 200 && resolve.json?.plan?.ok === true);
    check('resolve includes dependency', (resolve.json?.plan?.nodes || []).some((node) => node.identifier === 'ModuleManager'));
    const repair = await api(token, '/api/repair/preview', { method: 'POST', body: {} });
    check('repair preview 200', repair.status === 200 && Array.isArray(repair.json?.repairs?.operations));

    // translate
    const translate = await api(token, '/api/translate', { method: 'POST', body: { identifier: 'ModuleManager', field: 'abstract' } });
    check('translate 200', translate.status === 200 && Boolean(translate.json?.translation?.text));
    const batch = await api(token, '/api/translate/batch', { method: 'POST', body: { items: [{ key: 'a', field: 'tag', text: 'plugin' }, { key: 'b', field: 'name', text: 'Module Manager' }] } });
    check('translate batch', batch.status === 200 && batch.json?.results?.length === 2);
    check('translate tag dictionary', batch.json?.results?.[0]?.translation?.text === '插件', JSON.stringify(batch.json?.results?.[0]));

    // jobs, settings, cache, modpack
    const jobs = await api(token, '/api/jobs');
    check('jobs list', jobs.status === 200 && Array.isArray(jobs.json?.jobs));
    const settings = await api(token, '/api/settings');
    check('settings 200', settings.status === 200 && settings.json?.settings?.demo === true);
    const cache = await api(token, '/api/cache/status');
    check('cache status', cache.status === 200 && typeof cache.json?.cache?.targets?.downloads === 'object');
    const modpack = await api(token, '/api/modpack/export', { raw: true });
    check('modpack export 200', modpack.status === 200, String(modpack.status));
    check('modpack content type', String(modpack.headers.get('content-type')).includes('json'));
    const modpackBody = await modpack.json();
    check('modpack spec', modpackBody?.spec_version === 1 && Array.isArray(modpackBody?.depends), JSON.stringify(modpackBody).slice(0, 200));
    const preview = await api(token, '/api/modpack/preview', { method: 'POST', body: { depends: [{ name: 'KSPCommunityFixes' }] } });
    check('modpack preview', preview.status === 200 && preview.json?.plan?.ok === true);

    // CurseForge without an API key: ref parsing is local, so this stays offline-safe.
    const cfNoKey = await api(token, '/api/curseforge/search?q=not%20a%20valid%20ref');
    check('curseforge keyless mode', cfNoKey.status === 200 && cfNoKey.json?.needsKey === true && cfNoKey.json?.public === true);
    check('curseforge keyless rejects bad ref', cfNoKey.json?.items?.length === 0 && /slug|链接/.test(String(cfNoKey.json?.message || '')));

    // mods batch validation
    const badBatch = await api(token, '/api/mods/batch', { method: 'POST', body: { action: 'explode', identifiers: ['ModuleManager'] } });
    check('batch invalid action', badBatch.status === 400 && badBatch.json?.error?.code === 'BATCH_ACTION_INVALID');
    const emptyBatch = await api(token, '/api/mods/batch', { method: 'POST', body: { action: 'disable', identifiers: [] } });
    check('batch empty', emptyBatch.status === 400 && emptyBatch.json?.error?.code === 'BATCH_EMPTY');

    // errors
    const notFound = await api(token, '/api/nope');
    check('unknown api 404', notFound.status === 404 && notFound.json?.error?.code === 'NOT_FOUND');
    const badJson = await fetch(`${BASE}/api/resolve`, { method: 'POST', headers: { 'x-kanmod-token': token, 'content-type': 'application/json' }, body: '{oops' });
    check('invalid json 400', badJson.status === 400);

    // static + SSE
    const page = await fetch(`${BASE}/?token=${token}`);
    check('index 200 with token', page.status === 200 && String(page.headers.get('content-type')).includes('text/html'));
    const css = await fetch(`${BASE}/styles.css`);
    check('static css', css.status === 200);
    const traversal = await fetch(`${BASE}/..%2fserver.js`);
    check('static traversal blocked', [400, 404].includes(traversal.status), String(traversal.status));
    const controller = new AbortController();
    const sse = await fetch(`${BASE}/api/events`, { headers: { 'x-kanmod-token': token }, signal: controller.signal });
    const reader = sse.body.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value || new Uint8Array());
    check('sse hello', sse.status === 200 && text.includes('hello'));
    controller.abort();
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`\ne2e: ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
