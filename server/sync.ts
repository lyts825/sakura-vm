import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, realpath, mkdir, rename, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep, dirname, posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import { ftpStat, mutablePath } from './files.ts';
import { Jobs } from './jobs.ts';
import type { Machines } from './machines.ts';

export const syncSchema = z
  .object({
    host: z.string().max(4096),
    guest: z
      .string()
      .refine((value) => {
        try {
          mutablePath(value);
          return true;
        } catch {
          return false;
        }
      }, '需要有效的非根目录路径')
      .transform(mutablePath),
    auto: z.boolean().default(false),
  })
  .strict();
export type SyncConfig = z.infer<typeof syncSchema>;
const excluded = new Set(['.git', 'node_modules', '.data', '.tools', '.vendor']);
export function safeRelative(path: string) {
  if (
    !path ||
    path
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[\\<>:"|?*\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new AppError('目录包含无法安全同步到 Windows 的文件名');
  return path;
}
export function validateSyncPaths(paths: Iterable<string>) {
  const names = new Map<string, string>();
  for (const path of paths) {
    const key = safeRelative(path).toLowerCase();
    const existing = names.get(key);
    if (existing && existing !== path)
      throw new AppError(`文件名在 Windows 上冲突，请先重命名：${existing} / ${path}`);
    names.set(key, path);
  }
}
async function hash(stream: Readable) {
  const digest = createHash('sha256');
  for await (const data of stream) digest.update(data);
  return digest.digest('hex');
}
export class FolderSync {
  jobs = new Jobs();
  private timer: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(private machines: Machines) {
    machines.on('change', () => {
      for (const id of machines.records.keys()) if (machines.state(id) !== 'running') this.jobs.cancel(id);
    });
    this.timer = setInterval(() => {
      if (!this.ticking) {
        this.ticking = true;
        void this.tick().finally(() => {
          this.ticking = false;
        });
      }
    }, 15000);
    this.timer.unref();
  }
  async close() {
    clearInterval(this.timer);
    await this.jobs.close();
  }
  async config(id: string): Promise<SyncConfig | null> {
    this.machines.get(id);
    try {
      return syncSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'sync.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(id: string, input: unknown) {
    return this.machines.locked(`sync:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = syncSchema.parse(input);
      if (!isAbsolute(config.host)) throw new AppError('请选择 Windows 文件夹的绝对路径');
      config.host = await realpath(config.host);
      if (!(await lstat(config.host)).isDirectory()) throw new AppError('本机路径不是目录');
      this.machines.get(id);
      const previous = await this.config(id);
      const file = join(vmDir(id), 'sync.json');
      await writeFile(`${file}.tmp`, JSON.stringify(config));
      await rename(`${file}.tmp`, file);
      if (previous?.host !== config.host || previous?.guest !== config.guest)
        await rm(join(vmDir(id), 'sync-state.json'), { force: true });
      return config;
    });
  }
  async view(id: string) {
    return { config: await this.config(id), job: this.jobs.view(id) };
  }
  private async tick() {
    for (const id of this.machines.records.keys()) {
      try {
        if (
          this.machines.state(id) === 'running' &&
          this.jobs.view(id)?.status !== 'running' &&
          (await this.config(id))?.auto
        )
          await this.run(id, 'both');
      } catch {
        /* A manual retry exposes the error. */
      }
    }
  }
  async run(id: string, direction: 'both' | 'push' | 'pull') {
    return this.machines.locked(`sync:${id}`, () => this.runInternal(id, direction));
  }
  private async runInternal(id: string, direction: 'both' | 'push' | 'pull') {
    const config = await this.config(id);
    if (!config) throw new AppError('请先保存同步目录');
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    return this.jobs.start(id, async (log, signal) => {
      const root = await realpath(config.host);
      if (root !== config.host) throw new AppError('本机目录位置已改变，请重新保存');
      const stateFile = join(vmDir(id), 'sync-state.json');
      let previous: Record<string, string> = Object.create(null);
      try {
        previous = Object.assign(Object.create(null), JSON.parse(await readFile(stateFile, 'utf8')));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const next: Record<string, string> = Object.create(null);
      let count = 0,
        changed = 0,
        conflicts = 0;
      const hostFiles = new Map<string, string>(),
        guestFiles = new Map<string, string>();
      const hostDirs = new Set<string>(),
        guestDirs = new Set<string>();
      const check = () => {
        signal.throwIfAborted();
        if (++count > 20000) throw new AppError('一次同步最多扫描 20000 个条目');
      };
      const hostPath = async (name: string) => {
        const destination = resolve(root, ...safeRelative(name).split('/'));
        const rel = relative(root, destination);
        if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new AppError('同步路径越界');
        let current = root;
        for (const component of rel.split(sep)) {
          current = join(current, component);
          const attrs = await lstat(current).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== 'ENOENT') throw e;
            return null;
          });
          if (attrs?.isSymbolicLink()) throw new AppError('同步不会穿过符号链接或目录联接');
        }
        return destination;
      };
      const scanHost = async (base = ''): Promise<void> => {
        for (const entry of await readdir(join(root, base), { withFileTypes: true })) {
          if (excluded.has(entry.name.toLowerCase()) || entry.name.toLowerCase().startsWith('.sakura-'))
            continue;
          check();
          if (entry.isSymbolicLink()) continue;
          const name = safeRelative(base ? base + '/' + entry.name : entry.name);
          if (entry.isDirectory()) {
            hostDirs.add(name);
            await scanHost(name);
          } else if (entry.isFile()) {
            const file = await hostPath(name);
            if ((await lstat(file)).size > 256 * 1024 ** 2)
              throw new AppError(`${name} 超过同步单文件 256 MiB 限制`);
            hostFiles.set(name, await hash(createReadStream(file)));
          }
        }
      };
      log('正在比较两个目录…\n');
      await scanHost();
      await this.machines.sftp(
        id,
        async (ftp) => {
          const ensureGuest = async (path: string) => {
            let current = '';
            for (const part of posix.normalize(path).split('/').filter(Boolean)) {
              current += '/' + part;
              const attrs = await ftpStat(ftp, current);
              if (attrs && !attrs.isDirectory()) throw new AppError(`目标不是普通目录：${current}`);
              if (!attrs)
                await new Promise<void>((res, rej) => ftp.mkdir(current, (err) => (err ? rej(err) : res())));
            }
          };
          await ensureGuest(config.guest);
          const scanGuest = async (base = ''): Promise<void> => {
            const entries = await new Promise<import('ssh2').FileEntry[]>((res, rej) =>
              ftp.readdir(posix.join(config.guest, base), (err, entries) => (err ? rej(err) : res(entries))),
            );
            for (const entry of entries) {
              if (
                excluded.has(entry.filename.toLowerCase()) ||
                entry.filename.toLowerCase().startsWith('.sakura-')
              )
                continue;
              check();
              const kind = entry.attrs.mode & 0xf000;
              if (kind === 0xa000) continue;
              const name = safeRelative(base ? base + '/' + entry.filename : entry.filename);
              if (kind === 0x4000) {
                guestDirs.add(name);
                await scanGuest(name);
              } else if (kind === 0x8000) {
                if (entry.attrs.size > 256 * 1024 ** 2)
                  throw new AppError(`${name} 超过同步单文件 256 MiB 限制`);
                guestFiles.set(name, await hash(ftp.createReadStream(posix.join(config.guest, name))));
              }
            }
          };
          await scanGuest();
          validateSyncPaths([...hostDirs, ...guestDirs, ...hostFiles.keys(), ...guestFiles.keys()]);
          if (direction !== 'pull')
            for (const name of hostDirs) {
              signal.throwIfAborted();
              await ensureGuest(posix.join(config.guest, name));
            }
          if (direction !== 'push')
            for (const name of guestDirs) {
              signal.throwIfAborted();
              await mkdir(await hostPath(name), { recursive: true });
            }
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys()])) {
            signal.throwIfAborted();
            const hostHash = hostFiles.get(name),
              guestHash = guestFiles.get(name);
            if (hostHash === guestHash) {
              next[name] = hostHash!;
              continue;
            }
            let way = direction;
            if (way === 'both') {
              if (hostHash && !guestHash) way = 'push';
              else if (guestHash && !hostHash) way = 'pull';
              else if (previous[name] && previous[name] === guestHash) way = 'push';
              else if (previous[name] && previous[name] === hostHash) way = 'pull';
              else {
                conflicts++;
                if (previous[name]) next[name] = previous[name];
                log(`冲突，保留两边：${name}\n`);
                continue;
              }
            }
            const local = await hostPath(name),
              remote = posix.join(config.guest, name);
            if (way === 'push' && hostHash) {
              await ensureGuest(posix.dirname(remote));
              const attrs = await ftpStat(ftp, remote);
              if (attrs && !attrs.isFile()) throw new AppError(`目标不是普通文件：${remote}`);
              const temp = posix.join(posix.dirname(remote), '.sakura-sync-' + randomUUID());
              try {
                await pipeline(
                  createReadStream(local),
                  ftp.createWriteStream(temp, { flags: 'wx', mode: attrs?.mode || 0o644 }),
                  { signal },
                );
                const uploaded = await hash(ftp.createReadStream(temp));
                if (uploaded !== hostHash) throw new AppError(`文件在同步中改变，请重试：${name}`);
                const current = await ftpStat(ftp, remote);
                if (
                  direction === 'both' &&
                  (current ? await hash(ftp.createReadStream(remote)) : undefined) !== guestHash
                )
                  throw new AppError(`目标在同步中改变，已保留原文件：${name}`);
                await new Promise<void>((res, rej) =>
                  ftp.ext_openssh_rename(temp, remote, (err) => (err ? rej(err) : res())),
                );
                next[name] = hostHash;
              } finally {
                await new Promise<void>((res) => ftp.unlink(temp, () => res()));
              }
            } else if (way === 'pull' && guestHash) {
              await mkdir(dirname(local), { recursive: true });
              await hostPath(name);
              const temp = join(dirname(local), '.sakura-sync-' + randomUUID());
              try {
                await pipeline(ftp.createReadStream(remote), createWriteStream(temp, { flags: 'wx' }), {
                  signal,
                });
                if ((await hash(createReadStream(temp))) !== guestHash)
                  throw new AppError(`文件在同步中改变，请重试：${name}`);
                const current = await lstat(await hostPath(name)).catch((e: NodeJS.ErrnoException) => {
                  if (e.code !== 'ENOENT') throw e;
                  return null;
                });
                if (
                  direction === 'both' &&
                  (current ? await hash(createReadStream(local)) : undefined) !== hostHash
                )
                  throw new AppError(`目标在同步中改变，已保留原文件：${name}`);
                await rename(temp, local);
                next[name] = guestHash;
              } finally {
                await rm(temp, { force: true });
              }
            } else continue;
            changed++;
            log(`${way === 'push' ? '上传' : '下载'}：${name}\n`);
          }
        },
        signal,
      );
      await writeFile(stateFile, JSON.stringify(next));
      log(`完成：${changed} 个文件已同步，${conflicts} 个冲突。删除操作不会传播。\n`);
    });
  }
}
