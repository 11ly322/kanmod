import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureDir, formatBytes, readJson, writeJsonAtomic } from './util/fsx.js';
import { fileNameFromUrl, safeFileName, safeJoin } from './util/paths.js';
import { downloadRangedToFile } from './downloadRanges.js';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extensionFor(url, contentType = '') {
  const name = (() => {
    if (String(url).startsWith('kanmod-demo://')) {
      return decodeURIComponent(String(url).slice('kanmod-demo://'.length)).toLowerCase();
    }
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (name.endsWith('.tar.gz')) return '.tar.gz';
  if (name.endsWith('.zip')) return '.zip';
  if (name.endsWith('.json')) return '.json';
  if (contentType.includes('zip')) return '.zip';
  if (contentType.includes('gzip') || contentType.includes('tar')) return '.tar.gz';
  return '.archive';
}

// 有些发布链接（例如 GitHub Release 资产）在 URL 和 Content-Type 里都看不出格式，
// 下载后按文件头纠正扩展名，避免安装阶段把 zip 当成未知格式。
async function sniffArchiveExtension(filePath) {
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    const head = buffer.subarray(0, bytesRead);
    const startsWith = (bytes) => bytes.every((byte, index) => head[index] === byte);
    if (startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06])) return '.zip';
    if (startsWith([0x1f, 0x8b])) return '.tar.gz';
    if (startsWith([0x37, 0x7a, 0xbc, 0xaf])) return '.7z';
    if (startsWith([0x52, 0x61, 0x72, 0x21])) return '.rar';
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

function downloadUrls(value) {
  if (Array.isArray(value)) return value.filter((url) => typeof url === 'string' && url.trim());
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function githubRepo(pkg) {
  const urls = [pkg.resources?.repository, pkg.resources?.github].filter(Boolean);
  for (const value of urls) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== 'github.com') continue;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
    } catch {
      // Ignore malformed resource URLs.
    }
  }
  return null;
}

