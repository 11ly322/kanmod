import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createZip } from '../src/util/zip.js';
import { installArchive, uninstallRecord } from '../src/installer.js';

const root = path.join(os.tmpdir(), 'kanmod-test-installer');

test('installArchive 写入 GameData 并可安全卸载到回收站', async () => {
  await fs.rm(root, { recursive: true, force: true });
  const ksp = path.join(root, 'ksp');
  const archive = path.join(root, 'TestMod.zip');
  await fs.mkdir(path.join(ksp, 'GameData'), { recursive: true });
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, createZip([
    {
      name: 'GameData/TestMod/TestMod.dll',
      data: Buffer.from('test dll'),
    },
    {
      name: 'GameData/TestMod/TestMod.version',
      data: Buffer.from(JSON.stringify({
        NAME: 'TestMod',
        IDENTIFIER: 'TestMod',
        VERSION: '1.0.0',
        KSP_VERSION: '1.12.5',
      })),
    },
  ], { compress: true }));

  const result = await installArchive({
    archivePath: archive,
    kspPath: ksp,
    packageInfo: {
      identifier: 'TestMod',
      name: 'Test Mod',
      version: '1.0.0',
      kspVersion: '1.12.5',
      install: [{ find: 'TestMod', install_to: 'GameData' }],
    },
    settings: { install: { backupOverwrite: true } },
    backupsDir: path.join(root, 'backups'),
  });

  assert.equal(result.record.identifier, 'TestMod');
  assert.equal(result.record.version, '1.0.0');
  assert.ok(result.record.files.includes('GameData/TestMod/TestMod.dll'));
  await assert.doesNotReject(fs.access(path.join(ksp, 'GameData/TestMod/TestMod.dll')));

  const removed = await uninstallRecord({
    kspPath: ksp,
    record: result.record,
    trashDir: path.join(root, 'trash'),
  });
  assert.equal(removed.moved.length, 2);
  await assert.rejects(fs.access(path.join(ksp, 'GameData/TestMod/TestMod.dll')));
  await fs.rm(root, { recursive: true, force: true });
});

test('find_regexp 配合 find_matches_files 可以安装单个 DLL', async () => {
  const root2 = path.join(os.tmpdir(), 'kanmod-test-installer-regexp');
  await fs.rm(root2, { recursive: true, force: true });
  const ksp = path.join(root2, 'ksp');
  const archive = path.join(root2, 'ModuleManager-4.2.3.zip');
  await fs.mkdir(path.join(ksp, 'GameData'), { recursive: true });
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, createZip([
    { name: 'ModuleManager-4.2.3.dll', data: Buffer.from('mm dll') },
    { name: 'LICENSE', data: Buffer.from('license') },
  ], { compress: true }));

  const result = await installArchive({
    archivePath: archive,
    kspPath: ksp,
    packageInfo: {
      identifier: 'ModuleManager',
      name: 'Module Manager',
      version: '4.2.3',
      install: [{
        find_regexp: 'ModuleManager.*\.dll$',
        find_matches_files: true,
        install_to: 'GameData',
      }],
    },
    settings: { install: { backupOverwrite: true } },
    backupsDir: path.join(root2, 'backups'),
  });

  assert.ok(result.record.files.includes('GameData/ModuleManager-4.2.3.dll'));
  await assert.doesNotReject(fs.access(path.join(ksp, 'GameData/ModuleManager-4.2.3.dll')));
  await fs.rm(root2, { recursive: true, force: true });
});

test('安装规则为空时按压缩包内的 GameData 目录推断安装位置', async () => {
  const root3 = path.join(os.tmpdir(), 'kanmod-test-installer-gamedata');
  await fs.rm(root3, { recursive: true, force: true });
  const ksp = path.join(root3, 'ksp');
  const archive = path.join(root3, 'BDArmory-v0.11.0.1.zip');
  await fs.mkdir(path.join(ksp, 'GameData'), { recursive: true });
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, createZip([
    { name: 'GameData/BDArmory/BDArmory.dll', data: Buffer.from('bd dll') },
    { name: 'GameData/BDArmory/Parts/part.cfg', data: Buffer.from('PART') },
    { name: 'README.txt', data: Buffer.from('readme') },
  ], { compress: true }));

  const result = await installArchive({
    archivePath: archive,
    kspPath: ksp,
    packageInfo: { identifier: 'BDArmory', name: 'BDArmory', version: '0.11.0.1', install: [] },
    settings: { install: { backupOverwrite: true } },
    backupsDir: path.join(root3, 'backups'),
  });

  assert.ok(result.record.files.includes('GameData/BDArmory/BDArmory.dll'));
  assert.ok(result.record.files.includes('GameData/BDArmory/Parts/part.cfg'));
  await assert.doesNotReject(fs.access(path.join(ksp, 'GameData/BDArmory/BDArmory.dll')));
  await fs.rm(root3, { recursive: true, force: true });
});

test('没有扩展名的压缩包会按文件头识别为 zip', async () => {
  const root4 = path.join(os.tmpdir(), 'kanmod-test-installer-sniff');
  await fs.rm(root4, { recursive: true, force: true });
  const ksp = path.join(root4, 'ksp');
  const archive = path.join(root4, 'BDArmory-v0.11.0.1.archive');
  await fs.mkdir(path.join(ksp, 'GameData'), { recursive: true });
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, createZip([
    { name: 'GameData/BDArmory/BDArmory.dll', data: Buffer.from('bd dll') },
  ], { compress: true }));

  const result = await installArchive({
    archivePath: archive,
    kspPath: ksp,
    packageInfo: { identifier: 'BDArmory', name: 'BDArmory', version: '0.11.0.1', install: [] },
    settings: { install: { backupOverwrite: true } },
    backupsDir: path.join(root4, 'backups'),
  });

  assert.ok(result.record.files.includes('GameData/BDArmory/BDArmory.dll'));
  await assert.doesNotReject(fs.access(path.join(ksp, 'GameData/BDArmory/BDArmory.dll')));
  await fs.rm(root4, { recursive: true, force: true });
});
