import test from 'node:test';
import assert from 'node:assert/strict';
import { featureCatalogView } from '../server/feature-suite.ts';

test('feature suite exposes the complete five-category roadmap', () => {
  const features = featureCatalogView();
  assert.equal(features.length, 50);
  assert.equal(new Set(features.map((feature) => feature.id)).size, 50);
  assert.equal(new Set(features.map((feature) => feature.category)).size, 6);
  assert.ok(features.every((feature) => ['P0', 'P1', 'P2'].includes(feature.priority)));
  assert.ok(features.some((feature) => feature.id === 'metrics-history' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'gpu-acceleration' && feature.state === 'planned'));
});
