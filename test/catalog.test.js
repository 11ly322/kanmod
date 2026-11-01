import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, normalizePackage } from '../src/catalog/catalog.js';
import { resolvePlan } from '../src/catalog/resolver.js';

function pkg(identifier, version, extra = {}) {
  return normalizePackage({
    spec_version: 'v1.34',
    identifier,
    name: identifier,
    abstract: `${identifier} test package`,
    author: 'test',
    version,
    ksp_version: '1.12.5',
    download: `https://example.invalid/${identifier}-${version}.zip`,
    install: [{ find: identifier, install_to: 'GameData' }],
    ...extra,
  });
}

test('Catalog 按 identifier 去重并提供兼容版本', () => {
  const catalog = new Catalog([
    pkg('ModuleManager', '4.2.3'),
    pkg('ModuleManager', '4.2.0'),
    pkg('OldParts', '0.9.1', { ksp_version: '1.10.1' }),
  ]);
  assert.equal(catalog.meta.identifierCount, 2);
  assert.equal(catalog.versions('ModuleManager').length, 2);
  assert.equal(catalog.compatiblePackage('ModuleManager', '1.12.5').pkg.version, '4.2.3');
  assert.equal(catalog.compatiblePackage('OldParts', '1.12.5'), null);
});

test('resolvePlan 递归安装硬依赖并按依赖顺序排列', () => {
  const catalog = new Catalog([
    pkg('Harmony', '2.2.1'),
    pkg('ModuleManager', '4.2.3', {
      depends: [{ name: 'Harmony', min_version: '2.0.0' }],
    }),
    pkg('KSPCommunityFixes', '1.35.2', {
      depends: [{ name: 'ModuleManager', min_version: '4.2.0' }],
    }),
  ]);
  const plan = resolvePlan({
    catalog,
    roots: ['KSPCommunityFixes'],
    kspVersion: '1.12.5',
    installed: [],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.installOrder.map((node) => node.identifier),
    ['Harmony', 'ModuleManager', 'KSPCommunityFixes'],
  );
  assert.equal(plan.summary.install, 3);
  assert.equal(plan.summary.missing, 0);
});

test('resolvePlan 报告缺失前置', () => {
  const catalog = new Catalog([
    pkg('NeedsMissing', '1.0.0', {
      depends: [{ name: 'NotInIndex', min_version: '1.0.0' }],
    }),
  ]);
  const plan = resolvePlan({
    catalog,
    roots: ['NeedsMissing'],
    kspVersion: '1.12.5',
    installed: [],
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].name, 'NotInIndex');
});

test('resolvePlan 可在关闭自动依赖时只安装根模组', () => {
  const catalog = new Catalog([
    pkg('Dependency', '1.0.0'),
    pkg('RootWithDependency', '1.0.0', {
      depends: [{ name: 'Dependency', min_version: '1.0.0' }],
    }),
  ]);
  const plan = resolvePlan({
    catalog,
    roots: ['RootWithDependency'],
    kspVersion: '1.12.5',
    installed: [],
    includeDependencies: false,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.installOrder.map((node) => node.identifier),
    ['RootWithDependency'],
  );
  assert.equal(plan.summary.install, 1);
  assert.equal(plan.summary.missing, 0);
});
