import { gunzipSync } from 'node:zlib';
import { assertSafeArchivePath } from './paths.js';

function readString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  return buffer
    .subarray(start, end === -1 || end > start + length ? start + length : end)
    .toString('utf8')
    .trim();
}

function readNumber(buffer, start, length) {
  const field = buffer.subarray(start, start + length);
  if (field[0] & 0x80) {
    let value = 0;
    for (const byte of field.subarray(1)) value = value * 256 + byte;
    return value;
  }
  const text = field.toString('ascii').replace(/\0/g, '').trim();
  if (!text) return 0;
  const parsed = Number.parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function checksumValid(header) {
  const expected = readNumber(header, 148, 8);
  let sum = 0;
  for (let index = 0; index < 512; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : header[index];
  }
  return sum === expected || (expected === 0 && header.every((byte) => byte === 0));
}

function parsePax(buffer) {
  const result = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(32, offset);
    if (space === -1) break;
    const length = Number.parseInt(buffer.subarray(offset, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = buffer.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) result[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

/**
 * Parses a gzipped tar archive in memory. This is intentionally small: it only
 * handles regular files and directories, skips links, and enforces path safety.
 */
export function extractTarGz(buffer, options = {}) {
  const {
    filter = () => true,
    maxEntries = 120_000,
    maxTotalBytes = 512 * 1024 * 1024,
  } = options;

  let tar = buffer;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) tar = gunzipSync(buffer);

  const entries = [];
  let offset = 0;
  let pax = {};
  let longName = '';
  let totalBytes = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumValid(header)) throw new Error('tar 校验和无效，索引文件可能已损坏。');
    const type = String.fromCharCode(header[156] || 48);
    const namePart = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const headerName = prefix ? `${prefix}/${namePart}` : namePart;
    const size = readNumber(header, 124, 12);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('tar 文件被截断。');
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      pax = { ...pax, ...parsePax(data) };
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0/g, '');
      continue;
    }
    if (type === 'K') continue;

    let name = pax.path || longName || headerName;
    pax = {};
    longName = '';
    if (!name) continue;
    if (type === '5' || name.endsWith('/')) {
      continue;
    }
    if (type !== '0' && type !== '\0' && type !== '7') continue;

    let safeName;
    try {
      safeName = assertSafeArchivePath(name);
    } catch {
      continue;
    }
    if (!safeName) continue;
    if (entries.length >= maxEntries) throw new Error('索引文件条目过多。');
    totalBytes += data.length;
    if (totalBytes > maxTotalBytes) throw new Error('索引文件解压后过大。');
    if (!filter(safeName, size)) continue;
    entries.push({
      name: safeName,
      data: Buffer.from(data),
      mode: readNumber(header, 100, 8),
      mtime: readNumber(header, 136, 12) * 1000,
      size,
    });
  }

  return entries;
}
