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
