import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractZip } from './util/zip.js';
import { extractTarGz } from './util/tar.js';
import {
  assertSafeArchivePath,
  isWithin,
  matchesAnyGlob,
  normalizeDestination,
  normalizeRel,
  safeFileName,
} from './util/paths.js';
import {
  ensureDir,
  formatBytes,
  movePath,
  readJson,
  safeRemoveEmptyDirs,
  sha256File,
  writeFileAtomic,
  writeJsonAtomic,
} from './util/fsx.js';

const MAX_EXTRACT_BYTES = 768 * 1024 * 1024;
const MAX_EXTRACT_ENTRIES = 120_000;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function archiveType(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar';
  if (lower.endsWith('.ckan')) return 'json';
  throw new Error('不支持的压缩包格式：仅支持 .zip、.tar.gz 或 .ckan 元数据。');
}

function ignoreArchiveEntry(rel) {
  const lower = rel.toLowerCase();
  return (
    lower === '.ds_store'
    || lower === 'thumbs.db'
    || lower.startsWith('__macosx/')
    || lower.split('/').includes('.git')
    || lower.endsWith('/')
  );
}

/**
 * Reads an archive into memory. KSP packages are typically a few MB; the hard
 * cap keeps a malicious archive from exhausting the machine.
 */
export async function readArchive(archivePath) {
  const stat = await fs.stat(archivePath).catch(() => null);
  if (!stat) throw new Error('安装包不存在。');
  if (stat.size > MAX_EXTRACT_BYTES * 1.2) throw new Error(`安装包过大（${formatBytes(stat.size)}）。`);
  const buffer = await fs.readFile(archivePath);
  const type = archiveType(archivePath);
  let raw;
  if (type === 'zip') {
    raw = extractZip(buffer, { maxEntries: MAX_EXTRACT_ENTRIES, maxTotalBytes: MAX_EXTRACT_BYTES });
  } else if (type === 'tar') {
    raw = extractTarGz(buffer, { maxEntries: MAX_EXTRACT_ENTRIES, maxTotalBytes: MAX_EXTRACT_BYTES });
  } else {
    throw new Error('单独的 .ckan 元数据文件不能直接安装，请安装对应的模组压缩包。');
  }
  const entries = [];
  for (const entry of raw) {
    if (!entry || typeof entry.name !== 'string' || entry.data === undefined) continue;
    let rel;
    try {
      rel = normalizeRel(entry.name);
      assertSafeArchivePath(rel);
    } catch {
      continue;
    }
    if (!rel || ignoreArchiveEntry(rel)) continue;
    entries.push({ rel, data: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data) });
  }
  if (!entries.length) throw new Error('压缩包中没有可安装的文件。');
  return entries;
}

function allDirectories(entries) {
  const dirs = new Set();
  for (const entry of entries) {
    const parts = entry.rel.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth || a.localeCompare(b);
  });
}

function basename(value) {
  return value.split('/').pop();
}

function safeAsName(value) {
  if (value == null) return null;
  const name = String(value).trim();
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error(`非法的重命名目标：${value}`);
  }
  return safeFileName(name, 'mod');
}

function normalizeGuessedDestination(value) {
  if (!value) return 'GameData';
  if (value === 'GameRoot') throw new Error('该模组要求写入游戏根目录，kanmod 为安全起见不会自动执行。');
  if (value === 'Tutorial') return normalizeDestination('Tutorials');
  if (value === 'Scenarios') return normalizeDestination('Missions');
  return normalizeDestination(value);
}

function matchFilters(rel, basenameOnly, directive) {
  const globMatch = (pattern) => (pattern.includes('/') ? matchesAnyGlob(rel, [pattern]) : matchesAnyGlob(basenameOnly, [pattern]));
  if ((directive.filter || []).some(globMatch)) return false;
  for (const pattern of directive.filter_regexp || []) {
    let regexp;
    try {
      regexp = new RegExp(pattern, 'i');
    } catch {
      continue;
    }
    if (regexp.test(rel) || regexp.test(basenameOnly)) return false;
  }
  const includes = directive.include_only || [];
  const includesRegexp = directive.include_only_regexp || [];
  if (includes.length || includesRegexp.length) {
    const included = includes.some(globMatch) || includesRegexp.some((pattern) => {
      try {
        const regexp = new RegExp(pattern, 'i');
        return regexp.test(rel) || regexp.test(basenameOnly);
      } catch {
        return false;
      }
    });
    if (!included) return false;
  }
  return true;
}

