// Shared state, formatting, icons and DOM primitives.


export const state = {
  bootstrap: null,
  view: 'overview',
  library: {
    source: 'catalog',
    q: '',
    status: 'all',
    sort: 'relevance',
    tag: '',
    size: '',
    page: 1,
    pageSize: 24,
    data: null,
    loading: false,
    error: null,
    translations: {},
    translationSeq: 0,
    cf: { page: 1, data: null, loading: false, error: null },
  },
  installed: null,
  installedLoading: false,
  installedFilter: 'all',
  batchMode: false,
  diagnostics: null,
  diagnosticsLoading: false,
  diagnosticsError: null,
  repairs: null,
  relationships: null,
  relationshipLoading: false,
  relationshipError: null,
  relationshipQuery: '',
  relationshipVersion: null,
  jobs: [],
  jobsFullLoaded: false,
  booking: false,
  sseOpen: false,
  lastFocus: null,
  confirmHandler: null,
  pendingPlan: null,
  pendingUpload: null,
  mod: null,
  bootError: null,
  reconnectTimer: null,
  reconnecting: false,
  sseEverOpen: false,
};


export const VIEW_META = {
  overview: { title: '总览', eyebrow: 'KANMOD · KSP MOD MANAGER', icon: 'home' },
  library: { title: '模组库', eyebrow: '探索 · 安装 · 版本', icon: 'box' },
  installed: { title: '已安装', eyebrow: '磁盘上的模组', icon: 'layers' },
  relations: { title: '依赖关系', eyebrow: '前置 · 依赖 · 冲突', icon: 'network' },
  diagnostics: { title: '问题诊断', eyebrow: '日志 · 兼容性 · 健康检查', icon: 'pulse' },
  jobs: { title: '下载队列', eyebrow: '任务 · 进度 · 日志', icon: 'download' },
  settings: { title: '设置', eyebrow: '实例 · 索引 · 网络', icon: 'settings' },
  mod: { title: '模组简介', eyebrow: '简介 · 翻译 · 版本', icon: 'book' },
};


export const ICONS = {
  home: '<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.2V21h13V9.2"/><path d="M9.5 21v-6h5v6"/>',
  box: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 7 9 5 9-5"/><path d="M3 7v10l9 5 9-5V7"/><path d="M12 12v10"/>',
  layers: '<path d="m12 2 9 4.5-9 4.5-9-4.5L12 2Z"/><path d="m3 11.5 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  network: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m8.2 7.4 2.3 8.2M15.8 7.4l-2.3 8.2M8.5 6h7"/>',
  pulse: '<path d="M3 12h4l2.2-6 3.4 12 2.4-6H21"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.1 15a1.7 1.7 0 0 0 .34 1.9l.06.06-2.5 2.5-.06-.06a1.7 1.7 0 0 0-1.9-.34 1.7 1.7 0 0 0-1 1.56V21h-3.5v-.1a1.7 1.7 0 0 0-1.08-1.56 1.7 1.7 0 0 0-1.9.34l-.06.06-2.5-2.5.06-.06A1.7 1.7 0 0 0 4.9 15a1.7 1.7 0 0 0-1.56-1H3.2v-3.5h.14A1.7 1.7 0 0 0 4.9 9.4a1.7 1.7 0 0 0-.34-1.9L4.5 7.4l2.5-2.5.06.06a1.7 1.7 0 0 0 1.9.34 1.7 1.7 0 0 0 1-1.56V3h3.5v.1a1.7 1.7 0 0 0 1.08 1.56 1.7 1.7 0 0 0 1.9-.34l.06-.06 2.5 2.5-.06.06a1.7 1.7 0 0 0-.34 1.9 1.7 1.7 0 0 0 1.56 1h.14v3.5h-.14a1.7 1.7 0 0 0-1.56 1Z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>',
  shield: '<path d="M12 3 5 6v5c0 4.4 2.9 7.7 7 10 4.1-2.3 7-5.6 7-10V6l-7-3Z"/><path d="m9.2 12 1.8 1.8 3.8-4"/>',
  check: '<path d="m5 12.5 4.2 4L19 6.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.2v.1"/>',
  terminal: '<path d="m4 6 5 6-5 6M11 18h9"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
  chart: '<path d="M4 20V5M4 20h17"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  rocket: '<path d="M14 4c3.5-1.2 6 .4 6 .4s1.6 2.5.4 6c-.9 2.6-3.8 5.7-7.4 7.4L8 13.9C9.8 10.3 11.4 5 14 4Z"/><circle cx="15.5" cy="8.5" r="1.4"/><path d="M8 14c-2.2.8-3.5 3.7-3.5 6.5 2.8 0 5.7-1.3 6.5-3.5M6.5 17.5 4 20"/>',
  file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 19a2.5 2.5 0 0 1 2.5-2.5H20"/><path d="M8 7h8M8 11h6"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c.6 3.2 2.7 5.5 5.5 6.7M11.5 5C11 8.2 9 10.6 6 12"/><path d="m13 20 4-9 4 9M14.6 17h4.8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="m11.2 10.8 8-8M16 5l3 3M14 7l3 3"/>',
};


