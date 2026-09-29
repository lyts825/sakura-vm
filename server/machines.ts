import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, writeFile, rename, rm, stat, copyFile, lstat, link, open } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { createHash, createPrivateKey, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { Client, type ClientCallback, type ExecOptions, type SFTPWrapper } from 'ssh2';
import { StringDecoder } from 'node:string_decoder';
import { isUtf8 } from 'node:buffer';
import { Readable, Transform, type Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  AppError,
  DATA,
  VM_ROOT,
  createSchema,
  checkedId,
  IMAGE,
  vmDir,
  guestPath,
  organizationSchema,
  haPromotionSchema,
  haRetirementSchema,
  liveMigrationFenceSchema,
  liveMigrationOriginSchema,
  type HaPromotion,
  type VMRecord,
  type VMConfig,
  type VMView,
  type VMStatus,
} from './model.ts';
import { createSshKey, seedIso, userData, metaData, bootSetup, cloudUserData, cloudNetwork } from './seed.ts';
import { distroInfo } from './images.ts';
import { Files, MAX_TEXT_BYTES } from './files.ts';
import { freePort, qmp, qmpSnapshotJob, GuestAgent } from './qmp.ts';
import type { Engine } from './runtime.ts';
import { sandboxExpired, sandboxPolicySchema, type SandboxPolicy } from '../shared/sandbox.ts';
import { readStore, writeStore, fileHash, regularDirectory, within } from './local-store.ts';
import { bootGuardStatus, recordBootAttempt, resetBootGuard } from './boot-guard.ts';
import { hardwareArguments, deviceArguments, audioArguments, diskOptions, hardwareSchema } from '../shared/hardware.ts';
import { resourcePolicy, validateAdmission } from './resource-policies.ts';
import { cpuSetSize } from './guest-hardware.ts';
import { ensureUefiFirmware, requireUefiSupport } from './firmware.ts';
import { StoragePools } from './storage-pools.ts';
import { diskEncryptionSchema, encryptedDriveOption, encryptedImageOptions, plainImageOptions,
  openDiskSecret, qemuSecretObject, withDiskSecret } from './disk-encryption.ts';
import { Secrets } from './secrets.ts';
import { liveMigrationProjectsSchema, type LiveMigrationProjects } from './live-migration-projects.ts';

export const BOOT_TIMEOUT_MS = 270_000;
export type MigrationFingerprint = { recordHash: string; diskSize: number; diskMtimeMs: number };
type DiskIdentity = { key: string; seed: Buffer; pending?: string };

async function writeIdentityFile(file: string, contents: string | Buffer) {
  const temporary = `${file}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flush: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function directoryEntries(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (folder: string, prefix: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relativePath = prefix + entry.name;
      if (entry.isDirectory()) {
        found.push(relativePath + '/');
        await visit(join(folder, entry.name), relativePath + '/');
      } else if (entry.isFile()) found.push(relativePath);
      else throw new AppError('实例目录包含无法迁移的链接或特殊文件', 409);
    }
  };
  await visit(root, '');
  return found.sort();
}

async function copyDirectoryVerified(source: string, destination: string, signal?: AbortSignal,
  progress: (text: string) => void = () => {}) {
  const before = await directoryEntries(source);
  await mkdir(destination);
  const visit = async (folder: string, target: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const input = join(folder, entry.name), output = join(target, entry.name);
      if (entry.isDirectory()) {
        await mkdir(output);
        await visit(input, output);
      } else if (entry.isFile()) {
        const sourceInfo = await lstat(input);
        const checksum = createHash('sha256');
        await pipeline(createReadStream(input, { signal }),
          new Transform({ transform(chunk, _encoding, callback) {
            checksum.update(chunk);
            callback(null, chunk);
          } }),
          createWriteStream(output, { flags: 'wx', mode: sourceInfo.mode & 0o777 }),
          { signal });
        const destinationHash = await fileHash(output, signal);
        if (checksum.digest('hex') !== destinationHash)
          throw new AppError(`存储池迁移校验失败：${entry.name}`, 409);
        const after = await lstat(input);
        if (after.size !== sourceInfo.size || after.mtimeMs !== sourceInfo.mtimeMs)
          throw new AppError(`迁移期间源文件发生变化：${entry.name}`, 409);
        progress(`已校验 ${entry.name}（${after.size} 字节）\n`);
      } else throw new AppError('实例目录包含无法迁移的链接或特殊文件', 409);
    }
  };
  await visit(source, destination);
  if (JSON.stringify(before) !== JSON.stringify(await directoryEntries(source)) ||
      JSON.stringify(before) !== JSON.stringify(await directoryEntries(destination)))
    throw new AppError('迁移期间实例目录发生变化', 409);
}

type Live = {
  status: VMStatus;
  incoming?: boolean;
  accelerator: 'tcg' | 'whpx';
  startedAt: string;
  sshPort: number;
  qmpPort: number;
  agentPort: number;
  serialPort: number;
  abort: AbortController;
  bootAbort: AbortController;
  bootstrapKnown?: boolean;
  serialConnected?: boolean;
  serialReady?: boolean;
  serialTail?: string;
  done: Promise<void>;
  bootDone?: Promise<void>;
  allowInitialReset?: boolean;
  serial?: Socket;
  clients: Set<Client>;
  memoryTargetMiB?: number;
  error?: string;
};
export type BootAttachment = { args: string[]; close: () => Promise<void>; machine?: string };
export class Machines extends EventEmitter {
  storagePools = new StoragePools(this);
  prepareBootAttachment?: (vm: VMRecord, onExit: (error: string) => void) => Promise<BootAttachment | undefined>;
  prepareTrustedFirmware?: (vm: VMRecord) => Promise<{ code: string; vars: string } | undefined>;
  prepareTrustedBootAttachment?: (vm: VMRecord, onExit: (error: string) => void) => Promise<BootAttachment | undefined>;
  trustedBootStateFingerprint?: (id: string) => Promise<string>;
  trustedBootSnapshot?: {
    capture: (id: string, snapshotId: string) => Promise<void>;
    prepareRestore: (id: string, snapshotId: string) => Promise<() => Promise<void>>;
    remove: (id: string, snapshotId: string) => Promise<void>;
    ensureOnlineAllowed: (id: string) => Promise<void>;
  };
  fileBeforeReplace?: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>;
  records = new Map<string, VMRecord>();
  live = new Map<string, Live>();
  logs = new Map<string, string>();
  private locks = new Set<string>();
  private operations = new Set<Promise<void>>();
  private closeTask?: Promise<void>;
  private sandboxTimer?: ReturnType<typeof setInterval>;
  private sandboxSweep?: Promise<void>;
  closing = false;
  maintenance = false;
  private incidentLocks = new Set<string>();
  private incidentWrites = Promise.resolve();
  private rescueControllers = new Set<AbortController>();
  private hostPortReservations = new Map<string, Set<number>>();
  reserveHostPorts(owner: string, ports: Iterable<number>) {
    const next = new Set(ports);
    for (const port of next) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new AppError('保留的主机端口无效');
      if ([...this.records.values()].some((vm) => vm.forwards.some((forward) => forward.host === port)))
        throw new AppError(`端口 ${port} 已被实例转发使用`, 409);
      for (const [key, values] of this.hostPortReservations)
        if (key !== owner && values.has(port)) throw new AppError(`端口 ${port} 已被其他服务保留`, 409);
    }
    if (next.size) this.hostPortReservations.set(owner, next);
    else this.hostPortReservations.delete(owner);
  }
  private requireUnreservedPorts(forwards: VMConfig['forwards']) {
    for (const forward of forwards)
      for (const values of this.hostPortReservations.values())
        if (values.has(forward.host))
          throw new AppError(`端口 ${forward.host} 已被宿主服务保留`, 409);
  }
  incidentLocked(id: string) {
    return this.incidentLocks.has(id);
  }
  requireUnlocked(id: string) {
    if (
      this.incidentLocked(id) ||
      (this.records.get(id)?.rescueOf && this.incidentLocked(this.records.get(id)!.rescueOf!))
    )
      throw new AppError('实例处于应急锁定；请先显式解除锁定', 423, 'INCIDENT_LOCKED');
  }
  async setIncidentLockdown(id: string, locked: boolean) {
    this.get(id);
    const write = this.incidentWrites
      .catch(() => {})
      .then(async () => {
        const previous = this.incidentLocked(id);
        if (locked) this.incidentLocks.add(id);
        else this.incidentLocks.delete(id);
        try {
          await writeStore(join(DATA, 'incident-lockdown.json'), [...this.incidentLocks]);
        } catch (error) {
          if (previous) this.incidentLocks.add(id);
          else this.incidentLocks.delete(id);
          throw error;
        }
        if (locked) {
          this.emit('incident-lockdown', id);
          for (const client of this.live.get(id)?.clients || []) client.destroy();
          await this.stopInternal(id, false);
        }
        this.emit('change');
      });
    this.incidentWrites = write;
    await write;
    return { locked: this.incidentLocked(id), stopped: !this.live.has(id) };
  }
  enterMaintenance() {
    if (this.closing || this.maintenance || this.operations.size || this.live.size)
      throw new AppError('请停止全部实例并等待正在执行的操作完成', 409);
    this.maintenance = true;
  }
  constructor(public engine: Engine) {
    super();
  }
  async init() {
    await mkdir(VM_ROOT, { recursive: true });
    await this.storagePools.init();
    const locks = await readStore<string[]>(join(DATA, 'incident-lockdown.json'), () => []);
    if (!Array.isArray(locks) || locks.some((id) => typeof id !== 'string'))
      throw new Error('应急锁定状态损坏');
    this.incidentLocks = new Set(locks);
    try {
      const records = JSON.parse(await readFile(join(DATA, 'machines.json'), 'utf8')) as VMRecord[];
      for (const r of records) {
        vmDir(r.id);
        createSchema.parse({
          name: r.name,
          memoryMiB: r.memoryMiB,
          cpus: r.cpus,
          diskGiB: r.diskGiB,
          storagePoolId: r.storagePoolId,
          accelerator: r.accelerator,
          forwards: r.forwards,
          distro: r.distro,
          architecture: r.architecture,
          firmware: r.firmware,
          template: r.template,
          hardware: r.hardware,
        });
        if (r.sandbox !== undefined) {
          r.sandbox = sandboxPolicySchema.parse(r.sandbox);
          if (r.forwards.length) throw new Error('沙箱不允许额外端口转发');
        }
        if (r.diskEncryption !== undefined)
          r.diskEncryption = diskEncryptionSchema.parse(r.diskEncryption);
        if (r.haPromotion !== undefined)
          r.haPromotion = haPromotionSchema.parse(r.haPromotion);
        if (r.haRetirement !== undefined)
          r.haRetirement = haRetirementSchema.parse(r.haRetirement);
        if (r.liveMigrationFence !== undefined)
          r.liveMigrationFence = liveMigrationFenceSchema.parse(r.liveMigrationFence);
        if (r.liveMigrationOrigin !== undefined)
          r.liveMigrationOrigin = liveMigrationOriginSchema.parse(r.liveMigrationOrigin);
        if (r.rescueOf !== undefined) {
          checkedId(r.rescueOf);
          if (
            !r.sandbox ||
            r.sandbox.network !== 'isolated' ||
            r.sandbox.storage !== 'discard-on-stop' ||
            r.sandbox.onExpire !== 'delete'
          )
            throw new Error('救援实例策略损坏');
          // A host restart never resumes a disk attachment or an old rescue command.
          r.sandbox.expiresAt = new Date(0).toISOString();
        }
        this.storagePools.bind(r.id, r.storagePoolId);
        this.records.set(r.id, r);
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const vm of this.records.values()) await this.recoverDiskEncryption(vm);
    if ([...this.records.values()].some((vm) => vm.sandbox)) {
      await this.expireSandboxes();
      this.watchSandboxes();
    }
  }
  private diskEncryptionPaths(id: string) {
    const dir = vmDir(id);
    return {
      disk: join(dir, 'disk.qcow2'),
      staged: join(dir, '.disk.encrypting.qcow2'),
      backup: join(dir, '.disk.before-encrypt.qcow2'),
      pending: join(dir, '.disk-encryption.pending.json'),
    };
  }
  private async diskInfo(id: string) {
    const output = await this.engine.run('sakura-img',
      ['info', '-f', 'qcow2', '--output=json', this.diskEncryptionPaths(id).disk]);
    return JSON.parse(output) as { format?: string; encrypted?: boolean; 'backing-filename'?: string };
  }
  private async recoverDiskEncryption(vm: VMRecord) {
    const paths = this.diskEncryptionPaths(vm.id);
    const pending = await readFile(paths.pending, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!pending && !vm.diskEncryption) return;
    const info = await this.diskInfo(vm.id);
    if (pending) {
      const config = diskEncryptionSchema.parse(JSON.parse(pending));
      if (info.encrypted) {
        if (vm.diskEncryption && vm.diskEncryption.secretName !== config.secretName)
          throw new AppError(`实例 ${vm.name} 的磁盘口令引用与待恢复事务不一致`, 409);
        vm.diskEncryption = config;
        await this.save();
      } else if (vm.diskEncryption) {
        throw new AppError(`实例 ${vm.name} 的加密标记与明文磁盘不一致，请先恢复磁盘`, 409);
      }
      // After a crash, only an encrypted current disk justifies deleting the plaintext hard link.
      await rm(paths.staged, { force: true });
      await rm(paths.backup, { force: true });
      await rm(paths.pending, { force: true });
    }
    if (vm.diskEncryption && !info.encrypted)
      throw new AppError(`实例 ${vm.name} 的加密标记与磁盘格式不一致`, 409);
  }
  async withDiskSecret<T>(vm: VMRecord, action: (file: string) => Promise<T>) {
    return withDiskSecret(this, vm, action);
  }
  async diskEncryptionStatus(id: string) {
    const vm = this.get(id);
    // QEMU owns the image while running; startup already verified its format.
    const info = this.live.has(id) ? { encrypted: !!vm.diskEncryption } : await this.diskInfo(id);
    const keyAvailable = vm.diskEncryption
      ? (await new Secrets(this).list(id)).some((item) => item.name === vm.diskEncryption!.secretName)
      : false;
    return { enabled: !!vm.diskEncryption, encrypted: !!info.encrypted,
      format: vm.diskEncryption?.format, secretName: vm.diskEncryption?.secretName,
      keyAvailable, stopped: !this.live.has(id), snapshots: vm.snapshots.length };
  }
  async encryptDisk(id: string, secretName: string, signal?: AbortSignal) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      if (vm.diskEncryption) throw new AppError('实例磁盘已经加密', 409);
      if (vm.branchOrigin)
        throw new AppError('快照分支保留明文合并基线，不能加密；请先合并或删除分支', 409);
      if (vm.sandbox || vm.rescueOf) throw new AppError('临时实例不能加密磁盘', 409);
      if (vm.snapshots.length) throw new AppError('请先删除或导出内部快照，再加密实例磁盘', 409);
      const config = diskEncryptionSchema.parse({ format: 'luks', secretName });
      const paths = this.diskEncryptionPaths(id);
      for (const path of [paths.staged, paths.backup, paths.pending])
        if (existsSync(path)) throw new AppError('存在未完成的磁盘加密文件，请先重启服务执行恢复', 409);
      if ((await this.diskInfo(id)).encrypted) throw new AppError('磁盘已加密但缺少加密配置', 409);
      const original = await lstat(paths.disk);
      if (!original.isFile()) throw new AppError('实例磁盘必须是普通文件', 409);
      const secret = await openDiskSecret(this, id, config.secretName);
      let published = false;
      try {
        await writeFile(paths.pending, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
        signal?.throwIfAborted();
        const object = ['--object', qemuSecretObject(secret.file)];
        await this.engine.run('sakura-img', [
          'convert', ...object, '-f', 'qcow2', '-O', 'qcow2',
          '-o', 'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
          paths.disk, paths.staged,
        ], { signal, timeoutMs: 1800000 });
        const stagedInfo = JSON.parse(await this.engine.run('sakura-img',
          ['info', '-f', 'qcow2', '--output=json', paths.staged]));
        if (stagedInfo.format !== 'qcow2' || stagedInfo.encrypted !== true ||
            stagedInfo['backing-filename'])
          throw new AppError('加密转换结果无效，原磁盘未修改', 409);
        await this.engine.run('sakura-img', ['check', ...object, '--image-opts',
          encryptedImageOptions(paths.staged)], { signal, timeoutMs: 1800000 });
        await this.engine.run('sakura-img', ['compare', ...object, '--image-opts',
          plainImageOptions(paths.disk), encryptedImageOptions(paths.staged)],
        { signal, timeoutMs: 1800000 });
        const handle = await open(paths.staged, 'r+');
        try { await handle.sync(); } finally { await handle.close(); }
        signal?.throwIfAborted();
        await link(paths.disk, paths.backup);
        await rename(paths.staged, paths.disk);
        published = true;
        vm.diskEncryption = config;
        await this.save();
        await rm(paths.backup, { force: true });
        await rm(paths.pending, { force: true });
        this.emit('change');
        return this.diskEncryptionStatus(id);
      } finally {
        await secret.close();
        if (!published) {
          await rm(paths.staged, { force: true });
          await rm(paths.backup, { force: true });
          await rm(paths.pending, { force: true });
        }
      }
    });
  }
  private watchSandboxes() {
    if (this.sandboxTimer || this.closing) return;
    this.sandboxTimer = setInterval(() => void this.expireSandboxes(), 1000);
    this.sandboxTimer.unref();
  }
  // Host-side enforcement remains active even when the optional UI plugin is disabled.
  expireSandboxes(now = Date.now()): Promise<void> {
    if (this.sandboxSweep) return this.sandboxSweep;
    this.sandboxSweep = (async () => {
      const expired = [...this.records.values()].filter(
        (vm) => vm.sandbox && sandboxExpired(vm.sandbox, now),
      );
      await Promise.all(
        expired.map(async (vm) => {
          if (this.closing) return;
          try {
            await this.terminateSandbox(vm.id);
            if (vm.sandbox!.onExpire === 'delete' && !this.maintenance && !this.locks.has(vm.id))
              await this.deleteInternal(vm.id, !!vm.rescueOf);
          } catch (error) {
            this.log(vm.id, '\r\n沙箱到期清理失败：' + String(error) + '\r\n');
          }
        }),
      );
    })().finally(() => {
      this.sandboxSweep = undefined;
    });
    return this.sandboxSweep;
  }
  async terminateSandbox(id: string) {
    if (!this.get(id).sandbox) throw new AppError('该实例不是沙箱', 409);
    const live = this.live.get(id);
    if (!live) return;
    // Cancellation must not wait on a guest command or an unrelated instance lock.
    live.bootAbort.abort();
    live.abort.abort();
    await live.done;
  }
  private requireSandboxLifetime(vm: VMRecord) {
    if (vm.sandbox && sandboxExpired(vm.sandbox))
      throw new AppError('沙箱已到期，请销毁后创建新沙箱', 409, 'SANDBOX_EXPIRED');
  }
  private requireMutableConfig(vm: VMRecord) {
    if (vm.sandbox)
      throw new AppError('沙箱资源和网络策略创建后不可修改，请创建新沙箱', 409, 'SANDBOX_POLICY_LOCKED');
  }
  private saveQueue = Promise.resolve();
  private async save() {
    const json = JSON.stringify([...this.records.values()], null, 2);
    const operation = this.saveQueue
      .catch(() => {})
      .then(async () => {
        const file = join(DATA, 'machines.json');
        await writeFile(`${file}.tmp`, json);
        await rename(`${file}.tmp`, file);
      });
    this.saveQueue = operation;
    await operation;
  }
  isBusy(id: string) {
    return this.locks.has(id);
  }
  async locked<T>(id: string, action: () => Promise<T>, allowIncident = false): Promise<T> {
    if (this.closing) throw new AppError('服务正在关闭', 503);
    if (!allowIncident) for (const part of id.split(':')) this.requireUnlocked(part);
    if (this.maintenance) throw new AppError('数据目录迁移维护中，请等待完成并重启服务', 409);
    if (this.locks.has(id)) throw new AppError('该实例的另一项操作正在进行', 409);
    this.locks.add(id);
    let complete!: () => void;
    const operation = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.operations.add(operation);
    try {
      return await action();
    } finally {
      this.locks.delete(id);
      this.operations.delete(operation);
      complete();
    }
  }
  get(id: string) {
    const vm = this.records.get(id);
    if (!vm) throw new AppError('发行版不存在', 404);
    return vm;
  }
  state(id: string): VMStatus {
    return this.live.get(id)?.status || (this.get(id).lastError ? 'error' : 'stopped');
  }
  async view(id: string): Promise<VMView> {
    const vm = this.get(id);
    const disk = await stat(join(vmDir(id), 'disk.qcow2')).catch(() => null);
    return {
      ...vm,
      lastError: this.live.get(id)?.error || vm.lastError,
      status: this.state(id),
      poweredOn: this.live.has(id),
      startedAt: this.live.get(id)?.startedAt,
      activeAccelerator: this.live.get(id)?.accelerator,
      memoryTargetMiB: this.live.get(id)?.memoryTargetMiB,
      diskBytes: disk?.size || 0,
    };
  }
  commandline(id: string) {
    const vm = this.get(id);
    return {
      name: `sakura-${vm.name}`,
      machine: vm.architecture === 'aarch64' ? 'virt' : 'q35',
      architecture: vm.architecture || 'x86_64',
      memoryMiB: vm.memoryMiB,
      cpus: vm.cpus,
      hardware: vm.hardware,
      resourceArguments: hardwareArguments(vm),
      deviceArguments: deviceArguments(vm),
      audioArguments: audioArguments(vm),
      display: vm.hardware?.devices?.graphics === 'virgl' ? 'egl-headless' : 'none',
      diskOptions: diskOptions(vm) + (vm.sandbox?.storage === 'discard-on-stop' ? ',snapshot=on' : ''),
      diskEncryption: vm.diskEncryption ? { format: 'luks', secretName: vm.diskEncryption.secretName } : undefined,
      diskPersistence: vm.sandbox?.storage || 'persistent',
      accelerator: vm.accelerator,
      disk: join(vmDir(id), 'disk.qcow2'),
      forwards: vm.forwards,
    };
  }
  async list() {
    return Promise.all([...this.records.keys()].map((id) => this.view(id)));
  }
  log(id: string, data: Buffer | string) {
    const text = data.toString();
    const previous = this.logs.get(id) || '';
    this.logs.set(id, (previous + text).slice(-128 * 1024));
    this.emit(`log:${id}`, text);
    const live = this.live.get(id);
    if (live?.status === 'starting' && live.bootstrapKnown === false && !live.serialReady) {
      live.serialTail = ((live.serialTail || '') + text).slice(-128);
      if (live.serialTail.includes('SAKURA_READY')) live.serialReady = true;
    }
    const recent = previous.slice(-128) + text;
    if (live?.status === 'starting' && recent.includes('Kernel panic - not syncing:')) {
      live.error = 'Linux 内核启动失败（Kernel panic）；请查看启动日志，然后停止并重试。';
      live.status = 'error';
      live.bootAbort.abort();
      this.emit('change');
    }
  }
  async create(input: unknown, sandbox?: SandboxPolicy) {
    return this.createInternal(input, sandbox);
  }
  async createIncomingTarget(input: unknown, identity: { key: string; seed: Buffer },
    source: { sourceHostId: string; sourceVmId: string; transferId: string },
    projects?: LiveMigrationProjects, organization?: VMRecord['organization']) {
    if (typeof identity.key !== 'string' || identity.key.length < 100 ||
        identity.key.length > 16_000 || !Buffer.isBuffer(identity.seed) ||
        identity.seed.length < 40 * 1024 || identity.seed.length > 1024 * 1024 ||
        identity.seed.toString('ascii', 32769, 32774) !== 'CD001')
      throw new AppError('在线迁移客户机身份数据无效');
    try { createPrivateKey(identity.key); }
    catch { throw new AppError('在线迁移控制密钥无效'); }
    const sourceIds = z.object({ sourceHostId: z.uuid(), sourceVmId: z.uuid(),
      transferId: z.uuid() }).strict().parse(source);
    const config = createSchema.parse(input);
    if (config.firmware === 'uefi' || config.architecture === 'aarch64' ||
        config.hardware?.devices?.graphics === 'virgl')
      throw new AppError('此硬件配置尚不能安全在线迁移', 409);
    if ([...this.records.values()].some((vm) =>
      vm.liveMigrationOrigin?.sourceHostId === sourceIds.sourceHostId &&
      vm.liveMigrationOrigin.transferId === sourceIds.transferId))
      throw new AppError('此在线迁移任务已创建目标实例', 409);
    const now = new Date().toISOString();
    return this.createInternal(config, undefined, undefined, { ...identity,
      origin: { ...sourceIds, status: 'prepared', createdAt: now, updatedAt: now },
      ...(projects ? { projects: liveMigrationProjectsSchema.parse(projects) } : {}),
      ...(organization ? { organization: organizationSchema.parse(organization) } : {}),
    });
  }
  private async prepareVmDirectory(vm: VMRecord) {
    const root = await this.storagePools.ensure(vm.storagePoolId);
    this.storagePools.bind(vm.id, vm.storagePoolId);
    const dir = vmDir(vm.id);
    if (!within(root, dir)) throw new AppError('实例目录超出存储池', 409);
    try { await mkdir(dir); }
    catch (error) {
      this.storagePools.unbind(vm.id);
      throw error;
    }
    return dir;
  }
  private async removeVmDirectory(vm: VMRecord) {
    const root = await this.storagePools.ensure(vm.storagePoolId);
    const dir = this.storagePools.directory(vm.id, vm.storagePoolId);
    if (!within(root, dir) || dir === root)
      throw new AppError('实例目录超出存储池', 409);
    await regularDirectory(dir);
    await rm(dir, { recursive: true, force: true });
  }
  private async createInternal(input: unknown, sandbox?: SandboxPolicy, rescueOf?: string,
    incoming?: { key: string; seed: Buffer; origin: NonNullable<VMRecord['liveMigrationOrigin']>;
      projects?: LiveMigrationProjects; organization?: VMRecord['organization'] }) {
    return this.locked('storage-pools', () => this.locked('create', async () => {
      const config = createSchema.parse(input);
      this.requireUnreservedPorts(config.forwards);
      if (config.architecture === 'aarch64' && !this.engine.aarch64Available)
        throw new AppError('缺少 ARM64 QEMU，请运行 npm run setup', 503);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture);
      if (sandbox !== undefined) {
        sandbox = sandboxPolicySchema.parse(sandbox);
        if (sandboxExpired(sandbox)) throw new AppError('沙箱期限必须晚于当前时间');
        if (config.forwards.length || (config.template && config.template !== 'none'))
          throw new AppError('沙箱不允许额外端口转发或自动安装模板');
      }
      if ([...this.records.values()].some((v) => v.name === config.name))
        throw new AppError('该名称已存在', 409);
      if (incoming && [...this.records.values()].some((vm) =>
        vm.liveMigrationOrigin?.sourceHostId === incoming.origin.sourceHostId &&
        vm.liveMigrationOrigin.transferId === incoming.origin.transferId))
        throw new AppError('此在线迁移任务已创建目标实例', 409);
      const image = distroInfo(config.distro, config.architecture);
      if (!existsSync(image.file)) throw new AppError('镜像尚未准备好，请先下载对应发行版镜像', 503);
      if (config.memoryMiB < image.minimumMemory || config.diskGiB < image.minimumDisk)
        throw new AppError(
          `${image.name} 至少需要 ${image.minimumMemory} MiB 内存、${image.minimumDisk} GiB 磁盘`,
        );
      if (this.records.size >= 32) throw new AppError('最多保留 32 个发行版');
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: !!incoming,
        ...(incoming ? { liveMigrationOrigin: incoming.origin } : {}),
        ...(incoming?.organization ? { organization: incoming.organization } : {}),
        ...(sandbox ? { sandbox } : {}),
        ...(rescueOf ? { rescueOf } : {}),
      };
      const dir = await this.prepareVmDirectory(vm);
      try {
        const key = incoming ? null : createSshKey();
        await writeFile(join(dir, 'id_rsa'), incoming?.key || key!.privateText, { mode: 0o600 });
        await writeFile(
          join(dir, 'seed.iso'),
          incoming?.seed || seedIso({
            'meta-data': metaData(vm.id, vm.name, key!.publicText),
            'user-data':
              vm.distro && vm.distro !== 'alpine'
                ? cloudUserData(vm.name, key!.publicText,
                  vm.architecture === 'aarch64' ? '/dev/ttyAMA0' : '/dev/ttyS0')
                : userData(vm.name, key!.publicText),
            ...(vm.distro && vm.distro !== 'alpine' ? { 'network-config': cloudNetwork } : {}),
          }),
        );
        if (incoming?.projects) {
          await writeFile(join(dir, 'projects.json'),
            JSON.stringify({ active: incoming.projects.active,
              projects: incoming.projects.projects }, null, 2));
          for (const [projectId, project] of Object.entries(incoming.projects.configs))
            await writeFile(join(dir, projectId === 'default'
              ? 'project.json' : `project-${projectId}.json`),
            JSON.stringify(project, null, 2));
        }
        await this.engine.run('sakura-img', [
          'create',
          '-f',
          'qcow2',
          '-F',
          'qcow2',
          '-b',
          image.file,
          join(dir, 'disk.qcow2'),
          `${vm.diskGiB}G`,
        ]);
        // The stock Alpine image keeps a ten-second boot menu and makes
        // chronyd wait for its first fork. Patch those fixed, vendor-owned
        // defaults in the new overlay before the first boot. The guest still
        // runs Tiny Cloud normally, so this only removes idle host-side time;
        // custom images and engines without qemu-io retain the old path.
        if (
          this.engine.qemuIoAvailable &&
          (!vm.distro || vm.distro === 'alpine') &&
          image.file === IMAGE &&
          process.env.SAKURA_SKIP_ALPINE_BOOT_PATCH !== '1'
        ) {
          const patches = [
            [102481713, Buffer.from('timeout=10'), Buffer.from('timeout=01')],
            [102484169, Buffer.from('TIMEOUT 100'), Buffer.from('TIMEOUT 010')],
            [12077294, Buffer.from('FAST_STARTUP=no\n'), Buffer.from('FAST_STARTUP=yes\n')],
          ] as const;
          const verifyArgs = ['-f', 'qcow2'];
          for (const [offset, expected] of patches)
            expected.forEach((byte, index) => verifyArgs.push('-c', `read -P ${byte} ${offset + index} 1`));
          let stockImage = true;
          try {
            await this.engine.run('sakura-io', [...verifyArgs, image.file]);
          } catch {
            stockImage = false;
          }
          // A user may have replaced the pinned image or already applied a
          // local customization. Never write fixed offsets into that disk.
          if (stockImage) {
            const qemuIoArgs = ['-f', 'qcow2'];
            for (const [offset, _expected, contents] of patches)
              contents.forEach((byte, index) =>
                qemuIoArgs.push('-c', `write -P ${byte} ${offset + index} 1`),
              );
            qemuIoArgs.push(join(dir, 'disk.qcow2'));
            await this.engine.run('sakura-io', qemuIoArgs);
          }
        }
        this.requireUnreservedPorts(vm.forwards);
        this.records.set(vm.id, vm);
        await this.save();
        if (vm.sandbox) this.watchSandboxes();
        return this.view(vm.id);
      } catch (e) {
        this.records.delete(vm.id);
        await this.removeVmDirectory(vm);
        this.storagePools.unbind(vm.id);
        throw e;
      }
    }));
  }
  async start(id: string) {
    return this.startInternal(id);
  }
  async startIncoming(id: string) {
    return this.startInternal(id, undefined, true);
  }
  async completeIncoming(id: string, query: typeof qmp = qmp) {
    return this.locked(id, async () => {
      const live = this.live.get(id);
      if (!live?.incoming || live.status !== 'paused')
        throw new AppError('目标实例不在迁移接收状态', 409);
      const vm = this.get(id), previous = vm.liveMigrationOrigin;
      if (!previous || previous.status !== 'prepared')
        throw new AppError('目标实例没有待完成的在线迁移记录', 409);
      const state = await query(live.qmpPort, 'query-status') as
        { status?: string; running?: boolean };
      if (state.running !== true || state.status !== 'running')
        throw new AppError('目标 QEMU 尚未完成迁移并运行', 409);
      vm.liveMigrationOrigin = liveMigrationOriginSchema.parse({ ...previous,
        status: 'received', updatedAt: new Date().toISOString() });
      try { await this.save(); }
      catch (error) { vm.liveMigrationOrigin = previous; throw error; }
      live.incoming = false;
      live.status = 'starting';
      live.bootDone = this.watchBoot(id, live).catch((error) => {
        if (!live.bootAbort.signal.aborted) this.log(id, String(error));
      });
      this.emit('change');
      return this.view(id);
    });
  }
  async fenceForLiveMigration(id: string, raw: unknown,
    query: typeof qmp = qmp) {
    const identity = liveMigrationFenceSchema.omit({ fencedAt: true }).parse(raw);
    return this.locked(id, async () => {
      const vm = this.get(id);
      if (vm.liveMigrationFence) {
        if (vm.liveMigrationFence.transferId !== identity.transferId ||
            vm.liveMigrationFence.targetHostId !== identity.targetHostId ||
            vm.liveMigrationFence.targetVmId !== identity.targetVmId)
          throw new AppError('来源实例已有其他在线迁移栅栏', 409);
        return vm.liveMigrationFence;
      }
      if (vm.haPromotion || vm.haRetirement)
        throw new AppError('故障接管实例不能同时进行在线迁移', 409);
      const live = this.live.get(id);
      if (!live || live.status !== 'running')
        throw new AppError('来源实例没有运行', 409);
      const [state, migration] = await Promise.all([
        query(live.qmpPort, 'query-status'), query(live.qmpPort, 'query-migrate'),
      ]) as [{ running?: boolean }, { status?: string }];
      if (state.running !== false || migration.status !== 'pre-switchover')
        throw new AppError('来源 QEMU 尚未在迁移切换点暂停', 409);
      const fence = liveMigrationFenceSchema.parse({ ...identity,
        fencedAt: new Date().toISOString() });
      vm.liveMigrationFence = fence;
      try { await this.save(); }
      catch (error) { delete vm.liveMigrationFence; throw error; }
      this.emit('change');
      return fence;
    });
  }
  async fenceForHa(id: string, raw: HaPromotion,
    guard?: () => Promise<void> | void) {
    const promotion = haPromotionSchema.parse(raw);
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      await guard?.();
      if (vm.haPromotion) {
        if (vm.haPromotion.transferId !== promotion.transferId)
          throw new AppError('来源实例已有其他故障接管栅栏', 409);
        return vm.haPromotion;
      }
      vm.haPromotion = promotion;
      try { await this.save(); }
      catch (error) { delete vm.haPromotion; throw error; }
      this.emit('change');
      return promotion;
    });
  }
  async updateHaPromotion(id: string, transferId: string,
    patch: Pick<HaPromotion, 'status'> & { error?: string }) {
    return this.locked(id, async () => {
      const vm = this.get(id), previous = vm.haPromotion;
      if (!previous || previous.transferId !== transferId)
        throw new AppError('故障接管栅栏已变化', 409);
      vm.haPromotion = haPromotionSchema.parse({ ...previous, ...patch,
        updatedAt: new Date().toISOString() });
      try { await this.save(); }
      catch (error) { vm.haPromotion = previous; throw error; }
      this.emit('change');
      return vm.haPromotion;
    });
  }
  async releaseHaPromotion(id: string, transferId: string) {
    return this.locked(id, async () => {
      const vm = this.get(id), previous = vm.haPromotion;
      this.requireStopped(id);
      if (!previous || previous.transferId !== transferId)
        throw new AppError('故障接管栅栏已变化', 409);
      delete vm.haPromotion;
      try { await this.save(); }
      catch (error) { vm.haPromotion = previous; throw error; }
      this.emit('change');
      return { released: true };
    });
  }
  async retireHaReplica(id: string, raw: unknown) {
    const identity = haRetirementSchema.omit({ retiredAt: true }).parse(raw);
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      if (vm.migrationOrigin?.sourceHostId !== identity.sourceHostId ||
          vm.migrationOrigin.transferId !== identity.transferId ||
          vm.migrationOrigin.sourceVmId !== identity.sourceVmId ||
          vm.migrationOrigin.snapshotId !== identity.snapshotId ||
          vm.migrationOrigin.diskSha256 !== identity.sha256)
        throw new AppError('故障副本身份与导入记录不一致', 409);
      if (vm.haRetirement) return vm.haRetirement;
      vm.haRetirement = { ...identity, retiredAt: new Date().toISOString() };
      try { await this.save(); }
      catch (error) { delete vm.haRetirement; throw error; }
      this.emit('change');
      return vm.haRetirement;
    });
  }
  private async startInternal(id: string, rescueOf?: string, incoming = false) {
    return this.locked('launch', () =>
      this.locked(id, async () => {
        const vm = this.get(id);
        if (vm.haPromotion)
          throw new AppError('来源实例已为故障接管设置栅栏；请先确认目标已停止并解除栅栏',
            409, 'HA_SOURCE_FENCED');
        if (vm.haRetirement)
          throw new AppError('故障副本已退出接管并被持久封锁，不能重新启动',
            409, 'HA_REPLICA_RETIRED');
        if (vm.liveMigrationFence)
          throw new AppError('来源实例已为在线迁移设置栅栏，不能在原主机重新启动',
            409, 'LIVE_MIGRATION_SOURCE_FENCED');
        if (incoming && vm.liveMigrationOrigin?.status !== 'prepared')
          throw new AppError('目标实例没有待接收的在线迁移记录', 409);
        if (!incoming && vm.liveMigrationOrigin?.status === 'prepared')
          throw new AppError('在线迁移目标尚未接收客户机状态，不能普通启动', 409);
        if (vm.rescueOf && (vm.rescueOf !== rescueOf || !this.locks.has(rescueOf)))
          throw new AppError('临时救援实例只能由救援任务启动，请重新提交救援任务', 409);
        this.requireSandboxLifetime(vm);
        if (incoming && this.live.has(id))
          throw new AppError('迁移目标实例必须处于停止状态', 409);
        if (this.live.has(id)) return this.view(id);
        validateAdmission(
          await resourcePolicy(),
          vm,
          [...this.live.keys()].map((key) => this.get(key)),
        );
        if (this.live.size >= 4) throw new AppError('轻量模式最多同时运行 4 个发行版', 409);
        for (const otherId of this.live.keys())
          for (const p of this.get(otherId).forwards)
            if (vm.forwards.some((n) => n.host === p.host))
              throw new AppError(`端口 ${p.host} 已被另一实例使用`, 409);
        this.requireUnreservedPorts(vm.forwards);
        if (vm.architecture === 'aarch64' && !this.engine.aarch64Available)
          throw new AppError('缺少 ARM64 QEMU，请运行 npm run setup', 503);
        if (vm.diskEncryption && !(await this.diskInfo(id)).encrypted)
          throw new AppError('加密配置与实际磁盘不一致，拒绝启动', 409);
        if (vm.diskEncryption && !(await new Secrets(this).list(id)).some(
          (item) => item.name === vm.diskEncryption!.secretName))
          throw new AppError(`缺少私密配置：${vm.diskEncryption.secretName}`, 409);
        const firmware = vm.firmware === 'uefi'
          ? (await this.prepareTrustedFirmware?.(vm)) ||
            await ensureUefiFirmware(id, vm.architecture) : null;
        const [sshPort, qmpPort, serialPort, agentPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
        await recordBootAttempt(id);
        const accelerator = vm.architecture === 'aarch64' ? 'tcg'
          : vm.accelerator === 'auto' ? (this.engine.whpxAvailable ? 'whpx' : 'tcg') : vm.accelerator;
        const live: Live = {
          status: incoming ? 'paused' : 'starting',
          incoming,
          accelerator,
          startedAt: new Date().toISOString(),
          sshPort,
          qmpPort,
          agentPort,
          serialPort,
          abort: new AbortController(),
          bootAbort: new AbortController(),
          bootstrapKnown: incoming || vm.bootstrapped !== false,
          serialConnected: false,
          serialReady: false,
          serialTail: '',
          done: Promise.resolve(),
          clients: new Set(),
        };
        this.live.set(id, live);
        const previousError = vm.lastError;
        const previousUsedAt = vm.lastUsedAt;
        vm.lastUsedAt = live.startedAt;
        delete vm.lastError;
        this.logs.set(id, '');
        try {
          await this.save();
        } catch (error) {
          this.live.delete(id);
          vm.lastUsedAt = previousUsedAt;
          if (previousError !== undefined) vm.lastError = previousError;
          throw error;
        }
        const dir = vmDir(id);
        // The deadline can pass while reserving ports or persisting startup state.
        if (vm.sandbox && sandboxExpired(vm.sandbox)) {
          this.live.delete(id);
          this.requireSandboxLifetime(vm);
        }
        let diskSecret: Awaited<ReturnType<typeof openDiskSecret>> | undefined;
        let attachment: BootAttachment | undefined;
        let trustedAttachment: BootAttachment | undefined;
        try {
          if (vm.diskEncryption)
            diskSecret = await openDiskSecret(this, id, vm.diskEncryption.secretName);
          attachment = await this.prepareBootAttachment?.(vm, (error) => {
            if (this.live.get(id) !== live || live.abort.signal.aborted ||
                live.status === 'stopping') return;
            live.error = `Virtio-FS 守护程序退出：${error.slice(-1024)}`;
            vm.lastError = live.error;
            this.log(id, `\r\n${live.error}\r\n`);
            this.emit('change');
            live.abort.abort();
          });
          trustedAttachment = await this.prepareTrustedBootAttachment?.(vm, (error) => {
            if (this.live.get(id) !== live || live.abort.signal.aborted ||
                live.status === 'stopping') return;
            live.error = `TPM 守护程序退出：${error.slice(-1024)}`;
            vm.lastError = live.error;
            this.log(id, `\r\n${live.error}\r\n`);
            this.emit('change');
            live.abort.abort();
          });
          live.allowInitialReset = !!trustedAttachment;
        } catch (error) {
          this.live.delete(id);
          await trustedAttachment?.close().catch(() => {});
          await attachment?.close().catch(() => {});
          await diskSecret?.close().catch(() => {});
          vm.lastError = (error as Error).message;
          this.emit('change');
          throw error;
        }
        const escape = (s: string) => s.replaceAll(',', ',,');
        const forwards = [
          `hostfwd=tcp:127.0.0.1:${sshPort}-:22`,
          ...vm.forwards.map((p) => `hostfwd=tcp:127.0.0.1:${p.host}-:${p.guest}`),
        ];
        const args = [
          '-name',
          `sakura-${vm.name}`,
          '-machine',
          trustedAttachment?.machine || (vm.architecture === 'aarch64' ? 'virt' : 'q35'),
          '-nodefaults',
          ...(vm.sandbox ? ['-no-user-config'] : []),
          '-boot',
          'order=c,menu=off',
          ...(!vm.distro || vm.distro === 'alpine' ? ['-smbios', 'type=1,serial=ds=nocloud'] : []),
          '-accel',
          // Use an instruction-based clock on Windows TCG: host scheduling can
          // otherwise make Alpine's early PIT/IO-APIC timer check panic. icount
          // requires single-threaded TCG; other hosts keep multi-threading.
          accelerator === 'whpx' ? 'whpx' : `tcg,thread=${process.platform === 'win32' ? 'single' : 'multi'}`,
          ...(vm.architecture === 'aarch64' ? ['-cpu', 'cortex-a57'] : []),
          ...(process.platform === 'win32' && accelerator === 'tcg' && vm.architecture !== 'aarch64'
            ? ['-icount', 'shift=auto,sleep=on']
            : []),
          ...hardwareArguments(vm),
          ...(attachment?.args || []),
          ...(trustedAttachment?.args || []),
          ...(vm.rescueOf
            ? [
                '-device',
                'pcie-root-port,id=sakura-rescue-port,slot=1,chassis=1',
                '-device',
                'pcie-root-port,id=sakura-rescue-compare-port,slot=2,chassis=2',
                '-device',
                'pcie-root-port,id=sakura-rescue-target-port,slot=3,chassis=3',
              ]
            : []),
          '-display',
          vm.hardware?.devices?.graphics === 'virgl' ? 'egl-headless' : 'none',
          '-monitor',
          'none',
          // Some signed UEFI fallback loaders register a boot entry and reset
          // once before the first Linux boot. Keep that reset inside QEMU.
          ...(trustedAttachment ? [] : ['-no-reboot']),
          ...(firmware
            ? [
                '-drive',
                `if=pflash,unit=0,format=raw,readonly=on,file=${escape(firmware.code)}`,
                '-drive',
                `if=pflash,unit=1,format=raw,file=${escape(firmware.vars)}`,
              ]
            : []),
          ...(diskSecret ? ['-object', qemuSecretObject(diskSecret.file)] : []),
          '-drive',
          `file=${escape(join(dir, 'disk.qcow2'))},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(vm)}${diskSecret ? ',' + encryptedDriveOption() : ''}${vm.sandbox?.storage === 'discard-on-stop' ? ',snapshot=on' : ''}`,
          '-drive',
          `file=${escape(join(dir, 'seed.iso'))},${vm.distro && vm.distro !== 'alpine' ? 'if=virtio,format=raw' : 'media=cdrom'},readonly=on`,
          '-netdev',
          `user,id=sakura-net,ipv4=on,net=10.0.2.0/24,host=10.0.2.2,dns=10.0.2.3,${vm.sandbox?.network === 'isolated' ? 'restrict=on,ipv6=off,' : vm.hardware?.ipv6 === undefined ? '' : `ipv6=${vm.hardware.ipv6 ? 'on' : 'off'},`}${forwards.join(',')}`,
          ...audioArguments(vm),
          ...deviceArguments(vm),
          ...(vm.architecture === 'aarch64' ? [] : ['-device', 'qemu-xhci,id=sakura-usb']),
          '-chardev',
          `socket,id=sakura-agent,host=127.0.0.1,port=${agentPort},server=on,wait=off`,
          '-device',
          'virtio-serial-pci',
          '-device',
          'virtserialport,chardev=sakura-agent,name=org.qemu.guest_agent.0',
          '-qmp',
          `tcp:127.0.0.1:${qmpPort},server=on,wait=off`,
          '-serial',
          `tcp:127.0.0.1:${serialPort},server=on,wait=off`,
          ...(incoming ? ['-incoming', 'defer'] : []),
        ];
        live.done = this.engine
          .run(vm.architecture === 'aarch64' ? 'sakura-qemu-aarch64' : 'sakura-qemu', args, {
            signal: live.abort.signal,
            timeoutMs: 2147483647,
            output: (b) => this.log(id, b),
          })
          .then(
            () => {},
            async (error) => {
              live.error = String(error.message || error);
              vm.lastError = live.error;
              this.log(id, `\r\n${live.error}\r\n`);
            },
          )
          .finally(async () => {
            await trustedAttachment?.close().catch((error) => this.log(id, `\r\n清理 TPM 守护程序失败：${String(error)}\r\n`));
            await attachment?.close().catch((error) => this.log(id, `\r\n清理 Virtio-FS 守护程序失败：${String(error)}\r\n`));
            await diskSecret?.close().catch((error) => this.log(id, `\r\n清理磁盘临时口令失败：${String(error)}\r\n`));
            live.bootAbort.abort();
            live.serial?.destroy();
            for (const client of live.clients) client.end();
            await live.bootDone;
            this.live.delete(id);
            vm.lastUsedAt = new Date().toISOString();
            await this.save().catch((error) => this.log(id, `\r\n保存实例状态失败：${String(error)}\r\n`));
            this.emit('change');
          });
        if (diskSecret) {
          const secret = diskSecret;
          void (async () => {
            while (this.live.get(id) === live && !live.abort.signal.aborted) {
              try {
                await qmp(qmpPort, 'query-status', undefined, 2000);
                await secret.close();
                return;
              } catch {
                await delay(100);
              }
            }
          })().catch((error) => this.log(id, `\r\n清理磁盘临时口令失败：${String(error)}\r\n`));
        }
        if (!incoming) live.bootDone = this.watchBoot(id, live).catch((e) => {
          if (!live.bootAbort.signal.aborted) this.log(id, String(e));
        });
        this.emit('change');
        return this.view(id);
      }),
    );
  }
  private async watchBoot(id: string, live: Live) {
    const deadline = performance.now() + BOOT_TIMEOUT_MS;
    const { signal } = live.bootAbort;
    while (
      performance.now() < deadline &&
      this.live.get(id) === live &&
      live.status === 'starting' &&
      !signal.aborted
    ) {
      if (!live.serial || live.serial.destroyed) {
        const socket = createConnection({ host: '127.0.0.1', port: live.serialPort });
        socket.on('error', () => {});
        socket.on('connect', () => {
          live.serialConnected = true;
        });
        socket.on('close', () => {
          live.serialConnected = false;
        });
        socket.on('data', (data) => this.log(id, data));
        live.serial = socket;
      }
      // A newly created disk emits SAKURA_READY only after its one-time cloud
      // provisioning has completed. Once the serial channel is connected,
      // wait for that marker instead of repeatedly creating SSH sessions that
      // can only fail while Tiny Cloud is still running. If the serial channel
      // is unavailable, retain the SSH probe fallback for older images.
      if (!live.bootstrapKnown && live.serialConnected && !live.serialReady) {
        await delay(100, undefined, { signal });
        continue;
      }
      try {
        // The first SSH daemon is reachable before user-data restarts it. Do not
        // expose terminals until Tiny Cloud has finished provisioning the guest.
        const result = await this.exec(
          id,
          this.get(id).distro && this.get(id).distro !== 'alpine'
            ? 'test -f /var/lib/cloud/instance/boot-finished && test -d /workspace'
            : `set -e\ntest -f /var/lib/cloud/.bootstrap-complete\n${bootSetup()}`,
          Math.max(1, Math.min(1800, deadline - performance.now())),
          signal,
        );
        if (result.code !== 0) throw new Error('Linux initialization is not finished');
        signal.throwIfAborted();
        const identityFile = join(vmDir(id), 'identity.json');
        if (existsSync(identityFile)) {
          const identity = JSON.parse(await readFile(identityFile, 'utf8')) as ReturnType<
            typeof createSshKey
          >;
          // Keep the existing key usable until the new host key is durable.
          // Power loss between these steps can then be retried with either key.
          const prepared = await this.exec(
            id,
            `set -e\ngrep -qxF '${identity.publicText}' /root/.ssh/authorized_keys || printf '\\n%s\\n' '${identity.publicText}' >> /root/.ssh/authorized_keys\nchmod 600 /root/.ssh/authorized_keys\nsync\n`,
            10000,
            signal,
          );
          if (prepared.code !== 0) throw new Error(prepared.stderr);
          await writeIdentityFile(join(vmDir(id), 'id_rsa'), identity.privateText);
          const changed = await this.exec(
            id,
            `set -e\nprintf '%s\\n' '${identity.publicText}' > /root/.ssh/authorized_keys.sakura-tmp\nchmod 600 /root/.ssh/authorized_keys.sakura-tmp\nmv /root/.ssh/authorized_keys.sakura-tmp /root/.ssh/authorized_keys\nhostname '${this.get(id).name}'\nprintf '%s\\n' '${this.get(id).name}' > /etc/hostname\n`,
            10000,
            signal,
          );
          if (changed.code !== 0) throw new Error(changed.stderr);
          await rm(identityFile);
        }
        if (this.live.get(id) === live && live.status === 'starting') {
          // Secure UEFI may reset once to register its signed boot loader. Once
          // Linux is ready, restore the usual stop-on-guest-reboot behavior.
          if (live.allowInitialReset)
            await qmp(live.qmpPort, 'set-action', { reboot: 'shutdown' });
          const vm = this.get(id), origin = vm.liveMigrationOrigin;
          if (origin?.status === 'received') {
            vm.liveMigrationOrigin = liveMigrationOriginSchema.parse({ ...origin,
              status: 'ready', updatedAt: new Date().toISOString() });
            try { await this.save(); }
            catch (error) {
              vm.liveMigrationOrigin = origin;
              live.error = `迁移目标就绪记录保存失败：${String(error)}`;
              live.status = 'error';
              this.emit('change');
              return;
            }
          }
          live.status = 'running';
          this.get(id).bootstrapped = true;
          await resetBootGuard(id);
          this.emit('change');
        }
        return;
      } catch {
        if (signal.aborted) return;
        await delay(Math.min(250, Math.max(0, deadline - performance.now())), undefined, { signal });
      }
    }
    if (this.live.get(id) === live && live.status === 'starting') {
      live.error = 'Linux 启动超时；请查看启动日志，然后停止并重试。';
      live.status = 'error';
      this.emit('change');
    }
  }
  async connect(id: string, timeout = 10000, signal?: AbortSignal, agentPath?: string) {
    this.requireUnlocked(id);
    const live = this.live.get(id);
    if (!live || live.status === 'stopping' || live.status === 'paused')
      throw new AppError(live?.status === 'paused' ? '发行版已暂停，请先恢复' : '请先启动该发行版', 409);
    const deadline = performance.now() + timeout;
    const key = await readFile(join(vmDir(id), 'id_rsa'));
    for (let attempt = 0; ; attempt++) {
      this.requireUnlocked(id);
      signal?.throwIfAborted();
      if (this.live.get(id) !== live || this.live.get(id)?.status === 'stopping')
        throw new AppError('发行版已停止', 409);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('SSH connection timed out');
      try {
        return await this.connectOnce(live, key, remaining, signal, agentPath);
      } catch (error) {
        // An interrupted clone rekey may have updated the guest before the host
        // key file. Recover using the pending key without replaying commands.
        if (
          (error as Error).message.includes('authentication') &&
          existsSync(join(vmDir(id), 'identity.json'))
        ) {
          const pending = JSON.parse(await readFile(join(vmDir(id), 'identity.json'), 'utf8'));
          signal?.throwIfAborted();
          if (this.live.get(id) !== live || this.live.get(id)?.status === 'stopping')
            throw new AppError('发行版已停止', 409);
          return this.connectOnce(
            live,
            Buffer.from(pending.privateText),
            Math.max(1, deadline - performance.now()),
            signal,
            agentPath,
          );
        }
        // QEMU's user-network listener can refuse simultaneous TCP connects.
        // Retry only before a TCP connection exists, never replay a command or
        // an authentication failure, and stay within the caller's deadline.
        const wait = 100 * 2 ** attempt;
        if (
          (error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' ||
          attempt >= 3 ||
          deadline - performance.now() <= wait
        )
          throw error;
        await delay(wait, undefined, { signal });
      }
    }
  }
  private connectOnce(live: Live, key: Buffer, timeout: number, signal?: AbortSignal,
    agentPath?: string) {
    signal?.throwIfAborted();
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      const abort = () => client.destroy();
      const timer = setTimeout(() => {
        reject(new Error('SSH connection timed out'));
        client.destroy();
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      live.clients.add(client);
      signal?.addEventListener('abort', abort, { once: true });
      client.once('ready', () => {
        cleanup();
        resolve(client);
      });
      client.on('error', (error) => {
        cleanup();
        reject(error);
        client.end();
      });
      client.once('close', () => {
        cleanup();
        live.clients.delete(client);
        reject(new Error('SSH connection closed'));
      });
      try {
        client.connect({
          host: '127.0.0.1',
          port: live.sshPort,
          username: 'root',
          privateKey: key,
          readyTimeout: timeout,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          ...(agentPath ? { agent: agentPath, agentForward: true } : {}),
        });
      } catch (error) {
        cleanup();
        live.clients.delete(client);
        client.destroy();
        reject(error);
      }
    });
  }
  async exec(
    id: string,
    command: string,
    timeout = 30000,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string,
  ) {
    const client = await this.connect(id, Math.min(timeout, 10000), signal, agentPath);
    try {
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        let stdout = '',
          stderr = '',
          size = 0;
        let settled = false;
        const outDecoder = new StringDecoder('utf8'),
          errDecoder = new StringDecoder('utf8');
        const finish = (error?: Error, code = -1) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          client.off('close', closed);
          error
            ? reject(error)
            : resolve({ stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end(), code });
        };
        const abort = () => {
          finish(new AppError('Linux 命令已取消', 409));
          client.destroy();
        };
        const closed = () => finish(new Error('SSH connection closed'));
        const timer = setTimeout(() => {
          finish(new AppError('Linux 命令执行超时', 408));
          client.destroy();
        }, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', closed);
        if (signal?.aborted) {
          abort();
          return;
        }
        const completed: ClientCallback = (error, stream) => {
          if (error) {
            finish(error);
            return;
          }
          if (settled) {
            stream.close();
            return;
          }
          const collect = (data: Buffer, err = false) => {
            if (settled) return;
            size += data.length;
            if (size > 1024 * 1024) {
              finish(new AppError('输出超过 1 MiB，请使用终端'));
              stream.close();
              return;
            }
            const text = (err ? errDecoder : outDecoder).write(data);
            if (err) stderr += text;
            else stdout += text;
            output?.(text);
          };
          stream.on('data', (data: Buffer) => collect(data));
          stream.stderr.on('data', (data: Buffer) => collect(data, true));
          stream.on('error', (e: Error) => finish(e));
          stream.on('close', (code: number) => {
            finish(undefined, code ?? -1);
          });
        };
        if (agentPath) client.exec(command, { agentForward: true } as ExecOptions, completed);
        else client.exec(command, completed);
      });
    } finally {
      client.end();
    }
  }
  async openGuestTcpStream(id: string, port: number, signal?: AbortSignal): Promise<Duplex> {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new AppError('客户机端口无效');
    const script = [
      'import socket,sys,threading',
      `sock=socket.create_connection(("127.0.0.1",${port}),5)`,
      'def upstream():',
      '  try:',
      '    while True:',
      '      data=sys.stdin.buffer.read1(16384)',
      '      if not data: break',
      '      sock.sendall(data)',
      '  finally:',
      '    try: sock.shutdown(socket.SHUT_WR)',
      '    except OSError: pass',
      'threading.Thread(target=upstream,daemon=True).start()',
      'try:',
      '  while True:',
      '    data=sock.recv(16384)',
      '    if not data: break',
      '    sys.stdout.buffer.write(data)',
      '    sys.stdout.buffer.flush()',
      'finally: sock.close()',
    ].join('\n');
    const payload = Buffer.from(script).toString('base64');
    const command = `python3 -u -c "import base64;exec(base64.b64decode('${payload}'))"`;
    const client = await this.connect(id, 10000, signal);
    try {
      const channel = await new Promise<Duplex>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, stream?: Duplex) => {
          if (settled) {
            stream?.destroy();
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', abortPending);
          client.off('close', closedPending);
          error ? reject(error) : resolve(stream!);
        };
        const abortPending = () => finish(new AppError('临时隧道连接已取消', 409));
        const closedPending = () => finish(new Error('SSH connection closed'));
        signal?.addEventListener('abort', abortPending, { once: true });
        client.once('close', closedPending);
        if (signal?.aborted) return abortPending();
        client.exec(command, (error, stream) => finish(error || undefined, stream));
      });
      channel.on('error', () => channel.destroy());
      (channel as typeof channel & { stderr?: { resume(): void } }).stderr?.resume();
      const abort = () => { channel.destroy(); client.destroy(); };
      signal?.addEventListener('abort', abort, { once: true });
      channel.once('close', () => {
        signal?.removeEventListener('abort', abort);
        client.end();
      });
      if (signal?.aborted) abort();
      return channel;
    } catch (error) {
      client.destroy();
      throw error;
    }
  }
  async sftp<T>(
    id: string,
    work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    const client = await this.connect(id, 10000, signal);
    const transport = new AbortController();
    let finish!: (error: unknown, result?: T) => void;
    const failed = (error: Error) => {
      transport.abort(error);
      finish(error);
      client.destroy();
    };
    const closed = () => failed(new Error('SFTP connection closed'));
    const abort = () => failed(signal?.reason || new AppError('文件操作已取消', 409));
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        finish = (error, result) => {
          if (settled) return;
          settled = true;
          error ? reject(error) : resolve(result as T);
        };
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', closed);
        client.on('error', failed);
        if (signal?.aborted) {
          abort();
          return;
        }
        client.sftp((error, ftp) => {
          if (error) {
            failed(error);
            return;
          }
          // ssh2 may leave requests queued forever if a finally block submits
          // cleanup after disconnection. Transport failure must settle this
          // operation independently of those request callbacks.
          ftp.on('error', failed);
          ftp.once('close', closed);
          ftp.once('end', closed);
          if (settled) {
            ftp.end();
            return;
          }
          Promise.resolve()
            .then(() => work(ftp, transport.signal))
            .then((result) => finish(undefined, result), failed);
        });
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      client.off('close', closed);
      client.off('error', failed);
      client.end();
    }
  }
  async files(id: string, path: string) {
    return this.sftp(
      id,
      (ftp) =>
        new Promise((res, rej) =>
          ftp.readdir(guestPath(path), (err, entries) =>
            err
              ? rej(err)
              : res(
                  entries
                    .map((e) => ({
                      name: e.filename,
                      size: e.attrs.size,
                      directory: e.attrs.isDirectory(),
                      symlink: e.attrs.isSymbolicLink(),
                      modified: e.attrs.mtime,
                    }))
                    .sort(
                      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
                    ),
                ),
          ),
        ),
    );
  }
  async readGuestFile(id: string, path: string) {
    return this.sftp(id, async (ftp) => {
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let ended = false;
        const stream = ftp.createReadStream(guestPath(path));
        stream.on('data', (data: Buffer) => {
          size += data.length;
          if (size > MAX_TEXT_BYTES) stream.destroy(new AppError('仅支持预览 1 MiB 以内的文本文件'));
          else if (data.includes(0)) stream.destroy(new AppError('二进制文件不能作为文本编辑'));
          else chunks.push(data);
        });
        stream.on('error', reject);
        stream.on('end', () => {
          ended = true;
        });
        // SFTP closes its remote handle after EOF; keep SSH alive until that completes.
        stream.on('close', () =>
          ended ? resolve(Buffer.concat(chunks)) : reject(new AppError('文件读取未完成')),
        );
      });
      if (!isUtf8(bytes)) throw new AppError('文件不是有效的 UTF-8 文本，请下载原文件处理');
      return bytes.toString('utf8');
    });
  }
  async writeGuestFile(
    id: string,
    path: string,
    content: string,
    overwrite = true,
    expectedVersion?: string,
  ) {
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_TEXT_BYTES) throw new AppError('仅支持保存 1 MiB 以内的文本文件', 413);
    await this.locked(`text:${id}:${path}`, () => {
      const files = new Files(this);
      files.beforeReplace = this.fileBeforeReplace;
      return files.upload(id, path, Readable.from(bytes), overwrite, undefined, expectedVersion);
    });
  }
  async stop(id: string, force = false) {
    return this.locked(id, async () => this.stopInternal(id, force), true);
  }
  async bootGuard(id: string, reset = false) {
    this.get(id);
    if (reset)
      await this.locked(id, async () => {
        this.requireStopped(id);
        await resetBootGuard(id);
      });
    return bootGuardStatus(id);
  }
  async suspend(id: string) {
    return this.locked(id, async () => {
      const live = this.live.get(id);
      if (!live || live.status !== 'running') throw new AppError('只有运行中的发行版可以暂停', 409);
      await qmp(live.qmpPort, 'stop');
      live.status = 'paused';
      this.emit('change');
      return this.view(id);
    });
  }
  async resume(id: string) {
    return this.locked(id, async () => {
      this.requireSandboxLifetime(this.get(id));
      const live = this.live.get(id);
      if (!live || live.status !== 'paused') throw new AppError('只有已暂停的发行版可以恢复', 409);
      if (live.incoming) throw new AppError('迁移接收中的目标实例不能手动恢复', 409);
      await qmp(live.qmpPort, 'cont');
      live.status = 'running';
      this.emit('change');
      return this.view(id);
    });
  }
  private async stopInternal(id: string, force: boolean) {
    this.get(id);
    const live = this.live.get(id);
    if (!live) return this.view(id);
    if (live.incoming) force = true;
    // Guest poweroff can finish before status reaches "stopping". Notify
    // lifecycle observers before sending the graceful shutdown command.
    this.emit('stop-requested', id);
    live.bootAbort.abort();
    if (!force && live.status === 'paused') {
      await qmp(live.qmpPort, 'cont').catch(() => {});
      live.status = 'running';
    }
    if (!force && live.status === 'running') await this.exec(id, 'sync; poweroff', 5000).catch(() => {});
    if (this.live.get(id) !== live) return this.view(id);
    live.status = 'stopping';
    this.emit('change');
    if (!force) {
      await qmp(live.qmpPort, 'system_powerdown').catch(() => {});
      await Promise.race([live.done, delay(15000, undefined, { ref: false })]);
    }
    if (this.live.has(id)) live.abort.abort();
    await live.done;
    return this.view(id);
  }
  async update(id: string, input: unknown | ((current: VMRecord) => unknown),
    guard?: (current: VMRecord) => void) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireMutableConfig(vm);
      this.requireStopped(id);
      guard?.(vm);
      const config = createSchema.parse(typeof input === 'function' ? input(vm) : input);
      if (config.architecture === undefined && vm.architecture)
        config.architecture = vm.architecture;
      if (config.firmware === undefined && vm.architecture === 'aarch64')
        config.firmware = vm.firmware;
      this.requireUnreservedPorts(config.forwards);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture ?? vm.architecture);
      if (config.name !== vm.name) throw new AppError('实例名称创建后不可修改');
      if (config.diskGiB !== vm.diskGiB) throw new AppError('磁盘大小创建后不可修改');
      if (config.storagePoolId !== undefined &&
          config.storagePoolId !== (vm.storagePoolId || 'default'))
        throw new AppError('请使用存储池迁移操作移动已有实例', 409);
      if ((config.distro || 'alpine') !== (vm.distro || 'alpine'))
        throw new AppError('不能更改已有磁盘的发行版');
      if (config.architecture !== undefined && config.architecture !== (vm.architecture || 'x86_64'))
        throw new AppError('不能更改已有磁盘的架构');
      const before = { ...vm };
      if (config.memoryMiB < distroInfo(vm.distro, vm.architecture).minimumMemory)
        throw new AppError('内存低于发行版最低要求');
      createSchema.parse({ ...config, architecture: vm.architecture,
        firmware: config.firmware ?? vm.firmware, hardware: config.hardware ?? vm.hardware });
      this.requireUnreservedPorts(config.forwards);
      Object.assign(vm, config);
      try {
        await this.save();
      } catch (error) {
        for (const key of Object.keys(config) as Array<keyof typeof config>)
          if (!Object.hasOwn(before, key)) delete (vm as any)[key];
        Object.assign(vm, before);
        throw error;
      }
      this.emit('change');
      return this.view(id);
    });
  }
  async configureHardware(id: string, input: unknown,
    expected?: { hardware: unknown; memoryMiB: number; architecture?: string }) {
    const hardware = hardwareSchema.parse(input);
    return this.update(id, (vm: VMRecord) => ({
      name: vm.name, memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB,
      accelerator: vm.accelerator, distro: vm.distro, architecture: vm.architecture,
      template: vm.template, firmware: vm.firmware, forwards: vm.forwards, hardware,
    }), (vm) => {
      if (expected && (JSON.stringify(vm.hardware || {}) !== JSON.stringify(expected.hardware) ||
          vm.memoryMiB !== expected.memoryMiB || vm.architecture !== expected.architecture))
        throw new AppError('实例配置已变化，请重新预览 GPU 档案', 409);
    });
  }
  async hotplug(id: string, kind: 'cpu' | 'memory', target?: number, signal?: AbortSignal) {
    return this.locked('launch', () =>
      this.locked(id, async () => {
        const vm = this.get(id),
          live = this.live.get(id);
        this.requireMutableConfig(vm);
        if (!live || live.status !== 'running') throw new AppError('请先启动发行版', 409);
        signal?.throwIfAborted();
        if (target !== undefined && live.accelerator === 'whpx')
          throw new AppError(
            '当前 Windows QEMU 的 WHPX 热插拔不可靠，请停止后切换到 TCG 兼容模式或离线调整资源',
            409,
            'HOTPLUG_ACCELERATOR_UNSUPPORTED',
          );
        if (kind === 'cpu') {
          const slots = (await qmp(live.qmpPort, 'query-hotpluggable-cpus')) as Array<{
            type: string;
            props: Record<string, number>;
            'qom-path'?: string;
            'vcpus-count': number;
          }>;
          let current = slots
            .filter((slot) => slot['qom-path'])
            .reduce((sum, slot) => sum + slot['vcpus-count'], 0);
          const maximum = slots.reduce((sum, slot) => sum + slot['vcpus-count'], 0);
          const possible = await this.exec(id, 'cat /sys/devices/system/cpu/possible', 10000, signal);
          const guestPossible = possible.code === 0 ? cpuSetSize(possible.stdout) : 0;
          if (target === undefined)
            return {
              kind,
              current,
              maximum,
              slots,
              canAdd: live.accelerator !== 'whpx' && guestPossible > current,
              accelerator: live.accelerator,
              guestPossible,
            };
          if (!Number.isInteger(target) || target <= current || target > maximum || target > 8)
            throw new AppError('仅支持在线增加到预留的 CPU 插槽数量');
          if (guestPossible < target)
            throw new AppError(
              '当前客户机内核没有识别 QEMU 预留的 CPU；请离线调整 CPU 数量，或使用支持当前加速器热插拔的内核',
              409,
              'GUEST_CPU_SLOTS',
            );
          validateAdmission(
            await resourcePolicy(),
            { ...vm, cpus: target },
            [...this.live.keys()].map((key) => this.get(key)),
          );
          const additions = [];
          for (const slot of slots
            .filter((slot) => !slot['qom-path'])
            .sort(
              (a, b) =>
                (a.props['socket-id'] || 0) - (b.props['socket-id'] || 0) ||
                (a.props['core-id'] || 0) - (b.props['core-id'] || 0) ||
                (a.props['thread-id'] || 0) - (b.props['thread-id'] || 0),
            )) {
            if (current === target) break;
            if (current + slot['vcpus-count'] > target) continue;
            additions.push(slot);
            current += slot['vcpus-count'];
          }
          if (current !== target) throw new AppError('目标数量无法匹配可用 CPU 插槽');
          for (const slot of additions) {
            signal?.throwIfAborted();
            await qmp(live.qmpPort, 'device_add', {
              ...slot.props,
              driver: slot.type,
              id: 'sakura-cpu-' + randomUUID(),
            });
            const present = (await qmp(live.qmpPort, 'query-cpus-fast')) as unknown[];
            vm.cpus = present.length;
            await this.save();
          }
          const guest = await this.exec(
            id,
            `set -e; i=0; while [ "$i" -lt 40 ]; do for cpu in /sys/devices/system/cpu/cpu[0-9]*/online; do [ ! -f "$cpu" ] || echo 1 > "$cpu"; done; n=$(grep -c '^processor' /proc/cpuinfo); [ "$n" -lt ${target} ] || { echo "$n"; exit 0; }; i=$((i+1)); sleep 0.25; done; echo "$n"; exit 1`,
            30000,
            signal,
          );
          this.emit('change');
          return {
            kind,
            code: guest.code,
            ready: guest.code === 0,
            current: vm.cpus,
            maximum,
            guestOnline: Number(guest.stdout.trim()) || null,
            guestCode: guest.code,
            ...(guest.code ? { warning: 'CPU 已添加；客户机未确认全部上线：' + guest.stderr } : {}),
          };
        }
        const size = (await qmp(live.qmpPort, 'query-memory-size-summary')) as {
          'base-memory': number;
          'plugged-memory'?: number;
        };
        const devices = (await qmp(live.qmpPort, 'query-memory-devices')) as Array<{
          type: string;
          data: { slot?: number; size?: number; id?: string };
        }>;
        const current = (size['base-memory'] + (size['plugged-memory'] || 0)) / 1024 ** 2;
        const maximum = vm.hardware?.memory?.maxMiB || current;
        if (target === undefined)
          return {
            kind,
            current,
            maximum,
            devices,
            canAdd: live.accelerator !== 'whpx',
            accelerator: live.accelerator,
          };
        if (
          !vm.hardware?.memory ||
          !Number.isInteger(target) ||
          target % 128 ||
          target <= current ||
          target > maximum
        )
          throw new AppError('请先在停止状态预留内存插槽；目标需要按 128 MiB 对齐并大于当前内存');
        validateAdmission(
          await resourcePolicy(),
          { ...vm, memoryMiB: target },
          [...this.live.keys()].map((key) => this.get(key)),
        );
        const used = new Set(devices.map((device) => device.data.slot));
        const slot = Array.from({ length: vm.hardware.memory.slots }, (_, index) => index).find(
          (value) => !used.has(value),
        );
        if (slot === undefined) throw new AppError('没有空闲内存插槽，请停止后调整配置');
        const online = await this.exec(
          id,
          "test -w /sys/devices/system/memory/auto_online_blocks && echo online > /sys/devices/system/memory/auto_online_blocks && awk '/MemTotal:/ { print $2 }' /proc/meminfo",
          15000,
          signal,
        );
        if (online.code) throw new AppError('客户机内核未提供自动上线内存支持');
        const beforeKiB = Number(online.stdout.trim());
        if (!Number.isSafeInteger(beforeKiB) || beforeKiB <= 0) throw new AppError('无法确认客户机当前内存');
        signal?.throwIfAborted();
        const objectId = 'sakura-ram-' + randomUUID();
        await qmp(live.qmpPort, 'object-add', {
          'qom-type': 'memory-backend-ram',
          id: objectId,
          size: (target - current) * 1024 ** 2,
        });
        try {
          await qmp(live.qmpPort, 'device_add', {
            driver: 'pc-dimm',
            id: 'sakura-dimm-' + slot,
            memdev: objectId,
            slot,
          });
        } catch (error) {
          await qmp(live.qmpPort, 'object-del', { id: objectId }).catch(() => {});
          throw error;
        }
        const actual = (await qmp(live.qmpPort, 'query-memory-size-summary')) as typeof size;
        vm.memoryMiB = (actual['base-memory'] + (actual['plugged-memory'] || 0)) / 1024 ** 2;
        await this.save();
        this.emit('change');
        const expectedKiB = Math.floor(beforeKiB + (target - current) * 1024 * 0.95);
        const guest = await this.exec(
          id,
          `i=0; while [ "$i" -lt 40 ]; do n=$(awk '/MemTotal:/ { print $2 }' /proc/meminfo); [ "$n" -lt ${expectedKiB} ] || { echo "$n"; exit 0; }; i=$((i+1)); sleep 0.25; done; echo "$n"; exit 1`,
          30000,
          signal,
        );
        return {
          kind,
          code: guest.code,
          ready: guest.code === 0,
          guestMemoryKiB: Number(guest.stdout.trim()) || null,
          ...(guest.code
            ? { warning: '内存设备已添加；客户机未确认新内存上线，离线重启后使用新增容量。' }
            : {}),
          current: vm.memoryMiB,
          maximum,
          devices: await qmp(live.qmpPort, 'query-memory-devices'),
        };
      }),
    );
  }
  async organize(id: string, input: unknown) {
    const organization = organizationSchema.parse(input);
    organization.tags = [...new Set(organization.tags)];
    return this.locked(id, async () => {
      const vm = this.get(id),
        before = vm.organization;
      vm.organization = organization;
      try {
        await this.save();
      } catch (error) {
        vm.organization = before;
        throw error;
      }
      this.emit('change');
      return this.view(id);
    });
  }
  async resize(id: string, diskGiB: number, signal?: AbortSignal) {
    if (!Number.isInteger(diskGiB) || diskGiB > 128) throw new AppError('磁盘容量必须是 2–128 GiB 的整数');
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireMutableConfig(vm);
      this.requireStopped(id);
      if (diskGiB <= vm.diskGiB) throw new AppError('仅支持扩容，目标容量必须大于当前容量');
      if (vm.snapshots.length >= 20) throw new AppError('请先删除一个快照，为扩容前备份留出位置');
      signal?.throwIfAborted();
      // Before disk growth was supported, all snapshots shared the VM's capacity.
      // Record that size before the first expansion so legacy restores stay accurate.
      for (const shot of vm.snapshots) shot.diskGiB ??= vm.diskGiB;
      await this.createSnapshot(vm, '扩容前自动备份');
      // QEMU metadata updates are allowed to finish even if the request leaves.
      if (vm.diskEncryption)
        await this.withDiskSecret(vm, (file) => this.engine.run('sakura-img', [
          'resize', '--object', qemuSecretObject(file), '--image-opts',
          encryptedImageOptions(join(vmDir(id), 'disk.qcow2')), `${diskGiB}G`,
        ]));
      else await this.engine.run('sakura-img', [
        'resize', '-f', 'qcow2', join(vmDir(id), 'disk.qcow2'), `${diskGiB}G`,
      ]);
      vm.diskGiB = diskGiB;
      vm.pendingResize = true;
      await this.save();
      this.emit('change');
      return this.view(id);
    });
  }
  async completeResize(id: string) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      vm.pendingResize = false;
      await this.save();
      this.emit('change');
    });
  }
  requireStopped(id: string) {
    if (this.live.has(id)) throw new AppError('请先停止发行版，再进行此操作', 409);
    if (this.get(id).liveMigrationFence)
      throw new AppError('在线迁移来源已设置栅栏，请先完成目标验证与安全回退',
        409, 'LIVE_MIGRATION_SOURCE_FENCED');
  }
  /** Holds the source lock until the read-only attachment's QEMU process has exited. */
  async withRescue<T>(
    sourceId: string,
    signal: AbortSignal,
    phase: (text: string) => void,
    work: (rescueId: string, signal: AbortSignal) => Promise<T>,
    diagnostic: (text: string) => void = () => {},
    readOnlyDisk = join(vmDir(sourceId), 'disk.qcow2'),
    comparisonDisk?: string,
    targetDisk?: { file: string; writable: boolean },
  ) {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(35 * 60_000)]);
    this.rescueControllers.add(controller);
    let rescueId: string | undefined;
    const lockdown = (id: string) => {
      if (id === sourceId || id === rescueId) controller.abort();
    };
    this.on('incident-lockdown', lockdown);
    try {
      return await this.locked(sourceId, async () => {
        const source = this.get(sourceId);
        this.requireStopped(sourceId);
        if (source.sandbox) throw new AppError('救援目标必须是普通实例', 409);
        if (source.diskEncryption)
          throw new AppError('加密实例的只读救援尚不支持密钥挂载', 409);
        combined.throwIfAborted();
        try {
          phase('创建临时救援系统');
          const rescue = await this.createInternal(
            {
              name: 'rescue-' + randomUUID().slice(0, 12),
              distro: 'alpine',
              memoryMiB: 512,
              cpus: 1,
              diskGiB: 4,
              accelerator: source.accelerator,
              forwards: [],
              template: 'none',
            },
            {
              network: 'isolated',
              storage: 'discard-on-stop',
              onExpire: 'delete',
              expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
            },
            sourceId,
          );
          rescueId = rescue.id;
          combined.throwIfAborted();
          phase('启动临时救援系统');
          await this.startInternal(rescueId, sourceId);
          const deadline = Date.now() + BOOT_TIMEOUT_MS;
          while (this.state(rescueId) !== 'running') {
            combined.throwIfAborted();
            if (this.state(rescueId) !== 'starting' || Date.now() >= deadline) {
              diagnostic((this.logs.get(rescueId) || '').slice(-8000));
              throw new AppError('临时救援系统启动失败，启动日志已附在任务记录', 409);
            }
            await delay(100, undefined, { signal: combined });
          }
          combined.throwIfAborted();
          this.requireUnlocked(sourceId);
          this.requireStopped(sourceId);
          phase('只读连接源磁盘');
          const port = this.live.get(rescueId)!.qmpPort;
          // Attach only after boot: the source may share the rescue image's filesystem UUID.
          const attach = async (file: string, role: 'source' | 'compare' | 'target', writable = false) => {
            const node = `sakura-rescue-${role}`;
            await qmp(port, 'blockdev-add', {
              driver: 'qcow2',
              'node-name': node,
              'read-only': !writable,
              file: { driver: 'file', filename: file, 'read-only': !writable },
            });
            combined.throwIfAborted();
            await qmp(port, 'device_add', {
              driver: 'virtio-blk-pci',
              drive: node,
              id: `sakura-rescue-${role === 'source' ? 'disk' : role + '-disk'}`,
              bus: role === 'source' ? 'sakura-rescue-port' :
                role === 'compare' ? 'sakura-rescue-compare-port' : 'sakura-rescue-target-port',
              serial: `sakura-${role}`,
            });
            const nodes = (await qmp(port, 'query-named-block-nodes')) as {
              'node-name': string;
              ro: boolean;
            }[];
            if (
              !Array.isArray(nodes) ||
              !nodes.some((entry) => entry['node-name'] === node && entry.ro === !writable)
            )
              throw new AppError(writable ? '救援磁盘未确认读写，已终止任务' :
                '救援磁盘未确认只读，已终止任务', 409);
          };
          await attach(readOnlyDisk, 'source');
          if (comparisonDisk) await attach(comparisonDisk, 'compare');
          if (targetDisk) await attach(targetDisk.file, 'target', targetDisk.writable);
          combined.throwIfAborted();
          return await work(rescueId, combined);
        } finally {
          if (rescueId && this.records.has(rescueId)) {
            phase('停止并清理临时救援系统');
            await this.terminateSandbox(rescueId);
            // During host close, init will clean the expired rescue record next time.
            if (!this.closing) await this.deleteInternal(rescueId, true);
          }
        }
      });
    } finally {
      this.off('incident-lockdown', lockdown);
      this.rescueControllers.delete(controller);
    }
  }
  private snapshotIdentityFile(id: string, snapshotId: string) {
    return join(vmDir(id), `.snapshot-${checkedId(snapshotId)}.json`);
  }
  private async diskIdentity(id: string, snapshotId?: string): Promise<DiskIdentity> {
    const vm = this.get(id);
    if (snapshotId) {
      if (!vm.snapshots.some((shot) => shot.id === snapshotId)) throw new AppError('快照不存在', 404);
      try {
        const identity = JSON.parse(await readFile(this.snapshotIdentityFile(id, snapshotId), 'utf8'));
        if (
          typeof identity.key !== 'string' ||
          typeof identity.seed !== 'string' ||
          (identity.pending !== undefined && typeof identity.pending !== 'string')
        )
          throw new AppError('快照身份数据损坏');
        return { key: identity.key, seed: Buffer.from(identity.seed, 'base64'), pending: identity.pending };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Older snapshots predate identity metadata and retain their current key.
      }
    }
    const dir = vmDir(id);
    const [key, seed, pending] = await Promise.all([
      readFile(join(dir, 'id_rsa'), 'utf8'),
      readFile(join(dir, 'seed.iso')),
      readFile(join(dir, 'identity.json'), 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      }),
    ]);
    return { key, seed, pending };
  }
  async snapshotIdentity(id: string, snapshotId?: string): Promise<{ key: string; seed: Buffer }> {
    const { key, seed } = await this.diskIdentity(id, snapshotId);
    return { key, seed };
  }
  private async vmStateFingerprint(vm: VMRecord, qmpPort: number, accelerator: string) {
    // The command-line QMP listener serves one client at a time.
    const version = await qmp(qmpPort, 'query-version');
    const cpuSlots = await qmp(qmpPort, 'query-hotpluggable-cpus');
    const memorySize = await qmp(qmpPort, 'query-memory-size-summary');
    const memoryDevices = await qmp(qmpPort, 'query-memory-devices');
    return createHash('sha256').update(JSON.stringify({
      version, accelerator, architecture: vm.architecture || 'x86_64',
      distro: vm.distro || 'alpine', firmware: vm.firmware || 'bios',
      memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB,
      hardware: vm.hardware || null, cpuSlots, memorySize, memoryDevices,
    })).digest('hex');
  }
  private async createSnapshot(vm: VMRecord, name: string, onlinePort?: number,
    stateFingerprint?: string) {
    const shot = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      diskGiB: vm.diskGiB,
      pendingResize: !!vm.pendingResize,
      consistency: stateFingerprint ? 'vmstate' as const :
        onlinePort === undefined ? 'offline' as const : 'filesystem' as const,
      ...(stateFingerprint ? { stateFingerprint } : {}),
    };
    const identity = await this.diskIdentity(vm.id);
    const file = this.snapshotIdentityFile(vm.id, shot.id);
    await writeFile(file, JSON.stringify({ ...identity, seed: identity.seed.toString('base64') }), {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      if (onlinePort === undefined)
        await this.trustedBootSnapshot?.capture(vm.id, shot.id);
      else await this.trustedBootSnapshot?.ensureOnlineAllowed(vm.id);
      if (onlinePort === undefined) {
        if (vm.diskEncryption)
          await this.withDiskSecret(vm, (secret) => this.engine.run('sakura-img', [
            'snapshot', '--object', qemuSecretObject(secret), '--image-opts',
            '-c', shot.id, encryptedImageOptions(join(vmDir(vm.id), 'disk.qcow2')),
          ]));
        else await this.engine.run('sakura-img',
          ['snapshot', '-c', shot.id, join(vmDir(vm.id), 'disk.qcow2')]);
      }
      else if (stateFingerprint)
        await qmpSnapshotJob(onlinePort, 'snapshot-save', shot.id);
      else
        await qmp(onlinePort, 'blockdev-snapshot-internal-sync',
          { device: 'sakura-disk', name: shot.id }, 30000);
    } catch (error) {
      await rm(file, { force: true });
      await this.trustedBootSnapshot?.remove(vm.id, shot.id);
      throw error;
    }
    vm.snapshots.push(shot);
    await this.save();
    return shot;
  }
  async snapshot(id: string, name: string) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个磁盘快照');
      return this.createSnapshot(vm, name);
    });
  }
  async onlineSnapshot(id: string, name: string) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      const live = this.live.get(id);
      if (!live || live.status !== 'running') throw new AppError('在线快照要求实例正在运行', 409);
      if (vm.sandbox?.storage === 'discard-on-stop')
        throw new AppError('临时写时复制实例不能保存在线快照', 409);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个磁盘快照');
      await this.trustedBootSnapshot?.ensureOnlineAllowed(id);
      let agent: GuestAgent | undefined;
      try {
        agent = await GuestAgent.connect(live.agentPort);
        await agent.execute('guest-ping', undefined, 5000);
      } catch (error) {
        agent?.close();
        throw new AppError(`客户机代理不可用；请在 Linux 内安装并启动 qemu-guest-agent：${String((error as Error).message || error)}`, 409);
      }
      let freezeAttempted = false;
      let freezeCount = 0;
      let failure: unknown;
      let result: Awaited<ReturnType<typeof this.createSnapshot>> | undefined;
      try {
        freezeAttempted = true;
        const count = await agent.execute('guest-fsfreeze-freeze', undefined, 30000);
        if (typeof count !== 'number' || count < 1)
          throw new AppError('客户机代理未冻结任何文件系统，已取消在线快照', 409);
        freezeCount = count;
        result = await this.createSnapshot(vm, name, live.qmpPort);
      } catch (error) {
        failure = error;
      } finally {
        if (freezeAttempted) {
          try {
            const thawed = await agent.execute('guest-fsfreeze-thaw', undefined, 30000);
            if (freezeCount > 0 && (typeof thawed !== 'number' || thawed < freezeCount))
              throw new Error(`仅解冻 ${String(thawed)} / ${freezeCount} 个文件系统`);
          } catch (error) {
            failure = new AppError(`文件系统解冻失败，实例将停止以解除冻结：${String((error as Error).message || error)}`, 500);
            await this.stopInternal(id, true).catch(() => {});
          }
        }
        agent.close();
      }
      if (failure) throw failure;
      return result!;
    });
  }
  async memorySnapshot(id: string, name: string) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      const live = this.live.get(id);
      if (!live || live.status !== 'running')
        throw new AppError('整机状态快照要求实例正在运行', 409);
      if (vm.rescueOf) throw new AppError('临时救援实例不能保存整机状态', 409);
      if (live.accelerator !== 'tcg')
        throw new AppError('当前 WHPX 无法保存 RAM 状态；请停机后将加速器切换为 TCG', 409);
      if (vm.sandbox?.storage === 'discard-on-stop' || vm.diskEncryption ||
          vm.firmware === 'uefi')
        throw new AppError('当前实例的临时磁盘、加密磁盘或 UEFI NVRAM 不支持整机状态快照', 409);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个快照');
      const fingerprint = await this.vmStateFingerprint(vm, live.qmpPort, live.accelerator);
      return this.createSnapshot(vm, name, live.qmpPort, fingerprint);
    });
  }
  async restoreMemory(id: string, snapshotId: string, backup = false) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      const shot = vm.snapshots.find((item) => item.id === snapshotId);
      if (!shot || shot.consistency !== 'vmstate' || !shot.stateFingerprint)
        throw new AppError('整机状态快照不存在', 404);
      const live = this.live.get(id);
      if (!live || live.status !== 'running')
        throw new AppError('请先启动实例，再恢复整机状态', 409);
      if (live.accelerator !== 'tcg')
        throw new AppError('当前 WHPX 无法恢复 RAM 状态；请停机后将加速器切换为 TCG', 409);
      if (vm.sandbox?.storage === 'discard-on-stop' || vm.diskEncryption ||
          vm.firmware === 'uefi')
        throw new AppError('当前实例的临时磁盘、加密磁盘或 UEFI NVRAM 不支持整机状态恢复', 409);
      const fingerprint = await this.vmStateFingerprint(vm, live.qmpPort, live.accelerator);
      if (fingerprint !== shot.stateFingerprint)
        throw new AppError('QEMU 版本或实例硬件已变化，拒绝恢复不兼容的 RAM 状态', 409);
      const [currentIdentity, snapshotIdentity] = await Promise.all([
        this.diskIdentity(id), this.diskIdentity(id, snapshotId),
      ]);
      if (currentIdentity.key !== snapshotIdentity.key ||
          !currentIdentity.seed.equals(snapshotIdentity.seed) ||
          currentIdentity.pending !== snapshotIdentity.pending)
        throw new AppError('实例控制身份或初始化镜像已变化，拒绝加载不匹配的整机状态', 409);
      if (backup) {
        if (vm.snapshots.length >= 20)
          throw new AppError('请先删除一个旧快照，为恢复前备份留出位置', 409);
        await this.createSnapshot(vm, '恢复前整机状态自动备份', live.qmpPort, fingerprint);
      }
      await qmpSnapshotJob(live.qmpPort, 'snapshot-load', shot.id);
      const status = await qmp(live.qmpPort, 'query-status');
      if (!status || typeof status !== 'object' ||
          (status as { running?: boolean }).running !== true)
        throw new AppError('整机状态已加载，但客户机尚未恢复运行，请检查实例', 409);
      for (const client of live.clients) client.destroy();
      this.emit('change');
      return this.view(id);
    });
  }
  async restore(id: string, snapshotId: string, backup = false) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      const selected = vm.snapshots.find((s) => s.id === snapshotId);
      if (!selected) throw new AppError('快照不存在', 404);
      if (selected.consistency === 'vmstate')
        throw new AppError('此快照包含 RAM 状态，请启动实例并使用整机状态恢复', 409);
      const identity = await this.diskIdentity(id, snapshotId);
      const restoreTrusted = await this.trustedBootSnapshot?.prepareRestore(id, snapshotId);
      if (backup) {
        if (vm.snapshots.length >= 20) throw new AppError('请先删除一个旧快照，为恢复前备份留出位置');
        await this.createSnapshot(vm, '恢复前自动备份');
      }
      if (vm.diskEncryption)
        await this.withDiskSecret(vm, (secret) => this.engine.run('sakura-img', [
          'snapshot', '--object', qemuSecretObject(secret), '--image-opts',
          '-a', snapshotId, encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
        ]));
      else await this.engine.run('sakura-img',
        ['snapshot', '-a', snapshotId, join(vmDir(id), 'disk.qcow2')]);
      const restored = vm.snapshots.find((s) => s.id === snapshotId)!;
      if (restored.diskGiB) vm.diskGiB = restored.diskGiB;
      vm.pendingResize = !!restored.pendingResize;
      const dir = vmDir(id);
      await writeIdentityFile(join(dir, 'id_rsa'), identity.key);
      await writeIdentityFile(join(dir, 'seed.iso'), identity.seed);
      if (identity.pending !== undefined)
        await writeIdentityFile(join(dir, 'identity.json'), identity.pending);
      else await rm(join(dir, 'identity.json'), { force: true });
      await restoreTrusted?.();
      delete vm.lastError;
      await this.save();
      return this.view(id);
    });
  }
  private async fingerprint(id: string): Promise<MigrationFingerprint> {
    const dir = vmDir(id);
    const disk = await stat(join(dir, 'disk.qcow2'));
    if (!disk.isFile()) throw new AppError('实例磁盘文件无效', 409);
    const metadata = createHash('sha256').update(JSON.stringify(this.get(id)));
    const names = (await readdir(dir)).filter((name) =>
      ['id_rsa', 'seed.iso', 'project.json', 'projects.json'].includes(name) ||
      /^project-[a-f0-9]{16}\.json$/.test(name)).sort();
    for (const name of names) {
      const contents = await readFile(join(dir, name));
      metadata.update(name).update(String(contents.length)).update(contents);
    }
    if (this.trustedBootStateFingerprint)
      metadata.update(await this.trustedBootStateFingerprint(id));
    return { recordHash: metadata.digest('hex'),
      diskSize: disk.size, diskMtimeMs: disk.mtimeMs };
  }
  async migrationFingerprint(id: string) {
    return this.locked(id, async () => {
      this.requireStopped(id);
      return this.fingerprint(id);
    });
  }
  async moveStoragePool(id: string, targetPoolId: string, signal?: AbortSignal,
    log: (text: string) => void = () => {}) {
    return this.locked('storage-pools', () => this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      this.requireMutableConfig(vm);
      signal?.throwIfAborted();
      const sourcePoolId = vm.storagePoolId || 'default';
      if (this.storagePools.hasPendingCleanup(id))
        throw new AppError('请先清理此前存储池迁移的旧副本', 409);
      if (sourcePoolId === targetPoolId)
        return { moved: false, from: sourcePoolId, to: targetPoolId, vm: await this.view(id) };
      const sourceRoot = await this.storagePools.ensure(sourcePoolId);
      const targetRoot = await this.storagePools.ensure(targetPoolId);
      const source = await regularDirectory(vmDir(id));
      const target = this.storagePools.directory(id, targetPoolId);
      const stage = join(targetRoot, `.move-${checkedId(id)}-${randomUUID()}`);
      if (!within(sourceRoot, source) || !within(targetRoot, target) ||
          !within(targetRoot, stage))
        throw new AppError('存储池迁移路径超出受控目录', 409);
      const existing = await lstat(target).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (existing) throw new AppError('目标存储池中已有同标识目录，请先检查', 409);
      log('正在复制并校验实例目录…\n');
      try {
        await copyDirectoryVerified(source, stage, signal, log);
        signal?.throwIfAborted();
        await rename(stage, target);
      } catch (error) {
        await regularDirectory(stage);
        await rm(stage, { recursive: true, force: true });
        throw error;
      }
      try {
        await this.storagePools.registerCleanup(id, sourcePoolId, targetPoolId);
      } catch (error) {
        await regularDirectory(target);
        await rm(target, { recursive: true, force: true });
        throw error;
      }
      vm.storagePoolId = targetPoolId === 'default' ? undefined : targetPoolId;
      this.storagePools.bind(id, targetPoolId);
      try {
        await this.save();
      } catch (error) {
        vm.storagePoolId = sourcePoolId === 'default' ? undefined : sourcePoolId;
        this.storagePools.bind(id, sourcePoolId);
        await regularDirectory(target);
        await rm(target, { recursive: true, force: true });
        await this.storagePools.clearCleanup(id, sourcePoolId, targetPoolId);
        throw error;
      }
      let cleanupPending = false;
      try {
        await regularDirectory(source);
        await rm(source, { recursive: true, force: true });
        await this.storagePools.clearCleanup(id, sourcePoolId, targetPoolId);
      } catch (error) {
        cleanupPending = true;
        log(`旧存储池目录待清理：${String((error as Error).message || error)}\n`);
      }
      this.emit('change');
      return { moved: true, from: sourcePoolId, to: targetPoolId, cleanupPending,
        vm: await this.view(id) };
    }));
  }
  async delete(id: string, expected?: MigrationFingerprint) {
    return this.deleteInternal(id, false, expected);
  }
  private async deleteInternal(id: string, allowIncident = false,
    expected?: MigrationFingerprint) {
    return this.locked('storage-pools', () => this.locked(
      id,
      async () => {
        this.get(id);
        this.requireStopped(id);
        if (this.storagePools.hasPendingCleanup(id))
          throw new AppError('请先清理存储池迁移的旧副本，再删除实例', 409);
        if (expected) {
          const current = await this.fingerprint(id);
          if (current.recordHash !== expected.recordHash ||
              current.diskSize !== expected.diskSize ||
              current.diskMtimeMs !== expected.diskMtimeMs)
            throw new AppError('源实例在迁移后已变化，保留源实例，请重新预览', 409);
        }
        const vm = this.get(id);
        await this.removeVmDirectory(vm);
        this.records.delete(id);
        this.logs.delete(id);
        await this.save();
        this.storagePools.unbind(id);
      },
      allowIncident,
    ));
  }
  async editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null) {
    return this.locked(id, async () => {
      this.requireStopped(id);
      const vm = this.get(id);
      const shot = vm.snapshots.find((s) => s.id === snapshotId);
      if (!shot) throw new AppError('快照不存在', 404);
      if (patch) Object.assign(shot, patch);
      else {
        if (vm.diskEncryption)
          await this.withDiskSecret(vm, (secret) => this.engine.run('sakura-img', [
            'snapshot', '--object', qemuSecretObject(secret), '--image-opts',
            '-d', shot.id, encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
          ]));
        else await this.engine.run('sakura-img',
          ['snapshot', '-d', shot.id, join(vmDir(id), 'disk.qcow2')]);
        vm.snapshots = vm.snapshots.filter((s) => s !== shot);
        await rm(this.snapshotIdentityFile(id, shot.id), { force: true });
        await this.trustedBootSnapshot?.remove(id, shot.id);
      }
      await this.save();
      this.emit('change');
      return this.view(id);
    });
  }
  async setForwards(id: string, input: unknown, expected?: VMConfig['forwards']) {
    return this.locked('launch', () =>
      this.locked(id, async () => {
        const vm = this.get(id);
        this.requireMutableConfig(vm);
        if (expected && JSON.stringify(vm.forwards) !== JSON.stringify(expected))
          throw new AppError('端口映射已变化，请重新预览', 409);
        const previous = vm.forwards;
        let rollback = async () => {};
        const parsed = createSchema.parse({ name: vm.name, forwards: input }).forwards;
        this.requireUnreservedPorts(parsed);
        for (const [otherId, other] of this.records) {
          if (
            otherId !== id &&
            this.live.has(otherId) &&
            other.forwards.some((p) => parsed.some((n) => n.host === p.host))
          )
            throw new AppError('主机端口已被其他运行中的实例使用', 409);
        }
        const live = this.live.get(id);
        if (live && live.status !== 'running') throw new AppError('请等待实例启动或停止完成', 409);
        if (live) {
          const removed = vm.forwards.filter(
            (p) => !parsed.some((n) => n.host === p.host && n.guest === p.guest),
          );
          const added = parsed.filter(
            (p) => !vm.forwards.some((n) => n.host === p.host && n.guest === p.guest),
          );
          const applied: typeof parsed = [],
            taken: typeof parsed = [];
          const command = async (verb: 'add' | 'remove', p: (typeof parsed)[number]) => {
            const output = await qmp(live.qmpPort, 'human-monitor-command', {
              'command-line':
                verb === 'add'
                  ? `hostfwd_add sakura-net tcp:127.0.0.1:${p.host}-:${p.guest}`
                  : `hostfwd_remove sakura-net tcp:127.0.0.1:${p.host}`,
            });
            if (typeof output === 'string' && /could not|error|invalid|not found/i.test(output))
              throw new AppError(output.trim());
          };
          rollback = async () => {
            const failures: string[] = [];
            for (const p of [...applied].reverse())
              await command('remove', p).catch((error) => failures.push(String(error)));
            for (const p of taken) await command('add', p).catch((error) => failures.push(String(error)));
            if (failures.length) throw new AppError('端口修改失败，回滚未完成：' + failures.join('；'), 409);
          };
          try {
            for (const p of removed) {
              await command('remove', p);
              taken.push(p);
            }
            for (const p of added) {
              await command('add', p);
              applied.push(p);
            }
          } catch (error) {
            await rollback();
            throw error;
          }
        }
        vm.forwards = parsed;
        try {
          await this.save();
        } catch (error) {
          vm.forwards = previous;
          await rollback();
          throw error;
        }
        this.emit('change');
        return this.view(id);
      }),
    );
  }
  async setMemoryTarget(id: string, memoryMiB: number) {
    return this.locked(id, async () => {
      const vm = this.get(id),
        live = this.live.get(id);
      if (!live || live.status !== 'running') throw new AppError('请先启动发行版', 409);
      if (!Number.isInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > vm.memoryMiB)
        throw new AppError(`动态内存目标必须在 256 MiB 到 ${vm.memoryMiB} MiB 之间`);
      await qmp(live.qmpPort, 'balloon', { value: memoryMiB * 1024 * 1024 });
      live.memoryTargetMiB = memoryMiB;
      this.emit('change');
      return this.view(id);
    });
  }
  // Provision a converted cloud image with a new controller identity on its first boot.
  async importDisk(
    input: unknown,
    disk: string,
    options: { signal?: AbortSignal; pendingResize?: boolean } = {},
  ) {
    return this.locked('storage-pools', () => this.locked('create', async () => {
      const { signal, pendingResize } = options;
      const config = createSchema.parse(input);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture);
      if (!config.distro || (config.template && config.template !== 'none'))
        throw new AppError('导入镜像需要选择 Linux 发行版，且不能自动安装模板');
      const image = distroInfo(config.distro, config.architecture);
      if (config.memoryMiB < image.minimumMemory || config.diskGiB < image.minimumDisk)
        throw new AppError(
          `${image.name} 至少需要 ${image.minimumMemory} MiB 内存、${image.minimumDisk} GiB 磁盘`,
        );
      if (this.records.size >= 32 || [...this.records.values()].some((vm) => vm.name === config.name))
        throw new AppError('名称已存在或已达到 32 个实例上限', 409);
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: false,
        pendingResize: !!pendingResize,
      };
      const dir = await this.prepareVmDirectory(vm);
      let saved = false;
      try {
        signal?.throwIfAborted();
        const key = createSshKey();
        const seed = seedIso({
          'meta-data': metaData(vm.id, vm.name, key.publicText),
          'user-data':
            vm.distro === 'alpine'
              ? userData(vm.name, key.publicText)
              : cloudUserData(vm.name, key.publicText,
                vm.architecture === 'aarch64' ? '/dev/ttyAMA0' : '/dev/ttyS0'),
          ...(vm.distro === 'alpine' ? {} : { 'network-config': cloudNetwork }),
        });
        await pipeline(
          createReadStream(disk),
          createWriteStream(join(dir, 'disk.qcow2'), { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        await writeFile(join(dir, 'id_rsa'), key.privateText, { mode: 0o600 });
        await writeFile(join(dir, 'seed.iso'), seed);
        signal?.throwIfAborted();
        this.records.set(vm.id, vm);
        await this.save();
        saved = true;
        signal?.throwIfAborted();
        this.emit('change');
        return this.view(vm.id);
      } catch (error) {
        this.records.delete(vm.id);
        if (saved) await this.save();
        await this.removeVmDirectory(vm);
        this.storagePools.unbind(vm.id);
        throw error;
      }
    }));
  }
  // Publish a validated standalone disk and rotate its controller key at first boot.
  async adopt(
    input: unknown,
    disk: string,
    key: string,
    seed: Buffer,
    project?: unknown,
    pendingResize = false,
    projects?: { active: string; projects: { id: string; name: string }[]; configs: Record<string, unknown> },
    migrationOrigin?: VMRecord['migrationOrigin'],
    diskEncryption?: VMRecord['diskEncryption'],
    branchOrigin?: VMRecord['branchOrigin'],
  ) {
    return this.locked('storage-pools', () => this.locked('create', async () => {
      const config = createSchema.parse(input);
      if (migrationOrigin && [...this.records.values()].some((vm) =>
        vm.migrationOrigin?.sourceHostId === migrationOrigin.sourceHostId &&
        vm.migrationOrigin.transferId === migrationOrigin.transferId))
        throw new AppError('此迁移任务已经导入', 409);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture);
      if (this.records.size >= 32 || [...this.records.values()].some((v) => v.name === config.name))
        throw new AppError('名称已存在或已达到 32 个实例上限', 409);
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: true,
        pendingResize,
        ...(migrationOrigin ? { migrationOrigin } : {}),
        ...(diskEncryption ? { diskEncryption: diskEncryptionSchema.parse(diskEncryption) } : {}),
        ...(branchOrigin ? { branchOrigin } : {}),
      };
      const dir = await this.prepareVmDirectory(vm);
      try {
        await copyFile(disk, join(dir, 'disk.qcow2'));
        if (branchOrigin) await copyFile(disk, join(dir, 'branch-base.qcow2'));
        await writeFile(join(dir, 'id_rsa'), key, { mode: 0o600 });
        await writeFile(join(dir, 'seed.iso'), seed);
        await writeFile(join(dir, 'identity.json'), JSON.stringify(createSshKey()), { mode: 0o600 });
        if (projects) {
          await writeFile(
            join(dir, 'projects.json'),
            JSON.stringify({ active: projects.active, projects: projects.projects }, null, 2),
          );
          for (const entry of projects.projects)
            if (projects.configs[entry.id])
              await writeFile(
                join(dir, entry.id === 'default' ? 'project.json' : `project-${entry.id}.json`),
                JSON.stringify(projects.configs[entry.id], null, 2),
              );
        } else if (project) await writeFile(join(dir, 'project.json'), JSON.stringify(project, null, 2));
        this.records.set(vm.id, vm);
        await this.save();
        this.emit('change');
        return this.view(vm.id);
      } catch (error) {
        this.records.delete(vm.id);
        await this.removeVmDirectory(vm);
        this.storagePools.unbind(vm.id);
        throw error;
      }
    }));
  }
  async recordMerge(id: string, origin: NonNullable<VMRecord['mergeOrigin']>) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      vm.mergeOrigin = origin;
      await this.save();
      this.emit('change');
      return this.view(id);
    });
  }
  async close() {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    for (const controller of this.rescueControllers) controller.abort();
    clearInterval(this.sandboxTimer);
    this.closeTask = (async () => {
      await this.sandboxSweep;
      await this.incidentWrites.catch(() => {});
      // Launch and disk operations admitted before shutdown must settle before
      // taking the final live-process snapshot or releasing their runtime.
      await Promise.allSettled([...this.operations]);
      await Promise.allSettled([...this.live.keys()].map((id) => this.stopInternal(id, false)));
      await this.saveQueue.catch(() => {});
      await this.engine.runtime.close();
    })();
    return this.closeTask;
  }
}
