/** 烟雾验收：验证真实 QEMU/virtiofsd 后端与 Virtio-FS 设备的 QMP prelaunch。
 * Smoke acceptance for real QEMU/virtiofsd backend and Virtio-FS QMP prelaunch. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines, BootAttachment } from '../server/machines.ts';
import { vmBootProviders } from '../server/vm-lifetime.ts';

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
  /** 返回此夹具的固定实例记录，供 virtio-fs 配置检查而不读用户目录。
   * Return this fixture VM record for virtio-fs configuration checks without reading user state. */
  get: () => vm,
  /** 执行传入配置工作并返回 Promise；此单线程模型无需额外互斥，生产锁不由夹具代替。
   * Execute/return configuration work; this single-threaded model adds no mutex and does not replace production locking. */
  locked: async (_id: string, work: /** 兼容夹具的异步 withLock 工作原样执行并返回结果，仅复现正式调用约定，不在替身中另建互斥语义。
 * Execute asynchronous fixture withLock work unchanged and return its result, reproducing the formal calling convention without inventing mutex semantics in the stub. */ () => Promise<unknown>) => work(),
  /** 由本夹具 running 标志返回实例状态，使运行中修改拒绝可重复验证。
   * Derive VM state from the fixture running flag for repeatable running-modification denial checks. */
  state: () => running ? 'running' : 'stopped',
  /** running 为真时抛错，验证 virtio-fs 只能在停机边界配置。
   * Throw while running to verify virtio-fs configuration requires a stopped boundary. */
  requireStopped: () => { if (running) throw Error('running'); },
  /** 此模型会话保持解锁，提供无副作用检查回调；真实宿主权限仍由生产服务验证。
   * Supply a side-effect-free check for this always-unlocked model; production services still validate real host authority. */
  requireUnlocked: () => {},
} as unknown as Machines;
const service = new VirtioFsShares(machines);
let attachment: BootAttachment | undefined;
let qemu: ReturnType<typeof spawn> | undefined;
let sidecarExit: string | undefined;
try {
  await service.init();
  await service.action(id, { operation: 'configure',
    policy: { enabled: true, hostPath: share, readOnly: true } });
  running = true;
  machines.live.set(id, {} as never);
  attachment = await vmBootProviders(machines).find(([name]) => name === 'virtio-fs')![1].prepare(vm as never,
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
      status = await new Promise<string>(/** 通过本次 Unix QMP socket 先完成 greeting/capabilities 再 query-status，按行处理分片响应；得到正式 status 后结束连接，错误拒绝等待。
 * Use the owned Unix QMP socket to sequence greeting/capabilities before query-status, processing fragmented replies by line and ending after formal status, rejecting socket errors. */ (resolve, reject) => {
        const socket = createConnection(qmpSocket);
        let buffer = '', step = 0;
        socket.on('error', reject);
        socket.on('data', /** 积累 QMP 字节至完整行，用显式三阶段状态防止 greeting 或 capabilities 回包误作运行状态，成功 status 后关闭写端并兑现。
 * Accumulate QMP bytes to full lines and use three explicit stages so greeting/capability replies cannot masquerade as VM status; end the socket and resolve after successful status. */ (chunk) => {
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
