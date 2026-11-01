// 模组包导出与预览
import { getRuntime, installedFor, requireCatalog, resolveFor } from '../services.js';
import { HttpError, readJsonBody, sendJson } from '../http.js';

export function registerModpackRoutes(router) {
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
}
