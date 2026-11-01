/**
 * KSP and CKAN version handling. CKAN version strings are deliberately loose:
 * "1.2", "v1.2.3", "2.0.0-beta.1", "1:1.4.0". KSP build strings may contain a
 * fourth component ("1.12.5.3190") that must not affect mod compatibility.
 */

const NUMERIC_RE = /^(\d+(?:\.\d+)*)/;

/**
 * Parses the loose version strings found in CKAN indexes: `1.2`, `v1.2.3`,
 * `1:1.4.0` (epoch), `1.3.5_beta`, `1.2.2.2a`, `1.01_RC`, `0.0.4d`. The epoch
 * is kept separately because CKAN sorts by epoch before the numeric parts.
 */
export function parseVersion(input) {
  const raw = String(input ?? '').trim();
  let rest = raw;
  let epoch = 0;
  const epochMatch = rest.match(/^(\d+):/);
  if (epochMatch) {
    epoch = Number.parseInt(epochMatch[1], 10);
    rest = rest.slice(epochMatch[0].length);
  }
  rest = rest.replace(/^[vV]/, '');

  let numbers = [];
  let suffix = '';
  const numeric = rest.match(NUMERIC_RE);
  if (numeric) {
    numbers = numeric[1].split('.').map((part) => Number.parseInt(part, 10));
    suffix = rest.slice(numeric[0].length);
  } else {
    // Some releases start with a name ("alpha_0.0.4d", "A.02f"); keep the
    // embedded numbers and treat the left-over words as a prerelease tag.
    const embedded = rest.match(/(\d+(?:\.\d+)*)/);
    if (!embedded) {
      return { raw, epoch, numbers: [], prerelease: [], valid: false, base: '' };
    }
    numbers = embedded[1].split('.').map((part) => Number.parseInt(part, 10));
    suffix = `${rest.slice(0, embedded.index)} ${rest.slice(embedded.index + embedded[0].length)}`;
  }
  const prerelease = suffix.split(/[^0-9A-Za-z]+/).filter(Boolean);
  return {
    raw,
    epoch,
    numbers,
    prerelease,
    valid: numbers.length > 0,
    base: numbers.join('.'),
  };
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left > right ? 1 : -1;
    }
  }
  return 0;
}

export function compareVersions(leftInput, rightInput) {
  const left = typeof leftInput === 'object' && leftInput ? leftInput : parseVersion(leftInput);
  const right = typeof rightInput === 'object' && rightInput ? rightInput : parseVersion(rightInput);

  if (!left.valid && !right.valid) {
    return String(left.raw).localeCompare(String(right.raw));
  }
  if (!left.valid) return -1;
  if (!right.valid) return 1;

  const epochDiff = (left.epoch || 0) - (right.epoch || 0);
  if (epochDiff !== 0) return epochDiff > 0 ? 1 : -1;

  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.numbers[index] ?? 0;
    const b = right.numbers[index] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function versionEqual(left, right) {
  return compareVersions(left, right) === 0;
}

export function satisfiesVersion(version, minVersion, maxVersion) {
  if (minVersion && compareVersions(version, minVersion) < 0) return false;
  if (maxVersion && compareVersions(version, maxVersion) > 0) return false;
  return true;
}

export function parseKspVersion(input) {
  const parsed = parseVersion(input);
  if (!parsed.valid) return parsed;
  // KSP 1.12.5.3190 is build metadata, not a fourth semantic version part.
  if (parsed.numbers.length >= 4 && parsed.numbers[0] === 1) {
    parsed.numbers = parsed.numbers.slice(0, 3);
    parsed.base = parsed.numbers.join('.');
  }
  return parsed;
}

export function formatKspVersion(input) {
  const parsed = parseKspVersion(input);
  return parsed.valid ? parsed.numbers.join('.') : String(input ?? '未知');
}

function sameMajorMinor(left, right) {
  return left.numbers[0] === right.numbers[0] && left.numbers[1] === right.numbers[1];
}

function sameBase(left, right) {
  if (!left.valid || !right.valid) return false;
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    if ((left.numbers[index] ?? 0) !== (right.numbers[index] ?? 0)) return false;
  }
  return true;
}

function compareKspBound(target, bound, isMaximum) {
  const width = bound.numbers.length <= 2 ? 2 : Math.max(3, Math.min(bound.numbers.length, 4));
  for (let index = 0; index < width; index += 1) {
    const left = target.numbers[index] ?? 0;
    const right = bound.numbers[index] ?? 0;
    if (left !== right) return isMaximum ? right - left : left - right;
  }
  return 0;
}

