import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGpuAcceleration, runGpuAcceleration } from '../server/gpu-acceleration.ts';
import type { Machines } from '../server/machines.ts';

test('GPU readiness rejects a software renderer even when EGL exits successfully', async () => {
  const machines = {
    get: () => ({ hardware: { devices: { graphics: 'virgl' } } }),
    state: () => 'running',
    exec: async () => ({ code: 0, stdout: 'OpenGL renderer: llvmpipe (LLVM 21)\n', stderr: '' }),
  } as unknown as Machines;
  const result = await checkGpuAcceleration(machines, 'vm');
  assert.equal(result.ready, false);
  assert.match(result.reason, /不是 VirGL/);
});

test('GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent', async () => {
  const commands: string[] = [];
  const machines = {
    get: () => ({ hardware: { devices: { graphics: 'virgl' } } }),
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: command.includes('eglinfo') ?
        'GBM platform:\nEGL API version: 1.4\nEGL driver name: virtio_gpu\n' : '', stderr: '' };
    },
  } as unknown as Machines;
  const result = await checkGpuAcceleration(machines, 'vm');
  assert.equal(result.ready, true);
  assert.equal(result.verifiedBy, 'gbm-driver-and-virgl-device');
  assert.ok(commands.some((command) => command.includes('features: +virgl')));
});

test('GPU readiness does not accept software renderer from a VirGL capable device', async () => {
  const machines = {
    get: () => ({ hardware: { devices: { graphics: 'virgl' } } }),
    state: () => 'running',
    exec: async (_id: string, command: string) => ({ code: 0,
      stdout: command.includes('eglinfo') ?
        'GBM platform:\nEGL API version: 1.4\nEGL driver name: virtio_gpu\nrenderer: llvmpipe\n' : '',
      stderr: '' }),
  } as unknown as Machines;
  const result = await checkGpuAcceleration(machines, 'vm');
  assert.equal(result.ready, false);
});

test('VirGL setup only runs for a configured, running instance', async () => {
  let calls = 0;
  let graphics: 'none' | 'virgl' = 'none';
  const machines = {
    get: () => ({ hardware: { devices: { graphics } } }),
    state: () => 'running',
    requireUnlocked: () => {},
    exec: async () => {
      calls++;
      return { code: 0, stdout: 'OpenGL renderer: virgl (host GPU)\n', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(runGpuAcceleration(machines, 'vm', { mode: 'install-mesa' }), /选择 VirGL/);
  assert.equal(calls, 0);
  graphics = 'virgl';
  const result = await runGpuAcceleration(machines, 'vm', { mode: 'install-mesa' });
  assert.equal(result.ready, true);
  assert.equal(result.executed, true);
  assert.equal(calls, 3);
});
