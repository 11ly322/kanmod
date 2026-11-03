import path from 'node:path';
import { Catalog } from './catalog.js';
import { extractTarGz } from '../util/tar.js';
import { extractZip } from '../util/zip.js';
import { ensureDir, pathExists, readJson, writeJsonAtomic } from '../util/fsx.js';

export class CatalogLoadError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = 'CatalogLoadError';
    this.code = 'CATALOG_LOAD_FAILED';
    this.attempts = attempts;
  }
}

function isJson(buffer) {
  for (const byte of buffer.subarray(0, 64)) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0xef || byte === 0xbb || byte === 0xbf) continue;
    return byte === 0x7b || byte === 0x5b;
  }
  return false;
}

function isGzip(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isZip(buffer) {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function packagesFromJson(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.packages)) return data.packages;
  if (data && data.identifier && data.version) return [data];
  if (data && typeof data === 'object') {
    const values = Object.values(data);
    if (values.every((value) => value && typeof value === 'object')) {
      return values.flatMap((value) => (Array.isArray(value) ? value : [value]));
    }
  }
  return [];
}

export function parseCatalogBuffer(buffer, meta = {}) {
  const packages = [];
  let invalid = 0;
  const consumeJson = (text, label) => {
    let data;
    try {
      data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    } catch {
      invalid += 1;
      return;
    }
    const list = packagesFromJson(data);
    if (!list.length) {
      invalid += 1;
      return;
    }
    for (const pkg of list) if (pkg?.identifier && pkg?.version) packages.push(pkg);
  };

  if (isGzip(buffer)) {
    const entries = extractTarGz(buffer, {
      maxEntries: 120_000,
      maxTotalBytes: 512 * 1024 * 1024,
      filter: (name) => name.toLowerCase().endsWith('.ckan'),
    });
    for (const entry of entries) consumeJson(entry.data.toString('utf8'), entry.name);
  } else if (isZip(buffer)) {
    const entries = extractZip(buffer, {
      maxEntries: 120_000,
      maxTotalBytes: 512 * 1024 * 1024,
      filter: (name) => name.toLowerCase().endsWith('.ckan'),
    });
    for (const entry of entries) consumeJson(entry.data.toString('utf8'), entry.name);
  } else if (isJson(buffer)) {
    consumeJson(buffer.toString('utf8'), meta.sourceUrl || 'catalog.json');
  } else {
    throw new CatalogLoadError('无法识别索引格式：需要 .tar.gz、.zip 或 kanmod/CKAN JSON。');
  }

  if (!packages.length) {
    throw new CatalogLoadError('索引中没有找到有效的 .ckan 模组元数据。');
  }
  return { packages, invalid, meta };
}

