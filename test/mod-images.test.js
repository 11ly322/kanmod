import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractImageUrls,
  fetchImageBuffer,
  isAllowedImageUrl,
  searchModImages,
} from '../src/modImages.js';

test('图片地址只允许 https 公开图源和位图格式', () => {
  assert.equal(isAllowedImageUrl('https://spacedock.info/content/a/cover.png'), true);
  assert.equal(isAllowedImageUrl('https://raw.githubusercontent.com/a/b/HEAD/shot.jpg'), true);
  assert.equal(isAllowedImageUrl('http://spacedock.info/a.png'), false);
  assert.equal(isAllowedImageUrl('https://localhost/a.png'), false);
  assert.equal(isAllowedImageUrl('https://spacedock.info/a.svg'), false);
  assert.equal(isAllowedImageUrl('file:///C:/a.png'), false);
});

test('从说明或 README 中提取相对图片地址', () => {
  const urls = extractImageUrls(
    '<p><img src="images/one.png"></p>![two](https://i.imgur.com/two.jpg)',
    'https://raw.githubusercontent.com/owner/repo/HEAD/',
  );
  assert.deepEqual(urls, [
    'https://raw.githubusercontent.com/owner/repo/HEAD/images/one.png',
    'https://i.imgur.com/two.jpg',
  ]);
});

test('图片检索合并 SpaceDock 封面和 GitHub README', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).includes('spacedock.info/api/mod/42')) {
      return new Response(JSON.stringify({
        background: 'https://spacedock.info/content/a/cover.png',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('/readme')) {
      return new Response('![preview](images/preview.jpg)', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return new Response('', { status: 404 });
  };

  const result = await searchModImages({
    description: '',
    resources: {
      spacedock: 'https://spacedock.info/mod/42/demo',
      repository: 'https://github.com/owner/repo',
    },
  }, { fetchImpl });

  assert.deepEqual(result.images.map((item) => item.url), [
    'https://spacedock.info/content/a/cover.png',
    'https://raw.githubusercontent.com/owner/repo/HEAD/images/preview.jpg',
  ]);
  assert.deepEqual(result.sources, ['SpaceDock', 'GitHub README']);
});

test('图片下载拒绝 SVG 并限制大小', async () => {
  await assert.rejects(
    fetchImageBuffer('https://spacedock.info/a.svg'),
    (error) => error.code === 'IMAGE_URL_NOT_ALLOWED',
  );

  await assert.rejects(
    fetchImageBuffer('https://spacedock.info/a.png', {
      fetchImpl: async () => new Response('<svg/>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }),
    }),
    (error) => error.code === 'IMAGE_TYPE_NOT_ALLOWED',
  );
});
