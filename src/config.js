import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { ensureDir, readJson, writeJsonAtomic } from './util/fsx.js';

export const APP_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export const DATA_DIR = process.env.KANMOD_DATA_DIR
  ? path.resolve(process.env.KANMOD_DATA_DIR)
  : path.join(APP_ROOT, '.data');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  schema: 1,
  instances: [],
  activeInstanceId: null,
  catalog: {
    sourceId: 'official',
    enabledSources: ['official'],
    customSources: [],
    autoRefresh: false,
    lastRefreshAt: null,
  },
  install: {
    backupOverwrite: true,
    allowWarning: false,
    allowUnknown: false,
    keepDownloads: true,
    autoDependencies: true,
  },
  network: {
    timeoutSeconds: 45,
    downloadTimeoutSeconds: 180,
    stallTimeoutSeconds: 20,
    parallelDownloads: 3,
    parallelSources: 2,
    rangeChunks: 4,
    maxDownloadMB: 2048,
    mirrorPrefixes: [],
    githubMirror: true,
    allowInsecureHttp: false,
  },
  ui: {
    openBrowser: true,
    pageSize: 24,
    autoTranslate: true,
  },
  curseforgeApiKey: '',
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, patch) {
  if (!isObject(patch)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(base?.[key])) result[key] = merge(base[key], value);
    else result[key] = value;
  }
  return result;
}

function sanitizeConfig(config) {
  const clean = merge(DEFAULT_CONFIG, config || {});
  clean.instances = Array.isArray(clean.instances)
    ? clean.instances
      .filter((instance) => instance && instance.path)
      .map((instance) => ({
        id: String(instance.id || ''),
        name: String(instance.name || 'KSP'),
        path: String(instance.path),
        source: String(instance.source || 'manual'),
        addedAt: instance.addedAt || null,
        lastScanAt: instance.lastScanAt || null,
      }))
    : [];
  clean.activeInstanceId = clean.activeInstanceId || null;
  clean.catalog.enabledSources = Array.isArray(clean.catalog.enabledSources)
    ? clean.catalog.enabledSources.map(String)
    : ['official'];
  clean.catalog.customSources = Array.isArray(clean.catalog.customSources)
    ? clean.catalog.customSources
      .filter((source) => source && source.url)
      .map((source) => ({
        id: String(source.id || `custom-${Date.now()}`),
        name: String(source.name || '自定义索引'),
        url: String(source.url),
        enabled: source.enabled !== false,
      }))
    : [];
  clean.network.mirrorPrefixes = Array.isArray(clean.network.mirrorPrefixes)
    ? clean.network.mirrorPrefixes.map(String).filter(Boolean).slice(0, 8)
    : [];
  clean.network.timeoutSeconds = Math.min(300, Math.max(5, Number(clean.network.timeoutSeconds) || 45));
  clean.network.downloadTimeoutSeconds = Math.min(3600, Math.max(30, Number(clean.network.downloadTimeoutSeconds) || 180));
  clean.network.stallTimeoutSeconds = Math.min(120, Math.max(5, Number(clean.network.stallTimeoutSeconds) || 20));
  clean.network.parallelDownloads = Math.min(6, Math.max(1, Number(clean.network.parallelDownloads) || 3));
  clean.network.parallelSources = Math.min(4, Math.max(1, Number(clean.network.parallelSources) || 2));
  clean.network.rangeChunks = Math.min(8, Math.max(1, Number(clean.network.rangeChunks) || 4));
  clean.network.githubMirror = clean.network.githubMirror !== false;
  clean.network.maxDownloadMB = Math.min(8192, Math.max(64, Number(clean.network.maxDownloadMB) || 2048));
  clean.install.allowWarning = Boolean(clean.install.allowWarning);
  clean.install.allowUnknown = Boolean(clean.install.allowUnknown);
  clean.install.autoDependencies = clean.install.autoDependencies !== false;
  clean.ui.pageSize = Math.min(96, Math.max(6, Number(clean.ui.pageSize) || 24));
  clean.ui.autoTranslate = clean.ui.autoTranslate !== false;
  clean.curseforgeApiKey = String(clean.curseforgeApiKey || '');
  return clean;
}

export class ConfigStore {
  constructor(file = CONFIG_FILE) {
    this.file = file;
    this.config = structuredClone(DEFAULT_CONFIG);
    this.loaded = false;
  }

  async load() {
    await ensureDir(path.dirname(this.file));
    const raw = await readJson(this.file, null);
    this.config = sanitizeConfig(raw || {});
    this.loaded = true;
    if (!raw) await this.save();
    return this.config;
  }

  get() {
    return this.config;
  }

  getPublic() {
    const copy = structuredClone(this.config);
    copy.hasCurseforgeKey = Boolean(copy.curseforgeApiKey);
    delete copy.curseforgeApiKey;
    return copy;
  }

  async update(patch) {
    this.config = sanitizeConfig(merge(this.config, patch || {}));
    await this.save();
    return this.config;
  }

  async save() {
    await ensureDir(path.dirname(this.file));
    await writeJsonAtomic(this.file, this.config);
  }

  async addInstance(instance) {
    const list = this.config.instances.filter((existing) => existing.id !== instance.id && existing.path.toLowerCase() !== instance.path.toLowerCase());
    list.push(instance);
    this.config.instances = list;
    if (!this.config.activeInstanceId) this.config.activeInstanceId = instance.id;
    await this.save();
    return instance;
  }

  async removeInstance(id) {
    this.config.instances = this.config.instances.filter((instance) => instance.id !== id);
    if (this.config.activeInstanceId === id) this.config.activeInstanceId = this.config.instances[0]?.id || null;
    await this.save();
  }

  async setActiveInstance(id) {
    if (id && !this.config.instances.some((instance) => instance.id === id)) {
      throw new Error('该 KSP 实例不存在。');
    }
    this.config.activeInstanceId = id || null;
    await this.save();
  }

  async markScanned(id) {
    const instance = this.config.instances.find((entry) => entry.id === id);
    if (instance) {
      instance.lastScanAt = new Date().toISOString();
      await this.save();
    }
  }
}

export async function ensureDataLayout() {
  const dirs = ['instances', 'downloads', 'backups', 'trash', 'demo', 'logs'].map((name) => path.join(DATA_DIR, name));
  await Promise.all(dirs.map((dir) => ensureDir(dir)));
  return dirs;
}

export async function dataDirSize() {
  let total = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const stat = await fs.stat(absolute).catch(() => null);
        if (stat) total += stat.size;
      }
    }
  }
  await walk(DATA_DIR);
  return total;
}
