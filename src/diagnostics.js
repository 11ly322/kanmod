import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanGameData } from './ksp/scan.js';
import { readTailBytes } from './util/fsx.js';
import { normalizeName, satisfiesVersion, compareVersions, checkKspCompatibility } from './util/version.js';

const LOG_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_LOG_GROUPS = 24;
const MAX_ERROR_LINES = 6000;

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function issue(id, severity, code, title, detail, extra = {}) {
  return { id, severity, code, title, detail, autoFixable: false, ...extra };
}

function recordsOf(registry) {
  if (!registry) return [];
  if (typeof registry.records === 'function') {
    try {
      return registry.records();
    } catch {
      return [];
    }
  }
  if (Array.isArray(registry)) return registry;
  if (Array.isArray(registry.records)) return registry.records;
  if (registry.mods && typeof registry.mods === 'object') return Object.values(registry.mods);
  return [];
}

function entryIdentifier(entry, record, catalog) {
  if (entry.identifier) return entry.identifier;
  if (record?.identifier) return record.identifier;
  const component = (entry.components || []).find((item) => item.identifier);
  if (component?.identifier) return component.identifier;
  if (!catalog) return null;
  const name = normalizeName(entry.name);
  for (const pkg of catalog.all) {
    if (normalizeName(pkg.name) === name || normalizeName(pkg.identifier) === name) return pkg.identifier;
  }
  return null;
}

function packageForInstalled(catalog, identifier, version) {
  if (!catalog || !identifier) return { exact: null, latest: null };
  const exact = catalog.get(identifier, version);
  const latest = exact || catalog.versions(identifier)[0] || null;
  return { exact, latest };
}

function installedProviders(mods) {
  const providers = new Set();
  for (const mod of mods) {
    if (mod.identifier) providers.add(normalizeName(mod.identifier));
    if (mod.name) providers.add(normalizeName(mod.name));
    for (const provided of mod.provides || []) providers.add(normalizeName(provided));
    for (const component of mod.components || []) {
      if (component.identifier) providers.add(normalizeName(component.identifier));
      if (component.name) providers.add(normalizeName(component.name));
    }
  }
  return providers;
}

function installedVersionMap(mods) {
  const map = new Map();
  for (const mod of mods) {
    const version = mod.version || null;
    if (mod.identifier) map.set(mod.identifier.toLowerCase(), version);
    map.set(normalizeName(mod.name), version);
    for (const provided of mod.provides || []) map.set(normalizeName(provided), version);
  }
  return map;
}

function selectFixPackage(catalog, relation, kspVersion, { allowWarning = false } = {}) {
  if (!catalog) return null;
  const identifiers = [];
  if (catalog.hasIdentifier(relation.name)) identifiers.push(relation.name);
  for (const provider of catalog.providersFor(relation.name)) {
    if (!identifiers.includes(provider.identifier)) identifiers.push(provider.identifier);
  }
  for (const identifier of identifiers) {
    for (const pkg of catalog.versions(identifier)) {
      if (relation.minVersion || relation.maxVersion) {
        if (!satisfiesVersion(pkg.version, relation.minVersion, relation.maxVersion)) continue;
      }
      const compatibility = checkKspCompatibility(kspVersion, pkg);
      if (compatibility.status === 'compatible') return pkg;
    }
  }
  if (!allowWarning) return null;
  for (const identifier of identifiers) {
    for (const pkg of catalog.versions(identifier)) {
      if (relation.minVersion || relation.maxVersion) {
        if (!satisfiesVersion(pkg.version, relation.minVersion, relation.maxVersion)) continue;
      }
      const compatibility = checkKspCompatibility(kspVersion, pkg);
      if (compatibility.status === 'warning' || compatibility.status === 'unknown') return pkg;
    }
  }
  return null;
}

function formatRange(relation) {
  if (relation.minVersion && relation.maxVersion) return `${relation.minVersion} – ${relation.maxVersion}`;
  if (relation.minVersion) return `≥ ${relation.minVersion}`;
  if (relation.maxVersion) return `≤ ${relation.maxVersion}`;
  return '任意版本';
}