function spacedockId(pkg) {
  const value = pkg.resources?.spacedock;
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.toLowerCase().endsWith('spacedock.info')) return null;
    const match = parsed.pathname.match(/\/mod\/(\d+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function fetchJson(url, { timeoutMs = 20_000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('请求超时。')), timeoutMs);
  const onAbort = () => controller.abort(new Error('已取消。'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'kanmod/1.0 (KSP mod manager; local)',
        Accept: 'application/vnd.github+json, application/json',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function versionTokens(version) {
  return String(version || '')
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
}

function matchesVersion(name, version) {
  const normalizedName = String(name || '').toLowerCase();
  const tokens = versionTokens(version);
  if (!tokens.length) return true;
  return tokens.every((token) => normalizedName.includes(token)) || normalizedName.includes(String(version).toLowerCase());
}

async function resolveGithubAssets(pkg, settings) {
  const repo = githubRepo(pkg);
  if (!repo) return [];
  const releases = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=30`, {
    timeoutMs: Math.min(30_000, (settings.network?.timeoutSeconds || 45) * 1000),
  });
  if (!Array.isArray(releases)) return [];
  const scored = [];
  for (const release of releases) {
    if (!release || !Array.isArray(release.assets)) continue;
    const haystack = `${release.tag_name || ''} ${release.name || ''}`;
    for (const asset of release.assets) {
      const name = String(asset.name || '');
      if (!/\.(zip|tar\.gz)$/i.test(name)) continue;
      if (asset.state && asset.state !== 'uploaded') continue;
      let score = 0;
      if (matchesVersion(name, pkg.version) || matchesVersion(haystack, pkg.version)) score += 4;
      if (/\.zip$/i.test(name)) score += 2;
      if (/win|windows|ksp/i.test(name)) score += 1;
      if (/source|src|symbols?/i.test(name)) score -= 3;
      scored.push({
        score,
        url: asset.browser_download_url,
        label: `GitHub Releases · ${release.tag_name || release.name} · ${name}`,
        version: release.tag_name,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((entry) => ({
    url: entry.url,
    label: entry.label,
    kind: 'github',
    pageUrl: pkg.resources?.repository || pkg.resources?.github || null,
  }));
}

async function resolveSpacedock(pkg, settings) {
  const id = spacedockId(pkg);
  if (!id) return [];
  const data = await fetchJson(`https://spacedock.info/api/mod/${id}`, {
    timeoutMs: Math.min(30_000, (settings.network?.timeoutSeconds || 45) * 1000),
  });
  const versions = Array.isArray(data?.versions) ? data.versions : [];
  const sorted = versions.slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  const matching = sorted.filter((version) => matchesVersion(version.friendly_version, pkg.version));
  const choices = matching.length ? matching : sorted.slice(0, 1);
  return choices.map((version) => {
    const downloadPath = version.download_path || version.download;
    if (!downloadPath) return null;
    let url;
    try {
      url = new URL(downloadPath, 'https://spacedock.info').toString();
    } catch {
      return null;
    }
    return {
      url,
      label: `SpaceDock · ${version.friendly_version || pkg.version}`,
      kind: 'spacedock',
      pageUrl: pkg.resources?.spacedock,
    };
  }).filter(Boolean);
}

function applyMirror(prefix, url) {
  if (prefix.includes('{url}')) return prefix.replaceAll('{url}', encodeURIComponent(url));
  return `${prefix.replace(/\/+$/, '')}/${url}`;
}

export function buildDownloadCandidates(pkg, settings = {}) {
  const candidates = [];
  const seen = new Set();
  const push = (candidate) => {
    if (!candidate?.url || seen.has(candidate.url)) return;
    seen.add(candidate.url);
    candidates.push(candidate);
  };
  const direct = downloadUrls(pkg.download);
  for (const url of direct) {
    if (url.startsWith('kanmod-demo://')) {
      push({
        url,
        kind: 'demo',
        label: '本地演示包',
        pageUrl: null,
      });
      continue;
    }
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // Keep the raw URL; download will report the error.
    }
    push({
      url,
      kind: 'direct',
      label: host ? `作者直链 · ${host}` : '作者直链',
      pageUrl: pkg.resources?.homepage || pkg.resources?.repository || null,
    });
  }

  for (const prefix of settings.network?.mirrorPrefixes || []) {
    for (const url of direct) {
      push({
        url: applyMirror(prefix, url),
        kind: 'mirror',
        label: `下载镜像 · ${new URL(prefix, 'https://local.invalid').hostname || '自定义前缀'}`,
        pageUrl: null,
      });
    }
  }

  // GitHub Release downloads redirect to objects.githubusercontent.com, which is
  // frequently slow or unreachable on mainland networks. Public mirrors are only
  // tried after the author link fails, and can be turned off in settings.
  if (settings.network?.githubMirror !== false) {
    const mirrors = [
      { prefix: 'https://ghproxy.net/', label: 'GitHub 镜像 · ghproxy.net' },
      { prefix: 'https://gh-proxy.com/', label: 'GitHub 镜像 · gh-proxy.com' },
      { prefix: 'https://ghfast.top/', label: 'GitHub 镜像 · ghfast.top' },
    ];
    for (const url of direct) {
      if (!/^https:\/\/github\.com\//i.test(url)) continue;
      for (const mirror of mirrors) {
        push({
          url: `${mirror.prefix}${url}`,
          kind: 'github-mirror',
          label: mirror.label,
          pageUrl: null,
        });
      }
    }
  }

  if (githubRepo(pkg)) {
    push({
      url: `github://${githubRepo(pkg).owner}/${githubRepo(pkg).repo}@${pkg.version}`,
      kind: 'github-resolver',
      label: 'GitHub Releases 备用源',
      pageUrl: pkg.resources?.repository || pkg.resources?.github,
      resolve: () => resolveGithubAssets(pkg, settings),
    });
  }
  if (spacedockId(pkg)) {
    push({
      url: `spacedock://${spacedockId(pkg)}@${pkg.version}`,
      kind: 'spacedock-resolver',
      label: 'SpaceDock 备用源',
      pageUrl: pkg.resources?.spacedock,
      resolve: () => resolveSpacedock(pkg, settings),
    });
  }
  return candidates;
}

function isAllowedUrl(url, settings) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.protocol === 'http:' && !settings.network?.allowInsecureHttp) return false;
    return true;
  } catch {
    return false;
  }
}

