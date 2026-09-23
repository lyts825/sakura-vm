import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, rename, rm, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { Client, type SFTPWrapper } from 'ssh2';
import { StringDecoder } from 'node:string_decoder';
import { isUtf8 } from 'node:buffer';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
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
  type VMRecord,
  type VMView,
  type VMStatus,
} from './model.ts';
import { createSshKey, seedIso, userData, metaData, bootSetup, cloudUserData, cloudNetwork } from './seed.ts';
import { distroInfo } from './images.ts';
import { Files, MAX_TEXT_BYTES } from './files.ts';
import { freePort, qmp } from './qmp.ts';
import type { Engine } from './runtime.ts';

export const BOOT_TIMEOUT_MS = 270_000;
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

type Live = {
  status: VMStatus;
  accelerator: 'tcg' | 'whpx';
  startedAt: string;
  sshPort: number;
  qmpPort: number;
  serialPort: number;
  abort: AbortController;
  bootAbort: AbortController;
  bootstrapKnown?: boolean;
  serialConnected?: boolean;
  serialReady?: boolean;
  serialTail?: string;
  done: Promise<void>;
  bootDone?: Promise<void>;
  serial?: Socket;
  clients: Set<Client>;
  memoryTargetMiB?: number;
  error?: string;
};
export class Machines extends EventEmitter {
  fileBeforeReplace?: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>;
  records = new Map<string, VMRecord>();
  live = new Map<string, Live>();
  logs = new Map<string, string>();
  private locks = new Set<string>();
  private startAttempts = new Map<string, number[]>();
  private operations = new Set<Promise<void>>();
  private closeTask?: Promise<void>;
  closing = false;
  maintenance = false;
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
    try {
      const records = JSON.parse(await readFile(join(DATA, 'machines.json'), 'utf8')) as VMRecord[];
      for (const r of records) {
        vmDir(r.id);
        createSchema.parse({
          name: r.name,
          memoryMiB: r.memoryMiB,
          cpus: r.cpus,
          diskGiB: r.diskGiB,
          accelerator: r.accelerator,
          forwards: r.forwards,
          distro: r.distro,
          template: r.template,
        });
        this.records.set(r.id, r);
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
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
  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.closing) throw new AppError('服务正在关闭', 503);
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
      machine: 'q35',
      memoryMiB: vm.memoryMiB,
      cpus: vm.cpus,
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
  async create(input: unknown) {
    return this.locked('create', async () => {
      const config = createSchema.parse(input);
      if ([...this.records.values()].some((v) => v.name === config.name))
        throw new AppError('该名称已存在', 409);
      const image = distroInfo(config.distro);
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
        bootstrapped: false,
      };
      const dir = vmDir(vm.id);
      await mkdir(dir);
      try {
        const key = createSshKey();
        await writeFile(join(dir, 'id_rsa'), key.privateText, { mode: 0o600 });
        await writeFile(
          join(dir, 'seed.iso'),
          seedIso({
            'meta-data': metaData(vm.id, vm.name, key.publicText),
            'user-data':
              vm.distro && vm.distro !== 'alpine'
                ? cloudUserData(vm.name, key.publicText)
                : userData(vm.name, key.publicText),
            ...(vm.distro && vm.distro !== 'alpine' ? { 'network-config': cloudNetwork } : {}),
          }),
        );
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
        this.records.set(vm.id, vm);
        await this.save();
        return this.view(vm.id);
      } catch (e) {
        this.records.delete(vm.id);
        await rm(dir, { recursive: true, force: true });
        throw e;
      }
    });
  }
  async start(id: string) {
    return this.locked('launch', () =>
      this.locked(id, async () => {
        const vm = this.get(id);
        if (this.live.has(id)) return this.view(id);
        const now = Date.now();
        const attempts = (this.startAttempts.get(id) || []).filter((at) => now - at < 5 * 60_000);
        if (attempts.length >= 5)
          throw new AppError('该发行版在 5 分钟内连续启动失败，请检查启动日志后再试', 409);
        attempts.push(now);
        this.startAttempts.set(id, attempts);
        if (this.live.size >= 4) throw new AppError('轻量模式最多同时运行 4 个发行版', 409);
        for (const otherId of this.live.keys())
          for (const p of this.get(otherId).forwards)
            if (vm.forwards.some((n) => n.host === p.host))
              throw new AppError(`端口 ${p.host} 已被另一实例使用`, 409);
        const [sshPort, qmpPort, serialPort] = await Promise.all([freePort(), freePort(), freePort()]);
        const accelerator =
          vm.accelerator === 'auto' ? (this.engine.whpxAvailable ? 'whpx' : 'tcg') : vm.accelerator;
        const live: Live = {
          status: 'starting',
          accelerator,
          startedAt: new Date().toISOString(),
          sshPort,
          qmpPort,
          serialPort,
          abort: new AbortController(),
          bootAbort: new AbortController(),
          bootstrapKnown: vm.bootstrapped !== false,
          serialConnected: false,
          serialReady: false,
          serialTail: '',
          done: Promise.resolve(),
          clients: new Set(),
        };
        this.live.set(id, live);
        const previousError = vm.lastError;
        delete vm.lastError;
        this.logs.set(id, '');
        try {
          await this.save();
        } catch (error) {
          this.live.delete(id);
          if (previousError !== undefined) vm.lastError = previousError;
          throw error;
        }
        const dir = vmDir(id);
        const escape = (s: string) => s.replaceAll(',', ',,');
        const forwards = [
          `hostfwd=tcp:127.0.0.1:${sshPort}-:22`,
          ...vm.forwards.map((p) => `hostfwd=tcp:127.0.0.1:${p.host}-:${p.guest}`),
        ];
        const args = [
          '-name',
          `sakura-${vm.name}`,
          '-machine',
          'q35',
          '-nodefaults',
          '-boot',
          'order=c,menu=off',
          ...(!vm.distro || vm.distro === 'alpine' ? ['-smbios', 'type=1,serial=ds=nocloud'] : []),
          '-accel',
          // Use an instruction-based clock on Windows TCG: host scheduling can
          // otherwise make Alpine's early PIT/IO-APIC timer check panic. icount
          // requires single-threaded TCG; other hosts keep multi-threading.
          accelerator === 'whpx' ? 'whpx' : `tcg,thread=${process.platform === 'win32' ? 'single' : 'multi'}`,
          ...(process.platform === 'win32' && accelerator === 'tcg'
            ? ['-icount', 'shift=auto,sleep=on']
            : []),
          '-m',
          `${vm.memoryMiB}`,
          '-smp',
          `${vm.cpus}`,
          '-display',
          'none',
          '-monitor',
          'none',
          '-no-reboot',
          '-drive',
          `file=${escape(join(dir, 'disk.qcow2'))},if=virtio,format=qcow2`,
          '-drive',
          `file=${escape(join(dir, 'seed.iso'))},${vm.distro && vm.distro !== 'alpine' ? 'if=virtio,format=raw' : 'media=cdrom'},readonly=on`,
          '-netdev',
          `user,id=sakura-net,net=10.0.2.0/24,host=10.0.2.2,dns=10.0.2.3,${forwards.join(',')}`,
          '-device',
          // The legacy -nic path can default to vectors=0. Give the virtio NIC
          // dedicated MSI-X vectors for RX, TX, config and the control queue.
          'virtio-net-pci,netdev=sakura-net,vectors=4',
          '-device',
          'virtio-rng-pci',
          '-device',
          'virtio-balloon-pci',
          '-qmp',
          `tcp:127.0.0.1:${qmpPort},server=on,wait=off`,
          '-serial',
          `tcp:127.0.0.1:${serialPort},server=on,wait=off`,
        ];
        live.done = this.engine
          .run('sakura-qemu', args, {
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
            live.bootAbort.abort();
            live.serial?.destroy();
            for (const client of live.clients) client.end();
            await live.bootDone;
            this.live.delete(id);
            await this.save().catch((error) => this.log(id, `\r\n保存实例状态失败：${String(error)}\r\n`));
            this.emit('change');
          });
        live.bootDone = this.watchBoot(id, live).catch((e) => {
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
          live.status = 'running';
          this.get(id).bootstrapped = true;
          this.startAttempts.delete(id);
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
  async connect(id: string, timeout = 10000, signal?: AbortSignal) {
    const live = this.live.get(id);
    if (!live || live.status === 'stopping' || live.status === 'paused')
      throw new AppError(live?.status === 'paused' ? '发行版已暂停，请先恢复' : '请先启动该发行版', 409);
    const deadline = performance.now() + timeout;
    const key = await readFile(join(vmDir(id), 'id_rsa'));
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      if (this.live.get(id) !== live || this.live.get(id)?.status === 'stopping')
        throw new AppError('发行版已停止', 409);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('SSH connection timed out');
      try {
        return await this.connectOnce(live, key, remaining, signal);
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
  private connectOnce(live: Live, key: Buffer, timeout: number, signal?: AbortSignal) {
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
  ) {
    const client = await this.connect(id, Math.min(timeout, 10000), signal);
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
        client.exec(command, (error, stream) => {
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
        });
      });
    } finally {
      client.end();
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
    return this.locked(id, async () => this.stopInternal(id, force));
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
      const live = this.live.get(id);
      if (!live || live.status !== 'paused') throw new AppError('只有已暂停的发行版可以恢复', 409);
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
  async update(id: string, input: unknown) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      const config = createSchema.parse(input);
      if (config.name !== vm.name) throw new AppError('实例名称创建后不可修改');
      if (config.diskGiB !== vm.diskGiB) throw new AppError('磁盘大小创建后不可修改');
      if ((config.distro || 'alpine') !== (vm.distro || 'alpine'))
        throw new AppError('不能更改已有磁盘的发行版');
      Object.assign(vm, config);
      await this.save();
      return this.view(id);
    });
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
      this.requireStopped(id);
      if (diskGiB <= vm.diskGiB) throw new AppError('仅支持扩容，目标容量必须大于当前容量');
      if (vm.snapshots.length >= 20) throw new AppError('请先删除一个快照，为扩容前备份留出位置');
      signal?.throwIfAborted();
      // Before disk growth was supported, all snapshots shared the VM's capacity.
      // Record that size before the first expansion so legacy restores stay accurate.
      for (const shot of vm.snapshots) shot.diskGiB ??= vm.diskGiB;
      await this.createSnapshot(vm, '扩容前自动备份');
      // QEMU metadata updates are allowed to finish even if the request leaves.
      await this.engine.run('sakura-img', [
        'resize',
        '-f',
        'qcow2',
        join(vmDir(id), 'disk.qcow2'),
        `${diskGiB}G`,
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
  private async createSnapshot(vm: VMRecord, name: string) {
    const shot = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      diskGiB: vm.diskGiB,
      pendingResize: !!vm.pendingResize,
    };
    const identity = await this.diskIdentity(vm.id);
    const file = this.snapshotIdentityFile(vm.id, shot.id);
    await writeFile(file, JSON.stringify({ ...identity, seed: identity.seed.toString('base64') }), {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await this.engine.run('sakura-img', ['snapshot', '-c', shot.id, join(vmDir(vm.id), 'disk.qcow2')]);
    } catch (error) {
      await rm(file, { force: true });
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
  async restore(id: string, snapshotId: string, backup = false) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      if (!vm.snapshots.some((s) => s.id === snapshotId)) throw new AppError('快照不存在', 404);
      const identity = await this.diskIdentity(id, snapshotId);
      if (backup) {
        if (vm.snapshots.length >= 20) throw new AppError('请先删除一个旧快照，为恢复前备份留出位置');
        await this.createSnapshot(vm, '恢复前自动备份');
      }
      await this.engine.run('sakura-img', ['snapshot', '-a', snapshotId, join(vmDir(id), 'disk.qcow2')]);
      const restored = vm.snapshots.find((s) => s.id === snapshotId)!;
      if (restored.diskGiB) vm.diskGiB = restored.diskGiB;
      vm.pendingResize = !!restored.pendingResize;
      const dir = vmDir(id);
      await writeIdentityFile(join(dir, 'id_rsa'), identity.key);
      await writeIdentityFile(join(dir, 'seed.iso'), identity.seed);
      if (identity.pending !== undefined)
        await writeIdentityFile(join(dir, 'identity.json'), identity.pending);
      else await rm(join(dir, 'identity.json'), { force: true });
      delete vm.lastError;
      await this.save();
      return this.view(id);
    });
  }
  async delete(id: string) {
    return this.locked(id, async () => {
      this.get(id);
      this.requireStopped(id);
      const dir = vmDir(id);
      // checkedId + fixed VM_ROOT keep recursive operations inside machine storage.
      await rm(dir, { recursive: true, force: true });
      this.records.delete(id);
      this.logs.delete(id);
      await this.save();
    });
  }
  async editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null) {
    return this.locked(id, async () => {
      this.requireStopped(id);
      const vm = this.get(id);
      const shot = vm.snapshots.find((s) => s.id === snapshotId);
      if (!shot) throw new AppError('快照不存在', 404);
      if (patch) Object.assign(shot, patch);
      else {
        await this.engine.run('sakura-img', ['snapshot', '-d', shot.id, join(vmDir(id), 'disk.qcow2')]);
        vm.snapshots = vm.snapshots.filter((s) => s !== shot);
        await rm(this.snapshotIdentityFile(id, shot.id), { force: true });
      }
      await this.save();
      this.emit('change');
      return this.view(id);
    });
  }
  async setForwards(id: string, input: unknown) {
    return this.locked('launch', () =>
      this.locked(id, async () => {
        const vm = this.get(id);
        const parsed = createSchema.parse({ name: vm.name, forwards: input }).forwards;
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
            for (const p of applied) await command('remove', p).catch(() => {});
            for (const p of taken) await command('add', p).catch(() => {});
            throw error;
          }
        }
        vm.forwards = parsed;
        await this.save();
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
  // Publish a validated standalone disk and rotate its controller key at first boot.
  async adopt(
    input: unknown,
    disk: string,
    key: string,
    seed: Buffer,
    project?: unknown,
    pendingResize = false,
    projects?: { active: string; projects: { id: string; name: string }[]; configs: Record<string, unknown> },
  ) {
    return this.locked('create', async () => {
      const config = createSchema.parse(input);
      if (this.records.size >= 32 || [...this.records.values()].some((v) => v.name === config.name))
        throw new AppError('名称已存在或已达到 32 个实例上限', 409);
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: true,
        pendingResize,
      };
      const dir = vmDir(vm.id);
      await mkdir(dir);
      try {
        await copyFile(disk, join(dir, 'disk.qcow2'));
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
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    });
  }
  async close() {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    this.closeTask = (async () => {
      // Launch and disk operations admitted before shutdown must settle before
      // taking the final live-process snapshot or releasing their runtime.
      await Promise.allSettled([...this.operations]);
      await Promise.allSettled([...this.live.keys()].map((id) => this.stopInternal(id, false)));
      await this.engine.runtime.close();
    })();
    return this.closeTask;
  }
}