/**
 * Returns one of: compatible | warning | incompatible | unknown.
 * `warning` means "could work but was not verified for this exact game
 * version", and never blocks browsing. The resolver includes warnings only
 * when the user explicitly allows it.
 */
export function checkKspCompatibility(kspVersion, pkg = {}) {
  const target = parseKspVersion(kspVersion);
  if (!target.valid) {
    return {
      status: 'unknown',
      label: '无法判断',
      reason: '尚未检测到 KSP 版本。',
      targetVersion: null,
    };
  }

  // CKAN 原始字段是 snake_case；Catalog 规范化后是 camelCase。
  // 两套都要支持，否则已规范化的索引包会被误判为“未标注版本”。
  const declaredRaw = pkg.kspVersion ?? pkg.ksp_version;
  const minRaw = pkg.kspVersionMin ?? pkg.ksp_version_min;
  const maxRaw = pkg.kspVersionMax ?? pkg.ksp_version_max;
  const strict = pkg.kspVersionStrict ?? pkg.ksp_version_strict;
  const declared = declaredRaw ? parseKspVersion(declaredRaw) : null;
  const min = minRaw ? parseKspVersion(minRaw) : null;
  const max = maxRaw ? parseKspVersion(maxRaw) : null;

  if (strict && declared) {
    if (sameBase(target, declared) || (declared.numbers.length <= 2 && sameMajorMinor(target, declared))) {
      return {
        status: 'compatible',
        label: '精确适配',
        reason: `作者标记仅适配 KSP ${declared.numbers.join('.')}。`,
        targetVersion: formatKspVersion(kspVersion),
      };
    }
    return {
      status: 'incompatible',
      label: '不兼容',
      reason: `作者要求精确的 KSP ${declared.numbers.join('.')}，当前为 ${formatKspVersion(kspVersion)}。`,
      targetVersion: formatKspVersion(kspVersion),
    };
  }

  if (min || max) {
    const minOk = !min || compareKspBound(target, min, false) >= 0;
    const maxOk = !max || compareKspBound(target, max, true) >= 0;
    if (minOk && maxOk) {
      return {
        status: 'compatible',
        label: '兼容',
        reason: `适配范围 ${min ? min.numbers.join('.') : '任意'} – ${max ? max.numbers.join('.') : '任意'}。`,
        targetVersion: formatKspVersion(kspVersion),
      };
    }
    return {
      status: 'incompatible',
      label: '不兼容',
      reason: `适配范围 ${min ? min.numbers.join('.') : '任意'} – ${max ? max.numbers.join('.') : '任意'}，当前为 ${formatKspVersion(kspVersion)}。`,
      targetVersion: formatKspVersion(kspVersion),
    };
  }

  if (declared) {
    if (sameBase(target, declared) || (declared.numbers.length <= 2 && sameMajorMinor(target, declared))) {
      return {
        status: 'compatible',
        label: '兼容',
        reason: `适配 KSP ${declared.numbers.join('.')}。`,
        targetVersion: formatKspVersion(kspVersion),
      };
    }
    if (sameMajorMinor(target, declared) || compareVersions(target, declared) > 0) {
      return {
        status: 'warning',
        label: '可能兼容',
        reason: `作者测试于 KSP ${declared.numbers.join('.')}，当前为 ${formatKspVersion(kspVersion)}。`,
        targetVersion: formatKspVersion(kspVersion),
      };
    }
    return {
      status: 'incompatible',
      label: '不兼容',
      reason: `该版本要求 KSP ${declared.numbers.join('.')} 或更新，当前为 ${formatKspVersion(kspVersion)}。`,
      targetVersion: formatKspVersion(kspVersion),
    };
  }

  return {
    status: 'unknown',
    label: '版本未标注',
    reason: '元数据没有声明 KSP 适配版本，安装前请查看作者说明。',
    targetVersion: formatKspVersion(kspVersion),
  };
}

export function compatibilityRank(status) {
  switch (status) {
    case 'compatible':
      return 3;
    case 'warning':
      return 2;
    case 'unknown':
      return 1;
    default:
      return 0;
  }
}

export function normalizeIdentifier(value) {
  return String(value ?? '').trim();
}

export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

export function shortVersion(value) {
  const parsed = parseVersion(value);
  return parsed.valid ? parsed.numbers.join('.') + (parsed.prerelease.length ? `-${parsed.prerelease.join('.')}` : '') : String(value ?? '');
}
