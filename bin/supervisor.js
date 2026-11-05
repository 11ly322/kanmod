import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const argv = process.argv.slice(2);
function option(name, fallback = null) {
  const prefix = `${name}=`;
  const found = argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
const PORT = Number(option('--port', '4173'));
const explicitDataDir = option('--data-dir', null);
const DATA_DIR = explicitDataDir
  ? path.resolve(explicitDataDir)
  : process.env.KANMOD_DATA_DIR
    ? path.resolve(process.env.KANMOD_DATA_DIR)
    : path.join(APP_ROOT, '.data');
const LOCK_FILE = path.join(DATA_DIR, 'supervisor.json');
const LOG_FILE = path.join(DATA_DIR, 'supervisor.log');
const RUNTIME_FILE = path.join(DATA_DIR, 'runtime.json');
const CHILD_ENTRY = path.join(APP_ROOT, 'bin', 'kanmod.js');
const APP_VERSION = '0.1.7';

let child = null;
let stopping = false;
let failureCount = 0;
let restartTimer = null;
let healthTimer = null;
let unhealthyCount = 0;
let logFd = null;

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Logging must never stop the supervisor.
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file) {
  const data = readJson(file);
  return Number(data?.pid) || null;
}

function writeLock(childPid = null) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      childPid,
      version: APP_VERSION,
      appRoot: APP_ROOT,
      startedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  } catch (error) {
    log(`写入守护锁失败：${error.message}`);
  }
}

function clearRuntime() {
  try { fs.rmSync(RUNTIME_FILE, { force: true }); } catch { /* ignore */ }
}

function openLog() {
  try {
    if (logFd !== null && logFd !== 'ignore') {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logFd = fs.openSync(LOG_FILE, 'a');
    return logFd;
  } catch {
    return 'ignore';
  }
}

function startChild() {
  if (stopping) return;
  if (!fs.existsSync(CHILD_ENTRY)) {
    log(`找不到 ${CHILD_ENTRY}`);
    process.exit(2);
  }
  clearRuntime();
  const out = openLog();
  log(`启动服务进程（第 ${failureCount + 1} 次）`);
  try {
    child = spawn(process.execPath, [
      CHILD_ENTRY,
      '--no-open',
      `--port=${PORT}`,
      `--data-dir=${DATA_DIR}`,
    ], {
      cwd: APP_ROOT,
      windowsHide: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        KANMOD_DATA_DIR: DATA_DIR,
        KANMOD_SUPERVISED: '1',
        // The child exits on its own after the UI has been closed for a while.
        KANMOD_AUTO_EXIT: '1',
      },
    });
  } catch (error) {
    log(`无法启动服务进程：${error.message}`);
    scheduleRestart();
    return;
  }
  writeLock(child.pid);
  child.on('error', (error) => log(`服务进程错误：${error.message}`));
  child.on('exit', (code, signal) => {
    log(`服务进程退出：code=${code} signal=${signal || ''}`);
    child = null;
    writeLock(null);
    if (stopping) {
      cleanupAndExit(0);
      return;
    }
    if (code === 0) {
      // A clean exit means the server closed itself after the UI went away;
      // do not keep the supervisor (and memory) alive behind an empty window.
      log('服务正常退出（界面已关闭），守护进程一并退出');
      cleanupAndExit(0);
      return;
    }
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (stopping) return;
  failureCount += 1;
  const delay = Math.min(30_000, 800 * (2 ** Math.min(failureCount - 1, 5)));
  log(`${delay}ms 后重启服务进程`);
  clearTimeout(restartTimer);
  restartTimer = setTimeout(startChild, delay);
}

function stopChild() {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // The process may already be gone.
  }
}

function cleanupAndExit(code) {
  stopping = true;
  clearTimeout(restartTimer);
  clearInterval(healthTimer);
  try {
    const lock = readJson(LOCK_FILE);
    if (Number(lock?.pid) === process.pid) fs.rmSync(LOCK_FILE, { force: true });
  } catch { /* ignore */ }
  log('守护进程退出');
  process.exit(code);
}

function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  log(`收到 ${reason}，停止守护进程`);
  clearTimeout(restartTimer);
  clearInterval(healthTimer);
  stopChild();
  setTimeout(() => cleanupAndExit(0), 600).unref();
}

async function checkHealth() {
  if (!child || stopping) return;
  const runtime = readJson(RUNTIME_FILE);
  if (!runtime?.url) return;
  try {
    const url = new URL('/api/health', runtime.url);
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    if (!body?.ok) throw new Error('健康检查未返回 ok');
    unhealthyCount = 0;
    failureCount = 0;
  } catch (error) {
    unhealthyCount += 1;
    log(`健康检查失败（${unhealthyCount}/3）：${error.message}`);
    if (unhealthyCount >= 3) {
      unhealthyCount = 0;
      log('服务连续无响应，正在重启');
      try { child.kill(); } catch { /* ignore */ }
    }
  }
}

const existingPid = readPid(LOCK_FILE);
if (pidAlive(existingPid)) {
  log(`已有守护进程在运行（pid ${existingPid}），本次退出`);
  process.exit(0);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
writeLock(null);
clearRuntime();
startChild();
healthTimer = setInterval(checkHealth, 15_000);
healthTimer.unref?.();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  log(`未捕获异常：${error.stack || error.message}`);
});
process.on('unhandledRejection', (error) => {
  log(`未处理 Promise 拒绝：${error?.stack || error}`);
});
process.on('exit', () => {
  if (logFd !== null && logFd !== 'ignore') {
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  }
});
