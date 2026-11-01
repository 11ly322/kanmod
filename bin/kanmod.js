import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const argv = process.argv.slice(2);

function hasFlag(name) {
  return argv.includes(name);
}

function option(name, fallback = null) {
  const prefix = `${name}=`;
  const found = argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`kanmod 0.1.2 — 坎巴拉太空计划 1 模组管理器

用法:
  node bin/kanmod.js                 启动并打开 kanmod
  node bin/kanmod.js --demo          启动离线演示环境
  node bin/kanmod.js --demo --fresh  重建演示环境
  node bin/kanmod.js --port=4173     指定本地端口
  node bin/kanmod.js --no-open       只启动，不自动打开窗口
  node bin/kanmod.js --help          显示帮助
`);
  process.exit(0);
}

if (hasFlag('--version') || hasFlag('-v')) {
  console.log('kanmod 0.1.2');
  process.exit(0);
}

const demo = hasFlag('--demo');
const fresh = hasFlag('--fresh');
const noOpen = hasFlag('--no-open');
const requestedPort = Number(option('--port', '4173'));
const explicitDataDir = option('--data-dir', null);
if (explicitDataDir) {
  process.env.KANMOD_DATA_DIR = path.resolve(explicitDataDir);
}

if (demo) {
  // Give the demo its own data directory before importing modules that read DATA_DIR.
  const demoRoot = process.env.KANMOD_DEMO_DIR
    ? path.resolve(process.env.KANMOD_DEMO_DIR)
    : path.join(APP_ROOT, '.data', 'demo');
  process.env.KANMOD_DATA_DIR = path.join(demoRoot, 'data');
}

const { prepareDemo } = await import('../src/demo.js');
const { startServer } = await import('../server.js');

let demoInfo = null;
if (demo) {
  console.log('kanmod · 正在准备离线演示环境…');
  demoInfo = await prepareDemo({ fresh });
}

let started;
try {
  started = await startServer({
    demoInfo,
    port: Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 4173,
    open: false,
  });
} catch (error) {
  if (error?.code === 'EADDRINUSE') {
    console.warn(`端口 ${requestedPort} 已被占用，改用随机端口。`);
    started = await startServer({ demoInfo, port: 0, open: false });
  } else {
    console.error(`kanmod 启动失败：${error?.message || error}`);
    process.exit(1);
  }
}

const { context, url } = started;
const { DATA_DIR } = await import('../src/config.js');
const runtimeFile = path.join(DATA_DIR, 'runtime.json');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(runtimeFile, JSON.stringify({
    pid: process.pid,
    port: context.port,
    url,
    version: '0.1.2',
    appRoot: APP_ROOT,
    startedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
} catch (error) {
  console.warn(`无法写入运行状态：${error.message}`);
}
function clearRuntime() {
  try { fs.rmSync(runtimeFile, { force: true }); } catch { /* ignore */ }
}
process.on('exit', clearRuntime);
console.log('');
console.log('  kanmod 已启动');
console.log(`  访问地址  ${url}`);
console.log(`  KSP 实例  ${demoInfo ? demoInfo.kspPath : context.configStore.get().instances.length ? context.configStore.get().activeInstanceId || '未选择' : '尚未配置'}`);
console.log(`  数据目录  ${demoInfo ? demoInfo.dataDir : DATA_DIR}`);
console.log('');
console.log('  关闭此窗口或按 Ctrl+C 退出。');
console.log('');

if (!noOpen && context.configStore.get().ui.openBrowser) {
  const { openAppWindow } = await import('../server.js');
  await openAppWindow(url).catch(() => {
    console.log('未能自动打开窗口，请手动复制上面的访问地址。');
  });
}

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭 kanmod…`);
  const server = started?.server;
  if (!server) process.exit(0);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
