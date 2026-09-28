import test from 'node:test';
import assert from 'node:assert/strict';
import { extendedFeatureCatalog } from '../server/extended-features.ts';
import {
  engineeringOperations,
  operationViews,
  validateOperation,
} from '../server/engineering-operations.ts';

test('the second feature tranche has 100 unique, categorized entries', () => {
  assert.equal(extendedFeatureCatalog.length, 100);
  assert.equal(new Set(extendedFeatureCatalog.map(([id]) => id)).size, 100);
  assert.ok(new Set(extendedFeatureCatalog.map(([, , category]) => category)).size >= 8);
  assert.ok(extendedFeatureCatalog.every(([, , , priority]) => ['P0', 'P1', 'P2'].includes(priority)));
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'disk-encryption')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'git-stash')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'self-update')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'secure-erase')?.[5], 'available');
});

test('engineering operations expose JSON schemas and reject unsafe project paths', () => {
  const views = operationViews();
  assert.ok(views.length >= 30);
  assert.ok(views.every((view) => view.schema && typeof view.schema === 'object'));
  assert.equal(
    validateOperation({ operation: 'hash-manifest', parameters: { path: 'src' } }).operation,
    'hash-manifest',
  );
  assert.throws(
    () => validateOperation({ operation: 'archive', parameters: { mode: 'create', path: '../outside' } }),
    /项目内的相对路径/,
  );
  assert.throws(() => validateOperation({ operation: 'missing', parameters: {} }), /操作不存在/);
  assert.equal(
    validateOperation({ operation: 'feature-run', parameters: { featureId: 'session-lock', mode: 'check' } })
      .operation,
    'feature-run',
  );
  assert.ok(engineeringOperations['command-risk'].writes === false);
});
