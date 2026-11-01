// 设置、应用更新与缓存清理
import { publicSettings, cacheStatus } from '../services.js';
import { HttpError, readJsonBody, sendJson } from '../http.js';
import { DATA_DIR, APP_ROOT } from '../../config.js';
import { ensureDir, pathExists } from '../../util/fsx.js';
import { listCatalogSources } from '../../catalog/sources.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION } from '../../version.js';

export function registerSettingsRoutes(router) {
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
}
