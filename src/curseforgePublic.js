// 免 API Key 的 CurseForge 访问层
//
// 官方 API 必须提供 Key，网页搜索又被 Cloudflare 拦截，因此这里使用公开的
// cfwidget 中转（项目详情按数字 ID 或 KSP slug 查询）配合 ForgeCDN 直链下载。
// 受限之处：没有关键词搜索，只能按项目链接 / slug / ID 精确查询。

const WIDGET_HOST = 'https://api.cfwidget.com';
const CDN_HOST = 'https://mediafilez.forgecdn.net';
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,80}$/i;

export class PublicCurseForgeError extends Error {
  constructor(message, code = 'CURSEFORGE_PUBLIC_ERROR', details = null) {
    super(message);
    this.name = 'PublicCurseForgeError';
    this.code = code;
    this.status = code === 'CURSEFORGE_PUBLIC_NOT_FOUND' ? 404 : 502;
    this.details = details;
  }
}

export function parseProjectRef(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new PublicCurseForgeError('请输入 CurseForge 项目链接、slug 或数字 ID。', 'CURSEFORGE_REF_EMPTY', { status: 400 });
  if (/^\d{1,10}$/.test(raw)) return { kind: 'id', id: Number(raw), slug: null, url: null };
  let url = null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      url = new URL(raw);
    } catch {
      throw new PublicCurseForgeError('这个 CurseForge 链接无法解析。', 'CURSEFORGE_REF_INVALID', { status: 400 });
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'curseforge.com' && host !== 'www.curseforge.com') {
      throw new PublicCurseForgeError('只支持 curseforge.com 的项目链接。', 'CURSEFORGE_REF_INVALID', { status: 400 });
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const gameIndex = parts.findIndex((part) => part === 'kerbal' || part === 'kerbal-space-program');
    const slug = gameIndex >= 0 && parts[gameIndex + 1] === 'ksp-mods'
      ? parts[gameIndex + 2]
      : gameIndex >= 0 ? parts[gameIndex + 1] : null;
    if (!slug || !SLUG_RE.test(slug)) {
      throw new PublicCurseForgeError('链接里没有找到 KSP 项目 slug。请使用形如 https://www.curseforge.com/kerbal/ksp-mods/<slug> 的链接。', 'CURSEFORGE_REF_INVALID', { status: 400 });
    }
    return { kind: 'slug', id: null, slug: slug.toLowerCase(), url: `https://www.curseforge.com/kerbal/ksp-mods/${slug.toLowerCase()}` };
  }
  if (!SLUG_RE.test(raw)) {
    throw new PublicCurseForgeError('这不是有效的 CurseForge 项目 slug。', 'CURSEFORGE_REF_INVALID', { status: 400 });
  }
  return { kind: 'slug', id: null, slug: raw.toLowerCase(), url: `https://www.curseforge.com/kerbal/ksp-mods/${raw.toLowerCase()}` };
}

function fileRef(file) {
  const id = Number(file?.id);
  const name = String(file?.name || '').trim();
  if (!Number.isFinite(id) || id <= 0 || !name) return null;
  return { id, name };
}

export function forgeCdnUrl(file) {
  const ref = fileRef(file);
  if (!ref) return null;
  const folder = Math.floor(ref.id / 1000);
  const leaf = ref.id % 1000;
  return `${CDN_HOST}/files/${folder}/${leaf}/${encodeURIComponent(ref.name)}`;
}

function fileRecord(file) {
  const cdn = forgeCdnUrl(file);
  return {
    id: Number(file.id),
    name: String(file.name || ''),
    display: String(file.display || file.version || file.name || ''),
    version: String(file.version || ''),
    type: String(file.type || 'release'),
    filesize: Number(file.filesize) || 0,
    downloads: Number(file.downloads) || 0,
    versions: Array.isArray(file.versions) ? file.versions.map(String) : [],
    uploadedAt: file.uploaded_at || file.uploadedAt || null,
    pageUrl: String(file.url || ''),
    downloadUrl: cdn || String(file.url || ''),
    cdn: Boolean(cdn),
  };
}

