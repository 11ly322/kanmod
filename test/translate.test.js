import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText, hasChinese, cleanSourceText, TranslationError } from '../src/translate.js';

test('cleanSourceText 去除 HTML 与 BBCode 并保留段落', () => {
  const source = '<p>Hello <strong>world</strong></p>[url=https://example.com]site[/url]<br>line 2';
  const clean = cleanSourceText(source);
  assert.match(clean, /Hello world/);
  assert.match(clean, /site/);
  assert.match(clean, /line 2/);
  assert.doesNotMatch(clean, /<p>|\[url/);
});

test('hasChinese 识别中文文本', () => {
  assert.equal(hasChinese('这是一个完整的中文句子。'), true);
  assert.equal(hasChinese('A short English sentence.'), false);
});

test('演示模式返回内置中文翻译', async () => {
  const result = await translateText({
    text: 'A community-maintained collection of bug fixes.',
    identifier: 'KSPCommunityFixes',
    version: '1.35.2',
    field: 'abstract',
    demo: true,
  });
  assert.equal(result.demo, true);
  assert.equal(result.machine, false);
  assert.match(result.text, /社区/);
});

test('演示模式没有内置翻译时给出可重试错误', async () => {
  await assert.rejects(
    () => translateText({ text: 'No translation here.', identifier: 'UnknownMod', demo: true }),
    (error) => error instanceof TranslationError && error.code === 'TRANSLATION_DEMO_MISSING',
  );
});

test('中文原文直接跳过翻译', async () => {
  const result = await translateText({ text: '这是一段已经翻译好的中文简介。', identifier: 'AnyMod' });
  assert.equal(result.translated, false);
  assert.equal(result.chinese, true);
});
