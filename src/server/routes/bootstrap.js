// 首屏引导（实例、扫描、索引、设置、任务汇总）
import { getActiveInstance, getRuntime, installedData, publicSettings, catalogStatus } from '../services.js';
import { sendJson } from '../http.js';
import { listCatalogSources } from '../../catalog/sources.js';
import { tagTranslations } from '../../tagTranslations.js';
import { APP_VERSION } from '../../version.js';

export function registerBootstrapRoutes(router) {
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
}
