// Pure view builders: every function returns an HTML string.
import { esc, fmtBytes, fmtDate, fmtNumber, fmtTime, icon, initial, kindLabel, shortId, skeletonCards, skeletonRows, spinnerLine, state, truncate } from './core.js';
import { openOnboarding } from '../app.js';
import { navigate } from './actions.js';

// API pages always carry page/pageCount; fall back to page 1 when a payload is sparse.
function paginationOf(data) {
  const page = Number(data?.page) > 0 ? Math.floor(Number(data.page)) : 1;
  const pageCount = Number(data?.pageCount) > 0 ? Math.floor(Number(data.pageCount)) : 1;
  return { page, pageCount };
}


export function compatibilityBadge(compatibility) {
  if (!compatibility) return '<span class="badge">兼容性未知</span>';
  const classes = {
    compatible: 'ok', warning: 'warn', incompatible: 'bad', unknown: 'info',
  };
  const labels = {
    compatible: '兼容', warning: '需留意', incompatible: '不兼容', unknown: '未知',
  };
  return `<span class="badge ${classes[compatibility.status] || 'info'}" title="${esc(compatibility.reason || '')}">${esc(compatibility.label || labels[compatibility.status] || '未知')}</span>`;
}


export function actionBadge(action) {
  const map = {
    install: ['ok', '安装'], upgrade: ['warn', '升级'], downgrade: ['warn', '降级'], keep: ['', '已满足'],
  };
  const [variant, label] = map[action] || ['', action || '—'];
  return `<span class="badge ${variant}">${esc(label)}</span>`;
}


export function managedBadge(entry) {
  if (entry?.managedBy === 'kanmod') return '<span class="badge ok dot">kanmod 管理</span>';
  if (entry?.managedBy === 'ckan') return '<span class="badge info">外部索引管理</span>';
  return '<span class="badge">手动安装</span>';
}


export function statusMeta(status) {
  return ({
    queued: ['clock', '等待中', ''], running: ['refresh', '进行中', 'info'],
    done: ['check', '已完成', 'ok'], failed: ['alert', '失败', 'bad'],
    cancelled: ['x', '已取消', ''],
  }[status] || ['info', status || '未知', '']);
}


export function jobStatusBadge(status) {
  const [, label, variant] = statusMeta(status);
  return `<span class="badge ${variant}">${esc(label)}</span>`;
}


export function constraintText(relation) {
  const parts = [];
  if (relation?.minVersion) parts.push(`≥ ${relation.minVersion}`);
  if (relation?.maxVersion) parts.push(`≤ ${relation.maxVersion}`);
  return parts.join(' · ');
}


export function relationText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.message || value.reason || value.label || value.code || JSON.stringify(value);
}


export function missingReasonText(item) {
  const reason = item?.reason;
  const pinned = item?.details?.pinnedVersion;
  if (reason === 'no_version') {
    return pinned
      ? `所选版本 ${pinned} 与当前 KSP 版本不兼容，或没有满足依赖约束`
      : '没有适配当前 KSP 版本且满足依赖约束的版本';
  }
  if (reason === 'not_found') return '索引中找不到这个模组';
  if (reason === 'conflict') return '与其它依赖的版本约束冲突';
  return relationText(reason);
}


export function missingRootText(item) {
  const pinned = item?.details?.pinnedVersion;
  return pinned
    ? `所选版本 ${pinned} 不兼容当前游戏版本`
    : '没有适配当前游戏版本的可用版本';
}


export function retryWithWarnings(item) {
  const available = item?.details?.available || [];
  return available.some((entry) => ['warning', 'unknown'].includes(entry?.compatibility?.status));
}


export function missingAlternatives(item) {
  const rank = { compatible: 0, warning: 1, unknown: 2 };
  const available = [...(item?.details?.available || [])]
    .filter((entry) => rank[entry?.compatibility?.status] !== undefined)
    .sort((a, b) => rank[a.compatibility.status] - rank[b.compatibility.status]);
  return available.slice(0, 4).map((entry) => entry.version).filter(Boolean);
}


