import { hostProcess } from './host-process.ts';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { BootAttachment } from './machines.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, ROOT } from './paths.ts';
import { type VMRecord } from '../shared/contracts/vm.ts';
import { quote } from './shell.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import { processSupervisor, type ManagedHelper } from './process-supervisor.ts';

type BinaryResult = { ok: boolean; output: string };
type BinaryProbe = (file: string, args: string[]) => Promise<BinaryResult>;
type Paths = { qemu: string; virtiofsd: string };
export const virtioFsPaths = (architecture: string): Paths => {
  const root = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  const installedDaemon =
    process.platform === 'linux'
      ? ['/usr/libexec/virtiofsd', '/usr/lib/qemu/virtiofsd'].find(existsSync)
      : undefined;
  return {
    qemu: join(
      root,
      `qemu-system-${architecture === 'aarch64' ? 'aarch64' : 'x86_64'}${process.platform === 'win32' ? '.exe' : ''}`,
    ),
    virtiofsd: process.env.SAKURA_VIRTIOFSD_PATH || installedDaemon || 'virtiofsd',
  };
};
const binaryProbe: BinaryProbe = async (file, args) => {
  try {
    const result = await hostProcess('virtio-fs-probe', file, args, { timeout: 5000, maxBuffer: 256 * 1024 });
    return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    if (error instanceof AppError && error.status === 503) throw error;
    return { ok: false, output: '' };
  }
};

export const guestVirtioFsScript = `set +e
printf 'VIRTIOFS='; if grep -qw virtiofs /proc/filesystems; then echo yes; else echo no; fi
printf '9P='; if grep -qw 9p /proc/filesystems; then echo yes; else echo no; fi
awk '($3=="virtiofs" || $3=="9p") {print "MOUNT=" $2 "|" $3 "|" $1}' /proc/mounts
`;

export async function probeVirtioFsHost(
  architecture: string,
  paths?: Paths,
  probe: BinaryProbe = binaryProbe,
) {
  const binaries = paths || virtioFsPaths(architecture);
  const [devices, memory, daemon] = await Promise.all([
    probe(binaries.qemu, ['-device', 'help']),
    probe(binaries.qemu, ['-object', 'help']),
    probe(binaries.virtiofsd, ['--version']),
  ]);
  return {
    platform: process.platform,
    qemuVirtioFs: devices.ok && /\bvhost-user-fs-pci\b/.test(devices.output),
    qemuNineP: devices.ok && /\bvirtio-9p-(?:pci|device)\b/.test(devices.output),
    sharedMemory: memory.ok && /\bmemory-backend-memfd\b/.test(memory.output),
    virtiofsd: daemon.ok,
  };
}

export async function inspectVirtioFs(
  machines: Machines,
  id: string,
  signal?: AbortSignal,
  paths?: Paths,
  probe: BinaryProbe = binaryProbe,
) {
  const vm = machines.get(id);
  signal?.throwIfAborted();
  const host = await probeVirtioFsHost(vm.architecture || 'x86_64', paths, probe);
  signal?.throwIfAborted();
  let guest: {
    virtioFsDriver: boolean;
    ninePDriver: boolean;
    mounts: Array<{ path: string; type: string; tag: string }>;
  } | null = null;
  if (machines.state(id) === 'running') {
    const result = await machines.exec(id, guestVirtioFsScript, 10000, signal);
    if (result.code === 0) {
      guest = {
        virtioFsDriver: /^VIRTIOFS=yes$/m.test(result.stdout),
        ninePDriver: /^9P=yes$/m.test(result.stdout),
        mounts: result.stdout
          .split(/\r?\n/)
          .filter((line) => line.startsWith('MOUNT='))
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
  const mounted =
    guest?.mounts.some(
      (item) => item.type === 'virtiofs' && item.path === VIRTIOFS_GUEST_PATH && item.tag === VIRTIOFS_TAG,
    ) || false;
  if (!mounted) blockers.push('客户机尚未确认 Sakura Virtio-FS 挂载。');
  return {
    ready: blockers.length === 0,
    executed: false,
    checkedAt: new Date().toISOString(),
    host,
    guest,
    blockers,
    reason: blockers[0],
    message: '检查真实 Virtio-FS 挂载；SSHFS 宿主目录挂载不计入结果。',
  };
}

export const VIRTIOFS_TAG = 'sakura-host';
export const VIRTIOFS_GUEST_PATH = '/mnt/sakura-virtiofs';
const policySchema = z
  .object({ enabled: z.boolean(), hostPath: z.string().max(1024), readOnly: z.boolean() })
  .strict();
type Policy = z.infer<typeof policySchema>;
export const virtioFsRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('mount') }).strict(),
  z.object({ operation: z.literal('unmount') }).strict(),
]);
type Observation = { at: string; mounted: boolean; error?: string };
type Active = { boot: object; close: () => Promise<void> };

