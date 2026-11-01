// 问题诊断与自动修复
import { resolveFor, enqueueInstall, runDiagnostics } from '../services.js';
import { sendJson } from '../http.js';

export function registerDiagnosticsRoutes(router) {
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
}