async function downloadSingleToFile(url, target, options = {}) {
  const {
    timeoutMs = 180_000,
    stallTimeoutMs = 20_000,
    maxBytes = 2 * 1024 * 1024 * 1024,
    expectedSha256 = null,
    onProgress = () => {},
    signal,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('下载超时。')), timeoutMs);
  let stallTimer = null;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new Error(`下载停滞超过 ${Math.round(stallTimeoutMs / 1000)} 秒，已切换下载源。`)), stallTimeoutMs);
  };
  const onAbort = () => controller.abort(new Error('已取消。'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const temp = `${target}.${process.pid}.${Date.now()}.part`;
  await ensureDir(path.dirname(target));
  let handle;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'kanmod/1.0 (KSP mod manager; local)',
        Accept: 'application/zip, application/gzip, application/octet-stream, */*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) throw new Error('服务器返回了网页而不是模组压缩包。');
    const total = Number(response.headers.get('content-length')) || 0;
    if (total && total > maxBytes) throw new Error(`文件超过大小限制（${formatBytes(total)}）。`);
    if (!response.body) throw new Error('服务器没有返回内容。');
    const reader = response.body.getReader();
    const hash = crypto.createHash('sha256');
    let received = 0;
    handle = await fs.open(temp, 'w');
    armStall();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall();
      received += value.byteLength;
      if (received > maxBytes) {
        controller.abort(new Error('文件超过大小限制。'));
        throw new Error('文件超过大小限制。');
      }
      hash.update(value);
      await handle.write(value);
      onProgress({ received, total, url });
    }
    clearTimeout(stallTimer);
    stallTimer = null;
    await handle.close();
    handle = null;
    if (!received) throw new Error('下载内容为空。');
    const digest = hash.digest('hex');
    if (expectedSha256 && digest !== expectedSha256) {
      throw new Error(`SHA-256 校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${digest.slice(0, 12)}…）。`);
    }
    await fs.rename(temp, target);
    return { bytes: received, sha256: digest, contentType };
  } finally {
    clearTimeout(timer);
    clearTimeout(stallTimer);
    signal?.removeEventListener('abort', onAbort);
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

async function downloadToFile(url, target, options = {}) {
  const chunks = Math.max(1, Math.min(8, Number(options.rangeChunks) || 1));
  if (chunks > 1) {
    try {
      const ranged = await downloadRangedToFile(url, target, {
        chunks,
        timeoutMs: options.timeoutMs,
        stallTimeoutMs: options.stallTimeoutMs,
        maxBytes: options.maxBytes,
        expectedSha256: options.expectedSha256,
        onProgress: options.onProgress,
        signal: options.signal,
      });
      if (ranged) return ranged;
    } catch (error) {
      // A cancelled job must stay cancelled; otherwise fall back to one stream.
      if (options.signal?.aborted) throw error;
      options.onProgress?.({ received: 0, total: 0, message: `分片下载不可用，改用单连接：${error.message}` });
    }
  }
  return downloadSingleToFile(url, target, options);
}

/** Runs `worker` over items with a bounded number of concurrent calls. */
export async function mapLimit(items, limit, worker) {
  const list = Array.from(items);
  const size = Math.max(1, Math.min(list.length || 1, Number(limit) || 1));
  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function copyDemoArchive(url, target, settings) {
  const name = decodeURIComponent(String(url).replace(/^kanmod-demo:\/\//, ''));
  const dir = settings.demoArchivesDir;
  if (!dir) throw new Error('演示下载目录不可用。');
  const source = safeJoin(dir, ...name.split('/'));
  await fs.copyFile(source, target);
  const stat = await fs.stat(target);
  return { bytes: stat.size, sha256: null, contentType: 'application/zip' };
}

/**
 * Downloads a package into destDir, trying the author URL, mirrors, GitHub
 * Releases and SpaceDock. Every failure is collected so the UI can explain
 * exactly what was attempted.
 */
export async function downloadPackage(pkg, options = {}) {
  const {
    destDir,
    settings = {},
    onProgress = () => {},
    signal,
    maxBytes = (settings.network?.maxDownloadMB || 2048) * 1024 * 1024,
    timeoutMs = (settings.network?.downloadTimeoutSeconds || 180) * 1000,
    stallTimeoutMs = (settings.network?.stallTimeoutSeconds || 20) * 1000,
  } = options;
  await ensureDir(destDir);
  const candidates = buildDownloadCandidates(pkg, settings);
  if (!candidates.length) {
    throw Object.assign(new Error('该模组没有可用的下载链接。'), { code: 'NO_DOWNLOAD_URL' });
  }
  const expectedSha256 = pkg.downloadHash?.sha256 ? String(pkg.downloadHash.sha256).toLowerCase() : null;
  const parallelSources = Math.max(1, Math.min(4, Number(settings.network?.parallelSources) || 2));
  const rangeChunks = Math.max(1, Math.min(8, Number(settings.network?.rangeChunks) || 1));
  const attempts = [];

  const fileTarget = (item) => {
    const extension = extensionFor(item.url, item.contentType || '');
    const base = safeFileName(`${pkg.identifier}-${pkg.version}`, 'mod');
    const fileName = base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
    return { target: path.join(destDir, fileName), metaFile: path.join(destDir, `${fileName}.json`) };
  };

  const sniffedTarget = async (item, current) => {
    if (!current.target.toLowerCase().endsWith('.archive')) return current;
    const sniffed = await sniffArchiveExtension(current.target);
    if (sniffed !== '.zip' && sniffed !== '.tar.gz') return current;
    const renamed = `${current.target.slice(0, -'.archive'.length)}${sniffed}`;
    await fs.rename(current.target, renamed).catch(() => {});
    const stat = await fs.stat(renamed).catch(() => null);
    if (!stat) return current;
    return { target: renamed, metaFile: `${renamed}.json` };
  };

  const attemptItem = async (item, attemptSignal = null) => {
    if (item.kind !== 'demo' && !isAllowedUrl(item.url, settings)) {
      throw new Error('链接协议或 HTTP 设置不被允许');
    }
    const current = fileTarget(item);
    onProgress({ phase: 'attempt', source: item.label, message: `尝试 ${item.label}` });
    if (item.kind === 'demo') {
      const result = await copyDemoArchive(item.url, current.target, settings);
      return { ...current, item, result };
    }
    const temp = `${current.target}.race-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const attemptSignalCombined = attemptSignal
      ? (signal ? AbortSignal.any([signal, attemptSignal]) : attemptSignal)
      : signal;
    try {
      const result = await downloadToFile(item.url, temp, {
        timeoutMs,
        stallTimeoutMs,
        maxBytes,
        expectedSha256,
        rangeChunks,
        signal: attemptSignalCombined,
        onProgress: (progress) => onProgress({
          phase: 'download',
          source: item.label,
          url: item.url,
          received: progress.received,
          total: progress.total,
          message: progress.message?.startsWith?.('分片')
            ? `${item.label}：${progress.message}`
            : `正在下载 ${pkg.name}：${progress.total ? `${Math.round((progress.received / progress.total) * 100)}%` : formatBytes(progress.received)}`,
        }),
      });
      return { item, temp, result };
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  };

  // Windows occasionally reports EPERM when a freshly written file is still
  // being released by the file system, so retry the swap a few times.
  const moveTemp = async (source, target) => {
    let last = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await fs.rename(source, target);
        return;
      } catch (error) {
        last = error;
        if (error.code !== 'EPERM' && error.code !== 'EBUSY' && error.code !== 'EACCES') break;
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
      }
    }
    throw last;
  };

  const finalize = async (winner) => {
    let current = winner.item.kind === 'demo'
      ? { target: winner.target, metaFile: winner.metaFile }
      : { target: '', metaFile: '' };
    if (winner.item.kind !== 'demo') {
      const { target } = fileTarget(winner.item);
      await fs.rm(target, { force: true }).catch(() => {});
      await moveTemp(winner.temp, target);
      current = { target, metaFile: `${target}.json` };
      current = await sniffedTarget(winner.item, current);
      await writeJsonAtomic(current.metaFile, {
        url: winner.item.url,
        label: winner.item.label,
        bytes: winner.result.bytes,
        sha256: winner.result.sha256,
        downloadedAt: new Date().toISOString(),
        identifier: pkg.identifier,
        version: pkg.version,
      });
    }
    const bytes = winner.item.kind === 'demo' ? winner.result.bytes : winner.result.bytes;
    onProgress({ phase: 'complete', source: winner.item.label, message: `下载完成：${formatBytes(bytes)}`, received: bytes, total: bytes });
    return {
      path: current.target,
      bytes,
      sha256: winner.result.sha256 || null,
      candidate: winner.item,
      attempts,
    };
  };

  // Resolve metadata-style candidates (GitHub Releases, SpaceDock) once so the
  // resulting direct URLs can be raced against the author link.
  const items = [];
  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('已取消。');
    let resolved = [candidate];
    if (typeof candidate.resolve === 'function') {
      try {
        resolved = await candidate.resolve();
      } catch (error) {
        attempts.push({ url: candidate.url, label: candidate.label, error: error.message });
        onProgress({ phase: 'fallback', source: candidate.label, message: `${candidate.label} 失败：${error.message}` });
        continue;
      }
      if (!resolved.length) {
        attempts.push({ url: candidate.url, label: candidate.label, error: '没有找到可下载的发布文件' });
        continue;
      }
    }
    items.push(...resolved);
  }
  if (!items.length) {
    const summary = attempts.map((attempt) => `${attempt.label}: ${attempt.error}`).join('；');
    throw Object.assign(new Error(`所有下载源都失败了${summary ? `：${summary}` : '。'}`), {
      code: 'DOWNLOAD_FAILED',
      attempts,
    });
  }

  const demoItem = items.find((item) => item.kind === 'demo');
  if (demoItem) return finalize(await attemptItem(demoItem));

  const networkItems = items.filter((item) => item.kind !== 'demo');

  // Reuse an earlier download when the cached archive matches the package.
  if (networkItems.length) {
    const first = fileTarget(networkItems[0]);
    const cached = await readJson(first.metaFile, null);
    if (cached) {
      const stat = await fs.stat(first.target).catch(() => null);
      const sameSize = stat && Number(cached.bytes) > 0 && stat.size === Number(cached.bytes);
      const sameHash = !expectedSha256 || (cached.sha256 && cached.sha256 === expectedSha256);
      if (sameSize && sameHash) {
        onProgress({ phase: 'complete', source: '缓存', message: '复用已下载的安装包', total: stat.size, received: stat.size });
        return { path: first.target, bytes: stat.size, sha256: cached.sha256 || null, candidate: networkItems[0], attempts, cached: true };
      }
    }
  }

  if (parallelSources > 1 && networkItems.length > 1) {
    for (let index = 0; index < networkItems.length; index += parallelSources) {
      if (signal?.aborted) throw new Error('已取消。');
      const wave = networkItems.slice(index, index + parallelSources);
      const tasks = wave.map((item) => {
        const controller = new AbortController();
        const task = { item, controller, temp: null };
        task.promise = attemptItem(item, controller.signal).then((value) => {
          task.temp = value.temp || value.target;
          return value;
        });
        return task;
      });
      let winner = null;
      try {
        winner = await new Promise((resolve, reject) => {
          let pending = tasks.length;
          let settled = false;
          for (const task of tasks) {
            task.promise.then((value) => {
              if (settled) {
                // A slower source finished after the winner: discard its copy.
                task.controller.abort();
                if (task.temp) fs.rm(task.temp, { force: true }).catch(() => {});
                return;
              }
              settled = true;
              for (const other of tasks) if (other !== task) other.controller.abort();
              resolve(value);
            }).catch((error) => {
              pending -= 1;
              attempts.push({ url: task.item.url, label: task.item.label, error: error.message });
              onProgress({ phase: 'fallback', source: task.item.label, message: `${task.item.label} 失败：${error.message}` });
              if (!settled && pending === 0) reject(error);
            });
          }
        });
      } catch {
        // Whole wave failed; try the next set of sources.
        continue;
      }
      return finalize(winner);
    }
  } else {
    for (const item of networkItems) {
      if (signal?.aborted) throw new Error('已取消。');
      try {
        return finalize(await attemptItem(item));
      } catch (error) {
        attempts.push({ url: item.url, label: item.label, error: error.message });
        onProgress({ phase: 'fallback', source: item.label, message: `${item.label} 失败：${error.message}` });
      }
    }
  }

  const summary = attempts.map((attempt) => `${attempt.label}: ${attempt.error}`).join('；');
  throw Object.assign(new Error(`所有下载源都失败了${summary ? `：${summary}` : '。'}`), {
    code: 'DOWNLOAD_FAILED',
    attempts,
  });
}
