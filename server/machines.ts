import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { Client, type SFTPWrapper } from 'ssh2';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AppError,
  DATA,
  IMAGE,
  VM_ROOT,
  createSchema,
  vmDir,
  guestPath,
  type VMRecord,
  type VMView,
  type VMStatus,
} from './model.ts';
import { createSshKey, seedIso, userData, metaData, bootSetup } from './seed.ts';
import { freePort, qmp } from './qmp.ts';
import type { Engine } from './runtime.ts';

export const BOOT_TIMEOUT_MS = 270_000;
type Live = {
  status: VMStatus;
  accelerator: 'tcg' | 'whpx';
  startedAt: string;
  sshPort: number;
  qmpPort: number;
  serialPort: number;
  abort: AbortController;
  bootAbort: AbortController;
  done: Promise<void>;
  serial?: Socket;
  clients: Set<Client>;
  error?: string;
};
export class Machines extends EventEmitter {
  records = new Map<string, VMRecord>();
  live = new Map<string, Live>();
  logs = new Map<string, string>();
  private locks = new Set<string>();
  closing = false;
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
    if (this.locks.has(id)) throw new AppError('该实例的另一项操作正在进行', 409);
    this.locks.add(id);
    try {
      return await action();
    } finally {
      this.locks.delete(id);
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
      diskBytes: disk?.size || 0,
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
      if (!existsSync(IMAGE)) throw new AppError('Alpine 镜像尚未准备好，请运行 npm run setup', 503);
      if (this.records.size >= 32) throw new AppError('最多保留 32 个发行版');
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
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
            'user-data': userData(vm.name, key.publicText),
          }),
        );
        await this.engine.run('sakura-img', [
          'create',
          '-f',
          'qcow2',
          '-F',
          'qcow2',
          '-b',
          IMAGE,
          join(dir, 'disk.qcow2'),
          `${vm.diskGiB}G`,
        ]);
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
        if (this.live.size >= 4) throw new AppError('轻量模式最多同时运行 4 个发行版', 409);
        for (const otherId of this.live.keys())
          for (const p of this.get(otherId).forwards)
            if (vm.forwards.some((n) => n.host === p.host))
              throw new AppError(`端口 ${p.host} 已被另一实例使用`, 409);
        const sshPort = await freePort(),
          qmpPort = await freePort(),
          serialPort = await freePort();
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
          done: Promise.resolve(),
          clients: new Set(),
        };
        this.live.set(id, live);
        delete vm.lastError;
        this.logs.set(id, '');
        await this.save();
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
          '-smbios',
          'type=1,serial=ds=nocloud',
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
          `file=${escape(join(dir, 'seed.iso'))},media=cdrom,readonly=on`,
          '-nic',
          `user,model=virtio-net-pci,net=10.0.2.0/24,host=10.0.2.2,dns=10.0.2.3,${forwards.join(',')}`,
          '-device',
          'virtio-rng-pci',
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
            this.live.delete(id);
            await this.save();
            this.emit('change');
          });
        void this.watchBoot(id, live).catch((e) => {
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
        socket.on('data', (data) => this.log(id, data));
        live.serial = socket;
      }
      try {
        // The first SSH daemon is reachable before user-data restarts it. Do not
        // expose terminals until Tiny Cloud has finished provisioning the guest.
        const result = await this.exec(
          id,
          `set -e\ntest -f /var/lib/cloud/.bootstrap-complete\n${bootSetup()}`,
          Math.max(1, Math.min(1800, deadline - performance.now())),
          signal,
        );
        if (result.code !== 0) throw new Error('Linux initialization is not finished');
        if (this.live.get(id) === live && live.status === 'starting') {
          live.status = 'running';
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
    if (!live || live.status === 'stopping') throw new AppError('请先启动该发行版', 409);
    const key = await readFile(join(vmDir(id), 'id_rsa'));
    signal?.throwIfAborted();
    if (this.live.get(id) !== live || this.live.get(id)?.status === 'stopping')
      throw new AppError('发行版已停止', 409);
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
  async exec(id: string, command: string, timeout = 30000, signal?: AbortSignal) {
    const client = await this.connect(id, Math.min(timeout, 10000), signal);
    try {
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        let stdout = '',
          stderr = '',
          size = 0;
        const timer = setTimeout(() => {
          client.end();
          reject(new AppError('Linux 命令执行超时', 408));
        }, timeout);
        client.exec(command, (error, stream) => {
          if (error) {
            clearTimeout(timer);
            reject(error);
            return;
          }
          const collect = (data: Buffer, err = false) => {
            size += data.length;
            if (size > 1024 * 1024) {
              clearTimeout(timer);
              stream.close();
              reject(new AppError('输出超过 1 MiB，请使用终端'));
              return;
            }
            if (err) stderr += data.toString();
            else stdout += data.toString();
          };
          stream.on('data', (data: Buffer) => collect(data));
          stream.stderr.on('data', (data: Buffer) => collect(data, true));
          stream.on('error', (e: Error) => {
            clearTimeout(timer);
            reject(e);
          });
          stream.on('close', (code: number) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? -1 });
          });
        });
      });
    } finally {
      client.end();
    }
  }
  private async sftp<T>(id: string, work: (sftp: SFTPWrapper) => Promise<T>) {
    const client = await this.connect(id);
    try {
      const sftp = await new Promise<SFTPWrapper>((res, rej) =>
        client.sftp((err, ftp) => (err ? rej(err) : res(ftp))),
      );
      return await work(sftp);
    } finally {
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
    return this.sftp(
      id,
      (ftp) =>
        new Promise<string>((res, rej) => {
          let text = '';
          let size = 0;
          const decoder = new StringDecoder('utf8');
          const stream = ftp.createReadStream(guestPath(path));
          stream.on('data', (data: Buffer) => {
            size += data.length;
            if (size > 1024 * 1024) stream.destroy(new AppError('仅支持预览 1 MiB 以内的文本文件'));
            else if (data.includes(0)) stream.destroy(new AppError('二进制文件不能作为文本编辑'));
            else text += decoder.write(data);
          });
          stream.on('error', rej);
          stream.on('end', () => res(text + decoder.end()));
        }),
    );
  }
  async writeGuestFile(id: string, path: string, content: string) {
    return this.sftp(
      id,
      (ftp) =>
        new Promise<void>((res, rej) => {
          const stream = ftp.createWriteStream(guestPath(path));
          stream.on('error', rej);
          stream.on('close', () => res());
          stream.end(content);
        }),
    );
  }
  async stop(id: string, force = false) {
    return this.locked(id, async () => this.stopInternal(id, force));
  }
  private async stopInternal(id: string, force: boolean) {
    this.get(id);
    const live = this.live.get(id);
    if (!live) return this.view(id);
    live.bootAbort.abort();
    if (!force && live.status === 'running') await this.exec(id, 'sync; poweroff', 5000).catch(() => {});
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
      Object.assign(vm, config);
      await this.save();
      return this.view(id);
    });
  }
  private requireStopped(id: string) {
    if (this.live.has(id)) throw new AppError('请先停止发行版，再进行此操作', 409);
  }
  async snapshot(id: string, name: string) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个磁盘快照');
      const shot = { id: randomUUID(), name, createdAt: new Date().toISOString() };
      await this.engine.run('sakura-img', ['snapshot', '-c', shot.id, join(vmDir(id), 'disk.qcow2')]);
      vm.snapshots.push(shot);
      await this.save();
      return shot;
    });
  }
  async restore(id: string, snapshotId: string) {
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      if (!vm.snapshots.some((s) => s.id === snapshotId)) throw new AppError('快照不存在', 404);
      await this.engine.run('sakura-img', ['snapshot', '-a', snapshotId, join(vmDir(id), 'disk.qcow2')]);
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
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.live.keys()].map((id) => this.stopInternal(id, false)));
    await this.engine.runtime.close();
  }
}
