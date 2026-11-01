// API route table. Handlers are grouped by URL prefix below.
import {
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
  enqueueRefresh,
  runDiagnostics,
  cleanupUploads,
  uploadPackageInfo,
  installFromUpload,
  translateBatch,
  translateSearchQuery,
  pathSize,
  cacheStatus,
} from '../services.js';
import { HttpError, readJsonBody, readBody, sendJson, sendError, MAX_UPLOAD } from '../http.js';
import { lower, nowIso } from '../shared.js';
import { DATA_DIR, APP_ROOT } from '../../config.js';
import { ensureDir, pathExists, formatBytes } from '../../util/fsx.js';
import { safeFileName } from '../../util/paths.js';
import { listCatalogSources, enabledCatalogSources } from '../../catalog/sources.js';
import { CatalogLoadError, downloadBuffer } from '../../catalog/loader.js';
import { kspCandidates } from '../../ksp/locate.js';
import { translateText, cleanSourceText } from '../../translate.js';
import { checkKspCompatibility } from '../../util/version.js';
import { tagTranslations, translateTag } from '../../tagTranslations.js';
import { searchModImages, fetchImageBuffer } from '../../modImages.js';
import { searchCurseForge, curseforgeRequest, curseforgeConfigured, mapCurseForgeDetail, CurseForgeError } from '../../curseforge.js';
import { previewInstall } from '../../installer.js';
import { inspectKspPath } from '../../ksp/version.js';
import { findLogFile } from '../../diagnostics.js';
import { openInExplorer } from '../shell.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION } from '../../version.js';

export function registerApiRoutes(router) {
  router.post('/api/instances/select', async (req, res, context) => {
    const body = await readJsonBody(req);
    if (!body.id) throw new HttpError(400, '缺少实例 ID。', 'ID_REQUIRED');
    await context.configStore.setActiveInstance(String(body.id));
    invalidateScan(context);
    return sendJson(res, 200, { ok: true, activeInstanceId: context.configStore.get().activeInstanceId });
  });

  router.del(/^\/api\/instances\/([^/]+)$/, async (req, res, context, url, match) => {
    const id = decodeURIComponent(match[1]);
    if (!id) throw new HttpError(400, '缺少实例 ID。', 'ID_REQUIRED');
    await context.configStore.removeInstance(id);
    invalidateScan(context, id);
    context.registryCache.delete(id);
    return sendJson(res, 200, { ok: true, activeInstanceId: context.configStore.get().activeInstanceId });
  });

  router.get('/api/jobs', async (req, res, context) => {
    return sendJson(res, 200, { jobs: context.jobs.list() });
  });

  router.get(/^\/api\/jobs\/([\w-]+)$/, async (req, res, context, url, match) => {
    const job = context.jobs.get(match[1]);
    if (!job) throw new HttpError(404, '任务不存在。', 'JOB_NOT_FOUND');
    return sendJson(res, 200, { job });
  });

  router.post(/^\/api\/jobs\/([\w-]+)\/cancel$/, async (req, res, context, url, match) => {
    const job = context.jobs.cancel(match[1]);
    if (!job) throw new HttpError(404, '任务不存在。', 'JOB_NOT_FOUND');
    return sendJson(res, 200, { job });
  });

  router.get('/api/bootstrap', async (req, res, context, url) => {
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
      tagLabels: tagTranslations(),
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
});

router.get('/api/instances', async (req, res, context, url) => {
    return sendJson(res, 200, { instances: context.configStore.get().instances, activeInstanceId: context.configStore.get().activeInstanceId });
});

router.post('/api/instances/detect', async (req, res, context, url) => {
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
});

router.post('/api/instances', async (req, res, context, url) => {
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
});

router.get('/api/scan', async (req, res, context, url) => {
    const runtime = await getRuntime(context, { forceScan: url.searchParams.get('refresh') === '1' });
    return sendJson(res, 200, { scan: runtime.scan, instance: runtime.instance, info: runtime.info });
});

router.get('/api/catalog/status', async (req, res, context, url) => {
    return sendJson(res, 200, { status: catalogStatus(context) });
});

router.get('/api/curseforge/search', async (req, res, context, url) => {
    const config = context.configStore.get();
    if (!curseforgeConfigured(config)) {
      return sendJson(res, 200, {
        needsKey: true,
        items: [],
        total: 0,
        page: 1,
        pageSize: Number(url.searchParams.get('pageSize')) || config.ui.pageSize,
        message: '在设置中填写 CurseForge API Key 后即可检索 Forge 项目。',
      });
    }
    let kspVersion = null;
    try {
      const runtime = await getRuntime(context);
      kspVersion = runtime.scan.kspVersion || runtime.info.version || null;
    } catch {
      // Forge browsing does not require a selected KSP instance.
    }
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(50, Math.max(6, Number(url.searchParams.get('pageSize')) || config.ui.pageSize));
    const result = await searchCurseForge({
      apiKey: config.curseforgeApiKey,
      query: url.searchParams.get('q') || '',
      page,
      pageSize,
      sort: url.searchParams.get('sort') || 'popularity',
      kspVersion,
    });
    return sendJson(res, 200, {
      ...result,
      source: 'curseforge',
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(result.total / pageSize)),
      kspVersion,
      configured: true,
    });
});

