// Data loading and user actions. Functions may re-render through the app shell.
import { VIEW_META, api, closeDrawer, closeModal, confirmAction, esc, fmtBytes, fmtNumber, icon, initial, openModal, setBusy, setDrawerContent, setModalContent, shortId, spinnerLine, state, toast, truncate, updateNavCounts, upsertJob } from './core.js';
import { compatibilityBadge, customSourceRow, drawerDetail, drawerLoading, hasCjk, libraryBodyHtml, lightboxHtml, planModalHtml, tagLabel } from './views.js';
import { reloadBootstrap, renderApp, renderView } from '../app.js';

export async function checkAppUpdate(button) {
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


export async function showCacheStatus() {
  const status = document.getElementById('cache-status');
  try {
    const data = await api('/api/cache/status');
    const cache = data.cache || {};
    if (status) {
      status.innerHTML = `合计 ${esc(cache.totalLabel || '0 B')} · 下载 ${esc(cache.targets?.downloads?.label || '0 B')} · 图片 ${esc(cache.targets?.images?.label || '0 B')} · 翻译 ${esc(cache.targets?.translations?.label || '0 B')}`;
    }
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}


export async function clearCache() {
  const ok = await confirmAction({
    title: '清理本地缓存',
    message: '会删除已下载的安装包、图片缓存和翻译缓存。不会影响已安装模组、安装记录或回收站。',
    confirmText: '清理缓存',
    danger: false,
  });
  if (!ok) return;
  try {
    const data = await api('/api/cache/clear', { method: 'POST', body: { targets: ['downloads', 'images', 'translations'] } });
    const status = document.getElementById('cache-status');
    if (status) status.innerHTML = `已清理 ${esc(fmtBytes(data.cleared || 0))}，当前 ${esc(data.cache?.totalLabel || '0 B')}。`;
    toast('缓存已清理');
  } catch (error) {
    toast(error.message, 'error');
  }
}


export async function loadCatalog() {
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
    translateCatalogTitles(data).catch(() => {});
  } catch (error) {
    state.library.error = error.message;
  } finally {
    state.library.loading = false;
    if (state.view === 'library') renderLibraryBody();
  }
}


export async function loadCurseForge() {
  const cf = state.library.cf;
  if (cf.loading) return;
  cf.loading = true;
  cf.error = null;
  if (state.view === 'library') renderLibraryBody();
  const params = new URLSearchParams({
    q: state.library.q,
    page: String(cf.page),
    pageSize: String(state.library.pageSize),
    sort: state.library.sort,
  });
  try {
    const data = await api(`/api/curseforge/search?${params.toString()}`);
    cf.data = data;
    cf.page = data.page || cf.page;
    cf.error = null;
    if (!data.needsKey) translateCatalogTitles(data).catch(() => {});
  } catch (error) {
    cf.error = error.message;
  } finally {
    cf.loading = false;
    if (state.view === 'library') renderLibraryBody();
  }
}


export async function switchLibrarySource(source) {
  const next = source === 'curseforge' ? 'curseforge' : 'catalog';
  if (state.library.source === next) return;
  state.library.source = next;
  state.library.q = '';
  state.library.page = 1;
  state.library.cf.page = 1;
  state.library.sort = next === 'curseforge' ? 'popularity' : 'relevance';
  renderApp();
  if (next === 'curseforge') await loadCurseForge();
  else await loadCatalog();
}


export function renderLibraryBody() {
  const body = document.getElementById('library-body');
  if (body) body.innerHTML = libraryBodyHtml();
}


export function updateLibraryFacets(data) {
  const select = document.getElementById('library-tag');
  if (!select || !data?.facets?.tags) return;
  const current = state.library.tag;
  select.innerHTML = `<option value="">全部标签</option>${data.facets.tags.map((facet) => `<option value="${esc(facet.tag)}">${esc(facet.label || tagLabel(facet.tag))} · ${fmtNumber(facet.count)}</option>`).join('')}`;
  select.value = current;
}


export async function translateCatalogTitles(data) {
  if (!data?.items?.length || state.bootstrap?.demo) return;
  if (state.bootstrap?.settings?.ui?.autoTranslate === false) return;
  const items = data.items
    .filter((item) => item.identifier && item.name && !hasCjk(item.name) && !state.library.translations[item.identifier])
    .slice(0, 24)
    .map((item) => ({ key: item.identifier, identifier: item.identifier, version: item.version, field: 'name', text: item.name }));
  if (!items.length) return;
  const seq = ++state.library.translationSeq;
  const result = await api('/api/translate/batch', { method: 'POST', body: { items } });
  if (seq !== state.library.translationSeq) return;
  for (const row of result.results || []) {
    const text = row.translation?.text || (typeof row.translation === 'string' ? row.translation : '');
    if (text && !row.error) state.library.translations[row.key] = text;
  }
  if (state.view === 'library') renderLibraryBody();
}


export async function loadJobs() {
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


export async function loadInstalled() {
  if (state.installedLoading) return;
  if (!state.bootstrap?.instance) return;
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


export async function loadDiagnostics({ force = false } = {}) {
  if (state.diagnosticsLoading) return;
  if (!state.bootstrap?.instance) return;
  if (state.diagnostics && !force) return;
  state.diagnosticsLoading = true;
  state.diagnosticsError = null;
  if (state.view === 'overview' || state.view === 'diagnostics') renderView();
  try {
    const data = await api(`/api/diagnostics?log=1${force ? '&force=1' : ''}`);
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


export async function loadRelationships(identifier, version = null) {
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


export async function refreshScan() {
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


export async function launchGame(button) {
  setBusy(button, true, '正在启动…');
  try {
    const data = await api('/api/game/launch', { method: 'POST' });
    toast(`KSP 已启动${data.pid ? ` · PID ${data.pid}` : ''}`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}


export function exportModpack() {
  window.location.assign('/api/modpack/export');
}


export function importModpack() {
  document.getElementById('modpack-input')?.click();
}


export async function importModpackFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const preview = await api('/api/modpack/preview', { method: 'POST', body: data });
    const depends = Array.isArray(data.depends) ? data.depends : data.package?.depends || [];
    const roots = depends.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
    state.pendingPlan = { identifier: preview.modpack?.identifier, roots, plan: preview.plan, name: preview.modpack?.name };
    setModalContent(planModalHtml(preview.plan, preview.modpack?.name || file.name), { small: false });
  } catch (error) {
    toast(error.message, 'error');
  }
}


export async function refreshCatalog() {
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


export async function detectInstances() {
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


export function addInstanceModal() {
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


export async function selectInstance(id) {
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


export function deleteInstance(id) {
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


export function uninstall(identifier) {
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


export function findManagedEntry(id) {
  const entries = state.installed?.installed || state.installed?.scan?.entries || state.bootstrap.scan?.entries || [];
  const disabled = state.installed?.disabled || [];
  return [...entries, ...disabled].find((entry) => {
    const keys = [entry.identifier, entry.folder, entry.name, entry.id];
    return keys.some((key) => key && shortId(key) === shortId(id)) || entry.id === id;
  });
}


export async function afterModChange(message) {
  await reloadBootstrap({ resetData: true, render: false });
  await loadInstalled();
  toast(message);
}


export function disableManagedMod(id) {
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


export function enableManagedMod(id) {
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


export function deleteManagedMod(id) {
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


export async function updateManagedMod(id) {
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


export function updateAllMods() {
  const updates = state.installed?.updates || [];
  if (!updates.length) {
    toast('当前没有可更新的模组');
    return;
  }
  runUpdate(updates.map((item) => item.identifier));
}


export function updateSelectedMods() {
  const ids = [...document.querySelectorAll('#update-manager .update-select:checked')]
    .map((input) => input.value)
    .filter(Boolean);
  if (!ids.length) {
    toast('请先选择要更新的模组', 'warn');
    return;
  }
  runUpdate(ids);
}


export async function runUpdate(identifiers) {
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


export function openUpdateManager() {
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


export function setInstalledFilter(filter) {
  state.installedFilter = ['all', 'updates', 'disabled', 'manual'].includes(filter) ? filter : 'all';
  renderApp();
}


export function toggleBatch() {
  state.batchMode = !state.batchMode;
  renderView();
  if (state.batchMode) syncBatchSelection();
}


export function syncBatchSelection() {
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


export async function batchAction(action) {
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


export async function openFolder(target) {
  try {
    await api('/api/open', { method: 'POST', body: { target } });
    toast('已在文件资源管理器中打开');
  } catch (error) {
    toast(error.message, 'error');
  }
}


export async function openMod(identifier, version = null) {
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


export async function openModPage(identifier, version = null) {
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


export async function loadModPage(identifier, version = null) {
  const token = state.mod;
  if (!token) return;
  token.loading = true;
  token.error = null;
  renderApp();
  try {
    const isCf = /^curseforge-\d+$/.test(identifier);
    if (isCf) {
      const data = await api(`/api/curseforge/mod/${identifier.slice('curseforge-'.length)}`);
      if (state.mod !== token) return;
      token.data = data;
      token.version = data.package.version;
      token.images = Array.isArray(data.images) ? data.images : [];
      token.loading = false;
      renderApp();
      const settings = state.bootstrap?.settings?.ui || {};
      if (settings.autoTranslate !== false) {
        for (const field of ['name', 'abstract', 'description']) {
          const source = field === 'name' ? data.package.name : data.package[field];
          if (source && !hasCjk(source) && !token.translations[field] && !token.translationErrors[field]) {
            translateMod(field, false, { silent: true }).catch(() => {});
          }
        }
      }
      return;
    }
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
    if (settings.autoTranslate !== false && data.package.name && !hasCjk(data.package.name) && !token.translations.name && !token.translationErrors.name) {
      translateMod('name', false, { silent: true }).catch(() => {});
    }
    if (settings.autoTranslate !== false && data.package.description && !hasCjk(data.package.description) && !token.translations.description && !token.translationErrors.description) {
      translateMod('description', false, { silent: true }).catch(() => {});
    }
  } catch (error) {
    if (state.mod !== token) return;
    token.loading = false;
    token.error = error.message || '读取模组简介失败。';
    renderApp();
  }
}


export async function loadModImages(force = false) {
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


export function openLightbox(index = 0) {
  const images = state.mod?.images || [];
  if (!images.length) return;
  state.mod.lightboxIndex = Math.max(0, Math.min(Number(index) || 0, images.length - 1));
  setModalContent(lightboxHtml(), {});
}


export function stepLightbox(step) {
  const images = state.mod?.images || [];
  if (images.length < 2) return;
  state.mod.lightboxIndex = (state.mod.lightboxIndex + step + images.length) % images.length;
  setModalContent(lightboxHtml(), {});
}


export async function translateMod(field = 'abstract', force = false, { silent = false } = {}) {
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


export async function openPlan(identifier, version = null, options = {}) {
  if (!state.bootstrap?.instance) {
    toast('请先连接一个 KSP 实例。', 'warn');
    state.view = 'settings';
    renderApp();
    return;
  }
  const root = version ? { identifier, version } : identifier;
  setModalContent(`<div class="modal-head"><div><h2>安装计划</h2><p>正在解析前置依赖与版本兼容性…</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body" style="padding:30px 20px">${spinnerLine('正在计算依赖图…')}</div>`);
  state.pendingPlan = { identifier, version, plan: null, allowWarning: options.allowWarning };
  try {
    const settings = state.bootstrap.settings?.install || {};
    const data = await api('/api/resolve', {
      method: 'POST',
      body: {
        roots: [root],
        allowWarning: Boolean(options.allowWarning ?? settings.allowWarning),
        allowUnknown: Boolean(settings.allowUnknown),
        includeRecommended: false,
      },
    });
    const plan = data?.plan || data || {};
    state.pendingPlan.plan = plan;
    setModalContent(planModalHtml(plan, identifier), { small: false });
  } catch (error) {
    setModalContent(`<div class="modal-head"><div><h2>无法生成安装计划</h2><p>${esc(identifier)}</p></div><button class="btn icon ghost" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
      <div class="modal-body"><div class="notice red">${icon('alert', 18)}<div>${esc(error.message)}</div></div>${error.code === 'NO_INSTANCE' ? '<button class="btn primary" type="button" data-action="navigate" data-view="settings">去设置实例</button>' : ''}</div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-action="close-modal">关闭</button></div>`, { small: true });
  }
}


export async function confirmInstall() {
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
      roots: pending.roots || [pending.version ? { identifier: pending.identifier, version: pending.version } : pending.identifier],
      allowWarning: Boolean(pending.allowWarning ?? settings.allowWarning),
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


export async function openRepairPreview() {
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


export async function importCurseForgeMod(ref) {
  if (!state.bootstrap?.instance) {
    toast('请先连接 KSP 实例。', 'warn');
    return;
  }
  if (!ref) {
    toast('缺少 CurseForge 项目标识。', 'error');
    return;
  }
  const pkg = state.mod?.data?.package;
  const name = pkg?.name || '这个 CurseForge 项目';
  confirmAction({
    title: '从 CurseForge 安装',
    message: `将下载并安装 ${name}。CurseForge 项目没有 CKAN 依赖信息，安装后请在问题诊断里检查前置。`,
    confirmText: '下载并安装',
    onConfirm: async () => {
      const data = await api('/api/curseforge/install', { method: 'POST', body: { ref: String(ref) } });
      if (!data.job) {
        toast(data.message || '没有可安装的文件。', 'warn');
        return;
      }
      upsertJob(data.job);
      state.view = 'jobs';
      renderApp();
      toast('CurseForge 安装任务已加入队列');
    },
  });
}


export async function confirmRepair() {
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
    const blocked = Number(data.repairs?.blocked) || 0;
    state.view = 'jobs';
    renderApp();
    toast(blocked ? `自动修复任务已加入队列，另有 ${blocked} 项无法一起安装，已跳过` : '自动修复任务已加入队列', blocked ? 'warn' : 'success');
  } catch (error) {
    setBusy(button, false);
    toast(error.message, 'error');
  }
}


export function triggerArchive() {
  const input = document.getElementById('archive-input');
  if (input) {
    input.value = '';
    input.click();
  }
}


export async function previewArchive(file) {
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


export async function confirmUploadInstall() {
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


export function navigate(view) {
  if (!VIEW_META[view]) return;
  closeDrawer();
  closeModal();
  state.view = view;
  renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
  const root = document.getElementById('view-root');
  root?.focus?.({ preventScroll: true });
}


export function setLibraryStatus(status) {
  state.library.status = status;
  state.library.page = 1;
  renderApp();
  loadCatalog();
}


export function setLibraryPage(page) {
  const data = state.library.data;
  if (!data) return;
  if (page < 1 || page > data.pageCount) return;
  state.library.page = page;
  loadCatalog();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


export function clearLibraryFilter() {
  state.library.q = '';
  state.library.status = 'all';
  state.library.sort = 'relevance';
  state.library.tag = '';
  state.library.size = '';
  state.library.page = 1;
  renderApp();
  loadCatalog();
}


export async function saveSettings(form) {
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
      autoDependencies: checked('autoDependencies'),
    },
    network: {
      timeoutSeconds: Number(value('timeoutSeconds')) || 45,
      downloadTimeoutSeconds: Number(value('downloadTimeoutSeconds')) || 180,
      stallTimeoutSeconds: Number(value('stallTimeoutSeconds')) || 20,
      maxDownloadMB: Number(value('maxDownloadMB')) || 2048,
      allowInsecureHttp: checked('allowInsecureHttp'),
      githubMirror: checked('githubMirror'),
      mirrorPrefixes: String(value('mirrorPrefixes') || '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
    },
    catalog: {
      enabledSources,
      autoRefresh: checked('autoRefresh'),
      customSources,
    },
    ui: { pageSize: Math.min(96, Math.max(6, Number(value('pageSize')) || 24)), autoTranslate: checked('autoTranslate') },
  };
  const curseforgeApiKey = String(value('curseforgeApiKey') || '').trim();
  if (curseforgeApiKey) body.curseforgeApiKey = curseforgeApiKey;
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


export function appendSourceRow() {
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


export async function importCatalog() {
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


export async function exportCatalog() {
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


export async function uploadCatalogFile(file) {
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


export async function refreshJobs() {
  await loadJobs();
  toast('任务列表已刷新');
}


export async function cancelJob(id) {
  try {
    const data = await api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
    if (data.job) upsertJob(data.job);
    renderView();
    toast('已请求取消任务', 'warn');
  } catch (error) {
    toast(error.message, 'error');
  }
}


export function startEvents() {
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


export let jobRenderTimer = null;

export function scheduleJobRender() {
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


export let afterJobTimer = null;

export function afterJobFinished() {
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

