import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeName, shortVersion } from '../util/version.js';
import { walkFiles, formatBytes } from '../util/fsx.js';
import { inspectKspPath } from './version.js';

const STOCK_FOLDERS = new Set(['squad', 'squadexpansion', 'squad_expansion']);
const IGNORED_FOLDERS = new Set(['.kanmod', '__macosx']);

function formatMetadataVersion(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const parts = [value.MAJOR, value.MINOR, value.PATCH, value.BUILD]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .map((part) => String(part));
    return parts.length ? parts.join('.') : null;
  }
  return null;
}

export function parseVersionMetadata(text) {
  if (!text) return null;
  try {
    const clean = String(text).replace(/^\uFEFF/, '').trim();
    const data = JSON.parse(clean);
    return {
      identifier: data.IDENTIFIER || data.identifier || null,
      name: data.NAME || data.name || null,
      abstract: data.ABSTRACT || data.abstract || null,
      version: formatMetadataVersion(data.VERSION || data.version),
      kspVersion: formatMetadataVersion(data.KSP_VERSION || data.ksp_version),
      kspVersionMin: formatMetadataVersion(data.KSP_VERSION_MIN || data.ksp_version_min),
      kspVersionMax: formatMetadataVersion(data.KSP_VERSION_MAX || data.ksp_version_max),
      author: data.AUTHOR || data.author || null,
      url: data.URL || data.url || null,
      download: data.DOWNLOAD || data.download || null,
      raw: data,
    };
  } catch {
    return null;
  }
}

function parseCkanMetadata(text) {
  if (!text) return null;
  try {
    const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    if (!data.identifier && !data.name) return null;
    return {
      identifier: data.identifier || null,
      name: data.name || data.identifier || null,
      version: data.version || null,
      kspVersion: data.ksp_version || null,
      kspVersionMin: data.ksp_version_min || null,
      kspVersionMax: data.ksp_version_max || null,
      author: Array.isArray(data.author) ? data.author.join(', ') : data.author || null,
      abstract: data.abstract || null,
      url: data.resources?.homepage || data.resources?.repository || null,
      download: data.download || null,
      raw: data,
    };
  } catch {
    return null;
  }
}

async function readFileLimited(file, maxBytes = 1024 * 1024) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function pickPrimary(components, fallbackName) {
  if (!components.length) {
    return {
      name: fallbackName,
      version: null,
      kspVersion: null,
      kspVersionMin: null,
      kspVersionMax: null,
      author: null,
      identifier: null,
      abstract: null,
      url: null,
    };
  }
  const first = components[0];
  return {
    name: first.name || fallbackName,
    version: first.version || null,
    kspVersion: first.kspVersion || null,
    kspVersionMin: first.kspVersionMin || null,
    kspVersionMax: first.kspVersionMax || null,
    author: first.author || null,
    identifier: first.identifier || null,
    abstract: first.abstract || null,
    url: first.url || null,
  };
}

function findRegistryRecord(registry, folderName, ckanIdentifier) {
  const mods = registry?.mods || {};
  if (ckanIdentifier) {
    const direct = Object.values(mods).find(
      (record) => String(record.identifier || '').toLowerCase() === String(ckanIdentifier).toLowerCase(),
    );
    if (direct) return direct;
  }
  const key = String(folderName || '').toLowerCase();
  const folderOf = (record) => String(record.folder || '')
    .replace(/^gamedata[\\/]/i, '')
    .toLowerCase();
  return Object.values(mods).find(
    (record) => folderOf(record) === key ||
      String(record.installRel || '').toLowerCase() === key,
  ) || null;
}

function buildDuplicateGroups(entries) {
  const map = new Map();
  for (const entry of entries) {
    for (const dll of entry.dlls || []) {
      const base = path.posix.basename(dll).toLowerCase();
      if (!base.endsWith('.dll')) continue;
      if (!map.has(base)) map.set(base, []);
      map.get(base).push({ entryId: entry.id, modName: entry.name, path: dll, absolute: entry.type === 'folder' ? path.join(entry.absolutePath, dll) : entry.absolutePath });
    }
  }
  return [...map.entries()]
    .filter(([, items]) => new Set(items.map((item) => item.entryId)).size > 1)
    .map(([dll, items]) => ({ dll, items }));
}

/**
 * Scans the top-level shape of GameData. That is how KSP mods are normally
 * organized and how users reason about them. Nested .version/.ckan files are
 * collected for dependency identification, but a mod is never split into
 * several uninstall units.
 */
