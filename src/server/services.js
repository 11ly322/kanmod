import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { DATA_DIR } from '../config.js';
import { loadRegistry } from '../registry.js';
import { inspectKspPath } from '../ksp/version.js';
import { scanGameData } from '../ksp/scan.js';
import { resolvePlan } from '../catalog/resolver.js';
import { downloadPackage } from '../downloads.js';
import { installArchive, uninstallRecord } from '../installer.js';
import { diagnoseGame, findLogFile, planRepairs } from '../diagnostics.js';
import { translateText, cleanSourceText, hasAnyChinese } from '../translate.js';
import { tagTranslations, translateTag } from '../tagTranslations.js';
import { searchModImages, fetchImageBuffer } from '../modImages.js';
import { searchCurseForge, curseforgeRequest, curseforgeConfigured, mapCurseForgeDetail, CurseForgeError } from '../curseforge.js';
import { DisabledStore, computeUpdates, disableMod, disabledFileForInstance, enableMod, removeModPath } from '../modManager.js';
import { ensureDir, formatBytes } from '../util/fsx.js';
import { safeFileName } from '../util/paths.js';
import { normalizeIdentifier } from '../util/version.js';
import { enabledCatalogSources } from '../catalog/sources.js';
import { HttpError, MAX_JSON_BODY, MAX_UPLOAD } from './http.js';
import { nowIso, lower, isObject } from './shared.js';

const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'images');
const IMAGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

function imageCachePaths(url) {
  const key = crypto.createHash('sha256').update(url).digest('hex');
  return {
    meta: path.join(IMAGE_CACHE_DIR, `${key}.json`),
    data: path.join(IMAGE_CACHE_DIR, `${key}.bin`),
  };
}

async function readImageCache(url) {
  const files = imageCachePaths(url);
  try {
    const meta = JSON.parse(await fs.readFile(files.meta, 'utf8'));
    if (!meta?.contentType || Date.now() - Date.parse(meta.savedAt) > IMAGE_CACHE_TTL) return null;
    return { buffer: await fs.readFile(files.data), contentType: meta.contentType };
  } catch {
    return null;
  }
}

async function writeImageCache(url, buffer, contentType) {
  try {
    await ensureDir(IMAGE_CACHE_DIR);
    const files = imageCachePaths(url);
    await fs.writeFile(files.data, buffer);
    await fs.writeFile(files.meta, JSON.stringify({
      url,
      contentType,
      bytes: buffer.length,
      savedAt: new Date().toISOString(),
    }), 'utf8');
  } catch {
    // The image still displays even when the cache cannot be written.
  }
}

