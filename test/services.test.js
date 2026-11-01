import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as services from '../src/server/services.js';

test('server services expose their public surface', () => {
  for (const name of ['getRuntime', 'installedFor', 'enqueueRefresh', 'publicSettings', 'catalogStatus', 'cacheStatus']) {
    assert.equal(typeof services[name], 'function', `${name} should be exported`);
  }
});

test('enqueueRefresh reports a missing catalog source instead of crashing', async () => {
  const context = {
    demo: false,
    configStore: { get: () => ({ catalog: { enabledSources: [] } }) },
    jobs: { create: () => assert.fail('no job should be created') },
  };
  await assert.rejects(services.enqueueRefresh(context), (error) => error.code === 'NO_CATALOG_SOURCE');
});