export async function scanGameData(kspPath, options = {}) {
  const info = await inspectKspPath(kspPath);
  if (!info?.isKsp) {
    throw Object.assign(new Error('该目录不是有效的 KSP 1 安装目录：缺少 GameData。'), { code: 'INVALID_KSP_PATH' });
  }
  if (!info.hasGameData) {
    throw Object.assign(new Error('KSP 目录中不存在 GameData 文件夹。'), { code: 'GAMEDATA_NOT_FOUND' });
  }

  const gameDataPath = info.gameDataPath;
  const dirents = await fs.readdir(gameDataPath, { withFileTypes: true }).catch(() => []);
  const entries = [];
  let stockFolders = 0;
  let stockSize = 0;

  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (dirent.isSymbolicLink()) continue;
    const lower = dirent.name.toLowerCase();
    const absolutePath = path.join(gameDataPath, dirent.name);

    if (dirent.isDirectory() && (STOCK_FOLDERS.has(lower) || IGNORED_FOLDERS.has(lower))) {
      if (STOCK_FOLDERS.has(lower)) {
        stockFolders += 1;
        const stockFiles = await walkFiles(absolutePath, { withStats: true, maxFiles: 80_000 });
        stockSize += stockFiles.reduce((sum, file) => sum + file.size, 0);
      }
      continue;
    }

    if (dirent.isDirectory()) {
      const files = await walkFiles(absolutePath, { withStats: true, maxFiles: 60_000 });
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const dllPaths = files.filter((file) => file.rel.toLowerCase().endsWith('.dll')).map((file) => file.rel);
      const components = [];
      const ckanFiles = files.filter((file) => file.rel.toLowerCase().endsWith('.ckan')).slice(0, 10);
      const versionFiles = files
        .filter((file) => file.rel.toLowerCase().endsWith('.version'))
        .sort((a, b) => a.rel.split('/').length - b.rel.split('/').length)
        .slice(0, 20);
      for (const versionFile of versionFiles) {
        const parsed = parseVersionMetadata(await readFileLimited(versionFile.absolute));
        if (parsed) components.push({ ...parsed, sourceFile: versionFile.rel });
      }
      for (const ckanFile of ckanFiles) {
        const parsed = parseCkanMetadata(await readFileLimited(ckanFile.absolute));
        if (parsed) components.push({ ...parsed, sourceFile: ckanFile.rel });
      }
      const primary = pickPrimary(components, dirent.name);
      const registryRecord = findRegistryRecord(options.registry, dirent.name, primary.identifier);
      const ckanComponent = components.find((component) =>
        String(component.sourceFile || '').toLowerCase().endsWith('.ckan'));
      const identifier = registryRecord?.identifier || ckanComponent?.identifier || primary.identifier || null;
      const version = registryRecord?.version || ckanComponent?.version || primary.version;
      const compatibilityMetadata = ckanComponent || primary;
      entries.push({
        id: `dir:${dirent.name.toLowerCase()}`,
        type: 'folder',
        folder: dirent.name,
        name: registryRecord?.name || primary.name || dirent.name,
        identifier,
        installedVersion: version,
        kspVersion: compatibilityMetadata.kspVersion,
        kspVersionMin: compatibilityMetadata.kspVersionMin,
        kspVersionMax: compatibilityMetadata.kspVersionMax,
        author: registryRecord?.author || primary.author || null,
        abstract: primary.abstract || null,
        url: primary.url || null,
        absolutePath,
        relPath: dirent.name,
        size: totalSize,
        sizeLabel: formatBytes(totalSize),
        fileCount: files.length,
        dllCount: dllPaths.length,
        configCount: files.filter((file) => file.rel.toLowerCase().endsWith('.cfg')).length,
        dlls: dllPaths,
        components,
        versionFiles: versionFiles.map((file) => file.rel),
        managed: Boolean(registryRecord),
        managedBy: registryRecord ? 'kanmod' : ckanComponent ? 'ckan' : primary.version ? 'manual' : 'unknown',
        registryRecord: registryRecord || undefined,
        scanKey: normalizeName(dirent.name),
      });
      continue;
    }

    if (dirent.isFile() && lower.endsWith('.dll')) {
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat) continue;
      const baseName = dirent.name.replace(/\.dll$/i, '');
      const identifierGuess = baseName.replace(/[._-]?\d+(?:\.\d+)*$/, '');
      const versionMatch = baseName.match(/(\d+(?:\.\d+)+)/);
      const record = findRegistryRecord(options.registry, dirent.name, identifierGuess);
      entries.push({
        id: `file:${dirent.name.toLowerCase()}`,
        type: 'file',
        folder: null,
        name: record?.name || baseName,
        identifier: record?.identifier || null,
        installedVersion: record?.version || versionMatch?.[1] || null,
        kspVersion: null,
        kspVersionMin: null,
        kspVersionMax: null,
        author: null,
        abstract: null,
        url: null,
        absolutePath,
        relPath: dirent.name,
        size: stat.size,
        sizeLabel: formatBytes(stat.size),
        fileCount: 1,
        dllCount: 1,
        configCount: 0,
        dlls: [dirent.name],
        components: [],
        versionFiles: [],
        managed: Boolean(record),
        managedBy: record ? 'kanmod' : 'manual',
        registryRecord: record || undefined,
        scanKey: normalizeName(baseName),
      });
    }
  }

  const duplicates = buildDuplicateGroups(entries);
  const activeSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  return {
    scannedAt: new Date().toISOString(),
    kspPath: info.path,
    gameDataPath,
    kspVersion: info.version,
    versionSource: info.versionSource,
    executable: info.executable,
    entries,
    duplicates,
    stats: {
      modCount: entries.length,
      managedCount: entries.filter((entry) => entry.managed).length,
      unmanagedCount: entries.filter((entry) => !entry.managed).length,
      totalSize: activeSize,
      totalSizeLabel: formatBytes(activeSize),
      stockFolders,
      stockSize,
      stockSizeLabel: formatBytes(stockSize),
      dllCount: entries.reduce((sum, entry) => sum + entry.dllCount, 0),
      updateCount: 0,
      issueCount: 0,
    },
  };
}
