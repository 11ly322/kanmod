// Application shell: rendering, boot and event wiring.
import { VIEW_META, api, closeDrawer, closeModal, esc, icon, runConfirm, setBusy, spinnerLine, state, toast, truncate, updateNavCounts } from './js/core.js';
import { diagnosticsHtml, installedHtml, jobsHtml, libraryHtml, modPageHtml, overviewHtml, relationsHtml, settingsHtml } from './js/views.js';
import { addInstanceModal, appendSourceRow, batchAction, cancelJob, checkAppUpdate, clearCache, clearLibraryFilter, confirmInstall, confirmRepair, confirmUploadInstall, deleteInstance, deleteManagedMod, detectInstances, disableManagedMod, enableManagedMod, exportCatalog, exportModpack, importCatalog, importCurseForgeMod, importModpack, importModpackFile, launchGame, loadCatalog, loadCurseForge, loadDiagnostics, loadInstalled, loadJobs, loadModImages, loadModPage, loadRelationships, navigate, openFolder, openLightbox, openMod, openModPage, openPlan, openRepairPreview, openUpdateManager, previewArchive, refreshCatalog, refreshJobs, refreshScan, saveSettings, selectInstance, setInstalledFilter, setLibraryPage, setLibraryStatus, showCacheStatus, startEvents, stepLightbox, switchLibrarySource, syncBatchSelection, toggleBatch, translateMod, triggerArchive, uninstall, updateAllMods, updateManagedMod, updateSelectedMods, uploadCatalogFile } from './js/actions.js';

