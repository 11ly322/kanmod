import path from 'node:path';

export function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

export function normalizeRel(value) {
  let rel = toPosix(value).replace(/^\.\/+/, '').replace(/\/+/g, '/');
  rel = rel.replace(/^\/+/, '');
  return rel;
}

export function assertSafeArchivePath(value) {
  const raw = String(value ?? '');
  if (!raw || raw.includes('\0')) throw new Error('压缩包内包含空路径或非法字符。');
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\') || path.posix.isAbsolute(toPosix(raw))) {
    throw new Error(`压缩包内包含绝对路径：${raw}`);
  }
  const rel = normalizeRel(raw);
  const parts = rel.split('/');
  if (parts.some((part) => part === '..')) {
    throw new Error(`压缩包尝试跳出目标目录：${raw}`);
  }
  return parts.filter((part) => part && part !== '.').join('/');
}

export function isWithin(parent, child) {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  if (relative === '') return true;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  if (process.platform === 'win32') {
    return !relative.toLowerCase().startsWith('..');
  }
  return true;
}

export function safeJoin(root, ...parts) {
  const joinedRel = toPosix(path.posix.join(...parts.map((part) => normalizeRel(part))));
  const target = path.resolve(root, ...joinedRel.split('/').filter(Boolean));
  if (!isWithin(root, target)) {
    throw new Error(`目标路径越界：${parts.join('/')}`);
  }
  return target;
}

export function safeFileName(value, fallback = 'mod') {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function fileNameFromUrl(url, fallback = 'download.zip') {
  try {
    const parsed = new URL(url);
    const base = path.posix.basename(decodeURIComponent(parsed.pathname));
    if (base && base !== '/') return safeFileName(base, fallback);
  } catch {
    // Fall through to fallback.
  }
  return safeFileName(fallback);
}

/**
 * Small glob matcher for CKAN filters. Supports *, **, ? and character
 * classes, with forward-slash separators and case-insensitive matching.
 */
export function globToRegExp(pattern) {
  const input = toPosix(pattern).replace(/^\/+/, '');
  let source = '^';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '*') {
      if (input[index + 1] === '*') {
        index += 1;
        if (input[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const close = input.indexOf(']', index + 1);
      if (close === -1) {
        source += '\\[';
      } else {
        source += input.slice(index, close + 1);
        index = close;
      }
    } else {
      source += char.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  source += '$';
  return new RegExp(source, 'i');
}

export function matchesAnyGlob(relativePath, patterns = []) {
  const rel = normalizeRel(relativePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(rel));
}

export function commonRoot(paths) {
  const partsList = paths
    .map((entry) => normalizeRel(entry).split('/').filter(Boolean))
    .filter((parts) => parts.length > 0);
  if (!partsList.length) return '';
  const first = partsList[0];
  let length = first.length;
  for (const parts of partsList.slice(1)) {
    length = Math.min(length, parts.length);
    for (let index = 0; index < length; index += 1) {
      if (parts[index].toLowerCase() !== first[index].toLowerCase()) {
        length = index;
        break;
      }
    }
  }
  return first.slice(0, length).join('/');
}

export const KSP_DESTINATIONS = ['GameData', 'Ships', 'Missions', 'KSP_Data', 'Tutorials'];

export function normalizeDestination(value) {
  const rel = normalizeRel(value || 'GameData');
  if (!rel) return 'GameData';
  const top = rel.split('/')[0];
  const approved = KSP_DESTINATIONS.find((entry) => entry.toLowerCase() === top.toLowerCase());
  if (!approved) {
    throw new Error(`不支持的安装目标：${value}。kanmod 只允许安装到 ${KSP_DESTINATIONS.join('、')}。`);
  }
  return approved + (rel.split('/').length > 1 ? `/${rel.split('/').slice(1).join('/')}` : '');
}
