import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { APP_ROOT, DATA_DIR, ConfigStore, ensureDataLayout } from './src/config.js';
import { loadRegistry } from './src/registry.js';
import { inspectKspPath } from './src/ksp/version.js';
import { kspCandidates } from './src/ksp/locate.js';
import { scanGameData } from './src/ksp/scan.js';
import { CatalogStore, downloadBuffer } from './src/catalog/loader.js';
import { listCatalogSources, enabledCatalogSources } from './src/catalog/sources.js';
import { resolvePlan } from './src/catalog/resolver.js';
import { downloadPackage } from './src/downloads.js';
import { installArchive, previewInstall, uninstallRecord } from './src/installer.js';
import { diagnoseGame, findLogFile, planRepairs } from './src/diagnostics.js';
import { JobQueue } from './src/jobs.js';
import { translateText, TranslationError, cleanSourceText } from './src/translate.js';
import {
  DisabledStore,
  computeUpdates,
  disableMod,
  disabledFileForInstance,
  enableMod,
  removeModPath,
} from './src/modManager.js';
import { ensureDir, pathExists, writeFileAtomic, formatBytes } from './src/util/fsx.js';
import { safeFileName } from './src/util/paths.js';
import { normalizeIdentifier } from './src/util/version.js';

const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const APP_VERSION = '0.0.4';
const MAX_JSON_BODY = 4 * 1024 * 1024;
const MAX_UPLOAD = 512 * 1024 * 1024;
const COOKIE_NAME = 'kanmod_token';
const TOKEN_FILE = path.join(DATA_DIR, 'token');

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hashId(value) {
  return crypto.createHash('sha256').update(String(value).toLowerCase()).digest('hex').slice(0, 12);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const result = {};
  for (const chunk of String(header || '').split(';')) {
    const index = chunk.indexOf('=');
    if (index === -1) continue;
    const key = chunk.slice(0, index).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(chunk.slice(index + 1).trim());
  }
  return result;
}

async function loadToken() {
  try {
    const saved = (await fs.readFile(TOKEN_FILE, 'utf8')).trim();
    if (saved.length >= 32) return saved;
  } catch {
    // Create a stable local token below.
  }
  const token = crypto.randomBytes(32).toString('hex');
  await ensureDir(path.dirname(TOKEN_FILE));
  await writeFileAtomic(TOKEN_FILE, `${token}\n`, { mode: 0o600 }).catch(() => writeFileAtomic(TOKEN_FILE, `${token}\n`));
  return token;
}

function readBody(req, { limit = MAX_JSON_BODY } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `请求内容超过限制（${formatBytes(limit)}）。`, 'BODY_TOO_LARGE'));
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buffer = await readBody(req, { limit: MAX_JSON_BODY });
  if (!buffer.length) return {};
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return isObject(parsed) ? parsed : {};
  } catch {
    throw new HttpError(400, '请求 JSON 格式不正确。', 'INVALID_JSON');
  }
}

function sendJson(res, status, value) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error?.status
    || (error instanceof TranslationError
      ? (error.code === 'TRANSLATION_DEMO_MISSING' ? 409 : 502)
      : (error?.code === 'CATALOG_LOAD_FAILED' ? 502 : 500));
  const payload = {
    error: {
      message: error?.message || '服务器内部错误。',
      code: error?.code || 'INTERNAL_ERROR',
    },
  };
  if (error?.details) payload.error.details = error.details;
  if (error?.attempts) payload.error.attempts = error.attempts;
  if (error?.code !== 'INTERNAL_ERROR') console.warn(`[kanmod] ${error?.message || error}`);
  sendJson(res, status, payload);
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  }[ext] || 'application/octet-stream';
}

