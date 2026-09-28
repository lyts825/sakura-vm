import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureCatalogView,
  implementedFeatureCatalogView,
  resourcePresets,
} from '../server/feature-suite.ts';

test('feature suite exposes the complete six-category roadmap', () => {
  const features = featureCatalogView();
  assert.equal(features.length, 50);
  assert.equal(new Set(features.map((feature) => feature.id)).size, 50);
  assert.equal(new Set(features.map((feature) => feature.category)).size, 6);
  assert.ok(features.every((feature) => ['P0', 'P1', 'P2'].includes(feature.priority)));
  assert.ok(features.some((feature) => feature.id === 'metrics-history' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'dynamic-memory' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'test-explorer' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'gpu-acceleration' && feature.state === 'available'));
  assert.deepEqual(implementedFeatureCatalogView(), features);
  assert.ok(features.some((feature) => feature.id === 'single-app-windows' &&
    !feature.implemented && feature.state === 'experimental'));
});

test('resource presets stay within the VM configuration limits', () => {
  assert.deepEqual(Object.keys(resourcePresets), ['light', 'development', 'build', 'desktop']);
  assert.ok(
    Object.values(resourcePresets).every((preset) => preset.memoryMiB >= 256 && preset.memoryMiB <= 8192),
  );
  assert.ok(Object.values(resourcePresets).every((preset) => preset.cpus >= 1 && preset.cpus <= 8));
});
