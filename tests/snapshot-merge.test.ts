import assert from 'node:assert/strict';
import test from 'node:test';
import { planSnapshotMerge } from '../server/snapshot-merge.ts';
import type { SnapshotDiffFile } from '../shared/snapshot-diff.ts';

const file = (path: string, hash: string): SnapshotDiffFile =>
  ({ path, type: 'file', bytes: 1, sha256: hash.repeat(64) });
const map = (...files: SnapshotDiffFile[]) => new Map(files.map((item) => [item.path, item]));

test('three-way merge applies independent edits and refuses conflicting changes', () => {
  const base = map(file('/workspace/edit', 'a'), file('/workspace/delete', 'a'),
    file('/workspace/conflict', 'a'), file('/workspace/same', 'a'));
  const branch = map(file('/workspace/edit', 'b'), file('/workspace/conflict', 'b'),
    file('/workspace/same', 'b'), file('/workspace/new', 'b'));
  const target = map(file('/workspace/edit', 'a'), file('/workspace/delete', 'a'),
    file('/workspace/conflict', 'c'), file('/workspace/same', 'b'),
    file('/workspace/target-only', 'c'));
  const plan = planSnapshotMerge(base, branch, target);
  assert.deepEqual(plan.apply.map((item) => item.path),
    ['/workspace/delete', '/workspace/edit', '/workspace/new']);
  assert.deepEqual(plan.conflicts, ['/workspace/conflict']);
  assert.deepEqual(plan.already, ['/workspace/same']);
});

test('three-way merge rejects a symlink parent crossing into another path', () => {
  const link: SnapshotDiffFile = { path: '/workspace/dir', type: 'symlink', target: '../elsewhere' };
  const plan = planSnapshotMerge(map(), map(link), map(file('/workspace/dir/child', 'a')));
  assert.deepEqual(plan.conflicts, ['/workspace/dir']);
  assert.deepEqual(plan.apply, []);
});
