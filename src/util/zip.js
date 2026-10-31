import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { assertSafeArchivePath } from './paths.js';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('不是有效的 ZIP 文件（找不到目录结尾）。');
}

function readUInt64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 文件过大。');
  return Number(value);
}

function readZip64Extra(buffer, needs) {
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const id = buffer.readUInt16LE(offset);
    const size = buffer.readUInt16LE(offset + 2);
    const data = buffer.subarray(offset + 4, offset + 4 + size);
    if (id === 0x0001) {
      const result = {};
      let cursor = 0;
      for (const key of ['uncompressedSize', 'compressedSize', 'localOffset']) {
        if (needs[key] && cursor + 8 <= data.length) {
          result[key] = Number(data.readBigUInt64LE(cursor));
          cursor += 8;
        }
      }
      return result;
    }
    offset += 4 + size;
  }
  return {};
}

export function extractZip(buffer, options = {}) {
  const {
    maxEntries = 200_000,
    maxTotalBytes = 2 * 1024 * 1024 * 1024,
    filter = () => true,
  } = options;
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('ZIP 文件为空或不完整。');

  const eocdOffset = findEndOfCentralDirectory(buffer);
  let entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let zip64 = false;

  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset >= 0 && buffer.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = readUInt64(buffer, locatorOffset + 8);
      if (buffer.readUInt32LE(zip64Offset) !== ZIP64_EOCD_SIGNATURE) {
        throw new Error('ZIP64 目录结构无效。');
      }
      entryCount = readUInt64(buffer, zip64Offset + 32);
      centralOffset = readUInt64(buffer, zip64Offset + 48);
      zip64 = true;
    }
  }

  const entries = [];
  let offset = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP 中央目录损坏。');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    let compressedSize = buffer.readUInt32LE(offset + 20);
    let uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    let localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameBuffer = buffer.subarray(nameStart, nameStart + nameLength);
    const name = nameBuffer.toString(flags & 0x800 ? 'utf8' : 'utf8');
    const extra = buffer.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);
    const needs = {
      uncompressedSize: uncompressedSize === 0xffffffff,
      compressedSize: compressedSize === 0xffffffff,
      localOffset: localOffset === 0xffffffff,
    };
    if (zip64 && (needs.uncompressedSize || needs.compressedSize || needs.localOffset)) {
      const values = readZip64Extra(extra, needs);
      if (values.uncompressedSize !== undefined) uncompressedSize = values.uncompressedSize;
      if (values.compressedSize !== undefined) compressedSize = values.compressedSize;
      if (values.localOffset !== undefined) localOffset = values.localOffset;
    }
    offset += 46 + nameLength + extraLength + commentLength;

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    if ((unixMode & 0o170000) === 0o120000) continue;
    if (name.endsWith('/')) continue;
    if (name.endsWith('\\')) continue;

    let safeName;
    try {
      safeName = assertSafeArchivePath(name);
    } catch {
      throw new Error(`ZIP 包含越界路径，已拒绝安装：${name}`);
    }
    if (!safeName) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`ZIP 本地文件头无效：${safeName}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new Error(`ZIP 数据被截断：${safeName}`);
    if (!filter(safeName, uncompressedSize)) continue;
    if (entries.length >= maxEntries) throw new Error('ZIP 文件条目过多。');
    totalBytes += uncompressedSize;
    if (totalBytes > maxTotalBytes) throw new Error('ZIP 解压后超过大小限制。');

    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: Math.max(uncompressedSize, 1) + 1024 });
      } catch (error) {
        throw new Error(`无法解压 ${safeName}：${error.message}`);
      }
    } else {
      throw new Error(`不支持的 ZIP 压缩算法 ${method}：${safeName}`);
    }
    if (data.length !== uncompressedSize) throw new Error(`ZIP 文件大小校验失败：${safeName}`);
    if ((crc32(data) >>> 0) !== (expectedCrc >>> 0)) {
      throw new Error(`ZIP CRC 校验失败：${safeName}`);
    }
    entries.push({
      name: safeName,
      data,
      size: data.length,
      mtime: dosTimeToDate(buffer.readUInt32LE(offset - (46 + nameLength + extraLength + commentLength) + 12)),
    });
  }

  return entries;
}

function dosTimeToDate(value) {
  const time = value & 0xffff;
  const date = (value >>> 16) & 0xffff;
  return new Date(
    1980 + ((date >>> 9) & 0x7f),
    ((date >>> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >>> 11) & 0x1f,
    (time >>> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** Minimal ZIP writer used by demo archives and tests. */
export function createZip(files, options = {}) {
  const { compress = false, date = new Date() } = options;
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date: dosDate } = dosDateTime(date);

  for (const file of files) {
    const name = assertSafeArchivePath(file.name);
    if (!name) continue;
    const input = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data ?? ''), 'utf8');
    const compressed = compress ? deflateRawSync(input) : input;
    const method = compress ? 8 : 0;
    const nameBuffer = Buffer.from(name, 'utf8');
    const crc = crc32(input);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(input.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(input.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}