function selectFile(entries, file) {
  const normalized = normalizeRel(file);
  const exact = entries.find((entry) => entry.rel.toLowerCase() === normalized.toLowerCase());
  if (exact) return { kind: 'file', root: normalized, entries: [exact] };
  const prefix = `${normalized}/`.toLowerCase();
  const inside = entries.filter((entry) => entry.rel.toLowerCase().startsWith(prefix));
  if (inside.length) return { kind: 'dir', root: normalized, entries: inside };
  return null;
}

function findDirectory(entries, needle) {
  const dirs = allDirectories(entries);
  const normalized = normalizeRel(needle).toLowerCase();
  if (normalized.includes('/')) {
    const exact = dirs.find((dir) => dir.toLowerCase() === normalized);
    if (exact) return { kind: 'dir', root: exact, entries: entries.filter((entry) => entry.rel.toLowerCase().startsWith(`${exact.toLowerCase()}/`)) };
    return null;
  }
  const candidates = dirs.filter((dir) => basename(dir).toLowerCase() === normalized);
  if (!candidates.length) return null;
  const minDepth = Math.min(...candidates.map((dir) => dir.split('/').length));
  const shallow = candidates.filter((dir) => dir.split('/').length === minDepth);
  if (shallow.length > 1) {
    throw new Error(`压缩包里有多个名为 ${needle} 的目录（${shallow.join('、')}），无法确定安装哪一个。`);
  }
  const root = shallow[0];
  return { kind: 'dir', root, entries: entries.filter((entry) => entry.rel.toLowerCase().startsWith(`${root.toLowerCase()}/`)) };
}

function findRegexp(entries, pattern) {
  let regexp;
  try {
    regexp = new RegExp(pattern, 'i');
  } catch {
    throw new Error(`CKAN 索引中的 find_regexp 无效：${pattern}`);
  }
  const dirs = allDirectories(entries).filter((dir) => regexp.test(dir) || regexp.test(basename(dir)));
  if (!dirs.length) return null;
  const minDepth = Math.min(...dirs.map((dir) => dir.split('/').length));
  const shallow = dirs.filter((dir) => dir.split('/').length === minDepth);
  if (shallow.length > 1) throw new Error(`压缩包里有多个目录匹配 ${pattern}，无法确定安装哪一个。`);
  const root = shallow[0];
  return { kind: 'dir', root, entries: entries.filter((entry) => entry.rel.toLowerCase().startsWith(`${root.toLowerCase()}/`)) };
}

function inferDirective(entries, pkg) {
  const gameData = allDirectories(entries).filter((dir) => basename(dir).toLowerCase() === 'gamedata');
  if (gameData.length) {
    const chosen = gameData.sort((a, b) => a.split('/').length - b.split('/').length)[0];
    return { inferredGameData: chosen };
  }
  const tops = new Set(entries.map((entry) => entry.rel.split('/')[0]));
  if (tops.size === 1) {
    const top = [...tops][0];
    const hasNested = entries.some((entry) => entry.rel === top);
    if (!hasNested) return { find: top, install_to: 'GameData' };
  }
  const identifier = pkg?.identifier || pkg?.name;
  if (identifier) return { find: identifier, install_to: 'GameData' };
  throw new Error('无法判断压缩包应安装到哪里：缺少 CKAN 安装规则，且压缩包内没有 GameData 目录。');
}

