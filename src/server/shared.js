import crypto from 'node:crypto';

// Small shared helpers that are neither HTTP plumbing nor domain services.
export function nowIso() {
  return new Date().toISOString();
}

export function lower(value) {
  return String(value || '').toLowerCase();
}

export function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function hashId(value) {
  return crypto.createHash('sha256').update(String(value).toLowerCase()).digest('hex').slice(0, 12);
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const result = {};
  for (const chunk of String(header || '').split(';')) {
    const index = chunk.indexOf('=');
    if (index === -1) continue;
    const key = chunk.slice(0, index).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(chunk.slice(index + 1).trim());
  }
  return result;
}
