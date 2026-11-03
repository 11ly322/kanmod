import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureDir, formatBytes, readJson, writeJsonAtomic } from './util/fsx.js';
import { fileNameFromUrl, safeFileName, safeJoin } from './util/paths.js';

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
  // frequently slow or unreachable on mainland networks. A public mirror is only
  // tried after the author link fails, and can be turned off in settings.
  if (settings.network?.githubMirror !== false) {
    for (const url of direct) {
      if (!/^https:\/\/github\.com\//i.test(url)) continue;
      push({
        url: `https://ghproxy.net/${url}`,
        kind: 'github-mirror',
        label: 'GitHub 镜像 · ghproxy.net',
        pageUrl: null,
      });
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

async function downloadToFile(url, target, options = {}) {
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
  const attempts = [];
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
    for (const item of resolved) {
      if (signal?.aborted) throw new Error('已取消。');
      if (item.kind !== 'demo' && !isAllowedUrl(item.url, settings)) {
        attempts.push({ url: item.url, label: item.label, error: '链接协议或 HTTP 设置不被允许' });
        continue;
      }
      const extension = extensionFor(item.url, item.contentType || '');
      const base = safeFileName(`${pkg.identifier}-${pkg.version}`, 'mod');
      const fileName = base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
      let target = path.join(destDir, fileName);
      let metaFile = `${target}.json`;
      onProgress({ phase: 'attempt', source: item.label, message: `尝试 ${item.label}` });
      try {
        if (item.kind !== 'demo') {
          const cached = await readJson(metaFile, null);
          if (cached) {
            const stat = await fs.stat(target).catch(() => null);
            const sameSize = stat && Number(cached.bytes) > 0 && stat.size === Number(cached.bytes);
            const sameHash = !expectedSha256 || (cached.sha256 && cached.sha256 === expectedSha256);
            if (sameSize && sameHash) {
              onProgress({ phase: 'complete', source: item.label, message: '复用已下载的安装包', total: stat.size, received: stat.size });
              return { path: target, bytes: stat.size, sha256: cached.sha256 || null, candidate: item, attempts, cached: true };
            }
          }
        }
        const progress = (progress) => onProgress({
          phase: 'download',
          source: item.label,
          url: item.url,
          received: progress.received,
          total: progress.total,
          message: `正在下载 ${pkg.name}：${progress.total ? `${Math.round((progress.received / progress.total) * 100)}%` : formatBytes(progress.received)}`,
        });
        const result = item.kind === 'demo'
          ? await copyDemoArchive(item.url, target, settings)
          : await downloadToFile(item.url, target, {
            timeoutMs,
            stallTimeoutMs,
            maxBytes,
            expectedSha256,
            signal,
            onProgress: progress,
          });
        if (item.kind !== 'demo') {
          if (target.toLowerCase().endsWith('.archive')) {
            const sniffed = await sniffArchiveExtension(target);
            if (sniffed === '.zip' || sniffed === '.tar.gz') {
              const renamed = `${target.slice(0, -'.archive'.length)}${sniffed}`;
              await fs.rename(target, renamed).catch(() => {});
              if (await fs.stat(renamed).catch(() => null)) {
                target = renamed;
                metaFile = `${target}.json`;
              }
            }
          }
          await writeJsonAtomic(metaFile, {
            url: item.url,
            label: item.label,
            bytes: result.bytes,
            sha256: result.sha256,
            downloadedAt: new Date().toISOString(),
            identifier: pkg.identifier,
            version: pkg.version,
          });
        }
        onProgress({ phase: 'complete', source: item.label, message: `下载完成：${formatBytes(result.bytes)}`, received: result.bytes, total: result.bytes });
        return { path: target, bytes: result.bytes, sha256: result.sha256, candidate: item, attempts };
      } catch (error) {
        attempts.push({ url: item.url, label: item.label, error: error.message });
        await fs.rm(target, { force: true }).catch(() => {});
        await fs.rm(metaFile, { force: true }).catch(() => {});
        onProgress({ phase: 'fallback', source: item.label, message: `${item.label} 失败：${error.message}` });
        if (signal?.aborted) throw new Error('已取消。');
      }
    }
  }
  const summary = attempts.map((attempt) => `${attempt.label}: ${attempt.error}`).join('；');
  throw Object.assign(new Error(`所有下载源都失败了${summary ? `：${summary}` : '。'}`), {
    code: 'DOWNLOAD_FAILED',
    attempts,
  });
}
