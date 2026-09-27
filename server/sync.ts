import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, realpath, mkdir, rename, readFile, writeFile, rm, link } from 'node:fs/promises';
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
import {
  matchesSyncPattern,
  syncPattern,
  syncPolicySchema,
  policyAllows,
  pathPolicy,
  detectSyncRenames,
} from '../shared/sync-policy.ts';
import { SyncHistory, type SyncSide } from './sync-history.ts';
import { SyncWatchers } from './sync-watch.ts';

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
    detectRenames: z.boolean().optional(),
    rollback: z.boolean().optional(),
    watch: z.boolean().optional(),
    policies: z.array(syncPolicySchema).max(64).optional(),
    window: timeWindowSchema.optional(),
    bandwidthMiBps: z
      .number()
      .min(0)
      .max(10240)
      .refine((value) => value === 0 || value >= 0.1)
      .optional(),
    ignore: z.array(syncPattern).max(64).optional(),
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
  from?: string;
  action:
    | 'push'
    | 'pull'
    | 'conflict'
    | 'mkdir-host'
    | 'mkdir-guest'
    | 'delete-host'
    | 'delete-guest'
    | 'rename-host'
    | 'rename-guest'
    | 'skip';
};
export type SyncPreview = { token: string; changes: SyncChange[]; unchanged: number };
export type SyncDecisions = Record<
  string,
  | 'push'
  | 'pull'
  | 'both'
  | 'skip'
  | 'merge'
  | 'manual'
  | 'delete-host'
  | 'delete-guest'
  | 'restore-host'
  | 'restore-guest'
>;
export type SyncManualMerges = Record<string, string>;