router.get(/^\/api\/curseforge\/mod\/(\d+)$/, async (req, res, context, url, match) => {
    const config = context.configStore.get();
    if (!curseforgeConfigured(config)) {
      throw new CurseForgeError('尚未配置 CurseForge API Key，请在设置中填写。', 'CURSEFORGE_KEY_MISSING');
    }
    const apiKey = config.curseforgeApiKey;
    const id = match[1];
    let kspVersion = null;
    try {
      const runtime = await getRuntime(context);
      kspVersion = runtime.scan.kspVersion || runtime.info.version || null;
    } catch {
      // Detail can still be viewed without an instance.
    }
    const [mod, description, screenshots] = await Promise.all([
      curseforgeRequest(`/mods/${id}`, { apiKey }),
      curseforgeRequest(`/mods/${id}/description`, { apiKey }).catch(() => ''),
      curseforgeRequest(`/mods/${id}/screenshots`, { apiKey }).catch(() => []),
    ]);
    if (!mod) throw new CurseForgeError('CurseForge 项目不存在。', 'CURSEFORGE_NOT_FOUND');
    const data = mapCurseForgeDetail(mod, { kspVersion, description, screenshots });
    return sendJson(res, 200, data);
});

router.get('/api/catalog', async (req, res, context, url) => {
    const config = context.configStore.get();
    const catalog = context.catalogStore.catalog;
    if (!catalog) {
      return sendJson(res, 200, {
        items: [], total: 0, page: 1, pageSize: config.ui.pageSize, pageCount: 1,
        catalog: catalogStatus(context),
        facets: { tags: [], tagLabels: tagTranslations() },
      });
    }
    let runtime = null;
    try {
      runtime = await getRuntime(context);
    } catch {
      runtime = null;
    }
    const installed = runtime ? installedData(runtime.scan, runtime.registry) : { identifiers: new Set(), versions: new Map() };
    const rawQuery = url.searchParams.get('q') || '';
    const queryInfo = await translateSearchQuery(context, rawQuery);
    const result = catalog.search({
      query: queryInfo.query,
      kspVersion: runtime?.scan.kspVersion || runtime?.info.version || null,
      allowWarning: config.install.allowWarning,
      page: Number(url.searchParams.get('page')) || 1,
      pageSize: Number(url.searchParams.get('pageSize')) || config.ui.pageSize,
      sort: url.searchParams.get('sort') || 'relevance',
      status: url.searchParams.get('status') || 'all',
      tag: url.searchParams.get('tag') || '',
      size: url.searchParams.get('size') || '',
      installedIdentifiers: installed.identifiers,
      installedVersions: installed.versions,
    });
    return sendJson(res, 200, {
      ...result,
      catalog: catalogStatus(context),
      kspVersion: runtime?.scan.kspVersion || null,
      queryTranslation: queryInfo.translated,
      facets: {
        tags: catalog.tagFacets().map((facet) => ({ ...facet, label: translateTag(facet.tag) })),
        tagLabels: tagTranslations(),
      },
    });
});

router.get('/api/catalog/package', async (req, res, context, url) => {
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
        ? checkKspCompatibility(runtime.scan.kspVersion, pkg)
        : null,
    });
});

router.get('/api/images', async (req, res, context, url) => {
    requireCatalog(context);
    const identifier = url.searchParams.get('identifier');
    if (!identifier) throw new HttpError(400, '缺少模组标识符。', 'IDENTIFIER_REQUIRED');
    const version = url.searchParams.get('version');
    const catalog = context.catalogStore.catalog;
    const pkg = version ? catalog.get(identifier, version) : catalog.get(identifier);
    if (!pkg) throw new HttpError(404, '索引中找不到该模组。', 'PACKAGE_NOT_FOUND');
    try {
      const gallery = await galleryFor(context, pkg);
      return sendJson(res, 200, {
        identifier: pkg.identifier,
        version: pkg.version,
        ...gallery,
      });
    } catch (error) {
      return sendJson(res, 200, {
        identifier: pkg.identifier,
        version: pkg.version,
        images: [],
        sources: [],
        message: `图片检索失败：${error?.message || '网络不可用'}`,
      });
    }
});