export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;
}


export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}


export function truncate(value, max = 100) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}


export function fmtBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}


export function fmtNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}


export function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}


export function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}


export function initial(name) {
  const chars = Array.from(String(name || '?').trim());
  return esc((chars[0] || '?').toUpperCase());
}


export function shortId(identifier) {
  return String(identifier || '').replace(/^\[|\]$/g, '');
}


export function kindLabel(kind) {
  return ({
    package: '模组', mod: '模组', plugin: '插件', parts: '部件', library: '库', tool: '工具',
    configuration: '配置', metapackage: '元包',
  }[kind] || kind || '模组');
}


export function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}


export function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const element = document.createElement('div');
  element.className = `toast ${type === 'error' ? 'error' : type === 'warn' ? 'warn' : ''}`;
  const iconName = type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check';
  element.innerHTML = `${icon(iconName, 16)}<div>${esc(message)}</div>`;
  root.appendChild(element);
  setTimeout(() => {
    element.style.opacity = '0';
    element.style.transition = 'opacity .2s';
    setTimeout(() => element.remove(), 220);
  }, 4200);
}


export function spinnerLine(text = '加载中…') {
  return `<div class="empty" role="status"><span class="spinner"></span><p>${esc(text)}</p></div>`;
}


export function skeletonCards(count = 6) {
  return `<div class="loading-grid">${Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join('')}</div>`;
}


export function skeletonRows(count = 4) {
  return `<div>${Array.from({ length: count }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
}


export async function api(path, options = {}) {
  const { method = 'GET', body, raw, headers = {} } = options;
  const request = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
  };
  if (raw !== undefined) {
    request.body = raw;
    request.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(body);
  }
  let response;
  const retries = method === 'GET' ? 2 : 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(path, request);
      break;
    } catch (error) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        continue;
      }
      const networkError = new Error(`无法连接本地 kanmod 服务：${error.message}`);
      networkError.network = true;
      networkError.cause = error;
      throw networkError;
    }
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = data?.error?.code || null;
    error.data = data;
    throw error;
  }
  return data;
}


export function upsertJob(job) {
  if (!job) return;
  const index = state.jobs.findIndex((entry) => entry.id === job.id);
  if (index >= 0) state.jobs[index] = job;
  else state.jobs.unshift(job);
  state.jobs = state.jobs.slice(0, 80);
}


export function updateNavCounts() {
  const jobs = state.jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const counts = state.diagnostics?.counts;
  const issues = counts ? (counts.error || 0) + (counts.warning || 0) : 0;
  const jobNode = document.querySelector('[data-nav-count="jobs"]');
  const issueNode = document.querySelector('[data-nav-count="issues"]');
  if (jobNode) {
    jobNode.textContent = String(jobs);
    jobNode.hidden = jobs === 0;
  }
  if (issueNode) {
    issueNode.textContent = String(issues);
    issueNode.hidden = issues === 0;
  }
}


export function openModal(html, { small = false } = {}) {
  state.lastFocus = document.activeElement;
  setModalContent(html, { small });
}


export function setModalContent(html, { small = false } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-layer"><section class="modal ${small ? 'small' : ''}" role="dialog" aria-modal="true">${html}</section></div>`;
  lockScroll();
  setTimeout(() => {
    const target = root.querySelector('button:not([disabled]), input, select, textarea, [href]');
    target?.focus?.();
  }, 0);
}


export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  state.confirmHandler = null;
  state.pendingPlan = null;
  state.pendingUpload = null;
  unlockScroll();
  state.lastFocus?.focus?.();
}


export function openDrawer(html) {
  state.lastFocus = document.activeElement;
  setDrawerContent(html);
}


export function setDrawerContent(html) {
  const root = document.getElementById('drawer-root');
  if (!root) return;
  root.innerHTML = `<div class="drawer-layer"><aside class="drawer" role="dialog" aria-modal="true" aria-label="模组详情">${html}</aside></div>`;
  lockScroll();
}


export function closeDrawer() {
  const root = document.getElementById('drawer-root');
  if (root) root.innerHTML = '';
  unlockScroll();
  state.lastFocus?.focus?.();
}


export function lockScroll() {
  document.body.style.overflow = 'hidden';
}


export function unlockScroll() {
  if (!document.getElementById('modal-root')?.innerHTML && !document.getElementById('drawer-root')?.innerHTML) {
    document.body.style.overflow = '';
  }
}


export function confirmAction({ title, message, confirmText = '确认', onConfirm }) {
  state.confirmHandler = onConfirm;
  openModal(`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(message)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" data-action="run-confirm">${esc(confirmText)}</button></div>`, { small: true });
}


export async function runConfirm() {
  if (!state.confirmHandler) return;
  const handler = state.confirmHandler;
  const button = document.querySelector('[data-action="run-confirm"]');
  setBusy(button, true, '处理中…');
  try {
    await handler();
    closeModal();
  } catch (error) {
    setBusy(button, false);
    toast(error.message, 'error');
  }
}

