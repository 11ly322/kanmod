import { checkKspCompatibility, compareVersions, compatibilityRank, normalizeName, satisfiesVersion, versionEqual } from '../util/version.js';

function lower(value) {
  return String(value || '').toLowerCase();
}

function relationLabel(relation) {
  const bits = [relation.name];
  if (relation.minVersion || relation.maxVersion) {
    bits.push(`(${relation.minVersion || '任意'} – ${relation.maxVersion || '任意'})`);
  }
  return bits.join(' ');
}

function satisfiesAll(version, requirements) {
  return requirements.every((requirement) => satisfiesVersion(version, requirement.minVersion, requirement.maxVersion));
}

function compatibilityAllowed(compatibility, options) {
  if (compatibility.status === 'compatible') return true;
  if (compatibility.status === 'warning') return Boolean(options.allowWarning);
  if (compatibility.status === 'unknown') return Boolean(options.allowUnknown);
  return false;
}

function compatibilitySummary(compatibility) {
  return { status: compatibility.status, label: compatibility.label, reason: compatibility.reason };
}

function rootInput(root) {
  if (typeof root === 'string') return { identifier: root, version: null };
  return { identifier: root.identifier, version: root.version || null };
}

/**
 * Resolves a CKAN dependency closure without downloading anything.
 * Hard `depends` are mandatory, recommendations are reported but never added
 * silently. The resolver never installs a package whose declared KSP range
 * fails unless the caller opts into warnings/unknown versions.
 */