function buildMappings(entries, pkg, onProgress = () => {}) {
  let directives = Array.isArray(pkg?.install) && pkg.install.length ? pkg.install : null;
  if (!directives) {
    const inferred = inferDirective(entries, pkg);
    if (inferred.inferredGameData) {
      const root = inferred.inferredGameData;
      const prefix = `${root.toLowerCase()}/`;
      directives = [{
        install_to: 'GameData',
        _entries: entries.filter((entry) => entry.rel.toLowerCase().startsWith(prefix)),
        _rootName: null,
        _stripPrefix: root,
      }];
    } else {
      directives = [inferred];
    }
  }

  const byTarget = new Map();
  const unknown = [];
  for (const directive of directives) {
    if (!directive || (!directive.file && !directive.find && !directive.find_regexp)) continue;
    let selected;
    if (directive._entries) {
      selected = { kind: 'dir', root: directive._stripPrefix, entries: directive._entries };
    } else if (directive.file) {
      selected = selectFile(entries, directive.file);
      if (!selected) {
        if (directive.optional) continue;
        throw new Error(`安装包中找不到 CKAN 规则要求的路径：${directive.file}`);
      }
    } else if (directive.find) {
      selected = findDirectory(entries, directive.find);
      if (!selected && directive.find_matches_files) {
        const exact = entries.find((entry) => basename(entry.rel).toLowerCase() === String(directive.find).toLowerCase());
        if (exact) selected = { kind: 'file', root: exact.rel, entries: [exact] };
      }
      if (!selected) {
        if (directive.optional) continue;
        throw new Error(`安装包中找不到 CKAN 规则要求的目录：${directive.find}`);
      }
    } else {
      selected = findRegexp(entries, directive.find_regexp);
      if (!selected) {
        if (directive.optional) continue;
        throw new Error(`安装包中找不到匹配 ${directive.find_regexp} 的目录。`);
      }
    }

    const destination = normalizeGuessedDestination(directive.install_to);
    if (selected.kind === 'file') {
      const entry = selected.entries[0];
      const fileName = safeAsName(directive.as) || basename(selected.root);
      if (!matchFilters(basename(entry.rel), basename(entry.rel), directive)) continue;
      const targetRel = normalizeRel(`${destination}/${fileName}`);
      assertSafeArchivePath(targetRel);
      const key = targetRel.toLowerCase();
      const previous = byTarget.get(key);
      if (previous && !previous.data.equals(entry.data)) {
        throw new Error(`安装规则发生冲突：同一路径 ${targetRel} 对应了两个不同的文件。`);
      }
      if (!previous) {
        byTarget.set(key, { from: entry.rel, to: targetRel, data: entry.data, size: entry.data.length });
      }
      onProgress({ phase: 'plan', message: `已解析 ${directive.file || directive.find || directive.find_regexp} 的安装规则` });
      continue;
    }
    const rootName = directive._rootName === null
      ? null
      : safeAsName(directive.as) || basename(selected.root);
    const prefix = `${selected.root}/`;
    for (const entry of selected.entries) {
      const sub = entry.rel.slice(prefix.length);
      if (!matchFilters(sub, basename(sub), directive)) continue;
      const targetRel = normalizeRel(rootName ? `${destination}/${rootName}${sub ? `/${sub}` : ''}` : `${destination}/${sub}`);
      assertSafeArchivePath(targetRel);
      const key = targetRel.toLowerCase();
      const previous = byTarget.get(key);
      if (previous && !previous.data.equals(entry.data)) {
        throw new Error(`安装规则发生冲突：同一路径 ${targetRel} 对应了两个不同的文件。`);
      }
      if (!previous) {
        byTarget.set(key, { from: entry.rel, to: targetRel, data: entry.data, size: entry.data.length });
      }
    }
    onProgress({ phase: 'plan', message: `已解析 ${directive.file || directive.find || directive.find_regexp || 'GameData'} 的安装规则` });
  }
  const files = [...byTarget.values()];
  if (!files.length) {
    throw new Error(`安装规则没有匹配到文件${unknown.length ? `（${unknown.join('、')}）` : '，请检查模组压缩包和 CKAN 元数据。'}`);
  }
  return files;
}

