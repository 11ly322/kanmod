import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKspVersion,
  compareVersions,
  checkKspCompatibility,
  satisfiesVersion,
} from '../src/util/version.js';

test('parseKspVersion 截断 KSP 四位构建号', () => {
  assert.deepEqual(parseKspVersion('1.12.5.3190').numbers, [1, 12, 5]);
  assert.equal(compareVersions('1.12.5', '1.12.4'), 1);
  assert.equal(compareVersions('1.12.5', '1.12.5'), 0);
  assert.equal(compareVersions('1.12.5', '1.12.6'), -1);
});

test('checkKspCompatibility 支持规范化字段', () => {
  const compatible = checkKspCompatibility('1.12.5', {
    kspVersion: '1.12.5',
    kspVersionStrict: false,
  });
  assert.equal(compatible.status, 'compatible');

  const raw = checkKspCompatibility('1.12.5', {
    ksp_version: '1.9.1',
    ksp_version_min: '1.8.0',
    ksp_version_max: '1.12.5',
  });
  assert.equal(raw.status, 'compatible');

  const incompatible = checkKspCompatibility('1.12.5', {
    kspVersion: '1.10.1',
  });
  assert.equal(incompatible.status, 'warning');

  const unknown = checkKspCompatibility('1.12.5', {});
  assert.equal(unknown.status, 'unknown');
});

test('satisfiesVersion 支持最小和最大版本', () => {
  assert.equal(satisfiesVersion('4.2.3', '4.2.0'), true);
  assert.equal(satisfiesVersion('4.1.0', '4.2.0'), false);
  assert.equal(satisfiesVersion('2.2.1', '2.0.0', '2.2.1'), true);
  assert.equal(satisfiesVersion('2.3.0', '2.0.0', '2.2.1'), false);
});
