import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Machines } from '../server/machines.ts';
import { UsbHotplug } from '../server/usb-hotplug.ts';
import type { qmp } from '../server/qmp.ts';

test('USB rules reapply after a VM restart and manual devices remain temporary', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-usb-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const fake = Object.assign(new EventEmitter(), {
    live: new Map<string, { status: string; startedAt: string; qmpPort: number }>(
      [[vmId, { status: 'running', startedAt: 'boot-1', qmpPort: 1234 }]]),
    get(id: string) {
      if (id !== vmId) throw new Error('Unknown VM');
      return { architecture: 'x86_64' };
    },
    state(id: string) { return this.live.has(id) ? 'running' : 'stopped'; },
    requireUnlocked() {},
    incidentLocked() { return false; },
  }) as unknown as Machines;
  const execute = (async (_port: number, command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return command === 'human-monitor-command' ? 'Device 1.2, USB device 1234:5678' : {};
  }) as typeof qmp;
  const file = join(root, 'usb.json');
  const usb = new UsbHotplug(fake, file, undefined, undefined, execute);
  await usb.init();
  try {
    let view = await usb.action(vmId, { operation: 'save-rule', vendorId: 0x1234, productId: 0x5678 });
    assert.equal(view.rules.length, 1);
    assert.equal(view.configured.length, 1);
    assert.equal(calls.filter((call) => call.command === 'device_add').length, 1);
    const ruleId = view.rules[0].id;
    view = await usb.action(vmId, { operation: 'detach', deviceId: view.configured[0].id });
    assert.equal(view.configured.length, 0);
    assert.equal(view.rules.length, 1);
    view = await usb.action(vmId, { operation: 'attach', vendorId: 0xabcd, productId: 0x0102 });
    assert.equal(view.configured.length, 1);
    fake.live.get(vmId)!.startedAt = 'boot-2';
    await usb.reconcile();
    view = await usb.view(vmId);
    assert.equal(view.configured.length, 1);
    assert.equal(view.configured[0].ruleId, ruleId);
    assert.equal(calls.filter((call) => call.command === 'device_add').length, 3);
    assert.equal(view.hostDevices.includes('1234:5678'), true);
    await assert.rejects(usb.action(vmId, { operation: 'attach', vendorId: 0, productId: 1 }));
    view = await usb.action(vmId, { operation: 'remove-rule', id: ruleId });
    assert.equal(view.rules.length, 0);
    assert.equal(view.configured.length, 0);
    assert.equal(calls.filter((call) => call.command === 'device_del').length, 2);
  } finally { await usb.close(); }
  const resumed = new UsbHotplug(fake, file, undefined, undefined, execute);
  await resumed.init();
  try {
    const view = await resumed.view(vmId);
    assert.equal(view.rules.length, 0);
    assert.ok(view.events.length >= 5);
  } finally { await resumed.close(); }
});

test('USB forwarding records a QMP failure without claiming a configured device', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-usb-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const fake = Object.assign(new EventEmitter(), {
    live: new Map<string, { status: string; startedAt: string; qmpPort: number }>(
      [[vmId, { status: 'running', startedAt: 'boot-1', qmpPort: 1234 }]]),
    get() { return { architecture: 'x86_64' }; },
    state() { return 'running'; },
    requireUnlocked() {},
    incidentLocked() { return false; },
  }) as unknown as Machines;
  const execute = (async (_port: number, command: string) => {
    if (command === 'device_add') throw new Error('physical device unavailable');
    return '';
  }) as typeof qmp;
  const usb = new UsbHotplug(fake, join(root, 'usb.json'), undefined, undefined, execute);
  await usb.init();
  try {
    await assert.rejects(usb.action(vmId,
      { operation: 'save-rule', vendorId: 0x1234, productId: 0x5678 }), /physical device unavailable/);
    const view = await usb.view(vmId);
    assert.equal(view.rules.length, 1);
    assert.equal(view.configured.length, 0);
    assert.equal(view.events[0].status, 'failed');
    assert.match(view.events[0].error || '', /physical device unavailable/);
  } finally { await usb.close(); }
});