export function resolvePlan({ catalog, roots = [], kspVersion, installed = [], allowWarning = false, allowUnknown = false, includeRecommended = false, includeDependencies = true }) {
  if (!catalog) throw new Error('模组索引尚未加载，无法解析依赖。');
  const options = { allowWarning, allowUnknown };
  const installedById = new Map();
  const installedByName = new Map();
  for (const record of installed) {
    const key = lower(record.identifier);
    if (key) installedById.set(key, record);
    const nameKey = normalizeName(record.name || record.folder);
    if (nameKey && !installedByName.has(nameKey)) installedByName.set(nameKey, record);
  }

  const selected = new Map(); // lower(identifier) -> node
  const requirements = new Map(); // lower(identifier) -> requirement[]
  const missing = [];
  const conflicts = [];
  const warnings = [];
  const rootKeys = new Set(roots.map((root) => lower(rootInput(root).identifier)));
  const rootsById = new Map(roots.map((root) => {
    const item = rootInput(root);
    return [lower(item.identifier), item];
  }));
  const queue = [];

  function installedMatch(name) {
    const direct = installedById.get(lower(name));
    if (direct) return direct;
    return installedByName.get(normalizeName(name)) || null;
  }

  function selectedProvider(name) {
    const key = normalizeName(name);
    for (const node of selected.values()) {
      if (node.package?.provides?.some((provided) => normalizeName(provided) === key)) return node;
    }
    return null;
  }

  function candidateIdentifiers(name) {
    const result = [];
    const seen = new Set();
    const exactInstalled = installedMatch(name);
    if (exactInstalled) {
      const key = lower(exactInstalled.identifier || `installed:${exactInstalled.folder || exactInstalled.name}`);
      result.push({ identifier: key, installedOnly: !exactInstalled.identifier, installed: exactInstalled });
      seen.add(key);
    }
    if (catalog.hasIdentifier(name)) {
      const pkg = catalog.get(name);
      const key = lower(pkg.identifier);
      if (!seen.has(key)) {
        result.push({ identifier: key, installed: installedById.get(key) || null });
        seen.add(key);
      }
    }
    const providers = catalog.providersFor(name);
    for (const pkg of providers) {
      const key = lower(pkg.identifier);
      if (!seen.has(key)) {
        result.push({ identifier: key, installed: installedById.get(key) || null });
        seen.add(key);
      }
    }
    return result;
  }

  function chooseIdentifier(name) {
    const provider = selectedProvider(name);
    if (provider) return { identifier: provider.identifier, node: provider };
    const candidates = candidateIdentifiers(name);
    if (!candidates.length) return null;
    // Prefer an installed candidate that also exists in the catalog; this
    // keeps dependency versions stable across "install another mod" actions.
    const withInstalled = candidates.find((candidate) => candidate.installed && !candidate.installedOnly);
    if (withInstalled) return { identifier: withInstalled.identifier, installed: withInstalled.installed };
    const exact = catalog.hasIdentifier(name) ? candidates.find((candidate) => lower(candidate.identifier) === lower(name)) : null;
    if (exact) return { identifier: exact.identifier, installed: exact.installed };
    const installedOnly = candidates.find((candidate) => candidate.installedOnly);
    if (installedOnly) return installedOnly;
    return candidates[0];
  }

  function versionReason(pkg, requirement) {
    const compatibility = checkKspCompatibility(kspVersion, pkg);
    return {
      version: pkg.version,
      compatibility,
      constraintOk: satisfiesAll(pkg.version, requirement ? [requirement] : []),
    };
  }

  function selectVersion(identifier, allRequirements, installedRecord) {
    const pinned = rootsById.get(lower(identifier))?.version;
    const versions = catalog.versions(identifier);
    const details = versions.map((pkg) => versionReason(pkg, null));
    const eligible = versions.filter((pkg) => {
      if (!satisfiesAll(pkg.version, allRequirements)) return false;
      const compatibility = checkKspCompatibility(kspVersion, pkg);
      return compatibilityAllowed(compatibility, options);
    });
    if (pinned) {
      const pinnedPackage = eligible.find((pkg) => versionEqual(pkg.version, pinned));
      if (pinnedPackage) return { pkg: pinnedPackage, compatibility: checkKspCompatibility(kspVersion, pinnedPackage) };
      return {
        error: {
          identifier,
          pinnedVersion: pinned,
          reason: versions.some((pkg) => versionEqual(pkg.version, pinned))
            ? '指定版本不满足当前依赖约束或与游戏版本不兼容。'
            : '索引中不存在指定的模组版本。',
          requirements: allRequirements,
          available: details,
        },
      };
    }
    if (installedRecord?.version) {
      const installedPackage = eligible.find((pkg) => versionEqual(pkg.version, installedRecord.version));
      if (installedPackage) {
        return { pkg: installedPackage, compatibility: checkKspCompatibility(kspVersion, installedPackage), preferInstalled: true };
      }
    }
    if (eligible.length) {
      const best = eligible
        .map((pkg) => ({ pkg, compatibility: checkKspCompatibility(kspVersion, pkg) }))
        .sort((a, b) => {
          const rankDiff = compatibilityRank(b.compatibility.status) - compatibilityRank(a.compatibility.status);
          if (rankDiff !== 0) return rankDiff;
          return compareVersions(b.pkg.version, a.pkg.version);
        })[0];
      return best;
    }
    return {
      error: {
        identifier,
        reason: installedRecord?.version && !versions.some((pkg) => versionEqual(pkg.version, installedRecord.version))
          ? `已安装版本 ${installedRecord.version} 不在索引中，且没有满足约束的可用版本。`
          : '没有满足依赖约束且适配当前 KSP 版本的版本。',
        requirements: allRequirements,
        available: details.slice(0, 24),
      },
    };
  }

  function addNode(identifier, resolution, requirement, requiredBy, isRoot) {
    const pkg = resolution.pkg;
    const key = lower(pkg.identifier);
    const installedRecord = installedById.get(key) || installedByName.get(normalizeName(pkg.name)) || null;
    const previous = selected.get(key);
    const node = {
      identifier: pkg.identifier,
      name: pkg.name,
      version: pkg.version,
      package: pkg,
      installedVersion: installedRecord?.version || null,
      installedManaged: Boolean(installedRecord?.managed),
      compatibility: compatibilitySummary(resolution.compatibility),
      requirements: [...(previous?.requirements || []), ...(requirement ? [requirement] : [])],
      requiredBy: [...(previous?.requiredBy || []), ...(requiredBy ? [requiredBy] : [])],
      direct: [...(previous?.direct || []), ...(isRoot ? [true] : [])],
      root: isRoot || Boolean(previous?.root),
      optional: false,
    };
    const seenRequired = new Set();
    node.requiredBy = node.requiredBy.filter((item) => {
      const mark = `${item.identifier}\u0000${item.relation}`;
      if (seenRequired.has(mark)) return false;
      seenRequired.add(mark);
      return true;
    });
    if (!installedRecord?.version) node.action = 'install';
    else if (versionEqual(installedRecord.version, pkg.version)) node.action = 'keep';
    else if (compareVersions(pkg.version, installedRecord.version) > 0) node.action = 'upgrade';
    else node.action = 'downgrade';
    selected.set(key, node);
    return node;
  }

  function markMissing(name, requirement, requiredBy, reason, extra = {}) {
    const already = missing.find((item) => lower(item.name) === lower(name) && item.requiredBy.id === requiredBy.id);
    if (already) {
      if (requirement) {
        if (!Array.isArray(already.requirements)) already.requirements = [];
        already.requirements.push(requirement);
      }
      return;
    }
    missing.push({
      name,
      label: relationLabel(requirement || { name }),
      requiredBy: { identifier: requiredBy.identifier, name: requiredBy.name },
      reason,
      ...extra,
    });
  }

  function inspectConflicts(node) {
    const pkg = node.package;
    for (const relation of pkg.conflicts || []) {
      const provider = selectedProvider(relation.name);
      const exact = selected.get(lower(relation.name));
      const target = provider || exact;
      if (target && target.identifier !== node.identifier) {
        conflicts.push({
          identifier: node.identifier,
          name: node.name,
          conflictWith: target.identifier,
          conflictName: target.name,
          relation: relationLabel(relation),
          scope: 'plan',
          reason: `${node.name} 与 ${target.name} 同时安装会冲突。`,
        });
        continue;
      }
      const installedTarget = installedMatch(relation.name);
      if (installedTarget && !installedTarget.managed) {
        warnings.push({
          code: 'INSTALLED_CONFLICT',
          message: `${node.name} 声明与已安装的 ${installedTarget.name || relation.name} 冲突，安装后请在诊断页处理。`,
          identifier: node.identifier,
          conflictWith: installedTarget.identifier || installedTarget.name,
        });
      }
    }
  }

  function processRequirement(relation, parentNode, isRoot = false) {
    const name = relation.name;
    if (!name) return;
    const chosen = chooseIdentifier(name);
    if (!chosen) {
      markMissing(name, relation, parentNode, 'not_found', { root: isRoot });
      return;
    }
    const identifier = chosen.identifier;
    const key = lower(identifier);
    if (chosen.node) {
      if (relation.minVersion || relation.maxVersion) {
        if (!satisfiesVersion(chosen.node.version, relation.minVersion, relation.maxVersion)) {
          markMissing(name, relation, parentNode, 'conflict', {
            message: `已选版本 ${chosen.node.version} 不满足 ${relationLabel(relation)}。`,
          });
        }
      }
      return;
    }
    if (!requirements.has(key)) requirements.set(key, []);
    const list = requirements.get(key);
    if (!isRoot && !list.some((item) => item.parent === parentNode.identifier && item.name === name)) {
      list.push({
        name,
        minVersion: relation.minVersion || null,
        maxVersion: relation.maxVersion || null,
        parent: parentNode.identifier,
        parentName: parentNode.name,
      });
    } else if (isRoot) {
      list.push({ name, minVersion: null, maxVersion: null, parent: null, parentName: null });
    }

    const installedRecord = installedById.get(key) || chosen.installed || null;
    if (!catalog.hasIdentifier(identifier)) {
      if (installedRecord) {
        const synthetic = addNode(identifier, {
          pkg: {
            identifier: installedRecord.identifier || identifier,
            name: installedRecord.name || relation.name,
            version: installedRecord.version,
            depends: [],
            recommends: [],
            conflicts: [],
            provides: [],
            install: [],
            download: null,
            downloadSize: null,
            tags: [],
            resources: {},
            kspVersion: installedRecord.kspVersion || null,
            kspVersionMin: installedRecord.kspVersionMin || null,
            kspVersionMax: installedRecord.kspVersionMax || null,
            abstract: '已安装模组（索引中没有对应条目）',
          },
          compatibility: checkKspCompatibility(kspVersion, installedRecord),
        }, relation, parentNode, isRoot);
        synthetic.installedOnly = true;
        synthetic.action = 'keep';
      } else {
        markMissing(name, relation, parentNode, 'not_found');
      }
      return;
    }

    const resolution = selectVersion(identifier, requirements.get(key), installedRecord);
    if (!resolution.pkg) {
      markMissing(name, relation, parentNode, 'no_version', { root: isRoot, details: resolution.error, available: resolution.error.available });
      return;
    }
    const previous = selected.get(key);
    const node = addNode(identifier, resolution, relation, parentNode, isRoot);
    if (node.compatibility.status === 'warning') {
      warnings.push({
        code: 'UNVERIFIED_KSP_VERSION',
        message: `${node.name} ${node.version} 未针对 KSP ${kspVersion} 验证，可能兼容。`,
        identifier: node.identifier,
      });
    }
    if (node.compatibility.status === 'unknown') {
      warnings.push({
        code: 'UNKNOWN_KSP_VERSION',
        message: `${node.name} ${node.version} 未声明适配的 KSP 版本。`,
        identifier: node.identifier,
      });
    }
    if (!previous || previous.version !== node.version) {
      if (includeDependencies) {
        for (const dependency of node.package.depends || []) {
          queue.push({ relation: dependency, parent: node, isRoot: false });
        }
      }
    }
    inspectConflicts(node);
  }

  for (const root of roots) {
    const item = rootInput(root);
    if (!item.identifier) continue;
    const rootPackage = catalog.get(item.identifier, item.version) || catalog.get(item.identifier);
    if (!rootPackage) {
      missing.push({
        name: item.identifier,
        label: item.identifier,
        requiredBy: { identifier: null, name: '你' },
        reason: 'not_found',
        root: true,
      });
      continue;
    }
    const parent = {
      identifier: rootPackage.identifier,
      name: rootPackage.name,
      package: null,
      version: null,
      root: true,
      action: 'root',
      requirements: [],
      requiredBy: [],
      direct: true,
      compatibility: compatibilitySummary(checkKspCompatibility(kspVersion, rootPackage)),
    };
    processRequirement({ name: rootPackage.identifier, minVersion: item.version, maxVersion: item.version }, parent, true);
  }

  let guard = 0;
  while (queue.length && guard < 12_000) {
    guard += 1;
    const item = queue.shift();
    processRequirement(item.relation, item.parent, false);
  }

  // Validate the final selection against every accumulated constraint. This
  // catches the case where a later mod narrowed a dependency after it was
  // first selected.
  for (const [key, node] of selected) {
    const list = requirements.get(key) || [];
    if (!satisfiesAll(node.version, list)) {
      conflicts.push({
        identifier: node.identifier,
        name: node.name,
        conflictWith: node.identifier,
        conflictName: node.name,
        scope: 'constraint',
        reason: `${node.name} ${node.version} 已无法同时满足所有版本约束。`,
        requirements: list,
      });
    }
  }

  // Recommendations are shown as optional choices, not folded into the plan.
  const recommended = [];
  if (includeRecommended) {
    for (const node of selected.values()) {
      for (const relation of node.package.recommends || []) {
        const chosen = chooseIdentifier(relation.name);
        const targetPkg = chosen ? catalog.get(chosen.identifier) : null;
        if (!targetPkg) continue;
        if (selected.has(lower(targetPkg.identifier))) continue;
        if (recommended.some((item) => lower(item.identifier) === lower(targetPkg.identifier))) continue;
        recommended.push({
          identifier: targetPkg.identifier,
          name: targetPkg.name,
          version: targetPkg.version,
          compatibility: compatibilitySummary(checkKspCompatibility(kspVersion, targetPkg)),
          suggestedBy: node.name,
          reason: `${node.name} 推荐安装`,
        });
      }
    }
  }

  const nodes = [...selected.values()];
  const nodeById = new Map(nodes.map((node) => [lower(node.identifier), node]));
  const installOrder = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(identifier) {
    const key = lower(identifier);
    if (visited.has(key) || visiting.has(key)) return;
    visiting.add(key);
    const node = nodeById.get(key);
    if (!node) return;
    for (const relation of node.package.depends || []) {
      const dep = selectDependencyNode(relation.name, node);
      if (dep) visit(dep.identifier);
    }
    visiting.delete(key);
    visited.add(key);
    installOrder.push(node);
  }
  function selectDependencyNode(name, parent) {
    if (selectedProvider(name) && lower(selectedProvider(name).identifier) !== lower(parent.identifier)) return selectedProvider(name);
    for (const [key, node] of selected) {
      if (node.package.provides?.some((provided) => normalizeName(provided) === normalizeName(name))) return node;
      if (lower(node.identifier) === lower(name)) return node;
      if (normalizeName(node.name) === normalizeName(name)) return node;
      if (node.requiredBy.some((item) => lower(item.identifier) === lower(parent.identifier)) && lower(node.identifier) === lower(name)) return node;
    }
    return null;
  }
  for (const node of nodes) {
    if (node.root) visit(node.identifier);
  }
  for (const node of nodes) {
    if (!visited.has(lower(node.identifier))) visit(node.identifier);
  }

  const seenConflict = new Set();
  const dedupedConflicts = conflicts.filter((conflict) => {
    const key = `${lower(conflict.identifier)}\u0000${lower(conflict.conflictWith)}\u0000${conflict.scope}`;
    if (seenConflict.has(key)) return false;
    seenConflict.add(key);
    return true;
  });
  const seenWarning = new Set();
  const dedupedWarnings = warnings.filter((warning) => {
    const key = `${warning.code}\u0000${lower(warning.identifier)}\u0000${lower(warning.conflictWith || '')}`;
    if (seenWarning.has(key)) return false;
    seenWarning.add(key);
    return true;
  });
  const actionable = installOrder.filter((node) => node.action !== 'keep');
  const knownSize = actionable.reduce((sum, node) => sum + (node.package.downloadSize || 0), 0);
  return {
    ok: missing.length === 0 && dedupedConflicts.length === 0,
    kspVersion,
    allowWarning,
    allowUnknown,
    nodes,
    installOrder: installOrder.map((node) => {
      const { package: pkg, ...rest } = node;
      return {
        ...rest,
        package: {
          identifier: pkg.identifier,
          name: pkg.name,
          version: pkg.version,
          download: pkg.download,
          downloadSize: pkg.downloadSize,
          install: pkg.install,
        },
      };
    }),
    actionable: actionable.map((node) => node.identifier),
    missing,
    conflicts: dedupedConflicts,
    warnings: dedupedWarnings,
    recommended,
    summary: {
      total: nodes.length,
      install: nodes.filter((node) => node.action === 'install').length,
      upgrade: nodes.filter((node) => node.action === 'upgrade').length,
      downgrade: nodes.filter((node) => node.action === 'downgrade').length,
      keep: nodes.filter((node) => node.action === 'keep').length,
      missing: missing.length,
      conflicts: dedupedConflicts.length,
      downloadBytes: knownSize,
    },
  };
}