export function virtioFsArguments(vm: Pick<VMRecord, 'memoryMiB'>, socketPath: string) {
  const escape = (value: string) => value.replaceAll(',', ',,');
  return [
    '-object',
    `memory-backend-memfd,id=sakura-vfs-mem,size=${vm.memoryMiB}M,share=on`,
    '-numa',
    'node,memdev=sakura-vfs-mem',
    '-chardev',
    `socket,id=sakura-vfs,path=${escape(socketPath)}`,
    '-device',
    `vhost-user-fs-pci,chardev=sakura-vfs,tag=${VIRTIOFS_TAG},queue-size=1024`,
  ];
}

export class VirtioFsShares {
  private unregisterBoot?: () => void;
  private policies: Record<string, Policy> = {};
  private active = new Map<string, Active>();
  private observations = new Map<string, Observation>();
  private tasks = new Map<string, Promise<unknown>>();
  private writes = Promise.resolve();
  private timer?: ScheduleHandle;
  private tick?: Promise<void>;
  private closed = false;
  private lifetime = new AbortController();
  private starting = new Set<Promise<BootAttachment | undefined>>();
  constructor(
    private machines: Machines,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
  ) {}

  async init() {
    this.policies = z
      .record(z.uuid(), policySchema)
      .parse(await readStore(join(DATA, 'virtio-fs.json'), () => ({})));
    this.unregisterBoot = registerVmBootProvider(this.machines, 'virtio-fs', { prepare: (vm, onExit) => {
      const task = this.prepare(vm, onExit);
      this.starting.add(task);
      void task.finally(() => this.starting.delete(task)).catch(() => {});
      return task;
    } });
    this.timer = scheduler.register({ owner: 'core:virtio-fs', label: 'Virtio-FS 共享目录状态校准', intervalMs: 10000,
      overlap: 'skip', run: async () => {
      if (!this.tick && !this.closed)
        this.tick = this.reconcile().finally(() => {
          this.tick = undefined;
        });
      await this.tick;
    } });
  }

