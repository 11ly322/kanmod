import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProjectRef,
  forgeCdnUrl,
  normalizeProject,
  toCurseForgeMod,
  PublicCurseForgeError,
} from '../src/curseforgePublic.js';
import { mapCurseForgeMod } from '../src/curseforge.js';

const PROJECT = {
  id: 248613,
  title: 'Steampunk - 1869',
  summary: '1869 - A KSP steampunk mod.',
  description: '<p>Steampunk parts.</p>',
  urls: { curseforge: 'https://www.curseforge.com/kerbal/ksp-mods/a-steampunk-mod' },
  thumbnail: 'https://media.forgecdn.net/avatars/x.png',
  created_at: '2016-08-09T21:22:51.72Z',
  downloads: { monthly: 0, total: 5479 },
  categories: [{ name: 'Parts' }],
  members: [{ username: 'Badsector' }],
  files: [
    {
      id: 2590458,
      name: '1869Beta0113.zip',
      display: '1869 Beta 1.12',
      type: 'beta',
      version: '1.4.3',
      filesize: 38599649,
      downloads: 1609,
      versions: ['1.4.3', '1.4.4', '1.12.5'],
      uploaded_at: '2018-07-24T16:13:44.993Z',
      url: 'https://www.curseforge.com/kerbal/ksp-mods/a-steampunk-mod/files/2590458',
    },
  ],
  download: { id: 2590458, name: '1869Beta0113.zip' },
};

test('parseProjectRef 支持数字 ID、项目链接与 slug', () => {
  assert.deepEqual(parseProjectRef('248613'), { kind: 'id', id: 248613, slug: null, url: null });
  const fromUrl = parseProjectRef('https://www.curseforge.com/kerbal/ksp-mods/a-steampunk-mod');
  assert.equal(fromUrl.kind, 'slug');
  assert.equal(fromUrl.slug, 'a-steampunk-mod');
  const fromFileUrl = parseProjectRef('https://www.curseforge.com/kerbal/ksp-mods/a-steampunk-mod/files/2590458');
  assert.equal(fromFileUrl.slug, 'a-steampunk-mod');
  assert.equal(parseProjectRef('a-steampunk-mod').slug, 'a-steampunk-mod');
  assert.throws(() => parseProjectRef(''), PublicCurseForgeError);
  assert.throws(() => parseProjectRef('https://example.com/kerbal/ksp-mods/x'), /只支持 cureforge|只支持 curseforge/i);
});

test('forgeCdnUrl 按文件 ID 生成 ForgeCDN 直链', () => {
  assert.equal(forgeCdnUrl({ id: 2590458, name: '1869Beta0113.zip' }), 'https://mediafilez.forgecdn.net/files/2590/458/1869Beta0113.zip');
  assert.equal(forgeCdnUrl({ id: 0, name: 'x.zip' }), null);
  assert.equal(forgeCdnUrl({ id: 12 }), null);
});

test('normalizeProject 归一化文件并按时间排序', () => {
  const project = normalizeProject({ ...PROJECT, files: [...PROJECT.files, { ...PROJECT.files[0], id: 2590999, uploaded_at: '2019-01-01T00:00:00Z' }] });
  assert.equal(project.id, 248613);
  assert.equal(project.slug, 'a-steampunk-mod');
  assert.equal(project.downloads, 5479);
  assert.equal(project.members[0], 'Badsector');
  assert.equal(project.files.length, 2);
  assert.equal(project.files[0].id, 2590999);
  assert.equal(project.files[0].cdn, true);
  assert.match(project.files[0].downloadUrl, /mediafilez\.forgecdn\.net/);
});

test('toCurseForgeMod + mapCurseForgeMod 在无 Key 模式下仍给出兼容性', () => {
  const project = normalizeProject(PROJECT);
  const item = mapCurseForgeMod(toCurseForgeMod(project), { kspVersion: '1.12.5' });
  assert.equal(item.identifier, 'curseforge-248613');
  assert.equal(item.name, 'Steampunk - 1869');
  assert.equal(item.version, '1869 Beta 1.12');
  assert.equal(item.downloadSize, 38599649);
  assert.equal(item.compatibility.status, 'compatible');
  assert.equal(item.author, 'Badsector');
  assert.equal(item.download, 'https://mediafilez.forgecdn.net/files/2590/458/1869Beta0113.zip');
  assert.equal(item.curseforge.id, '248613');
});