router.get('/api/image', async (req, res, context, url) => {
    const remote = url.searchParams.get('url');
    if (!remote) throw new HttpError(400, '缺少图片地址。', 'IMAGE_URL_REQUIRED');
    let image = await readImageCache(remote);
    if (!image) {
      image = await fetchImageBuffer(remote, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 20000 });
      await writeImageCache(remote, image.buffer, image.contentType);
    }
    res.writeHead(200, {
      'Content-Type': image.contentType,
      'Content-Length': image.buffer.length,
      'Cache-Control': 'private, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(image.buffer);
});

router.post('/api/app/update', async (req, res, context, url) => {
    const updater = path.join(APP_ROOT, 'kanmod-update.exe');
    if (!(await pathExists(updater))) {
      throw new HttpError(404, '当前是源码运行模式，没有安装更新器。', 'UPDATER_NOT_FOUND', {
        releaseUrl: 'https://github.com/11ly322/kanmod/releases/latest',
      });
    }
    const child = spawn(updater, [], {
      cwd: APP_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return sendJson(res, 202, { ok: true, version: APP_VERSION });
});

router.post('/api/translate/batch', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const items = Array.isArray(body.items) ? body.items.slice(0, 48) : [];
    if (!items.length) throw new HttpError(400, '没有需要翻译的内容。', 'EMPTY_TEXT');
    const results = await translateBatch(context, items, { force: Boolean(body.force) });
    return sendJson(res, 200, { results });
});

router.post('/api/translate', async (req, res, context, url) => {
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
});

router.get('/api/relationships', async (req, res, context, url) => {
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
});

router.post('/api/catalog/refresh', async (req, res, context, url) => {
    const job = await enqueueRefresh(context);
    return sendJson(res, 202, { job });
});

router.post('/api/catalog/import', async (req, res, context, url) => {
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
});

router.post('/api/catalog/upload', async (req, res, context, url) => {
    const name = safeFileName(url.searchParams.get('name') || 'catalog.json');
    const buffer = await readBody(req, { limit: MAX_UPLOAD });
    if (!buffer.length) throw new HttpError(400, '上传内容为空。', 'EMPTY_UPLOAD');
    const catalog = await context.catalogStore.importBuffer(buffer, {
      sourceName: name,
      sourceId: 'upload',
    });
    return sendJson(res, 200, { catalog: catalogStatus(context), sourceName: name, count: catalog.meta.count });
});

router.get('/api/catalog/export', async (req, res, context, url) => {
    requireCatalog(context);
    const buffer = context.catalogStore.exportJson();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="kanmod-catalog.json"',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    return res.end(buffer);
});

router.post('/api/resolve', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const roots = normalizeRoots(body.roots || body.identifiers);
    if (!roots.length) throw new HttpError(400, '请选择至少一个模组。', 'ROOTS_REQUIRED');
    const { plan } = await resolveFor(context, roots, body);
    return sendJson(res, 200, { plan });
});

router.post('/api/install', async (req, res, context, url) => {
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
});

router.get('/api/installed', async (req, res, context, url) => {
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
});

router.get('/api/diagnostics', async (req, res, context, url) => {
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
});

router.post('/api/repair/preview', async (req, res, context, url) => {
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
});

router.post('/api/repair', async (req, res, context, url) => {
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
});

router.post('/api/mods/disable', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const entry = findInstalledEntry(runtime, body.identifier || body.id || body.folder);
    if (!entry) throw new HttpError(404, '没有找到这个已安装模组。', 'MOD_NOT_FOUND');
    if (isStockEntry(entry)) throw new HttpError(403, '原版游戏组件不能禁用。', 'STOCK_MOD');
    const manifest = await disableInstalledMod(context, runtime, entry);
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, { ok: true, disabled: manifest });
});

router.post('/api/mods/enable', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const store = await getDisabledStore(context, runtime.instance.id);
    const manifest = store.find({ identifier: body.identifier, folder: body.folder, id: body.id })
      || store.get(lower(body.key));
    if (!manifest) throw new HttpError(404, '没有找到这个已禁用模组。', 'DISABLED_NOT_FOUND');
    const result = await enableDisabledMod(context, runtime, manifest);
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, { ok: true, enabled: result });
});