function analyzeMods(scan, catalog, kspVersion, registry, settings) {
  const records = recordsOf(registry);
  const byFolder = new Map(records.map((record) => [String(record.folder || record.installRel || '').toLowerCase(), record]));
  const mods = [];
  for (const entry of scan.entries || []) {
    const record = byFolder.get(String(entry.folder || '').toLowerCase()) || entry.registryRecord || null;
    const identifier = entryIdentifier(entry, record, catalog);
    const version = entry.installedVersion || record?.version || null;
    const { exact, latest } = packageForInstalled(catalog, identifier, version);
    const metadata = exact || null;
    const compatibility = checkKspCompatibility(kspVersion, metadata || {
      ksp_version: entry.kspVersion,
      ksp_version_min: entry.kspVersionMin,
      ksp_version_max: entry.kspVersionMax,
    });
    const compatible = catalog && identifier
      ? catalog.compatiblePackage(identifier, kspVersion, { allowWarning: Boolean(settings.install?.allowWarning) })
      : null;
    const updateAvailable = Boolean(
      compatible?.pkg && version && compareVersions(compatible.pkg.version, version) > 0,
    );
    mods.push({
      entryId: entry.id,
      identifier,
      name: entry.name || metadata?.name || record?.name || identifier || '未知模组',
      version,
      folder: entry.folder,
      relPath: entry.relPath,
      managed: Boolean(entry.managed),
      managedBy: entry.managedBy,
      components: entry.components || [],
      provides: metadata?.provides || [],
      depends: metadata?.depends || [],
      conflicts: metadata?.conflicts || [],
      compatibility,
      catalogVersion: compatible?.pkg?.version || latest?.version || null,
      catalogCompatibility: compatible?.compatibility || null,
      updateAvailable,
      entry,
      record,
    });
  }
  const seenIdentifiers = new Set(mods.map((mod) => mod.identifier?.toLowerCase()).filter(Boolean));
  for (const record of records) {
    if (!record.identifier || seenIdentifiers.has(record.identifier.toLowerCase())) continue;
    const { exact, latest } = packageForInstalled(catalog, record.identifier, record.version);
    const metadata = exact || latest;
    mods.push({
      entryId: null,
      identifier: record.identifier,
      name: record.name || record.identifier,
      version: record.version || null,
      folder: record.folder || record.installRel || null,
      relPath: record.folder || record.installRel || null,
      managed: true,
      managedBy: 'kanmod',
      components: [],
      provides: metadata?.provides || [],
      depends: metadata?.depends || [],
      conflicts: metadata?.conflicts || [],
      compatibility: checkKspCompatibility(kspVersion, metadata || {}),
      catalogVersion: latest?.version || null,
      updateAvailable: Boolean(latest && record.version && compareVersions(latest.version, record.version) > 0),
      entry: null,
      record,
    });
    seenIdentifiers.add(record.identifier.toLowerCase());
  }
  return mods;
}

function relationIssue(mod, relation, catalog, kspVersion, providers, settings, fixCache = null) {
  const nameKey = normalizeName(relation.name);
  const provided = providers.has(nameKey);
  if (!provided) {
    const cacheKey = `${nameKey}|${relation.minVersion || ''}|${relation.maxVersion || ''}|${Boolean(settings.install?.allowWarning)}|${kspVersion || ''}`;
    let fixPkg;
    if (fixCache) {
      if (!fixCache.has(cacheKey)) {
        fixCache.set(cacheKey, selectFixPackage(catalog, relation, kspVersion, { allowWarning: Boolean(settings.install?.allowWarning) }));
      }
      fixPkg = fixCache.get(cacheKey);
    } else {
      fixPkg = selectFixPackage(catalog, relation, kspVersion, { allowWarning: Boolean(settings.install?.allowWarning) });
    }
    return issue(
      `dep-missing-${mod.identifier || mod.entryId}-${hash(relation.name)}`,
      'error',
      'missing-dependency',
      `缺少前置：${relation.name}`,
      `${mod.name} 需要前置 ${relation.name}${relation.minVersion ? ` ${formatRange(relation)}` : ''}，但当前没有安装。`,
      {
        mods: [mod.identifier].filter(Boolean),
        dependency: relation.name,
        autoFixable: Boolean(fixPkg),
        fix: fixPkg
          ? { action: 'install', identifier: fixPkg.identifier, version: fixPkg.version, label: `安装 ${fixPkg.name} ${fixPkg.version}` }
          : null,
      },
    );
  }
  const installedVersion = mod.providers?.[nameKey] || null;
  return null;
}

