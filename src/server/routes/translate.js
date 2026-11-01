// 模组标题、标签与全文翻译
import { translateBatch } from '../services.js';
import { HttpError, readJsonBody, sendJson } from '../http.js';
import { translateText, cleanSourceText } from '../../translate.js';

export function registerTranslateRoutes(router) {
router.post('/api/translate/batch', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const items = Array.isArray(body.items) ? body.items.slice(0, 48) : [];
    if (!items.length) throw new HttpError(400, '没有需要翻译的内容。', 'EMPTY_TEXT');
    const results = await translateBatch(context, items, { force: Boolean(body.force) });
    return sendJson(res, 200, { results });
});

router.post('/api/translate', async (req, res, context, url) => {
    const body = await readJsonBody(req);
    const identifier = String(body.identifier || '').trim().slice(0, 160);
    const version = body.version ? String(body.version).trim().slice(0, 80) : null;
    const field = ['abstract', 'description', 'name'].includes(body.field) ? body.field : 'abstract';
    let text = typeof body.text === 'string' ? body.text : '';
    if (!text && identifier) {
      const catalog = context.catalogStore.catalog;
      const pkg = catalog?.get(identifier, version || undefined);
      if (!pkg) throw new HttpError(404, '索引中找不到该模组，无法读取简介。', 'PACKAGE_NOT_FOUND');
      text = pkg[field] || '';
    }
    if (!text.trim()) throw new HttpError(400, '没有可翻译的简介。', 'EMPTY_TEXT');
    const translation = await translateText({
      text,
      identifier,
      version: version || '',
      field,
      demo: Boolean(context.demo),
      force: Boolean(body.force),
      timeoutMs: 7000,
    });
    return sendJson(res, 200, {
      translation,
      source: {
        identifier: identifier || null,
        version: version || null,
        field,
        length: cleanSourceText(text).length,
      },
    });
});
}
