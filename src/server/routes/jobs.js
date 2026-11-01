// 后台任务查询与取消
import { HttpError, sendJson } from '../http.js';

export function registerJobsRoutes(router) {
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
}