function dependencyVersionIssues(mod, catalog, kspVersion, versionMap, settings) {
  const issues = [];
  for (const relation of mod.depends || []) {
    const nameKey = normalizeName(relation.name);
    const installedVersion = versionMap.get(nameKey) || versionMap.get(String(relation.name).toLowerCase()) || null;
    if (!installedVersion) continue;
    if (!satisfiesVersion(installedVersion, relation.minVersion, relation.maxVersion)) {
      const fixPkg = selectFixPackage(catalog, relation, kspVersion, { allowWarning: Boolean(settings.install?.allowWarning) });
      issues.push(issue(
        `dep-version-${mod.identifier}-${hash(relation.name)}`,
        'error',
        'dependency-version',
        `前置版本不匹配：${relation.name}`,
        `${mod.name} 要求 ${relation.name} ${formatRange(relation)}，当前安装的是 ${installedVersion}。`,
        {
          mods: [mod.identifier].filter(Boolean),
          dependency: relation.name,
          autoFixable: Boolean(fixPkg),
          fix: fixPkg
            ? { action: 'install', identifier: fixPkg.identifier, version: fixPkg.version, label: `更新 ${fixPkg.name} 到 ${fixPkg.version}` }
            : null,
        },
      ));
    }
  }
  return issues;
}

export function analyzeRelations(scan, catalog, kspVersion, registry, settings = {}, options = {}) {
  const mods = analyzeMods(scan, catalog, kspVersion, registry, settings);
  const providers = installedProviders(mods);
  const versionMap = installedVersionMap(mods);
  const disabledKeys = new Set((options.disabled || [])
    .map((item) => normalizeName(item.identifier || item.name || item.folder))
    .filter(Boolean));
  const fixCache = new Map();
  const issues = [];
  const disabledDependencies = new Set();
  for (const mod of mods) {
    if (!mod.identifier && !mod.entryId) continue;
    for (const relation of mod.depends || []) {
      const nameKey = normalizeName(relation.name);
      if (!providers.has(nameKey) && disabledKeys.has(nameKey)) {
        if (!disabledDependencies.has(nameKey)) {
          disabledDependencies.add(nameKey);
          issues.push(issue(
            `dep-disabled-${hash(nameKey)}`,
            'warning',
            'dependency-disabled',
            `前置已禁用：${relation.name}`,
            `${relation.name} 已经安装但处于禁用状态，因此依赖它的模组可能无法正常工作。请在“已安装”页面启用它，kanmod 不会重复安装已存在的模组。`,
            { mods: [mod.identifier].filter(Boolean), dependency: relation.name, autoFixable: false },
          ));
        }
        continue;
      }
      const missing = relationIssue(mod, relation, catalog, kspVersion, providers, settings, fixCache);
      if (missing) issues.push(missing);
    }
    issues.push(...dependencyVersionIssues(mod, catalog, kspVersion, versionMap, settings));
  }
  const modIdentifiers = new Set(mods.map((mod) => mod.identifier?.toLowerCase()).filter(Boolean));
  for (const mod of mods) {
    for (const relation of mod.conflicts || []) {
      if (!modIdentifiers.has(relation.name.toLowerCase()) && !providers.has(normalizeName(relation.name))) continue;
      issues.push(issue(
        `conflict-${mod.identifier}-${hash(relation.name)}`,
        'warning',
        'conflict',
        `模组冲突：${mod.name} 与 ${relation.name}`,
        `${mod.name} 声明与 ${relation.name} 冲突，两者不能同时安装。kanmod 不会自动移除任何模组。`,
        { mods: [mod.identifier, relation.name].filter(Boolean), autoFixable: false },
      ));
    }
    const compatibility = mod.compatibility;
    if (compatibility.status === 'incompatible') {
      const compatible = catalog && mod.identifier
        ? catalog.compatiblePackage(mod.identifier, kspVersion, { allowWarning: true })
        : null;
      const newer = compatible?.pkg && compatible.pkg.version !== mod.version
        && (!mod.version || compareVersions(compatible.pkg.version, mod.version) > 0);
      issues.push(issue(
        `ksp-version-${mod.entryId || mod.identifier}`,
        'error',
        'ksp-incompatible',
        `版本不兼容：${mod.name}`,
        `${mod.name} ${mod.version || ''} 不支持当前 KSP ${kspVersion || '未知版本'}。${compatibility.reason || ''}`,
        {
          mods: [mod.identifier].filter(Boolean),
          autoFixable: Boolean(newer),
          fix: newer
            ? { action: 'install', identifier: compatible.pkg.identifier, version: compatible.pkg.version, label: `更新到兼容版本 ${compatible.pkg.version}` }
            : null,
        },
      ));
    } else if (compatibility.status === 'unknown' && kspVersion) {
      issues.push(issue(
        `ksp-version-unknown-${mod.entryId || mod.identifier}`,
        'info',
        'ksp-version-unknown',
        `未声明适配版本：${mod.name}`,
        `${mod.name} 没有提供 KSP 版本范围，无法确认是否适配 KSP ${kspVersion}。`,
        { mods: [mod.identifier].filter(Boolean), autoFixable: false },
      ));
    }
  }
  return { mods, issues, providers, versionMap };
}

