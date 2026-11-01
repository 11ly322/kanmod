import { cleanSourceText } from './translate.js';
import { parseKspVersion } from './util/version.js';

export const CURSEFORGE_GAME_ID = 4401;
export const CURSEFORGE_API = 'https://api.curseforge.com/v1';

export class CurseForgeError extends Error {
  constructor(message, code = 'CURSEFORGE_ERROR', details = null) {
    super(message);
    this.name = 'CurseForgeError';
    this.code = code;
    this.details = details;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function curseforgeConfigured(config = {}) {
  return Boolean(String(config.curseforgeApiKey || '').trim());
}

export async function curseforgeRequest(pathname, { apiKey, query = {}, fetchImpl = fetch, timeoutMs = 15000, raw = false } = {}) {
  if (!apiKey) {
    throw new CurseForgeError('尚未配置 CurseForge API Key，请在设置中填写。', 'CURSEFORGE_KEY_MISSING');
  }
  const url = new URL(`${CURSEFORGE_API}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
        'User-Agent': 'kanmod/0.1.5',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new CurseForgeError(`连接 CurseForge 失败：${error.message}`, 'CURSEFORGE_NETWORK');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || `CurseForge 返回 HTTP ${response.status}`;
    throw new CurseForgeError(message, 'CURSEFORGE_HTTP', { status: response.status });
  }
  return raw ? body : body?.data;
}

function fileVersionLabel(file) {
  return String(file?.displayName || file?.fileName || '').replace(/\.(zip|7z|rar)$/i, '') || '未知版本';
}

function fileGameVersions(file) {
  return asArray(file?.gameVersions).map(String);
}

export function pickCurseForgeFile(mod, kspVersion = null) {
  const files = asArray(mod?.latestFiles).filter((file) => file && file.id);
  if (!files.length) return null;
  const target = parseKspVersion(kspVersion);
  const targetBase = target.valid ? target.numbers.slice(0, 2).join('.') : null;
  const score = (file) => {
    const versions = fileGameVersions(file);
    const exact = kspVersion && versions.includes(String(kspVersion)) ? 4 : 0;
    const minor = targetBase && versions.some((version) => version === targetBase || version.startsWith(`${targetBase}.`)) ? 2 : 0;
    const stable = Number(file.releaseType) === 1 ? 2 : 0;
    return exact + minor + stable;
  };
  return [...files].sort((left, right) => (
    score(right) - score(left)
    || new Date(right.fileDate || 0) - new Date(left.fileDate || 0)
  ))[0];
}

function compatibilityFor(file, kspVersion) {
  const versions = fileGameVersions(file);
  const exact = kspVersion && versions.includes(String(kspVersion));
  const base = parseKspVersion(kspVersion);
  const minor = base.valid ? `${base.numbers[0]}.${base.numbers[1]}` : null;
  const minorMatch = minor && versions.some((version) => version === minor || version.startsWith(`${minor}.`));
  const declared = versions.find((version) => /^1\.\d+/.test(version)) || null;
  if (exact || minorMatch) {
    return { status: 'compatible', label: '兼容', reason: `CurseForge 标注支持 KSP ${exact ? kspVersion : minor}。`, targetVersion: kspVersion || null };
  }
  if (declared) {
    return { status: 'warning', label: '可能兼容', reason: `CurseForge 标注的最新适配版本为 ${declared}。`, targetVersion: kspVersion || null };
  }
  return { status: 'unknown', label: '版本未标注', reason: 'CurseForge 文件没有声明 KSP 版本。', targetVersion: kspVersion || null };
}

export function mapCurseForgeMod(mod, { kspVersion = null } = {}) {
  const file = pickCurseForgeFile(mod, kspVersion);
  const categories = asArray(mod?.categories);
  const authors = asArray(mod?.authors);
  const logo = mod?.logo?.thumbnailUrl || mod?.logo?.url || null;
  const version = file ? fileVersionLabel(file) : '未知版本';
  return {
    identifier: `curseforge-${mod.id}`,
    curseforgeId: String(mod.id),
    source: 'curseforge',
    name: String(mod.name || `CurseForge ${mod.id}`),
    slug: mod.slug || '',
    abstract: cleanSourceText(mod.summary || '这个 CurseForge 项目没有摘要。'),
    author: authors[0]?.name || mod?.author || '未注明',
    version,
    kspVersion: fileGameVersions(file).find((item) => /^1\.\d+/.test(item)) || null,
    downloadSize: Number(file?.fileLength) || null,
    downloadCount: Number(mod.downloadCount) || 0,
    dateModified: mod.dateModified || null,
    releaseStatus: Number(file?.releaseType) === 1 ? 'stable' : 'testing',
    tags: categories.map((category) => String(category.name || category.slug || '')).filter(Boolean),
    categoryIds: categories.map((category) => category.id).filter(Boolean),
    kind: 'mod',
    license: '见项目页',
    download: file?.downloadUrl || null,
    resources: {
      homepage: mod.links?.websiteUrl || `https://www.curseforge.com/kerbal-space-program/${mod.slug || ''}`,
    },
    compatibility: compatibilityFor(file, kspVersion),
    curseforge: {
      id: String(mod.id),
      slug: mod.slug || '',
      url: mod.links?.websiteUrl || `https://www.curseforge.com/kerbal-space-program/${mod.slug || ''}`,
      fileId: file?.id || null,
      fileName: file?.fileName || null,
      fileDate: file?.fileDate || null,
      logo,
    },
  };
}

export function mapCurseForgeDetail(mod, { kspVersion, description, screenshots }) {
  const base = mapCurseForgeMod(mod, { kspVersion });
  const files = asArray(mod?.latestFiles)
    .filter((file) => file?.id)
    .sort((left, right) => new Date(right.fileDate || 0) - new Date(left.fileDate || 0));
  const seen = new Set();
  const versions = files.map((file) => {
    const version = fileVersionLabel(file);
    const key = `${version}:${file.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      version,
      compatibility: compatibilityFor(file, kspVersion),
      kspVersion: fileGameVersions(file).find((item) => /^1\.\d+/.test(item)) || null,
      downloadSize: Number(file.fileLength) || null,
      releaseStatus: Number(file.releaseType) === 1 ? 'stable' : 'testing',
      fileId: file.id,
    };
  }).filter(Boolean).slice(0, 30);
  const gallery = [];
  const pushImage = (url, title) => {
    if (!url || !/^https:\/\//i.test(url)) return;
    if (gallery.some((image) => image.url === url)) return;
    gallery.push({ url, title: title || '', proxyUrl: `/api/image?url=${encodeURIComponent(url)}` });
  };
  pushImage(base.curseforge.logo, '项目图标');
  for (const shot of asArray(screenshots)) pushImage(shot.url || shot.thumbnailUrl, shot.title || '');
  return {
    source: 'curseforge',
    package: {
      ...base,
      description: cleanSourceText(description || ''),
    },
    versions,
    relationships: { depends: [], recommends: [], suggests: [], supports: [], conflicts: [], dependents: [], dependentCount: 0, provides: [] },
    installed: null,
    compatibility: base.compatibility,
    images: gallery.slice(0, 10),
  };
}

export async function searchCurseForge({ apiKey, query, page = 1, pageSize = 24, sort, kspVersion = null, fetchImpl = fetch, timeoutMs = 15000 }) {
  const index = (Math.max(1, page) - 1) * pageSize;
  const sortMap = {
    popularity: { sortField: 2, sortOrder: 'desc' },
    updated: { sortField: 3, sortOrder: 'desc' },
    name: { sortField: 4, sortOrder: 'asc' },
    downloads: { sortField: 6, sortOrder: 'desc' },
  };
  const sortValue = sortMap[sort] || sortMap.popularity;
  const body = await curseforgeRequest('/mods/search', {
    apiKey,
    fetchImpl,
    timeoutMs,
    raw: true,
    query: {
      gameId: CURSEFORGE_GAME_ID,
      searchFilter: query || undefined,
      index,
      pageSize: Math.min(50, Math.max(1, pageSize)),
      ...sortValue,
    },
  });
  const items = asArray(body?.data).map((mod) => mapCurseForgeMod(mod, { kspVersion }));
  const total = Number(body?.pagination?.totalCount);
  return { items, total: Number.isFinite(total) ? total : index + items.length };
}
