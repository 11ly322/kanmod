import { checkKspCompatibility, compareVersions, compatibilityRank, normalizeName, shortVersion } from '../util/version.js';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizeRelation(value) {
  if (!value) return null;
  if (typeof value === 'string') return { name: value, minVersion: null, maxVersion: null };
  const name = value.name || value.identifier;
  if (!name) return null;
  return {
    name: String(name),
    minVersion: value.min_version || value.minVersion || null,
    maxVersion: value.max_version || value.maxVersion || null,
    note: value.note || null,
  };
}

function normalizeRelations(value) {
  return asArray(value).map(normalizeRelation).filter(Boolean);
}

function normalizeProvides(value) {
  return asArray(value)
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter(Boolean)
    .map(String);
}

function normalizeInstall(install) {
  if (!install) return [];
  if (!Array.isArray(install)) install = [install];
  return install
    .filter((entry) => entry && (entry.file || entry.find || entry.findRegexp || entry.find_regexp))
    .map((entry) => ({
      file: entry.file || null,
      find: entry.find || null,
      find_regexp: entry.find_regexp || entry.findRegexp || null,
      install_to: entry.install_to || entry.installTo || 'GameData',
      as: entry.as || null,
      filter: asArray(entry.filter),
      filter_regexp: asArray(entry.filter_regexp || entry.filterRegexp),
      include_only: asArray(entry.include_only || entry.includeOnly),
      include_only_regexp: asArray(entry.include_only_regexp || entry.includeOnlyRegexp),
      find_matches_files: Boolean(entry.find_matches_files || entry.findMatchesFiles),
      optional: Boolean(entry.optional),
    }));
}

function hashFrom(value) {
  if (!value) return null;
  if (typeof value === 'string') return { sha256: value.length === 64 ? value.toLowerCase() : null, raw: value };
  return {
    sha256: value.sha256 ? String(value.sha256).toLowerCase() : null,
    sha1: value.sha1 ? String(value.sha1).toLowerCase() : null,
    md5: value.md5 ? String(value.md5).toLowerCase() : null,
  };
}

export function normalizePackage(raw) {
  if (!raw || !raw.identifier || raw.version === undefined || raw.version === null) return null;
  const identifier = String(raw.identifier).trim();
  const version = String(raw.version).trim();
  if (!identifier || !version) return null;
  const authors = Array.isArray(raw.author) ? raw.author.filter(Boolean).join(', ') : String(raw.author || '').trim();
  const resources = raw.resources && typeof raw.resources === 'object' ? raw.resources : {};
  return {
    identifier,
    name: String(raw.name || identifier).trim(),
    abstract: String(raw.abstract || '').trim(),
    description: String(raw.description || '').trim(),
    author: authors || null,
    version,
    versionSort: shortVersion(version),
    kind: raw.kind || 'package',
    license: raw.license || null,
    releaseStatus: raw.release_status || raw.releaseStatus || 'stable',
    kspVersion: raw.ksp_version || raw.kspVersion || null,
    kspVersionMin: raw.ksp_version_min || raw.kspVersionMin || null,
    kspVersionMax: raw.ksp_version_max || raw.kspVersionMax || null,
    kspVersionStrict: Boolean(raw.ksp_version_strict ?? raw.kspVersionStrict),
    depends: normalizeRelations(raw.depends),
    recommends: normalizeRelations(raw.recommends),
    suggests: normalizeRelations(raw.suggests),
    supports: normalizeRelations(raw.supports),
    conflicts: normalizeRelations(raw.conflicts),
    provides: normalizeProvides(raw.provides),
    install: normalizeInstall(raw.install),
    download: raw.download ?? raw.downloadUrl ?? null,
    downloadSize: Number(raw.download_size ?? raw.downloadSize) || null,
    downloadHash: hashFrom(raw.download_hash ?? raw.downloadHash),
    downloadContentType: raw.download_content_type || raw.downloadContentType || null,
    resources: {
      homepage: resources.homepage || null,
      repository: resources.repository || null,
      bugtracker: resources.bugtracker || null,
      spacedock: resources.spacedock || null,
      curseforge: resources.curseforge || null,
      github: resources.github || null,
      gitlab: resources.gitlab || null,
    },
    tags: asArray(raw.tags).map(String),
    specVersion: raw.spec_version || raw.specVersion || null,
    local: Boolean(raw.local),
  };
}

function bestMatchScore(pkg, query) {
  const q = normalizeName(query);
  if (!q) return 0;
  const name = normalizeName(pkg.name);
  const id = normalizeName(pkg.identifier);
  if (name === q || id === q) return 100;
  if (name.startsWith(q) || id.startsWith(q)) return 70;
  if (name.includes(q) || id.includes(q)) return 50;
  if (normalizeName(pkg.abstract).includes(q)) return 20;
  return 0;
}

