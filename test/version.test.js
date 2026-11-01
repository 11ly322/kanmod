import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKspVersion,
  parseVersion,
  compareVersions,
  checkKspCompatibility,
  satisfiesVersion,
} from '../src/util/version.js';

test('parseVersion 支持 CKAN epoch 与松散后缀', () => {
  const beta = parseVersion('1:v1.3.5_beta');
  assert.equal(beta.valid, true);
  assert.equal(beta.epoch, 1);
  assert.deepEqual(beta.numbers, [1, 3, 5]);
  assert.deepEqual(beta.prerelease, ['beta']);

  assert.equal(compareVersions('1:v1.3.5_beta', '1:v1.3.4'), 1);
  assert.equal(compareVersions('1:v0.2.0.0', 'v0.11.1.6'), 1);
  assert.equal(compareVersions('1.2.2.2a', '1.2.2.2'), -1);
  assert.equal(satisfiesVersion('1:v1.3.5_beta', '1:v1.3.4'), true);
});

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

  // A two-part max like 1.12 covers the whole 1.12.x line.
  const minorMax = checkKspCompatibility('1.12.5', {
    ksp_version_min: '1.8',
    ksp_version_max: '1.12',
  });
  assert.equal(minorMax.status, 'compatible');

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