router.post('/api/mods/delete', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const store = await getDisabledStore(context, runtime.instance.id);
    const manifest = store.find({ identifier: body.identifier, folder: body.folder, id: body.id })
      || store.get(lower(body.key));
    const entry = manifest ? null : findInstalledEntry(runtime, body.identifier || body.id || body.folder);
    if (!manifest && !entry) throw new HttpError(404, '没有找到这个模组。', 'MOD_NOT_FOUND');
    if (entry && isStockEntry(entry)) throw new HttpError(403, '原版游戏组件不能删除。', 'STOCK_MOD');
    const result = await deleteInstalledMod(context, runtime, { entry, manifest });
    invalidateScan(context, runtime.instance.id);
    return sendJson(res, 200, {
      ok: true,
      identifier: manifest?.identifier || entry?.identifier || null,
      moved: result.moved,
      trashPath: result.trashPath,
    });
});

router.post('/api/mods/update', async (req, res, context, url) => {
    requireCatalog(context);
    const body = await readJsonBody(req);
    const runtime = await getRuntime(context);
    const result = await installedFor(context, runtime);
    const wanted = lower(body.identifier || body.id || '');
    const wantedList = Array.isArray(body.identifiers)
      ? body.identifiers.map((item) => lower(item)).filter(Boolean)
      : [];
    const updates = wantedList.length
      ? result.updates.filter((item) => wantedList.includes(lower(item.identifier)))
      : wanted
        ? result.updates.filter((item) => lower(item.identifier) === wanted)
        : result.updates;
    if (!updates.length) {
      return sendJson(res, 200, {
        ok: true,
        job: null,
        updates: [],
        message: wantedList.length
          ? '选中的模组没有可用更新。'
          : wanted
            ? '这个模组已经是最新版本。'
            : '所有已安装模组都是最新版本。',
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
    const title = updates.length === 1
      ? `更新 ${updates[0].name || updates[0].identifier}`
      : `批量更新 ${updates.length} 个模组`;
    const job = await enqueueInstall(context, plan, {
      title,
      meta: { updates, kind: 'update' },
    });
    return sendJson(res, 202, { ok: true, job, plan, updates });
});

router.post('/api/mods/batch', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const action = String(body.action || '');
    const identifiers = Array.isArray(body.identifiers)
      ? [...new Set(body.identifiers.map((item) => String(item || '').trim()).filter(Boolean))]
      : [];
    if (!['disable', 'enable', 'delete'].includes(action)) {
      throw new HttpError(400, '批量操作类型无效。', 'BATCH_ACTION_INVALID');
    }
    if (!identifiers.length) throw new HttpError(400, '请先选择模组。', 'BATCH_EMPTY');
    if (identifiers.length > 200) throw new HttpError(400, '一次最多处理 200 个模组。', 'BATCH_TOO_LARGE');
    const runtime = await getRuntime(context);
    const store = await getDisabledStore(context, runtime.instance.id);
    const results = [];
    for (const raw of identifiers) {
      const identifier = lower(raw);
      try {
        if (action === 'disable') {
          const entry = findInstalledEntry(runtime, identifier);
          if (!entry) throw new HttpError(404, '没有找到这个已安装模组。', 'MOD_NOT_FOUND');
          if (isStockEntry(entry)) throw new HttpError(403, '原版游戏组件不能禁用。', 'STOCK_MOD');
          const manifest = await disableInstalledMod(context, runtime, entry);
          results.push({ identifier, name: entry.name || entry.folder, ok: true, key: manifest.key });
        } else if (action === 'enable') {
          const manifest = store.find({ identifier, id: identifier });
          if (!manifest) throw new HttpError(404, '没有找到这个已禁用模组。', 'DISABLED_NOT_FOUND');
          const enabled = await enableDisabledMod(context, runtime, manifest);
          results.push({ identifier, name: manifest.name, ok: true, relPath: enabled.relPath });
        } else {
          const manifest = store.find({ identifier, id: identifier });
          const entry = manifest ? null : findInstalledEntry(runtime, identifier);
          if (!manifest && !entry) throw new HttpError(404, '没有找到这个模组。', 'MOD_NOT_FOUND');
          if (entry && isStockEntry(entry)) throw new HttpError(403, '原版游戏组件不能删除。', 'STOCK_MOD');
          const removed = await deleteInstalledMod(context, runtime, { entry, manifest });
          results.push({ identifier, name: manifest?.name || entry?.name || entry?.folder, ok: true, moved: removed.moved });
        }
      } catch (error) {
        results.push({
          identifier,
          ok: false,
          error: error.message || '操作失败',
          code: error.code || 'BATCH_ITEM_FAILED',
        });
      }
    }
    invalidateScan(context, runtime.instance.id);
    const succeeded = results.filter((item) => item.ok).length;
    return sendJson(res, 200, {
      ok: succeeded > 0,
      action,
      results,
      succeeded,
      failed: results.length - succeeded,
    });
});

router.post('/api/uninstall', async (req, res, context, url) => {
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
});

router.post('/api/archive/preview', async (req, res, context, url) => {
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
});

router.post('/api/archive/install', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const upload = context.uploads.get(String(body.uploadId || ''));
    if (!upload) throw new HttpError(404, '安装包上传记录已失效，请重新上传。', 'UPLOAD_NOT_FOUND');
    if (!(await pathExists(upload.path))) throw new HttpError(404, '安装包临时文件已不存在，请重新上传。', 'UPLOAD_MISSING');
    const job = installFromUpload(context, upload, `安装本地包 ${upload.packageInfo.name}`);
    return sendJson(res, 202, { ok: true, job });
});

router.get('/api/settings', async (req, res, context, url) => {
    return sendJson(res, 200, {
      settings: publicSettings(context),
      sources: listCatalogSources(context.configStore.get()),
      dataDir: DATA_DIR,
    });
});

router.post('/api/settings', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const patch = {};
    if (isObject(body.install)) {
      patch.install = {};
      for (const key of ['backupOverwrite', 'allowWarning', 'allowUnknown', 'keepDownloads', 'autoDependencies']) {
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
});

router.post('/api/game/launch', async (req, res, context, url) => {
    const runtime = await getRuntime(context);
    const executable = runtime.info.executable;
    if (!executable || !(await pathExists(executable))) {
      throw new HttpError(409, '没有找到 KSP 可执行文件，请重新选择游戏目录。', 'GAME_EXECUTABLE_NOT_FOUND');
    }
    const child = spawn(executable, [], {
      cwd: runtime.instance.path,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return sendJson(res, 202, { ok: true, path: executable, pid: child.pid || null });
});

router.get('/api/cache/status', async (req, res, context, url) => {
    return sendJson(res, 200, { cache: await cacheStatus() });
});

router.post('/api/cache/clear', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const allowed = new Set(['downloads', 'images', 'translations']);
    const targets = (Array.isArray(body.targets) ? body.targets : ['downloads', 'images', 'translations'])
      .map(String)
      .filter((target) => allowed.has(target));
    if (!targets.length) throw new HttpError(400, '没有可清理的缓存类型。', 'BAD_CACHE_TARGET');
    const before = await cacheStatus();
    for (const target of targets) {
      const directory = path.join(DATA_DIR, target);
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      await ensureDir(directory);
    }
    const after = await cacheStatus();
    return sendJson(res, 200, { ok: true, cleared: Math.max(0, before.total - after.total), cache: after });
});

router.get('/api/modpack/export', async (req, res, context, url) => {
    const runtime = await getRuntime(context);
    const data = await installedFor(context, runtime);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const depends = data.entries
      .filter((entry) => entry.identifier)
      .map((entry) => ({ name: entry.identifier, version: entry.installedVersion || undefined }));
    const modpack = {
      spec_version: 1,
      identifier: `kanmod-export-${stamp}`,
      name: 'kanmod 模组包',
      version: stamp,
      abstract: `kanmod 导出的模组包，共 ${depends.length} 个模组。`,
      license: 'MIT',
      kind: 'metapackage',
      ksp_version: runtime.scan.kspVersion || null,
      depends,
    };
    const body = JSON.stringify(modpack, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="kanmod-modpack-${stamp}.ckan"`,
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(body);
});

router.post('/api/modpack/preview', async (req, res, context, url) => {
    requireCatalog(context);
    const body = await readJsonBody(req);
    const depends = Array.isArray(body.depends)
      ? body.depends
      : Array.isArray(body.package?.depends) ? body.package.depends : [];
    const roots = depends
      .map((relation) => (typeof relation === 'string' ? relation : relation?.name))
      .filter(Boolean);
    if (!roots.length) throw new HttpError(400, '这个模组包没有可安装的依赖。', 'EMPTY_MODPACK');
    const { plan } = await resolveFor(context, roots, body);
    return sendJson(res, 200, {
      modpack: {
        identifier: String(body.identifier || body.package?.identifier || 'modpack'),
        name: String(body.name || body.package?.name || '导入的模组包'),
        version: String(body.version || body.package?.version || ''),
        count: roots.length,
      },
      plan,
    });
});

router.post('/api/open', async (req, res, context, url) => {
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
  });
}
