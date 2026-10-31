import path from 'node:path';
import { DATA_DIR, CONFIG_FILE } from './config.js';
import { ensureDir, readJson, writeJsonAtomic } from './util/fsx.js';

export function registryFileForInstance(instanceId) {
  return path.join(DATA_DIR, 'instances', instanceId, 'registry.json');
}

export function instanceDataDir(instanceId) {
  return path.join(DATA_DIR, 'instances', instanceId);
}

export class InstalledRegistry {
  constructor(instanceId, file = registryFileForInstance(instanceId)) {
    this.instanceId = instanceId;
    this.file = file;
    this.data = { schema: 1, instanceId, updatedAt: null, mods: {} };
  }

  async load() {
    const raw = await readJson(this.file, null);
    if (raw && typeof raw === 'object' && raw.mods && typeof raw.mods === 'object') {
      this.data = { schema: 1, instanceId: this.instanceId, updatedAt: raw.updatedAt || null, mods: raw.mods };
    }
    return this.data;
  }

  get mods() {
    return this.data.mods;
  }

  records() {
    return Object.values(this.data.mods);
  }

  getByIdentifier(identifier) {
    const key = String(identifier || '').toLowerCase();
    return this.records().find((record) => String(record.identifier || '').toLowerCase() === key) || null;
  }

  getByFolder(folder) {
    const key = String(folder || '').toLowerCase();
    return this.records().find((record) => String(record.folder || '').toLowerCase() === key) || null;
  }

  getById(id) {
    return this.data.mods[id] || null;
  }

  findOwningFile(rel) {
    const normalized = String(rel || '').replace(/\\/g, '/').toLowerCase();
    return this.records().find((record) => (record.files || []).some((file) => String(file.rel).replace(/\\/g, '/').toLowerCase() === normalized)) || null;
  }

  async upsert(record) {
    if (!record || !record.id) throw new Error('安装记录缺少 id。');
    this.data.mods[record.id] = record;
    this.data.updatedAt = new Date().toISOString();
    await this.save();
    return record;
  }

  async remove(id) {
    const record = this.data.mods[id];
    if (!record) return null;
    delete this.data.mods[id];
    this.data.updatedAt = new Date().toISOString();
    await this.save();
    return record;
  }

  async save() {
    await ensureDir(path.dirname(this.file));
    await writeJsonAtomic(this.file, this.data);
  }

  toJSON() {
    return this.data;
  }
}

export async function loadRegistry(instanceId) {
  const registry = new InstalledRegistry(instanceId);
  await registry.load();
  return registry;
}