function allowedHosts(context) {
  const port = context.port;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

function allowedOrigins(context) {
  return [`http://127.0.0.1:${context.port}`, `http://localhost:${context.port}`];
}

function requestToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const header = req.headers['x-kanmod-token'];
  if (header) return String(header);
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

function authorized(req, context) {
  return safeEqual(requestToken(req), context.token);
}

async function serveStatic(req, res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  try {
    requested = decodeURIComponent(requested);
  } catch {
    sendJson(res, 400, { error: { message: '路径格式错误。', code: 'BAD_PATH' } });
    return;
  }
  if (requested.includes('\\0')) {
    sendJson(res, 400, { error: { message: '路径格式错误。', code: 'BAD_PATH' } });
    return;
  }
  const absolute = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!absolute.startsWith(PUBLIC_DIR + path.sep) && absolute !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(res, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    return;
  }
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    sendJson(res, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    return;
  }
  const headers = {
    'Content-Type': mimeFor(absolute),
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (absolute.endsWith('.html')) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; ');
    headers['X-Frame-Options'] = 'DENY';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const data = await fs.readFile(absolute);
  res.end(data);
}

async function getRegistry(context, instanceId) {
  if (!context.registryCache.has(instanceId)) {
    context.registryCache.set(instanceId, await loadRegistry(instanceId));
  }
  return context.registryCache.get(instanceId);
}

async function getActiveInstance(context) {
  const config = context.configStore.get();
  if (!config.activeInstanceId) return null;
  return config.instances.find((instance) => instance.id === config.activeInstanceId) || null;
}

function invalidateScan(context, instanceId = null) {
  if (instanceId) context.scanCache.delete(instanceId);
  else context.scanCache.clear();
}

async function getRuntime(context, { forceScan = false } = {}) {
  const instance = await getActiveInstance(context);
  if (!instance) throw new HttpError(409, '还没有选择 KSP 游戏实例，请先自动检测或手动选择。', 'NO_INSTANCE');
  const info = await inspectKspPath(instance.path);
  if (!info?.isKsp) {
    throw new HttpError(409, `KSP 路径已失效：${instance.path}`, 'INSTANCE_INVALID');
  }
  const registry = await getRegistry(context, instance.id);
  let cached = context.scanCache.get(instance.id);
  if (forceScan || !cached || Date.now() - cached.at > 5_000) {
    const scan = await scanGameData(info.path, { registry: registry.toJSON() });
    cached = { at: Date.now(), scan };
    context.scanCache.set(instance.id, cached);
    if (forceScan) await context.configStore.markScanned(instance.id).catch(() => {});
  }
  return { instance, info, registry, scan: cached.scan };
}

function installedData(scan, registry, disabledKeys = new Set()) {
  const entries = [];
  const seen = new Set();
  for (const entry of scan?.entries || []) {
    const identifier = entry.identifier || normalizeIdentifier(entry.folder || entry.name || '');
    if (!identifier) continue;
    const key = lower(identifier);
    if (seen.has(key) || disabledKeys.has(key)) continue;
    seen.add(key);
    const installedRel = entry.relPath
      ? (entry.relPath.startsWith('GameData/') ? entry.relPath : `GameData/${entry.relPath}`)
      : null;
    entries.push({
      identifier,
      name: entry.name,
      version: entry.installedVersion || null,
      installedVersion: entry.installedVersion || null,
      folder: entry.folder,
      relPath: installedRel,
      absolutePath: entry.absolutePath || null,
      managed: Boolean(entry.managed),
      managedBy: entry.managedBy,
      kspVersion: entry.kspVersion || null,
      size: entry.size || null,
      sizeLabel: entry.sizeLabel || formatBytes(entry.size || 0),
      dllCount: entry.dllCount || 0,
      configCount: entry.configCount || 0,
      disabled: false,
    });
  }
  for (const record of registry?.records?.() || []) {
    if (record.disabled) continue;
    const key = lower(record.identifier || record.id);
    if (!key || seen.has(key) || disabledKeys.has(key)) continue;
    seen.add(key);
    entries.push({
      identifier: record.identifier || record.id,
      name: record.name || record.identifier || record.id,
      version: record.version || null,
      installedVersion: record.version || null,
      folder: record.folder || null,
      relPath: record.installRoots?.[0] || null,
      managed: true,
      managedBy: 'kanmod',
      kspVersion: record.kspVersion || null,
      size: record.archiveSize || null,
      sizeLabel: record.archiveSize ? formatBytes(record.archiveSize) : null,
      dllCount: 0,
      configCount: 0,
      disabled: false,
    });
  }
  const identifiers = new Set(entries.map((entry) => lower(entry.identifier)));
  const versions = new Map();
  for (const entry of entries) {
    if (entry.version) versions.set(lower(entry.identifier), entry.version);
  }
  return { entries, identifiers, versions };
}

async function getDisabledStore(context, instanceId) {
  const cached = context.disabledCache.get(instanceId);
  if (cached) return cached;
  const store = await new DisabledStore(disabledFileForInstance(instanceId)).load();
  context.disabledCache.set(instanceId, store);
  return store;
}

async function installedFor(context, runtime) {
  const store = await getDisabledStore(context, runtime.instance.id);
  const disabled = store.records();
  const disabledKeys = new Set(disabled.map((item) => lower(item.identifier)).filter(Boolean));
  const installed = installedData(runtime.scan, runtime.registry, disabledKeys);
  const updates = computeUpdates(
    installed.entries,
    context.catalogStore.catalog,
    runtime.scan.kspVersion || runtime.info.version || null,
  );
  const disabledEntries = disabled.map((item) => ({
    identifier: item.identifier || item.folder,
    name: item.name || item.folder || item.identifier || '已禁用模组',
    folder: item.folder,
    relPath: item.relPath,
    version: item.version || null,
    installedVersion: item.version || null,
    kspVersion: item.kspVersion || null,
    managed: Boolean(item.managed),
    managedBy: item.managedBy || 'manual',
    size: item.size || null,
    sizeLabel: item.sizeLabel || null,
    dllCount: 0,
    configCount: 0,
    disabled: true,
    disabledAt: item.disabledAt,
    disabledRel: item.disabledRel,
  }));
  return {
    installed,
    entries: [...installed.entries, ...disabledEntries],
    disabled,
    updates,
  };
}

function findInstalledEntry(runtime, identifier) {
  const wanted = lower(identifier);
  if (!wanted) return null;
  return (runtime.scan?.entries || []).find((entry) => (
    lower(entry.identifier) === wanted
    || lower(entry.folder) === wanted
    || lower(entry.name) === wanted
    || lower(entry.id) === wanted
  )) || null;
}

function isStockEntry(entry) {
  return /^(Squad|SquadExpansion)$/i.test(String(entry?.folder || ''))
    || /^Squad/i.test(String(entry?.identifier || ''));
}


function catalogLoaded(context) {
  return Boolean(context.catalogStore.catalog?.all?.length);
}

function requireCatalog(context) {
  if (!catalogLoaded(context)) {
    throw new HttpError(409, '模组索引尚未加载。请先刷新索引或导入本地索引。', 'CATALOG_EMPTY');
  }
}

function normalizeRoots(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const roots = [];
  const seen = new Set();
  for (const item of list.slice(0, 100)) {
    const identifier = typeof item === 'string' ? item : item?.identifier;
    if (!identifier) continue;
    const version = typeof item === 'string' ? null : item.version || null;
    const key = `${lower(identifier)}\\u0000${version || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ identifier: String(identifier), version: version ? String(version) : null });
  }
  return roots;
}

function repairPlanFor(plan) {
  return {
    ok: plan.ok,
    summary: plan.summary,
    installOrder: plan.installOrder.map((node) => ({
      identifier: node.identifier,
      name: node.name,
      version: node.version,
      action: node.action,
      compatibility: node.compatibility,
    })),
    missing: plan.missing,
    conflicts: plan.conflicts,
    warnings: plan.warnings,
  };
}

function summarizePlan(plan) {
  return {
    ...plan,
    files: (plan.files || []).slice(0, 200).map((file) => ({ from: file.from, to: file.to, size: file.size })),
    fileCount: plan.files?.length || 0,
  };
}

function publicSettings(context) {
  const settings = context.configStore.getPublic();
  settings.demo = context.demo;
  settings.dataDir = DATA_DIR;
  settings.hasCurseforgeKey = Boolean(context.configStore.get().curseforgeApiKey);
  return settings;
}

function catalogStatus(context) {
  return {
    ...context.catalogStore.status(),
    allowInsecureHttp: context.configStore.get().network.allowInsecureHttp,
  };
}

function operationSettings(context) {
  return {
    ...context.configStore.get(),
    demoArchivesDir: context.demoArchivesDir || null,
  };
}

async function resolveFor(context, roots, body = {}) {
  requireCatalog(context);
  const runtime = await getRuntime(context);
  const current = context.configStore.get();
  const installed = installedData(runtime.scan, runtime.registry);
  const plan = resolvePlan({
    catalog: context.catalogStore.catalog,
    roots,
    kspVersion: runtime.scan.kspVersion || runtime.info.version || null,
    installed: installed.entries,
    allowWarning: body.allowWarning === undefined ? current.install.allowWarning : Boolean(body.allowWarning),
    allowUnknown: body.allowUnknown === undefined
      ? Boolean(current.install.allowUnknown || !(runtime.scan.kspVersion || runtime.info.version))
      : Boolean(body.allowUnknown),
    includeRecommended: Boolean(body.includeRecommended),
  });
  return { runtime, installed, plan };
}

async function enqueueInstall(context, plan, { title = '安装模组', meta = {} } = {}) {
  const runtime = await getRuntime(context);
  const catalog = context.catalogStore.catalog;
  const nodes = new Map(plan.nodes.map((node) => [lower(node.identifier), node]));
  const order = plan.installOrder.filter((node) => node.action !== 'keep');
  const downloadsDir = path.join(DATA_DIR, 'downloads');
  const backupsDir = path.join(DATA_DIR, 'backups', runtime.instance.id);
  const settings = operationSettings(context);
  await ensureDir(downloadsDir);

  return context.jobs.create('install', title, async ({ report, signal }) => {
    const installed = [];
    const total = order.length || 1;
    let index = 0;
    for (const ordered of order) {
      if (signal.aborted) throw new Error('已取消。');
      index += 1;
      const node = nodes.get(lower(ordered.identifier)) || ordered;
      const pkg = catalog.get(node.identifier, node.version);
      if (!pkg) throw new Error(`索引中找不到 ${node.identifier} ${node.version}。`);
      report({
        phase: 'download',
        current: index,
        total,
        message: `(${index}/${order.length}) 准备 ${pkg.name} ${pkg.version}`,
      });
      const download = await downloadPackage(pkg, {
        destDir: downloadsDir,
        settings,
        signal,
        onProgress: (progress) => report({
          ...progress,
          current: index - 1 + (progress.received && progress.total ? progress.received / progress.total : 0),
          total,
          message: `(${index}/${order.length}) ${progress.message || pkg.name}`,
        }),
      });
      report({ phase: 'install', current: index, total, message: `正在安装 ${pkg.name} ${pkg.version}` });
      const result = await installArchive({
        archivePath: download.path,
        kspPath: runtime.info.path,
        packageInfo: { ...pkg, source: 'catalog' },
        settings: context.configStore.get(),
        backupsDir,
        onProgress: (progress) => report({
          ...progress,
          current: index,
          total,
          message: `(${index}/${order.length}) ${progress.message || pkg.name}`,
        }),
        signal,
      });
      await runtime.registry.upsert(result.record);
      invalidateScan(context, runtime.instance.id);
      installed.push({
        identifier: pkg.identifier,
        name: pkg.name,
        version: pkg.version,
        files: result.record.files.length,
        archive: download.path,
        candidate: download.candidate?.label || null,
      });
      if (!settings.install.keepDownloads) {
        await fs.rm(download.path, { force: true }).catch(() => {});
      }
    }
    report({ phase: 'done', percent: 100, message: `安装完成，共 ${installed.length} 个模组` });
    invalidateScan(context, runtime.instance.id);
    return { installed, plan: plan.summary, instanceId: runtime.instance.id, meta };
  }, { instanceId: runtime.instance.id, ...meta });
}

async function enqueueRefresh(context) {
  if (context.demo) throw new HttpError(409, '演示模式使用内置离线索引，不需要联网刷新。', 'DEMO_REFRESH');
  const sources = enabledCatalogSources(context.configStore.get());
  if (!sources.length) throw new HttpError(409, '没有启用任何索引源，请在设置中启用官方索引或添加自定义索引。', 'NO_CATALOG_SOURCE');
  return context.jobs.create('catalog-refresh', '刷新模组索引', async ({ report, signal }) => {
    const result = await context.catalogStore.refresh({
      sources,
      signal,
      onProgress: (progress) => report(progress),
    });
    await context.configStore.update({ catalog: { lastRefreshAt: nowIso() } });
    report({ phase: 'done', percent: 100, message: `索引已更新：${result.catalog.meta.identifierCount} 个模组` });
    return {
      source: result.source,
      attempts: result.attempts,
      count: result.catalog.meta.count,
      identifierCount: result.catalog.meta.identifierCount,
      bytes: result.downloadedBytes,
    };
  });
}

async function runDiagnostics(context, { includeLog = true } = {}) {
  const runtime = await getRuntime(context, { forceScan: true });
  const settings = operationSettings(context);
  const diagnostics = await diagnoseGame({
    kspPath: runtime.info.path,
    scan: runtime.scan,
    catalog: context.catalogStore.catalog,
    registry: runtime.registry,
    settings,
    includeLog,
  });
  return { runtime, diagnostics, repairs: planRepairs(diagnostics) };
}

async function cleanupUploads(context) {
  const dir = path.join(DATA_DIR, 'downloads', 'uploads');
  await ensureDir(dir);
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(file, { force: true }).catch(() => {});
  }
}

function uploadPackageInfo(context, identifier, version, name) {
  const catalog = context.catalogStore.catalog;
  const base = identifier ? catalog?.get(identifier) : null;
  return {
    identifier: identifier || 'LocalPackage',
    name: name || base?.name || identifier || '本地模组',
    version: version || base?.version || 'local',
    kspVersion: base?.kspVersion || null,
    author: base?.author || '本地文件',
    abstract: base?.abstract || '从本地压缩包安装的模组',
    install: base?.install || [],
    depends: base?.depends || [],
    recommends: base?.recommends || [],
    conflicts: base?.conflicts || [],
    provides: base?.provides || [],
    download: null,
    source: 'local',
  };
}

function installFromUpload(context, upload, title) {
  const settings = operationSettings(context);
  const backupsDir = path.join(DATA_DIR, 'backups', upload.packageInfo.identifier);
  return context.jobs.create('install-local', title, async ({ report, signal }) => {
    const runtime = await getRuntime(context);
    report({ phase: 'install', percent: 12, message: `正在解析 ${upload.filename}` });
    const result = await installArchive({
      archivePath: upload.path,
      kspPath: runtime.info.path,
      packageInfo: upload.packageInfo,
      settings: context.configStore.get(),
      backupsDir,
      onProgress: (progress) => report({ ...progress, percent: 12 + (progress.percent || 0) * 0.85 }),
      signal,
    });
    await runtime.registry.upsert(result.record);
    invalidateScan(context, runtime.instance.id);
    await fs.rm(upload.path, { force: true }).catch(() => {});
    context.uploads.delete(upload.id);
    report({ phase: 'done', percent: 100, message: `已安装 ${result.record.files.length} 个文件` });
    return { installed: [{ identifier: result.record.identifier, version: result.record.version, files: result.record.files.length }] };
  }, { instanceId: context.configStore.get().activeInstanceId, uploadId: upload.id });
}

async function handleApi(req, res, context, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, name: 'kanmod', version: APP_VERSION, demo: context.demo });
  }

  if (!authorized(req, context)) {
    return sendJson(res, 401, {
      error: {
        message: '未授权。请使用启动时终端里的链接打开 kanmod。',
        code: 'UNAUTHORIZED',
      },
    });
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins(context).includes(origin)) {
      return sendJson(res, 403, { error: { message: '请求来源不被允许。', code: 'BAD_ORIGIN' } });
    }
  }

  if (method === 'GET' && pathname === '/api/events') {
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
    return;
  }

  if (method === 'GET' && pathname === '/api/bootstrap') {
    const config = context.configStore.get();
    const instance = await getActiveInstance(context);
    let runtime = null;
    let instanceError = null;
    try {
      runtime = await getRuntime(context);
    } catch (error) {
      instanceError = error.message;
    }
    const installed = runtime ? installedData(runtime.scan, runtime.registry) : { entries: [], identifiers: new Set(), versions: new Map() };
    return sendJson(res, 200, {
      app: { name: 'kanmod', version: APP_VERSION },
      demo: context.demo,
      instances: config.instances,
      activeInstanceId: config.activeInstanceId,
      instance: instance || null,
      instanceError,
      scan: runtime?.scan || null,
      catalog: catalogStatus(context),
      settings: publicSettings(context),
      sources: listCatalogSources(config),
      jobs: context.jobs.list().slice(0, 15),
      stats: runtime ? {
        installed: installed.entries.length,
        managed: installed.entries.filter((entry) => entry.managed).length,
        mods: runtime.scan.stats?.modCount || 0,
        dlls: runtime.scan.stats?.dllCount || 0,
        size: runtime.scan.stats?.totalSize || 0,
        sizeLabel: runtime.scan.stats?.totalSizeLabel || '0 B',
      } : null,
      demoKspPath: context.demo ? context.demoKspPath : null,
    });
  }

  if (method === 'GET' && pathname === '/api/instances') {
    return sendJson(res, 200, { instances: context.configStore.get().instances, activeInstanceId: context.configStore.get().activeInstanceId });
  }

  if (method === 'POST' && pathname === '/api/instances/detect') {
    const body = await readJsonBody(req);
    const config = context.configStore.get();
    const found = [];
    if (body.path) {
      const info = await inspectKspPath(body.path);
      if (!info?.isKsp) throw new HttpError(400, '该目录不是有效的 KSP 1 安装目录（需要 GameData）。', 'INVALID_KSP_PATH');
      found.push({ ...info, source: '手动选择' });
    } else {
      found.push(...await kspCandidates());
    }
    const added = [];
    for (const info of found) {
      const existing = config.instances.find((instance) => lower(instance.path) === lower(info.path));
      if (existing) {
        if (!config.activeInstanceId) await context.configStore.setActiveInstance(existing.id);
        added.push(existing);
        continue;
      }
      const instance = {
        id: `ksp_${hashId(info.path)}`,
        name: `KSP ${info.version || ''} · ${info.source || '本地'}`.replace(/\\s+/g, ' ').trim(),
        path: info.path,
        source: info.source || 'manual',
        addedAt: nowIso(),
        lastScanAt: null,
      };
      await context.configStore.addInstance(instance);
      added.push(instance);
      invalidateScan(context, instance.id);
    }
    if (body.path && added[0]) await context.configStore.setActiveInstance(added[0].id);
    if (!context.configStore.get().activeInstanceId && added[0]) await context.configStore.setActiveInstance(added[0].id);
    return sendJson(res, 200, {
      instances: context.configStore.get().instances,
      activeInstanceId: context.configStore.get().activeInstanceId,
      detected: added,
      count: added.length,
    });
  }

  if (method === 'POST' && pathname === '/api/instances') {
    const body = await readJsonBody(req);
    if (!body.path) throw new HttpError(400, '请填写 KSP 游戏目录。', 'PATH_REQUIRED');
    const info = await inspectKspPath(body.path);
    if (!info?.isKsp) throw new HttpError(400, '该目录不是有效的 KSP 1 安装目录（需要 GameData）。', 'INVALID_KSP_PATH');
    const config = context.configStore.get();
    const existing = config.instances.find((instance) => lower(instance.path) === lower(info.path));
    if (existing) {
      await context.configStore.setActiveInstance(existing.id);
      return sendJson(res, 200, { instance: existing, existing: true });
    }
    const instance = {
      id: `ksp_${hashId(info.path)}`,
      name: String(body.name || `KSP ${info.version || ''}`).trim() || 'KSP',
      path: info.path,
      source: 'manual',
      addedAt: nowIso(),
      lastScanAt: null,
    };
    await context.configStore.addInstance(instance);
    await context.configStore.setActiveInstance(instance.id);
    invalidateScan(context, instance.id);
    return sendJson(res, 201, { instance });
  }

  if (method === 'POST' && pathname === '/api/instances/select') {
    const body = await readJsonBody(req);
    if (!body.id) throw new HttpError(400, '缺少实例 ID。', 'ID_REQUIRED');
    await context.configStore.setActiveInstance(String(body.id));
    invalidateScan(context);
    return sendJson(res, 200, { ok: true, activeInstanceId: context.configStore.get().activeInstanceId });
  }

  if (pathname.startsWith('/api/instances/') && method === 'DELETE') {
    const id = pathname.split('/')[3];
    if (!id) throw new HttpError(400, '缺少实例 ID。', 'ID_REQUIRED');
    await context.configStore.removeInstance(id);
    invalidateScan(context, id);
    context.registryCache.delete(id);
    return sendJson(res, 200, { ok: true, activeInstanceId: context.configStore.get().activeInstanceId });
  }

  if (method === 'GET' && pathname === '/api/scan') {
    const runtime = await getRuntime(context, { forceScan: url.searchParams.get('refresh') === '1' });
    return sendJson(res, 200, { scan: runtime.scan, instance: runtime.instance, info: runtime.info });
  }

  if (method === 'GET' && pathname === '/api/catalog/status') {
    return sendJson(res, 200, { status: catalogStatus(context) });
  }

  if (method === 'GET' && pathname === '/api/catalog') {
    const config = context.configStore.get();
    const catalog = context.catalogStore.catalog;
    if (!catalog) {
      return sendJson(res, 200, {
        items: [], total: 0, page: 1, pageSize: config.ui.pageSize, pageCount: 1,
        catalog: catalogStatus(context),
      });
    }
    let runtime = null;
    try {
      runtime = await getRuntime(context);
    } catch {
      runtime = null;
    }
    const installed = runtime ? installedData(runtime.scan, runtime.registry) : { identifiers: new Set(), versions: new Map() };
    const result = catalog.search({
      query: url.searchParams.get('q') || '',
      kspVersion: runtime?.scan.kspVersion || runtime?.info.version || null,
      allowWarning: config.install.allowWarning,
      page: Number(url.searchParams.get('page')) || 1,
      pageSize: Number(url.searchParams.get('pageSize')) || config.ui.pageSize,
      sort: url.searchParams.get('sort') || 'relevance',
      status: url.searchParams.get('status') || 'all',
      installedIdentifiers: installed.identifiers,
      installedVersions: installed.versions,
    });
    return sendJson(res, 200, {
      ...result,
      catalog: catalogStatus(context),
      kspVersion: runtime?.scan.kspVersion || null,
    });
  }

  if (method === 'GET' && pathname === '/api/catalog/package') {
    requireCatalog(context);
    const identifier = url.searchParams.get('identifier');
    const version = url.searchParams.get('version');
    if (!identifier) throw new HttpError(400, '缺少模组标识符。', 'IDENTIFIER_REQUIRED');
    const catalog = context.catalogStore.catalog;
    const pkg = catalog.get(identifier, version);
    if (!pkg) throw new HttpError(404, '索引中找不到该模组。', 'PACKAGE_NOT_FOUND');
    let runtime = null;
    try {
      runtime = await getRuntime(context);
    } catch {
      runtime = null;
    }
    const installed = runtime ? installedData(runtime.scan, runtime.registry) : { identifiers: new Set(), versions: new Map() };
    return sendJson(res, 200, {
      package: pkg,
      versions: catalog.versionsForDisplay(pkg.identifier, runtime?.scan.kspVersion || null),
      relationships: catalog.relationships(pkg.identifier, pkg.version, {
        installedVersions: installed.versions,
        installedIdentifiers: installed.identifiers,
      }),
      installed: installed.versions.get(lower(pkg.identifier)) || null,
      compatibility: runtime
        ? (await import('./src/util/version.js')).checkKspCompatibility(runtime.scan.kspVersion, pkg)
        : null,
    });
  }

  if (method === 'POST' && pathname === '/api/translate') {
    const body = await readJsonBody(req);
    const identifier = String(body.identifier || '').trim().slice(0, 160);
    const version = body.version ? String(body.version).trim().slice(0, 80) : null;
    const field = ['abstract', 'description', 'name'].includes(body.field) ? body.field : 'abstract';
    let text = typeof body.text === 'string' ? body.text : '';
    if (!text && identifier) {
      const catalog = context.catalogStore.catalog;
      const pkg = catalog?.get(identifier, version || undefined);
      if (!pkg) throw new HttpError(404, '索引中找不到该模组，无法读取简介。', 'PACKAGE_NOT_FOUND');
      text = pkg[field] || '';
    }
    if (!text.trim()) throw new HttpError(400, '没有可翻译的简介。', 'EMPTY_TEXT');
    const translation = await translateText({
      text,
      identifier,
      version: version || '',
      field,
      demo: Boolean(context.demo),
      force: Boolean(body.force),
      timeoutMs: 7000,
    });
    return sendJson(res, 200, {
      translation,
      source: {
        identifier: identifier || null,
        version: version || null,
        field,
        length: cleanSourceText(text).length,
      },
    });
  }

  if (method === 'GET' && pathname === '/api/relationships') {
    requireCatalog(context);
    const identifier = url.searchParams.get('identifier');
    const version = url.searchParams.get('version');
    if (!identifier) throw new HttpError(400, '缺少模组标识符。', 'IDENTIFIER_REQUIRED');
    const catalog = context.catalogStore.catalog;
    const pkg = catalog.get(identifier, version);
    if (!pkg) throw new HttpError(404, '索引中找不到该模组。', 'PACKAGE_NOT_FOUND');
    let runtime = null;
    try {
      runtime = await getRuntime(context);
    } catch {
      runtime = null;
    }
    const installed = runtime ? installedData(runtime.scan, runtime.registry) : { identifiers: new Set(), versions: new Map() };
    return sendJson(res, 200, {
      package: { identifier: pkg.identifier, name: pkg.name, version: pkg.version },
      relationships: catalog.relationships(pkg.identifier, pkg.version, {
        installedVersions: installed.versions,
        installedIdentifiers: installed.identifiers,
      }),
    });
  }

  if (method === 'POST' && pathname === '/api/catalog/refresh') {
    const job = await enqueueRefresh(context);
    return sendJson(res, 202, { job });
  }

  if (method === 'POST' && pathname === '/api/catalog/import') {
    const body = await readJsonBody(req);
    let buffer;
    let sourceName;
    if (body.url) {
      const sourceUrl = String(body.url);
      let parsed;
      try {
        parsed = new URL(sourceUrl);
      } catch {
        throw new HttpError(400, '索引地址不是合法的 URL。', 'INVALID_URL');
      }
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new HttpError(400, '索引地址必须是 http(s)。', 'INVALID_URL');
      }
      if (parsed.protocol === 'http:' && !context.configStore.get().network.allowInsecureHttp) {
        throw new HttpError(400, '默认只允许 HTTPS 索引地址。可在设置中允许 HTTP。', 'INSECURE_URL');
      }
      buffer = await downloadBuffer(sourceUrl, { timeoutMs: 120_000, maxBytes: MAX_UPLOAD }).catch((error) => {
        throw new HttpError(502, `下载索引失败：${error.message}`, 'CATALOG_DOWNLOAD_FAILED');
      });
      sourceName = sourceUrl;
    } else if (body.path) {
      const file = path.resolve(String(body.path));
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) throw new HttpError(400, '索引文件不存在。', 'FILE_NOT_FOUND');
      if (stat.size > MAX_UPLOAD) throw new HttpError(413, '索引文件过大。', 'FILE_TOO_LARGE');
      buffer = await fs.readFile(file);
      sourceName = file;
    } else {
      throw new HttpError(400, '请提供索引 URL 或本地文件路径。', 'SOURCE_REQUIRED');
    }
    const catalog = await context.catalogStore.importBuffer(buffer, {
      sourceName,
      sourceUrl: body.url || null,
      sourceId: 'import',
    });
    return sendJson(res, 200, { catalog: catalogStatus(context), sourceName, count: catalog.meta.count });
  }

  if (method === 'POST' && pathname === '/api/catalog/upload') {
    const name = safeFileName(url.searchParams.get('name') || 'catalog.json');
    const buffer = await readBody(req, { limit: MAX_UPLOAD });
    if (!buffer.length) throw new HttpError(400, '上传内容为空。', 'EMPTY_UPLOAD');
    const catalog = await context.catalogStore.importBuffer(buffer, {
      sourceName: name,
      sourceId: 'upload',
    });
    return sendJson(res, 200, { catalog: catalogStatus(context), sourceName: name, count: catalog.meta.count });
  }

  if (method === 'GET' && pathname === '/api/catalog/export') {
    requireCatalog(context);
    const buffer = context.catalogStore.exportJson();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="kanmod-catalog.json"',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    return res.end(buffer);
  }

  if (method === 'POST' && pathname === '/api/resolve') {
    const body = await readJsonBody(req);
    const roots = normalizeRoots(body.roots || body.identifiers);
    if (!roots.length) throw new HttpError(400, '请选择至少一个模组。', 'ROOTS_REQUIRED');
    const { plan } = await resolveFor(context, roots, body);
    return sendJson(res, 200, { plan });
  }

  if (method === 'POST' && pathname === '/api/install') {
    requireCatalog(context);
    const body = await readJsonBody(req);
    const roots = normalizeRoots(body.roots || body.identifiers || body.identifier);
    if (!roots.length) throw new HttpError(400, '请选择至少一个模组。', 'ROOTS_REQUIRED');
    const { plan } = await resolveFor(context, roots, body);
    if (!plan.ok) {
      return sendJson(res, 422, {
        error: { message: '依赖计划没有通过检查，请先处理缺失项或冲突。', code: 'RESOLVE_FAILED' },
        plan,
      });
    }
    if (!plan.installOrder.some((node) => node.action !== 'keep')) {
      return sendJson(res, 200, { ok: true, job: null, plan, message: '所有依赖均已安装，无需操作。' });
    }
    const job = await enqueueInstall(context, plan, {
      title: `安装 ${roots.map((root) => root.identifier).join('、')}`,
      meta: { roots },
    });
    return sendJson(res, 202, { ok: true, job, plan });
  }

  if (method === 'GET' && pathname === '/api/installed') {
    const runtime = await getRuntime(context);
    const result = await installedFor(context, runtime);
    return sendJson(res, 200, {
      instance: runtime.instance,
      info: runtime.info,
      scan: runtime.scan,
      records: runtime.registry.records(),
      installed: result.entries,
      disabled: result.disabled,
      updates: result.updates,
      counts: {
        total: result.installed.entries.length,
        disabled: result.disabled.length,
        updates: result.updates.length,
      },
    });
  }

  if (method === 'GET' && pathname === '/api/diagnostics') {
    const includeLog = url.searchParams.get('log') !== '0';
    const result = await runDiagnostics(context, { includeLog });
    return sendJson(res, 200, {
      diagnostics: result.diagnostics,
      repairs: result.repairs,
      runtime: {
        instance: result.runtime.instance,
        info: result.runtime.info,
      },
    });
  }

  if (method === 'POST' && pathname === '/api/repair/preview') {
    const result = await runDiagnostics(context, { includeLog: true });
    return sendJson(res, 200, {
      diagnostics: {
        health: result.diagnostics.health,
        counts: result.diagnostics.counts,
        issues: result.diagnostics.issues,
        log: result.diagnostics.log,
      },
      repairs: result.repairs,
    });
  }

  if (method === 'POST' && pathname === '/api/repair') {
    const result = await runDiagnostics(context, { includeLog: true });
    if (!result.repairs.count) {
      return sendJson(res, 200, { ok: true, job: null, repairs: result.repairs, message: '没有可自动修复的问题。' });
    }
    const roots = result.repairs.operations.map((operation) => ({
      identifier: operation.identifier,
      version: operation.version,
    }));
    const { plan } = await resolveFor(context, roots, { allowWarning: false, allowUnknown: true });
    if (!plan.ok) {
      return sendJson(res, 422, {
        error: { message: '自动修复的依赖计划存在冲突，未执行任何修改。', code: 'REPAIR_PLAN_FAILED' },
        plan,
        repairs: result.repairs,
      });
    }
    if (!plan.installOrder.some((node) => node.action !== 'keep')) {
      return sendJson(res, 200, { ok: true, job: null, plan, repairs: result.repairs, message: '没有需要安装的修复项。' });
    }
    const job = await enqueueInstall(context, plan, {
      title: '自动修复问题',
      meta: { repairs: result.repairs.operations },
    });
    return sendJson(res, 202, { ok: true, job, plan, repairs: result.repairs });
  }

  if (method === 'POST' && pathname === '/api/mods/disable') {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const entry = findInstalledEntry(runtime, body.identifier || body.id || body.folder);
    if (!entry) throw new HttpError(404, '没有找到这个已安装模组。', 'MOD_NOT_FOUND');
    if (isStockEntry(entry)) throw new HttpError(403, '原版游戏组件不能禁用。', 'STOCK_MOD');
    const store = await getDisabledStore(context, runtime.instance.id);
    const result = await disableMod({
      kspPath: runtime.info.path,
      entry,
      store,
      registry: runtime.registry,
    });
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, { ok: true, disabled: result.manifest });
  }

  if (method === 'POST' && pathname === '/api/mods/enable') {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const store = await getDisabledStore(context, runtime.instance.id);
    const manifest = store.find({ identifier: body.identifier, folder: body.folder, id: body.id })
      || store.get(lower(body.key));
    if (!manifest) throw new HttpError(404, '没有找到这个已禁用模组。', 'DISABLED_NOT_FOUND');
    const result = await enableMod({
      kspPath: runtime.info.path,
      manifest,
      store,
      registry: runtime.registry,
    });
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, { ok: true, enabled: result });
  }

  if (method === 'POST' && pathname === '/api/mods/delete') {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const store = await getDisabledStore(context, runtime.instance.id);
    const manifest = store.find({ identifier: body.identifier, folder: body.folder, id: body.id })
      || store.get(lower(body.key));
    const entry = manifest ? null : findInstalledEntry(runtime, body.identifier || body.id || body.folder);
    if (!manifest && !entry) throw new HttpError(404, '没有找到这个模组。', 'MOD_NOT_FOUND');
    if (entry && isStockEntry(entry)) throw new HttpError(403, '原版游戏组件不能删除。', 'STOCK_MOD');
    const trashDir = path.join(DATA_DIR, 'trash', runtime.instance.id);
    const result = await removeModPath({
      kspPath: runtime.info.path,
      entry,
      manifest,
      trashDir,
    });
    if (manifest) await store.remove(manifest.key);
    const record = runtime.registry.getByIdentifier(manifest?.identifier || entry?.identifier)
      || (entry?.folder ? runtime.registry.getByFolder(entry.folder) : null);
    if (record) await runtime.registry.remove(record.id);
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, {
      ok: true,
      identifier: manifest?.identifier || entry?.identifier || null,
      moved: result.moved,
      trashPath: result.trashPath,
    });
  }

  if (method === 'POST' && pathname === '/api/mods/update') {
    requireCatalog(context);
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const result = await installedFor(context, runtime);
    const wanted = lower(body.identifier || body.id || '');
    const updates = wanted
      ? result.updates.filter((item) => lower(item.identifier) === wanted)
      : result.updates;
    if (!updates.length) {
      return sendJson(res, 200, {
        ok: true,
        job: null,
        updates: [],
        message: wanted ? '这个模组已经是最新版本。' : '所有已安装模组都是最新版本。',
      });
    }
    const roots = updates.map((item) => ({ identifier: item.identifier, version: item.latestVersion }));
    const settings = context.configStore.get();
    const { plan } = await resolveFor(context, roots, {
      allowWarning: Boolean(settings.install.allowWarning),
      allowUnknown: true,
    });
    if (!plan.ok) {
      return sendJson(res, 422, {
        error: { message: '更新计划没有通过依赖检查，未执行任何修改。', code: 'UPDATE_PLAN_FAILED' },
        plan,
        updates,
      });
    }
    const job = await enqueueInstall(context, plan, {
      title: wanted ? `更新 ${updates[0].name || updates[0].identifier}` : `一键更新 ${updates.length} 个模组`,
      meta: { updates, kind: 'update' },
    });
    return sendJson(res, 202, { ok: true, job, plan, updates });
  }

  if (method === 'POST' && pathname === '/api/uninstall') {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    let record = null;
    if (body.id) record = runtime.registry.getById(String(body.id));
    if (!record && body.identifier) record = runtime.registry.getByIdentifier(String(body.identifier));
    if (!record) {
      throw new HttpError(404, '没有找到该模组的 kanmod 安装记录。非 kanmod 管理的模组不会被自动删除。', 'RECORD_NOT_FOUND');
    }
    const trashDir = path.join(DATA_DIR, 'trash', runtime.instance.id);
    const result = await uninstallRecord({
      kspPath: runtime.info.path,
      record,
      trashDir,
    });
    await runtime.registry.remove(record.id);
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, {
      ok: true,
      moved: result.moved,
      missing: result.missing,
      trashPath: result.trashPath,
      identifier: record.identifier,
    });
  }

  if (method === 'POST' && pathname === '/api/archive/preview') {
    const buffer = await readBody(req, { limit: MAX_UPLOAD });
    if (!buffer.length) throw new HttpError(400, '上传内容为空。', 'EMPTY_UPLOAD');
    const filename = safeFileName(url.searchParams.get('filename') || 'package.zip');
    const ext = path.extname(filename).toLowerCase();
    if (!['.zip', '.gz', '.tgz'].includes(ext)) {
      throw new HttpError(400, '本地安装包必须是 .zip、.tar.gz 或 .tgz。', 'BAD_ARCHIVE');
    }
    const identifier = String(url.searchParams.get('identifier') || '').trim() || null;
    const version = String(url.searchParams.get('version') || '').trim() || null;
    const name = String(url.searchParams.get('name') || '').trim() || null;
    const uploadId = `up_${crypto.randomBytes(6).toString('hex')}`;
    const uploadDir = path.join(DATA_DIR, 'downloads', 'uploads');
    await ensureDir(uploadDir);
    const target = path.join(uploadDir, `${uploadId}${ext}`);
    await writeFileAtomic(target, buffer);
    const packageInfo = uploadPackageInfo(context, identifier, version, name);
    let plan;
    try {
      plan = await previewInstall(packageInfo, target);
    } catch (error) {
      await fs.rm(target, { force: true }).catch(() => {});
      throw new HttpError(400, `无法解析安装包：${error.message}`, 'ARCHIVE_INVALID');
    }
    context.uploads.set(uploadId, {
      id: uploadId,
      path: target,
      filename,
      packageInfo,
      createdAt: Date.now(),
    });
    return sendJson(res, 200, {
      uploadId,
      filename,
      package: {
        identifier: packageInfo.identifier,
        name: packageInfo.name,
        version: packageInfo.version,
      },
      plan: summarizePlan(plan),
    });
  }

  if (method === 'POST' && pathname === '/api/archive/install') {
    const body = await readJsonBody(req);
    const upload = context.uploads.get(String(body.uploadId || ''));
    if (!upload) throw new HttpError(404, '安装包上传记录已失效，请重新上传。', 'UPLOAD_NOT_FOUND');
    if (!(await pathExists(upload.path))) throw new HttpError(404, '安装包临时文件已不存在，请重新上传。', 'UPLOAD_MISSING');
    const job = installFromUpload(context, upload, `安装本地包 ${upload.packageInfo.name}`);
    return sendJson(res, 202, { ok: true, job });
  }

  if (method === 'GET' && pathname === '/api/jobs') {
    return sendJson(res, 200, { jobs: context.jobs.list() });
  }

  if (method === 'GET' && pathname.startsWith('/api/jobs/') && pathname.split('/').length === 4) {
    const id = pathname.split('/')[3];
    const job = context.jobs.get(id);
    if (!job) throw new HttpError(404, '任务不存在。', 'JOB_NOT_FOUND');
    return sendJson(res, 200, { job });
  }

  if (method === 'POST' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/cancel')) {
    const parts = pathname.split('/');
    const id = parts[3];
    const job = context.jobs.cancel(id);
    if (!job) throw new HttpError(404, '任务不存在。', 'JOB_NOT_FOUND');
    return sendJson(res, 200, { job });
  }

  if (method === 'GET' && pathname === '/api/settings') {
    return sendJson(res, 200, {
      settings: publicSettings(context),
      sources: listCatalogSources(context.configStore.get()),
      dataDir: DATA_DIR,
    });
  }

  if (method === 'POST' && pathname === '/api/settings') {
    const body = await readJsonBody(req);
    const patch = {};
    if (isObject(body.install)) {
      patch.install = {};
      for (const key of ['backupOverwrite', 'allowWarning', 'allowUnknown', 'keepDownloads']) {
        if (body.install[key] !== undefined) patch.install[key] = Boolean(body.install[key]);
      }
    }
    if (isObject(body.network)) {
      patch.network = {};
      for (const key of ['timeoutSeconds', 'downloadTimeoutSeconds', 'maxDownloadMB']) {
        if (body.network[key] !== undefined) patch.network[key] = Number(body.network[key]);
      }
      if (body.network.allowInsecureHttp !== undefined) patch.network.allowInsecureHttp = Boolean(body.network.allowInsecureHttp);
      if (Array.isArray(body.network.mirrorPrefixes)) {
        patch.network.mirrorPrefixes = body.network.mirrorPrefixes.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 8);
      }
    }
    if (isObject(body.catalog)) {
      patch.catalog = {};
      if (Array.isArray(body.catalog.enabledSources)) {
        patch.catalog.enabledSources = body.catalog.enabledSources.map(String);
      }
      if (body.catalog.autoRefresh !== undefined) patch.catalog.autoRefresh = Boolean(body.catalog.autoRefresh);
      if (Array.isArray(body.catalog.customSources)) {
        patch.catalog.customSources = body.catalog.customSources.slice(0, 20).map((source) => ({
          id: source.id || `custom-${crypto.randomBytes(4).toString('hex')}`,
          name: String(source.name || '自定义索引').slice(0, 80),
          url: String(source.url || ''),
          enabled: source.enabled !== false,
        })).filter((source) => source.url);
      }
    }
    if (isObject(body.ui)) {
      patch.ui = {};
      if (body.ui.pageSize !== undefined) patch.ui.pageSize = Number(body.ui.pageSize);
      if (body.ui.autoTranslate !== undefined) patch.ui.autoTranslate = Boolean(body.ui.autoTranslate);
    }
    if (typeof body.curseforgeApiKey === 'string') patch.curseforgeApiKey = body.curseforgeApiKey.trim();
    await context.configStore.update(patch);
    context.catalogStore.allowInsecureHttp = Boolean(context.configStore.get().network.allowInsecureHttp);
    return sendJson(res, 200, { settings: publicSettings(context), sources: listCatalogSources(context.configStore.get()) });
  }

  if (method === 'POST' && pathname === '/api/open') {
    const body = await readJsonBody(req);
    const target = String(body.target || '');
    const runtime = await getRuntime(context).catch(() => null);
    let file = null;
    if (target === 'gamedata') {
      if (!runtime) throw new HttpError(409, '尚未选择 KSP 实例。', 'NO_INSTANCE');
      file = runtime.info.gameDataPath;
    } else if (target === 'ksp') {
      if (!runtime) throw new HttpError(409, '尚未选择 KSP 实例。', 'NO_INSTANCE');
      file = runtime.info.path;
    } else if (target === 'log') {
      if (!runtime) throw new HttpError(409, '尚未选择 KSP 实例。', 'NO_INSTANCE');
      const found = await findLogFile(runtime.info.path);
      if (!found) throw new HttpError(404, '没有找到 KSP 日志文件。', 'LOG_NOT_FOUND');
      file = found.path;
    } else if (target === 'backups') {
      file = path.join(DATA_DIR, 'backups');
    } else if (target === 'trash') {
      file = path.join(DATA_DIR, 'trash');
    } else if (target === 'downloads') {
      file = path.join(DATA_DIR, 'downloads');
    } else if (target === 'data') {
      file = DATA_DIR;
    } else {
      throw new HttpError(400, '未知的打开目标。', 'BAD_TARGET');
    }
    await ensureDir(path.dirname(file));
    await openInExplorer(file, target === 'log');
    return sendJson(res, 200, { ok: true, path: file });
  }

  throw new HttpError(404, '接口不存在。', 'NOT_FOUND');
}

async function openInExplorer(target, select = false) {
  if (process.platform === 'win32') {
    const args = select ? [`/select,${target}`] : [target];
    spawn('explorer.exe', args, { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [target], { detached: true, stdio: 'ignore' }).unref();
}

async function handle(req, res, context) {
  try {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts(context).includes(host)) {
      return sendJson(res, 403, { error: { message: '只允许通过本机地址访问 kanmod。', code: 'BAD_HOST' } });
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${context.port}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const queryToken = url.searchParams.get('token');
      if (queryToken) {
        if (!safeEqual(queryToken, context.token)) {
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
    sendError(res, error);
  }
}

function broadcast(context, event) {
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

async function createContext({ demoInfo = null } = {}) {
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
    uploads: new Map(),
    clients: new Set(),
    port: 0,
  };
  await setupDemo(context);
  context.jobs.on('job', (job) => broadcast(context, { type: 'job', job }));
  await cleanupUploads(context);
  return context;
}

export async function startServer({ demoInfo = null, port = 0, host = '127.0.0.1', open = false } = {}) {
  const context = await createContext({ demoInfo });
  const server = http.createServer((req, res) => {
    handle(req, res, context).catch((error) => {
      if (!res.headersSent) sendError(res, error);
      else res.end();
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

export async function openAppWindow(url) {
  if (process.platform !== 'win32') {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      spawn(candidate, [
        `--app=${url}`,
        '--window-size=1440,940',
        '--no-first-run',
        '--disable-features=msEdgeSidebarV2',
      ], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

export { createContext, HttpError };
