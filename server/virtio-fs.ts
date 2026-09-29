import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { Machines } from './machines.ts';
import { ROOT } from './model.ts';

type BinaryResult = { ok: boolean; output: string };
type BinaryProbe = (file: string, args: string[]) => Promise<BinaryResult>;
type Paths = { qemu: string; virtiofsd: string };
const defaultPaths = (architecture: string): Paths => {
  const root = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  return {
    qemu: join(root, `qemu-system-${architecture === 'aarch64' ? 'aarch64' : 'x86_64'}${process.platform === 'win32' ? '.exe' : ''}`),
    virtiofsd: process.env.SAKURA_VIRTIOFSD_PATH || 'virtiofsd',
  };
};
const binaryProbe: BinaryProbe = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true },
    (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}\n${stderr}` }));
});

export const guestVirtioFsScript = `set +e
printf 'VIRTIOFS='; if grep -qw virtiofs /proc/filesystems; then echo yes; else echo no; fi
printf '9P='; if grep -qw 9p /proc/filesystems; then echo yes; else echo no; fi
awk '($3=="virtiofs" || $3=="9p") {print "MOUNT=" $2 "|" $3 "|" $1}' /proc/mounts
`;

export async function inspectVirtioFs(machines: Machines, id: string,
  signal?: AbortSignal, paths?: Paths, probe: BinaryProbe = binaryProbe) {
  const vm = machines.get(id);
  const binaries = paths || defaultPaths(vm.architecture || 'x86_64');
  signal?.throwIfAborted();
  const [devices, memory, daemon] = await Promise.all([
    probe(binaries.qemu, ['-device', 'help']),
    probe(binaries.qemu, ['-object', 'help']),
    probe(binaries.virtiofsd, ['--version']),
  ]);
  signal?.throwIfAborted();
  const host = {
    platform: process.platform,
    qemuVirtioFs: devices.ok && /\bvhost-user-fs-(?:pci|device)\b/.test(devices.output),
    qemuNineP: devices.ok && /\bvirtio-9p-(?:pci|device)\b/.test(devices.output),
    sharedMemory: memory.ok && /\bmemory-backend-(?:memfd|shm)\b/.test(memory.output),
    virtiofsd: daemon.ok,
  };
  let guest: { virtioFsDriver: boolean; ninePDriver: boolean;
    mounts: Array<{ path: string; type: string; tag: string }> } | null = null;
  if (machines.state(id) === 'running') {
    const result = await machines.exec(id, guestVirtioFsScript, 10000, signal);
    if (result.code === 0) {
      guest = {
        virtioFsDriver: /^VIRTIOFS=yes$/m.test(result.stdout),
        ninePDriver: /^9P=yes$/m.test(result.stdout),
        mounts: result.stdout.split(/\r?\n/).filter((line) => line.startsWith('MOUNT='))
          .map((line) => line.slice(6).split('|'))
          .filter((parts) => parts.length === 3)
          .map(([path, type, tag]) => ({ path, type, tag })),
      };
    }
  }
  const blockers: string[] = [];
  if (host.platform !== 'linux') blockers.push('当前宿主平台未提供 Sakura 支持的 Virtio-FS 后端流程。');
  if (!host.qemuVirtioFs) blockers.push('当前 QEMU 构建缺少 vhost-user-fs 设备。');
  if (!host.sharedMemory) blockers.push('当前 QEMU 构建缺少共享内存后端。');
  if (!host.virtiofsd) blockers.push('未找到 virtiofsd 守护程序。');
  if (!guest) blockers.push('客户机未运行或无法读取文件系统证据。');
  else if (!guest.virtioFsDriver) blockers.push('客户机内核未声明 virtiofs 文件系统。');
  blockers.push('尚未编排 virtiofsd、共享内存 QEMU 设备、宿主目录策略和客户机挂载。');
  return {
    ready: false, executed: false, checkedAt: new Date().toISOString(),
    host, guest, blockers, reason: blockers[0],
    message: '只读检查；已有的 SSHFS 宿主目录挂载不等同于 Virtio-FS。',
  };
}
