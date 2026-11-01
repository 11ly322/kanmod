const IMAGE_HOSTS = new Set([
  'spacedock.info',
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
  'cloud.githubusercontent.com',
  'i.imgur.com',
  'media.forgecdn.net',
  'edge.forgecdn.net',
  'static.forgecdn.net',
]);

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i;

export function isAllowedImageUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  if (!IMAGE_HOSTS.has(url.hostname.toLowerCase())) return false;
  if (!IMAGE_EXT.test(url.pathname)) return false;
  return true;
}

export function normalizeImageUrl(value, base) {
  try {
    const url = new URL(String(value), base);
    url.hash = '';
    return isAllowedImageUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

function pushImage(list, seen, value, base) {
  const url = normalizeImageUrl(value, base);
  if (!url || seen.has(url)) return;
  seen.add(url);
  list.push(url);
}

export function extractImageUrls(text, base, limit = 6) {
  const list = [];
  const seen = new Set();
  const source = String(text || '');
  const patterns = [
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
    /\[img\](?:\[[^\]]*\])?([^\[]+?)\[\/img\]/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) && list.length < limit) {
      pushImage(list, seen, match[1], base);
    }
  }
  return list;
}

function parseGithubRepo(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  } catch {
    return null;
  }
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function fetchText(url, fetchImpl, timeoutMs, headers = {}) {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'kanmod/0.1.0', ...headers },
    signal: timeoutSignal(timeoutMs),
  });
  if (!response.ok) return null;
  const text = await response.text();
  return text.length > 2 * 1024 * 1024 ? text.slice(0, 2 * 1024 * 1024) : text;
}

async function fetchJson(url, fetchImpl, timeoutMs) {
  const text = await fetchText(url, fetchImpl, timeoutMs, { accept: 'application/json' });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function searchModImages(pkg, { fetchImpl = fetch, timeoutMs = 9000, maxImages = 8 } = {}) {
  const images = [];
  const seen = new Set();
  const sources = [];
  const resources = pkg?.resources || {};

  // SpaceDock exposes a single wide background image through its public API.
  if (resources.spacedock) {
    try {
      const modUrl = new URL(String(resources.spacedock));
      const id = modUrl.pathname.match(/\/mod\/(\d+)/i)?.[1];
      if (id) {
        const data = await fetchJson(`https://spacedock.info/api/mod/${id}`, fetchImpl, timeoutMs);
        if (data?.background) {
          pushImage(images, seen, data.background, 'https://spacedock.info/');
          if (images.length) sources.push('SpaceDock');
        }
        if (Array.isArray(data?.versions)) {
          for (const version of data.versions.slice(0, 2)) {
            if (version?.background) pushImage(images, seen, version.background, 'https://spacedock.info/');
          }
        }
      }
    } catch {
      // A dead SpaceDock link should not block the remaining sources.
    }
  }

  if (images.length < maxImages) {
    const fromDescription = extractImageUrls(
      pkg?.description,
      resources.spacedock || resources.homepage || 'https://spacedock.info/',
      maxImages - images.length,
    );
    if (fromDescription.length) {
      for (const url of fromDescription) {
        if (images.length >= maxImages) break;
        if (!seen.has(url)) { seen.add(url); images.push(url); }
      }
      sources.push('模组说明');
    }
  }

  const repo = parseGithubRepo(resources.repository || resources.github);
  if (repo && images.length < maxImages) {
    const base = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/`;
    try {
      const readme = await fetchText(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`,
        fetchImpl,
        timeoutMs,
        { accept: 'application/vnd.github.raw' },
      );
      if (readme) {
        const found = extractImageUrls(readme, base, Math.min(6, maxImages - images.length));
        if (found.length) {
          for (const url of found) {
            if (images.length >= maxImages) break;
            if (!seen.has(url)) { seen.add(url); images.push(url); }
          }
          sources.push('GitHub README');
        }
      }
    } catch {
      // Ignore rate limits and private repositories.
    }

    if (images.length < maxImages) {
      try {
        const data = await fetchJson(
          `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents`,
          fetchImpl,
          timeoutMs,
        );
        if (Array.isArray(data)) {
          const files = data.filter((item) => item?.type === 'file'
            && /\.(png|jpe?g|webp|gif)$/i.test(item.name || '')
            && item.download_url);
          for (const file of files.slice(0, maxImages - images.length)) {
            if (!seen.has(file.download_url) && isAllowedImageUrl(file.download_url)) {
              seen.add(file.download_url);
              images.push(file.download_url);
            }
          }
          if (files.length) sources.push('GitHub 仓库');
        }
      } catch {
        // Optional enrichment only.
      }
    }
  }

  return {
    images: images.slice(0, maxImages).map((url) => ({ url })),
    sources: [...new Set(sources)],
  };
}

export async function fetchImageBuffer(url, {
  fetchImpl = fetch,
  timeoutMs = 20000,
  maxBytes = 8 * 1024 * 1024,
} = {}) {
  if (!isAllowedImageUrl(url)) {
    const error = new Error('图片地址不在允许的公开图源内。');
    error.code = 'IMAGE_URL_NOT_ALLOWED';
    throw error;
  }
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'kanmod/0.1.0', accept: 'image/png,image/jpeg,image/webp,image/gif' },
    signal: timeoutSignal(timeoutMs),
  });
  if (!response.ok) {
    const error = new Error(`图片下载失败（HTTP ${response.status}）。`);
    error.code = 'IMAGE_FETCH_FAILED';
    throw error;
  }
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!RASTER_TYPES.has(contentType)) {
    const error = new Error('图源返回的不是受支持的图片格式。');
    error.code = 'IMAGE_TYPE_NOT_ALLOWED';
    throw error;
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    const error = new Error('图片文件过大。');
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    const error = new Error('图片文件过大。');
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  return { buffer, contentType };
}
