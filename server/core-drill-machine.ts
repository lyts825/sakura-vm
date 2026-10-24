/** 本体演练适配：真实所有者、原 VM 进程、固定客户机资产与跨配置互斥。
 * Core drill adapter for original ownership/process identity, fixed assets, and VM/project exclusion. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { OwnedImageVm } from '../shared/contracts/image-assets.ts';
import {
  drillIdentitySchema,
  drillPreparationSchema,
  drillParametersSchema,
  type DrillIdentity,
  type DrillPreparation,
} from '../shared/contracts/drill-supervision.ts';
import type { DrillMachinePort, DrillGuestAction } from './drill-machine-port.ts';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import type { Live } from './vm-state.ts';
import { assertImageDrillOwnership } from './image-assets.ts';
import { resourceContext } from './host-runtime/context.ts';
import { vmLiveIdentity } from './vm-reference.ts';
import { captureVmExclusive, vmLifetime } from './vm-lifetime.ts';
import { qemuProcessPin, windowsOriginalProcessStopped } from './vm-process-pin.ts';
import { vmDir } from './paths.ts';
import { quote } from './shell.ts';
import type { CoreDrillValidation } from './core-drill-validation.ts';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (message: string): never => {
  throw new AppError(message, 409, 'DRILL_IDENTITY_CHANGED');
};
const assetPath = '/usr/local/lib/sakura/drill-guest.py';
type Prepared = {
  identity: DrillIdentity;
  receipt: OwnedImageVm;
  live: Live;
  runId: string;
  toolDigest: string;
};
type Reservation = {
  identity: DrillIdentity;
  release: () => void;
  done: Promise<void>;
  enter: ReturnType<typeof captureVmExclusive>;
};

export class CoreDrillMachine implements DrillMachinePort {
  readonly generation = randomUUID();
  private prepared = new Map<string, Prepared>();
  private reservations = new Map<string, Reservation>();
  constructor(
    private machines: VmAccess,
    private workspaces: () => WorkspacesV1,
    private directory: PluginDirectory,
    private validation: CoreDrillValidation,
  ) {}

  /** 解析当前真实消费者；缺少服务上下文时拒绝，而不猜测调用者。
   * Resolve the current real consumer, rejecting calls without broker identity. */
  caller() {
    const context = resourceContext();
    const identity = context?.serviceConsumerPluginInstanceId,
      generation = context?.serviceConsumerPluginGeneration;
    if (!identity || !generation) return fail('演练调用缺少原消费者与激活代次');
    const current = this.consumer(identity.replace(/^official:/, ''));
    if (current.identity !== identity || current.generation !== generation) return fail('演练消费者已失效');
    return { identity, generation };
  }
  consumer(pluginId: string) {
    if (!/^resilience-(fixtures|guard|faults|probes|recovery)$/.test(pluginId))
      return fail('消费者不属于演练控制域');
    const instance = this.directory.get('official', pluginId);
    if (!instance) return fail('演练消费者未启用');
    instance.check();
    return { identity: instance.identity, generation: instance.generation };
  }
  async assertOwnership(receipt: OwnedImageVm, consumerIdentity: string) {
    await assertImageDrillOwnership(this.machines, receipt, consumerIdentity);
  }
  async confirmStopped(identity: DrillIdentity) {
    const pinned = drillIdentitySchema.parse(identity);
    return windowsOriginalProcessStopped(pinned.processId, pinned.processCreated);
  }
  private async project(vmId: string) {
    const workspaces = this.workspaces();
    return workspaces.projects.with(vmId, 'default', async () => {
      const config = await workspaces.readCommittedConfig(vmId);
      if (config.directory !== '/workspace/resilience') return fail('夹具必须使用本包独立项目目录');
      return digest(JSON.stringify(config));
    });
  }
  private async disk(vmId: string) {
    const info = await lstat(join(vmDir(vmId), 'disk.qcow2'), { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n)
      return fail('演练磁盘必须是独占普通文件');
    return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
  }
  private async boot(vmId: string) {
    const result = await this.machines.exec(vmId, 'cat /proc/sys/kernel/random/boot_id', 10000);
    if (result.code) return fail('客户机开机身份读取失败');
    return z.uuid().parse(result.stdout.trim());
  }
  private noShares(live: Live) {
    if (
      !live.processArguments ||
      live.processArguments.some((value) => /(?:virtfs|fsdev|vhost-user-fs|virtio-9p|virtiofs)/i.test(value))
    )
      return fail('演练禁止共享挂载或未知启动参数');
  }

  /** 预备只复制固定源码并建立合成资源；业务故障另由限权动作票据启动。
   * Install fixed code and synthetic resources only; fault injection needs a separate ticket. */
  async prepare(raw: DrillPreparation) {
    const input = drillPreparationSchema.parse(raw),
      id = input.replica.vmId;
    await this.assertOwnership(input.replica, this.caller().identity);
    await this.validation.ensureHost();
    return this.machines.locked(id, async () => {
      const live = this.machines.live.get(id);
      if (!live) return fail('演练实例没有运行');
      const original = vmLiveIdentity(live);
      this.noShares(original);
      if ((await this.project(id)) !== input.projectRevision) return fail('预备项目修订已变化');
      const pin = await qemuProcessPin(original);
      const identity = drillIdentitySchema.parse({
        vmId: id,
        createdAt: input.replica.createdAt,
        diskIdentity: await this.disk(id),
        processId: pin.pid,
        processCreated: pin.created,
        bootId: await this.boot(id),
        projectId: 'default',
        projectRevision: input.projectRevision,
        controllerGeneration: this.generation,
      });
      const source = await readFile(new URL('./drill-guest.py', import.meta.url));
      if (source.length > 256 * 1024) return fail('固定演练资产超过预算');
      const toolDigest = digest(source);
      const installer =
        `import os,sys,pathlib,hashlib,stat\np=pathlib.Path('${assetPath}')\n` +
        `for a in [pathlib.Path('/usr'),pathlib.Path('/usr/local'),pathlib.Path('/usr/local/lib'),p.parent]:\n` +
        ` a.mkdir(exist_ok=True);s=a.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022\n` +
        `b=sys.stdin.buffer.read(262145);assert len(b)<=262144 and hashlib.sha256(b).hexdigest()=='${toolDigest}'\n` +
        `try:\n f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o755);os.write(f,b);os.fsync(f);os.close(f)\n` +
        `except FileExistsError:\n s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and s.st_nlink==1;assert p.read_bytes()==b\n`;
      const installed = await this.machines.execInput(
        id,
        `python3 -I -S -c ${quote(installer)}`,
        source,
        15000,
      );
      if (installed.code)
        throw new AppError(
          '固定演练工具准备失败：' + installed.stderr.slice(-500),
          409,
          'DRILL_TOOL_UNAVAILABLE',
        );
      this.prepared.set(input.runId, {
        identity,
        receipt: input.replica,
        live: original,
        runId: input.runId,
        toolDigest,
      });
      original.abort.signal.addEventListener(
        'abort',
        () => {
          if (!this.reservations.has(input.runId)) this.prepared.delete(input.runId);
        },
        { once: true },
      );
      await this.assertIdentity(identity);
      const result = z
        .object({ ready: z.literal(true), bootId: z.uuid(), sampleDigest: z.string() })
        .strict()
        .parse(
          await this.execute(identity, 'prepare', {
            runId: input.runId,
            count: input.count,
            sampleDigest: input.sampleDigest,
            ...(input.restoreFrom ? { restoreFrom: input.restoreFrom } : {}),
          }),
        );
      if (result.bootId !== identity.bootId || result.sampleDigest !== input.sampleDigest)
        return fail('合成资源预备回执不符');
      // Exercise the fixed guest guardian with no fault before issuing any fault authority.
      const deadline = new Date(Date.now() + 1000).toISOString();
      const check =
        `import json,pathlib,runpy\nm=runpy.run_path('${assetPath}')\n` +
        `b=m['paths']('${input.runId}');m['guardian'](b,'${deadline}')\n` +
        `print(json.dumps(m['load'](b/'guardian-result.json')))\n`;
      const observed = await this.machines.execInput(
        id,
        `python3 -I -S -c ${quote(check)}`,
        Buffer.alloc(0),
        10000,
      );
      const guard = z
        .object({ at: z.iso.datetime(), effect: z.literal('absent'), detail: z.string() })
        .strict()
        .parse(JSON.parse(observed.stdout));
      if (
        observed.code ||
        Date.parse(guard.at) < Date.parse(deadline) ||
        Date.parse(guard.at) > Date.parse(deadline) + 5000
      )
        return fail('固定客户机监管截止校验失败');
      await this.assertIdentity(identity);
      this.validation.markGuestVerified();
      return identity;
    });
  }
  async assertIdentity(identity: DrillIdentity) {
    const reservation = [...this.reservations.values()].find(
      (row) => JSON.stringify(row.identity) === JSON.stringify(identity),
    );
    return reservation
      ? reservation.enter(() => this.verifyIdentity(identity))
      : this.verifyIdentity(identity);
  }
  private async verifyIdentity(identity: DrillIdentity) {
    drillIdentitySchema.parse(identity);
    const row = [...this.prepared.values()].find(
      (row) => JSON.stringify(row.identity) === JSON.stringify(identity),
    );
    const live = this.machines.live.get(identity.vmId);
    if (
      !row ||
      identity.controllerGeneration !== this.generation ||
      !live ||
      vmLiveIdentity(live) !== row.live ||
      row.live.abort.signal.aborted ||
      this.machines.get(identity.vmId).createdAt !== identity.createdAt
    )
      return fail('原演练 VM 或控制器身份已变化');
    this.noShares(row.live);
    if (
      (await this.disk(identity.vmId)) !== identity.diskIdentity ||
      (await this.project(identity.vmId)) !== identity.projectRevision ||
      (await this.boot(identity.vmId)) !== identity.bootId
    )
      return fail('原进程、磁盘、项目或客户机身份已变化');
    await this.assertOwnership(row.receipt, 'official:resilience-fixtures');
  }
  private async execute(identity: DrillIdentity, action: DrillGuestAction, input: Record<string, unknown>) {
    const row = this.prepared.get(String(input.runId));
    if (!row || JSON.stringify(identity) !== JSON.stringify(row.identity))
      return fail('动作不属于原预备运行');
    const command =
      `set -eu\n[ "$(sha256sum ${assetPath} | cut -d ' ' -f 1)" = '${row.toolDigest}' ]\n` +
      `exec python3 -I -S ${assetPath} ${action}`;
    const result = await this.machines.execInput(
      identity.vmId,
      command,
      Buffer.from(JSON.stringify(input)),
      30000,
    );
    if (result.code || Buffer.byteLength(result.stdout) > 65536)
      throw new AppError('固定演练动作失败：' + result.stderr.slice(-1000), 409, 'DRILL_GUEST_FAILED');
    return JSON.parse(result.stdout) as unknown;
  }
  async guest(
    identity: DrillIdentity,
    action: DrillGuestAction,
    raw: Parameters<DrillMachinePort['guest']>[2],
  ) {
    z.enum(['arm', 'inject', 'observe', 'withdraw', 'probe', 'restart', 'cleanup']).parse(action);
    const input = z
      .object({
        runId: z.uuid(),
        parameters: drillParametersSchema.optional(),
        faultDeadline: z.iso.datetime().optional(),
        requestId: z
          .string()
          .regex(/^[a-z0-9-]{1,100}$/)
          .optional(),
      })
      .strict()
      .parse(raw);
    const reservation = this.reservations.get(input.runId);
    if (!reservation || JSON.stringify(reservation.identity) !== JSON.stringify(identity))
      return fail('动作缺少原 VM 排他预约');
    return reservation.enter(async () => {
      await this.assertIdentity(identity);
      const result = await this.execute(identity, action, input);
      await this.assertIdentity(identity);
      return result;
    });
  }
  async reserve(identity: DrillIdentity, runId: string) {
    z.uuid().parse(runId);
    if (this.reservations.size) return fail('宿主已有未核销演练');
    await this.assertIdentity(identity);
    let unlock!: () => void, acquired!: () => void;
    const hold = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let enter!: ReturnType<typeof captureVmExclusive>;
    const done = this.machines.locked(identity.vmId, async () => {
      await this.assertIdentity(identity);
      enter = captureVmExclusive(vmLifetime(identity.vmId, this.prepared.get(runId)!.live));
      acquired();
      await hold;
    });
    await Promise.race([
      ready,
      done.then(() => {
        throw new Error('演练预约提前结束');
      }),
    ]);
    this.reservations.set(runId, { identity, release: unlock, done, enter });
    const original = this.prepared.get(runId)!.live;
    // Emergency stop and core shutdown may end the original run; the durable supervisor still owns cleanup evidence.
    original.abort.signal.addEventListener('abort', unlock, { once: true });
    if (original.abort.signal.aborted) unlock();
  }
  async release(identity: DrillIdentity, runId: string) {
    const reservation = this.reservations.get(runId);
    if (reservation) {
      if (JSON.stringify(reservation.identity) !== JSON.stringify(identity))
        return fail('不能释放另一运行的预约');
      reservation.release();
      await reservation.done;
      this.reservations.delete(runId);
    }
    this.prepared.delete(runId);
  }
}
