const state = {
  bootstrap: null,
  view: 'overview',
  library: {
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

const VIEW_META = {
  overview: { title: '总览', eyebrow: 'KANMOD · KSP MOD MANAGER', icon: 'home' },
  library: { title: '模组库', eyebrow: '探索 · 安装 · 版本', icon: 'box' },
  installed: { title: '已安装', eyebrow: '磁盘上的模组', icon: 'layers' },
  relations: { title: '依赖关系', eyebrow: '前置 · 依赖 · 冲突', icon: 'network' },
  diagnostics: { title: '问题诊断', eyebrow: '日志 · 兼容性 · 健康检查', icon: 'pulse' },
  jobs: { title: '下载队列', eyebrow: '任务 · 进度 · 日志', icon: 'download' },
  settings: { title: '设置', eyebrow: '实例 · 索引 · 网络', icon: 'settings' },
  mod: { title: '模组简介', eyebrow: '简介 · 翻译 · 版本', icon: 'book' },
};

const ICONS = {
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
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function truncate(value, max = 100) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function fmtBytes(bytes) {
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

function fmtNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function initial(name) {
  const chars = Array.from(String(name || '?').trim());
  return esc((chars[0] || '?').toUpperCase());
}

function shortId(identifier) {
  return String(identifier || '').replace(/^\[|\]$/g, '');
}

function kindLabel(kind) {
  return ({
    package: '模组', plugin: '插件', parts: '部件', library: '库', tool: '工具',
    configuration: '配置', metapackage: '元包',
  }[kind] || kind || '模组');
}

function compatibilityBadge(compatibility) {
  if (!compatibility) return '<span class="badge">兼容性未知</span>';
  const classes = {
    compatible: 'ok', warning: 'warn', incompatible: 'bad', unknown: 'info',
  };
  const labels = {
    compatible: '兼容', warning: '需留意', incompatible: '不兼容', unknown: '未知',
  };
  return `<span class="badge ${classes[compatibility.status] || 'info'}" title="${esc(compatibility.reason || '')}">${esc(compatibility.label || labels[compatibility.status] || '未知')}</span>`;
}

function actionBadge(action) {
  const map = {
    install: ['ok', '安装'], upgrade: ['warn', '升级'], downgrade: ['warn', '降级'], keep: ['', '已满足'],
  };
  const [variant, label] = map[action] || ['', action || '—'];
  return `<span class="badge ${variant}">${esc(label)}</span>`;
}

function managedBadge(entry) {
  if (entry?.managedBy === 'kanmod') return '<span class="badge ok dot">kanmod 管理</span>';
  if (entry?.managedBy === 'ckan') return '<span class="badge info">CKAN 管理</span>';
  return '<span class="badge">手动安装</span>';
}

function statusMeta(status) {
  return ({
    queued: ['clock', '等待中', ''], running: ['refresh', '进行中', 'info'],
    done: ['check', '已完成', 'ok'], failed: ['alert', '失败', 'bad'],
    cancelled: ['x', '已取消', ''],
  }[status] || ['info', status || '未知', '']);
}

function jobStatusBadge(status) {
  const [, label, variant] = statusMeta(status);
  return `<span class="badge ${variant}">${esc(label)}</span>`;
}

function constraintText(relation) {
  const parts = [];
  if (relation?.minVersion) parts.push(`≥ ${relation.minVersion}`);
  if (relation?.maxVersion) parts.push(`≤ ${relation.maxVersion}`);
  return parts.join(' · ');
}

function relationText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.message || value.reason || value.label || value.code || JSON.stringify(value);
}

function setBusy(button, busy, label = '处理中…') {
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

function toast(message, type = 'ok') {
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

function spinnerLine(text = '加载中…') {
  return `<div class="empty" role="status"><span class="spinner"></span><p>${esc(text)}</p></div>`;
}

function skeletonCards(count = 6) {
  return `<div class="loading-grid">${Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join('')}</div>`;
}

function skeletonRows(count = 4) {
  return `<div>${Array.from({ length: count }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
}

async function api(path, options = {}) {
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

function upsertJob(job) {
  if (!job) return;
  const index = state.jobs.findIndex((entry) => entry.id === job.id);
  if (index >= 0) state.jobs[index] = job;
  else state.jobs.unshift(job);
  state.jobs = state.jobs.slice(0, 80);
}

function updateNavCounts() {
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

function viewHtml() {
  if (!state.bootstrap) return spinnerLine('正在加载 kanmod…');
  if (state.view === 'library') return libraryHtml();
  if (state.view === 'installed') return installedHtml();
  if (state.view === 'relations') return relationsHtml();
  if (state.view === 'diagnostics') return diagnosticsHtml();
  if (state.view === 'jobs') return jobsHtml();
  if (state.view === 'settings') return settingsHtml();
  if (state.view === 'mod') return modPageHtml();
  return overviewHtml();
}

function renderView() {
  const root = document.getElementById('view-root');
  if (!root) return;
  root.innerHTML = viewHtml();
  updateNavCounts();
}

function renderApp() {
  if (!state.bootstrap) return;
  const app = document.getElementById('app');
  if (!app) return;
  const active = state.bootstrap.instance;
  const scan = state.bootstrap.scan;
  const meta = VIEW_META[state.view] || VIEW_META.overview;
  const nav = [
    ['overview', '总览'], ['library', '模组库'], ['installed', '已安装'],
    ['relations', '依赖关系'], ['diagnostics', '问题诊断'], ['jobs', '下载队列'],
    ['settings', '设置'],
  ].map(([id, label]) => {
    const countKey = id === 'jobs' ? 'jobs' : id === 'diagnostics' ? 'issues' : '';
    return `<button class="nav-item ${state.view === id ? 'active' : ''}" type="button" data-action="navigate" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>
      ${icon(VIEW_META[id].icon)}
      <span class="nav-text">${label}</span>
      ${countKey ? `<span class="nav-count" data-nav-count="${countKey}" hidden></span>` : ''}
    </button>`;
  }).join('');

  const instanceName = active?.name || '未连接 KSP';
  const instanceSub = active
    ? `${scan?.kspVersion ? `KSP ${scan.kspVersion}` : '版本未知'} · ${active.path}`
    : '连接游戏目录，开始管理模组';

  app.innerHTML = `
    <a class="skip-link" href="#view-root">跳到主要内容</a>
    <div class="app">
      <aside class="sidebar" aria-label="主导航">
        <a class="brand" href="#" data-action="navigate" data-view="overview" aria-label="kanmod 总览">
          <span class="brand-mark" aria-hidden="true">K<span></span></span>
          <span class="brand-copy"><strong>kanmod</strong><small>Kerbal mods, kept simple</small></span>
        </a>
        <div class="nav-label">工作台</div>
        <nav class="nav">${nav}</nav>
        <div class="sidebar-spacer"></div>
        <button class="instance-card" type="button" data-action="navigate" data-view="settings" aria-label="管理 KSP 实例">
          <span class="status-dot ${active ? '' : 'off'}" aria-hidden="true"></span>
          <span class="instance-copy"><strong>${esc(instanceName)}</strong><small>${esc(truncate(instanceSub, 42))}</small></span>
          ${icon('chevron', 15)}
        </button>
        <div class="sidebar-foot">
          <span>v${esc(state.bootstrap.app?.version || '0.0.6')}</span>
          <span>·</span>
          <span>本地运行</span>
          ${state.bootstrap.demo ? '<span class="demo-pill">演示</span>' : ''}
        </div>
      </aside>
      <div class="shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">${esc(meta.eyebrow)}</p>
            <h1>${esc(meta.title)}</h1>
          </div>
          <div class="topbar-actions">
            ${state.bootstrap.demo ? '<span class="demo-pill">演示模式</span>' : ''}
            ${active ? `<button class="btn ghost sm" type="button" data-action="refresh-scan">${icon('refresh', 15)}扫描模组</button>` : ''}
            <button class="btn icon ghost" type="button" data-action="trigger-archive" title="安装本地安装包" aria-label="安装本地安装包">${icon('upload')}</button>
            <button class="btn icon ghost" type="button" data-action="navigate" data-view="settings" title="设置" aria-label="设置">${icon('settings')}</button>
          </div>
        </header>
        <main class="main">
          <div id="view-root" class="view-root" tabindex="-1">${viewHtml()}</div>
        </main>
      </div>
    </div>
    <input id="archive-input" type="file" accept=".zip,.gz,.tgz,.tar.gz" hidden>
    <input id="catalog-upload-input" type="file" accept=".json,.zip,.gz,.tgz,.tar.gz" hidden>
  `;
  updateNavCounts();
  ensureViewData();
}

function ensureViewData() {
  if (!state.bootstrap) return;
  if (state.view === 'library' && !state.library.data && !state.library.loading) loadCatalog();
  if (state.view === 'installed' && !state.installed && !state.installedLoading) loadInstalled();
  if ((state.view === 'overview' || state.view === 'diagnostics') && !state.diagnostics && !state.diagnosticsLoading) loadDiagnostics();
  if (state.view === 'jobs' && !state.jobsFullLoaded) loadJobs();
  if (state.view === 'relations' && state.relationshipQuery && !state.relationships && !state.relationshipLoading) {
    loadRelationships(state.relationshipQuery, state.relationshipVersion);
  }
}

async function boot() {
  try {
    const data = await api('/api/bootstrap');
    applyBootstrap(data);
    state.library.pageSize = Number(data.settings?.ui?.pageSize) || 24;
    state.bootError = null;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    renderApp();
    startEvents();
  } catch (error) {
    state.bootError = error;
    renderFatal(error);
  }
}

function retryBoot() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '<div class="boot-screen"><span class="brand-mark">K<span></span></span><div><strong>kanmod</strong><p>正在重新连接…</p></div><span class="spinner"></span></div>';
  }
  boot();
}

function scheduleBootRetry() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (state.bootstrap || state.reconnecting) return;
    state.reconnecting = true;
    try {
      const data = await api('/api/bootstrap');
      applyBootstrap(data);
      state.library.pageSize = Number(data.settings?.ui?.pageSize) || 24;
      state.bootError = null;
      renderApp();
      startEvents();
    } catch (error) {
      state.bootError = error;
      const detail = document.getElementById('fatal-detail');
      if (detail) detail.textContent = `${error.message} · 正在自动重试…`;
      scheduleBootRetry();
    } finally {
      state.reconnecting = false;
    }
  }, 2200);
}

function applyBootstrap(data) {
  state.bootstrap = data;
  state.jobs = Array.isArray(data.jobs) ? data.jobs.map((job) => job) : [];
  state.jobsFullLoaded = false;
}

async function reloadBootstrap({ resetData = true, render = true } = {}) {
  const data = await api('/api/bootstrap');
  applyBootstrap(data);
  state.library.pageSize = Number(data.settings?.ui?.pageSize) || state.library.pageSize;
  if (resetData) {
    state.library.data = null;
    state.installed = null;
    state.diagnostics = null;
    state.diagnosticsError = null;
    state.repairs = null;
  }
  if (render) renderApp();
  return data;
}

function renderFatal(error) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="fatal">
      <div class="fatal-card">
        <span class="brand-mark" aria-hidden="true">K<span></span></span>
        <h1>kanmod 无法连接本地服务</h1>
        <p id="fatal-detail">${esc(error.message || String(error))} · 正在自动重试…</p>
        <button class="btn primary" type="button" data-action="boot-retry">立即重试</button>
        <p class="text-muted" style="margin-top:14px;font-size:11px">kanmod 会自动重启本地服务并重新连接；也可以关闭页面，从桌面快捷方式重新打开。</p>
      </div>
    </div>`;
  scheduleBootRetry();
}

function openOnboarding() {
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">KSP 1 · MOD WORKFLOW</p>
        <h2>把模组装好，<em>然后安心发射</em>。</h2>
        <p>kanmod 会自动找到你的 KSP 安装，索引 CKAN 模组与前置依赖，并在安装前检查版本兼容性。出现报错时，它会读日志、解释原因，只修复能够安全修复的部分。</p>
        <div class="hero-actions">
          <button class="btn primary" type="button" data-action="detect-instances">${icon('search', 16)}自动检测 KSP</button>
          <button class="btn ghost" type="button" data-action="add-instance">${icon('folder', 16)}手动选择目录</button>
        </div>
      </div>
      <div class="hero-mark" aria-hidden="true">${icon('rocket', 118)}</div>
    </section>
    <div class="notice red">
      ${icon('info', 18)}
      <div><strong>没有找到游戏实例。</strong> 选择包含 <code>GameData</code> 的 KSP 根目录即可开始。Steam 安装通常位于 <code>steamapps/common/Kerbal Space Program</code>。</div>
    </div>
    <div class="grid-3" style="margin-top:16px">
      <div class="card card-pad"><h3>自动解析前置</h3><p class="text-muted">从模组索引读取依赖关系，安装前展示完整计划，再按依赖顺序下载。</p></div>
      <div class="card card-pad"><h3>检测日志与冲突</h3><p class="text-muted">读取 KSP.log，归类缺失程序集、DLL 重复和版本不匹配，避免盲目覆盖。</p></div>
      <div class="card card-pad"><h3>只做安全修复</h3><p class="text-muted">自动修复只安装缺失前置；冲突移除等破坏性操作始终需要你确认。</p></div>
    </div>`;
}

function overviewHtml() {
  const data = state.bootstrap;
  if (!data.instance) return openOnboarding();
  const scan = data.scan;
  const diagnostics = state.diagnostics;
  const counts = diagnostics?.counts;
  const stats = data.stats || {};
  const catalog = data.catalog || {};
  const activeJobs = state.jobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const issues = diagnostics?.issues?.slice(0, 4) || [];
  const ksp = scan?.kspVersion || '未知版本';
  const instanceLabel = String(data.instance.name || '').replace(/^KSP\s*[\d.]+\s*·\s*/i, '');
  const health = diagnostics?.health;
  const problemCount = counts ? (counts.error || 0) + (counts.warning || 0) : null;

  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">KSP ${esc(ksp)} · ${esc(instanceLabel)}</p>
        <h2>让 <em>每一次发射</em> 都少一次崩溃。</h2>
        <p>当前游戏有 ${fmtNumber(stats.installed)} 个模组条目，索引中可检索 ${fmtNumber(catalog.count)} 个版本。kanmod 会优先展示兼容当前 KSP 的版本，并把前置依赖一起放进安装计划。</p>
        <div class="hero-actions">
          <button class="btn primary" type="button" data-action="navigate" data-view="library">${icon('box', 16)}浏览模组库</button>
          <button class="btn ghost" type="button" data-action="navigate" data-view="diagnostics">${icon('pulse', 16)}运行诊断</button>
          <button class="btn ghost" type="button" data-action="refresh-scan">${icon('refresh', 16)}重新扫描</button>
        </div>
      </div>
      <div class="hero-mark" aria-hidden="true">${icon('rocket', 112)}</div>
    </section>

    <div class="metrics">
      <div class="metric">
        <div class="metric-label">${icon('layers', 14)}已安装模组</div>
        <div class="metric-value">${fmtNumber(stats.installed)}<small>项</small></div>
        <div class="metric-foot">kanmod 管理 ${fmtNumber(stats.managed)} 项</div>
      </div>
      <div class="metric">
        <div class="metric-label">${icon('file', 14)}程序集</div>
        <div class="metric-value">${fmtNumber(stats.dlls)}<small>DLL</small></div>
        <div class="metric-foot">GameData 占用 ${esc(scan?.stats?.totalSizeLabel || '—')}</div>
      </div>
      <div class="metric red">
        <div class="metric-label">${icon('box', 14)}索引模组</div>
        <div class="metric-value">${fmtNumber(catalog.count)}<small>版本</small></div>
        <div class="metric-foot">${esc(catalog.identifierCount || 0)} 个独立模组</div>
      </div>
      <div class="metric ${problemCount ? 'red' : ''}">
        <div class="metric-label">${icon('alert', 14)}待处理问题</div>
        <div class="metric-value">${problemCount === null ? '—' : fmtNumber(problemCount)}<small>项</small></div>
        <div class="metric-foot">${counts ? `可自动修复 ${fmtNumber(counts.autoFixable)} 项` : '正在检查…'}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>健康状态</h3><button class="btn ghost sm" type="button" data-action="navigate" data-view="diagnostics">查看全部${icon('arrow', 13)}</button></div>
        <div class="card-body">
          ${state.diagnosticsLoading && !diagnostics ? skeletonRows(2) : ''}
          ${state.diagnosticsError ? `<div class="notice warn">${icon('alert', 16)}<div>诊断暂时失败：${esc(state.diagnosticsError)} <button class="btn sm ghost" type="button" data-action="retry-diagnostics">重试</button></div></div>` : ''}
          ${diagnostics ? `
            <div class="health-panel" style="padding:0 0 15px">
              <div class="health-ring" style="--score:${Number(health?.score) || 0}" role="img" aria-label="健康分 ${Number(health?.score) || 0}">
                <div class="score"><strong>${Number(health?.score) || 0}</strong><small>健康分</small></div>
              </div>
              <div class="health-copy">
                <h3>${esc(health?.label || '检查完成')}</h3>
                <p>${issues.length ? '这些是当前最值得处理的问题。' : '没有发现需要处理的报错。'}</p>
                <div class="health-counts">
                  <span class="badge bad">错误 ${fmtNumber(counts?.error)}</span>
                  <span class="badge warn">警告 ${fmtNumber(counts?.warning)}</span>
                  <span class="badge info">提示 ${fmtNumber(counts?.info)}</span>
                </div>
              </div>
            </div>
            ${issues.length ? issues.map((issue) => issueRow(issue, true)).join('') : '<div class="empty" style="padding:18px"><div class="empty-icon">' + icon('check') + '</div><strong>没有发现明显问题</strong><p>日志、依赖与版本检查都已通过。</p></div>'}
          ` : ''}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>任务队列</h3><button class="btn ghost sm" type="button" data-action="navigate" data-view="jobs">打开${icon('arrow', 13)}</button></div>
          <div class="card-body">
            ${activeJobs.length ? activeJobs.slice(0, 3).map((job) => jobCompact(job)).join('') : '<div class="empty" style="padding:18px"><div class="empty-icon">' + icon('download') + '</div><strong>队列空闲</strong><p>安装或刷新索引时会在这里显示进度。</p></div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>快捷操作</h3></div>
          <div class="card-body" style="display:flex;flex-wrap:wrap;gap:8px">
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="gamedata">${icon('folder', 14)}GameData</button>
            <button class="btn ghost sm" type="button" data-action="trigger-archive">${icon('upload', 14)}本地安装</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="log">${icon('terminal', 14)}打开日志</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="backups">${icon('archive', 14)}备份</button>
            <button class="btn ghost sm" type="button" data-action="navigate" data-view="relations">${icon('network', 14)}依赖图</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>最近安装</h3><button class="btn ghost sm" type="button" data-action="navigate" data-view="installed">全部已安装${icon('arrow', 13)}</button></div>
      <div class="card-body" style="padding-top:0">
        ${scan?.entries?.length ? installedTable(scan.entries.slice(0, 5), { compact: true }) : '<div class="empty" style="padding:22px"><div class="empty-icon">' + icon('layers') + '</div><strong>GameData 里还没有模组</strong><p>从模组库选择第一个模组，kanmod 会同时解析它的前置。</p></div>'}
      </div>
    </div>`;
}

function issueRow(issue, compact = false) {
  const severity = issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info';
  const iconName = severity === 'error' ? 'alert' : severity === 'warning' ? 'alert' : 'info';
  return `<div class="issue-row">
    <div class="issue-icon ${severity}">${icon(iconName, 15)}</div>
    <div class="issue-copy">
      <strong>${esc(issue.title || issue.code || '问题')}</strong>
      <p>${esc(truncate(issue.detail || '', compact ? 150 : 320))}</p>
    </div>
    <div class="issue-actions">${issueFixButton(issue)}</div>
  </div>`;
}

function issueFixButton(issue) {
  const fix = issue.fix;
  if (!fix) return '';
  if (fix.action === 'install' && fix.identifier) {
    return `<button class="btn soft sm" type="button" data-action="plan-install" data-id="${esc(fix.identifier)}" data-version="${esc(fix.version || '')}">${esc(fix.label || '修复')}</button>`;
  }
  if (fix.action === 'open-log') {
    return `<button class="btn ghost sm" type="button" data-action="open-folder" data-target="log">打开日志</button>`;
  }
  return '';
}

function installedTable(entries, { compact = false, batchMode = false } = {}) {
  return `<div class="table-wrap" style="${compact ? 'box-shadow:none;border:0' : ''}">
    <table>
      <thead><tr>${batchMode ? '<th class="check-cell"><span class="sr-only">选择</span></th>' : ''}<th>模组</th><th>版本</th><th>适用 KSP</th><th>管理</th>${compact ? '' : '<th>大小</th>'}<th class="right">操作</th></tr></thead>
      <tbody>${entries.map((entry) => {
        const key = entry.identifier || entry.folder || entry.name || '';
        return `
        <tr class="${entry.disabled ? 'row-disabled' : ''}">
          ${batchMode ? `<td class="check-cell"><input class="row-select" type="checkbox" value="${esc(key)}" aria-label="选择 ${esc(entry.name || entry.folder || key)}"></td>` : ''}
          <td><div class="table-mod"><span class="mini-avatar">${initial(entry.name)}</span><div><strong>${esc(entry.name || entry.folder)}</strong><small>${esc(entry.identifier || entry.folder || '')}${entry.disabled ? ' · 已禁用' : ''}</small></div></div></td>
          <td class="mono">${esc(entry.installedVersion || '—')}${entry.updateAvailable ? `<small class="update-hint">→ ${esc(entry.latestVersion)}</small>` : ''}</td>
          <td>${entry.kspVersion ? `<span class="badge">KSP ${esc(entry.kspVersion)}</span>` : '<span class="text-muted">未声明</span>'}</td>
          <td>${entry.disabled ? '<span class="badge muted">已禁用</span>' : managedBadge(entry)}</td>
          ${compact ? '' : `<td class="mono">${esc(entry.sizeLabel || fmtBytes(entry.size))}</td>`}
          <td><div class="row-actions">
            ${entry.identifier ? `<button class="btn ghost sm" type="button" data-action="open-mod-page" data-id="${esc(entry.identifier)}">${icon('book', 13)}简介</button>` : ''}
            ${entry.updateAvailable ? `<button class="btn primary sm" type="button" data-action="update-mod" data-id="${esc(entry.identifier)}" title="更新到 ${esc(entry.latestVersion)}">更新</button>` : ''}
            ${entry.disabled
              ? `<button class="btn soft sm" type="button" data-action="enable-mod" data-id="${esc(entry.identifier || entry.folder)}">${icon('play', 13)}启用</button>`
              : `<button class="btn ghost sm" type="button" data-action="disable-mod" data-id="${esc(entry.identifier || entry.folder)}">${icon('pause', 13)}禁用</button>`}
            <button class="btn danger sm" type="button" data-action="delete-mod" data-id="${esc(entry.identifier || entry.folder)}">${icon('trash', 13)}删除</button>
          </div></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  </div>`;
}

function libraryHtml() {
  const lib = state.library;
  const catalog = state.bootstrap.catalog || {};
  const statuses = [
    ['all', '全部'], ['compatible', '兼容'], ['installed', '已安装'], ['updatable', '可更新'],
  ];
  return `
    <div class="page-head">
      <div><h2>发现模组</h2><p>检索 CKAN 索引，查看版本兼容性。安装前会先解析前置依赖并给出完整计划。</p></div>
      <div class="head-aside">
        <button class="btn ghost" type="button" data-action="trigger-archive">${icon('upload', 15)}本地安装包</button>
        <button class="btn ghost" type="button" data-action="refresh-catalog" ${state.bootstrap.demo ? 'title="演示模式不联网刷新"' : ''}>${icon('refresh', 15)}刷新索引</button>
      </div>
    </div>
    ${!catalog.loaded ? `<div class="notice warn">${icon('alert', 18)}<div><strong>索引还没有加载。</strong> 在设置中刷新 CKAN 官方索引，或导入本地 JSON 索引。</div></div>` : ''}
    <form class="toolbar" data-form="library-search" role="search">
      <label class="search">
        <span class="sr-only">搜索模组</span>
        ${icon('search', 15)}
        <input id="library-q" name="q" type="search" value="${esc(lib.q)}" placeholder="搜索模组名、标识、作者或标签…" autocomplete="off">
      </label>
      <div class="seg" role="group" aria-label="筛选">
        ${statuses.map(([id, label]) => `<button type="button" class="${lib.status === id ? 'active' : ''}" data-action="library-status" data-status="${id}">${label}</button>`).join('')}
      </div>
      <select id="library-tag" class="select" aria-label="按标签筛选">
        <option value="">全部标签</option>
        ${(lib.data?.facets?.tags || []).map((facet) => `<option value="${esc(facet.tag)}" ${lib.tag === facet.tag ? 'selected' : ''}>${esc(facet.tag)} · ${fmtNumber(facet.count)}</option>`).join('')}
      </select>
      <select id="library-size" class="select" aria-label="按下载体积筛选">
        ${[['', '全部大小'], ['small', '小于 1 MB'], ['medium', '1–20 MB'], ['large', '大于 20 MB']].map(([id, label]) => `<option value="${id}" ${lib.size === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <select id="library-sort" class="select" aria-label="排序">
        ${[['relevance', '相关度'], ['name', '名称'], ['size', '体积'], ['version', '版本']].map(([id, label]) => `<option value="${id}" ${lib.sort === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button class="btn primary" type="submit">${icon('search', 14)}搜索</button>
    </form>
    <div id="library-body">${libraryBodyHtml()}</div>`;
}

function libraryBodyHtml() {
  const lib = state.library;
  if (lib.error) {
    return `<div class="empty"><div class="empty-icon">${icon('alert')}</div><strong>读取模组库失败</strong><p>${esc(lib.error)}</p><button class="btn primary" type="button" data-action="retry-library">重试</button></div>`;
  }
  if (!lib.data) {
    if (lib.loading) return skeletonCards(6);
    return `<div class="empty"><div class="empty-icon">${icon('box')}</div><strong>还没有可展示的模组</strong><p>刷新索引后再试。</p><button class="btn ghost" type="button" data-action="refresh-catalog">刷新索引</button></div>`;
  }
  const data = lib.data;
  const items = data.items || [];
  if (!items.length) {
    return `<div class="results-meta"><span>没有匹配的模组</span><span>${lib.loading ? '<span class="spinner"></span>' : ''}</span></div>
      <div class="empty"><div class="empty-icon">${icon('search')}</div><strong>没有结果</strong><p>换一个关键词，或把筛选切回“全部”。</p><button class="btn ghost" type="button" data-action="clear-library-filter">清除筛选</button></div>`;
  }
  return `<div class="results-meta">
      <span>共 ${fmtNumber(data.total)} 个模组 · 第 ${data.page} / ${data.pageCount} 页</span>
      <span>${lib.loading ? '<span class="spinner"></span> 更新中…' : esc(state.bootstrap.catalog?.sourceName || 'CKAN 索引')}</span>
    </div>
    <div class="mod-grid">${items.map(modCard).join('')}</div>
    ${data.pageCount > 1 ? `<div class="pagination">
      <button class="btn ghost sm" type="button" data-action="library-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${data.page} / ${data.pageCount} 页</span>
      <button class="btn ghost sm" type="button" data-action="library-page" data-page="${data.page + 1}" ${data.page >= data.pageCount ? 'disabled' : ''}>下一页</button>
    </div>` : ''}`;
}

function modCard(item) {
  const installed = item.installed
    ? `<span class="installed-flag"><span class="badge ok dot">已安装${item.installedVersion ? ` ${esc(item.installedVersion)}` : ''}</span></span>`
    : '';
  return `<article class="mod-card">
    ${installed}
    <div class="mod-card-top">
      <span class="mod-avatar" aria-hidden="true">${initial(item.name)}</span>
      <div class="mod-title"><h3 title="${esc(item.name)}">${esc(item.name)}</h3><span class="mod-id">${esc(item.identifier)}</span></div>
    </div>
    <p class="mod-abstract">${esc(item.abstract || '这个模组还没有简介。')}</p>
    <div class="mod-meta">${compatibilityBadge(item.compatibility)}<span class="tag">${esc(kindLabel(item.kind))}</span>${item.downloadSize ? `<span class="tag">${esc(fmtBytes(item.downloadSize))}</span>` : ''}</div>
    <div class="mod-foot">
      <span class="version">v${esc(item.version)}</span>
      <div class="mod-actions">
        <button class="btn ghost sm" type="button" data-action="open-mod-page" data-id="${esc(item.identifier)}" data-version="${esc(item.version)}">${icon('book', 13)}简介</button>
        <button class="btn ${item.installed ? 'soft' : 'primary'} sm" type="button" data-action="plan-install" data-id="${esc(item.identifier)}" data-version="${esc(item.version)}">${item.installed ? '管理' : '安装'}</button>
      </div>
    </div>
  </article>`;
}

function installedHtml() {
  const data = state.installed;
  const scan = data?.scan || state.bootstrap.scan;
  if (!state.bootstrap.instance) return openOnboarding();
  if (state.installedLoading && !data) return `<div class="page-head"><div><h2>已安装</h2><p>正在扫描 GameData…</p></div></div>${skeletonRows(5)}`;
  const allEntries = data?.installed || scan?.entries || [];
  const disabled = data?.disabled || [];
  const updates = data?.updates || [];
  const records = data?.records || [];
  const filter = state.installedFilter || 'all';
  const entries = allEntries.filter((entry) => {
    if (filter === 'updates') return entry.updateAvailable;
    if (filter === 'disabled') return entry.disabled;
    if (filter === 'manual') return !entry.managed || entry.managedBy === 'manual';
    return true;
  });
  const broken = records.filter((record) => !allEntries.some((entry) => shortId(entry.identifier) === shortId(record.identifier)));
  return `
    <div class="page-head">
      <div><h2>已安装模组</h2><p>扫描到 ${fmtNumber(allEntries.length)} 个模组条目${disabled.length ? `，其中 ${disabled.length} 个已禁用` : ''}。禁用会把整个模组移出 GameData；删除会先移入回收站。</p></div>
      <div class="head-aside">
        ${updates.length ? `<button class="btn primary" type="button" data-action="open-updates">${icon('refresh', 15)}快捷更新 ${updates.length}</button>` : ''}
        <button class="btn ${state.batchMode ? 'soft' : 'ghost'}" type="button" data-action="toggle-batch">${icon('check', 15)}${state.batchMode ? '退出批量' : '批量管理'}</button>
        <button class="btn ghost" type="button" data-action="open-folder" data-target="gamedata">${icon('folder', 15)}GameData</button>
        <button class="btn ghost" type="button" data-action="refresh-scan">${icon('refresh', 15)}重新扫描</button>
      </div>
    </div>
    <div class="seg installed-filters" role="group" aria-label="筛选已安装模组">
      ${[['all', `全部 ${allEntries.length}`], ['updates', `可更新 ${updates.length}`], ['disabled', `已禁用 ${disabled.length}`], ['manual', '手动安装']].map(([id, label]) => `<button type="button" class="${filter === id ? 'active' : ''}" data-action="installed-filter" data-filter="${id}">${label}</button>`).join('')}
    </div>
    ${state.batchMode ? `<div class="batch-bar" id="batch-bar">
      <label class="batch-check"><input type="checkbox" id="batch-all">全选</label>
      <span class="batch-count" id="batch-count">0 项已选</span>
      <div class="batch-actions">
        <button class="btn ghost sm" type="button" data-action="batch-disable">${icon('pause', 14)}禁用</button>
        <button class="btn ghost sm" type="button" data-action="batch-enable">${icon('play', 14)}启用</button>
        <button class="btn danger sm" type="button" data-action="batch-delete">${icon('trash', 14)}删除</button>
      </div>
    </div>` : ''}
    ${disabled.length ? `<div class="notice">${icon('pause', 18)}<div><strong>${disabled.length} 个模组已禁用。</strong> 文件保存在 KSP/DisabledMods，不会进入游戏；点“启用”可原位恢复。</div></div>` : ''}
    ${broken.length ? `<div class="notice warn">${icon('alert', 18)}<div><strong>有 ${broken.length} 条安装记录在磁盘上找不到对应目录。</strong> 可能是手动删除或安装未完成。到问题诊断运行一次检查。</div></div>` : ''}
    ${scan?.duplicates?.length ? `<div class="notice red">${icon('alert', 18)}<div><strong>发现 ${scan.duplicates.length} 组重复 DLL。</strong> 重复程序集可能导致启动报错，请到问题诊断查看。</div></div>` : ''}
    <div class="card" style="margin-top:14px">
      ${entries.length ? installedTable(entries, { batchMode: state.batchMode }) : allEntries.length ? `<div class="empty"><div class="empty-icon">${icon('search')}</div><strong>当前筛选没有模组</strong><p>换一个筛选条件，或切回“全部”。</p><button class="btn ghost" type="button" data-action="installed-filter" data-filter="all">查看全部</button></div>` : `<div class="empty"><div class="empty-icon">${icon('layers')}</div><strong>GameData 里还没有模组</strong><p>安装第一个模组后，它会出现在这里。</p><button class="btn primary" type="button" data-action="navigate" data-view="library">浏览模组库</button></div>`}
    </div>`;
}

function modPageHtml() {
  if (!state.bootstrap?.instance) return openOnboarding();
  const mod = state.mod;
  if (!mod) return `<div class="empty"><div class="empty-icon">${icon('book')}</div><strong>还没有选择模组</strong><p>从模组库打开一个模组简介。</p><button class="btn primary" type="button" data-action="navigate" data-view="library">打开模组库</button></div>`;
  if (mod.loading) {
    return `<button class="btn ghost sm" type="button" data-action="mod-back">${icon('chevron', 14)}返回模组库</button>
      <div class="mod-page-loading">${spinnerLine(`正在读取 ${mod.identifier} 的简介…`)}</div>`;
  }
  if (mod.error || !mod.data) {
    return `<button class="btn ghost sm" type="button" data-action="mod-back">${icon('chevron', 14)}返回模组库</button>
      <div class="empty card" style="margin-top:16px"><div class="empty-icon">${icon('alert')}</div><strong>读取简介失败</strong><p>${esc(mod.error || '索引中没有这个模组。')}</p><button class="btn primary" type="button" data-action="retry-mod">重试</button></div>`;
  }
  const data = mod.data;
  const pkg = data.package;
  const relations = data.relationships || {};
  const versions = data.versions || [];
  const installed = data.installed;
  const compatibility = data.compatibility;
  const abstract = pkg.abstract || '这个模组还没有简介。';
  const description = String(pkg.description || '').trim();
  return `
    <div class="mod-page-head">
      <div>
        <button class="btn ghost sm mod-back" type="button" data-action="mod-back">${icon('chevron', 14)}返回模组库</button>
        <div class="mod-page-title">
          <span class="mod-avatar xl" aria-hidden="true">${initial(pkg.name)}</span>
          <div>
            <p class="eyebrow">模组简介 · ${esc(kindLabel(pkg.kind))}</p>
            <h2>${esc(pkg.name)}</h2>
            <div class="mod-page-sub"><span class="mono">${esc(pkg.identifier)}</span><span>v${esc(pkg.version)}</span>${installed ? `<span class="badge ok dot">已安装 ${esc(installed)}</span>` : ''}</div>
          </div>
        </div>
        <div class="mod-page-badges">${compatibilityBadge(compatibility)}${pkg.releaseStatus && pkg.releaseStatus !== 'stable' ? `<span class="badge warn">${esc(pkg.releaseStatus)}</span>` : ''}<span class="badge">${esc(kindLabel(pkg.kind))}</span></div>
      </div>
      <div class="head-aside">
        <button class="btn primary" type="button" data-action="plan-install" data-id="${esc(pkg.identifier)}" data-version="${esc(pkg.version)}">${icon('download', 15)}${installed ? '查看安装计划' : '安装模组'}</button>
      </div>
    </div>
    ${compatibility?.status === 'incompatible' || compatibility?.status === 'warning' ? `<div class="notice ${compatibility.status === 'incompatible' ? 'red' : 'warn'}" style="margin-top:14px">${icon('alert', 18)}<div><strong>${esc(compatibility.label || '版本兼容性提示')}</strong> ${esc(compatibility.reason || '')}</div></div>` : ''}
    <div class="mod-page-grid">
      <div class="stack">
        <section class="card mod-intro-card">
          <div class="card-head"><h3>${icon('book', 15)}简介</h3><span class="badge red">中文</span></div>
          <p class="mod-page-abstract">${esc(abstract)}</p>
          ${translationCard('abstract', '自动翻译简介')}
        </section>
        ${galleryHtml()}
        <section class="card mod-description-card">
          <div class="card-head"><h3>${icon('file', 15)}说明</h3>${description ? `<button class="btn ghost sm" type="button" data-action="translate-mod" data-field="description" data-force="1">${icon('translate', 14)}翻译全文</button>` : ''}</div>
          ${translationCard('description', '自动翻译完整说明')}
          ${description ? `<details class="mod-source" open><summary>英文原文</summary><div class="mod-description">${esc(description)}</div></details>` : '<div class="empty" style="padding:16px"><p>这个模组没有提供详细说明。</p></div>'}
        </section>
        ${relationSummaryHtml(relations)}
      </div>
      <aside class="stack">
        <section class="card mod-side-card">
          <div class="card-head"><h3>模组信息</h3></div>
          <dl class="mod-detail-list">
            <div><dt>当前版本</dt><dd class="mono">${esc(pkg.version)}</dd></div>
            <div><dt>作者</dt><dd>${esc(pkg.author || '未注明')}</dd></div>
            <div><dt>适用 KSP</dt><dd>${esc(pkg.kspVersion || (pkg.kspVersionMin || pkg.kspVersionMax ? `${pkg.kspVersionMin || '?'} – ${pkg.kspVersionMax || '?'}` : '未声明'))}</dd></div>
            <div><dt>下载体积</dt><dd>${esc(fmtBytes(pkg.downloadSize))}</dd></div>
            <div><dt>许可证</dt><dd>${esc(pkg.license || '未注明')}</dd></div>
            <div><dt>标识</dt><dd class="mono">${esc(pkg.identifier)}</dd></div>
          </dl>
          <div class="mod-link-row">
            ${pkg.resources?.homepage ? `<a class="btn ghost sm" href="${esc(pkg.resources.homepage)}" target="_blank" rel="noreferrer">${icon('link', 13)}主页</a>` : ''}
            ${pkg.resources?.repository ? `<a class="btn ghost sm" href="${esc(pkg.resources.repository)}" target="_blank" rel="noreferrer">${icon('link', 13)}仓库</a>` : ''}
            ${pkg.resources?.spacedock ? `<a class="btn ghost sm" href="${esc(pkg.resources.spacedock)}" target="_blank" rel="noreferrer">${icon('link', 13)}SpaceDock</a>` : ''}
          </div>
        </section>
        <section class="card mod-side-card">
          <div class="card-head"><h3>可用版本</h3><span class="text-muted">${fmtNumber(versions.length)} 个</span></div>
          <div class="version-list mod-version-list">
            ${versions.map((entry) => `<button class="version-chip ${entry.version === pkg.version ? 'active' : ''}" type="button" data-action="mod-version" data-id="${esc(pkg.identifier)}" data-version="${esc(entry.version)}" title="${esc(entry.compatibility?.reason || '')}">${esc(entry.version)}</button>`).join('') || '<span class="text-muted">索引中没有其它版本。</span>'}
          </div>
        </section>
      </aside>
    </div>`;
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function translationCard(field, title) {
  const mod = state.mod;
  if (!mod?.data) return '';
  const pkg = mod.data.package;
  const source = field === 'description' ? pkg.description : pkg.abstract;
  if (!String(source || '').trim()) return '';
  const translation = mod.translations?.[field];
  const loading = mod.translationLoading?.[field];
  const error = mod.translationErrors?.[field];
  if (hasCjk(source) && !translation) {
    return `<div class="translation-card muted"><span class="translation-icon">${icon('check', 14)}</span><div><strong>原文已是中文</strong><p>这段简介无需自动翻译。</p></div></div>`;
  }
  let body = '';
  if (loading) {
    body = `<div class="translation-loading"><span class="spinner"></span><span>正在检索并翻译…</span></div>`;
  } else if (error) {
    body = `<div class="translation-error"><span>${esc(error)}</span><button class="btn ghost sm" type="button" data-action="translate-mod" data-field="${esc(field)}" data-force="1">重试</button></div>`;
  } else if (translation) {
    body = `<div class="translation-text">${esc(translation.text)}</div>
      <div class="translation-meta">
        <span class="badge ${translation.machine ? 'warn' : 'ok'}">${translation.machine ? '机器翻译' : '内置中文'}</span>
        <span>${esc(translation.provider || '本地')}</span>
        <span>·</span>
        <span>${translation.machine ? '仅供理解，以原文为准' : '已缓存'}</span>
        <button class="btn ghost sm" type="button" data-action="translate-mod" data-field="${esc(field)}" data-force="1">${icon('refresh', 12)}重新翻译</button>
      </div>`;
  } else {
    body = `<div class="translation-start"><span>还没有中文翻译。</span><button class="btn soft sm" type="button" data-action="translate-mod" data-field="${esc(field)}">${icon('translate', 14)}立即翻译</button></div>`;
  }
  return `<div class="translation-card">
    <div class="translation-head"><span><span class="translation-icon">${icon('translate', 14)}</span><strong>${esc(title)}</strong></span><span class="translation-source">${translation?.cached ? '缓存命中' : '自动检索'}</span></div>
    ${body}
  </div>`;
}

function relationSummaryHtml(relations) {
  const depends = relations.depends || [];
  const recommends = relations.recommends || [];
  const dependents = relations.dependents || [];
  if (!depends.length && !recommends.length && !dependents.length) return '';
  const item = (relation, kind) => `<button class="relation-item" type="button" data-action="open-mod-page" data-id="${esc(relation.identifier || relation.name)}">
    <span class="rel-name"><strong>${esc(relation.displayName || relation.name)}</strong><small>${esc(relation.identifier || relation.name)}${constraintText(relation) ? ` · ${esc(constraintText(relation))}` : ''}</small></span>
    <span class="badge ${kind === 'depends' ? (relation.installedVersion ? 'ok' : relation.available ? '' : 'bad') : ''}">${kind === 'depends' ? (relation.installedVersion ? `已装 ${esc(relation.installedVersion)}` : relation.available ? '必需' : '缺失') : kind === 'recommends' ? '推荐' : '依赖此模组'}</span>
  </button>`;
  return `<section class="card mod-relations-card">
    <div class="card-head"><h3>${icon('network', 15)}依赖与关联</h3><button class="btn ghost sm" type="button" data-action="open-relations" data-id="${esc(state.mod.data.package.identifier)}" data-version="${esc(state.mod.data.package.version)}">${icon('network', 13)}查看依赖图</button></div>
    ${depends.length ? `<div class="mod-relation-group"><span class="mod-relation-label">必需前置</span>${depends.map((relation) => item(relation, 'depends')).join('')}</div>` : ''}
    ${recommends.length ? `<div class="mod-relation-group"><span class="mod-relation-label">推荐模组</span>${recommends.map((relation) => item(relation, 'recommends')).join('')}</div>` : ''}
    ${dependents.length ? `<div class="mod-relation-group"><span class="mod-relation-label">被这些模组依赖</span>${dependents.map((relation) => item(relation, 'dependent')).join('')}</div>` : ''}
  </section>`;
}

function diagnosticsHtml() {
  if (!state.bootstrap.instance) return openOnboarding();
  const diagnostics = state.diagnostics;
  const counts = diagnostics?.counts;
  if (state.diagnosticsLoading && !diagnostics) {
    return `<div class="page-head"><div><h2>问题诊断</h2><p>正在扫描 GameData、依赖关系与 KSP 日志…</p></div></div>${skeletonRows(5)}`;
  }
  if (state.diagnosticsError && !diagnostics) {
    return `<div class="page-head"><div><h2>问题诊断</h2><p>诊断请求失败。</p></div></div><div class="empty"><div class="empty-icon">${icon('alert')}</div><strong>无法完成诊断</strong><p>${esc(state.diagnosticsError)}</p><button class="btn primary" type="button" data-action="retry-diagnostics">重试</button></div>`;
  }
  return `
    <div class="page-head">
      <div><h2>问题诊断</h2><p>检查模组依赖、KSP 版本兼容性、重复 DLL 以及 KSP.log 中的异常。自动修复只会安装缺失或明确可更新的前置。</p></div>
      <div class="head-aside">
        <button class="btn ghost" type="button" data-action="refresh-scan">${icon('refresh', 15)}重新扫描</button>
        <button class="btn primary" type="button" data-action="repair-preview" ${counts?.autoFixable ? '' : 'disabled'}>${icon('shield', 15)}一键修复${counts?.autoFixable ? ` (${counts.autoFixable})` : ''}</button>
      </div>
    </div>
    ${diagnostics ? `
      <div class="card">
        <div class="health-panel">
          <div class="health-ring" style="--score:${Number(diagnostics.health?.score) || 0}" role="img" aria-label="健康分 ${Number(diagnostics.health?.score) || 0}">
            <div class="score"><strong>${Number(diagnostics.health?.score) || 0}</strong><small>健康分</small></div>
          </div>
          <div class="health-copy">
            <h3>${esc(diagnostics.health?.label || '检查完成')}</h3>
            <p>生成于 ${esc(fmtDate(diagnostics.generatedAt))}。共检查 ${fmtNumber(diagnostics.mods?.length)} 个模组条目。</p>
            <div class="health-counts">
              <span class="badge bad">错误 ${fmtNumber(counts?.error)}</span>
              <span class="badge warn">警告 ${fmtNumber(counts?.warning)}</span>
              <span class="badge info">提示 ${fmtNumber(counts?.info)}</span>
              <span class="badge ok">可自动修复 ${fmtNumber(counts?.autoFixable)}</span>
            </div>
          </div>
          <div style="margin-left:auto;display:flex;flex-wrap:wrap;gap:7px">
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="log">${icon('terminal', 14)}日志</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="gamedata">${icon('folder', 14)}GameData</button>
          </div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:16px;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr)">
        <div class="stack">
          <div class="section-title">需要处理 <span class="sub">${fmtNumber(diagnostics.issues?.length)} 项</span></div>
          ${diagnostics.issues?.length ? diagnostics.issues.map((issue) => issueCard(issue)).join('') : `<div class="empty card"><div class="empty-icon">${icon('check')}</div><strong>一切正常</strong><p>没有发现依赖、兼容性或日志问题。</p></div>`}
        </div>
        <div class="stack">
          <div class="section-title">日志异常 <span class="sub">${fmtNumber(diagnostics.log?.errors?.length ?? diagnostics.log?.stats?.errorGroups ?? 0)} 组</span></div>
          ${diagnostics.log ? logPanel(diagnostics.log) : '<div class="card"><div class="empty" style="padding:20px"><p>未读取到日志。</p></div></div>'}
        </div>
      </div>
    ` : ''}`;
}

function issueCard(issue) {
  return `<div class="issue-card">
    <div class="issue-main">
      <div class="issue-icon ${issue.severity}">${icon(issue.severity === 'error' ? 'alert' : issue.severity === 'warning' ? 'alert' : 'info', 15)}</div>
      <div class="issue-copy">
        <strong>${esc(issue.title || issue.code)}</strong>
        <p class="issue-detail">${esc(issue.detail || '')}</p>
      </div>
      <span class="badge ${issue.severity === 'error' ? 'bad' : issue.severity === 'warning' ? 'warn' : 'info'}">${esc(issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '提示')}</span>
    </div>
    <div class="issue-footer">
      <span class="mono">${esc(issue.code)}</span>
      ${(issue.mods || []).slice(0, 4).map((name) => `<span class="tag">${esc(name)}</span>`).join('')}
      <span style="margin-left:auto">${issueFixButton(issue)}</span>
    </div>
  </div>`;
}

function logPanel(log) {
  const errors = log.errors || [];
  if (!errors.length) {
    return `<div class="card"><div class="empty" style="padding:20px"><div class="empty-icon">${icon('check')}</div><strong>没有异常日志</strong><p>${esc(log.source || '未找到日志文件')}</p></div></div>`;
  }
  return `<div class="card" style="padding:14px">
    <div class="results-meta" style="margin:0 0 10px"><span>${esc(log.source ? log.source.split(/[\\\\/]/).pop() : 'KSP.log')}</span><span>${fmtNumber(log.stats?.errors || errors.length)} 类异常</span></div>
    ${errors.map((entry) => `<details class="issue-card" style="box-shadow:none;margin-top:8px">
      <summary style="cursor:pointer;display:flex;gap:8px;align-items:flex-start">
        <span class="badge ${entry.level === 'ERR' || entry.level === 'EXC' ? 'bad' : 'warn'}">${esc(entry.level || 'ERR')}</span>
        <span style="flex:1;min-width:0"><strong style="font-size:11.5px">${esc(truncate(entry.message, 150))}</strong><small class="text-muted" style="display:block;margin-top:3px">出现 ${fmtNumber(entry.count)} 次 ${entry.files?.length ? `· ${entry.files.length} 个相关文件` : ''}</small></span>
      </summary>
      ${entry.context ? `<pre class="code-context">${esc(entry.context)}</pre>` : ''}
      <div class="issue-footer" style="margin-top:8px">${(entry.mods || []).map((name) => `<span class="tag">${esc(name)}</span>`).join('')}</div>
    </details>`).join('')}
  </div>`;
}

function relationsHtml() {
  if (!state.bootstrap.instance) return openOnboarding();
  const query = state.relationshipQuery;
  const data = state.relationships;
  const suggestions = relationSuggestions();
  return `
    <div class="page-head">
      <div><h2>依赖关系</h2><p>查看一个模组的前置、推荐、冲突与被依赖情况。虚线表示推荐或可选关系，红色表示冲突。</p></div>
      <div class="head-aside"><button class="btn ghost" type="button" data-action="navigate" data-view="library">${icon('box', 15)}打开模组库</button></div>
    </div>
    <form class="toolbar" data-form="relation-search" role="search">
      <label class="search">${icon('search', 15)}<span class="sr-only">输入模组标识</span>
        <input id="relation-q" name="identifier" list="relation-options" value="${esc(query)}" placeholder="输入模组标识，例如 ModuleManager…" autocomplete="off">
      </label>
      <button class="btn primary" type="submit">查看关系</button>
      <datalist id="relation-options">${suggestions.map((item) => `<option value="${esc(item.identifier)}">${esc(item.name)}</option>`).join('')}</datalist>
    </form>
    ${!query ? `<div class="empty card"><div class="empty-icon">${icon('network')}</div><strong>选择一个模组开始</strong><p>可以输入标识，或从下面的已安装模组中快速选择。</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:6px">${suggestions.slice(0, 6).map((item) => `<button class="btn ghost sm" type="button" data-action="show-relations" data-id="${esc(item.identifier)}">${esc(item.name)}</button>`).join('')}</div>
    </div>` : ''}
    ${state.relationshipLoading ? spinnerLine('正在解析依赖关系…') : ''}
    ${state.relationshipError ? `<div class="empty card"><div class="empty-icon">${icon('alert')}</div><strong>无法读取依赖关系</strong><p>${esc(state.relationshipError)}</p><button class="btn primary" type="button" data-action="retry-relations">重试</button></div>` : ''}
    ${data && !state.relationshipLoading ? relationGraphPage(data) : ''}`;
}

function relationSuggestions() {
  const seen = new Set();
  const list = [];
  for (const entry of state.bootstrap?.scan?.entries || []) {
    if (!entry.identifier) continue;
    const key = shortId(entry.identifier).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ identifier: shortId(entry.identifier), name: entry.name || entry.identifier });
  }
  for (const item of state.library.data?.items || []) {
    const key = shortId(item.identifier).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ identifier: item.identifier, name: item.name });
  }
  return list.slice(0, 60);
}

function relationGraphPage(data) {
  const pkg = data.package;
  const relations = data.relationships;
  return `
    <div class="graph-layout">
      <div class="card graph-card">
        <div class="graph-toolbar">
          <span class="badge red">${esc(pkg.name)} ${esc(pkg.version)}</span>
          <span class="text-muted" style="font-size:10.5px">${esc(pkg.identifier)}</span>
          <span style="margin-left:auto;display:flex;gap:6px"><button class="btn ghost sm" type="button" data-action="open-mod" data-id="${esc(pkg.identifier)}" data-version="${esc(pkg.version)}">打开详情</button></span>
        </div>
        <div class="graph-canvas">${graphSvg(pkg, relations)}</div>
        <div class="graph-legend"><span><i></i>依赖 / 被依赖</span><span><i class="red"></i>冲突</span><span><i style="border-top:1px dashed #ded8db;background:none"></i>推荐 / 可选</span></div>
      </div>
      <div class="card">
        ${relationSection('前置依赖', relations.depends, 'depends')}
        ${relationSection('推荐', relations.recommends, 'recommends')}
        ${relationSection('可选 / 建议', relations.suggests, 'suggests')}
        ${relationSection('冲突', relations.conflicts, 'conflicts')}
        ${relationSection('被这些模组依赖', relations.dependents, 'dependents')}
        ${relations.provides?.length ? `<div class="relation-section"><h3>提供虚拟标识</h3><div class="version-list">${relations.provides.map((name) => `<span class="version-chip">${esc(name)}</span>`).join('')}</div></div>` : ''}
      </div>
    </div>`;
}

function relationSection(title, list, type) {
  if (!list?.length) return '';
  return `<div class="relation-section"><h3>${esc(title)} <span class="badge" style="margin-left:auto">${fmtNumber(list.length)}</span></h3>
    <div class="relation-list">${list.map((relation) => relationItem(relation, type)).join('')}</div>
  </div>`;
}

function relationItem(relation, type) {
  const versions = constraintText(relation);
  const installed = relation.installedVersion;
  const availability = installed
    ? `<span class="badge ok">已装 ${esc(installed)}</span>`
    : relation.available
      ? '<span class="badge">可获取</span>'
      : '<span class="badge bad">缺失</span>';
  const disabled = !relation.available || !relation.identifier;
  return `<button class="relation-item" type="button" ${disabled ? 'disabled' : ''} ${disabled ? '' : `data-action="open-mod" data-id="${esc(relation.identifier)}"`}>
    <span class="rel-name"><strong>${esc(relation.displayName || relation.name || relation.identifier || '未知')}</strong><small>${esc(relation.identifier || relation.name || '')}${versions ? ` · ${esc(versions)}` : ''}</small></span>
    <span class="rel-status">${availability}</span>
  </button>`;
}

function graphSvg(pkg, relations) {
  const width = 900;
  const depends = (relations.depends || []).slice(0, 10);
  const dependents = (relations.dependents || []).slice(0, 10);
  const conflicts = (relations.conflicts || []).slice(0, 4);
  const rows = Math.max(depends.length, dependents.length, conflicts.length);
  const height = Math.max(390, 100 + rows * 54);
  const centerY = height / 2;
  const centerX = 365;
  const leftX = 20;
  const rightX = 705;
  const edges = [];
  const nodes = [];
  const centerWidth = 175;

  function box(x, y, w, label, sub, center, available, identifier) {
    const fill = center ? 'center' : '';
    const node = `<g class="graph-node ${fill}" ${available && identifier && !center ? `data-action="open-mod" data-id="${esc(identifier)}"` : ''}>
      <rect x="${x}" y="${y}" width="${w}" height="36" rx="9"/>
      <text x="${x + 10}" y="${y + 16}">${esc(truncate(label, 21))}</text>
      <text class="node-sub" x="${x + 10}" y="${y + 28}">${esc(truncate(sub, 25))}</text>
      <title>${esc(label)} ${esc(sub)}</title>
    </g>`;
    nodes.push(node);
  }

  depends.forEach((relation, index) => {
    const y = centerY - (depends.length - 1) * 27 + index * 54 - 18;
    box(leftX, y, 180, relation.displayName || relation.name, relation.installedVersion ? `已装 ${relation.installedVersion}` : '前置', false, relation.available, relation.identifier);
    edges.push(`<path class="graph-edge" d="M${leftX + 180} ${y + 18} C 270 ${y + 18}, 270 ${centerY}, ${centerX} ${centerY}"/>`);
  });
  dependents.forEach((relation, index) => {
    const y = centerY - (dependents.length - 1) * 27 + index * 54 - 18;
    box(rightX, y, 175, relation.name || relation.identifier, relation.installed ? '已安装' : '依赖此模组', false, true, relation.identifier);
    edges.push(`<path class="graph-edge" d="M${centerX + centerWidth} ${centerY} C 625 ${centerY}, 625 ${y + 18}, ${rightX} ${y + 18}"/>`);
  });
  conflicts.forEach((relation, index) => {
    const y = centerY + (index+1) * 44 - 6;
    box(leftX + 40, y, 180, relation.displayName || relation.name, '冲突', false, relation.available, relation.identifier);
    edges.push(`<path class="graph-edge red" d="M${leftX + 220} ${y + 18} C 300 ${y + 18}, 300 ${centerY + 10}, ${centerX} ${centerY + 10}"/>`);
  });

  box(centerX, centerY - 18, centerWidth, pkg.name || pkg.identifier, pkg.version || '', true, false, pkg.identifier);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(pkg.name)} 的依赖关系图">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ded8db"/></marker></defs>
    ${edges.join('')}
    <text class="graph-label" x="${leftX}" y="28">前置</text>
    <text class="graph-label" x="${centerX}" y="28">当前模组</text>
    <text class="graph-label" x="${rightX}" y="28">被依赖</text>
    ${nodes.join('')}
  </svg>`;
}

function jobCompact(job) {
  const percent = Math.max(0, Math.min(100, Number(job.progress?.percent) || 0));
  return `<div class="issue-row">
    <div class="issue-icon ${job.status === 'failed' ? 'error' : job.status === 'done' ? '' : 'warning'}">${icon(job.status === 'done' ? 'check' : job.status === 'failed' ? 'alert' : 'refresh', 15)}</div>
    <div class="issue-copy"><strong>${esc(job.title)}</strong><p>${esc(job.progress?.message || '等待执行…')}</p>
      <div class="progress" style="margin:8px 0 0"><span style="width:${percent}%"></span></div>
    </div>
    <div class="issue-actions">${jobStatusBadge(job.status)}</div>
  </div>`;
}

function jobsHtml() {
  const jobs = state.jobs || [];
  return `
    <div class="page-head">
      <div><h2>下载与安装队列</h2><p>任务按顺序执行。可以展开日志查看每个下载源的尝试过程；取消任务会尽力停止当前下载。</p></div>
      <div class="head-aside"><button class="btn ghost" type="button" data-action="refresh-jobs">${icon('refresh', 15)}刷新</button></div>
    </div>
    ${jobs.length ? jobs.map(jobCard).join('') : `<div class="empty card"><div class="empty-icon">${icon('download')}</div><strong>队列是空的</strong><p>安装模组、刷新索引或自动修复都会在这里生成任务。</p><button class="btn ghost" type="button" data-action="navigate" data-view="library">浏览模组库</button></div>`}`;
}

function jobCard(job) {
  const percent = Math.max(0, Math.min(100, Number(job.progress?.percent) || 0));
  const active = job.status === 'queued' || job.status === 'running';
  const logs = (job.logs || []).slice(-35).map((line) => `[${fmtTime(line.at)}] ${line.message}`).join('\n');
  const status = statusMeta(job.status);
  return `<div class="job-card">
    <div class="job-head">
      <div class="job-status-icon ${job.status === 'running' ? 'running' : job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : ''}">${icon(status[0], 15)}</div>
      <div class="job-title"><strong>${esc(job.title)}</strong><small>${esc(job.type || 'task')} · 创建于 ${esc(fmtDate(job.createdAt))}</small></div>
      ${jobStatusBadge(job.status)}
      ${active ? `<button class="btn danger sm" type="button" data-action="cancel-job" data-id="${esc(job.id)}">取消</button>` : ''}
    </div>
    <div class="progress"><span style="width:${percent}%"></span></div>
    <div class="job-progress-line"><span>${esc(job.progress?.message || '等待执行…')}</span><span>${percent}%${job.progress?.current != null && job.progress?.total ? ` · ${job.progress.current}/${job.progress.total}` : ''}</span></div>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ''}
    ${logs ? `<details class="job-logs"><summary>执行日志（${job.logs.length} 条）</summary><pre class="job-log">${esc(logs)}</pre></details>` : ''}
  </div>`;
}

function settingsHtml() {
  const data = state.bootstrap;
  const s = data.settings || {};
  const install = s.install || {};
  const network = s.network || {};
  const catalog = s.catalog || {};
  const ui = s.ui || {};
  const catalogStatus = data.catalog || {};
  const enabled = new Set(catalog.enabledSources || ['official']);
  const customSources = catalog.customSources || [];
  const builtinSources = (data.sources || []).filter((source) => !source.custom && source.id !== 'custom');
  const canNetwork = !data.demo;
  return `
    <div class="page-head">
      <div><h2>kanmod 设置</h2><p>管理 KSP 实例、索引源、下载策略与界面偏好。所有设置保存在本地 <code>${esc(s.dataDir || '')}</code>。</p></div>
      <div class="head-aside">${data.demo ? '<span class="demo-pill">演示模式</span>' : ''}</div>
    </div>
    <form id="settings-form" data-form="settings">
      <div class="settings-grid">
        <section class="card form-section">
          <h3>${icon('layers', 15)}KSP 实例</h3>
          <p class="section-desc">kanmod 通过实例读取 GameData 与日志。切换实例会重新扫描。</p>
          ${(data.instances || []).length ? (data.instances || []).map((instance) => `
            <div class="instance-row">
              <div class="instance-info"><strong>${esc(instance.name)}</strong><small>${esc(instance.path)}</small></div>
              ${instance.id === data.activeInstanceId ? '<span class="badge ok dot">当前</span>' : `<button class="btn ghost sm" type="button" data-action="select-instance" data-id="${esc(instance.id)}">切换</button>`}
              <button class="btn icon ghost" type="button" data-action="delete-instance" data-id="${esc(instance.id)}" title="移除实例记录" aria-label="移除实例 ${esc(instance.name)}">${icon('trash', 14)}</button>
            </div>`).join('') : '<div class="notice">还没有实例。</div>'}
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">
            <button class="btn primary sm" type="button" data-action="detect-instances">${icon('search', 14)}自动检测</button>
            <button class="btn ghost sm" type="button" data-action="add-instance">${icon('plus', 14)}手动添加</button>
          </div>
          ${data.instanceError ? `<div class="notice warn" style="margin-top:10px">${icon('alert', 15)}<div>${esc(data.instanceError)}</div></div>` : ''}
        </section>

        <section class="card form-section">
          <h3>${icon('download', 15)}安装策略</h3>
          <p class="section-desc">这些选项决定安装计划与写盘时的行为。</p>
          ${switchRow('backupOverwrite', '覆盖前备份', '目标文件已存在且内容不同时，先备份到数据目录。', install.backupOverwrite !== false)}
          ${switchRow('allowWarning', '允许兼容性警告', 'KSP 版本不精确匹配、但可能正常工作时仍允许安装。', Boolean(install.allowWarning))}
          ${switchRow('allowUnknown', '允许未知版本', '模组未声明 KSP 版本时允许安装。', Boolean(install.allowUnknown))}
          ${switchRow('keepDownloads', '保留下载缓存', '安装完成后保留下载的压缩包，便于重装或离线使用。', install.keepDownloads !== false)}
        </section>

        <section class="card form-section" style="grid-column:1/-1">
          <h3>${icon('network', 15)}索引源</h3>
          <p class="section-desc">安装模组时会按直链、镜像前缀、GitHub Releases、SpaceDock 的顺序回退。索引只用于读取 CKAN 元数据。</p>
          ${builtinSources.map((source) => `
            <label class="source-row">
              <span class="switch"><input type="checkbox" data-enabled-source value="${esc(source.id)}" ${enabled.has(source.id) ? 'checked' : ''} aria-label="启用 ${esc(source.name)}"><span></span></span>
              <span class="source-copy"><strong>${esc(source.name)} ${source.id === 'official' ? '<span class="badge red">推荐</span>' : ''}</strong><small>${esc(source.description || source.homepage || '')}</small></span>
            </label>`).join('')}
          <div id="custom-source-list">
            <div class="section-title" style="margin:15px 0 6px">自定义索引 <span class="sub">tar.gz / zip / JSON</span></div>
            ${customSources.map(customSourceRow).join('')}
          </div>
          <div class="field-row" style="margin-top:8px">
            <div class="field"><label for="new-source-name">名称</label><input id="new-source-name" type="text" placeholder="例如：本地镜像"></div>
            <div class="field" style="flex:2"><label for="new-source-url">地址</label><input id="new-source-url" type="url" placeholder="https://example.com/CKAN-meta.tar.gz"></div>
            <button class="btn ghost" type="button" data-action="append-source">${icon('plus', 14)}添加</button>
          </div>
          <div class="divider"></div>
          ${switchRow('autoRefresh', '自动刷新索引', '启动时如果缓存超过 24 小时，尝试在后台刷新。', catalog.autoRefresh !== false)}
          <div class="field-row" style="margin-top:8px">
            <div class="field" style="flex:2"><label for="catalog-url">从 URL 导入索引</label><input id="catalog-url" type="url" placeholder="https://example.com/catalog.json" ${canNetwork ? '' : 'disabled'}></div>
            <button class="btn ghost" type="button" data-action="import-catalog" ${canNetwork ? '' : 'disabled'}>导入</button>
            <button class="btn ghost" type="button" data-action="upload-catalog" ${canNetwork ? '' : 'disabled'}>${icon('upload', 14)}上传文件</button>
          </div>
          ${data.demo ? '<div class="notice" style="margin-top:10px">' + icon('info', 15) + '<div>演示模式使用内置索引，不访问网络。</div></div>' : ''}
          <div class="results-meta" style="margin:12px 0 0">
            <span>${catalogStatus.loaded ? `已加载 ${fmtNumber(catalogStatus.count)} 个版本 · ${fmtNumber(catalogStatus.identifierCount)} 个模组` : '索引尚未加载'}</span>
            <span>${catalogStatus.loadedAt ? `更新于 ${fmtDate(catalogStatus.loadedAt)}` : ''} ${catalogStatus.stale ? '<span class="badge warn">已过期</span>' : ''}</span>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
            <button class="btn primary sm" type="button" data-action="refresh-catalog" ${canNetwork ? '' : 'disabled'}>${icon('refresh', 14)}刷新 CKAN 索引</button>
            <button class="btn ghost sm" type="button" data-action="export-catalog">${icon('download', 14)}导出当前索引</button>
          </div>
        </section>

        <section class="card form-section">
          <h3>${icon('network', 15)}网络与下载</h3>
          <p class="section-desc">超时时间以秒为单位；镜像前缀支持 <code>{url}</code> 占位符。</p>
          <div class="field-row">
            <div class="field"><label for="timeoutSeconds">请求超时（秒）</label><input id="timeoutSeconds" name="timeoutSeconds" type="number" min="5" max="300" value="${esc(network.timeoutSeconds || 45)}"></div>
            <div class="field"><label for="downloadTimeoutSeconds">下载超时（秒）</label><input id="downloadTimeoutSeconds" name="downloadTimeoutSeconds" type="number" min="30" max="1800" value="${esc(network.downloadTimeoutSeconds || 180)}"></div>
          </div>
          <div class="field"><label for="maxDownloadMB">单包大小上限（MB）</label><input id="maxDownloadMB" name="maxDownloadMB" type="number" min="64" max="8192" value="${esc(network.maxDownloadMB || 2048)}"></div>
          <div class="field"><label for="mirrorPrefixes">镜像前缀（每行一个）</label><textarea id="mirrorPrefixes" name="mirrorPrefixes" placeholder="https://ghproxy.net/{url}&#10;https://mirror.example.com/">${esc((network.mirrorPrefixes || []).join('\n'))}</textarea><span class="hint">没有填写 {url} 时，前缀会直接拼接原始下载地址。建议只添加可信镜像。</span></div>
          ${switchRow('allowInsecureHttp', '允许 HTTP 源', '默认拒绝明文 HTTP。只有在信任的局域网镜像上才打开。', Boolean(network.allowInsecureHttp))}
          <div class="notice" style="margin-top:10px">${icon('shield', 15)}<div>下载过程会校验索引中提供的 SHA256（若存在）。所有安装文件都必须落在 KSP 目录内。</div></div>
        </section>

        <section class="card form-section">
          <h3>${icon('settings', 15)}界面与数据</h3>
          <p class="section-desc">界面只保存轻量偏好，不包含账号信息。</p>
          <div class="field"><label for="pageSize">模组库每页数量</label><input id="pageSize" name="pageSize" type="number" min="6" max="96" value="${esc(ui.pageSize || 24)}"></div>
          ${switchRow('autoTranslate', '自动翻译模组简介', '打开模组简介时自动检索并翻译英文简介。机器翻译仅供参考，原文始终保留。', ui.autoTranslate !== false)}
          <div class="divider"></div>
          <div class="field">
            <label>应用更新</label>
            <span class="hint">通过安装目录中的更新程序检查 GitHub 最新版本。更新会保留游戏模组与数据。</span>
          </div>
          <div id="app-update-status" class="text-muted" style="font-size:10.5px;line-height:1.6;margin-bottom:8px">当前版本 v${esc(data.app?.version || '0.0.6')}。更新程序随安装器一起安装。</div>
          <button class="btn ghost sm" type="button" data-action="check-update">${icon('refresh', 14)}检查更新</button>
          <div class="field"><label>数据目录</label><input type="text" value="${esc(s.dataDir || '')}" readonly></div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="data">${icon('folder', 14)}打开数据目录</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="backups">${icon('archive', 14)}备份</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="trash">${icon('trash', 14)}回收站</button>
          </div>
          <div class="divider"></div>
          <div class="text-muted" style="font-size:10.5px;line-height:1.6">
            kanmod ${esc(data.app?.version || '0.0.6')} · 本地服务仅在 127.0.0.1 监听。演示数据位于临时目录时可随时重建。
          </div>
        </section>
      </div>
      <div class="settings-actions">
        <button class="btn primary" type="submit">${icon('check', 15)}保存设置</button>
      </div>
    </form>`;
}

async function checkAppUpdate(button) {
  const status = document.getElementById('app-update-status');
  if (button) button.disabled = true;
  if (status) status.textContent = '正在启动更新程序…';
  try {
    await api('/api/app/update', { method: 'POST', body: {} });
    if (status) status.innerHTML = `<span class="badge ok">更新程序已启动</span> 按更新窗口提示完成，完成后会重新启动 kanmod。`;
    toast('更新程序已启动。', 'success');
  } catch (error) {
    const releaseUrl = error.data?.error?.details?.releaseUrl;
    if (status) {
      status.innerHTML = releaseUrl
        ? `未找到本机更新程序。<a href="${esc(releaseUrl)}" target="_blank" rel="noreferrer">打开发布页下载新版安装器</a>。`
        : esc(error.message);
    }
    toast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function switchRow(name, title, description, checked) {
  return `<label class="switch-row">
    <span class="switch-copy"><strong>${esc(title)}</strong><small>${esc(description)}</small></span>
    <span class="switch"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}><span></span></span>
  </label>`;
}

function customSourceRow(source) {
  const id = source.id || `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `<div class="source-row" data-custom-source data-id="${esc(id)}">
    <label class="switch"><input class="source-enabled" type="checkbox" ${source.enabled !== false ? 'checked' : ''} aria-label="启用索引 ${esc(source.name || '')}"><span></span></label>
    <div class="source-copy" style="display:flex;flex-direction:column;gap:4px">
      <input class="select source-name" type="text" value="${esc(source.name || '')}" placeholder="索引名称" aria-label="索引名称">
      <input class="select source-url" type="url" value="${esc(source.url || '')}" placeholder="索引 URL" aria-label="索引地址">
    </div>
    <button class="btn icon ghost" type="button" data-action="remove-source" title="移除索引" aria-label="移除索引">${icon('trash', 14)}</button>
  </div>`;
}

async function loadCatalog() {
  if (state.library.loading) return;
  state.library.loading = true;
  state.library.error = null;
  if (state.view === 'library') renderLibraryBody();
  const params = new URLSearchParams({
    q: state.library.q,
    page: String(state.library.page),
    pageSize: String(state.library.pageSize),
    sort: state.library.sort,
    status: state.library.status,
    tag: state.library.tag,
    size: state.library.size,
  });
  try {
    const data = await api(`/api/catalog?${params.toString()}`);
    state.library.data = data;
    state.library.page = data.page || state.library.page;
    state.library.pageSize = data.pageSize || state.library.pageSize;
    state.library.error = null;
    updateLibraryFacets(data);
  } catch (error) {
    state.library.error = error.message;
  } finally {
    state.library.loading = false;
    if (state.view === 'library') renderLibraryBody();
  }
}

function renderLibraryBody() {
  const body = document.getElementById('library-body');
  if (body) body.innerHTML = libraryBodyHtml();
}

function updateLibraryFacets(data) {
  const select = document.getElementById('library-tag');
  if (!select || !data?.facets?.tags) return;
  const current = state.library.tag;
  select.innerHTML = `<option value="">全部标签</option>${data.facets.tags.map((facet) => `<option value="${esc(facet.tag)}">${esc(facet.tag)} · ${fmtNumber(facet.count)}</option>`).join('')}`;
  select.value = current;
}

async function loadJobs() {
  try {
    const data = await api('/api/jobs');
    state.jobs = data.jobs || [];
    state.jobsFullLoaded = true;
    updateNavCounts();
    if (state.view === 'jobs' || state.view === 'overview') renderView();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadInstalled() {
  if (state.installedLoading) return;
  state.installedLoading = true;
  if (state.view === 'installed') renderView();
  try {
    state.installed = await api('/api/installed');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.installedLoading = false;
    if (state.view === 'installed') renderView();
  }
}

async function loadDiagnostics({ force = false } = {}) {
  if (state.diagnosticsLoading) return;
  if (!state.bootstrap?.instance) return;
  if (state.diagnostics && !force) return;
  state.diagnosticsLoading = true;
  state.diagnosticsError = null;
  if (state.view === 'overview' || state.view === 'diagnostics') renderView();
  try {
    const data = await api('/api/diagnostics?log=1');
    state.diagnostics = data.diagnostics;
    state.repairs = data.repairs;
    state.diagnosticsError = null;
  } catch (error) {
    state.diagnosticsError = error.message;
  } finally {
    state.diagnosticsLoading = false;
    if (state.view === 'overview' || state.view === 'diagnostics') renderView();
    updateNavCounts();
  }
}

async function loadRelationships(identifier, version = null) {
  if (!identifier) return;
  state.relationshipQuery = identifier;
  state.relationshipVersion = version || null;
  state.relationshipLoading = true;
  state.relationshipError = null;
  state.relationships = null;
  if (state.view === 'relations') renderView();
  const params = new URLSearchParams({ identifier });
  if (version) params.set('version', version);
  try {
    state.relationships = await api(`/api/relationships?${params.toString()}`);
  } catch (error) {
    state.relationshipError = error.message;
  } finally {
    state.relationshipLoading = false;
    if (state.view === 'relations') renderView();
  }
}

async function refreshScan() {
  const button = document.querySelector('[data-action="refresh-scan"]');
  setBusy(button, true, '扫描中…');
  try {
    const data = await api('/api/scan?refresh=1');
    await reloadBootstrap({ resetData: true });
    toast(`扫描完成：${data.scan?.stats?.modCount || 0} 个模组条目`);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function refreshCatalog() {
  if (state.bootstrap.demo) {
    toast('演示模式不访问网络，内置索引已经就绪。', 'warn');
    return;
  }
  const button = document.querySelector('[data-action="refresh-catalog"]');
  setBusy(button, true, '创建任务…');
  try {
    const data = await api('/api/catalog/refresh', { method: 'POST', body: {} });
    upsertJob(data.job);
    state.view = 'jobs';
    renderApp();
    toast('索引刷新任务已开始');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function detectInstances() {
  const button = document.querySelector('[data-action="detect-instances"]');
  setBusy(button, true, '检测中…');
  try {
    const result = await api('/api/instances/detect', { method: 'POST', body: {} });
    await reloadBootstrap({ resetData: true });
    if (result.count) toast(`找到 ${result.count} 个 KSP 实例`);
    else toast('没有自动找到 KSP。请手动选择包含 GameData 的游戏目录。', 'warn');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function addInstanceModal() {
  openModal(`
    <div class="modal-head"><div><h2>添加 KSP 实例</h2><p>选择包含 <code>GameData</code> 文件夹的 KSP 1 根目录。</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <form data-form="instance-add">
      <div class="modal-body">
        <div class="field"><label for="instance-path">游戏目录</label><input id="instance-path" name="path" type="text" required placeholder="D:\\SteamLibrary\\steamapps\\common\\Kerbal Space Program"><span class="hint">也可以填写 GOG 或手动解压版本的根目录。</span></div>
        <div class="field"><label for="instance-name">显示名称（可选）</label><input id="instance-name" name="name" type="text" placeholder="例如：1.12.5 主存档"></div>
        <div class="notice">${icon('info', 16)}<div>kanmod 只读取该目录下的 GameData 与日志，不会写入 KSP 安装目录之外。</div></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">添加并连接</button></div>
    </form>`, { small: true });
}

async function selectInstance(id) {
  const button = document.querySelector(`[data-action="select-instance"][data-id="${CSS.escape(id)}"]`);
  setBusy(button, true, '切换中…');
  try {
    await api('/api/instances/select', { method: 'POST', body: { id } });
    await reloadBootstrap({ resetData: true });
    toast('已切换 KSP 实例');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function deleteInstance(id) {
  const instance = (state.bootstrap.instances || []).find((entry) => entry.id === id);
  confirmAction({
    title: '移除实例记录',
    message: `确定从 kanmod 中移除“${instance?.name || id}”吗？这不会删除游戏或模组文件。`,
    confirmText: '移除',
    onConfirm: async () => {
      await api(`/api/instances/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reloadBootstrap({ resetData: true });
      toast('实例记录已移除');
    },
  });
}

function uninstall(identifier) {
  const entry = (state.installed?.scan?.entries || state.bootstrap.scan?.entries || [])
    .find((item) => shortId(item.identifier) === shortId(identifier));
  confirmAction({
    title: '卸载模组',
    message: `“${entry?.name || identifier}”的文件会被移动到 kanmod 回收站，而不是直接删除。确定继续吗？`,
    confirmText: '移到回收站',
    onConfirm: async () => {
      const result = await api('/api/uninstall', { method: 'POST', body: { identifier } });
      await reloadBootstrap({ resetData: true });
      if (state.view === 'installed') await loadInstalled();
      toast(`已移动 ${result.moved || 0} 个文件到回收站`);
    },
  });
}

function findManagedEntry(id) {
  const entries = state.installed?.installed || state.installed?.scan?.entries || state.bootstrap.scan?.entries || [];
  const disabled = state.installed?.disabled || [];
  return [...entries, ...disabled].find((entry) => {
    const keys = [entry.identifier, entry.folder, entry.name, entry.id];
    return keys.some((key) => key && shortId(key) === shortId(id)) || entry.id === id;
  });
}

async function afterModChange(message) {
  await reloadBootstrap({ resetData: true, render: false });
  await loadInstalled();
  toast(message);
}

function disableManagedMod(id) {
  const entry = findManagedEntry(id);
  confirmAction({
    title: '禁用模组',
    message: `“${entry?.name || id}”会整个移到 KSP/DisabledMods，游戏将不再加载它。文件不会删除，随时可以启用。`,
    confirmText: '禁用',
    onConfirm: async () => {
      await api('/api/mods/disable', { method: 'POST', body: { identifier: entry?.identifier || id } });
      await afterModChange('模组已禁用，重新启动 KSP 后生效');
    },
  });
}

function enableManagedMod(id) {
  const entry = findManagedEntry(id);
  confirmAction({
    title: '启用模组',
    message: `“${entry?.name || id}”会从 KSP/DisabledMods 移回原来的 GameData 位置。若原位置已有同名文件，kanmod 不会覆盖。`,
    confirmText: '启用',
    onConfirm: async () => {
      await api('/api/mods/enable', { method: 'POST', body: { identifier: entry?.identifier || id } });
      await afterModChange('模组已启用，重新启动 KSP 后生效');
    },
  });
}

function deleteManagedMod(id) {
  const entry = findManagedEntry(id);
  confirmAction({
    title: '删除模组',
    message: `“${entry?.name || id}”会移动到 kanmod 回收站，不会直接擦除。若这是手动安装的模组，整个顶层文件夹都会一起移走。`,
    confirmText: '移到回收站',
    onConfirm: async () => {
      const result = await api('/api/mods/delete', {
        method: 'POST',
        body: { identifier: entry?.identifier || id, folder: entry?.folder || id },
      });
      await afterModChange(result.moved === false ? '没有找到可移动的文件，安装记录已清理' : '模组已移入回收站');
    },
  });
}

async function updateManagedMod(id) {
  const button = document.querySelector(`[data-action="update-mod"][data-id="${CSS.escape(id)}"]`);
  setBusy(button, true, '准备更新…');
  try {
    const data = await api('/api/mods/update', { method: 'POST', body: { identifier: id } });
    if (!data.job) {
      toast(data.message || '这个模组已经是最新版本');
      await loadInstalled();
      return;
    }
    upsertJob(data.job);
    state.view = 'jobs';
    renderApp();
    toast('更新任务已开始，前置会一起处理');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function updateAllMods() {
  const updates = state.installed?.updates || [];
  if (!updates.length) {
    toast('当前没有可更新的模组');
    return;
  }
  runUpdate(updates.map((item) => item.identifier));
}

function updateSelectedMods() {
  const ids = [...document.querySelectorAll('#update-manager .update-select:checked')]
    .map((input) => input.value)
    .filter(Boolean);
  if (!ids.length) {
    toast('请先选择要更新的模组', 'warn');
    return;
  }
  runUpdate(ids);
}

async function runUpdate(identifiers) {
  const button = document.querySelector('[data-action="update-selected"], [data-action="update-all"]');
  setBusy(button, true, '准备更新…');
  try {
    const data = await api('/api/mods/update', { method: 'POST', body: { identifiers } });
    closeModal();
    if (!data.job) {
      toast(data.message || '选中的模组已经是最新版本');
      await loadInstalled();
      return;
    }
    upsertJob(data.job);
    navigate('jobs');
    toast(`更新任务已开始（${data.updates?.length || identifiers.length} 个模组）`);
  } catch (error) {
    toast(error.message, 'error');
    setBusy(button, false);
  }
}

function openUpdateManager() {
  const updates = state.installed?.updates || [];
  if (!updates.length) {
    toast('当前没有可更新的模组');
    return;
  }
  const rows = updates.map((item) => {
    const compatible = item.latestCompatibility;
    return `<label class="update-item">
      <input class="update-select" type="checkbox" value="${esc(item.identifier)}" checked>
      <span class="update-copy"><strong>${esc(item.name || item.identifier)}</strong><small>${esc(item.identifier)} · ${esc(item.installedVersion || item.version || '—')} → ${esc(item.latestVersion)}</small></span>
      <span class="update-target">${esc(item.latestVersion)}</span>
      ${compatible ? compatibilityBadge(compatible) : '<span class="badge">兼容</span>'}
    </label>`;
  }).join('');
  setModalContent(`<div class="modal-head"><div><h2>快捷更新管理器</h2><p>选择要更新的模组；前置依赖会按顺序一起处理，不兼容或有冲突的项目会先经过计划检查。</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body" id="update-manager">
      <div class="update-manager-toolbar"><span>${fmtNumber(updates.length)} 个模组有可用更新</span><button class="btn ghost sm" type="button" data-action="update-all">全部更新</button></div>
      <div class="update-manager-list">${rows}</div>
    </div>
    <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="button" data-action="update-selected">${icon('refresh', 14)}更新选中</button></div>`);
}

function setInstalledFilter(filter) {
  state.installedFilter = ['all', 'updates', 'disabled', 'manual'].includes(filter) ? filter : 'all';
  renderApp();
}

function toggleBatch() {
  state.batchMode = !state.batchMode;
  renderView();
  if (state.batchMode) syncBatchSelection();
}

function syncBatchSelection() {
  const boxes = [...document.querySelectorAll('.row-select')];
  const checked = boxes.filter((input) => input.checked);
  const count = document.getElementById('batch-count');
  const all = document.getElementById('batch-all');
  if (count) count.textContent = `${checked.length} 项已选`;
  if (all) {
    all.checked = boxes.length > 0 && checked.length === boxes.length;
    all.indeterminate = checked.length > 0 && checked.length < boxes.length;
  }
}

async function batchAction(action) {
  const ids = [...document.querySelectorAll('.row-select:checked')].map((input) => input.value);
  if (!ids.length) {
    toast('请先勾选要处理的模组', 'warn');
    return;
  }
  const meta = {
    disable: { title: `批量禁用 ${ids.length} 个模组`, text: '这些模组会整体移入 KSP/DisabledMods，不会进入游戏，也不会删除文件。', confirm: '全部禁用' },
    enable: { title: `批量启用 ${ids.length} 个模组`, text: '这些模组会从 KSP/DisabledMods 移回 GameData 原位置；若原位置已有同名文件，该项会跳过。', confirm: '全部启用' },
    delete: { title: `批量删除 ${ids.length} 个模组`, text: '这些模组会移入 kanmod 回收站，不会直接擦除。原版组件会自动跳过。', confirm: '移到回收站' },
  }[action];
  if (!meta) return;
  confirmAction({
    title: meta.title,
    message: meta.text,
    confirmText: meta.confirm,
    onConfirm: async () => {
      const data = await api('/api/mods/batch', { method: 'POST', body: { action, identifiers: ids } });
      state.batchMode = false;
      await afterModChange(`批量操作完成：成功 ${data.succeeded || 0}，跳过 ${data.failed || 0}`);
      if (data.failed) {
        const first = (data.results || []).find((item) => !item.ok);
        toast(`${data.failed} 项未处理${first ? `：${first.error}` : ''}`, 'warn');
      }
    },
  });
}

async function openFolder(target) {
  try {
    await api('/api/open', { method: 'POST', body: { target } });
    toast('已在文件资源管理器中打开');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openModal(html, { small = false } = {}) {
  state.lastFocus = document.activeElement;
  setModalContent(html, { small });
}

function setModalContent(html, { small = false } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-layer"><section class="modal ${small ? 'small' : ''}" role="dialog" aria-modal="true">${html}</section></div>`;
  lockScroll();
  setTimeout(() => {
    const target = root.querySelector('button:not([disabled]), input, select, textarea, [href]');
    target?.focus?.();
  }, 0);
}

function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  state.confirmHandler = null;
  state.pendingPlan = null;
  state.pendingUpload = null;
  unlockScroll();
  state.lastFocus?.focus?.();
}

function openDrawer(html) {
  state.lastFocus = document.activeElement;
  setDrawerContent(html);
}

function setDrawerContent(html) {
  const root = document.getElementById('drawer-root');
  if (!root) return;
  root.innerHTML = `<div class="drawer-layer"><aside class="drawer" role="dialog" aria-modal="true" aria-label="模组详情">${html}</aside></div>`;
  lockScroll();
}

function closeDrawer() {
  const root = document.getElementById('drawer-root');
  if (root) root.innerHTML = '';
  unlockScroll();
  state.lastFocus?.focus?.();
}

function lockScroll() {
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (!document.getElementById('modal-root')?.innerHTML && !document.getElementById('drawer-root')?.innerHTML) {
    document.body.style.overflow = '';
  }
}

async function openMod(identifier, version = null) {
  if (!identifier) return;
  setDrawerContent(drawerLoading(identifier));
  try {
    const params = new URLSearchParams({ identifier });
    if (version) params.set('version', version);
    const data = await api(`/api/catalog/package?${params.toString()}`);
    setDrawerContent(drawerDetail(data, identifier));
  } catch (error) {
    setDrawerContent(`<div class="drawer-head"><strong>模组详情</strong><button class="btn icon ghost" type="button" data-action="close-drawer" aria-label="关闭">${icon('x')}</button></div>
      <div class="drawer-body"><div class="empty"><div class="empty-icon">${icon('alert')}</div><strong>读取失败</strong><p>${esc(error.message)}</p><button class="btn ghost" type="button" data-action="close-drawer">关闭</button></div></div>`);
  }
}

async function openModPage(identifier, version = null) {
  if (!identifier) return;
  closeDrawer();
  closeModal();
  state.view = 'mod';
  state.mod = {
    identifier,
    version: version || null,
    data: null,
    loading: true,
    error: null,
    translations: {},
    translationLoading: {},
    translationErrors: {},
    images: [],
    imagesLoading: false,
    imagesError: null,
    imagesMessage: null,
    lightboxIndex: 0,
  };
  renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
  await loadModPage(identifier, version);
}

async function loadModPage(identifier, version = null) {
  const token = state.mod;
  if (!token) return;
  token.loading = true;
  token.error = null;
  renderApp();
  try {
    const params = new URLSearchParams({ identifier });
    if (version) params.set('version', version);
    const data = await api(`/api/catalog/package?${params.toString()}`);
    if (state.mod !== token) return;
    token.data = data;
    token.version = data.package.version;
    token.loading = false;
    renderApp();
    loadModImages().catch(() => {});
    const settings = state.bootstrap?.settings?.ui || {};
    const abstract = data.package.abstract || '';
    if (settings.autoTranslate !== false && abstract && !hasCjk(abstract) && !token.translations.abstract && !token.translationErrors.abstract) {
      await translateMod('abstract', false, { silent: true });
    }
  } catch (error) {
    if (state.mod !== token) return;
    token.loading = false;
    token.error = error.message || '读取模组简介失败。';
    renderApp();
  }
}

async function loadModImages(force = false) {
  const token = state.mod;
  const pkg = token?.data?.package;
  if (!token || !pkg || token.imagesLoading) return;
  if (!force && (token.images.length || token.imagesError)) return;
  token.imagesLoading = true;
  token.imagesError = null;
  renderApp();
  try {
    const params = new URLSearchParams({ identifier: pkg.identifier });
    if (pkg.version) params.set('version', pkg.version);
    const data = await api(`/api/images?${params.toString()}`);
    if (state.mod !== token) return;
    token.images = Array.isArray(data.images) ? data.images : [];
    token.imagesMessage = data.message || null;
  } catch (error) {
    if (state.mod !== token) return;
    token.images = [];
    token.imagesError = error.message || '图片检索失败。';
  } finally {
    if (state.mod === token) {
      token.imagesLoading = false;
      renderApp();
    }
  }
}

function galleryHtml() {
  const mod = state.mod;
  if (!mod?.data) return '';
  const images = mod.images || [];
  const count = images.length;
  let body = '';
  if (mod.imagesLoading) {
    body = `<div class="gallery-loading"><span class="spinner"></span><span>正在检索 SpaceDock、简介与 GitHub 图片…</span></div>`;
  } else if (mod.imagesError) {
    body = `<div class="gallery-empty"><span>${esc(mod.imagesError)}</span><button class="btn ghost sm" type="button" data-action="refresh-images">${icon('refresh', 13)}重试</button></div>`;
  } else if (count) {
    body = `<div class="mod-gallery ${count === 1 ? 'single' : ''}">${images.map((image, index) => `
      <button class="gallery-item" type="button" data-action="open-image" data-index="${index}" aria-label="查看第 ${index + 1} 张图片">
        <img src="${esc(image.proxyUrl || image.url)}" alt="${esc(pkgName())} 展示图 ${index + 1}" loading="lazy">
      </button>`).join('')}
    </div>`;
  } else {
    body = `<div class="gallery-empty"><span>${esc(mod.imagesMessage || '没有检索到可展示的图片。')}</span><button class="btn ghost sm" type="button" data-action="refresh-images">${icon('refresh', 13)}重新检索</button></div>`;
  }
  return `<section class="card mod-gallery-card">
    <div class="card-head"><h3>${icon('image', 15)}图片</h3><div class="gallery-head-actions"><span class="text-muted">${count ? `${fmtNumber(count)} 张` : '自动检索'}</span><button class="btn ghost sm" type="button" data-action="refresh-images" ${mod.imagesLoading ? 'disabled' : ''}>${icon('refresh', 13)}刷新</button></div></div>
    ${body}
  </section>`;
}

function pkgName() {
  return state.mod?.data?.package?.name || '模组';
}

function openLightbox(index = 0) {
  const images = state.mod?.images || [];
  if (!images.length) return;
  state.mod.lightboxIndex = Math.max(0, Math.min(Number(index) || 0, images.length - 1));
  setModalContent(lightboxHtml(), {});
}

function lightboxHtml() {
  const mod = state.mod;
  const images = mod?.images || [];
  const index = Math.max(0, Math.min(mod?.lightboxIndex || 0, images.length - 1));
  const image = images[index];
  if (!image) return '';
  return `<div class="modal-head"><div><span class="eyebrow">图片展示</span><h3>${esc(pkgName())}</h3></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭图片">${icon('x')}</button></div>
    <div class="lightbox-stage"><img src="${esc(image.proxyUrl || image.url)}" alt="${esc(pkgName())} 展示图 ${index + 1}"></div>
    <div class="modal-foot lightbox-foot">
      <span class="text-muted">${index + 1} / ${images.length}</span>
      <div class="lightbox-actions">
        <button class="btn ghost sm" type="button" data-action="lightbox-step" data-step="-1" ${images.length < 2 ? 'disabled' : ''}>上一张</button>
        <button class="btn ghost sm" type="button" data-action="lightbox-step" data-step="1" ${images.length < 2 ? 'disabled' : ''}>下一张</button>
      </div>
    </div>`;
}

function stepLightbox(step) {
  const images = state.mod?.images || [];
  if (images.length < 2) return;
  state.mod.lightboxIndex = (state.mod.lightboxIndex + step + images.length) % images.length;
  setModalContent(lightboxHtml(), {});
}

async function translateMod(field = 'abstract', force = false, { silent = false } = {}) {
  const token = state.mod;
  const pkg = token?.data?.package;
  if (!token || !pkg || !['abstract', 'description', 'name'].includes(field)) return;
  const source = field === 'description' ? pkg.description : field === 'name' ? pkg.name : pkg.abstract;
  if (!String(source || '').trim()) {
    if (!silent) toast('这个模组没有可翻译的文本。', 'warn');
    return;
  }
  if (token.translationLoading?.[field]) return;
  token.translationLoading[field] = true;
  token.translationErrors[field] = null;
  renderApp();
  try {
    const data = await api('/api/translate', {
      method: 'POST',
      body: { identifier: pkg.identifier, version: pkg.version, field, text: source, force: Boolean(force) },
    });
    if (state.mod !== token) return;
    token.translations[field] = data.translation;
  } catch (error) {
    if (state.mod !== token) return;
    token.translationErrors[field] = error.message || '翻译失败，请稍后重试。';
    if (!silent) toast(token.translationErrors[field], 'error');
  } finally {
    if (state.mod === token) {
      token.translationLoading[field] = false;
      renderApp();
    }
  }
}

function drawerLoading(identifier) {
  return `<div class="drawer-head"><strong>模组详情</strong><button class="btn icon ghost" type="button" data-action="close-drawer" aria-label="关闭">${icon('x')}</button></div>
    <div class="drawer-loading">${spinnerLine('正在读取 ' + identifier + '…')}</div>`;
}

function drawerDetail(data, identifier) {
  const pkg = data.package;
  const versions = data.versions || [];
  const relations = data.relationships || {};
  const selectedVersion = pkg.version;
  const compatibility = data.compatibility || null;
  const abstract = pkg.abstract || '这个模组还没有简介。';
  const description = String(pkg.description || '').slice(0, 8000);
  const installed = data.installed;
  return `<div class="drawer-head">
    <div><span class="badge red">${esc(kindLabel(pkg.kind))}</span> <span class="text-muted" style="font-size:10px">模组详情</span></div>
    <button class="btn icon ghost" type="button" data-action="close-drawer" aria-label="关闭">${icon('x')}</button>
  </div>
  <div class="drawer-body">
    <div class="drawer-package-head">
      <span class="mod-avatar">${initial(pkg.name)}</span>
      <div><h2>${esc(pkg.name)}</h2><span class="mod-id">${esc(pkg.identifier)}</span></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${compatibilityBadge(compatibility)} ${installed ? '<span class="badge ok dot">已安装</span>' : ''} ${pkg.releaseStatus && pkg.releaseStatus !== 'stable' ? `<span class="badge warn">${esc(pkg.releaseStatus)}</span>` : ''}</div>
    <p class="drawer-abstract">${esc(abstract)}</p>
    <div class="drawer-meta">
      <div><small>当前版本</small><strong>${esc(pkg.version)}</strong></div>
      <div><small>作者</small><strong>${esc(pkg.author || '未注明')}</strong></div>
      <div><small>适用 KSP</small><strong>${esc(pkg.kspVersion || (pkg.kspVersionMin || pkg.kspVersionMax ? `${pkg.kspVersionMin || '?'} – ${pkg.kspVersionMax || '?'}` : '未声明'))}</strong></div>
      <div><small>下载体积</small><strong>${esc(fmtBytes(pkg.downloadSize))}</strong></div>
      <div><small>许可证</small><strong>${esc(pkg.license || '未注明')}</strong></div>
      <div><small>标识</small><strong>${esc(pkg.identifier)}</strong></div>
    </div>
    ${description ? `<div class="drawer-section"><h3>说明</h3><p class="text-muted" style="white-space:pre-line;line-height:1.7;margin:0;font-size:11.5px">${esc(description)}</p></div>` : ''}
    <div class="drawer-section"><h3>选择版本</h3>
      <div class="version-list">${versions.map((entry) => `<button class="version-chip ${entry.version === selectedVersion ? 'active' : ''}" type="button" data-action="select-version" data-id="${esc(pkg.identifier)}" data-version="${esc(entry.version)}" title="${esc(entry.compatibility?.reason || '')}">${esc(entry.version)}</button>`).join('')}</div>
    </div>
    ${(relations.depends?.length || relations.recommends?.length) ? `<div class="drawer-section"><h3>依赖概览</h3>
      <div class="relation-list">
        ${(relations.depends || []).map((relation) => `<div class="relation-item" style="cursor:default"><span class="rel-name"><strong>${esc(relation.displayName || relation.name)}</strong><small>${esc(relation.identifier || relation.name)}${constraintText(relation) ? ` · ${esc(constraintText(relation))}` : ''}</small></span><span class="badge ${relation.installedVersion ? 'ok' : relation.available ? '' : 'bad'}">${relation.installedVersion ? `已装 ${esc(relation.installedVersion)}` : relation.available ? '必需' : '缺失'}</span></div>`).join('')}
        ${(relations.recommends || []).map((relation) => `<div class="relation-item" style="cursor:default"><span class="rel-name"><strong>${esc(relation.displayName || relation.name)}</strong><small>推荐</small></span><span class="badge">可选</span></div>`).join('')}
      </div>
    </div>` : ''}
    <div class="drawer-section"><h3>链接</h3>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        ${pkg.resources?.homepage ? `<a class="btn ghost sm" href="${esc(pkg.resources.homepage)}" target="_blank" rel="noreferrer">${icon('link', 13)}主页</a>` : ''}
        ${pkg.resources?.repository ? `<a class="btn ghost sm" href="${esc(pkg.resources.repository)}" target="_blank" rel="noreferrer">${icon('link', 13)}仓库</a>` : ''}
        ${pkg.resources?.spacedock ? `<a class="btn ghost sm" href="${esc(pkg.resources.spacedock)}" target="_blank" rel="noreferrer">${icon('link', 13)}SpaceDock</a>` : ''}
        <button class="btn ghost sm" type="button" data-action="open-relations" data-id="${esc(pkg.identifier)}" data-version="${esc(pkg.version)}">${icon('network', 13)}依赖图</button>
      </div>
    </div>
    <div class="drawer-cta">
      <button class="btn ghost" type="button" data-action="close-drawer">关闭</button>
      <button class="btn primary" type="button" data-action="plan-install" data-id="${esc(pkg.identifier)}" data-version="${esc(pkg.version)}">${installed ? '查看安装计划' : `安装 ${esc(shortVersion(pkg.version))}`}</button>
    </div>
  </div>`;
}

function shortVersion(version) {
  return String(version || '').slice(0, 18);
}

async function openPlan(identifier, version = null) {
  if (!state.bootstrap?.instance) {
    toast('请先连接一个 KSP 实例。', 'warn');
    state.view = 'settings';
    renderApp();
    return;
  }
  const root = version ? { identifier, version } : identifier;
  setModalContent(`<div class="modal-head"><div><h2>安装计划</h2><p>正在解析前置依赖与版本兼容性…</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body" style="padding:30px 20px">${spinnerLine('正在计算依赖图…')}</div>`);
  state.pendingPlan = { identifier, version, plan: null };
  try {
    const settings = state.bootstrap.settings?.install || {};
    const data = await api('/api/resolve', {
      method: 'POST',
      body: {
        roots: [root],
        allowWarning: Boolean(settings.allowWarning),
        allowUnknown: Boolean(settings.allowUnknown),
        includeRecommended: false,
      },
    });
    state.pendingPlan.plan = data.plan;
    setModalContent(planModalHtml(data.plan, identifier), { small: false });
  } catch (error) {
    setModalContent(`<div class="modal-head"><div><h2>无法生成安装计划</h2><p>${esc(identifier)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
      <div class="modal-body"><div class="notice red">${icon('alert', 18)}<div>${esc(error.message)}</div></div>${error.code === 'NO_INSTANCE' ? '<button class="btn primary" type="button" data-action="navigate" data-view="settings">去设置实例</button>' : ''}</div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">关闭</button></div>`, { small: true });
  }
}

function planModalHtml(plan, rootIdentifier) {
  const summary = plan.summary || {};
  const order = plan.installOrder || [];
  const actionable = (summary.install || 0) + (summary.upgrade || 0) + (summary.downgrade || 0);
  const canInstall = plan.ok && actionable > 0;
  const rootName = order.find((node) => node.root)?.name || rootIdentifier;
  return `<div class="modal-head"><div><h2>安装计划 · ${esc(truncate(rootName, 48))}</h2><p>依赖会按顺序安装。确认前不会写入任何文件。</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="plan-summary">
        <div><small>安装</small><strong>${fmtNumber(summary.install)}</strong></div>
        <div><small>升级</small><strong>${fmtNumber(summary.upgrade)}</strong></div>
        <div><small>保留</small><strong>${fmtNumber(summary.keep)}</strong></div>
        <div><small>下载</small><strong>${esc(fmtBytes(summary.downloadBytes))}</strong></div>
      </div>
      ${plan.missing?.length ? `<div class="notice red" style="margin-bottom:12px">${icon('alert', 17)}<div><strong>缺少 ${plan.missing.length} 个必需依赖</strong>，当前计划不能安装。${plan.missing.map((item) => `<div class="text-muted">${esc(item.name || item.identifier)}${item.reason ? ` · ${esc(relationText(item.reason))}` : ''}</div>`).join('')}</div></div>` : ''}
      ${plan.conflicts?.length ? `<div class="notice red" style="margin-bottom:12px">${icon('alert', 17)}<div><strong>检测到 ${plan.conflicts.length} 个冲突</strong>，请更换版本后再试。${plan.conflicts.map((item) => `<div class="text-muted">${esc(relationText(item))}</div>`).join('')}</div></div>` : ''}
      ${plan.warnings?.length ? `<div class="notice warn" style="margin-bottom:12px">${icon('alert', 17)}<div>${plan.warnings.map((item) => esc(relationText(item))).join('<br>')}</div></div>` : ''}
      <div class="plan-list">${order.map((node) => {
        const pkg = node.package || {};
        return `<div class="plan-row">
          <span class="mod-avatar" style="width:28px;height:28px;font-size:11px">${initial(node.name || pkg.name)}</span>
          <span class="plan-name"><strong>${esc(node.name || pkg.name || node.identifier)}</strong><small>${esc(node.identifier)} · v${esc(node.version || pkg.version || '—')}${node.installedVersion ? ` · 当前 ${esc(node.installedVersion)}` : ''}</small></span>
          ${compatibilityBadge(node.compatibility)}
          ${actionBadge(node.action)}
        </div>`;
      }).join('')}</div>
      ${!order.length ? '<div class="empty" style="padding:18px"><p>没有需要处理的节点。</p></div>' : ''}
      <div class="notice" style="margin-top:12px">${icon('info', 16)}<div>覆盖已存在的不同文件前，会按安装策略备份。冲突移除、手动文件覆盖不会被自动处理。</div></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" type="button" data-action="close-modal">取消</button>
      <button class="btn primary" type="button" data-action="confirm-install" ${canInstall ? '' : 'disabled'}>${canInstall ? `安装 ${actionable} 个模组` : '无需安装'}</button>
    </div>`;
}

async function confirmInstall() {
  const pending = state.pendingPlan;
  if (!pending?.plan) return;
  if (!pending.plan.ok) {
    toast('计划存在冲突或缺失前置，无法执行。', 'error');
    return;
  }
  const button = document.querySelector('[data-action="confirm-install"]');
  setBusy(button, true, '加入队列…');
  const settings = state.bootstrap.settings?.install || {};
  try {
    const body = {
      roots: [pending.version ? { identifier: pending.identifier, version: pending.version } : pending.identifier],
      allowWarning: Boolean(settings.allowWarning),
      allowUnknown: Boolean(settings.allowUnknown),
      includeRecommended: false,
    };
    const data = await api('/api/install', { method: 'POST', body });
    if (!data.job) {
      toast(data.message || '没有需要安装的内容', 'warn');
      closeModal();
      return;
    }
    upsertJob(data.job);
    closeModal();
    state.view = 'jobs';
    renderApp();
    toast('安装任务已加入队列');
  } catch (error) {
    setBusy(button, false);
    if (error.data?.plan) {
      state.pendingPlan.plan = error.data.plan;
      setModalContent(planModalHtml(error.data.plan, pending.identifier));
    }
    toast(error.message, 'error');
  }
}

async function openRepairPreview() {
  if (!state.bootstrap?.instance) {
    toast('请先连接 KSP 实例。', 'warn');
    return;
  }
  setModalContent(`<div class="modal-head"><div><h2>检查自动修复项</h2><p>只处理安全的依赖安装与可更新项目。</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body" style="padding:30px 20px">${spinnerLine('正在重新检查…')}</div>`);
  try {
    const data = await api('/api/repair/preview', { method: 'POST', body: {} });
    const operations = data.repairs?.operations || [];
    state.pendingPlan = { repairs: data.repairs };
    setModalContent(`<div class="modal-head"><div><h2>自动修复</h2><p>以下操作会在确认后按依赖顺序执行。</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
      <div class="modal-body">
        ${operations.length ? `<div class="plan-list">${operations.map((operation) => `<div class="plan-row"><span class="mod-avatar" style="width:28px;height:28px;font-size:11px">${initial(operation.label)}</span><span class="plan-name"><strong>${esc(operation.label)}</strong><small>${esc(operation.identifier)} ${operation.version ? `· ${esc(operation.version)}` : ''}</small></span><span class="badge ok">自动</span></div>`).join('')}</div>` : `<div class="empty" style="padding:20px"><div class="empty-icon">${icon('check')}</div><strong>没有可自动修复的问题</strong><p>其余问题需要手动处理，尤其是冲突与手动安装的模组。</p></div>`}
        ${data.repairs?.skipped ? `<div class="notice" style="margin-top:12px">${icon('info', 16)}<div>${fmtNumber(data.repairs.skipped)} 项问题不会被自动修改。</div></div>` : ''}
        <div class="notice" style="margin-top:12px">${icon('shield', 16)}<div>kanmod 不会为了修复而移除模组或覆盖冲突文件。</div></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="button" data-action="confirm-repair" ${operations.length ? '' : 'disabled'}>执行 ${fmtNumber(operations.length)} 项修复</button></div>`, { small: false });
  } catch (error) {
    setModalContent(`<div class="modal-head"><div><h2>无法生成修复计划</h2></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
      <div class="modal-body"><div class="notice red">${icon('alert', 17)}<div>${esc(error.message)}</div></div></div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">关闭</button></div>`, { small: true });
  }
}

async function confirmRepair() {
  const button = document.querySelector('[data-action="confirm-repair"]');
  setBusy(button, true, '执行中…');
  try {
    const data = await api('/api/repair', { method: 'POST', body: {} });
    if (!data.job) {
      toast(data.message || '没有需要安装的修复项', 'warn');
      closeModal();
      return;
    }
    upsertJob(data.job);
    closeModal();
    state.view = 'jobs';
    renderApp();
    toast('自动修复任务已加入队列');
  } catch (error) {
    setBusy(button, false);
    toast(error.message, 'error');
  }
}

function triggerArchive() {
  const input = document.getElementById('archive-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function previewArchive(file) {
  if (!file) return;
  if (!/\.(zip|gz|tgz)$/i.test(file.name)) {
    toast('请选择 .zip、.tar.gz 或 .tgz 安装包。', 'error');
    return;
  }
  if (file.size > 512 * 1024 * 1024) {
    toast('安装包超过 512 MB 上限。', 'error');
    return;
  }
  setModalContent(`<div class="modal-head"><div><h2>解析安装包</h2><p>${esc(file.name)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body" style="padding:30px 20px">${spinnerLine('正在读取归档并预演安装路径…')}</div>`, { small: true });
  try {
    const query = new URLSearchParams({ filename: file.name });
    const data = await api(`/api/archive/preview?${query.toString()}`, { method: 'POST', raw: file });
    state.pendingUpload = data;
    const plan = data.plan || {};
    const files = (plan.files || []).slice(0, 12);
    setModalContent(`<div class="modal-head"><div><h2>本地安装包</h2><p>${esc(data.filename)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
      <div class="modal-body">
        <div class="drawer-package-head"><span class="mod-avatar">${initial(data.package?.name)}</span><div><h2>${esc(data.package?.name || '本地模组')}</h2><span class="mod-id">${esc(data.package?.identifier || 'unknown')} · v${esc(data.package?.version || '—')}</span></div></div>
        <div class="plan-summary" style="margin-top:15px"><div><small>文件</small><strong>${fmtNumber(plan.fileCount || 0)}</strong></div><div><small>解压后</small><strong>${esc(plan.totalLabel || fmtBytes(plan.totalBytes))}</strong></div><div><small>安装点</small><strong>${esc(plan.primaryFolder || 'GameData')}</strong></div><div><small>目录根</small><strong>${fmtNumber(plan.roots?.length || 0)}</strong></div></div>
        ${files.length ? `<div class="plan-list">${files.map((entry) => `<div class="plan-row"><span class="plan-name"><strong>${esc(truncate(entry.to, 58))}</strong><small>${esc(fmtBytes(entry.size))}</small></span></div>`).join('')}</div>` : ''}
        ${(plan.files?.length || 0) > files.length ? `<p class="text-muted" style="font-size:10.5px">仅展示前 ${files.length} 个文件。</p>` : ''}
        <div class="notice" style="margin-top:12px">${icon('info', 16)}<div>本地包不会自动解析外部前置；如安装后报错，请到问题诊断检查缺失依赖。</div></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn primary" type="button" data-action="confirm-upload">安装到 GameData</button></div>`);
  } catch (error) {
    setModalContent(`<div class="modal-head"><div><h2>无法解析安装包</h2><p>${esc(file.name)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
      <div class="modal-body"><div class="notice red">${icon('alert', 17)}<div>${esc(error.message)}</div></div></div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">关闭</button></div>`, { small: true });
  }
}

async function confirmUploadInstall() {
  const upload = state.pendingUpload;
  if (!upload) return;
  if (!state.bootstrap?.instance) {
    toast('请先连接 KSP 实例。', 'warn');
    return;
  }
  const button = document.querySelector('[data-action="confirm-upload"]');
  setBusy(button, true, '加入队列…');
  try {
    const data = await api('/api/archive/install', { method: 'POST', body: { uploadId: upload.uploadId } });
    if (!data.job) {
      toast('没有创建安装任务。', 'warn');
      closeModal();
      return;
    }
    upsertJob(data.job);
    closeModal();
    state.view = 'jobs';
    renderApp();
    toast('本地安装任务已加入队列');
  } catch (error) {
    setBusy(button, false);
    toast(error.message, 'error');
  }
}

function confirmAction({ title, message, confirmText = '确认', onConfirm }) {
  state.confirmHandler = onConfirm;
  openModal(`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(message)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" data-action="run-confirm">${esc(confirmText)}</button></div>`, { small: true });
}

async function runConfirm() {
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

function navigate(view) {
  if (!VIEW_META[view]) return;
  closeDrawer();
  closeModal();
  state.view = view;
  renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
  const root = document.getElementById('view-root');
  root?.focus?.({ preventScroll: true });
}

function setLibraryStatus(status) {
  state.library.status = status;
  state.library.page = 1;
  renderApp();
  loadCatalog();
}

function setLibraryPage(page) {
  const data = state.library.data;
  if (!data) return;
  if (page < 1 || page > data.pageCount) return;
  state.library.page = page;
  loadCatalog();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearLibraryFilter() {
  state.library.q = '';
  state.library.status = 'all';
  state.library.sort = 'relevance';
  state.library.tag = '';
  state.library.size = '';
  state.library.page = 1;
  renderApp();
  loadCatalog();
}

async function saveSettings(form) {
  const button = form.querySelector('button[type="submit"]');
  const value = (name) => form.elements[name]?.value;
  const checked = (name) => Boolean(form.elements[name]?.checked);
  const builtin = [...form.querySelectorAll('[data-enabled-source]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
  const customRows = [...form.querySelectorAll('[data-custom-source]')];
  const customSources = customRows.map((row) => ({
    id: row.dataset.id,
    name: row.querySelector('.source-name')?.value.trim() || '自定义索引',
    url: row.querySelector('.source-url')?.value.trim() || '',
    enabled: Boolean(row.querySelector('.source-enabled')?.checked),
  })).filter((source) => source.url);
  const enabledSources = [...builtin, ...customSources.filter((source) => source.enabled).map((source) => source.id)];
  if (!enabledSources.length) {
    toast('至少需要启用一个索引源。', 'error');
    return;
  }
  const body = {
    install: {
      backupOverwrite: checked('backupOverwrite'),
      allowWarning: checked('allowWarning'),
      allowUnknown: checked('allowUnknown'),
      keepDownloads: checked('keepDownloads'),
    },
    network: {
      timeoutSeconds: Number(value('timeoutSeconds')) || 45,
      downloadTimeoutSeconds: Number(value('downloadTimeoutSeconds')) || 180,
      maxDownloadMB: Number(value('maxDownloadMB')) || 2048,
      allowInsecureHttp: checked('allowInsecureHttp'),
      mirrorPrefixes: String(value('mirrorPrefixes') || '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
    },
    catalog: {
      enabledSources,
      autoRefresh: checked('autoRefresh'),
      customSources,
    },
    ui: { pageSize: Math.min(96, Math.max(6, Number(value('pageSize')) || 24)), autoTranslate: checked('autoTranslate') },
  };
  setBusy(button, true, '保存中…');
  try {
    const data = await api('/api/settings', { method: 'POST', body });
    state.bootstrap.settings = data.settings;
    state.bootstrap.sources = data.sources;
    state.library.pageSize = body.ui.pageSize;
    state.library.page = 1;
    state.library.data = null;
    toast('设置已保存');
    renderApp();
  } catch (error) {
    setBusy(button, false);
    toast(error.message, 'error');
  }
}

function appendSourceRow() {
  const name = document.getElementById('new-source-name')?.value.trim() || '自定义索引';
  const url = document.getElementById('new-source-url')?.value.trim() || '';
  if (!url) {
    toast('请填写索引地址。', 'error');
    return;
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad');
  } catch {
    toast('索引地址必须是 http(s) URL。', 'error');
    return;
  }
  const list = document.getElementById('custom-source-list');
  if (!list) return;
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  list.insertAdjacentHTML('beforeend', customSourceRow({ id, name, url, enabled: true }));
  document.getElementById('new-source-name').value = '';
  document.getElementById('new-source-url').value = '';
  toast('已添加到列表，保存设置后生效。');
}

async function importCatalog() {
  const input = document.getElementById('catalog-url');
  const url = input?.value.trim();
  if (!url) {
    toast('请填写索引地址。', 'error');
    return;
  }
  if (state.bootstrap.demo) {
    toast('演示模式不访问网络。', 'warn');
    return;
  }
  const button = document.querySelector('[data-action="import-catalog"]');
  setBusy(button, true, '下载中…');
  try {
    const data = await api('/api/catalog/import', { method: 'POST', body: { url } });
    toast(`已导入 ${data.count || 0} 个模组版本`);
    input.value = '';
    state.library.data = null;
    await reloadBootstrap({ resetData: false });
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function exportCatalog() {
  try {
    const response = await fetch('/api/catalog/export', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kanmod-catalog-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('索引已导出');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function uploadCatalogFile(file) {
  if (!file) return;
  if (state.bootstrap.demo) {
    toast('演示模式不导入外部索引。', 'warn');
    return;
  }
  const query = new URLSearchParams({ name: file.name });
  try {
    const data = await api(`/api/catalog/upload?${query.toString()}`, { method: 'POST', raw: file });
    toast(`已导入 ${data.count || 0} 个模组版本`);
    state.library.data = null;
    await reloadBootstrap({ resetData: false });
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function refreshJobs() {
  await loadJobs();
  toast('任务列表已刷新');
}

async function cancelJob(id) {
  try {
    const data = await api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
    if (data.job) upsertJob(data.job);
    renderView();
    toast('已请求取消任务', 'warn');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function startEvents() {
  if (!window.EventSource) return;
  try {
    const source = new EventSource('/api/events');
    source.onopen = () => {
      const reconnected = state.sseEverOpen;
      state.sseOpen = true;
      state.sseEverOpen = true;
      if (reconnected && state.bootstrap) {
        reloadBootstrap({ resetData: true, render: true }).catch(() => {});
      }
    };
    source.onerror = () => {
      state.sseOpen = false;
    };
    source.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'hello') return;
      if (message.type === 'job' && message.job) {
        const previous = state.jobs.find((job) => job.id === message.job.id);
        upsertJob(message.job);
        scheduleJobRender();
        const final = ['done', 'failed', 'cancelled'].includes(message.job.status);
        if (final && previous?.status !== message.job.status) {
          if (message.job.status === 'done') toast(`${message.job.title} 已完成`);
          if (message.job.status === 'failed') toast(`${message.job.title} 失败：${message.job.error || '未知错误'}`, 'error');
          if (message.job.status === 'cancelled') toast(`${message.job.title} 已取消`, 'warn');
          afterJobFinished();
        }
      }
    };
  } catch {
    state.sseOpen = false;
  }
}

let jobRenderTimer = null;
function scheduleJobRender() {
  if (state.view !== 'jobs' && state.view !== 'overview') {
    updateNavCounts();
    return;
  }
  clearTimeout(jobRenderTimer);
  jobRenderTimer = setTimeout(() => {
    renderView();
    updateNavCounts();
  }, 130);
}

let afterJobTimer = null;
function afterJobFinished() {
  clearTimeout(afterJobTimer);
  afterJobTimer = setTimeout(async () => {
    try {
      await reloadBootstrap({ resetData: true, render: true });
      if (state.view === 'library') loadCatalog();
      if (state.view === 'installed') loadInstalled();
      if (state.view === 'jobs') loadJobs();
      if (state.view === 'overview' || state.view === 'diagnostics') loadDiagnostics({ force: true });
    } catch (error) {
      toast(error.message, 'error');
    }
  }, 350);
}

function setupEvents() {
  document.addEventListener('click', async (event) => {
    const actionNode = event.target.closest('[data-action]');
    if (!actionNode) {
      if (event.target.classList?.contains('modal-layer')) closeModal();
      else if (event.target.classList?.contains('drawer-layer')) closeDrawer();
      return;
    }
    if (actionNode.tagName === 'A') event.preventDefault();
    if (actionNode.tagName === 'BUTTON' && actionNode.type === 'submit') return;
    const action = actionNode.dataset.action;
    try {
      switch (action) {
        case 'navigate':
          navigate(actionNode.dataset.view);
          break;
        case 'boot-retry':
          retryBoot();
          break;
        case 'refresh-scan':
          await refreshScan();
          break;
        case 'refresh-catalog':
          await refreshCatalog();
          break;
        case 'detect-instances':
          await detectInstances();
          break;
        case 'add-instance':
          addInstanceModal();
          break;
        case 'select-instance':
          await selectInstance(actionNode.dataset.id);
          break;
        case 'delete-instance':
          deleteInstance(actionNode.dataset.id);
          break;
        case 'open-mod':
          await openMod(actionNode.dataset.id, actionNode.dataset.version || null);
          break;
        case 'open-mod-page':
          await openModPage(actionNode.dataset.id, actionNode.dataset.version || null);
          break;
        case 'mod-back':
          navigate('library');
          break;
        case 'retry-mod':
          if (state.mod?.identifier) await loadModPage(state.mod.identifier, state.mod.version);
          break;
        case 'mod-version':
          await openModPage(actionNode.dataset.id, actionNode.dataset.version || null);
          break;
        case 'translate-mod':
          await translateMod(actionNode.dataset.field || 'abstract', actionNode.dataset.force === '1');
          break;
        case 'refresh-images':
          await loadModImages(true);
          break;
        case 'open-image':
          openLightbox(Number(actionNode.dataset.index) || 0);
          break;
        case 'lightbox-step':
          stepLightbox(Number(actionNode.dataset.step) || 0);
          break;
        case 'select-version':
          await openMod(actionNode.dataset.id, actionNode.dataset.version || null);
          break;
        case 'plan-install':
          await openPlan(actionNode.dataset.id, actionNode.dataset.version || null);
          break;
        case 'confirm-install':
          await confirmInstall();
          break;
        case 'close-modal':
          closeModal();
          break;
        case 'close-drawer':
          closeDrawer();
          break;
        case 'open-relations':
          closeDrawer();
          state.view = 'relations';
          state.relationships = null;
          state.relationshipQuery = actionNode.dataset.id || '';
          state.relationshipVersion = actionNode.dataset.version || null;
          renderApp();
          loadRelationships(state.relationshipQuery, state.relationshipVersion);
          break;
        case 'show-relations':
          await loadRelationships(actionNode.dataset.id, null);
          break;
        case 'retry-relations':
          await loadRelationships(state.relationshipQuery, state.relationshipVersion);
          break;
        case 'retry-library':
          await loadCatalog();
          break;
        case 'retry-diagnostics':
          await loadDiagnostics({ force: true });
          break;
        case 'library-status':
          setLibraryStatus(actionNode.dataset.status);
          break;
        case 'library-page':
          setLibraryPage(Number(actionNode.dataset.page));
          break;
        case 'clear-library-filter':
          clearLibraryFilter();
          break;
        case 'repair-preview':
          await openRepairPreview();
          break;
        case 'confirm-repair':
          await confirmRepair();
          break;
        case 'uninstall':
          uninstall(actionNode.dataset.id);
          break;
        case 'disable-mod':
          disableManagedMod(actionNode.dataset.id);
          break;
        case 'enable-mod':
          enableManagedMod(actionNode.dataset.id);
          break;
        case 'delete-mod':
          deleteManagedMod(actionNode.dataset.id);
          break;
        case 'update-mod':
          await updateManagedMod(actionNode.dataset.id);
          break;
        case 'open-updates':
          openUpdateManager();
          break;
        case 'update-selected':
          updateSelectedMods();
          break;
        case 'update-all':
          updateAllMods();
          break;
        case 'toggle-batch':
          toggleBatch();
          break;
        case 'installed-filter':
          setInstalledFilter(actionNode.dataset.filter || 'all');
          break;
        case 'batch-disable':
          batchAction('disable');
          break;
        case 'batch-enable':
          batchAction('enable');
          break;
        case 'batch-delete':
          batchAction('delete');
          break;
        case 'open-folder':
          await openFolder(actionNode.dataset.target);
          break;
        case 'check-update':
          await checkAppUpdate(actionNode);
          break;
        case 'trigger-archive':
          triggerArchive();
          break;
        case 'confirm-upload':
          await confirmUploadInstall();
          break;
        case 'append-source':
          appendSourceRow();
          break;
        case 'remove-source':
          actionNode.closest('[data-custom-source]')?.remove();
          break;
        case 'import-catalog':
          await importCatalog();
          break;
        case 'export-catalog':
          await exportCatalog();
          break;
        case 'upload-catalog': {
          const input = document.getElementById('catalog-upload-input');
          if (input) {
            input.value = '';
            input.click();
          }
          break;
        }
        case 'refresh-jobs':
          await refreshJobs();
          break;
        case 'cancel-job':
          await cancelJob(actionNode.dataset.id);
          break;
        case 'run-confirm':
          await runConfirm();
          break;
        default:
          break;
      }
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.form;
    try {
      if (kind === 'library-search') {
        const input = form.querySelector('#library-q');
        state.library.q = input?.value.trim() || '';
        state.library.page = 1;
        await loadCatalog();
      } else if (kind === 'relation-search') {
        const input = form.querySelector('#relation-q');
        const identifier = input?.value.trim();
        if (!identifier) {
          toast('请输入模组标识。', 'error');
          return;
        }
        await loadRelationships(identifier, null);
      } else if (kind === 'settings') {
        await saveSettings(form);
      } else if (kind === 'instance-add') {
        const button = form.querySelector('button[type="submit"]');
        setBusy(button, true, '连接中…');
        const path = form.elements.path?.value.trim();
        const name = form.elements.name?.value.trim();
        if (!path) {
          setBusy(button, false);
          toast('请填写游戏目录。', 'error');
          return;
        }
        try {
          await api('/api/instances', { method: 'POST', body: { path, name } });
          closeModal();
          await reloadBootstrap({ resetData: true });
          toast('已连接并切换到这个 KSP 实例');
        } finally {
          setBusy(button, false);
        }
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'library-q') {
      state.library.q = event.target.value;
      state.library.page = 1;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => loadCatalog(), 260);
    }
  });

  document.addEventListener('change', async (event) => {
    if (event.target.id === 'batch-all') {
      document.querySelectorAll('.row-select').forEach((input) => { input.checked = event.target.checked; });
      syncBatchSelection();
    } else if (event.target.classList?.contains('row-select')) {
      syncBatchSelection();
    } else if (event.target.id === 'library-sort') {
      state.library.sort = event.target.value;
      state.library.page = 1;
      renderApp();
      await loadCatalog();
    } else if (event.target.id === 'library-tag') {
      state.library.tag = event.target.value;
      state.library.page = 1;
      renderApp();
      await loadCatalog();
    } else if (event.target.id === 'library-size') {
      state.library.size = event.target.value;
      state.library.page = 1;
      renderApp();
      await loadCatalog();
    } else if (event.target.id === 'archive-input') {
      const file = event.target.files?.[0];
      if (file) await previewArchive(file);
    } else if (event.target.id === 'catalog-upload-input') {
      const file = event.target.files?.[0];
      if (file) await uploadCatalogFile(file);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.getElementById('modal-root')?.innerHTML) {
        closeModal();
        event.preventDefault();
      } else if (document.getElementById('drawer-root')?.innerHTML) {
        closeDrawer();
        event.preventDefault();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const container = document.querySelector('#modal-root .modal, #drawer-root .drawer');
    if (!container) return;
    const focusable = [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

setInterval(async () => {
  if (!state.bootstrap || state.sseOpen) return;
  if (!state.jobs.some((job) => job.status === 'queued' || job.status === 'running')) return;
  try {
    const data = await api('/api/jobs');
    state.jobs = data.jobs || [];
    state.jobsFullLoaded = true;
    if (state.view === 'jobs' || state.view === 'overview') renderView();
    updateNavCounts();
  } catch {
    // The event stream or the next manual refresh will recover.
  }
}, 5000);

setupEvents();
boot();
