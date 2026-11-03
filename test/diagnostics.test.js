import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeRelations, diagnoseGame, planRepairs } from '../src/diagnostics.js';

function stubCatalog(packages = []) {
  return {
    all: packages,
    get(identifier, version) {
      return packages.find((pkg) => pkg.identifier === identifier && (!version || pkg.version === version)) || null;
    },
    versions(identifier) {
      return packages.filter((pkg) => pkg.identifier === identifier);
    },
    hasIdentifier(identifier) {
      return packages.some((pkg) => pkg.identifier === identifier);
    },
    providersFor() {
      return [];
    },
    compatiblePackage() {
      return null;
    },
  };
}

function scanWith(entries) {
  return { kspVersion: '1.12.5', entries, duplicates: [], stats: {} };
}

test('已禁用的前置不会被误报为缺少依赖', () => {
  const catalog = stubCatalog([
    {
      identifier: 'ModA',
      name: 'Mod A',
      version: '1.0',
      kspVersion: '1.12.5',
      depends: [{ name: 'DisabledDep' }],
      conflicts: [],
      provides: [],
      install: [],
    },
  ]);
  const scan = scanWith([{
    id: 'entry-a',
    identifier: 'ModA',
    folder: 'ModA',
    name: 'Mod A',
    installedVersion: '1.0',
    components: [],
    managed: true,
    managedBy: 'kanmod',
    relPath: 'GameData/ModA',
  }]);
  const relation = analyzeRelations(scan, catalog, '1.12.5', null, {}, {
    disabled: [{ identifier: 'DisabledDep', name: 'DisabledDep', version: '2.0' }],
  });
  const codes = relation.issues.map((item) => item.code);
  assert.ok(codes.includes('dependency-disabled'));
  assert.ok(!codes.includes('missing-dependency'));
  assert.ok(!relation.issues.some((item) => item.autoFixable));
});

test('未安装且未禁用的前置仍然报告缺少依赖', () => {
  const catalog = stubCatalog([
    {
      identifier: 'ModA',
      name: 'Mod A',
      version: '1.0',
      kspVersion: '1.12.5',
      depends: [{ name: 'MissingDep' }],
      conflicts: [],
      provides: [],
      install: [],
    },
  ]);
  const scan = scanWith([{
    id: 'entry-a',
    identifier: 'ModA',
    folder: 'ModA',
    name: 'Mod A',
    installedVersion: '1.0',
    components: [],
    managed: true,
    managedBy: 'kanmod',
    relPath: 'GameData/ModA',
  }]);
  const relation = analyzeRelations(scan, catalog, '1.12.5', null, {});
  assert.ok(relation.issues.some((item) => item.code === 'missing-dependency'));
});

test('planRepairs 合并同一模组的多个修复并保留最高版本', () => {
  const diagnostics = {
    issues: [
      {
        id: 'a',
        autoFixable: true,
        fix: { action: 'install', identifier: 'Dep', version: '1.0', label: '安装 Dep 1.0' },
      },
      {
        id: 'b',
        autoFixable: true,
        fix: { action: 'install', identifier: 'Dep', version: '2.0', label: '安装 Dep 2.0' },
      },
      { id: 'c', autoFixable: false },
    ],
  };
  const repairs = planRepairs(diagnostics);
  assert.equal(repairs.count, 1);
  assert.equal(repairs.operations[0].version, '2.0');
  assert.deepEqual(repairs.operations[0].issueIds, ['a', 'b']);
  assert.equal(repairs.skipped, 1);
});

test('大量提示项不会把健康分压到“需要修复”', async () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({
    id: `entry-${index}`,
    identifier: `Mod${index}`,
    folder: `Mod${index}`,
    name: `Mod ${index}`,
    installedVersion: '1.0',
    components: [],
    managed: false,
    managedBy: 'manual',
    relPath: `GameData/Mod${index}`,
  }));
  const packages = entries.map((entry) => ({
    identifier: entry.identifier,
    name: entry.name,
    version: '1.0',
    depends: [],
    conflicts: [],
    provides: [],
    install: [],
  }));
  const diagnostics = await diagnoseGame({
    kspPath: 'C:/kanmod-test-ksp',
    scan: scanWith(entries),
    catalog: stubCatalog(packages),
    registry: null,
    settings: {},
    includeLog: false,
  });
  assert.equal(diagnostics.counts.info, 12);
  assert.equal(diagnostics.counts.error, 0);
  assert.equal(diagnostics.counts.warning, 0);
  assert.equal(diagnostics.health.score, 90);
  assert.equal(diagnostics.health.label, '良好');
});
