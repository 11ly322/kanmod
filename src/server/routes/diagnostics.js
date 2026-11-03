// 问题诊断与自动修复
import { resolveFor, enqueueInstall, runDiagnostics } from '../services.js';
import { sendJson } from '../http.js';

export function registerDiagnosticsRoutes(router) {
router.get('/api/diagnostics', async (req, res, context, url) => {
    const includeLog = url.searchParams.get('log') !== '0';
    const forceScan = url.searchParams.get('force') === '1';
    const result = await runDiagnostics(context, { includeLog, forceScan });
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
    const settings = context.configStore.get();
    const options = {
      allowWarning: Boolean(settings.install.allowWarning),
      allowUnknown: Boolean(settings.install.allowUnknown),
    };
    const skip = (operation, reason) => ({ identifier: operation.identifier, version: operation.version || null, label: operation.label || operation.identifier, reason });
    const blockReason = (plan, operation) => {
      const wanted = String(operation.identifier || '').toLowerCase();
      const wantedName = String(operation.label || '').toLowerCase();
      const missing = (plan?.missing || []).find((item) => {
        const name = String(item.name || item.identifier || '').toLowerCase();
        const detail = String(item.details?.identifier || '').toLowerCase();
        return name === wanted || name === wantedName || detail === wanted;
      });
      if (missing) return missing.reason === 'no_version' ? '索引中没有与当前 KSP 版本兼容的版本' : '索引中找不到这个前置';
      const conflict = (plan?.conflicts || []).find((item) => {
        const name = String(item.identifier || item.name || '').toLowerCase();
        const scope = String(item.scope || '');
        return name === wanted || name === wantedName || scope === wanted;
      });
      if (conflict) return conflict.message || '与已安装模组或其它修复项冲突';
      return '无法与其它修复项一起安装';
    };
    let current = result.repairs.operations.map((operation) => ({
      identifier: operation.identifier,
      version: operation.version,
      label: operation.label,
    }));
    let plan = null;
    const skipped = [];
    // Install only the largest subset that resolves cleanly. A single broken
    // dependency used to abort the whole repair, which left users with no way
    // to fix the remaining issues.
    while (current.length) {
      const resolved = await resolveFor(context, current.map((item) => ({ identifier: item.identifier, version: item.version })), options);
      plan = resolved.plan;
      if (plan.ok) break;
      const blocked = new Set([
        ...(plan.missing || []).flatMap((item) => [String(item.name || '').toLowerCase(), String(item.details?.identifier || '').toLowerCase()]),
        ...(plan.conflicts || []).flatMap((item) => [String(item.identifier || '').toLowerCase(), String(item.name || '').toLowerCase()]),
      ].filter(Boolean));
      let index = current.findIndex((item) => blocked.has(String(item.identifier).toLowerCase()) || blocked.has(String(item.label || '').toLowerCase()));
      if (index < 0) index = current.length - 1;
      skipped.unshift(skip(current[index], blockReason(plan, current[index])));
      current = current.filter((_, position) => position !== index);
    }
    const blockedRepairs = { skipped, blocked: skipped.length };
    if (!plan || !plan.ok) {
      return sendJson(res, 422, {
        error: { message: '自动修复的依赖计划存在冲突，未执行任何修改。', code: 'REPAIR_PLAN_FAILED' },
        plan,
        repairs: { ...result.repairs, ...blockedRepairs },
      });
    }
    if (!plan.installOrder.some((node) => node.action !== 'keep')) {
      return sendJson(res, 200, { ok: true, job: null, plan, repairs: { ...result.repairs, ...blockedRepairs }, message: '没有需要安装的修复项。' });
    }
    const job = await enqueueInstall(context, plan, {
      title: '自动修复问题',
      meta: { repairs: result.repairs.operations },
    });
    return sendJson(res, 202, { ok: true, job, plan, repairs: { ...result.repairs, ...blockedRepairs } });
});
}