const SYNC_TEXT_BYTES = 1024 ** 2;
function decodeSyncText(bytes: Buffer) {
  if (bytes.length > SYNC_TEXT_BYTES || bytes.includes(0))
    throw new AppError('三方同步只支持 1 MiB 以内的 UTF-8 文本');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AppError('三方同步需要 UTF-8 文本');
  }
}
async function readSyncText(stream: Readable, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  await pipeline(stream, new Writable({
    write(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > SYNC_TEXT_BYTES) done(new AppError('三方同步只支持 1 MiB 以内的 UTF-8 文本'));
      else {
        chunks.push(Buffer.from(chunk));
        done();
      }
    },
  }), { signal });
  return decodeSyncText(Buffer.concat(chunks));
}
export const ignored = matchesSyncPattern;
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
  private watchers: SyncWatchers;
  private debounce?: ReturnType<typeof setTimeout>;
  private onChange = () => {
    this.watchers.retain((_key, id) => this.machines.records.has(id));
    for (const id of this.machines.records.keys())
      if (this.machines.state(id) !== 'running')
        for (const job of this.jobs.list())
          if (job.vmId === id && job.status === 'running') this.jobs.cancel(job.id!);
  };
  constructor(
    private machines: Machines,
    private projects?: ProjectCatalog,
  ) {
    this.watchers = new SyncWatchers(machines, () => {
      if (this.closed || this.debounce) return;
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        if (!this.closed && !this.ticking)
          this.ticking = this.tick().finally(() => {
            this.ticking = undefined;
          });
      }, 500);
      this.debounce.unref();
    });
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
  private history(id: string) {
    return new SyncHistory(
      this.file(id, 'sync-history') + '.d',
      this.file(id, 'sync-state'),
      this.file(id, 'sync-base'),
    );
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
    clearTimeout(this.debounce);
    await this.watchers.close();
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
      this.watchers.ensure(this.key(id), id, config);
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
      history: await this.history(id).list(),
      watching: this.watchers.view(this.key(id)),
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
    this.watchers.retain((_key, id) => this.machines.records.has(id));
    for (const id of this.machines.records.keys()) {
      if (this.closed) return;
      try {
        const keys = new Set<string>();
        await this.eachProject(id, async () => {
          keys.add(this.key(id));
          try {
            await this.machines.locked(`sync:${this.key(id)}`, async () => {
              const config = await this.config(id);
              if (!config) return;
              this.watchers.ensure(this.key(id), id, config);
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
              if (!pending && config.watch && !this.watchers.due(this.key(id), now)) return;
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
                this.watchers.started(this.key(id), now);
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
        this.watchers.retain((key, vmId) => vmId !== id || keys.has(key));
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
  async mergePreview(id: string, inputPath: string, token: string, signal: AbortSignal = new AbortController().signal) {
    const name = safeRelative(inputPath);
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = await this.config(id);
      if (!config?.mergeText) throw new AppError('请先启用共同文本版本并完成一次同步', 409);
      const plan = await this.execute(id, config, 'both', () => {}, signal, true);
      if (plan.token !== token) throw new AppError('预览后文件或配置已变化，请重新预览', 409);
      if (!plan.changes.some((change) => change.path === name && change.action === 'conflict') ||
          !policyAllows(name, 'merge', config.policies))
        throw new AppError('此路径没有可合并的文本冲突', 409);
      const root = await realpath(config.host);
      if (root !== config.host) throw new AppError('本机目录位置已改变，请重新保存', 409);
      const local = resolve(root, ...name.split('/'));
      const rel = relative(root, local);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new AppError('同步路径越界');
      let current = root;
      for (const part of rel.split(sep)) {
        current = join(current, part);
        const attrs = await lstat(current);
        if (attrs.isSymbolicLink()) throw new AppError('同步不会穿过符号链接或目录联接');
      }
      if (!(await lstat(local)).isFile()) throw new AppError('Windows 冲突路径不是普通文件', 409);
      const stateFile = this.file(id, 'sync-state'), baseFile = this.file(id, 'sync-base');
      if ((await lstat(baseFile)).size > 32 * 1024 ** 2) throw new AppError('同步共同版本文件超过限制');
      const previous = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, string>;
      const bases = JSON.parse(await readFile(baseFile, 'utf8')) as Record<string, string>;
      const base = bases[name];
      if (typeof base !== 'string' ||
          createHash('sha256').update(base).digest('hex') !== previous[name])
        throw new AppError('没有可校验的共同版本，请重新建立同步基线', 409);
      decodeSyncText(Buffer.from(base));
      const ours = await readSyncText(createReadStream(local), signal);
      const theirs = await this.machines.sftp(id, async (ftp, transportSignal) => {
        const active = transportSignal ? AbortSignal.any([signal, transportSignal]) : signal;
        const remote = posix.join(config.guest, name);
        let path = '';
        for (const part of posix.dirname(remote).split('/').filter(Boolean)) {
          path += '/' + part;
          if (!(await ftpStat(ftp, path))?.isDirectory())
            throw new AppError('Linux 冲突路径包含非普通目录', 409);
        }
        if (!(await ftpStat(ftp, remote))?.isFile())
          throw new AppError('Linux 冲突路径不是普通文件', 409);
        return readSyncText(ftp.createReadStream(remote), active);
      }, signal);
      const after = await this.execute(id, config, 'both', () => {}, signal, true);
      if (after.token !== token) throw new AppError('读取合并内容时文件发生变化，请重新预览', 409);
      return { path: name, token, base, ours, theirs };
    });
  }
  async run(id: string, direction: 'both' | 'push' | 'pull', token?: string,
    decisions: SyncDecisions = {}, merges: SyncManualMerges = {}) {
    return this.machines.locked(`sync:${this.key(id)}`, () =>
      this.runInternal(id, direction, token, decisions, merges),
    );
  }
  async rollback(id: string, checkpoint: string) {
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      const config = await this.config(id);
      if (!config) throw new AppError('请先保存同步目录');
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const history = this.history(id);
      await history.read(checkpoint);
      return this.jobs.start(
        this.key(id),
        async (log, signal) => {
          const root = await realpath(config.host);
          if (root !== config.host) throw new AppError('本机目录位置已改变');
          const localPath = async (name: string) => {
            let file = root;
            for (const part of safeRelative(name).split('/')) {
              file = join(file, part);
              const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') throw error;
                return null;
              });
              if (info?.isSymbolicLink()) throw new AppError('回滚不会穿过符号链接或目录联接');
            }
            return file;
          };
          await this.machines.sftp(
            id,
            async (ftp, transportSignal) => {
              const active = transportSignal ? AbortSignal.any([signal, transportSignal]) : signal;
              const guestPath = async (name: string, create = false) => {
                const target = posix.join(config.guest, safeRelative(name));
                let path = '';
                for (const part of posix.dirname(target).split('/').filter(Boolean)) {
                  path += '/' + part;
                  const info = await ftpStat(ftp, path);
                  if (info && !info.isDirectory()) throw new AppError('回滚不会穿过非普通目录：' + path);
                  if (!info && create)
                    await new Promise<void>((resolve, reject) =>
                      ftp.mkdir(path, (error) => (error ? reject(error) : resolve())),
                    );
                }
                return target;
              };
              const current = async (side: SyncSide, name: string) => {
                active.throwIfAborted();
                if (side === 'host') {
                  const file = await localPath(name),
                    info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
                      if (error.code !== 'ENOENT') throw error;
                      return null;
                    });
                  if (!info) return null;
                  if (!info.isFile() || info.size > 256 * 1024 ** 2)
                    throw new AppError('回滚目标不是普通文件：' + name);
                  return hash(createReadStream(file), active);
                }
                const file = await guestPath(name),
                  info = await ftpStat(ftp, file);
                if (!info) return null;
                if (!info.isFile() || info.size > 256 * 1024 ** 2)
                  throw new AppError('回滚目标不是普通文件：' + name);
                return hash(ftp.createReadStream(file), active);
              };
              const result = await history.restore(
                checkpoint,
                config,
                current,
                async (entry, blob, expected) => {
                  if ((await current(entry.side, entry.path)) !== expected)
                    throw new AppError('恢复前文件已变化：' + entry.path, 409);
                  if (entry.side === 'host') {
                    const target = await localPath(entry.path);
                    if (!blob) await rm(target);
                    else {
                      await mkdir(dirname(target), { recursive: true });
                      await localPath(entry.path);
                      const temp = join(dirname(target), '.sakura-restore-' + randomUUID());
                      try {
                        await pipeline(
                          createReadStream(blob),
                          createWriteStream(temp, { flags: 'wx', mode: entry.before!.mode }),
                          { signal: active },
                        );
                        if ((await current(entry.side, entry.path)) !== expected)
                          throw new AppError('恢复前文件已变化：' + entry.path, 409);
                        await rename(temp, target);
                      } finally {
                        await rm(temp, { force: true });
                      }
                    }
                  } else {
                    const target = await guestPath(entry.path, !!blob);
                    if (!blob)
                      await new Promise<void>((resolve, reject) =>
                        ftp.unlink(target, (error) => (error ? reject(error) : resolve())),
                      );
                    else {
                      const temp = posix.join(posix.dirname(target), '.sakura-restore-' + randomUUID());
                      try {
                        await pipeline(
                          createReadStream(blob),
                          ftp.createWriteStream(temp, { flags: 'wx', mode: entry.before!.mode }),
                          { signal: active },
                        );
                        if (entry.before!.uid !== undefined && entry.before!.gid !== undefined)
                          await new Promise<void>((resolve, reject) =>
                            ftp.chown(temp, entry.before!.uid!, entry.before!.gid!, (error) =>
                              error ? reject(error) : resolve(),
                            ),
                          );
                        await new Promise<void>((resolve, reject) =>
                          ftp.chmod(temp, entry.before!.mode & 0o7777, (error) =>
                            error ? reject(error) : resolve(),
                          ),
                        );
                        if (
                          (await hash(ftp.createReadStream(temp), active)) !== entry.before!.sha ||
                          (await current(entry.side, entry.path)) !== expected
                        )
                          throw new AppError('恢复前文件变化或校验失败：' + entry.path, 409);
                        await new Promise<void>((resolve, reject) =>
                          ftp.ext_openssh_rename(temp, target, (error) =>
                            error ? reject(error) : resolve(),
                          ),
                        );
                      } finally {
                        if (!transportSignal?.aborted)
                          await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));
                      }
                    }
                  }
                  log(`恢复 ${entry.side === 'host' ? 'Windows' : 'Linux'}：${entry.path}\n`);
                },
                active,
              );
              log(`已回滚 ${result.restored} 项文件变更，恢复共同版本；保留新建的空目录。\n`);
            },
            signal,
          );
        },
        {
          title: '同步回滚',
          vmId: id,
          projectId: this.projects?.current(id),
          action: 'rollback:' + checkpoint,
        },
      );
    });
  }
  private async runInternal(
    id: string,
    direction: 'both' | 'push' | 'pull',
    token?: string,
    decisions: SyncDecisions = {},
    merges: SyncManualMerges = {},
  ) {
    const config = await this.config(id);
    if (!config) throw new AppError('请先保存同步目录');
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    if (Object.keys(decisions).length && !token) throw new AppError('处理冲突前请先预览');
    const mergeEntries = Object.entries(merges);
    if (mergeEntries.length && (direction !== 'both' || !token)) throw new AppError('手动合并需要双向同步预览', 409);
    if (mergeEntries.length > 8) throw new AppError('一次最多手动合并 8 个文件');
    let mergeBytes = 0;
    for (const [name, content] of mergeEntries) {
      safeRelative(name);
      if (decisions[name] !== 'manual' || typeof content !== 'string')
        throw new AppError('手动合并内容与冲突决策不匹配');
      mergeBytes += Buffer.byteLength(content, 'utf8');
      if (mergeBytes > SYNC_TEXT_BYTES) throw new AppError('手动合并内容合计不能超过 1 MiB');
      if (content.includes('\0') || Buffer.from(content, 'utf8').toString('utf8') !== content)
        throw new AppError('手动合并需要有效的 UTF-8 文本');
    }
    if (Object.entries(decisions).some(([name, decision]) => decision === 'manual' &&
        !Object.hasOwn(merges, name)))
      throw new AppError('手动合并缺少已审阅的文本内容');
    return this.jobs.start(
      this.key(id),
      async (log, signal) => {
        await this.execute(id, config, direction, log, signal, false, token, decisions, merges);
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
    merges: SyncManualMerges = {},
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
    let journal: Awaited<ReturnType<SyncHistory['begin']>> | undefined;
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
          const allowed = (name: string, action: string) => policyAllows(name, action, config.policies);
          const renames = config.detectRenames
            ? detectSyncRenames(hostFiles, guestFiles, previous).filter(
                (move) => allowed(move.from, move.action) && allowed(move.path, move.action),
              )
            : [];
          const renamed = new Set(renames.flatMap((move) => [move.from, move.path]));
          const changes: SyncChange[] = [];
          let unchanged = 0;
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys()])) {
            if (renamed.has(name)) continue;
            const way = syncDirection(hostFiles.get(name), guestFiles.get(name), previous[name]);
            if (way === 'same') unchanged++;
            else if (
              previous[name] &&
              !hostFiles.has(name) &&
              guestFiles.has(name) &&
              previous[name] === guestFiles.get(name)
            )
              changes.push({ path: name, action: allowed(name, 'delete-guest') ? 'delete-guest' : 'skip' });
            else if (
              previous[name] &&
              hostFiles.has(name) &&
              !guestFiles.has(name) &&
              previous[name] === hostFiles.get(name)
            )
              changes.push({ path: name, action: allowed(name, 'delete-host') ? 'delete-host' : 'skip' });
            else
              changes.push({
                path: name,
                action: (
                  way === 'conflict' ? allowed(name, 'push') || allowed(name, 'pull') : allowed(name, way)
                )
                  ? way
                  : 'skip',
              });
          }
          changes.push(...renames.map(({ from, path, action }) => ({ from, path, action })));
          for (const name of hostDirs)
            if (!guestDirs.has(name) && allowed(name, 'mkdir-guest'))
              changes.push({ path: name, action: 'mkdir-guest' });
          for (const name of guestDirs)
            if (!hostDirs.has(name) && allowed(name, 'mkdir-host'))
              changes.push({ path: name, action: 'mkdir-host' });
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
          for (const name of Object.keys(merges)) {
            if (!changes.some((change) => change.path === name && change.action === 'conflict'))
              throw new AppError('手动合并只允许处理当前预览中的冲突：' + name, 409);
            if (!config.mergeText || !allowed(name, 'merge') || typeof bases[name] !== 'string' ||
                digest(bases[name]) !== previous[name])
              throw new AppError('没有可校验的共同版本或路径策略禁止合并：' + name, 409);
            decodeSyncText(Buffer.from(bases[name]));
          }
          if (config.rollback && changes.some((change) => change.action !== 'skip')) {
            log('保存同步回滚点…\n');
            journal = await this.history(id).begin(
              config,
              { host: hostFiles, guest: guestFiles },
              async (side, name) => {
                if (side === 'host') {
                  const file = await hostPath(name),
                    info = await lstat(file);
                  if (!info.isFile()) throw new AppError('回滚源不是普通文件：' + name);
                  return { stream: createReadStream(file), mode: info.mode };
                }
                const file = posix.join(config.guest, name),
                  info = await ftpStat(ftp, file);
                if (!info?.isFile()) throw new AppError('回滚源不是普通文件：' + name);
                return { stream: ftp.createReadStream(file), mode: info.mode, uid: info.uid, gid: info.gid };
              },
              transferSignal,
            );
          }
          await ensureGuest(config.guest);
          if (direction !== 'pull')
            for (const name of hostDirs) {
              if (!allowed(name, 'mkdir-guest')) continue;
              transferSignal.throwIfAborted();
              await ensureGuest(posix.join(config.guest, name));
            }
          if (direction !== 'push')
            for (const name of guestDirs) {
              if (!allowed(name, 'mkdir-host')) continue;
              transferSignal.throwIfAborted();
              await mkdir(await hostPath(name), { recursive: true });
            }
          for (const move of renames) {
            if (
              (direction === 'push' && move.action !== 'rename-guest') ||
              (direction === 'pull' && move.action !== 'rename-host')
            )
              continue;
            transferSignal.throwIfAborted();
            const side = move.action === 'rename-guest' ? 'guest' : 'host';
            await journal?.prepare([
              { side, path: move.from, after: null },
              { side, path: move.path, after: move.sha },
            ]);
            if (move.action === 'rename-guest') {
              const from = posix.join(config.guest, move.from),
                to = posix.join(config.guest, move.path);
              await ensureGuest(posix.dirname(from));
              await ensureGuest(posix.dirname(to));
              const info = await ftpStat(ftp, from);
              if (
                !info?.isFile() ||
                (await ftpStat(ftp, to)) ||
                (await hash(ftp.createReadStream(from), transferSignal)) !== move.sha ||
                (await lstat(await hostPath(move.from)).catch((error) => {
                  if (error.code !== 'ENOENT') throw error;
                  return null;
                })) ||
                (await hash(createReadStream(await hostPath(move.path)), transferSignal)) !== move.sha
              )
                throw new AppError('重命名前文件已变化，请重新预览：' + move.path, 409);
              // SFTP v3 rename fails if the destination already exists.
              await new Promise<void>((resolve, reject) =>
                ftp.rename(from, to, (error) => (error ? reject(error) : resolve())),
              );
              guestFiles.delete(move.from);
              guestFiles.set(move.path, move.sha);
            } else {
              const from = await hostPath(move.from),
                to = await hostPath(move.path);
              await mkdir(dirname(to), { recursive: true });
              await hostPath(move.path);
              if (
                (await ftpStat(ftp, posix.join(config.guest, move.from))) ||
                (await hash(createReadStream(from), transferSignal)) !== move.sha ||
                (await hash(ftp.createReadStream(posix.join(config.guest, move.path)), transferSignal)) !==
                  move.sha
              )
                throw new AppError('重命名前文件已变化，请重新预览：' + move.path, 409);
              // Hard linking gives Windows an exclusive destination; rename would overwrite it.
              await link(from, to);
              await rm(from);
              hostFiles.delete(move.from);
              hostFiles.set(move.path, move.sha);
            }
            if (bases[move.from] !== undefined) bases[move.path] = bases[move.from];
            delete bases[move.from];
            delete previous[move.from];
            previous[move.path] = move.sha;
            changed++;
            log(
              `重命名${move.action === 'rename-guest' ? ' Linux' : ' Windows'}：${move.from} → ${move.path}\n`,
            );
          }
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys(), ...Object.keys(previous)])) {
            transferSignal.throwIfAborted();
            const hostHash = hostFiles.get(name),
              guestHash = guestFiles.get(name);
            if (hostHash === guestHash) {
              if (hostHash) next[name] = hostHash;
              continue;
            }
            if (ignored(name, config.ignore) || (!allowed(name, 'push') && !allowed(name, 'pull'))) {
              if (previous[name]) next[name] = previous[name];
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
                const requested =
                  decision === 'restore-host' ? 'pull' : decision === 'restore-guest' ? 'push' : decision;
                if (requested && requested !== 'skip' && !allowed(name, requested))
                  throw new AppError('路径策略禁止此同步方向：' + name, 409);
                if (decision === 'merge' || decision === 'manual') {
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
                  const parts = threeWayMerge(base, decodeSyncText(ours), decodeSyncText(theirs));
                  if (decision === 'merge' && parts.some((part) => part.kind === 'conflict')) {
                    conflicts++;
                    next[name] = previous[name];
                    log('三方合并存在重叠修改，保留两端供手动处理：' + name + '\n');
                    continue;
                  }
                  const merged = Buffer.from(decision === 'manual' ? merges[name] : resolvedMerge(parts, {}));
                  await journal?.prepare([
                    { side: 'host', path: name, after: digest(merged) },
                    { side: 'guest', path: name, after: digest(merged) },
                  ]);
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
                    const mode = pathPolicy(name, config.policies)?.guestMode;
                    if (mode)
                      await new Promise<void>((resolve, reject) =>
                        ftp.chmod(guestTemp, parseInt(mode, 8), (error) =>
                          error ? reject(error) : resolve(),
                        ),
                      );
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
                else if (decision === 'both') {
                  const backup = `${name}.linux-conflict-${randomUUID().slice(0, 8)}`;
                  const localBackup = await hostPath(backup),
                    remoteBackup = posix.join(config.guest, backup);
                  const remoteOriginal = posix.join(config.guest, name);
                  if (!allowed(backup, 'push') || !allowed(backup, 'pull'))
                    throw new AppError('冲突副本路径受同步策略限制：' + backup);
                  const originalMetadata = await ftpStat(ftp, remoteOriginal);
                  if (!originalMetadata?.isFile()) throw new AppError('冲突文件已变化，请重新预览：' + name);
                  await journal?.prepare([
                    { side: 'host', path: backup, after: guestHash! },
                    { side: 'guest', path: backup, after: guestHash! },
                  ]);
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
                    await preserveFileMetadata(ftp, remoteBackup, originalMetadata);
                    const backupMode =
                      pathPolicy(backup, config.policies)?.guestMode ||
                      pathPolicy(name, config.policies)?.guestMode;
                    if (backupMode)
                      await new Promise<void>((resolve, reject) =>
                        ftp.chmod(remoteBackup, parseInt(backupMode, 8), (error) =>
                          error ? reject(error) : resolve(),
                        ),
                      );
                    transferSignal.throwIfAborted();
                    await link(temp, localBackup);
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
            if (!allowed(name, way)) {
              if (previous[name]) next[name] = previous[name];
              log('路径策略跳过：' + name + '\n');
              continue;
            }
            if (way === 'delete-guest' && !hostHash && guestHash) {
              await journal?.prepare([{ side: 'guest', path: name, after: null }]);
              await ensureGuest(posix.dirname(remote));
              const info = await ftpStat(ftp, remote);
              if (!info?.isFile() || (await hash(ftp.createReadStream(remote), transferSignal)) !== guestHash)
                throw new AppError('删除前 Linux 文件已变化：' + name, 409);
              await new Promise<void>((resolve, reject) =>
                ftp.unlink(posix.join(config.guest, name), (error) => (error ? reject(error) : resolve())),
              );
              delete next[name];
            } else if (way === 'delete-host' && hostHash && !guestHash) {
              await journal?.prepare([{ side: 'host', path: name, after: null }]);
              if ((await hash(createReadStream(await hostPath(name)), transferSignal)) !== hostHash)
                throw new AppError('删除前 Windows 文件已变化：' + name, 409);
              await rm(local);
              delete next[name];
            } else if (way === 'push' && hostHash) {
              await journal?.prepare([{ side: 'guest', path: name, after: hostHash }]);
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
                const mode = pathPolicy(name, config.policies)?.guestMode;
                if (mode)
                  await new Promise<void>((resolve, reject) =>
                    ftp.chmod(temp, parseInt(mode, 8), (error) => (error ? reject(error) : resolve())),
                  );
                const current = await ftpStat(ftp, remote);
                if (
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
              await journal?.prepare([{ side: 'host', path: name, after: guestHash }]);
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
                if ((current ? await hash(createReadStream(local), transferSignal) : undefined) !== hostHash)
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
            log(
              `${way === 'push' ? '上传' : way === 'pull' ? '下载' : way === 'delete-host' ? '删除 Windows 文件' : '删除 Linux 文件'}：${name}\n`,
            );
          }
        },
        connection.signal,
      );
    } catch (error) {
      await journal?.finish(error);
      throw error;
    } finally {
      signal.removeEventListener('abort', abortConnection);
    }
    signal.throwIfAborted();
    if (preview) return plan;
    try {
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
                  text = decodeSyncText(bytes);
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
      await journal?.finish();
    } catch (error) {
      await journal?.finish(error);
      throw error;
    }
    log(`完成：${changed} 个文件已同步，${conflicts} 个冲突。仅按明确决策传播删除。\n`);
    return plan;
  }
}
