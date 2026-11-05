import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadPackage, mapLimit } from '../src/downloads.js';

const scratchDirs = [];

async function freshDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanmod-test-downloads-'));
  scratchDirs.push(dir);
  return dir;
}

test.after(async () => {
  await Promise.all(scratchDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
});

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(done);
        }),
      });
    });
  });
}

function rangeResponse(req, res, body) {
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    res.end(body);
    return;
  }
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  const start = Number(match?.[1] || 0);
  const end = Math.min(body.length - 1, Number(match?.[2] || body.length - 1));
  res.writeHead(206, {
    'content-type': 'application/zip',
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${body.length}`,
    'accept-ranges': 'bytes',
  });
  res.end(body.subarray(start, end + 1));
}

test('mapLimit keeps order and caps concurrency', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});

test('downloadPackage uses parallel range requests for large files', async () => {
  const scratch = await freshDir();
  const body = Buffer.alloc(5 * 1024 * 1024, 0x5a);
  let requests = 0;
  const fixture = await startServer((req, res) => {
    requests += 1;
    rangeResponse(req, res, body);
  });
  try {
    const result = await downloadPackage({
      identifier: 'RangedPack',
      version: '1.0.0',
      download: [`${fixture.base}/RangedPack-1.0.0.zip`],
    }, {
      destDir: scratch,
      settings: {
        network: { rangeChunks: 4, allowInsecureHttp: true, parallelSources: 1 },
      },
    });
    const saved = await fs.readFile(result.path);
    assert.equal(saved.length, body.length);
    assert.equal(result.bytes, body.length);
    assert.ok(requests >= 3, `expected multiple range requests, saw ${requests}`);
  } finally {
    await fixture.close();
  }
});

test('downloadPackage falls back to one stream when ranges are ignored', async () => {
  const scratch = await freshDir();
  const body = Buffer.alloc(4 * 1024 * 1024 + 128, 0x33);
  let requests = 0;
  const fixture = await startServer((req, res) => {
    requests += 1;
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    res.end(body);
  });
  try {
    const result = await downloadPackage({
      identifier: 'PlainPack',
      version: '2.0.0',
      download: [`${fixture.base}/PlainPack-2.0.0.zip`],
    }, {
      destDir: scratch,
      settings: {
        network: { rangeChunks: 4, allowInsecureHttp: true, parallelSources: 1 },
      },
    });
    const saved = await fs.readFile(result.path);
    assert.equal(saved.length, body.length);
    assert.ok(requests <= 3, `fallback should not spray requests, saw ${requests}`);
  } finally {
    await fixture.close();
  }
});

test('downloadPackage races sources and keeps the first completed one', async () => {
  const scratch = await freshDir();
  const body = Buffer.alloc(512 * 1024, 0x21);
  const fixture = await startServer((req, res) => {
    if (req.url.startsWith('/slow')) {
      // Never send the body: the race must abandon this source.
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
      res.write('x');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    res.end(body);
  });
  try {
    const started = Date.now();
    const result = await downloadPackage({
      identifier: 'RacedPack',
      version: '3.0.0',
      download: [`${fixture.base}/slow.zip`, `${fixture.base}/fast.zip`],
    }, {
      destDir: scratch,
      settings: {
        network: {
          parallelSources: 2,
          rangeChunks: 1,
          stallTimeoutSeconds: 30,
          allowInsecureHttp: true,
        },
      },
    });
    const saved = await fs.readFile(result.path);
    assert.equal(saved.length, body.length);
    assert.ok(Date.now() - started < 5000, 'race should finish quickly');
    assert.match(result.candidate.url, /fast\.zip$/);
  } finally {
    await fixture.close();
  }
});

test('downloadPackage reports a hash mismatch instead of keeping the file', async () => {
  const scratch = await freshDir();
  const body = Buffer.from('not the expected payload');
  const fixture = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    res.end(body);
  });
  try {
    await assert.rejects(() => downloadPackage({
      identifier: 'HashedPack',
      version: '4.0.0',
      download: [`${fixture.base}/HashedPack-4.0.0.zip`],
      downloadHash: { sha256: 'a'.repeat(64) },
    }, {
      destDir: scratch,
      settings: { network: { rangeChunks: 1, allowInsecureHttp: true, parallelSources: 1 } },
    }), /校验失败|所有下载源都失败了/);
  } finally {
    await fixture.close();
  }
});
