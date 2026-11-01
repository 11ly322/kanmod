// 已安装模组：禁用、启用、删除、更新、卸载与批量操作
import { invalidateScan, getRuntime, getDisabledStore, installedFor, findInstalledEntry, isStockEntry, disableInstalledMod, enableDisabledMod, deleteInstalledMod, requireCatalog, resolveFor, enqueueInstall } from '../services.js';
import { HttpError, readJsonBody, sendJson } from '../http.js';
import { lower } from '../shared.js';

export function registerModsRoutes(router) {
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
}
