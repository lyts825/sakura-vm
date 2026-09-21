import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreTerminals, terminalReducer } from '../src/terminal-state.ts';
import { completeFileSave } from '../src/file-editor-state.ts';

const threeTerminals = () =>
  restoreTerminals([
    { id: 'main', name: 'Main' },
    { id: 'build', name: 'Build' },
    { id: 'logs', name: 'Logs' },
  ]);

test('closing a terminal keeps the session selected while its close request was pending', () => {
  const before = threeTerminals();
  // The close of main starts here. The user selects logs before it completes.
  const selected = terminalReducer(before, { type: 'select', id: 'logs' });
  const closed = terminalReducer(selected, { type: 'close', id: 'main' });
  assert.equal(closed.active, 'logs');
  assert.deepEqual(
    closed.tabs.map((tab) => tab.id),
    ['build', 'logs'],
  );
});

test('closing an inactive terminal selected during the request selects a surviving session', () => {
  const before = threeTerminals();
  // Close logs while main is active, then select logs before the response.
  const selected = terminalReducer(before, { type: 'select', id: 'logs' });
  const closed = terminalReducer(selected, { type: 'close', id: 'logs' });
  assert.equal(closed.active, 'main');
  assert.ok(closed.tabs.some((tab) => tab.id === closed.active));
});

test('delayed close responses preserve newly created terminals and never remove the last pane', () => {
  let state = threeTerminals();
  state = terminalReducer(state, { type: 'add', id: 'new' });
  for (const id of ['logs', 'main', 'build']) state = terminalReducer(state, { type: 'close', id });
  assert.equal(state.active, 'new');
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    ['new'],
  );
  assert.equal(terminalReducer(state, { type: 'close', id: 'new' }), state);
});

test('rapid additions stop at eight tabs without selecting a nonexistent session', () => {
  let state = threeTerminals();
  for (let i = 0; i < 10; i++) state = terminalReducer(state, { type: 'add', id: `extra-${i}` });
  assert.equal(state.tabs.length, 8);
  assert.equal(state.active, 'extra-4');
});

test('invalid or duplicate persisted sessions recover to a usable main terminal', () => {
  for (const saved of [
    null,
    [],
    [null],
    [{ id: 123, name: 'Invalid id type' }],
    [{ id: 'bad/session', name: 'Invalid' }],
    [
      { id: 'main', name: 'Main' },
      { id: 'main', name: 'Duplicate' },
    ],
  ]) {
    assert.deepEqual(restoreTerminals(saved), {
      tabs: [{ id: 'main', name: '终端 1' }],
      active: 'main',
    });
  }
  assert.equal(threeTerminals().tabs.length, 3);
});

test('saving a new file preserves text typed before the response and permits the next save', () => {
  const submitted = { path: '/workspace/notes.txt', content: 'first draft', fresh: true };
  const typed = { ...submitted, content: 'first draft\nnew unsaved text' };
  const current = completeFileSave(typed, submitted);
  assert.equal(current?.content, typed.content);
  assert.equal(current?.fresh, false, 'the file now exists, so a later save can overwrite it');
  assert.equal(completeFileSave(submitted, submitted), null, 'an unchanged saved editor can close');
});

test('a completed file save cannot dismiss a different draft or reopen a closed editor', () => {
  const submitted = { path: '/workspace/first.txt', content: 'first', fresh: true };
  const next = { path: '/workspace/second.txt', content: 'second', fresh: true };
  assert.equal(completeFileSave(next, submitted), next);
  assert.equal(completeFileSave(null, submitted), null);
});
