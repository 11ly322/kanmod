import crypto from 'node:crypto';
import path from 'node:path';

import { DATA_DIR } from './config.js';
import { ensureDir, readJson, writeJsonAtomic } from './util/fsx.js';
import { BUILTIN_TRANSLATIONS } from './translations.js';

const CACHE_DIR = path.join(DATA_DIR, 'translations');
const CACHE_SCHEMA = 1;
const MAX_TEXT = 6000;
const GOOGLE_TIMEOUT_MS = 7000;
const MYMEMORY_TIMEOUT_MS = 7000;
const memoryCache = new Map();

export class TranslationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.details = details;
  }
}

export function cleanSourceText(value) {
  let text = String(value || '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ');
  text = text.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '$2');
  text = text.replace(/\[[^\]]{1,40}\]/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_TEXT) {
    text = `${text.slice(0, MAX_TEXT).replace(/\s+\S*$/, '')}…`;
  }
  return text;
}

export function hasChinese(value) {
  const text = String(value || '');
  if (!text) return false;
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return chinese >= 8 && chinese / text.length >= 0.12;
}

export function hasAnyChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function decodeEntities(value) {
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    '#39': "'", '#x27': "'", '#8217': '’', '#8211': '–', '#8212': '—', '#8230': '…',
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, key) => {
    const resolved = entities[key] ?? entities[key.toLowerCase()];
    if (resolved !== undefined) return resolved;
    if (key.startsWith('#x') || key.startsWith('#X')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function cacheKey(field, text) {
  return crypto.createHash('sha256').update(`${field}\0${text}`, 'utf8').digest('hex');
}

function cacheFile(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

async function readCache(key) {
  const memory = memoryCache.get(key);
  if (memory) return memory;
  const payload = await readJson(cacheFile(key), null);
  if (!payload || payload.schema !== CACHE_SCHEMA || typeof payload.text !== 'string' || !payload.text) return null;
  const result = {
    text: payload.text,
    provider: payload.provider || '缓存',
    cached: true,
    translated: true,
    machine: Boolean(payload.machine),
  };
  memoryCache.set(key, result);
  return result;
}

async function writeCache(key, result) {
  memoryCache.set(key, result);
  try {
    await ensureDir(CACHE_DIR);
    await writeJsonAtomic(cacheFile(key), {
      schema: CACHE_SCHEMA,
      text: result.text,
      provider: result.provider,
      machine: true,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // 翻译成功比写缓存更重要；缓存失败只影响下次是否重复请求。
  }
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function requestGoogle(text, { fetchImpl, timeoutMs }) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', 'zh-CN');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'kanmod/0.1.7', Accept: 'application/json' },
    signal: timeoutSignal(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  const data = JSON.parse(raw);
  const translated = (Array.isArray(data?.[0]) ? data[0] : [])
    .map((segment) => segment?.[0] || '')
    .join('')
    .trim();
  if (!translated) throw new Error('翻译结果为空');
  return decodeEntities(translated);
}

function splitMyMemoryText(text, maxLength = 420) {
  const chunks = [];
  let current = '';
  for (const paragraph of text.split(/\n+/)) {
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if (!sentence) continue;
      if ((current + (current ? ' ' : '') + sentence).length <= maxLength) {
        current += `${current ? ' ' : ''}${sentence}`;
      } else {
        if (current) chunks.push(current);
        current = sentence.length > maxLength ? sentence.slice(0, maxLength) : sentence;
      }
    }
    if (current) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean).slice(0, 8);
}

async function requestMyMemory(text, { fetchImpl, timeoutMs }) {
  if (text.length > 2600) throw new Error('文本过长，跳过 MyMemory');
  const chunks = splitMyMemoryText(text);
  if (!chunks.length) throw new Error('翻译结果为空');
  const translated = [];
  for (const chunk of chunks) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', chunk);
    url.searchParams.set('langpair', 'en|zh-CN');
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'kanmod/0.1.7', Accept: 'application/json' },
      signal: timeoutSignal(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const result = data?.responseData?.translatedText;
    if (!result || /MYMEMORY WARNING/i.test(result)) throw new Error('翻译服务返回限流提示');
    translated.push(decodeEntities(result));
  }
  return translated.join('\n').trim();
}

function builtinTranslation(identifier, field) {
  const entry = BUILTIN_TRANSLATIONS[identifier];
  if (!entry) return null;
  if (entry[field]) return entry[field];
  if (field === 'name' && entry.abstract) return entry.abstract;
  return null;
}

/**
 * 将 CKAN 的英文简介翻译为中文。
 * 顺序：已经是中文 → 内置演示翻译 → 本地缓存 → Google → MyMemory。
 */
export async function translateText({
  text,
  identifier = '',
  version = '',
  field = 'text',
  demo = false,
  force = false,
  timeoutMs = 7000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const sourceText = cleanSourceText(text);
  if (!sourceText) throw new TranslationError('EMPTY_TEXT', '没有可翻译的文本。');
  const shortField = ['name', 'tag', 'query'].includes(field);
  if ((shortField && hasAnyChinese(sourceText)) || (!shortField && hasChinese(sourceText))) {
    return {
      text: sourceText,
      provider: 'none',
      cached: true,
      translated: false,
      chinese: true,
      machine: false,
    };
  }

  const local = builtinTranslation(identifier, field);
  if (local) {
    return {
      text: local,
      provider: 'kanmod 内置中文',
      cached: true,
      translated: true,
      chinese: false,
      machine: false,
      demo: true,
    };
  }
  if (demo) {
    throw new TranslationError(
      'TRANSLATION_DEMO_MISSING',
      '演示模式没有内置这个模组的中文简介；连接网络后可使用在线翻译。',
    );
  }

  const key = cacheKey(field, sourceText);
  if (!force) {
    const cached = await readCache(key);
    if (cached) return cached;
  }
  if (typeof fetchImpl !== 'function') {
    throw new TranslationError('TRANSLATION_UNAVAILABLE', '当前运行环境不支持联网翻译。');
  }

  const attempts = [];
  const providers = [
    ['Google 翻译', requestGoogle],
    ['MyMemory', requestMyMemory],
  ];
  for (const [name, request] of providers) {
    try {
      const translated = await request(sourceText, { fetchImpl, timeoutMs });
      if (!translated) throw new Error('翻译结果为空');
      const result = {
        text: translated,
        provider: name,
        cached: false,
        translated: true,
        chinese: false,
        machine: true,
      };
      await writeCache(key, result);
      return result;
    } catch (error) {
      attempts.push({ provider: name, message: error.message || String(error) });
    }
  }
  throw new TranslationError(
    'TRANSLATION_FAILED',
    `在线翻译暂时不可用（已尝试 ${attempts.length} 个服务）。请检查网络后重试。`,
    { attempts },
  );
}

// 供测试和本地调试使用。
export function clearTranslationMemoryCache() {
  memoryCache.clear();
}
