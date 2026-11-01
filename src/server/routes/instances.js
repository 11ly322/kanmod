// KSP 实例：检测、添加、选择、删除与重新扫描
import { invalidateScan, getRuntime } from '../services.js';
import { HttpError, readJsonBody, sendJson } from '../http.js';
import { lower, nowIso } from '../shared.js';
import { kspCandidates } from '../../ksp/locate.js';
import { inspectKspPath } from '../../ksp/version.js';
import path from 'node:path';

export function registerInstancesRoutes(router) {
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
}