function rootsFor(files, installTo) {
  const roots = new Set();
  for (const file of files) {
    const parts = file.to.split('/');
    if (parts[0].toLowerCase() === 'gamedata' && parts.length > 2) roots.add(`GameData/${parts[1]}`);
    else if (parts[0].toLowerCase() === installTo.toLowerCase() && parts.length > 2) roots.add(`${installTo}/${parts[1]}`);
    else roots.add(parts[0]);
  }
  return [...roots];
}

function primaryFolder(files) {
  const gameData = files.filter((file) => file.to.toLowerCase().startsWith('gamedata/'));
  if (gameData.length) {
    const children = new Set(gameData.map((file) => file.to.split('/')[1]).filter(Boolean));
    if (children.size === 1) return `GameData/${[...children][0]}`;
    return 'GameData';
  }
  const top = new Set(files.map((file) => file.to.split('/').slice(0, 2).join('/')));
  return top.size === 1 ? [...top][0] : [...top].join(', ');
}

export async function planInstall(packageInfo, archivePath, { onProgress = () => {} } = {}) {
  onProgress({ phase: 'read', message: '正在读取压缩包…' });
  const entries = await readArchive(archivePath);
  const files = buildMappings(entries, packageInfo, onProgress);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    entries: entries.length,
    files,
    roots: rootsFor(files, packageInfo?.install?.[0]?.install_to || 'GameData'),
    primaryFolder: primaryFolder(files),
    totalBytes,
    totalLabel: formatBytes(totalBytes),
  };
}

async function sameContent(target, data) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat || !stat.isFile() || stat.size !== data.length) return false;
  const existing = await fs.readFile(target);
  return existing.equals(data);
}

async function rollback(journal) {
  for (const entry of journal.created.reverse()) {
    await fs.rm(entry, { force: true }).catch(() => {});
  }
  for (const entry of journal.overwritten.reverse()) {
    await ensureDir(path.dirname(entry.target));
    await fs.copyFile(entry.backup, entry.target).catch(() => {});
  }
  for (const dir of journal.dirs.reverse()) {
    await fs.rmdir(dir).catch(() => {});
  }
}

/**
 * Installs a downloaded archive into the KSP folder. Overwritten files are
 * always copied to backupsDir first; on any error the previous files are
 * restored, so a failed install never leaves a half-updated GameData.
 */