export function overviewHtml() {
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


export function issueRow(issue, compact = false) {
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


export function issueFixButton(issue) {
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


export function installedTable(entries, { compact = false, batchMode = false } = {}) {
  return `<div class="table-wrap" style="${compact ? 'box-shadow:none;border:0' : ''}">
    <table>
      <thead><tr>${batchMode ? '<th class="check-cell"><span class="sr-only">选择</span></th>' : ''}<th>模组</th><th>版本</th><th>适用 KSP</th><th>管理</th>${compact ? '' : '<th>大小</th>'}<th class="right">操作</th></tr></thead>
      <tbody>${entries.map((entry) => {
        const key = entry.identifier || entry.folder || entry.name || '';
        return `
        <tr class="${entry.disabled ? 'row-disabled' : ''}">
          ${batchMode ? `<td class="check-cell"><input class="row-select" type="checkbox" value="${esc(key)}" aria-label="选择 ${esc(entry.name || entry.folder || key)}"></td>` : ''}
          <td><div class="table-mod"><span class="mini-avatar">${initial(entry.name || entry.folder)}</span><div><strong>${esc(entry.name || entry.folder || entry.identifier || '未命名条目')}</strong><small>${esc(entry.identifier || entry.folder || '')}${entry.disabled ? ' · 已禁用' : ''}</small></div></div></td>
          <td class="mono">${esc(entry.installedVersion || '—')}${entry.updateAvailable && entry.latestVersion ? `<small class="update-hint">→ ${esc(entry.latestVersion)}</small>` : ''}</td>
          <td>${entry.kspVersion ? `<span class="badge">KSP ${esc(entry.kspVersion)}</span>` : '<span class="text-muted">未声明</span>'}</td>
          <td>${entry.disabled ? '<span class="badge muted">已禁用</span>' : managedBadge(entry)}</td>
          ${compact ? '' : `<td class="mono">${esc(entry.sizeLabel || fmtBytes(entry.size))}</td>`}
          <td><div class="row-actions">
            ${entry.identifier ? `<button class="btn ghost sm" type="button" data-action="open-mod-page" data-id="${esc(entry.identifier)}">${icon('book', 13)}简介</button>` : ''}
            ${entry.updateAvailable ? `<button class="btn primary sm" type="button" data-action="update-mod" data-id="${esc(entry.identifier)}" title="${entry.latestVersion ? `更新到 ${esc(entry.latestVersion)}` : '更新这个模组'}">更新</button>` : ''}
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


export function libraryHtml() {
  const lib = state.library;
  const catalog = state.bootstrap.catalog || {};
  const isCf = lib.source === 'curseforge';
  const cf = lib.cf;
  const statuses = [
    ['all', '全部'], ['compatible', '兼容'], ['installed', '已安装'], ['updatable', '可更新'],
  ];
  const sortOptions = isCf
    ? [['popularity', '热门'], ['downloads', '下载量'], ['updated', '最近更新'], ['name', '名称']]
    : [['relevance', '相关度'], ['name', '名称'], ['size', '体积'], ['version', '版本']];
  return `
    <div class="page-head">
      <div><h2>发现模组</h2><p>${isCf ? '从 CurseForge 检索 KSP 项目，查看图片、说明和自动翻译。' : '检索社区模组索引，查看版本兼容性。安装前会先解析前置依赖并给出完整计划。'}</p></div>
      <div class="head-aside">
        <button class="btn ghost" type="button" data-action="trigger-archive">${icon('upload', 15)}本地安装包</button>
        ${isCf ? `<button class="btn ghost" type="button" data-action="navigate" data-view="settings">${icon('settings', 15)}Forge Key</button>` : `<button class="btn ghost" type="button" data-action="refresh-catalog" ${state.bootstrap.demo ? 'title="演示模式不联网刷新"' : ''}>${icon('refresh', 15)}刷新索引</button>`}
      </div>
    </div>
    ${!isCf && !catalog.loaded ? `<div class="notice warn">${icon('alert', 18)}<div><strong>索引还没有加载。</strong> 在设置中刷新社区模组索引，或导入本地 JSON 索引。</div></div>` : ''}
    <form class="toolbar" data-form="library-search" role="search">
      <select id="library-source" class="select library-source" aria-label="模组来源">
        <option value="catalog" ${!isCf ? 'selected' : ''}>社区模组索引</option>
        <option value="curseforge" ${isCf ? 'selected' : ''}>CurseForge</option>
      </select>
      <label class="search">
        <span class="sr-only">搜索模组</span>
        ${icon('search', 15)}
        <input id="library-q" name="q" type="search" value="${esc(lib.q)}" placeholder="${isCf ? '搜索 CurseForge 项目名、作者…' : '搜索模组名、标识、作者或标签…'}" autocomplete="off">
      </label>
      ${isCf ? '' : `<div class="seg" role="group" aria-label="筛选">
        ${statuses.map(([id, label]) => `<button type="button" class="${lib.status === id ? 'active' : ''}" data-action="library-status" data-status="${id}">${label}</button>`).join('')}
      </div>
      <select id="library-tag" class="select" aria-label="按标签筛选">
        <option value="">全部标签</option>
        ${(lib.data?.facets?.tags || []).map((facet) => `<option value="${esc(facet.tag)}" ${lib.tag === facet.tag ? 'selected' : ''}>${esc(facet.label || tagLabel(facet.tag))} · ${fmtNumber(facet.count)}</option>`).join('')}
      </select>
      <select id="library-size" class="select" aria-label="按下载体积筛选">
        ${[['', '全部大小'], ['small', '小于 1 MB'], ['medium', '1–20 MB'], ['large', '大于 20 MB']].map(([id, label]) => `<option value="${id}" ${lib.size === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`}
      <select id="library-sort" class="select" aria-label="排序">
        ${sortOptions.map(([id, label]) => `<option value="${id}" ${lib.sort === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button class="btn primary" type="submit" ${isCf && cf.loading ? 'disabled' : ''}>${icon('search', 14)}搜索</button>
    </form>
    ${isCf && cf.data?.needsKey ? `<div class="notice warn">${icon('key', 18)}<div><strong>需要 CurseForge API Key。</strong> 在设置中填写后即可检索 Forge 项目与图片。</div></div>` : ''}
    <div id="library-body">${libraryBodyHtml()}</div>`;
}


export function curseforgeBodyHtml() {
  const lib = state.library;
  const cf = lib.cf;
  const data = cf.data;
  if (cf.error) {
    return `<div class="empty"><div class="empty-icon">${icon('alert')}</div><strong>读取 CurseForge 失败</strong><p>${esc(cf.error)}</p><button class="btn primary" type="button" data-action="retry-curseforge">重试</button></div>`;
  }
  if (!data) {
    if (cf.loading) return skeletonCards(6);
    return `<div class="empty"><div class="empty-icon">${icon('box')}</div><strong>从 CurseForge 开始检索</strong><p>输入关键词，或直接搜索查看热门 KSP 项目。</p><button class="btn primary" type="button" data-action="search-curseforge">浏览热门项目</button></div>`;
  }
  if (data.needsKey) {
    return `<div class="empty"><div class="empty-icon">${icon('key')}</div><strong>还没有配置 CurseForge API Key</strong><p>${esc(data.message || '在设置中填写 API Key 后即可检索。')}</p><button class="btn primary" type="button" data-action="navigate" data-view="settings">前往设置</button></div>`;
  }
  const items = data.items || [];
  if (!items.length) {
    return `<div class="results-meta"><span>没有匹配的 CurseForge 项目</span></div>
      <div class="empty"><div class="empty-icon">${icon('search')}</div><strong>没有结果</strong><p>换一个关键词再试。</p></div>`;
  }
  const { page, pageCount } = paginationOf(data);
  return `<div class="results-meta">
      <span>共 ${fmtNumber(data.total)} 个 CurseForge 项目 · 第 ${page} / ${pageCount} 页</span>
      <span>${cf.loading ? '<span class="spinner"></span> 更新中…' : 'CurseForge'}</span>
    </div>
    <div class="mod-grid">${items.map(modCard).join('')}</div>
    ${pageCount > 1 ? `<div class="pagination">
      <button class="btn ghost sm" type="button" data-action="curseforge-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pageCount} 页</span>
      <button class="btn ghost sm" type="button" data-action="curseforge-page" data-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>下一页</button>
    </div>` : ''}`;
}


export function libraryBodyHtml() {
  const lib = state.library;
  if (lib.source === 'curseforge') return curseforgeBodyHtml();
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
  const { page, pageCount } = paginationOf(data);
  return `<div class="results-meta">
      <span>共 ${fmtNumber(data.total)} 个模组 · 第 ${page} / ${pageCount} 页</span>
      <span>${lib.loading ? '<span class="spinner"></span> 更新中…' : esc(sourceNameLabel(state.bootstrap.catalog?.sourceName))}</span>
    </div>
    <div class="mod-grid">${items.map(modCard).join('')}</div>
    ${pageCount > 1 ? `<div class="pagination">
      <button class="btn ghost sm" type="button" data-action="library-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pageCount} 页</span>
      <button class="btn ghost sm" type="button" data-action="library-page" data-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>下一页</button>
    </div>` : ''}`;
}


export function modCard(item) {
  const isCf = item.source === 'curseforge';
  const installed = item.installed
    ? `<span class="installed-flag"><span class="badge ok dot">已安装${item.installedVersion ? ` ${esc(item.installedVersion)}` : ''}</span></span>`
    : '';
  const title = translatedName(item);
  return `<article class="mod-card">
    ${installed}
    <div class="mod-card-top">
      <span class="mod-avatar" aria-hidden="true">${initial(item.name)}</span>
      <div class="mod-title"><h3 title="${esc(item.name || item.identifier)}">${esc(title || item.identifier || '未命名模组')}</h3>${title !== item.name ? `<span class="mod-original-title">${esc(item.name)}</span>` : ''}<span class="mod-id">${esc(item.identifier || '—')}</span></div>
    </div>
    <p class="mod-abstract">${esc(item.abstract || '这个模组还没有简介。')}</p>
    <div class="mod-meta">${compatibilityBadge(item.compatibility)}<span class="tag">${esc(kindLabel(item.kind))}</span>${(item.tags || []).slice(0, 2).map((tag) => `<span class="tag">${esc(tagLabel(tag))}</span>`).join('')}${item.downloadSize ? `<span class="tag">${esc(fmtBytes(item.downloadSize))}</span>` : ''}</div>
    <div class="mod-foot">
      <span class="version">${item.version ? `v${esc(item.version)}` : '版本未知'}</span>
      <div class="mod-actions">
        <button class="btn ghost sm" type="button" data-action="open-mod-page" data-id="${esc(item.identifier)}" data-version="${esc(item.version)}">${icon('book', 13)}简介</button>
        ${isCf
          ? `<a class="btn ghost sm" href="${esc(item.curseforge?.url || 'https://www.curseforge.com/kerbal-space-program')}" target="_blank" rel="noreferrer">${icon('link', 13)}CurseForge</a>`
          : `<button class="btn ${item.installed ? 'soft' : 'primary'} sm" type="button" data-action="plan-install" data-id="${esc(item.identifier)}">${item.installed ? '管理' : '安装'}</button>`}
      </div>
    </div>
  </article>`;
}


export function translatedName(item) {
  const value = state.library.translations?.[item.identifier];
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value.text === 'string' && value.text.trim()) return value.text;
  return item.name;
}


export function tagLabel(tag) {
  return state.bootstrap?.tagLabels?.[tag] || state.library.data?.facets?.tagLabels?.[tag] || state.library.data?.facets?.tags?.find((facet) => facet.tag === tag)?.label || tag;
}


export function sourceNameLabel(name) {
  const value = String(name || '').trim();
  if (!value) return '社区模组索引';
  if (/^CKAN\s*官方索引$/i.test(value)) return '社区模组索引';
  if (/CKAN/i.test(value)) return value.replace(/CKAN/gi, '社区').replace(/官方索引/g, '索引').replace(/官方/g, '社区');
  return value;
}


export function installedHtml() {
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
        <button class="btn ghost" type="button" data-action="import-modpack">${icon('upload', 15)}导入模组包</button>
        <button class="btn ghost" type="button" data-action="export-modpack">${icon('download', 15)}导出模组包</button>
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


export function modPageHtml() {
  const mod = state.mod;
  if (!state.bootstrap?.instance && mod?.data?.source !== 'curseforge') return openOnboarding();
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
  const isCf = data.source === 'curseforge';
  const relations = data.relationships || {};
  const versions = data.versions || [];
  const installed = data.installed;
  const compatibility = data.compatibility;
  const abstract = pkg.abstract || '这个模组还没有简介。';
  const description = String(pkg.description || '').trim();
  const displayName = mod.translations?.name?.text || pkg.name || pkg.identifier || '未命名模组';
  return `
    <div class="mod-page-head">
      <div>
        <button class="btn ghost sm mod-back" type="button" data-action="mod-back">${icon('chevron', 14)}返回模组库</button>
        <div class="mod-page-title">
          <span class="mod-avatar xl" aria-hidden="true">${initial(pkg.name)}</span>
          <div>
            <p class="eyebrow">模组简介 · ${esc(kindLabel(pkg.kind))}</p>
            <h2>${esc(displayName)}</h2>
            ${displayName !== pkg.name ? `<p class="mod-original-name">${esc(pkg.name)}</p>` : ''}
            <div class="mod-page-sub"><span class="mono">${esc(pkg.identifier || '—')}</span><span>${pkg.version ? `v${esc(pkg.version)}` : '版本未知'}</span>${installed ? `<span class="badge ok dot">已安装 ${esc(installed)}</span>` : ''}</div>
          </div>
        </div>
        <div class="mod-page-badges">${compatibilityBadge(compatibility)}${pkg.releaseStatus && pkg.releaseStatus !== 'stable' ? `<span class="badge warn">${esc(pkg.releaseStatus)}</span>` : ''}<span class="badge">${esc(kindLabel(pkg.kind))}</span></div>
      </div>
      <div class="head-aside">
        ${isCf
          ? `<a class="btn primary" href="${esc(pkg.resources?.homepage || pkg.curseforge?.url || 'https://www.curseforge.com/kerbal-space-program')}" target="_blank" rel="noreferrer">${icon('link', 15)}在 CurseForge 打开</a>`
          : `<button class="btn primary" type="button" data-action="plan-install" data-id="${esc(pkg.identifier)}" data-version="${esc(pkg.version)}">${icon('download', 15)}${installed ? '查看安装计划' : '安装模组'}</button>`}
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
            <div><dt>当前版本</dt><dd class="mono">${esc(pkg.version || '—')}</dd></div>
            <div><dt>作者</dt><dd>${esc(pkg.author || '未注明')}</dd></div>
            <div><dt>适用 KSP</dt><dd>${esc(pkg.kspVersion || (pkg.kspVersionMin || pkg.kspVersionMax ? `${pkg.kspVersionMin || '?'} – ${pkg.kspVersionMax || '?'}` : '未声明'))}</dd></div>
            <div><dt>下载体积</dt><dd>${esc(fmtBytes(pkg.downloadSize))}</dd></div>
            <div><dt>许可证</dt><dd>${esc(pkg.license || '未注明')}</dd></div>
            <div><dt>标识</dt><dd class="mono">${esc(pkg.identifier)}</dd></div>
            ${(pkg.tags || []).length ? `<div><dt>标签</dt><dd class="mod-tag-list">${pkg.tags.map((tag) => `<span class="tag">${esc(tagLabel(tag))}</span>`).join('')}</dd></div>` : ''}
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
            ${versions.map((entry) => isCf
              ? `<span class="version-chip ${entry.version === pkg.version ? 'active' : ''}" title="${esc(entry.compatibility?.reason || '')}">${esc(entry.version)}</span>`
              : `<button class="version-chip ${entry.version === pkg.version ? 'active' : ''}" type="button" data-action="mod-version" data-id="${esc(pkg.identifier)}" data-version="${esc(entry.version)}" title="${esc(entry.compatibility?.reason || '')}">${esc(entry.version)}</button>`).join('') || '<span class="text-muted">索引中没有其它版本。</span>'}
          </div>
        </section>
      </aside>
    </div>`;
}


export function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}


export function translationCard(field, title) {
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


export function relationSummaryHtml(relations) {
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


export function diagnosticsHtml() {
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


export function issueCard(issue) {
  return `<div class="issue-card">
    <div class="issue-main">
      <div class="issue-icon ${issue.severity}">${icon(issue.severity === 'error' ? 'alert' : issue.severity === 'warning' ? 'alert' : 'info', 15)}</div>
      <div class="issue-copy">
        <strong>${esc(issue.title || issue.code || '未命名问题')}</strong>
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


export function logPanel(log) {
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


export function relationsHtml() {
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


export function relationSuggestions() {
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


export function relationGraphPage(data) {
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


export function relationSection(title, list, type) {
  if (!list?.length) return '';
  return `<div class="relation-section"><h3>${esc(title)} <span class="badge" style="margin-left:auto">${fmtNumber(list.length)}</span></h3>
    <div class="relation-list">${list.map((relation) => relationItem(relation, type)).join('')}</div>
  </div>`;
}


export function relationItem(relation, type) {
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


export function graphSvg(pkg, relations) {
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


export function jobCompact(job) {
  const percent = Math.max(0, Math.min(100, Number(job.progress?.percent) || 0));
  return `<div class="issue-row">
    <div class="issue-icon ${job.status === 'failed' ? 'error' : job.status === 'done' ? '' : 'warning'}">${icon(job.status === 'done' ? 'check' : job.status === 'failed' ? 'alert' : 'refresh', 15)}</div>
    <div class="issue-copy"><strong>${esc(job.title || '未命名任务')}</strong><p>${esc(job.progress?.message || '等待执行…')}</p>
      <div class="progress" style="margin:8px 0 0"><span style="width:${percent}%"></span></div>
    </div>
    <div class="issue-actions">${jobStatusBadge(job.status)}</div>
  </div>`;
}


export function jobsHtml() {
  const jobs = state.jobs || [];
  return `
    <div class="page-head">
      <div><h2>下载与安装队列</h2><p>任务按顺序执行。可以展开日志查看每个下载源的尝试过程；取消任务会尽力停止当前下载。</p></div>
      <div class="head-aside"><button class="btn ghost" type="button" data-action="refresh-jobs">${icon('refresh', 15)}刷新</button></div>
    </div>
    ${jobs.length ? jobs.map(jobCard).join('') : `<div class="empty card"><div class="empty-icon">${icon('download')}</div><strong>队列是空的</strong><p>安装模组、刷新索引或自动修复都会在这里生成任务。</p><button class="btn ghost" type="button" data-action="navigate" data-view="library">浏览模组库</button></div>`}`;
}


export function jobCard(job) {
  const percent = Math.max(0, Math.min(100, Number(job.progress?.percent) || 0));
  const active = job.status === 'queued' || job.status === 'running';
  const logs = (job.logs || []).slice(-35).map((line) => `[${fmtTime(line.at)}] ${line.message}`).join('\n');
  const status = statusMeta(job.status);
  return `<div class="job-card">
    <div class="job-head">
      <div class="job-status-icon ${job.status === 'running' ? 'running' : job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : ''}">${icon(status[0], 15)}</div>
      <div class="job-title"><strong>${esc(job.title || '未命名任务')}</strong><small>${esc(job.type || 'task')} · 创建于 ${esc(fmtDate(job.createdAt))}</small></div>
      ${jobStatusBadge(job.status)}
      ${active ? `<button class="btn danger sm" type="button" data-action="cancel-job" data-id="${esc(job.id)}">取消</button>` : ''}
    </div>
    <div class="progress"><span style="width:${percent}%"></span></div>
    <div class="job-progress-line"><span>${esc(job.progress?.message || '等待执行…')}</span><span>${percent}%${job.progress?.current != null && job.progress?.total ? ` · ${job.progress.current}/${job.progress.total}` : ''}</span></div>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ''}
    ${logs ? `<details class="job-logs"><summary>执行日志（${job.logs.length} 条）</summary><pre class="job-log">${esc(logs)}</pre></details>` : ''}
  </div>`;
}


export function settingsHtml() {
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
          ${switchRow('autoDependencies', '自动解析并下载前置依赖', '安装或更新时自动把缺少的前置依赖加入计划并一起下载。关闭后只安装所选模组，缺少前置时会被阻止。', install.autoDependencies !== false)}
        </section>

        <section class="card form-section" style="grid-column:1/-1">
          <h3>${icon('network', 15)}索引源</h3>
          <p class="section-desc">安装模组时会按直链、镜像前缀、GitHub Releases、SpaceDock 的顺序回退。索引只用于读取 .ckan 元数据。</p>
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
            <div class="field" style="flex:2"><label for="new-source-url">地址</label><input id="new-source-url" type="url" placeholder="https://example.com/catalog.tar.gz"></div>
            <button class="btn ghost" type="button" data-action="append-source">${icon('plus', 14)}添加</button>
          </div>
          <div class="divider"></div>
          <div class="section-title" style="margin:14px 0 6px">CurseForge 源 <span class="sub">可选 · API Key</span></div>
          <div class="field">
            <label for="curseforgeApiKey">CurseForge API Key</label>
            <input id="curseforgeApiKey" name="curseforgeApiKey" type="password" autocomplete="off" placeholder="${s.hasCurseforgeKey ? '已配置，留空保持不变' : '填写 CurseForge API Key 后启用'}">
            <span class="hint">在 CurseForge 控制台申请。Key 只保存在本机设置中，用于检索项目、图片与说明。</span>
          </div>
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
            <button class="btn primary sm" type="button" data-action="refresh-catalog" ${canNetwork ? '' : 'disabled'}>${icon('refresh', 14)}刷新索引</button>
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
          ${switchRow('autoTranslate', '自动翻译标题、标签和简介', '打开模组简介时自动翻译标题和英文简介，标签使用内置中文词典。机器翻译仅供参考，原文始终保留。', ui.autoTranslate !== false)}
          <div class="divider"></div>
          <div class="field">
            <label>应用更新</label>
            <span class="hint">通过安装目录中的更新程序检查 GitHub 最新版本。更新会保留游戏模组与数据。</span>
          </div>
          <div id="app-update-status" class="text-muted" style="font-size:10.5px;line-height:1.6;margin-bottom:8px">当前版本 v${esc(data.app?.version || '0.1.3')}。更新程序随安装器一起安装。</div>
          <button class="btn ghost sm" type="button" data-action="check-update">${icon('refresh', 14)}检查更新</button>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="btn ghost sm" type="button" data-action="cache-status">${icon('refresh', 14)}查看缓存</button>
            <button class="btn ghost sm" type="button" data-action="clear-cache">${icon('trash', 14)}清理缓存</button>
          </div>
          <div id="cache-status" class="text-muted" style="font-size:10.5px;line-height:1.6;margin-top:8px">缓存包含下载包、图片和翻译结果，可随时清理。</div>
          <div class="field"><label>数据目录</label><input type="text" value="${esc(s.dataDir || '')}" readonly></div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="data">${icon('folder', 14)}打开数据目录</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="backups">${icon('archive', 14)}备份</button>
            <button class="btn ghost sm" type="button" data-action="open-folder" data-target="trash">${icon('trash', 14)}回收站</button>
          </div>
          <div class="divider"></div>
          <div class="text-muted" style="font-size:10.5px;line-height:1.6">
            kanmod ${esc(data.app?.version || '0.1.3')} · 本地服务仅在 127.0.0.1 监听。演示数据位于临时目录时可随时重建。
          </div>
        </section>
      </div>
      <div class="settings-actions">
        <button class="btn primary" type="submit">${icon('check', 15)}保存设置</button>
      </div>
    </form>`;
}


export function switchRow(name, title, description, checked) {
  return `<label class="switch-row">
    <span class="switch-copy"><strong>${esc(title)}</strong><small>${esc(description)}</small></span>
    <span class="switch"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}><span></span></span>
  </label>`;
}


export function customSourceRow(source) {
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


export function galleryHtml() {
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


export function pkgName() {
  return state.mod?.data?.package?.name || '模组';
}


export function lightboxHtml() {
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


export function drawerLoading(identifier) {
  return `<div class="drawer-head"><strong>模组详情</strong><button class="btn icon ghost" type="button" data-action="close-drawer" aria-label="关闭">${icon('x')}</button></div>
    <div class="drawer-loading">${spinnerLine('正在读取 ' + identifier + '…')}</div>`;
}


export function drawerDetail(data, identifier) {
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


export function shortVersion(version) {
  return String(version || '').slice(0, 18);
}


export function planModalHtml(plan, rootIdentifier) {
  plan = plan || {};
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
      ${plan.missing?.length ? `<div class="notice red" style="margin-bottom:12px">${icon('alert', 17)}<div><strong>${plan.missing.every((item) => item.root) ? '所选模组无法安装' : `缺少 ${plan.missing.length} 个必需依赖`}</strong>，当前计划不能安装。${plan.missing.map((item) => {
        const alternatives = missingAlternatives(item);
        const identifier = item.details?.identifier || item.name || item.identifier || item.label;
        const unpinned = item.root && item.details?.pinnedVersion
          ? `<button class="btn ghost sm" type="button" data-action="plan-install" data-id="${esc(identifier)}">改用兼容版本</button>`
          : '';
        const unverified = retryWithWarnings(item)
          ? `<button class="btn ghost sm" type="button" data-action="plan-warning" data-id="${esc(identifier)}">允许未验证版本</button>`
          : '';
        const actions = `${unpinned}${unverified}`;
        return `<div class="missing-row"><div class="text-muted">${esc(item.name || item.identifier)} · ${esc(item.root ? missingRootText(item) : missingReasonText(item))}${alternatives.length ? `（兼容候选：${esc(alternatives.join(' / '))}）` : ''}</div>${actions ? `<div class="missing-actions">${actions}</div>` : ''}</div>`;
      }).join('')}</div></div>` : ''}
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

