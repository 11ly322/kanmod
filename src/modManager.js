import fs from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from './config.js';
import {
  ensureDir,
  movePath,
  pathExists,
  readJson,
  safeRemoveEmptyDirs,
  writeJsonAtomic,
} from './util/fsx.js';
import { assertSafeArchivePath, isWithin, normalizeRel, safeFileName, toPosix } from './util/paths.js';
import { compareVersions } from './util/version.js';

function lower(value) {
  return String(value || '').toLowerCase();
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function recordKey(value) {
  const key = lower(value?.identifier || value?.folder || value?.relPath || value?.key);
  return key || 'unknown';
}

export function disabledFileForInstance(instanceId) {
  return path.join(DATA_DIR, 'instances', String(instanceId), 'disabled.json');
}

export class DisabledStore {
  constructor(file) {
    this.file = file;
    this.data = { schema: 1, mods: {} };
  }

  async load() {
    const saved = await readJson(this.file, null);
    if (saved && typeof saved === 'object' && saved.mods && typeof saved.mods === 'object') {
      this.data = { schema: 1, mods: saved.mods };
    } else {
      this.data = { schema: 1, mods: {} };
    }
    return this;
  }

  async save() {
    await ensureDir(path.dirname(this.file));
    await writeJsonAtomic(this.file, this.data);
  }

  records() {
    return Object.values(this.data.mods || {});
  }

  get(key) {
    return this.data.mods?.[key] || null;
  }

  find({ identifier, folder, id } = {}) {
    const wanted = lower(identifier || folder || id);
    if (!wanted) return null;
    return this.records().find((item) => (
      lower(item.identifier) === wanted
      || lower(item.folder) === wanted
      || lower(item.key) === wanted
    )) || null;
  }

  async add(record) {
    const key = recordKey(record);
    record.key = key;
    this.data.mods[key] = record;
    await this.save();
    return record;
  }

  async remove(key) {
    delete this.data.mods[key];
    await this.save();
  }
}

function relativeInside(kspPath, absolute) {
  const rel = toPosix(path.relative(kspPath, absolute));
  assertSafeArchivePath(rel);
  if (!isWithin(kspPath, absolute)) throw new Error('模组路径不在 KSP 目录内。');
  return rel;
}

function entryPath(kspPath, entry) {
  const rel = normalizeRel(entry.relPath || entry.folder || '');
  assertSafeArchivePath(rel);
  const absolute = path.join(kspPath, ...rel.split('/'));
  if (!isWithin(kspPath, absolute)) throw new Error('模组路径不在 KSP 目录内。');
  return { rel, absolute };
}

async function registryRecordFor(registry, entry) {
  if (!registry) return null;
  return registry.getByIdentifier(entry.identifier)
    || (entry.folder ? registry.getByFolder(entry.folder) : null)
    || registry.getById(entry.identifier)
    || null;
}

export async function disableMod({ kspPath, entry, store, registry }) {
  if (!entry?.identifier && !entry?.folder) throw new Error('缺少模组标识。');
  if (store.find({ identifier: entry.identifier, folder: entry.folder })) {
    throw new Error('这个模组已经处于禁用状态。');
  }
  const source = entry.absolutePath || entryPath(kspPath, entry).absolute;
  if (!isWithin(kspPath, source)) throw new Error('模组路径不在 KSP 目录内。');
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new Error('模组文件不存在，可能已被移动或删除。');
  const relPath = relativeInside(kspPath, source);
  const label = safeFileName(entry.identifier || entry.folder || path.basename(source)) || 'module';
  const target = path.join(kspPath, 'DisabledMods', `${label}-${nowStamp()}`);
  await ensureDir(path.dirname(target));
  await movePath(source, target);
  const manifest = {
    identifier: entry.identifier || null,
    name: entry.name || entry.folder || entry.identifier,
    version: entry.installedVersion || entry.version || null,
    folder: entry.folder || null,
    relPath,
    disabledRel: toPosix(path.relative(kspPath, target)),
    type: stat.isDirectory() ? 'folder' : 'file',
    size: entry.size || stat.size || null,
    sizeLabel: entry.sizeLabel || null,
    kspVersion: entry.kspVersion || null,
    managed: Boolean(entry.managed),
    managedBy: entry.managedBy || 'manual',
    disabledAt: new Date().toISOString(),
  };
  await store.add(manifest);
  const record = await registryRecordFor(registry, entry);
  if (record) {
    record.disabled = true;
    record.disabledRel = manifest.disabledRel;
    record.disabledAt = manifest.disabledAt;
    await registry.upsert(record);
  }
  return { manifest };
}

export async function enableMod({ kspPath, manifest, store, registry }) {
  if (!manifest) throw new Error('没有找到这个已禁用模组的记录。');
  const disabledRel = normalizeRel(manifest.disabledRel || '');
  assertSafeArchivePath(disabledRel);
  const source = path.join(kspPath, ...disabledRel.split('/'));
  const originalRel = normalizeRel(manifest.relPath || '');
  assertSafeArchivePath(originalRel);
  const target = path.join(kspPath, ...originalRel.split('/'));
  if (!isWithin(kspPath, source) || !isWithin(kspPath, target)) throw new Error('模组路径不在 KSP 目录内。');
  if (!(await pathExists(source))) throw new Error('禁用目录中的模组文件不存在，可能已被手动删除。');
  if (await pathExists(target)) throw new Error('原位置已有同名文件，无法自动恢复。请先移动冲突文件。');
  await ensureDir(path.dirname(target));
  await movePath(source, target);
  await store.remove(manifest.key || recordKey(manifest));
  const record = registry?.getByIdentifier(manifest.identifier) || null;
  if (record) {
    delete record.disabled;
    delete record.disabledRel;
    delete record.disabledAt;
    await registry.upsert(record);
  }
  await safeRemoveEmptyDirs(kspPath, path.dirname(source)).catch(() => {});
  return { identifier: manifest.identifier, path: toPosix(path.relative(kspPath, target)) };
}

export async function removeModPath({ kspPath, entry, manifest, trashDir }) {
  const sourceRel = manifest?.disabledRel
    || (entry?.absolutePath ? relativeInside(kspPath, entry.absolutePath) : null)
    || entry?.relPath
    || entry?.folder;
  if (!sourceRel) throw new Error('缺少模组路径。');
  const normalized = normalizeRel(sourceRel);
  assertSafeArchivePath(normalized);
  const source = entry?.absolutePath && !manifest
    ? entry.absolutePath
    : path.join(kspPath, ...normalized.split('/'));
  if (!isWithin(kspPath, source)) throw new Error('模组路径不在 KSP 目录内。');
  const exists = await pathExists(source);
  if (!exists) return { moved: false, source: normalized, trashPath: null };
  const restoreRel = normalizeRel(manifest?.relPath || normalized);
  const target = path.join(trashDir, nowStamp(), ...restoreRel.split('/'));
  await ensureDir(path.dirname(target));
  await movePath(source, target);
  await safeRemoveEmptyDirs(kspPath, path.dirname(source)).catch(() => {});
  return {
    moved: true,
    source: normalized,
    trashPath: toPosix(path.relative(kspPath, target)),
  };
}

export function computeUpdates(entries, catalog, kspVersion) {
  const updates = [];
  if (!catalog) return updates;
  for (const entry of entries) {
    if (!entry.identifier || entry.disabled) continue;
    const current = entry.installedVersion || entry.version;
    if (!current) continue;
    const selection = catalog.compatiblePackage(entry.identifier, kspVersion, { allowWarning: false });
    const pkg = selection?.pkg;
    if (!pkg) continue;
    if (pkg.releaseStatus && pkg.releaseStatus !== 'stable') continue;
    let newer = false;
    try {
      newer = compareVersions(pkg.version, current) > 0;
    } catch {
      newer = false;
    }
    if (!newer) continue;
    entry.updateAvailable = true;
    entry.latestVersion = pkg.version;
    entry.latestCompatibility = {
      status: 'compatible',
      label: `兼容 ${pkg.version}`,
      targetVersion: pkg.kspVersion || null,
    };
    updates.push({
      identifier: entry.identifier,
      name: entry.name,
      version: current,
      latestVersion: pkg.version,
      folder: entry.folder,
    });
  }
  return updates;
}
