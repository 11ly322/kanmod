import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isWithin, KSP_DESTINATIONS, normalizeRel } from './paths.js';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      const corrupt = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, corrupt).catch(() => {});
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(temp, file);
  } catch {
    await fs.rm(file, { force: true }).catch(() => {});
    await fs.rename(temp, file);
  }
}

export async function writeFileAtomic(file, data) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, data);
  try {
    await fs.rename(temp, file);
  } catch {
    await fs.rm(file, { force: true }).catch(() => {});
    await fs.rename(temp, file);
  }
}

export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fssync.createReadStream(file);
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function movePath(source, target) {
  await ensureDir(path.dirname(target));
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    await fs.cp(source, target, { recursive: true, errorOnExist: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

export async function copyFileSafe(source, target) {
  await ensureDir(path.dirname(target));
  const stat = await fs.lstat(source);
  if (!stat.isFile()) throw new Error(`不是普通文件：${source}`);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.copyFile(source, temp);
  await fs.rename(temp, target);
}

/**
 * Lists regular files below root. Symbolic links are never followed, which
 * prevents an archive or GameData folder from escaping its root.
 */
export async function walkFiles(root, options = {}) {
  const {
    maxDepth = 40,
    maxFiles = 50_000,
    include = () => true,
    withStats = false,
  } = options;
  const files = [];
  async function visit(dir, relative, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const absolute = path.join(dir, entry.name);
      const rel = normalizeRel(relative ? `${relative}/${entry.name}` : entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolute, rel, depth + 1);
      } else if (entry.isFile() && include(rel, entry.name)) {
        if (withStats) {
          const stat = await fs.stat(absolute).catch(() => null);
          if (!stat) continue;
          files.push({ rel, absolute, size: stat.size, mtime: stat.mtimeMs });
        } else {
          files.push({ rel, absolute });
        }
      }
    }
  }
  await visit(root, '', 0);
  return files;
}

export async function readTailBytes(file, maxBytes = 2 * 1024 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    return {
      text: buffer.toString('utf8').replace(/^\uFFFD+/, ''),
      truncated: stat.size > maxBytes,
      stat,
    };
  } finally {
    await handle.close();
  }
}

export async function safeRemoveEmptyDirs(root, startDir) {
  let current = startDir;
  const stop = path.resolve(root);
  const protectedDirs = new Set(KSP_DESTINATIONS.map((name) => name.toLowerCase()));
  while (isWithin(stop, current) && path.resolve(current) !== stop) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) break;
      if (path.dirname(path.resolve(current)) === stop && protectedDirs.has(path.basename(current).toLowerCase())) {
        break;
      }
      await fs.rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

export async function atomicInstallFile(source, target) {
  await ensureDir(path.dirname(target));
  const temp = `${target}.kanmod-${process.pid}-${Date.now()}.tmp`;
  await fs.copyFile(source, temp);
  await fs.rename(temp, target);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function listDirectories(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
