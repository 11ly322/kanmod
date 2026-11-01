// HTTP kernel: errors, request bodies, JSON responses, token auth, static files.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { APP_ROOT, DATA_DIR } from '../config.js';
import { ensureDir, writeFileAtomic, formatBytes } from '../util/fsx.js';
import { TranslationError } from '../translate.js';
import { CurseForgeError } from '../curseforge.js';
import { parseCookies, safeEqual } from './shared.js';

export const PUBLIC_DIR = path.join(APP_ROOT, 'public');
export const MAX_JSON_BODY = 4 * 1024 * 1024;
export const MAX_UPLOAD = 512 * 1024 * 1024;
export const COOKIE_NAME = 'kanmod_token';
const TOKEN_FILE = path.join(DATA_DIR, 'token');

export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function loadToken() {
  try {
    const saved = (await fs.readFile(TOKEN_FILE, 'utf8')).trim();
    if (saved.length >= 32) return saved;
  } catch {
    // Create a stable local token below.
  }
  const token = crypto.randomBytes(32).toString('hex');
  await ensureDir(path.dirname(TOKEN_FILE));
  await writeFileAtomic(TOKEN_FILE, `${token}\n`, { mode: 0o600 }).catch(() => writeFileAtomic(TOKEN_FILE, `${token}\n`));
  return token;
}

export function readBody(req, { limit = MAX_JSON_BODY } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `请求内容超过限制（${formatBytes(limit)}）。`, 'BODY_TOO_LARGE'));
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJsonBody(req) {
  const buffer = await readBody(req, { limit: MAX_JSON_BODY });
  if (!buffer.length) return {};
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new HttpError(400, '请求 JSON 格式不正确。', 'INVALID_JSON');
  }
}

export function sendJson(res, status, value) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

export function sendError(res, error) {
  const status = error?.status
    || (error instanceof TranslationError
      ? (error.code === 'TRANSLATION_DEMO_MISSING' ? 409 : 502)
      : (error?.code === 'CATALOG_LOAD_FAILED' ? 502 : (error instanceof CurseForgeError ? (error.code === 'CURSEFORGE_KEY_MISSING' ? 400 : 502) : 500)));
  const payload = {
    error: {
      message: error?.message || '服务器内部错误。',
      code: error?.code || 'INTERNAL_ERROR',
    },
  };
  if (error?.details) payload.error.details = error.details;
  if (error?.attempts) payload.error.attempts = error.attempts;
  if (error?.code !== 'INTERNAL_ERROR') console.warn(`[kanmod] ${error?.message || error}`);
  sendJson(res, status, payload);
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  }[ext] || 'application/octet-stream';
}

export function allowedHosts(context) {
  return [`127.0.0.1:${context.port}`, `localhost:${context.port}`, `[::1]:${context.port}`];
}

export function allowedOrigins(context) {
  return [`http://127.0.0.1:${context.port}`, `http://localhost:${context.port}`];
}

export function requestToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const header = req.headers['x-kanmod-token'];
  if (header) return String(header);
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

export function authorized(req, context) {
  return safeEqual(requestToken(req), context.token);
}

export async function serveStatic(req, res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  try {
    requested = decodeURIComponent(requested);
  } catch {
    sendJson(res, 400, { error: { message: '路径格式错误。', code: 'BAD_PATH' } });
    return;
  }
  if (requested.includes('\0')) {
    sendJson(res, 400, { error: { message: '路径格式错误。', code: 'BAD_PATH' } });
    return;
  }
  const absolute = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!absolute.startsWith(PUBLIC_DIR + path.sep) && absolute !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(res, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    return;
  }
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    sendJson(res, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    return;
  }
  const headers = {
    'Content-Type': mimeFor(absolute),
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (absolute.endsWith('.html')) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; ');
    headers['X-Frame-Options'] = 'DENY';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const data = await fs.readFile(absolute);
  res.end(data);
}