export function viewHtml() {
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


export function renderView() {
  const root = document.getElementById('view-root');
  if (!root) return;
  root.innerHTML = viewHtml();
  updateNavCounts();
}


export function renderApp() {
  if (!state.bootstrap) return;
  const app = document.getElementById('app');
  if (!app) return;
  const active = state.bootstrap.instance;
  const scan = state.bootstrap.scan;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
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
          <span>v${esc(state.bootstrap.app?.version || '0.1.7')}</span>
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
            ${active ? `<button class="btn primary sm" type="button" data-action="launch-game">${icon('rocket', 15)}启动游戏</button>` : ''}
            ${active ? `<button class="btn ghost sm" type="button" data-action="refresh-scan">${icon('refresh', 15)}扫描模组</button>` : ''}
            <button class="btn icon ghost" type="button" data-action="trigger-archive" title="安装本地安装包" aria-label="安装本地安装包">${icon('upload')}</button>
            <button class="btn icon ghost" type="button" data-action="toggle-theme" title="切换深色/浅色主题" aria-label="切换深色/浅色主题" aria-pressed="${dark}">${icon(dark ? 'sun' : 'moon')}</button>
            <button class="btn icon ghost" type="button" data-action="navigate" data-view="settings" title="设置" aria-label="设置">${icon('settings')}</button>
          </div>
        </header>
        <main class="main">
          <div id="view-root" class="view-root" tabindex="-1">${viewHtml()}</div>
        </main>
      </div>
    </div>
    <input id="archive-input" type="file" accept=".zip,.gz,.tgz,.tar.gz" hidden>
    <input id="modpack-input" type="file" accept=".ckan,.json,application/json" hidden>
    <input id="catalog-upload-input" type="file" accept=".json,.zip,.gz,.tgz,.tar.gz" hidden>
  `;
  updateNavCounts();
  ensureViewData();
}


export function ensureViewData() {
  if (!state.bootstrap) return;
  if (state.view === 'library' && !state.library.data && !state.library.loading) loadCatalog();
  if (state.view === 'installed' && state.bootstrap.instance && !state.installed && !state.installedLoading) loadInstalled();
  if ((state.view === 'overview' || state.view === 'diagnostics') && !state.diagnostics && !state.diagnosticsLoading) loadDiagnostics();
  if (state.view === 'jobs' && !state.jobsFullLoaded) loadJobs();
  if (state.view === 'relations' && state.relationshipQuery && !state.relationships && !state.relationshipLoading) {
    loadRelationships(state.relationshipQuery, state.relationshipVersion);
  }
}


export async function boot() {
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


export function retryBoot() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '<div class="boot-screen"><span class="brand-mark">K<span></span></span><div><strong>kanmod</strong><p>正在重新连接…</p></div><span class="spinner"></span></div>';
  }
  boot();
}


export function scheduleBootRetry() {
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


export function applyBootstrap(data) {
  state.bootstrap = data;
  state.jobs = Array.isArray(data.jobs) ? data.jobs.map((job) => job) : [];
  state.jobsFullLoaded = false;
}


export async function reloadBootstrap({ resetData = true, render = true } = {}) {
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


export function renderFatal(error) {
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


export function openOnboarding() {
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">KSP 1 · MOD WORKFLOW</p>
        <h2>把模组装好，<em>然后安心发射</em>。</h2>
        <p>kanmod 会自动找到你的 KSP 安装，索引社区模组与前置依赖，并在安装前检查版本兼容性。出现报错时，它会读日志、解释原因，只修复能够安全修复的部分。</p>
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


export function setupEvents() {
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
        case 'launch-game':
          await launchGame(actionNode);
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
          if (state.mod?.data?.source === 'curseforge') await loadModPage(state.mod.identifier, state.mod.version);
          else await loadModImages(true);
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
        case 'plan-warning':
          await openPlan(actionNode.dataset.id, null, { allowWarning: true });
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
          if (state.library.source === 'curseforge') await loadCurseForge();
          else await loadCatalog();
          break;
        case 'retry-curseforge':
          await loadCurseForge();
          break;
        case 'search-curseforge':
          state.library.cf.page = 1;
          await loadCurseForge();
          break;
        case 'curseforge-page':
          state.library.cf.page = Math.max(1, Number(actionNode.dataset.page));
          await loadCurseForge();
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
        case 'install-curseforge':
          await importCurseForgeMod(actionNode.dataset.ref);
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
        case 'toggle-theme': {
          const next = window.kanmodTheme?.toggle?.() || 'light';
          renderApp();
          toast(next === 'dark' ? '已切换到深色主题' : '已切换到浅色主题', 'success');
          break;
        }
        case 'cache-status':
          await showCacheStatus();
          break;
        case 'clear-cache':
          await clearCache();
          break;
        case 'trigger-archive':
          triggerArchive();
          break;
        case 'import-modpack':
          importModpack();
          break;
        case 'export-modpack':
          exportModpack();
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
        state.library.cf.page = 1;
        if (state.library.source === 'curseforge') await loadCurseForge();
        else await loadCatalog();
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
      state.searchTimer = setTimeout(() => {
        state.library.page = 1;
        state.library.cf.page = 1;
        if (state.library.source === 'curseforge') loadCurseForge();
        else loadCatalog();
      }, 260);
    }
  });

  document.addEventListener('change', async (event) => {
    if (event.target.id === 'theme-dark') {
      const next = window.kanmodTheme?.set?.(event.target.checked ? 'dark' : 'light') || (event.target.checked ? 'dark' : 'light');
      renderApp();
      toast(next === 'dark' ? '已切换到深色主题' : '已切换到浅色主题', 'success');
      return;
    }
    if (event.target.id === 'batch-all') {
      document.querySelectorAll('.row-select').forEach((input) => { input.checked = event.target.checked; });
      syncBatchSelection();
    } else if (event.target.classList?.contains('row-select')) {
      syncBatchSelection();
    } else if (event.target.id === 'library-source') {
      await switchLibrarySource(event.target.value);
    } else if (event.target.id === 'library-sort') {
      state.library.sort = event.target.value;
      state.library.page = 1;
      state.library.cf.page = 1;
      renderApp();
      if (state.library.source === 'curseforge') await loadCurseForge();
      else await loadCatalog();
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
    } else if (event.target.id === 'modpack-input') {
      const file = event.target.files?.[0];
      if (file) await importModpackFile(file);
      event.target.value = '';
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

