// Parallel range downloads for large archives.
//
// Many mod hosts (GitHub Releases, ForgeCDN, most CDNs) honour the HTTP Range
// header, so a single slow connection can be split into several parallel
// requests. Everything here degrades to a plain single-request download when a
// server ignores ranges, the file is small, or the size is unknown.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const RANGE_MIN_BYTES = 4 * 1024 * 1024;
const UA = 'kanmod/1.0 (KSP mod manager; local)';

function abortError(message) {
  return Object.assign(new Error(message), { name: 'AbortError', code: 'ABORTED' });
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest('hex');
}

/**
 * Ask for a single byte with Range to learn whether the server supports range
 * requests and what the full size is. Returns null when ranges cannot be used.
 */
export async function probeRangeSupport(url, { signal, timeoutMs = 15_000, stallTimeoutMs = 8_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(abortError('探测分片支持超时。')), timeoutMs);
  let stall = setTimeout(() => controller.abort(abortError('探测分片支持停滞。')), stallTimeoutMs);
  const onAbort = () => controller.abort(abortError('已取消。'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': UA },
      redirect: 'follow',
      signal: controller.signal,
    });
    const range = response.headers.get('content-range') || '';
    const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(range);
    try {
      await response.body?.cancel();
    } catch {
      // The probe body is irrelevant.
    }
    if (response.status !== 206 || !match) return null;
    const total = Number(match[1]);
    if (!Number.isFinite(total) || total <= 0) return null;
    return { total };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    clearTimeout(stall);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchPart(handle, url, part, { controller, stallTimeoutMs, onProgress }) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${part.start}-${part.end}`, 'User-Agent': UA },
    redirect: 'follow',
    signal: controller.signal,
  });
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => {});
    throw Object.assign(new Error('服务器不支持分片下载。'), { code: 'RANGE_UNSUPPORTED' });
  }
  if (!response.body) throw new Error('分片响应没有内容。');
  const reader = response.body.getReader();
  let stall = setTimeout(() => controller.abort(new Error('分片下载停滞。')), stallTimeoutMs);
  let position = part.start;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(stall);
      stall = setTimeout(() => controller.abort(new Error('分片下载停滞。')), stallTimeoutMs);
      await handle.write(value, 0, value.length, position);
      position += value.length;
      onProgress(value.length);
    }
  } finally {
    clearTimeout(stall);
  }
  if (position !== part.end + 1) {
    throw new Error('分片下载长度与服务器声明不一致。');
  }
}

/**
 * Download `url` into `target` using parallel Range requests.
 * Returns null when range downloading is not applicable (caller falls back to a
 * normal streaming download). Throws only for real failures or cancellation.
 */
export async function downloadRangedToFile(url, target, options = {}) {
  const {
    chunks = 4,
    timeoutMs = 180_000,
    stallTimeoutMs = 20_000,
    maxBytes = 2 * 1024 * 1024 * 1024,
    expectedSha256 = null,
    onProgress = () => {},
    signal,
    total: knownTotal = 0,
  } = options;
  const count = Math.max(2, Math.min(8, Number(chunks) || 4));
  const total = Number(knownTotal) || (await probeRangeSupport(url, { signal, stallTimeoutMs }))?.total || 0;
  if (!total || total < RANGE_MIN_BYTES || total > maxBytes) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(abortError('下载超时。')), timeoutMs);
  const onAbort = () => controller.abort(abortError('已取消。'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const temp = `${target}.${process.pid}.${Date.now()}.ranged${count}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  let handle = await fs.open(temp, 'w');
  const per = Math.ceil(total / count);
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * per;
    const end = Math.min(total - 1, (index + 1) * per - 1);
    if (start > end) break;
    parts.push({ start, end });
  }
  let received = 0;
  try {
    await Promise.all(parts.map((part) => fetchPart(handle, url, part, {
      controller,
      stallTimeoutMs,
      onProgress: (delta) => {
        received += delta;
        onProgress({ received, total, url });
      },
    })));
    await handle.sync().catch(() => {});
    await handle.close();
    handle = null;
    const stat = await fs.stat(temp);
    if (stat.size !== total) throw new Error('分片下载的文件大小不正确。');
    const digest = await hashFile(temp);
    if (expectedSha256 && digest !== expectedSha256) {
      throw new Error(`SHA-256 校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${digest.slice(0, 12)}…）。`);
    }
    await fs.rename(temp, target);
    return { bytes: total, sha256: digest, contentType: '', ranged: count };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