async function galleryFor(context, pkg) {
  const key = `${lower(pkg.identifier)}@${pkg.version}`;
  const cached = context.imageCache.get(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.value;
  const result = await searchModImages(pkg, { maxImages: 8 });
  const value = {
    ...result,
    images: result.images.map((image) => ({
      url: image.url,
      proxyUrl: `/api/image?url=${encodeURIComponent(image.url)}`,
    })),
  };
  context.imageCache.set(key, { at: Date.now(), value });
  return value;
}

async function getRuntime(context, { forceScan = false } = {}) {
  const instance = await getActiveInstance(context);
  if (!instance) throw new HttpError(409, '还没有选择 KSP 游戏实例，请先自动检测或手动选择。', 'NO_INSTANCE');
  const info = await inspectKspPath(instance.path);
  if (!info?.isKsp) {
    throw new HttpError(409, `KSP 路径已失效：${instance.path}`, 'INSTANCE_INVALID');
  }
  const registry = await getRegistry(context, instance.id);
  // Scanning GameData is expensive on large installs. Rescans are only needed
  // after kanmod mutates the folder (invalidateScan) or when the user asks for
  // a refresh, so keep the cached scan for a minute instead of a few seconds.
  const SCAN_CACHE_TTL_MS = 60_000;
  let cached = context.scanCache.get(instance.id);
  if (forceScan || !cached || Date.now() - cached.at > SCAN_CACHE_TTL_MS) {
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

async function disableInstalledMod(context, runtime, entry) {
  const store = await getDisabledStore(context, runtime.instance.id);
  const result = await disableMod({
    kspPath: runtime.info.path,
    entry,
    store,
    registry: runtime.registry,
  });
  return result.manifest;
}

async function enableDisabledMod(context, runtime, manifest) {
  const store = await getDisabledStore(context, runtime.instance.id);
  return enableMod({
    kspPath: runtime.info.path,
    manifest,
    store,
    registry: runtime.registry,
  });
}

async function deleteInstalledMod(context, runtime, { entry, manifest }) {
  const store = await getDisabledStore(context, runtime.instance.id);
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
  return result;
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
    includeDependencies: body.autoDependencies === undefined
      ? current.install.autoDependencies !== false
      : Boolean(body.autoDependencies),
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

async function enqueueCurseForgeInstall(context, { pkg, meta = {} }) {
  const runtime = await getRuntime(context);
  const settings = operationSettings(context);
  const downloadsDir = path.join(DATA_DIR, 'downloads');
  const backupsDir = path.join(DATA_DIR, 'backups', runtime.instance.id);
  await ensureDir(downloadsDir);
  return context.jobs.create('install', `从 CurseForge 安装 ${pkg.name}`, async ({ report, signal }) => {
    report({ phase: 'download', percent: 4, message: `准备下载 ${pkg.name} ${pkg.version}` });
    const download = await downloadPackage(pkg, {
      destDir: downloadsDir,
      settings,
      signal,
      onProgress: (progress) => report({ ...progress, message: progress.message || pkg.name }),
    });
    report({ phase: 'install', percent: 72, message: `正在安装 ${pkg.name} ${pkg.version}` });
    const result = await installArchive({
      archivePath: download.path,
      kspPath: runtime.info.path,
      packageInfo: { ...pkg, source: 'curseforge' },
      settings: context.configStore.get(),
      backupsDir,
      signal,
      onProgress: (progress) => report(progress),
    });
    await runtime.registry.upsert(result.record);
    invalidateScan(context, runtime.instance.id);
    if (!settings.install.keepDownloads) await fs.rm(download.path, { force: true }).catch(() => {});
    report({ phase: 'done', percent: 100, message: '安装完成' });
    return {
      installed: [{
        identifier: pkg.identifier,
        name: pkg.name,
        version: pkg.version,
        files: result.record.files.length,
        folder: result.plan.primaryFolder,
        candidate: download.candidate?.label || null,
      }],
      instanceId: runtime.instance.id,
      source: 'curseforge',
      ...meta,
    };
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

async function runDiagnostics(context, { includeLog = true, forceScan = false } = {}) {
  const runtime = await getRuntime(context, { forceScan });
  const settings = operationSettings(context);
  const disabledStore = await getDisabledStore(context, runtime.instance.id);
  const diagnostics = await diagnoseGame({
    kspPath: runtime.info.path,
    scan: runtime.scan,
    catalog: context.catalogStore.catalog,
    registry: runtime.registry,
    settings,
    includeLog,
    disabled: disabledStore.records(),
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

async function translateBatch(context, items, { force = false } = {}) {
  const queue = items.map((item, index) => ({ ...item, index }));
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const item = queue[cursor];
      cursor += 1;
      const field = ['name', 'tag', 'abstract', 'description', 'query'].includes(item.field) ? item.field : 'abstract';
      const text = String(item.text || '').trim().slice(0, 6000);
      if (!text) {
        results[item.index] = { key: item.key || null, field, error: 'EMPTY_TEXT' };
        continue;
      }
      try {
        if (field === 'tag') {
          const local = translateTag(text);
          if (local && local !== text) {
            results[item.index] = {
              key: item.key || null,
              field,
              translation: { text: local, provider: 'kanmod 标签词典', cached: true, translated: true, machine: false },
            };
            continue;
          }
        }
        const translation = await translateText({
          text,
          identifier: String(item.identifier || ''),
          version: String(item.version || ''),
          field,
          demo: Boolean(context.demo),
          force: Boolean(force),
          timeoutMs: 6500,
        });
        results[item.index] = { key: item.key || null, field, translation };
      } catch (error) {
        results[item.index] = {
          key: item.key || null,
          field,
          error: error?.code || 'TRANSLATION_FAILED',
          message: error?.message || '翻译失败',
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return results;
}

async function translateSearchQuery(context, query) {
  const text = String(query || '').trim();
  if (!text || !hasAnyChinese(text)) return { query: text, translated: null };
  const reverse = Object.entries(tagTranslations()).find(([, label]) => label === text);
  if (reverse) return { query: reverse[0], translated: reverse[0], tag: true };
  try {
    const translation = await translateText({
      text,
      field: 'query',
      demo: Boolean(context.demo),
      timeoutMs: 3500,
    });
    if (translation.translated && translation.text && translation.text !== text) {
      return { query: translation.text, translated: translation.text };
    }
  } catch {
    // 搜索在离线时仍然使用原始关键词。
  }
  return { query: text, translated: null };
}

async function pathSize(target) {
  let total = 0;
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let entries = [];
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    total += await pathSize(path.join(target, entry.name));
  }
  return total;
}

async function cacheStatus() {
  const targets = {
    downloads: path.join(DATA_DIR, 'downloads'),
    images: path.join(DATA_DIR, 'images'),
    translations: path.join(DATA_DIR, 'translations'),
  };
  const sizes = {};
  let total = 0;
  for (const [key, target] of Object.entries(targets)) {
    const bytes = await pathSize(target);
    sizes[key] = { bytes, label: formatBytes(bytes) };
    total += bytes;
  }
  return { total, totalLabel: formatBytes(total), targets: sizes };
}


export {
  getRegistry,
  getActiveInstance,
  invalidateScan,
  imageCachePaths,
  readImageCache,
  writeImageCache,
  galleryFor,
  getRuntime,
  installedData,
  getDisabledStore,
  installedFor,
  findInstalledEntry,
  isStockEntry,
  disableInstalledMod,
  enableDisabledMod,
  deleteInstalledMod,
  catalogLoaded,
  requireCatalog,
  normalizeRoots,
  repairPlanFor,
  summarizePlan,
  publicSettings,
  catalogStatus,
  operationSettings,
  resolveFor,
  enqueueInstall,
  enqueueCurseForgeInstall,
  enqueueRefresh,
  runDiagnostics,
  cleanupUploads,
  uploadPackageInfo,
  installFromUpload,
  translateBatch,
  translateSearchQuery,
  pathSize,
  cacheStatus,
};
