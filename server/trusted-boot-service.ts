import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { BootAttachment, Machines } from './machines.ts';
import { AppError, DATA, vmDir, type VMRecord } from './model.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';
import { inspectTrustedBoot, probeTrustedBootHost, trustedBootPaths } from './trusted-boot.ts';

const policySchema = z.object({ enabled: z.boolean() }).strict();
type Policy = z.infer<typeof policySchema>;
export const trustedBootRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('check') }).strict(),
]);
type Active = { boot: object; close: () => Promise<void> };

export function trustedBootArguments(socket: string) {
  const path = socket.replaceAll(',', ',,');
  return ['-global', 'driver=cfi.pflash01,property=secure,value=on',
    '-chardev', `socket,id=sakura-tpm,path=${path}`,
    '-tpmdev', 'emulator,id=sakura-tpmdev,chardev=sakura-tpm',
    '-device', 'tpm-tis,tpmdev=sakura-tpmdev'];
}

export class TrustedBootService {
  private policies: Record<string, Policy> = {};
  private active = new Map<string, Active>();
  private writes = Promise.resolve();
  private closed = false;
  constructor(private machines: Machines,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {}) {}

  async init() {
    this.policies = z.record(z.uuid(), policySchema).parse(
      await readStore(join(DATA, 'trusted-boot.json'), () => ({})));
    this.machines.prepareTrustedFirmware = async (vm) => {
      if (!this.policies[vm.id]?.enabled) return undefined;
      if (this.closed || this.blocked()) throw new AppError('TPM 与安全启动暂不可启动', 409);
      await this.requireSupported(vm);
      return this.firmware(vm.id);
    };
    this.machines.prepareTrustedBootAttachment = (vm, onExit) => this.prepare(vm, onExit);
  }

  private async save(id: string, policy: Policy) {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = { ...this.policies, [id]: policy };
      await writeStore(join(DATA, 'trusted-boot.json'), next);
      this.policies = next;
    });
    this.writes = operation;
    await operation;
  }

  private async requireSupported(vm: VMRecord) {
    if (process.platform !== 'linux' || vm.architecture === 'aarch64')
      throw new AppError('TPM 与安全启动目前需要 Linux x86_64 宿主和客户机', 503);
    if (vm.firmware !== 'uefi')
      throw new AppError('启用安全启动前，请先把实例固件设为 UEFI', 409);
    if (!vm.distro || vm.distro === 'alpine')
      throw new AppError('当前安全启动链仅支持 Debian 和 Ubuntu 镜像', 409);
    const host = await probeTrustedBootHost();
    if (!host.secureFirmware || !host.varsTemplate || !host.smm ||
        !host.tpmBackend || !host.swtpm)
      throw new AppError('宿主缺少预登记安全启动固件、QEMU TPM/SMM 后端或 swtpm', 503);
  }

  private async firmware(id: string) {
    const paths = trustedBootPaths();
    const directory = vmDir(id);
    await regularDirectory(directory);
    const vars = join(directory, 'uefi-secure-vars.fd');
    try {
      await copyFile(paths.varsTemplate, vars, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const [source, target] = await Promise.all([stat(paths.varsTemplate), lstat(vars)]);
    if (!target.isFile() || target.isSymbolicLink() || target.size !== source.size)
      throw new AppError('实例安全启动 NVRAM 文件类型或容量无效', 409);
    await chmod(vars, 0o600);
    return { code: paths.secureFirmware, vars };
  }

  private async prepare(vm: VMRecord,
    onExit: (error: string) => void): Promise<BootAttachment | undefined> {
    if (!this.policies[vm.id]?.enabled) return undefined;
    if (this.closed || this.blocked()) throw new AppError('TPM 与安全启动暂不可启动', 409);
    await this.requireSupported(vm);
    const stateDir = join(vmDir(vm.id), 'tpm2');
    await regularDirectory(stateDir);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    const dir = await mkdtemp(join(tmpdir(), 'sakura-tpm-'));
    const socket = join(dir, 'tpm.sock');
    const child = spawn(trustedBootPaths().swtpm,
      ['socket', '--tpm2', '--tpmstate', `dir=${stateDir},mode=0600`,
        '--ctrl', `type=unixio,path=${socket},mode=0600`, '--terminate'],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let closing = false, exited = false, failure = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      failure = (failure + chunk.toString()).slice(-16_384);
    });
    child.on('error', (error) => { failure = error.message; exited = true; });
    child.on('exit', (code, signal) => {
      exited = true;
      if (!closing) onExit(failure.trim() || `exit=${code}, signal=${signal}`);
    });
    const close = async () => {
      if (closing) return;
      closing = true;
      if (!exited) {
        const stopped = new Promise<void>((resolve) => child.once('close', () => resolve()));
        child.kill('SIGTERM');
        await Promise.race([stopped, delay(2000)]);
        if (!exited) {
          child.kill('SIGKILL');
          await stopped;
        }
      }
      await rm(dir, { recursive: true, force: true });
    };
    try {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline && !exited) {
        if ((await lstat(socket).catch(() => null))?.isSocket()) {
          const active: Active = { boot: this.machines.live.get(vm.id)!, close };
          this.active.set(vm.id, active);
          return { args: trustedBootArguments(socket),
            machine: 'q35,smm=on', close: async () => {
              if (this.active.get(vm.id) === active) this.active.delete(vm.id);
              await close();
            } };
        }
        await delay(50);
      }
      throw new AppError(failure.trim() || 'swtpm 未在限时内创建套接字', 503);
    } catch (error) {
      await close();
      throw error;
    }
  }

  async view(id: string) {
    this.machines.get(id);
    const active = this.active.get(id);
    return { policy: this.policies[id] || { enabled: false },
      stopped: this.machines.state(id) === 'stopped',
      attached: !!active && active.boot === this.machines.live.get(id) &&
        this.machines.state(id) === 'running' };
  }

  async action(id: string, raw: unknown) {
    const input = trustedBootRequest.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    if (input.operation === 'check')
      return { ...await inspectTrustedBoot(this.machines, id), policy: this.policies[id] || { enabled: false } };
    this.mutation(1);
    try {
      await this.machines.locked(id, async () => {
        this.machines.requireStopped(id);
        if (input.policy.enabled) await this.requireSupported(vm);
        await this.save(id, input.policy);
      });
      return this.view(id);
    } finally { this.mutation(-1); }
  }

  async close() {
    this.closed = true;
    await this.writes;
    await Promise.allSettled([...this.active.values()].map((entry) => entry.close()));
    this.active.clear();
    this.machines.prepareTrustedFirmware = undefined;
    this.machines.prepareTrustedBootAttachment = undefined;
  }
}