  private locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tasks.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    this.tasks.set(id, task);
    void task
      .finally(() => {
        if (this.tasks.get(id) === task) this.tasks.delete(id);
      })
      .catch(() => {});
    return task;
  }

  private async validHostPath(path: string) {
    const resolved = await regularDirectory(path);
    if (!(await lstat(resolved).catch(() => null))?.isDirectory())
      throw new AppError('宿主共享目录不存在', 400);
    if (within(resolved, DATA) || within(DATA, resolved))
      throw new AppError('不能共享 Sakura 数据目录或其上级目录', 403);
    return resolved;
  }

  private async save(id: string, policy: Policy) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const next = { ...this.policies, [id]: policy };
        await writeStore(join(DATA, 'virtio-fs.json'), next);
        this.policies = next;
      });
    this.writes = operation;
    await operation;
  }

  private async prepare(vm: VMRecord, onExit: (error: string) => void): Promise<BootAttachment | undefined> {
    const policy = this.policies[vm.id];
    if (!policy?.enabled) return undefined;
    if (this.closed || this.blocked()) throw new AppError('Virtio-FS 暂不可启动', 409);
    if (process.platform !== 'linux' || vm.architecture === 'aarch64')
      throw new AppError('Virtio-FS 目前需要 Linux x86_64 宿主和客户机', 503);
    if (vm.hardware?.cpu?.numa || vm.hardware?.memory)
      throw new AppError('当前 Virtio-FS 配置不能与 NUMA 或内存热插拔同时使用', 409);
    const hostPath = await this.validHostPath(policy.hostPath);
    const host = await probeVirtioFsHost('x86_64');
    if (!host.qemuVirtioFs || !host.sharedMemory || !host.virtiofsd)
      throw new AppError('宿主 QEMU 或 virtiofsd 缺少 Virtio-FS 启动组件', 503);
    const dir = await mkdtemp(join(tmpdir(), 'sakura-vfs-'));
    const socketPath = join(dir, 'fs.sock');
    const boot = this.machines.live.get(vm.id);
    let daemon: ManagedHelper | undefined, cleanup: Promise<void> | undefined;
    const close = () =>
      (cleanup ||= (async () => {
        await daemon?.close();
        await rm(dir, { recursive: true, force: true });
      })().catch((error) => {
        cleanup = undefined;
        throw error;
      }));
    try {
      daemon = await processSupervisor.helper({
        owner: `vm:${vm.id}`,
        helper: 'virtiofsd',
        label: 'Virtio-FS',
        file: virtioFsPaths('x86_64').virtiofsd,
        args: [
          '--socket-path',
          socketPath,
          '--shared-dir',
          hostPath,
          ...(policy.readOnly ? ['--readonly'] : []),
        ],
        signal: AbortSignal.any([this.lifetime.signal, ...(boot?.abort ? [boot.abort.signal] : [])]),
        onExit: ({ code, signal, failure }) => onExit(failure || `exit=${code}, signal=${signal}`),
      });
      await daemon.ready(async () => !!(await lstat(socketPath).catch(() => null))?.isSocket());
      if (this.closed || this.machines.live.get(vm.id) !== boot) throw new AppError('实例启动已取消', 409);
      const active: Active = { boot: boot!, close };
      this.active.set(vm.id, active);
      this.observations.set(vm.id, { at: new Date().toISOString(), mounted: false });
      return {
        args: virtioFsArguments(vm, socketPath),
        close: async () => {
          await close();
          if (this.active.get(vm.id) === active) this.active.delete(vm.id);
        },
      };
    } catch (error) {
      try {
        await close();
      } catch (cleanupError) {
        this.active.set(vm.id, { boot: boot!, close });
        throw cleanupError;
      }
      throw error;
    }
  }

  private async guestMount(id: string) {
    const result = await this.machines.exec(
      id,
      `awk '$2=="${VIRTIOFS_GUEST_PATH}" {print $1 "|" $3; exit}' /proc/mounts`,
      10_000,
    );
    if (result.code !== 0) throw new AppError('无法读取客户机挂载状态', 502);
    return result.stdout.trim();
  }

  private isActive(id: string) {
    const active = this.active.get(id);
    return !!active && active.boot === this.machines.live.get(id) && this.machines.state(id) === 'running';
  }

  async view(id: string) {
    this.machines.get(id);
    const policy = this.policies[id] || { enabled: false, hostPath: '', readOnly: true };
    return {
      policy,
      guestPath: VIRTIOFS_GUEST_PATH,
      tag: VIRTIOFS_TAG,
      stopped: this.machines.state(id) === 'stopped',
      running: this.machines.state(id) === 'running',
      attached: this.isActive(id),
      mounted: this.isActive(id) && !!this.observations.get(id)?.mounted,
      observation: this.observations.get(id) || null,
    };
  }

  async action(id: string, raw: unknown) {
    const input = virtioFsRequest.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    try {
      await this.locked(id, async () => {
        if (input.operation === 'configure') {
          await this.machines.locked(id, async () => {
            this.machines.requireStopped(id);
            if (input.policy.enabled) {
              if (process.platform !== 'linux' || vm.architecture === 'aarch64')
                throw new AppError('Virtio-FS 目前需要 Linux x86_64 宿主和客户机', 503);
              if (vm.hardware?.cpu?.numa || vm.hardware?.memory)
                throw new AppError('当前 Virtio-FS 配置不能与 NUMA 或内存热插拔同时使用', 409);
              const host = await probeVirtioFsHost('x86_64');
              if (!host.qemuVirtioFs || !host.sharedMemory || !host.virtiofsd)
                throw new AppError('宿主 QEMU 或 virtiofsd 缺少 Virtio-FS 启动组件', 503);
              input.policy.hostPath = await this.validHostPath(input.policy.hostPath);
            }
            await this.save(id, input.policy);
          });
        } else if (input.operation === 'mount') {
          await this.mount(id);
        } else {
          if (
            this.machines.state(id) === 'running' &&
            this.isActive(id) &&
            (await this.guestMount(id)) === `${VIRTIOFS_TAG}|virtiofs`
          ) {
            const result = await this.machines.exec(id, `umount ${quote(VIRTIOFS_GUEST_PATH)}`, 15_000);
            if (result.code !== 0) throw new AppError(result.stderr || 'Virtio-FS 卸载失败', 502);
          }
          if (this.policies[id]) await this.save(id, { ...this.policies[id], enabled: false });
          this.observations.set(id, { at: new Date().toISOString(), mounted: false });
        }
      });
      return this.view(id);
    } catch (error) {
      this.observations.set(id, {
        at: new Date().toISOString(),
        mounted: false,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.mutation(-1);
    }
  }

  private async mount(id: string) {
    if (!this.policies[id]?.enabled) throw new AppError('请先启用 Virtio-FS 策略', 409);
    if (!this.isActive(id)) throw new AppError('请重启实例以附加 Virtio-FS 设备', 409);
    const current = await this.guestMount(id);
    if (current && current !== `${VIRTIOFS_TAG}|virtiofs`)
      throw new AppError(`${VIRTIOFS_GUEST_PATH} 已挂载其他文件系统`, 409);
    if (!current) {
      const prepared = await this.machines.exec(
        id,
        `mkdir -p ${quote(VIRTIOFS_GUEST_PATH)}; grep -qw virtiofs /proc/filesystems || modprobe virtiofs`,
        10_000,
      );
      if (prepared.code !== 0) throw new AppError(prepared.stderr || '客户机缺少 virtiofs 驱动', 502);
      const command =
        `mount -t virtiofs ${this.policies[id].readOnly ? '-o ro ' : ''}` +
        `${VIRTIOFS_TAG} ${quote(VIRTIOFS_GUEST_PATH)}`;
      const result = await this.machines.exec(id, command, 30_000);
      if (result.code !== 0) throw new AppError(result.stderr || 'Virtio-FS 挂载失败', 502);
    }
    if ((await this.guestMount(id)) !== `${VIRTIOFS_TAG}|virtiofs`)
      throw new AppError('客户机未确认 Virtio-FS 挂载', 502);
    this.observations.set(id, { at: new Date().toISOString(), mounted: true });
  }

  private async reconcile() {
    if (this.blocked()) return;
    for (const [id, policy] of Object.entries(this.policies)) {
      if (this.closed) return;
      if (!policy.enabled || !this.machines.records.has(id) || !this.isActive(id) || this.tasks.has(id))
        continue;
      const observed = this.observations.get(id);
      if (observed?.error && Date.now() - Date.parse(observed.at) < 60_000) continue;
      await this.locked(id, async () => {
        if ((await this.guestMount(id)) === `${VIRTIOFS_TAG}|virtiofs`) {
          this.observations.set(id, { at: new Date().toISOString(), mounted: true });
          return;
        }
        await this.mount(id);
      }).catch((error) =>
        this.observations.set(id, {
          at: new Date().toISOString(),
          mounted: false,
          error: (error as Error).message,
        }),
      );
    }
  }

  async close() {
    this.closed = true;
    this.lifetime.abort();
    await this.timer?.close();
    await this.tick;
    await Promise.allSettled([...this.tasks.values()]);
    await this.writes;
    await Promise.allSettled([...this.starting]);
    // Machines closes its live QEMU processes after service cleanup.
    const cleanup = await Promise.allSettled(
      [...this.active].map(async ([id, entry]) => {
        await entry.close();
        if (this.active.get(id) === entry) this.active.delete(id);
      }),
    );
    this.unregisterBoot?.();
    const failed = cleanup.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (failed.length) throw new AggregateError(failed, 'Virtio-FS 进程清理尚未确认');
  }
}
import { registerVmBootProvider } from './vm-lifetime.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
