// 解析、安装、上传包安装与模组包
import { invalidateScan, getRuntime, installedFor, requireCatalog, normalizeRoots, summarizePlan, resolveFor, enqueueInstall, uploadPackageInfo, installFromUpload } from '../services.js';
import { HttpError, readJsonBody, readBody, sendJson, MAX_UPLOAD } from '../http.js';
import { DATA_DIR } from '../../config.js';
import { ensureDir, pathExists } from '../../util/fsx.js';
import { safeFileName } from '../../util/paths.js';
import { previewInstall } from '../../installer.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export function registerInstallRoutes(router) {
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
}
