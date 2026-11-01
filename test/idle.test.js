import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve({ timedOut: true, code: null });
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code });
    });
  });
}

test('界面关闭后服务在空闲超时后自动退出', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanmod-idle-'));
  const child = spawn(process.execPath, [
    path.join(APP_ROOT, 'bin', 'kanmod.js'),
    '--no-open',
    '--port=0',
  ], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      KANMOD_DATA_DIR: dataDir,
      KANMOD_AUTO_EXIT: '1',
      KANMOD_IDLE_EXIT_MS: '250',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const result = await waitForExit(child, 15_000);
  fs.rmSync(dataDir, { recursive: true, force: true });

  assert.equal(result.timedOut, false, `服务没有在空闲后退出：${output}`);
  assert.equal(result.code, 0, `退出码不是 0：${output}`);
  assert.match(output, /自动退出/);
});