export class Catalog {
  constructor(packages, meta = {}) {
    this.meta = {
      count: 0,
      identifierCount: 0,
      loadedAt: null,
      sourceName: null,
      sourceUrl: null,
      demo: false,
      stale: true,
      ...meta,
    };
    this.groups = new Map();
    this.all = [];
    this.byName = new Map();
    this.providers = new Map();

    const seen = new Map();
    for (const raw of packages || []) {
      const pkg = normalizePackage(raw);
      if (!pkg) continue;
      const key = `${pkg.identifier.toLowerCase()}\u0000${pkg.version.toLowerCase()}`;
      if (seen.has(key)) {
        const previous = seen.get(key);
        // Prefer the copy with richer install/download data.
        if ((pkg.install.length + (pkg.download ? 1 : 0)) > (previous.install.length + (previous.download ? 1 : 0))) {
          seen.set(key, pkg);
        }
      } else {
        seen.set(key, pkg);
      }
    }

    for (const pkg of seen.values()) {
      this.all.push(pkg);
      const idKey = pkg.identifier.toLowerCase();
      if (!this.groups.has(idKey)) this.groups.set(idKey, []);
      this.groups.get(idKey).push(pkg);
      const nameKey = normalizeName(pkg.name);
      if (nameKey) {
        if (!this.byName.has(nameKey)) this.byName.set(nameKey, new Set());
        this.byName.get(nameKey).add(idKey);
      }
      for (const virtual of pkg.provides) {
        const virtualKey = normalizeName(virtual);
        if (!this.providers.has(virtualKey)) this.providers.set(virtualKey, new Set());
        this.providers.get(virtualKey).add(idKey);
      }
    }
    for (const versions of this.groups.values()) {
      versions.sort((a, b) => compareVersions(b.version, a.version));
    }
    this.tagCounts = new Map();
    for (const pkg of this.all) {
      for (const tag of new Set(pkg.tags)) {
        const key = normalizeName(tag);
        if (!key) continue;
        const entry = this.tagCounts.get(key);
        if (entry) entry.count += 1;
        else this.tagCounts.set(key, { tag, count: 1 });
      }
    }
    this.meta.count = this.all.length;
    this.meta.identifierCount = this.groups.size;
  }

  hasIdentifier(identifier) {
    return this.groups.has(String(identifier || '').toLowerCase());
  }

  versions(identifier) {
    return this.groups.get(String(identifier || '').toLowerCase()) || [];
  }

  get(identifier, version) {
    const versions = this.versions(identifier);
    if (!versions.length) return null;
    if (!version) return versions[0];
    return versions.find((pkg) => pkg.version.toLowerCase() === String(version).toLowerCase()) || null;
  }

  compatiblePackage(identifier, kspVersion, options = {}) {
    const versions = this.versions(identifier);
    const { allowWarning = false, pinnedVersion = null } = options;
    if (pinnedVersion) {
      const pinned = versions.find((pkg) => pkg.version.toLowerCase() === String(pinnedVersion).toLowerCase());
      if (!pinned) return null;
      return { pkg: pinned, compatibility: checkKspCompatibility(kspVersion, pinned) };
    }
    let bestWarning = null;
    for (const pkg of versions) {
      const compatibility = checkKspCompatibility(kspVersion, pkg);
      if (compatibility.status === 'compatible') return { pkg, compatibility };
      if (compatibility.status === 'unknown' && !bestWarning) bestWarning = { pkg, compatibility };
      if (compatibility.status === 'warning' && !bestWarning) bestWarning = { pkg, compatibility };
    }
    if (allowWarning && bestWarning) return bestWarning;
    return null;
  }

  providersFor(name) {
    const key = normalizeName(name);
    return [...(this.providers.get(key) || [])].map((idKey) => this.groups.get(idKey)?.[0]).filter(Boolean);
  }

  tagFacets(limit = 48) {
    return [...this.tagCounts.values()]
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
      .slice(0, Math.max(1, Number(limit) || 48));
  }