export function normalizeProject(json, { source = 'cfwidget' } = {}) {
  if (!json || typeof json !== 'object' || !json.id) {
    throw new PublicCurseForgeError('CurseForge 项目数据为空。', 'CURSEFORGE_PUBLIC_EMPTY');
  }
  const files = (Array.isArray(json.files) ? json.files : [])
    .filter((file) => file && file.id && file.name)
    .map(fileRecord)
    .sort((left, right) => new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0));
  const members = (Array.isArray(json.members) ? json.members : [])
    .map((member) => String(member?.username || member?.name || '')).filter(Boolean);
  const url = String(json.urls?.curseforge || json.urls?.project || '');
  const slug = url.split('/').filter(Boolean).pop() || '';
  return {
    id: Number(json.id),
    title: String(json.title || `CurseForge ${json.id}`),
    slug,
    summary: String(json.summary || ''),
    description: String(json.description || ''),
    url,
    thumbnail: String(json.thumbnail || ''),
    created_at: json.created_at || null,
    updated_at: json.updated_at || (files[0]?.uploadedAt || null),
    downloads: Number(json.downloads?.total) || 0,
    monthlyDownloads: Number(json.downloads?.monthly) || 0,
    categories: (Array.isArray(json.categories) ? json.categories : []).map((category) => ({
      name: String(category?.name || ''),
      slug: String(category?.slug || category?.name || ''),
    })).filter((category) => category.name),
    members,
    files,
    latest: files[0] || null,
    source,
  };
}

export async function fetchPublicProject(input, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const ref = typeof input === 'string' || typeof input === 'number' ? parseProjectRef(input) : input;
  const path = ref.kind === 'id' ? `/${ref.id}` : `/kerbal/ksp-mods/${ref.slug}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${WIDGET_HOST}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'kanmod/0.1.5-alpha' },
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new PublicCurseForgeError('查询 CurseForge 项目超时，请稍后重试。', 'CURSEFORGE_PUBLIC_TIMEOUT');
    throw new PublicCurseForgeError(`无法连接 CurseForge 数据源：${error.message}`, 'CURSEFORGE_PUBLIC_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) {
    throw new PublicCurseForgeError('没有找到这个 CurseForge 项目，请检查链接或 slug。', 'CURSEFORGE_PUBLIC_NOT_FOUND', { ref });
  }
  if (!response.ok) {
    throw new PublicCurseForgeError(`CurseForge 数据源返回 ${response.status}。`, 'CURSEFORGE_PUBLIC_HTTP', { status: response.status });
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PublicCurseForgeError('CurseForge 数据源返回了无法解析的内容。', 'CURSEFORGE_PUBLIC_BAD_JSON');
  }
  return normalizeProject(json);
}

// 转成官方 API 的 mod 形状，复用现有的 mapCurseForgeMod / pickCurseForgeFile。
export function toCurseForgeMod(project) {
  const releaseType = (file) => (file.type === 'release' ? 1 : 2);
  return {
    id: project.id,
    name: project.title,
    slug: project.slug,
    summary: project.summary,
    downloadCount: project.downloads,
    dateModified: project.updated_at,
    links: { websiteUrl: project.url },
    authors: project.members.map((name) => ({ name })),
    categories: project.categories.map((category, index) => ({ id: index + 1, name: category.name, slug: category.slug })),
    logo: project.thumbnail ? { thumbnailUrl: project.thumbnail } : null,
    latestFiles: project.files.map((file) => ({
      id: file.id,
      fileName: file.name,
      displayName: file.display,
      fileDate: file.uploadedAt,
      fileLength: file.filesize,
      gameVersions: file.versions,
      releaseType: releaseType(file),
      downloadUrl: file.downloadUrl,
    })),
  };
}

export function publicProjectView(project) {
  return {
    ...project,
    public: true,
  };
}
