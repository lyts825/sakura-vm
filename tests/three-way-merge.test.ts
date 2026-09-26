import test from 'node:test';
import assert from 'node:assert/strict';
import { threeWayMerge, resolvedMerge } from '../shared/three-way-merge.ts';

test('three-way merge retains independent edits, insertions, deletions and newline bytes', () => {
  const cases = [
    ['a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n', 'A\nb\nC\n'],
    ['a\nb\nc\n', 'a\nc\n', 'a\nb\nc\nd\n', 'a\nc\nd\n'],
    ['a\r\nb\r\nc', 'A\r\nb\r\nc', 'a\r\nb\r\nC', 'A\r\nb\r\nC'],
    ['', 'a', 'a', 'a'],
    ['a', 'a\n', 'a', 'a\n'],
  ];
  for (const [base, ours, theirs, expected] of cases)
    assert.equal(resolvedMerge(threeWayMerge(base, ours, theirs), {}), expected);
});

test('overlapping edits and simultaneous insertions need an explicit resolution', () => {
  for (const input of [
    ['a\nb\n', 'a\nours\nb\n', 'a\ntheirs\nb\n'],
    ['a\nb\n', 'a\n', 'a\nB\n'],
  ]) {
    const parts = threeWayMerge(...(input as [string, string, string]));
    assert.equal(parts.filter((part) => part.kind === 'conflict').length, 1);
    assert.throws(() => resolvedMerge(parts, {}), /冲突/);
    const choices = Object.fromEntries(
      parts.flatMap((part, index) => (part.kind === 'conflict' ? [[index, part.ours]] : [])),
    );
    assert.equal(resolvedMerge(parts, choices), input[1]);
  }
  assert.throws(() => threeWayMerge('a\0b', 'a', 'b'), /文本/);
  assert.throws(() => threeWayMerge('a\n'.repeat(2100), 'b\n'.repeat(2100), 'c\n'.repeat(2100)), /差异过大/);
});