  search(options = {}) {
    const {
      query = '',
      kspVersion = null,
      allowWarning = false,
      page = 1,
      pageSize = 24,
      sort = 'relevance',
      status = 'all',
      tag = '',
      size = '',
      installedIdentifiers = new Set(),
      sourceFilter = 'all',
    } = options;
    const installed = new Set([...installedIdentifiers].map((value) => String(value).toLowerCase()));
    const q = String(query || '').trim();
    const wantedTag = normalizeName(tag);
    const wantedSize = String(size || '').toLowerCase();
    const items = [];

    for (const [idKey, versions] of this.groups) {
      let chosen = null;
      for (const pkg of versions) {
        const compatibility = checkKspCompatibility(kspVersion, pkg);
        const rank = compatibilityRank(compatibility.status);
        if (status === 'compatible' && compatibility.status !== 'compatible') continue;
        if (status === 'compatible' && compatibility.status === 'incompatible') continue;
        chosen = { pkg, compatibility };
        break;
      }
      if (!chosen && status !== 'compatible') {
        const pkg = versions[0];
        chosen = { pkg, compatibility: checkKspCompatibility(kspVersion, pkg) };
      }
      if (!chosen) continue;
      const pkg = chosen.pkg;
      const score = q ? Math.max(
        bestMatchScore(pkg, q),
        pkg.tags.some((tag) => normalizeName(tag).includes(normalizeName(q))) ? 15 : 0,
      ) : 0;
      if (q && score === 0) continue;
      if (wantedTag && !pkg.tags.some((item) => normalizeName(item) === wantedTag)) continue;
      if (wantedSize) {
        const bytes = Number(pkg.downloadSize) || 0;
        if (wantedSize === 'small' && !(bytes > 0 && bytes <= 1024 * 1024)) continue;
        if (wantedSize === 'medium' && !(bytes > 1024 * 1024 && bytes <= 20 * 1024 * 1024)) continue;
        if (wantedSize === 'large' && !(bytes > 20 * 1024 * 1024)) continue;
      }
      const isInstalled = installed.has(idKey);
      if (status === 'installed' && !isInstalled) continue;
      if (status === 'updatable') {
        if (!isInstalled) continue;
        const installedVersion = options.installedVersions?.get?.(idKey);
        if (!installedVersion || compareVersions(pkg.version, installedVersion) <= 0) continue;
      }
      if (sourceFilter !== 'all' && pkg.sourceId && pkg.sourceId !== sourceFilter) continue;
      items.push({
        identifier: pkg.identifier,
        name: pkg.name,
        abstract: pkg.abstract,
        author: pkg.author,
        version: pkg.version,
        releaseStatus: pkg.releaseStatus,
        kspVersion: pkg.kspVersion,
        kspVersionMin: pkg.kspVersionMin,
        kspVersionMax: pkg.kspVersionMax,
        downloadSize: pkg.downloadSize,
        tags: pkg.tags,
        kind: pkg.kind,
        compatibility: chosen.compatibility,
        installed: isInstalled,
        installedVersion: options.installedVersions?.get?.(idKey) || null,
        score,
      });
    }

    const sorted = items.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      if (sort === 'size') return (b.downloadSize || 0) - (a.downloadSize || 0);
      if (sort === 'version') return compareVersions(b.version, a.version);
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (sort === 'relevance' && q && b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(96, Math.max(6, Number(pageSize) || 24));
    const start = (safePage - 1) * safeSize;
    return {
      items: sorted.slice(start, start + safeSize),
      total: sorted.length,
      page: safePage,
      pageSize: safeSize,
      pageCount: Math.max(1, Math.ceil(sorted.length / safeSize)),
    };
  }

  relationships(identifier, version, options = {}) {
    const pkg = this.get(identifier, version);
    if (!pkg) return null;
    const resolve = (relation) => {
      const direct = this.versions(relation.name);
      const providers = direct.length ? [] : this.providersFor(relation.name);
      const targetId = direct.length ? direct[0].identifier : providers[0]?.identifier || null;
      const target = targetId ? this.get(targetId) : null;
      return {
        ...relation,
        identifier: target?.identifier || relation.name,
        displayName: target?.name || relation.name,
        available: Boolean(target),
        installedVersion: options.installedVersions?.get?.(String(targetId || relation.name).toLowerCase()) || null,
      };
    };
    const depends = pkg.depends.map(resolve);
    const recommends = pkg.recommends.map(resolve);
    const suggests = pkg.suggests.map(resolve);
    const conflicts = pkg.conflicts.map(resolve);
    const supportList = pkg.supports.map(resolve);
    const names = new Set([
      pkg.identifier.toLowerCase(),
      ...pkg.provides.map((name) => name.toLowerCase()),
    ]);
    const dependents = [];
    for (const versions of this.groups.values()) {
      const candidate = versions.find((entry) => entry.depends.some((dep) => names.has(dep.name.toLowerCase()))) ||
        versions.find((entry) => entry.recommends.some((dep) => names.has(dep.name.toLowerCase())));
      if (!candidate || candidate.identifier.toLowerCase() === pkg.identifier.toLowerCase()) continue;
      dependents.push({
        identifier: candidate.identifier,
        name: candidate.name,
        version: candidate.version,
        relation: candidate.depends.some((dep) => names.has(dep.name.toLowerCase())) ? 'depends' : 'recommends',
        installed: options.installedIdentifiers?.has(candidate.identifier.toLowerCase()) || false,
      });
    }
    dependents.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return {
      depends,
      recommends,
      suggests,
      supports: supportList,
      conflicts,
      dependents: dependents.slice(0, 80),
      dependentCount: dependents.length,
      provides: pkg.provides,
    };
  }

  versionsForDisplay(identifier, kspVersion, options = {}) {
    return this.versions(identifier).map((pkg) => ({
      version: pkg.version,
      compatibility: checkKspCompatibility(kspVersion, pkg),
      kspVersion: pkg.kspVersion,
      kspVersionMin: pkg.kspVersionMin,
      kspVersionMax: pkg.kspVersionMax,
      releaseStatus: pkg.releaseStatus,
      downloadSize: pkg.downloadSize,
      download: pkg.download,
      installDirectives: pkg.install.length,
      specVersion: pkg.specVersion,
    }));
  }

  toJSON() {
    return { meta: this.meta, packages: this.all };
  }
}
