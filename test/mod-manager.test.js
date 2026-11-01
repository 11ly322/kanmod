import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  DisabledStore,
  computeUpdates,
  disableMod,
  enableMod,
  removeModPath,
} from '../src/modManager.js';

const root = path.join(os.tmpdir(), 'kanmod-test-mod-manager');

function registryStub() {
  let saved = null;
  const registryRecord = { identifier: 'TestMod', files: [] };
  return {
    getByIdentifier: () => registryRecord,
    getByFolder: () => null,
    getById: () => null,
    upsert: (record) => { saved = record; },
    get saved() { return saved; },
  };
}

test('禁用与启用会移动整个模组目录并维护清单', async () => {
  await fs.rm(root, { recursive: true, force: true });
  const kspPath = path.join(root, 'ksp');
  const modPath = path.join(kspPath, 'GameData', 'TestMod');
  await fs.mkdir(modPath, { recursive: true });
  await fs.writeFile(path.join(modPath, 'TestMod.dll'), 'dll');
  const store = new DisabledStore(path.join(root, 'disabled.json'));
  const registry = registryStub();
  const entry = {
    identifier: 'TestMod',
    name: 'Test Mod',
    folder: 'TestMod',
    relPath: 'TestMod',
    absolutePath: modPath,
    installedVersion: '1.0.0',
    type: 'folder',
    size: 3,
    sizeLabel: '3 B',
  };

  const result = await disableMod({ kspPath, entry, store, registry });
  assert.ok(result.manifest.disabledRel.startsWith('DisabledMods/'));
  await assert.rejects(fs.access(modPath));
  await fs.access(path.join(kspPath, result.manifest.disabledRel, 'TestMod.dll'));
  assert.equal(store.records().length, 1);
  assert.equal(registry.saved.disabled, true);

  await enableMod({ kspPath, manifest: store.records()[0], store, registry });
  await fs.access(modPath);
  assert.equal(store.records().length, 0);
  assert.ok(!registry.saved.disabled);

  await fs.rm(root, { recursive: true, force: true });
});

test('删除禁用模组会移入回收站', async () => {
  await fs.rm(root, { recursive: true, force: true });
  const kspPath = path.join(root, 'ksp');
  const modPath = path.join(kspPath, 'GameData', 'TestMod');
  await fs.mkdir(modPath, { recursive: true });
  await fs.writeFile(path.join(modPath, 'TestMod.dll'), 'dll');
  const store = new DisabledStore(path.join(root, 'disabled.json'));
  const registry = registryStub();
  const entry = {
    identifier: 'TestMod',
    name: 'Test Mod',
    folder: 'TestMod',
    relPath: 'TestMod',
    absolutePath: modPath,
    installedVersion: '1.0.0',
    type: 'folder',
  };
  const result = await disableMod({ kspPath, entry, store, registry });

  const removed = await removeModPath({
    kspPath,
    entry,
    manifest: store.records()[0],
    trashDir: path.join(root, 'trash'),
  });
  assert.equal(removed.moved, true);
  await fs.access(path.resolve(kspPath, removed.trashPath));
  await assert.rejects(fs.access(path.join(kspPath, result.manifest.disabledRel)));
  await fs.rm(root, { recursive: true, force: true });
});

test('computeUpdates 识别可用的兼容更新', () => {
  const catalog = {
    compatiblePackage: () => ({
      pkg: { identifier: 'TestMod', version: '2.0.0' },
      compatibility: { status: 'compatible' },
    }),
  };
  const updates = computeUpdates([
    { identifier: 'TestMod', name: 'Test Mod', installedVersion: '1.0.0' },
  ], catalog, '1.12.5');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].latestVersion, '2.0.0');
});
