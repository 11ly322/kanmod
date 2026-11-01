// Application composition: context, request pipeline, SSE hub, server bootstrap.
import http from 'node:http';
import path from 'node:path';

import { APP_ROOT, DATA_DIR, ConfigStore, ensureDataLayout } from '../config.js';
import { CatalogStore } from '../catalog/loader.js';
import { JobQueue } from '../jobs.js';
import { APP_VERSION } from '../version.js';
import {
  HttpError,
  COOKIE_NAME,
  allowedHosts,
  allowedOrigins,
  authorized,
  loadToken,
  sendJson,
  serveStatic,
} from './http.js';
import { nowIso, lower } from './shared.js';
import { Router } from './router.js';
import { registerApiRoutes } from './routes/index.js';
import { openAppWindow, openInExplorer } from './shell.js';

function createRouter() {
  const router = new Router();
  router.get('/api/health', async (req, res, context) => {
    sendJson(res, 200, { ok: true, name: 'kanmod', version: APP_VERSION, demo: context.demo });
  }, { public: true, name: 'health' });
  registerApiRoutes(router);
  return router;
}

const router = createRouter();

export function broadcast(context, event) {
  if (!context.clients.size) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of [...context.clients]) {
    try {
      client.write(payload);
    } catch {
      context.clients.delete(client);
    }
  }
}

function openEvents(req, res, context) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'hello', at: nowIso(), demo: context.demo })}\n\n`);
  context.clients.add(res);
  const timer = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      clearInterval(timer);
    }
  }, 20_000);
  req.on('close', () => {
    clearInterval(timer);
    context.clients.delete(res);
  });
}

async function handleApi(req, res, context, url) {
  if (url.pathname === '/api/events') {
    if (!authorized(req, context)) {
      throw new HttpError(401, '未授权。请使用启动时终端里的链接打开 kanmod。', 'UNAUTHORIZED');
    }
    openEvents(req, res, context);
    return;
  }

  const resolved = router.resolve(req.method || 'GET', url.pathname);
  if (!resolved) throw new HttpError(404, '接口不存在。', 'NOT_FOUND');
  if (!resolved.route.public && !authorized(req, context)) {
    throw new HttpError(401, '未授权。请使用启动时终端里的链接打开 kanmod。', 'UNAUTHORIZED');
  }
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins(context).includes(origin)) {
      throw new HttpError(403, '请求来源不被允许。', 'BAD_ORIGIN');
    }
  }
  if (resolved.route.method !== method) {
    throw new HttpError(404, '接口不存在。', 'NOT_FOUND');
  }
  await resolved.route.handler(req, res, context, url, resolved.match);
}

export async function handleRequest(req, res, context) {
  try {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts(context).includes(host)) {
      return sendJson(res, 403, { error: { message: '只允许通过本机地址访问 kanmod。', code: 'BAD_HOST' } });
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${context.port}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const queryToken = url.searchParams.get('token');
      if (queryToken) {
        if (!authorized({ headers: { 'x-kanmod-token': queryToken } }, context)) {
          return sendJson(res, 403, { error: { message: '启动令牌无效。请重新打开 kanmod。', code: 'BAD_TOKEN' } });
        }
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(context.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
        res.setHeader('Cache-Control', 'no-store');
        return await serveStatic(req, res, '/index.html');
      }
      if (!authorized(req, context)) {
        res.writeHead(302, {
          Location: `/?token=${encodeURIComponent(context.token)}`,
          'Cache-Control': 'no-store',
        });
        return res.end();
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, context, url);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      return await serveStatic(req, res, url.pathname);
    }
    return sendJson(res, 405, { error: { message: '请求方法不被允许。', code: 'METHOD_NOT_ALLOWED' } });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const { sendError } = await import('./http.js');
    sendError(res, error);
  }
}

async function setupDemo(context) {
  if (!context.demoInfo) return;
  const existing = context.configStore.get().instances.find((instance) => lower(instance.path) === lower(context.demoInfo.kspPath));
  let instance = existing;
  if (!instance) {
    instance = {
      id: 'demo',
      name: '离线演示实例',
      path: context.demoInfo.kspPath,
      source: 'demo',
      addedAt: nowIso(),
      lastScanAt: null,
    };
    await context.configStore.addInstance(instance);
  }
  const active = context.configStore.get().activeInstanceId;
  if (!active || !context.configStore.get().instances.some((item) => item.id === active)) {
    await context.configStore.setActiveInstance(instance.id);
  }
  await context.catalogStore.setPackages(context.demoInfo.packages, {
    sourceName: 'kanmod 内置演示索引',
    sourceUrl: null,
    sourceId: 'demo',
    source: 'demo',
    demo: true,
    loadedAt: nowIso(),
  });
  context.demoArchivesDir = context.demoInfo.archivesDir;
}

export async function createContext({ demoInfo = null } = {}) {
  await ensureDataLayout();
  const configStore = new ConfigStore();
  await configStore.load();
  const config = configStore.get();
  const catalogStore = new CatalogStore({
    cacheFile: path.join(DATA_DIR, 'catalog.json'),
    allowInsecureHttp: Boolean(config.network.allowInsecureHttp),
  });
  await catalogStore.loadCache();
  const token = await loadToken();
  const context = {
    configStore,
    catalogStore,
    token,
    demo: Boolean(demoInfo),
    demoInfo,
    demoKspPath: demoInfo?.kspPath || null,
    demoArchivesDir: demoInfo?.archivesDir || null,
    jobs: new JobQueue({ concurrency: 1 }),
    scanCache: new Map(),
    registryCache: new Map(),
    disabledCache: new Map(),
    imageCache: new Map(),
    uploads: new Map(),
    clients: new Set(),
    port: 0,
  };
  await setupDemo(context);
  context.jobs.on('job', (job) => broadcast(context, { type: 'job', job }));
  const { cleanupUploads } = await import('./services.js');
  await cleanupUploads(context);
  return context;
}

export async function startServer({ demoInfo = null, port = 0, host = '127.0.0.1', open = false } = {}) {
  const context = await createContext({ demoInfo });
  const server = http.createServer((req, res) => {
    handleRequest(req, res, context).catch((error) => {
      if (!res.headersSent) {
        import('./http.js').then(({ sendError }) => sendError(res, error));
      } else {
        res.end();
      }
    });
  });
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  context.port = address.port;
  context.server = server;
  context.baseUrl = `http://127.0.0.1:${context.port}`;
  context.launchUrl = `${context.baseUrl}/?token=${encodeURIComponent(context.token)}`;
  context.startedAt = nowIso();
  if (open && context.configStore.get().ui.openBrowser) {
    await openAppWindow(context.launchUrl).catch(() => {});
  }
  return { server, context, url: context.launchUrl };
}

export { APP_ROOT, DATA_DIR, HttpError, openAppWindow, openInExplorer };
