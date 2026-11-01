import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapCurseForgeDetail,
  mapCurseForgeMod,
  pickCurseForgeFile,
  searchCurseForge,
} from '../src/curseforge.js';

const mod = {
  id: 123,
  name: 'Test Forge Mod',
  slug: 'test-forge-mod',
  summary: 'A <b>small</b> test mod.',
  downloadCount: 42,
  links: { websiteUrl: 'https://www.curseforge.com/kerbal-space-program/test-forge-mod' },
  categories: [{ id: 1, name: 'Parts' }, { id: 2, name: 'Graphics' }],
  authors: [{ name: 'Tester' }],
  logo: { url: 'https://media.forgecdn.net/logo.png' },
  latestFiles: [
    {
      id: 9,
      fileName: 'TestForgeMod-2.0.zip',
      displayName: 'TestForgeMod 2.0',
      fileDate: '2026-01-02T00:00:00Z',
      fileLength: 2048,
      releaseType: 1,
      downloadUrl: 'https://media.forgecdn.net/files/9/TestForgeMod-2.0.zip',
      gameVersions: ['1.12.5', '1.12'],
    },
    {
      id: 8,
      fileName: 'TestForgeMod-1.0.zip',
      displayName: 'TestForgeMod 1.0',
      fileDate: '2025-01-02T00:00:00Z',
      fileLength: 1024,
      releaseType: 1,
      gameVersions: ['1.11.2'],
    },
  ],
};

test('CurseForge maps project identity, tags and compatibility', () => {
  const mapped = mapCurseForgeMod(mod, { kspVersion: '1.12.5' });
  assert.equal(mapped.identifier, 'curseforge-123');
  assert.equal(mapped.source, 'curseforge');
  assert.equal(mapped.name, 'Test Forge Mod');
  assert.equal(mapped.author, 'Tester');
  assert.deepEqual(mapped.tags, ['Parts', 'Graphics']);
  assert.equal(mapped.compatibility.status, 'compatible');
  assert.equal(mapped.curseforge.fileId, 9);
  assert.equal(mapped.abstract, 'A small test mod.');
});

test('CurseForge picks exact KSP file and falls back to newest', () => {
  assert.equal(pickCurseForgeFile(mod, '1.12.5').id, 9);
  const noMatch = {
    ...mod,
    latestFiles: [mod.latestFiles[1], { ...mod.latestFiles[0], gameVersions: [] }],
  };
  assert.equal(pickCurseForgeFile(noMatch, '1.12.5').id, 9);
});

test('CurseForge detail deduplicates gallery and includes description', () => {
  const detail = mapCurseForgeDetail(mod, {
    kspVersion: '1.12.5',
    description: '<p>Hello <strong>forge</strong></p>',
    screenshots: [
      { url: 'https://media.forgecdn.net/shot1.png', title: 'Shot 1' },
      { url: 'https://media.forgecdn.net/shot1.png', title: 'Duplicate' },
    ],
  });
  assert.equal(detail.source, 'curseforge');
  assert.match(detail.package.description, /Hello forge/);
  assert.equal(detail.images.length, 2);
  assert.match(detail.images[0].proxyUrl, /^\/api\/image\?url=/);
});

test('CurseForge search sends API key and reads pagination total', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [mod], pagination: { totalCount: 77 } };
      },
    };
  };
  const result = await searchCurseForge({ apiKey: 'secret', query: 'test', page: 2, pageSize: 10, fetchImpl, kspVersion: '1.12.5' });
  assert.equal(result.total, 77);
  assert.equal(result.items[0].identifier, 'curseforge-123');
  assert.equal(request.options.headers['x-api-key'], 'secret');
  assert.match(request.url, /gameId=4401/);
  assert.match(request.url, /index=10/);
});
