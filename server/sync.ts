import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, realpath, mkdir, rename, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep, dirname, posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import { ftpStat, mutablePath, preserveFileMetadata } from './files.ts';
import { Jobs } from './jobs.ts';
import type { Machines } from './machines.ts';
import type { ProjectCatalog } from './project-catalog.ts';
import { threeWayMerge, resolvedMerge } from '../shared/three-way-merge.ts';
import { inMaintenance, timeWindowSchema } from './automation-policy.ts';
import { withinWindow } from '../shared/time-windows.ts';
import { readStore, writeStore } from './local-store.ts';
import { ByteRate } from './byte-rate.ts';

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
    mergeText: z.boolean().optional(),
    window: timeWindowSchema.optional(),
    bandwidthMiBps: z
      .number()
      .min(0)
      .max(10240)
      .refine((value) => value === 0 || value >= 0.1)
      .optional(),
    ignore: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(256)
          .refine(
            (v) => !v.includes('\\') && !v.split('/').includes('..') && !v.startsWith('/'),
            '忽略规则使用相对路径',
          ),
      )
      .max(64)
      .optional(),
  })
  .strict();
export type SyncConfig = z.infer<typeof syncSchema>;
const queueSchema = z
  .object({
    id: z.uuid(),
    requestedAt: z.iso.datetime(),
    attempts: z.number().int().min(0),
    nextAttemptAt: z.number().nonnegative(),
    jobId: z.uuid().optional(),
    lastError: z.string().optional(),
  })
  .strict();
export type SyncQueue = z.infer<typeof queueSchema>;
export type SyncChange = {
  path: string;
  action:
    'push' | 'pull' | 'conflict' | 'mkdir-host' | 'mkdir-guest' | 'delete-host' | 'delete-guest' | 'skip';
};
export type SyncPreview = { token: string; changes: SyncChange[]; unchanged: number };
export type SyncDecisions = Record<
  string,
  | 'push'
  | 'pull'
  | 'both'
  | 'skip'
  | 'merge'
  | 'delete-host'
  | 'delete-guest'
  | 'restore-host'
  | 'restore-guest'
