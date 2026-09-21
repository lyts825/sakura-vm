import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponseOrder } from '../src/request-order.ts';

test('slow polling applies completed responses while the next interval is already pending', () => {
  const order = new ResponseOrder();
  let previous = order.start();
  for (let interval = 0; interval < 10; interval++) {
    const pending = order.start();
    assert.equal(order.accept(previous), true, 'a newer pending poll must not starve the UI');
    previous = pending;
  }
  assert.equal(order.accept(previous), true);
});

test('out-of-order success and error responses cannot replace a newer result', () => {
  const order = new ResponseOrder();
  const olderSuccess = order.start();
  const olderError = order.start();
  const newerSuccess = order.start();
  assert.equal(order.accept(newerSuccess), true);
  assert.equal(order.accept(olderError), false, 'an obsolete failure cannot mark a recovered app offline');
  assert.equal(order.accept(olderSuccess), false);
});

test('disposing a request owner invalidates all in-flight responses and permits a fresh lifecycle', () => {
  const order = new ResponseOrder();
  const old = order.start();
  const pending = order.start();
  order.invalidate();
  assert.equal(order.accept(old), false);
  assert.equal(order.accept(pending), false);
  assert.equal(order.accept(order.start()), true);
});