export async function findLogFile(kspPath) {
  const candidates = [
    path.join(kspPath, 'KSP.log'),
    path.join(kspPath, 'KSP_Data', 'output_log.txt'),
    path.join(kspPath, 'KSP_x64_Data', 'output_log.txt'),
    path.join(kspPath, 'output_log.txt'),
    path.join(os.homedir(), 'AppData', 'LocalLow', 'Squad', 'Kerbal Space Program', 'Player.log'),
  ];
  let best = null;
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat?.isFile()) continue;
    if (!best || stat.mtimeMs > best.stat.mtimeMs) best = { path: candidate, stat };
  }
  return best;
}

function normalizeLogPath(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/^["'([]|["'),.;:\]]+$/g, '').replaceAll('\\', '/');
  const index = cleaned.toLowerCase().lastIndexOf('gamedata/');
  const rel = index >= 0 ? cleaned.slice(index) : cleaned;
  const parts = rel.split('/');
  const gameIndex = parts.findIndex((part) => part.toLowerCase() === 'gamedata');
  if (gameIndex < 0) return null;
  return parts.slice(gameIndex).join('/');
}

function extractPaths(text) {
  const results = new Set();
  for (const match of String(text).matchAll(/GameData[\\/][^\s"'():;,]+/gi)) {
    const rel = normalizeLogPath(match[0]);
    if (rel) results.add(rel);
  }
  return [...results];
}

function mapPathsToMods(paths, mods) {
  const matched = new Set();
  for (const rel of paths) {
    const lower = rel.toLowerCase();
    for (const mod of mods) {
      if (!mod.relPath) continue;
      const modRel = mod.relPath.toLowerCase().replaceAll('\\', '/');
      if (lower === modRel || lower.startsWith(`${modRel}/`)) matched.add(mod);
    }
  }
  return [...matched];
}

function logLevel(line) {
  const match = String(line).match(/^\[(ERR|EXC|WRN|LOG|INF|DBG|FAT)\s*[^\]]*\]\s*(.*)$/i);
  if (!match) return null;
  const level = match[1].toUpperCase();
  return { level: level === 'FAT' ? 'ERR' : level, message: match[2] };
}

function isNoise(message) {
  const text = String(message);
  return [
    /DontDestroyOnLoad only works for root GameObjects/i,
    /The referenced script on this Behaviour/i,
    /Fallback handler could not load/i,
    /^Shader .* is not supported/i,
    /^UnloadTime: /i,
  ].some((regexp) => regexp.test(text));
}

function normalizeSignature(level, message) {
  return `${level}: ${String(message)
    .replace(/\b0x[0-9a-f]+\b/gi, '0x…')
    .replace(/\(at [^)]+\)/g, '(at …)')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260)}`;
}

export function parseLog(text, { source = null } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const groups = new Map();
  const stats = { totalLines: lines.length, errorLines: 0, warningLines: 0, errorGroups: 0, parseTruncated: false };
  let index = 0;
  while (index < lines.length && stats.errorLines < MAX_ERROR_LINES) {
    const line = lines[index];
    const parsed = logLevel(line);
    if (!parsed) {
      index += 1;
      continue;
    }
    if (parsed.level === 'ERR' || parsed.level === 'EXC') stats.errorLines += 1;
    if (parsed.level === 'WRN') stats.warningLines += 1;
    const isError = parsed.level === 'ERR' || parsed.level === 'EXC';
    const isRelevantWarning = parsed.level === 'WRN' && /missing|incompatible|failed to load|could not load|exception/i.test(parsed.message);
    if ((!isError && !isRelevantWarning) || !parsed.message || isNoise(parsed.message)) {
      index += 1;
      continue;
    }
    const block = [parsed.message];
    let cursor = index + 1;
    while (cursor < lines.length && block.length < 10) {
      const next = lines[cursor];
      if (!next.trim() || logLevel(next)) break;
      block.push(next.trim());
      cursor += 1;
    }
    const context = block.join('\n');
    const type = context.match(/([A-Za-z_][\w.]*Exception)\b/)?.[1] || (parsed.level === 'WRN' ? '警告' : '错误');
    const signature = normalizeSignature(parsed.level, parsed.message);
    const key = hash(signature);
    const paths = extractPaths(context);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.contexts.push(context.slice(0, 900));
      for (const file of paths) existing.files.add(file);
    } else {
      groups.set(key, {
        id: `log-${key}`,
        level: parsed.level,
        type,
        signature,
        message: parsed.message.slice(0, 500),
        count: 1,
        contexts: [context.slice(0, 900)],
        files: new Set(paths),
        line: index + 1,
      });
    }
    index = Math.max(cursor, index + 1);
  }
  stats.errorGroups = groups.size;
  if (index < lines.length) stats.parseTruncated = true;
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_LOG_GROUPS);
  return {
    source,
    stats,
    errors: sorted.map((group) => ({ ...group, files: [...group.files] })),
  };
}

