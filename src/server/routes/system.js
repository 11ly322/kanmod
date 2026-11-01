// 打开目录、启动游戏等系统操作
import { getRuntime } from '../services.js';
import { HttpError, readJsonBody, sendJson } from '../http.js';
import { DATA_DIR } from '../../config.js';
import { ensureDir, pathExists } from '../../util/fsx.js';
import { findLogFile } from '../../diagnostics.js';
import { openInExplorer } from '../shell.js';
import path from 'node:path';

export function registerSystemRoutes(router) {
router.post('/api/game/launch', async (req, res, context, url) => {
    const runtime = await getRuntime(context);
    const executable = runtime.info.executable;
    if (!executable || !(await pathExists(executable))) {
      throw new HttpError(409, '没有找到 KSP 可执行文件，请重新选择游戏目录。', 'GAME_EXECUTABLE_NOT_FOUND');
    }
    const child = spawn(executable, [], {
      cwd: runtime.instance.path,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return sendJson(res, 202, { ok: true, path: executable, pid: child.pid || null });
});

router.post('/api/open', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const target = String(body.target || '');
    const runtime = await getRuntime(context).catch(() => null);
    let file = null;
    if (target === 'gamedata') {
      if (!runtime) throw new HttpError(409, '尚未选择 KSP 实例。', 'NO_INSTANCE');
      file = runtime.info.gameDataPath;
    } else if (target === 'ksp') {
      if (!runtime) throw new HttpError(409, '尚未选择 KSP 实例。', 'NO_INSTANCE');
      file = runtime.info.path;
    } else if (target === 'log') {
      if (!runtime) throw new HttpError(409, '尚未选择 KSP 实例。', 'NO_INSTANCE');
      const found = await findLogFile(runtime.info.path);
      if (!found) throw new HttpError(404, '没有找到 KSP 日志文件。', 'LOG_NOT_FOUND');
      file = found.path;
    } else if (target === 'backups') {
      file = path.join(DATA_DIR, 'backups');
    } else if (target === 'trash') {
      file = path.join(DATA_DIR, 'trash');
    } else if (target === 'downloads') {
      file = path.join(DATA_DIR, 'downloads');
    } else if (target === 'data') {
      file = DATA_DIR;
    } else {
      throw new HttpError(400, '未知的打开目标。', 'BAD_TARGET');
    }
    await ensureDir(path.dirname(file));
    await openInExplorer(file, target === 'log');
    return sendJson(res, 200, { ok: true, path: file });
  });
}