export async function installArchive(options) {
  const {
    archivePath,
    kspPath,
    packageInfo,
    settings = {},
    backupsDir,
    onProgress = () => {},
    signal,
  } = options;
  const gameDataPath = path.join(kspPath, 'GameData');
  const stat = await fs.stat(gameDataPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('目标 KSP 文件夹中没有 GameData 目录。');
  const plan = await planInstall(packageInfo, archivePath, { onProgress });
  const archiveSha = await sha256File(archivePath);
  const backupRoot = path.join(backupsDir, `${nowStamp()}-${safeFileName(packageInfo?.identifier || 'mod', 'mod')}`);
  const journal = { created: [], overwritten: [], dirs: [] };
  const backupPaths = [];
  const targetSeen = new Set();
  try {
    for (const [index, file] of plan.files.entries()) {
      if (signal?.aborted) throw new Error('已取消。');
      const target = path.join(kspPath, ...file.to.split('/'));
      if (!isWithin(kspPath, target) || !isWithin(gameDataPath, target) && !/^(Ships|Missions|Tutorials|KSP_Data)\//i.test(file.to)) {
        throw new Error(`拒绝写入 KSP 目录之外或不受支持的路径：${file.to}`);
      }
      if (targetSeen.has(target.toLowerCase())) continue;
      targetSeen.add(target.toLowerCase());
      const parent = path.dirname(target);
      let cursor = parent;
      while (isWithin(kspPath, cursor) && cursor !== kspPath) {
        const exists = await fs.stat(cursor).catch(() => null);
        if (!exists) journal.dirs.push(cursor);
        cursor = path.dirname(cursor);
      }
      await ensureDir(parent);
      const existing = await fs.stat(target).catch(() => null);
      if (existing?.isDirectory()) throw new Error(`目标路径是一个目录，无法覆盖：${file.to}`);
      if (existing) {
        if (await sameContent(target, file.data)) {
          onProgress({ phase: 'file', current: index + 1, total: plan.files.length, message: `文件已是最新：${file.to}` });
          continue;
        }
        if (settings.install?.backupOverwrite === false) {
          throw Object.assign(new Error(`文件已存在且设置了不备份覆盖：${file.to}`), { code: 'INSTALL_CONFLICT' });
        }
        const backup = path.join(backupRoot, ...file.to.split('/'));
        await ensureDir(path.dirname(backup));
        await fs.copyFile(target, backup);
        journal.overwritten.push({ target, backup });
        backupPaths.push(backup);
      } else {
        journal.created.push(target);
      }
      await writeFileAtomic(target, file.data);
      if ((index + 1) % 10 === 0 || index === plan.files.length - 1) {
        onProgress({
          phase: 'file',
          current: index + 1,
          total: plan.files.length,
          message: `正在写入 ${index + 1}/${plan.files.length}：${file.to}`,
        });
      }
    }
    const identifier = packageInfo?.identifier || safeFileName(packageInfo?.name || 'unknown', 'unknown');
    const record = {
      id: `${identifier}@${packageInfo?.version || 'unknown'}`,
      identifier,
      name: packageInfo?.name || identifier,
      version: packageInfo?.version || 'unknown',
      kspVersion: packageInfo?.kspVersion || null,
      author: packageInfo?.author || null,
      abstract: packageInfo?.abstract || null,
      folder: plan.primaryFolder,
      installRoots: plan.roots,
      installTo: packageInfo?.install?.[0]?.install_to || 'GameData',
      files: plan.files.map((file) => file.to),
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archiveSha256: archiveSha,
      archiveSize: (await fs.stat(archivePath)).size,
      managed: 'kanmod',
      source: packageInfo?.source || 'catalog',
    };
    if (backupPaths.length) {
      record.backups = backupPaths;
      await writeJsonAtomic(path.join(backupRoot, 'backup.json'), {
        identifier,
        version: record.version,
        createdAt: record.installedAt,
        files: backupPaths,
      });
    }
    onProgress({ phase: 'done', message: `已安装 ${plan.files.length} 个文件`, files: plan.files.length });
    return { record, plan, backupDir: backupPaths.length ? backupRoot : null };
  } catch (error) {
    onProgress({ phase: 'rollback', message: `安装失败，正在回滚：${error.message}` });
    await rollback(journal);
    throw error;
  }
}

export async function previewInstall(packageInfo, archivePath, { onProgress } = {}) {
  return planInstall(packageInfo, archivePath, { onProgress });
}

export async function uninstallRecord({ kspPath, record, trashDir, onProgress = () => {} }) {
  const files = Array.isArray(record?.files) ? record.files : [];
  const moved = [];
  const missing = [];
  const stamp = nowStamp();
  for (const rel of files) {
    let normalized;
    try {
      normalized = normalizeRel(rel);
      assertSafeArchivePath(normalized);
    } catch {
      continue;
    }
    const target = path.join(kspPath, ...normalized.split('/'));
    if (!isWithin(kspPath, target) || !/^(GameData|Ships|Missions|Tutorials|KSP_Data|Ships\/SPH|Ships\/VAB)\//i.test(normalized)) {
      continue;
    }
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isFile()) {
      missing.push(normalized);
      continue;
    }
    const trashTarget = path.join(trashDir, stamp, ...normalized.split('/'));
    await ensureDir(path.dirname(trashTarget));
    await movePath(target, trashTarget);
    moved.push(normalized);
    onProgress({ phase: 'remove', message: `已移入回收站：${normalized}` });
  }
  for (const root of record?.installRoots || []) {
    try {
      const rootPath = path.join(kspPath, ...normalizeRel(root).split('/'));
      if (isWithin(kspPath, rootPath)) await safeRemoveEmptyDirs(kspPath, rootPath);
    } catch {
      // Ignore malformed registry roots.
    }
  }
  return { moved, missing, trashPath: path.join(trashDir, stamp) };
}

export async function readBackupManifest(backupDir) {
  return readJson(path.join(backupDir, 'backup.json'), null);
}