export async function downloadBuffer(url, options = {}) {
  const {
    timeoutMs = 60_000,
    maxBytes = 2 * 1024 * 1024 * 1024,
    onProgress = () => {},
    signal,
    headers = {},
    allowNotModified = false,
    withMeta = false,
  } = options;
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('索引地址必须是 http(s)。');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('下载索引超时。')), timeoutMs);
  const onAbort = () => controller.abort(new Error('已取消。'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'kanmod/1.0 (KSP mod manager; local)',
        Accept: 'application/gzip, application/zip, application/json, */*',
        ...headers,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const etag = response.headers.get('etag') || null;
    const lastModified = response.headers.get('last-modified') || null;
    if (response.status === 304 && allowNotModified) {
      return { buffer: null, notModified: true, etag: etag || headers['If-None-Match'] || null, lastModified, url };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (total && total > maxBytes) throw new Error(`索引超过大小限制（${Math.round(total / 1024 / 1024)} MB）。`);
    if (!response.body) throw new Error('服务器没有返回内容。');
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        controller.abort(new Error('索引超过大小限制。'));
        throw new Error('索引超过大小限制。');
      }
      chunks.push(Buffer.from(value));
      onProgress({ received, total, url });
    }
    const buffer = Buffer.concat(chunks);
    if (withMeta) return { buffer, notModified: false, etag, lastModified, url };
    return buffer;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export class CatalogStore {
  constructor({ cacheFile, allowInsecureHttp = false }) {
    this.cacheFile = cacheFile;
    this.allowInsecureHttp = allowInsecureHttp;
    this.catalog = null;
  }

  async loadCache() {
    const raw = await readJson(this.cacheFile, null);
    if (!raw || !Array.isArray(raw.packages) || !raw.packages.length) return null;
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    // Schema 2 caches store already-normalized packages, so the re-normalize
    // pass at startup can be skipped. Older caches hold the same shape, so a
    // quick probe of the first package is enough to apply the fast path.
    const first = raw.packages[0];
    const normalized = raw.normalized === true
      || (first && typeof first.versionSort === 'string' && Array.isArray(first.install) && Array.isArray(first.depends));
    this.catalog = new Catalog(raw.packages, {
      ...meta,
      loadedAt: meta.loadedAt || raw.savedAt || null,
      stale: true,
    }, { normalized });
    if (raw.normalized !== true) {
      // Caches written before schema 2 are pretty-printed (~78 MB vs ~53 MB)
      // and cost a second of JSON parsing at every start. Rewrite them once in
      // the background; the normalized fast path already avoids re-normalizing.
      this.saveCache().catch(() => {});
    }
    return this.catalog;
  }

  status() {
    if (!this.catalog) {
      return {
        loaded: false,
        stale: true,
        empty: true,
        count: 0,
        identifierCount: 0,
        loadedAt: null,
        ageHours: null,
      };
    }
    const loadedAt = this.catalog.meta.loadedAt ? new Date(this.catalog.meta.loadedAt) : null;
    const ageHours = loadedAt ? (Date.now() - loadedAt.getTime()) / 36e5 : null;
    return {
      ...this.catalog.meta,
      loaded: true,
      empty: false,
      ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(1)) : null,
      stale: !loadedAt || !Number.isFinite(ageHours) || ageHours > 36,
    };
  }

  setCatalog(catalog) {
    this.catalog = catalog;
  }

  async setPackages(packages, meta = {}, { persist = true } = {}) {
    const catalog = new Catalog(packages, {
      ...meta,
      loadedAt: meta.loadedAt || new Date().toISOString(),
      stale: false,
    });
    this.catalog = catalog;
    if (persist) await this.saveCache();
    return catalog;
  }

  async saveCache() {
    if (!this.catalog) return;
    await ensureDir(path.dirname(this.cacheFile));
    await writeJsonAtomic(this.cacheFile, {
      schema: 2,
      normalized: true,
      savedAt: new Date().toISOString(),
      meta: this.catalog.meta,
      packages: this.catalog.all,
    }, { pretty: false });
  }

  async importBuffer(buffer, meta = {}) {
    const parsed = parseCatalogBuffer(buffer, meta);
    const catalog = await this.setPackages(parsed.packages, {
      sourceName: meta.sourceName || '本地导入',
      sourceUrl: meta.sourceUrl || null,
      sourceId: meta.sourceId || 'import',
      demo: Boolean(meta.demo),
      imported: true,
      loadedAt: new Date().toISOString(),
      invalidEntries: parsed.invalid,
    });
    return catalog;
  }

  async refresh({ sources = [], onProgress = () => {}, signal } = {}) {
    if (!sources.length) throw new CatalogLoadError('没有启用的索引源。');
    const attempts = [];
    for (const source of sources) {
      const urls = source.urls?.length ? source.urls : [];
      for (const url of urls) {
        let protocol;
        try {
          protocol = new URL(url).protocol;
        } catch {
          attempts.push({ source: source.name, url, error: '索引地址不是合法的 URL' });
          continue;
        }
        if (!this.allowInsecureHttp && protocol !== 'https:') {
          attempts.push({ source: source.name, url, error: '不允许非 HTTPS 索引地址' });
          continue;
        }
        try {
          const cachedMeta = this.catalog?.meta || {};
          const conditional = cachedMeta.etag && cachedMeta.sourceUrl === url
            ? { 'If-None-Match': cachedMeta.etag }
            : {};
          onProgress({
            phase: 'download',
            source: source.name,
            url,
            received: 0,
            total: 0,
            message: conditional['If-None-Match']
              ? `正在检查 ${source.name} 是否有更新…`
              : `正在从 ${source.name} 下载索引…`,
          });
          const fetched = await downloadBuffer(url, {
            timeoutMs: 120_000,
            maxBytes: 512 * 1024 * 1024,
            headers: conditional,
            allowNotModified: true,
            withMeta: true,
            onProgress: (progress) => onProgress({ phase: 'download', source: source.name, url, ...progress }),
            signal,
          });
          if (fetched.notModified && this.catalog) {
            this.catalog.meta.loadedAt = new Date().toISOString();
            onProgress({
              phase: 'parse',
              source: source.name,
              url,
              message: '索引没有变化，直接复用本地缓存。',
            });
            return {
              catalog: this.catalog,
              source: { id: source.id, name: source.name, url },
              attempts,
              downloadedBytes: 0,
              notModified: true,
            };
          }
          const buffer = fetched.buffer;
          if (!buffer) throw new Error('服务器没有返回索引内容。');
          onProgress({ phase: 'parse', source: source.name, url, received: buffer.length, total: buffer.length, message: '正在解析 CKAN 元数据…' });
          const parsed = parseCatalogBuffer(buffer, { sourceName: source.name, sourceUrl: url });
          const catalog = await this.setPackages(parsed.packages, {
            sourceName: source.name,
            sourceUrl: url,
            sourceId: source.id,
            demo: false,
            loadedAt: new Date().toISOString(),
            invalidEntries: parsed.invalid,
            etag: fetched.etag || null,
          });
          return {
            catalog,
            source: { id: source.id, name: source.name, url },
            attempts,
            downloadedBytes: buffer.length,
          };
        } catch (error) {
          if (signal?.aborted) throw error;
          attempts.push({ source: source.name, url, error: error.message });
          onProgress({
            phase: 'fallback',
            source: source.name,
            url,
            message: `${source.name} 该地址失败：${error.message}`,
          });
        }
      }
    }
    throw new CatalogLoadError(
      `所有索引源都失败了。请检查网络，或在“设置”中添加可访问的索引地址、导入本地 CKAN 索引。`,
      attempts,
    );
  }

  exportJson() {
    if (!this.catalog) throw new Error('索引尚未加载。');
    return Buffer.from(`${JSON.stringify({ schema: 1, meta: this.catalog.meta, packages: this.catalog.all }, null, 2)}\n`, 'utf8');
  }
}
