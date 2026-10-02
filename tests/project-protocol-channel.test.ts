import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { openProjectProtocolChannel } from '../server/project-protocol-stream.ts';
import type { Machines } from '../server/machines.ts';

function fixture() {
  const id = 'protocol-channel-model', live = {}, client = new EventEmitter();
  let callback: ((error: Error | undefined, wire: PassThrough) => void) | undefined, destroyed = false;
  const commands: string[] = [], transport = Object.assign(client, {
    exec: (command: string, ready: typeof callback) => { commands.push(command); callback = ready; },
    destroy: () => { if (!destroyed) { destroyed = true; client.emit('close'); } },
  });
  const machines = { live: new Map([[id, live]]), state: () => 'running', connect: async () => transport } as unknown as
    Pick<Machines, 'connect' | 'live' | 'state'>;
  return { id, live, client, commands, machines, callback: () => callback, destroyed: () => destroyed };
}
async function ready(f: ReturnType<typeof fixture>) {
  for (let n = 0; n < 100 && !f.callback(); ++n) await delay(1);
  assert.ok(f.callback()); return f.callback()!;
}

test('SSH exec setup retains cancellation after connect readiness and destroys a late channel', async () => {
  const f = fixture(), abort = new AbortController(); let registered = false;
  const pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live, abort.signal,
    async () => { registered = true; });
  const rejected = assert.rejects(pending, (error: Error) => error.name === 'AbortError');
  const callback = await ready(f); assert.equal(registered, true); abort.abort(); await rejected;
  assert.equal(f.destroyed(), true); const late = new PassThrough(); callback(undefined, late);
  assert.equal(late.destroyed, true); assert.deepEqual(f.commands, ['fixed-root-relay']);
});

test('SSH connection closure before exec acknowledgment rejects and never adopts a late channel', async () => {
  const f = fixture(), pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => {});
  const rejected = assert.rejects(pending, /应答前已关闭/), callback = await ready(f);
  f.client.emit('close'); await rejected; const late = new PassThrough(); callback(undefined, late);
  assert.equal(late.destroyed, true); assert.equal(f.destroyed(), true);
});

test('SSH exec setup deadline cancels a stalled durable launch callback without issuing a command', async () => {
  const f = fixture(); let unblock!: () => void, entering!: () => void;
  const entered = new Promise<void>(resolve => { entering = resolve; });
  const pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => { entering(); await new Promise<void>(resolve => { unblock = resolve; }); }, 20);
  const rejected = assert.rejects(pending, (error: any) => error.status === 408);
  await entered; await rejected; assert.equal(f.destroyed(), true); assert.deepEqual(f.commands, []);
  unblock(); await delay(1); assert.deepEqual(f.commands, []);
});

test('SSH exec setup refuses a live replacement before any durable launch callback', async () => {
  const f = fixture(); let launched = false;
  f.machines.connect = async () => { f.machines.live.set(f.id, {} as never); return f.client as never; };
  await assert.rejects(openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => { launched = true; }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(launched, false); assert.deepEqual(f.commands, []); assert.equal(f.destroyed(), true);
});

test('SSH exec acknowledgment rechecks original live and closes an unaccepted channel', async () => {
  const f = fixture(), pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => {});
  const rejected = assert.rejects(pending, { code: 'PROJECT_IDENTITY_HOST_CHANGED' }), callback = await ready(f);
  f.machines.live.set(f.id, {} as never); const wire = new PassThrough(); callback(undefined, wire); await rejected;
  assert.equal(wire.destroyed, true); assert.equal(f.destroyed(), true);
});

test('accepted SSH channel cancels its setup deadline and closes both transport owners explicitly', async () => {
  const f = fixture(), pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => {}, 40);
  const callback = await ready(f), wire = new PassThrough(); callback(undefined, wire);
  const channel = await pending; await delay(50);
  assert.equal(channel.wire, wire); assert.equal(wire.destroyed, false); assert.equal(f.destroyed(), false);
  channel.close(); assert.equal(wire.destroyed, true); assert.equal(f.destroyed(), true);
});