function logIssues(errors, mods, logPath) {
  const issues = [];
  for (const error of errors) {
    const matched = mapPathsToMods(error.files, mods);
    const modNames = matched.map((mod) => mod.name).join('、');
    const detailParts = [
      error.message,
      `出现 ${error.count} 次`,
      modNames ? `关联模组：${modNames}` : '未能在日志路径中定位到具体模组',
      logPath ? `日志：${logPath}` : null,
    ].filter(Boolean);
    issues.push(issue(
      error.id,
      error.level === 'WRN' ? 'warning' : 'error',
      'log-error',
      `日志${error.level === 'WRN' ? '警告' : '异常'}：${error.type}`,
      detailParts.join(' · '),
      {
        mods: matched.map((mod) => mod.identifier).filter(Boolean),
        files: error.files,
        log: logPath,
        occurrences: error.count,
        context: error.contexts[0],
        autoFixable: false,
        fix: logPath ? { action: 'open-log', path: logPath, label: '打开日志定位' } : null,
      },
    ));
  }
  return issues;
}

function registryIssues(records, mods, scan) {
  const issues = [];
  const scannedIds = new Set(mods.map((mod) => mod.identifier?.toLowerCase()).filter(Boolean));
  for (const record of records) {
    if (!record.identifier || scannedIds.has(record.identifier.toLowerCase())) continue;
    issues.push(issue(
      `registry-missing-${record.id || record.identifier}`,
      'warning',
      'registry-stale',
      `记录存在但文件缺失：${record.name || record.identifier}`,
      `kanmod 的记录显示 ${record.name || record.identifier} 已安装，但 GameData 中没有找到对应文件。可能被手动删除，或安装不完整。`,
      { mods: [record.identifier], autoFixable: false },
    ));
  }
  return issues;
}

