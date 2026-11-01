// 索引、模组详情、关联、图片与 CurseForge 检索
import { readImageCache, writeImageCache, galleryFor, getRuntime, installedData, requireCatalog, catalogStatus, enqueueRefresh, translateSearchQuery } from '../services.js';
import { HttpError, readJsonBody, readBody, sendJson, MAX_UPLOAD } from '../http.js';
import { lower } from '../shared.js';
import { safeFileName } from '../../util/paths.js';
import { downloadBuffer } from '../../catalog/loader.js';
import { checkKspCompatibility } from '../../util/version.js';
import { tagTranslations, translateTag } from '../../tagTranslations.js';
import { fetchImageBuffer } from '../../modImages.js';
import { searchCurseForge, curseforgeRequest, curseforgeConfigured, mapCurseForgeDetail, mapCurseForgeMod, CurseForgeError } from '../../curseforge.js';
import { fetchPublicProject, toCurseForgeMod, PublicCurseForgeError } from '../../curseforgePublic.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export function registerCatalogRoutes(router) {
router.get('/api/catalog/status', async (req, res, context, url) => {
    return sendJson(res, 200, { status: catalogStatus(context) });
});

router.get('/api/curseforge/search', async (req, res, context, url) => {
    const config = context.configStore.get();
    if (!curseforgeConfigured(config)) {
      const pageSize = Number(url.searchParams.get('pageSize')) || config.ui.pageSize;
      const query = String(url.searchParams.get('q') || '').trim();
      let kspVersion = null;
      try {
        const runtime = await getRuntime(context);
        kspVersion = runtime.scan.kspVersion || runtime.info.version || null;
      } catch {
        // 没有实例时也能按链接查询项目。
      }
      const items = [];
      let message = '未配置 CurseForge API Key。可以直接粘贴 CurseForge 项目链接、slug 或数字 ID 查询，免 Key 模式不支持关键词搜索。';
      if (query) {
        try {
          const project = await fetchPublicProject(query);
          items.push(mapCurseForgeMod(toCurseForgeMod(project), { kspVersion }));
          message = '免 Key 模式按项目链接 / slug / ID 精确查询，不支持关键词搜索。';
        } catch (error) {
          if (!(error instanceof PublicCurseForgeError)) throw error;
          message = error.message;
        }
      }
      return sendJson(res, 200, {
        needsKey: true,
        public: true,
        items,
        total: items.length,
        page: 1,
        pageSize,
        pageCount: 1,
        kspVersion,
        message,
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
    const id = match[1];
    let kspVersion = null;
    try {
      const runtime = await getRuntime(context);
      kspVersion = runtime.scan.kspVersion || runtime.info.version || null;
    } catch {
      // Detail can still be viewed without an instance.
    }
    if (!curseforgeConfigured(config)) {
      const project = await fetchPublicProject(id);
      const data = mapCurseForgeDetail(toCurseForgeMod(project), { kspVersion, description: project.description, screenshots: [] });
      return sendJson(res, 200, {
        ...data,
        public: true,
        downloads: project.downloads,
        latestDownloadUrl: project.latest?.downloadUrl || null,
      });
    }
    const apiKey = config.curseforgeApiKey;
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
}
