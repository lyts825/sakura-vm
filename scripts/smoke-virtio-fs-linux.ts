import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from '../server/machines.ts';

if (process.platform !== 'linux') {
  console.log('Virtio-FS backend smoke requires Linux; skipped.');
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), 'sakura-vfs-real-'));
process.env.SAKURA_DATA_DIR = join(root, 'data');
process.env.SAKURA_QEMU_DIR ||= '/usr/bin';
const { VirtioFsShares, virtioFsPaths } = await import('../server/virtio-fs.ts');
const share = join(root, 'share');
await mkdir(share);
const id = 'c3915729-d526-4c60-9224-df29862864f3';
const vm = { id, memoryMiB: 512, architecture: 'x86_64' };
let running = false;
const machines = {
  records: new Map([[id, vm]]), live: new Map<string, object>(),
  get: () => vm,
  state: () => running ? 'running' : 'stopped',
  requireStopped: () => { if (running) throw Error('running'); },
  requireUnlocked: () => {},
} as unknown as Machines;
const service = new VirtioFsShares(machines);
let attachment: Awaited<ReturnType<NonNullable<Machines['prepareBootAttachment']>>>;
let qemu: ReturnType<typeof spawn> | undefined;
let sidecarExit: string | undefined;
try {
  await service.init();
  await service.action(id, { operation: 'configure',
    policy: { enabled: true, hostPath: share, readOnly: true } });
  running = true;
  machines.live.set(id, {} as never);
  attachment = await machines.prepareBootAttachment!(vm as never,
    (error) => { sidecarExit = error; });
  assert.ok(attachment);
  const qmpSocket = join(root, 'qmp.sock');
  const args = ['-machine', 'q35', '-accel', 'tcg', '-m', '512', '-smp', '1',
    '-nodefaults', '-display', 'none', '-S', ...attachment.args,
    '-qmp', `unix:${qmpSocket},server=on,wait=off`];
  qemu = spawn(virtioFsPaths('x86_64').qemu, args,
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  qemu.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  let status: string | undefined;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !status) {
    if (qemu.exitCode !== null) throw new Error(stderr || `QEMU exited ${qemu.exitCode}`);
    try {
      status = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(qmpSocket);
        let buffer = '', step = 0;
        socket.on('error', reject);
        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          for (;;) {
            const end = buffer.indexOf('\n');
            if (end < 0) break;
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const value = JSON.parse(line) as { QMP?: object; return?: { status?: string } };
            if (step === 0 && value.QMP) {
              step = 1;
              socket.write('{"execute":"qmp_capabilities"}\n');
            } else if (step === 1 && value.return) {
              step = 2;
              socket.write('{"execute":"query-status"}\n');
            } else if (step === 2 && value.return?.status) {
              socket.end();
              resolve(value.return.status);
            }
          }
        });
      });
    } catch {
      await delay(100);
    }
  }
  assert.equal(status, 'prelaunch', stderr || 'QEMU did not start the Virtio-FS backend');
  assert.equal(sidecarExit, undefined);
  console.log('Real QEMU and virtiofsd reached QMP prelaunch with the Virtio-FS device.');
} finally {
  qemu?.kill('SIGTERM');
  if (qemu && qemu.exitCode === null) {
    const stopped = new Promise<void>((resolve) => qemu!.once('close', () => resolve()));
    await Promise.race([stopped, delay(2000)]);
    if (qemu.exitCode === null) {
      qemu.kill('SIGKILL');
      await stopped;
    }
  }
  await attachment?.close();
  await service.close();
  await rm(root, { recursive: true, force: true });
}