>;
export function ignored(path: string, patterns: string[] = []) {
  return patterns.some((pattern) => {
    const value = pattern.replace(/\/$/, '');
    const regex = value
      .split('**')
      .map((s) =>
        s
          .split('*')
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    return new RegExp(`${value.includes('/') ? '^' : '(^|/)'}${regex}($|/)`).test(path);
  });
}
export function syncDirection(
  host: string | undefined,
  guest: string | undefined,
  previous?: string,
): 'push' | 'pull' | 'conflict' | 'same' {
  if (host === guest) return 'same';
  if (host && (!guest || previous === guest)) return 'push';
  if (guest && (!host || previous === host)) return 'pull';
  return 'conflict';
}
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
async function hash(stream: Readable, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const digest = createHash('sha256');
    let ended = false;
    const abort = () => stream.destroy(signal.reason);
    const cleanup = () => signal.removeEventListener('abort', abort);
    stream.on('data', (data: Buffer) => digest.update(data));
    stream.on('end', () => {
      ended = true;
    });
    stream.on('error', (error) => {
      cleanup();
      reject(error);
    });
    // SFTP reaches EOF before its remote close request completes. Keep SSH alive
    // and its error handler attached until that final callback has finished.
    stream.on('close', () => {
      cleanup();
      if (signal.aborted) reject(signal.reason);
      else if (ended) resolve(digest.digest('hex'));
      else reject(new AppError('文件读取未完成'));
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export class FolderSync {
  jobs = new Jobs('sync');
  private timer: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closed = false;
  private onChange = () => {
    for (const id of this.machines.records.keys())
      if (this.machines.state(id) !== 'running')
        for (const job of this.jobs.list())
          if (job.vmId === id && job.status === 'running') this.jobs.cancel(job.id!);
  };
  constructor(
    private machines: Machines,
    private projects?: ProjectCatalog,
  ) {
    machines.on('change', this.onChange);
    this.timer = setInterval(() => {
      if (!this.ticking) {
        this.ticking = this.tick().finally(() => {
          this.ticking = undefined;
        });
      }
    }, 15000);
    this.timer.unref();
  }
  private key(id: string) {
    return this.projects?.key(id) || id;
  }
  private file(id: string, name: string) {
    return this.projects?.file(id, name) || join(vmDir(id), `${name}.json`);
  }
  private async eachProject(id: string, action: (projectId: string) => Promise<void>) {
    if (!this.projects) return action('default');
    const index = await this.projects.list(id);
    for (const project of index.projects)
      await this.projects.inScope(id, project.id, () => action(project.id));
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.machines.off('change', this.onChange);
    await this.ticking;
    await this.jobs.close();
  }
  async config(id: string): Promise<SyncConfig | null> {
    this.machines.get(id);
    try {
      return syncSchema.parse(JSON.parse(await readFile(this.file(id, 'sync'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(id: string, input: unknown) {
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = syncSchema.parse(input);
      if (!isAbsolute(config.host)) throw new AppError('请选择 Windows 文件夹的绝对路径');
      config.host = await realpath(config.host);
      if (!(await lstat(config.host)).isDirectory()) throw new AppError('本机路径不是目录');
      this.machines.get(id);
      const previous = await this.config(id);
      const file = this.file(id, 'sync');
      await writeFile(`${file}.tmp`, JSON.stringify(config));
      await rename(`${file}.tmp`, file);
      if (previous?.host !== config.host || previous?.guest !== config.guest) {
        await rm(this.file(id, 'sync-state'), { force: true });
        await rm(this.file(id, 'sync-base'), { force: true });
        await rm(this.file(id, 'sync-queue'), { force: true });
      }
      if (!config.mergeText && previous?.mergeText) await rm(this.file(id, 'sync-base'), { force: true });
      return config;
    });
  }
  async view(id: string) {
    return {
      projectId: this.projects?.current(id) || 'default',
      config: await this.config(id),
      job: this.jobs.view(this.key(id)),
      queue: await this.queued(id),
      maintenance: await inMaintenance(id),
    };
  }
  private async queued(id: string) {
    const value = await readStore<unknown>(this.file(id, 'sync-queue'), () => null);
    return value === null ? null : queueSchema.parse(value);
  }
  async queue(id: string, cancel = false) {
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      this.machines.get(id);
      const pending = await this.queued(id);
      if (cancel) {
        if (pending?.jobId) this.jobs.cancel(pending.jobId);
        await rm(this.file(id, 'sync-queue'), { force: true });
        return null;
      }
      if (!(await this.config(id))) throw new AppError('请先保存同步目录');
      if (pending) return pending;
      const entry: SyncQueue = {
        id: randomUUID(),
        requestedAt: new Date().toISOString(),
        attempts: 0,
        nextAttemptAt: 0,
      };
      await writeStore(this.file(id, 'sync-queue'), entry);
      return entry;
    });
  }
  async tick(now = Date.now()) {
    for (const id of this.machines.records.keys()) {
      if (this.closed) return;
      try {
        await this.eachProject(id, async () => {
          try {
            await this.machines.locked(`sync:${this.key(id)}`, async () => {
              const config = await this.config(id);
              if (!config) return;
              let pending = await this.queued(id);
              if (pending?.jobId) {
                const job = this.jobs.get(pending.jobId);
                if (job?.status === 'running') return;
                if (job?.status === 'done') {
                  await rm(this.file(id, 'sync-queue'), { force: true });
                  pending = null;
                } else {
                  delete pending.jobId;
                  pending.lastError = (job?.error || '同步中断，将重新比较文件后重试').slice(0, 1000);
                  pending.nextAttemptAt = now + Math.min(600000, 15000 * 2 ** Math.min(6, pending.attempts));
                  await writeStore(this.file(id, 'sync-queue'), pending);
                }
              }
              if (this.jobs.view(this.key(id))?.status === 'running') return;
              if (!pending && !config.auto) return;
              if ((await inMaintenance(id, now)) || (config.window && !withinWindow(config.window, now)))
                return;
              if (!pending) {
                pending = {
                  id: randomUUID(),
                  requestedAt: new Date(now).toISOString(),
                  attempts: 0,
                  nextAttemptAt: 0,
                };
                await writeStore(this.file(id, 'sync-queue'), pending);
              }
              if (this.machines.state(id) !== 'running' || now < pending.nextAttemptAt) return;
              try {
                pending.attempts++;
                const job = await this.runInternal(id, 'both');
                pending.jobId = job.id;
              } catch (error) {
                pending.lastError = (error as Error).message.slice(0, 1000);
                pending.nextAttemptAt = now + Math.min(600000, 15000 * 2 ** Math.min(6, pending.attempts));
              }
              await writeStore(this.file(id, 'sync-queue'), pending);
            });
          } catch {
            /* Each project retains its previous queued request on transient failures. */
          }
        });
      } catch {
        /* A manual retry exposes the error. */
      }
    }
  }
  async preview(id: string, signal: AbortSignal = new AbortController().signal) {
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = await this.config(id);
      if (!config) throw new AppError('请先保存同步目录');
      return this.execute(id, config, 'both', () => {}, signal, true);
    });
  }
  async run(id: string, direction: 'both' | 'push' | 'pull', token?: string, decisions: SyncDecisions = {}) {
    return this.machines.locked(`sync:${this.key(id)}`, () =>
      this.runInternal(id, direction, token, decisions),
    );
  }
  private async runInternal(
    id: string,
    direction: 'both' | 'push' | 'pull',
    token?: string,
    decisions: SyncDecisions = {},
  ) {
    const config = await this.config(id);
    if (!config) throw new AppError('请先保存同步目录');
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    if (Object.keys(decisions).length && !token) throw new AppError('处理冲突前请先预览');
    return this.jobs.start(
      this.key(id),
      async (log, signal) => {
        await this.execute(id, config, direction, log, signal, false, token, decisions);
      },
      { title: '目录同步', vmId: id, action: direction, projectId: this.projects?.current(id) },
    );
  }
  private async execute(
    id: string,
    config: SyncConfig,
    direction: 'both' | 'push' | 'pull',
    log: (s: string) => void,
    signal: AbortSignal,
    preview = false,
    token?: string,
    decisions: SyncDecisions = {},
  ) {
    let plan: SyncPreview = { token: '', changes: [], unchanged: 0 };
    const root = await realpath(config.host);
    if (root !== config.host) throw new AppError('本机目录位置已改变，请重新保存');
    const stateFile = this.file(id, 'sync-state');
    let previous: Record<string, string> = Object.create(null);
    try {
      previous = Object.assign(Object.create(null), JSON.parse(await readFile(stateFile, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const next: Record<string, string> = Object.create(null);
    const baseFile = this.file(id, 'sync-base');
    let bases: Record<string, string> = Object.create(null);
    if (config.mergeText) {
      try {
        if ((await lstat(baseFile)).size > 32 * 1024 ** 2) throw new AppError('同步共同版本文件超过限制');
        bases = Object.assign(Object.create(null), JSON.parse(await readFile(baseFile, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
    const rate = new ByteRate((config.bandwidthMiBps || 0) * 1024 ** 2);
    const decodeText = (bytes: Buffer) => {
      if (bytes.length > 1024 ** 2 || bytes.includes(0))
        throw new AppError('三方同步只支持 1 MiB 以内的 UTF-8 文本');
      try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new AppError('三方同步需要 UTF-8 文本');
      }
    };
    let count = 0,
      changed = 0,
      conflicts = 0;
    const hostFiles = new Map<string, string>(),
      guestFiles = new Map<string, string>();
    const hostDirs = new Set<string>(),
      guestDirs = new Set<string>();
    const check = (operationSignal = signal) => {
      operationSignal.throwIfAborted();
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
        if (ignored(name, config.ignore)) continue;
        if (entry.isDirectory()) {
          hostDirs.add(name);
          await scanHost(name);
        } else if (entry.isFile()) {
          const file = await hostPath(name);
          if ((await lstat(file)).size > 256 * 1024 ** 2)
            throw new AppError(`${name} 超过同步单文件 256 MiB 限制`);
          hostFiles.set(name, await hash(createReadStream(file), signal));
        }
      }
    };
    log('正在比较两个目录…\n');
    await scanHost();
    const connection = new AbortController();
    const abortConnection = () => connection.abort(signal.reason);
    signal.addEventListener('abort', abortConnection, { once: true });
    if (signal.aborted) abortConnection();
    try {
      await this.machines.sftp(
        id,
        async (ftp, transportSignal) => {
          signal.removeEventListener('abort', abortConnection);
          const transferSignal = transportSignal ? AbortSignal.any([signal, transportSignal]) : signal;
          transferSignal.throwIfAborted();
          const ensureGuest = async (path: string) => {
            let current = '';
            for (const part of posix.normalize(path).split('/').filter(Boolean)) {
              transferSignal.throwIfAborted();
              current += '/' + part;
              const attrs = await ftpStat(ftp, current);
              if (attrs && !attrs.isDirectory()) throw new AppError(`目标不是普通目录：${current}`);
              if (!attrs)
                await new Promise<void>((res, rej) => ftp.mkdir(current, (err) => (err ? rej(err) : res())));
            }
          };
          // A preview must not create either directories or state files.
          let guestRootExists = true;
          for (const part of config.guest
            .split('/')
            .filter(Boolean)
            .map((_, i, a) => '/' + a.slice(0, i + 1).join('/'))) {
            const attrs = await ftpStat(ftp, part);
            if (!attrs) {
              guestRootExists = false;
              break;
            }
            if (!attrs.isDirectory()) throw new AppError(`目标不是普通目录：${part}`);
          }
          const scanGuest = async (base = ''): Promise<void> => {
            transferSignal.throwIfAborted();
            const entries = await new Promise<import('ssh2').FileEntry[]>((res, rej) =>
              ftp.readdir(posix.join(config.guest, base), (err, entries) => (err ? rej(err) : res(entries))),
            );
            for (const entry of entries) {
              if (
                excluded.has(entry.filename.toLowerCase()) ||
                entry.filename.toLowerCase().startsWith('.sakura-')
              )
                continue;
              check(transferSignal);
              const kind = entry.attrs.mode & 0xf000;
              if (kind === 0xa000) continue;
              const name = safeRelative(base ? base + '/' + entry.filename : entry.filename);
              if (ignored(name, config.ignore)) continue;
              if (kind === 0x4000) {
                guestDirs.add(name);
                await scanGuest(name);
              } else if (kind === 0x8000) {
                if (entry.attrs.size > 256 * 1024 ** 2)
                  throw new AppError(`${name} 超过同步单文件 256 MiB 限制`);
                guestFiles.set(
                  name,
                  await hash(ftp.createReadStream(posix.join(config.guest, name)), transferSignal),
                );
              }
            }
          };
          if (guestRootExists) await scanGuest();
          validateSyncPaths([...hostDirs, ...guestDirs, ...hostFiles.keys(), ...guestFiles.keys()]);
          for (const name of hostDirs)
            if (guestFiles.has(name)) throw new AppError(`文件与目录冲突：${name}`);
          for (const name of guestDirs)
            if (hostFiles.has(name)) throw new AppError(`文件与目录冲突：${name}`);
          const changes: SyncChange[] = [];
          let unchanged = 0;
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys()])) {
            const way = syncDirection(hostFiles.get(name), guestFiles.get(name), previous[name]);
            if (way === 'same') unchanged++;
            else if (
              previous[name] &&
              !hostFiles.has(name) &&
              guestFiles.has(name) &&
              previous[name] === guestFiles.get(name)
            )
              changes.push({ path: name, action: 'delete-host' });
            else if (
              previous[name] &&
              hostFiles.has(name) &&
              !guestFiles.has(name) &&
              previous[name] === hostFiles.get(name)
            )
              changes.push({ path: name, action: 'delete-guest' });
            else changes.push({ path: name, action: way });
          }
          for (const name of hostDirs)
            if (!guestDirs.has(name)) changes.push({ path: name, action: 'mkdir-guest' });
          for (const name of guestDirs)
            if (!hostDirs.has(name)) changes.push({ path: name, action: 'mkdir-host' });
          plan = {
            token: createHash('sha256')
              .update(
                JSON.stringify([
                  config,
                  [...hostFiles].sort(),
                  [...guestFiles].sort(),
                  [...hostDirs].sort(),
                  [...guestDirs].sort(),
                  previous,
                ]),
              )
              .digest('hex'),
            changes,
            unchanged,
          };
          if (preview) return;
          if (token && token !== plan.token) throw new AppError('预览后文件或配置已变化，请重新预览', 409);
          await ensureGuest(config.guest);
          if (direction !== 'pull')
            for (const name of hostDirs) {
              transferSignal.throwIfAborted();
              await ensureGuest(posix.join(config.guest, name));
            }
          if (direction !== 'push')
            for (const name of guestDirs) {
              transferSignal.throwIfAborted();
              await mkdir(await hostPath(name), { recursive: true });
            }
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys(), ...Object.keys(previous)])) {
            transferSignal.throwIfAborted();
            const hostHash = hostFiles.get(name),
              guestHash = guestFiles.get(name);
            if (hostHash === guestHash) {
              next[name] = hostHash!;
              continue;
            }
            let way: 'both' | 'push' | 'pull' | 'delete-host' | 'delete-guest' | 'skip' = direction;
            if (!hostHash && guestHash && previous[name] === guestHash)
              way =
                decisions[name] === 'delete-guest'
                  ? 'delete-guest'
                  : decisions[name] === 'restore-host' || direction === 'pull'
                    ? 'pull'
                    : 'skip';
            if (hostHash && !guestHash && previous[name] === hostHash)
              way =
                decisions[name] === 'delete-host'
                  ? 'delete-host'
                  : decisions[name] === 'restore-guest' || direction === 'push'
                    ? 'push'
                    : 'skip';
            if (!hostHash && !guestHash) continue;
            if (way === 'both') {
              if (hostHash && !guestHash) way = 'push';
              else if (guestHash && !hostHash) way = 'pull';
              else if (previous[name] && previous[name] === guestHash) way = 'push';
              else if (previous[name] && previous[name] === hostHash) way = 'pull';
              else {
                const decision = decisions[name];
                if (decision === 'merge') {
                  const base = bases[name];
                  if (!config.mergeText || typeof base !== 'string' || digest(base) !== previous[name])
                    throw new AppError('没有可校验的共同版本，请先启用文本版本保存并完成一次同步：' + name);
                  const local = await hostPath(name),
                    remote = posix.join(config.guest, name);
                  const attrs = await ftpStat(ftp, remote),
                    localAttrs = await lstat(local);
                  if (!attrs?.isFile() || attrs.size > 1024 ** 2 || localAttrs.size > 1024 ** 2)
                    throw new AppError('三方同步只支持 1 MiB 以内的普通文件');
                  const ours = await readFile(local),
                    chunks: Buffer[] = [];
                  let bytes = 0;
                  await new Promise<void>((resolve, reject) => {
                    const stream = ftp.createReadStream(remote);
                    let ended = false;
                    const abort = () => stream.destroy(transferSignal.reason);
                    const cleanup = () => transferSignal.removeEventListener('abort', abort);
                    stream.on('data', (chunk: Buffer) => {
                      bytes += chunk.length;
                      if (bytes > 1024 ** 2) stream.destroy(new AppError('远端文本超过 1 MiB'));
                      else chunks.push(Buffer.from(chunk));
                    });
                    stream.once('end', () => {
                      ended = true;
                    });
                    stream.once('error', (error: Error) => {
                      cleanup();
                      reject(error);
                    });
                    stream.once('close', () => {
                      cleanup();
                      if (transferSignal.aborted) reject(transferSignal.reason);
                      else if (ended) resolve();
                      else reject(new AppError('文本读取未完成'));
                    });
                    transferSignal.addEventListener('abort', abort, { once: true });
                    if (transferSignal.aborted) abort();
                  });
                  const theirs = Buffer.concat(chunks);
                  if (digest(ours) !== hostHash || digest(theirs) !== guestHash)
                    throw new AppError('合并期间文件发生变化，请重新预览', 409);
                  const parts = threeWayMerge(base, decodeText(ours), decodeText(theirs));
                  if (parts.some((part) => part.kind === 'conflict')) {
                    conflicts++;
                    next[name] = previous[name];
                    log('三方合并存在重叠修改，保留两端供手动处理：' + name + '\n');
                    continue;
                  }
                  const merged = Buffer.from(resolvedMerge(parts, {}));
                  const hostTemp = join(dirname(local), '.sakura-sync-' + randomUUID());
                  const guestTemp = posix.join(posix.dirname(remote), '.sakura-sync-' + randomUUID());
                  try {
                    await writeFile(hostTemp, merged, { flag: 'wx', mode: localAttrs.mode });
                    await pipeline(
                      Readable.from([merged]),
                      rate.stream(transferSignal),
                      ftp.createWriteStream(guestTemp, { flags: 'wx', mode: attrs.mode }),
                      { signal: transferSignal },
                    );
                    await preserveFileMetadata(ftp, guestTemp, attrs);
                    if (
                      (await hash(ftp.createReadStream(guestTemp), transferSignal)) !== digest(merged) ||
                      (await hash(ftp.createReadStream(remote), transferSignal)) !== guestHash ||
                      (await hash(createReadStream(await hostPath(name)), transferSignal)) !== hostHash
                    )
                      throw new AppError('合并提交前文件变化或校验失败，已保留原文件', 409);
                    transferSignal.throwIfAborted();
                    await new Promise<void>((resolve, reject) =>
                      ftp.ext_openssh_rename(guestTemp, remote, (error) =>
                        error ? reject(error) : resolve(),
                      ),
                    );
                    try {
                      await rename(hostTemp, local);
                    } catch (error) {
                      log('Linux 端已保存合并内容，Windows 端保留原文件，请重新预览：' + name + '\n');
                      throw error;
                    }
                    next[name] = digest(merged);
                    bases[name] = merged.toString('utf8');
                    changed++;
                    log('已完成三方文本合并：' + name + '\n');
                  } finally {
                    await rm(hostTemp, { force: true });
                    if (!transportSignal?.aborted)
                      await new Promise<void>((resolve) => ftp.unlink(guestTemp, () => resolve()));
                  }
                  continue;
                }
                if (decision === 'push' || decision === 'pull') way = decision;
                else if (decision === 'restore-host') way = 'pull';
                else if (decision === 'restore-guest') way = 'push';
                else if (decision === 'delete-host' || decision === 'delete-guest') way = decision;
                else if (decision === 'both') {
                  const backup = `${name}.linux-conflict-${randomUUID().slice(0, 8)}`;
                  const localBackup = await hostPath(backup),
                    remoteBackup = posix.join(config.guest, backup);
                  const remoteOriginal = posix.join(config.guest, name);
                  const temp = join(dirname(localBackup), '.sakura-sync-' + randomUUID());
                  try {
                    await pipeline(
                      ftp.createReadStream(remoteOriginal),
                      rate.stream(transferSignal),
                      createWriteStream(temp, { flags: 'wx' }),
                      { signal: transferSignal },
                    );
                    if ((await hash(createReadStream(temp), transferSignal)) !== guestHash)
                      throw new AppError(`文件在同步中改变：${name}`);
                    // Exclusive creation preserves any existing conflict copies.
                    await pipeline(
                      createReadStream(temp),
                      rate.stream(transferSignal),
                      ftp.createWriteStream(remoteBackup, { flags: 'wx', mode: 0o644 }),
                      { signal: transferSignal },
                    );
                    transferSignal.throwIfAborted();
                    await rename(temp, localBackup);
                    next[backup] = guestHash!;
                    log(`Linux 版本另存为 ${backup}\n`);
                  } finally {
                    await rm(temp, { force: true });
                  }
                  way = 'push';
                } else {
                  conflicts++;
                  if (previous[name]) next[name] = previous[name];
                  log(`冲突，保留两边：${name}\n`);
                  continue;
                }
              }
            }
            const local = await hostPath(name),
              remote = posix.join(config.guest, name);
            if (way === 'delete-host' && !hostHash && guestHash) {
              await new Promise<void>((resolve, reject) =>
                ftp.unlink(posix.join(config.guest, name), (error) => (error ? reject(error) : resolve())),
              );
              delete next[name];
            } else if (way === 'delete-guest' && hostHash && !guestHash) {
              await rm(local, { force: true });
              delete next[name];
            } else if (way === 'push' && hostHash) {
              await ensureGuest(posix.dirname(remote));
              const attrs = await ftpStat(ftp, remote);
              if (attrs && !attrs.isFile()) throw new AppError(`目标不是普通文件：${remote}`);
              const temp = posix.join(posix.dirname(remote), '.sakura-sync-' + randomUUID());
              try {
                await pipeline(
                  createReadStream(local),
                  rate.stream(transferSignal),
                  ftp.createWriteStream(temp, { flags: 'wx', mode: attrs?.mode || 0o644 }),
                  { signal: transferSignal },
                );
                const uploaded = await hash(ftp.createReadStream(temp), transferSignal);
                if (uploaded !== hostHash) throw new AppError(`文件在同步中改变，请重试：${name}`);
                if (attrs) await preserveFileMetadata(ftp, temp, attrs);
                const current = await ftpStat(ftp, remote);
                if (
                  direction === 'both' &&
                  (current ? await hash(ftp.createReadStream(remote), transferSignal) : undefined) !==
                    guestHash
                )
                  throw new AppError(`目标在同步中改变，已保留原文件：${name}`);
                transferSignal.throwIfAborted();
                await new Promise<void>((res, rej) =>
                  ftp.ext_openssh_rename(temp, remote, (err) => (err ? rej(err) : res())),
                );
                next[name] = hostHash;
              } finally {
                if (!transportSignal?.aborted)
                  await new Promise<void>((res) => ftp.unlink(temp, () => res()));
              }
            } else if (way === 'pull' && guestHash) {
              await mkdir(dirname(local), { recursive: true });
              await hostPath(name);
              const temp = join(dirname(local), '.sakura-sync-' + randomUUID());
              try {
                await pipeline(
                  ftp.createReadStream(remote),
                  rate.stream(transferSignal),
                  createWriteStream(temp, { flags: 'wx' }),
                  {
                    signal: transferSignal,
                  },
                );
                if ((await hash(createReadStream(temp), transferSignal)) !== guestHash)
                  throw new AppError(`文件在同步中改变，请重试：${name}`);
                const current = await lstat(await hostPath(name)).catch((e: NodeJS.ErrnoException) => {
                  if (e.code !== 'ENOENT') throw e;
                  return null;
                });
                if (
                  direction === 'both' &&
                  (current ? await hash(createReadStream(local), transferSignal) : undefined) !== hostHash
                )
                  throw new AppError(`目标在同步中改变，已保留原文件：${name}`);
                transferSignal.throwIfAborted();
                await rename(temp, local);
                next[name] = guestHash;
              } finally {
                await rm(temp, { force: true });
              }
            } else {
              if (previous[name]) next[name] = previous[name];
              continue;
            }
            changed++;
            log(`${way === 'push' ? '上传' : '下载'}：${name}\n`);
          }
        },
        connection.signal,
      );
    } finally {
      signal.removeEventListener('abort', abortConnection);
    }
    signal.throwIfAborted();
    if (preview) return plan;
    if (config.mergeText) {
      const retained: Record<string, string> = Object.create(null);
      let total = 0,
        serializedBytes = 2;
      for (const [name, sha] of Object.entries(next)) {
        let text = typeof bases[name] === 'string' && digest(bases[name]) === sha ? bases[name] : undefined;
        if (text === undefined) {
          const file = await hostPath(name);
          const info = await lstat(file).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
            return null;
          });
          if (info?.isFile() && info.size <= 1024 ** 2) {
            const bytes = await readFile(file);
            if (digest(bytes) === sha) {
              try {
                text = decodeText(bytes);
              } catch {}
            }
          }
        }
        const cost =
          text === undefined
            ? 0
            : Buffer.byteLength(JSON.stringify(name)) + Buffer.byteLength(JSON.stringify(text)) + 2;
        if (
          text !== undefined &&
          total + Buffer.byteLength(text) <= 16 * 1024 ** 2 &&
          serializedBytes + cost <= 32 * 1024 ** 2
        ) {
          retained[name] = text;
          total += Buffer.byteLength(text);
          serializedBytes += cost;
        }
      }
      await writeFile(baseFile + '.tmp', JSON.stringify(retained), { mode: 0o600 });
      await rename(baseFile + '.tmp', baseFile);
    }
    await writeFile(stateFile + '.tmp', JSON.stringify(next), { mode: 0o600 });
    await rename(stateFile + '.tmp', stateFile);
    log(`完成：${changed} 个文件已同步，${conflicts} 个冲突。删除操作不会传播。\n`);
    return plan;
  }
}