function duplicateIssues(duplicates) {
  return (duplicates || []).map((group, index) => issue(
    `duplicate-${index}-${group.dll}`,
    'warning',
    'duplicate-dll',
    `重复 DLL：${group.dll}`,
    `多个模组目录包含同名 DLL：${group.items.map((item) => item.modName || item.entryId).join('、')}。这通常会导致加载冲突。`,
    {
      mods: group.items.map((item) => item.entryId).filter(Boolean),
      files: group.items.map((item) => item.path).filter(Boolean),
      autoFixable: false,
    },
  ));
}

export async function diagnoseGame(options = {}) {
  const {
    kspPath,
    scan = null,
    catalog = null,
    registry = null,
    settings = {},
    includeLog = true,
    disabled = [],
  } = options;
  const scanned = scan || await scanGameData(kspPath, { registry });
  const kspVersion = scanned.kspVersion || null;
  const records = recordsOf(registry);
  const relation = analyzeRelations(scanned, catalog, kspVersion, registry, settings, { disabled });
  const issues = [...relation.issues, ...registryIssues(records, relation.mods, scanned), ...duplicateIssues(scanned.duplicates)];
  if (!kspVersion) {
    issues.push(issue(
      'unknown-ksp-version',
      'warning',
      'unknown-ksp-version',
      '无法识别 KSP 版本',
      'kanmod 没有从 buildID、readme 或日志中读到 KSP 版本，版本兼容性判断可能不准确。',
      { autoFixable: false },
    ));
  }

  let log = null;
  if (includeLog) {
    const found = await findLogFile(kspPath);
    if (found) {
      const tail = await readTailBytes(found.path, LOG_TAIL_BYTES);
      const parsed = parseLog(tail.text, { source: found.path });
      log = {
        path: found.path,
        size: found.stat.size,
        modifiedAt: found.stat.mtime.toISOString(),
        truncated: Boolean(tail.truncated),
        stats: parsed.stats,
      };
      issues.push(...logIssues(parsed.errors, relation.mods, found.path));
    } else {
      log = { path: null, stats: null };
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of issues) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  const counts = {
    error: deduped.filter((item) => item.severity === 'error').length,
    warning: deduped.filter((item) => item.severity === 'warning').length,
    info: deduped.filter((item) => item.severity === 'info').length,
    autoFixable: deduped.filter((item) => item.autoFixable).length,
  };
  // Informational findings (for example "KSP version not declared") should not
  // dominate the health score; cap their contribution so a long list of notes
  // still reads as usable.
  const score = Math.max(0, Math.min(100, 100 - counts.error * 16 - counts.warning * 6 - Math.min(counts.info, 10)));
  return {
    generatedAt: new Date().toISOString(),
    kspPath: scanned.kspPath,
    kspVersion,
    health: {
      score,
      label: score >= 85 ? '良好' : score >= 60 ? '需要留意' : '需要修复',
    },
    counts,
    issues: deduped,
    mods: relation.mods,
    duplicates: scanned.duplicates || [],
    log,
    scan: {
      scannedAt: scanned.scannedAt,
      stats: scanned.stats,
    },
  };
}

export function planRepairs(diagnostics) {
  const byIdentifier = new Map();
  for (const item of diagnostics?.issues || []) {
    if (!item.autoFixable || item.fix?.action !== 'install') continue;
    const identifier = item.fix.identifier;
    if (!identifier) continue;
    const existing = byIdentifier.get(identifier);
    if (!existing) {
      byIdentifier.set(identifier, { type: 'install', ...item.fix, issueId: item.id, issueIds: [item.id] });
      continue;
    }
    existing.issueIds.push(item.id);
    if (item.fix.version && (!existing.version || compareVersions(item.fix.version, existing.version) > 0)) {
      existing.version = item.fix.version;
      existing.label = item.fix.label;
      existing.issueId = item.id;
    }
  }
  const operations = [...byIdentifier.values()];
  return {
    operations,
    count: operations.length,
    skipped: (diagnostics?.issues || []).filter((item) => !item.autoFixable).length,
  };
}
