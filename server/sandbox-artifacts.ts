import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, rename, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { storageRuntime, storageGrowth, withStorageLease, type StorageLease } from './storage-runtime.ts';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { SANDBOX_ARTIFACT_BYTES, type SandboxArtifact } from '../shared/sandbox.ts';
import { ftpStat } from './files.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

export const artifactPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/[\\\x00-\x1f]/.test(value) &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    '产物需要工作目录内的相对文件路径，不能包含 .. 或反斜线',
  );

/** Copies only explicitly selected guest files. Host filenames are generated IDs. */
export class SandboxArtifacts {
  constructor(
    private machines: Machines,
    private directory = join(DATA, 'plugins', 'sandbox', 'artifacts'),
  ) {}

  /** Include these destination devices in an enclosing operation's atomic admission. */
  storagePaths() {
    return [this.directory];
  }

  async collect(
    vmId: string,
    runId: string,
    cwd: string,
    paths: string[],
    saved: (item: SandboxArtifact) => void,
    signal: AbortSignal,
    borrowed?: StorageLease,
  ) {
    if (!paths.length) return;
    z.uuid().parse(runId);
    return withStorageLease(
      {
        owner: 'core:sandbox-artifacts',
        taskId: 'artifacts:' + runId,
        label: 'Collect sandbox artifacts',
        mode: 'write',
        paths: [this.directory],
        dynamicTemporary: [this.directory],
        buffers: 1024 ** 2,
        files: 3,
        signal,
      },
      borrowed,
      async (lease) => {
        let total = 0;
        await mkdir(this.directory, { recursive: true });
        await this.machines.sftp(
          vmId,
          async (ftp, transport) => {
            const combined = transport ? AbortSignal.any([signal, transport]) : signal;
            const realpath = (path: string) =>
              new Promise<string>((done, fail) =>
                ftp.realpath(path, (error, value) => (error ? fail(error) : done(value))),
              );
            const root = await realpath(cwd);
            for (const path of paths) {
              combined.throwIfAborted();
              artifactPathSchema.parse(path);
              const actual = await realpath(posix.join(root, path));
              if (!actual.startsWith(root.replace(/\/$/, '') + '/'))
                throw new AppError('产物链接不能指向工作目录之外');
              const attrs = await ftpStat(ftp, actual);
              if (!attrs?.isFile()) throw new AppError('产物不存在或不是普通文件：' + path, 404);
              if (total + attrs.size > SANDBOX_ARTIFACT_BYTES)
                throw new AppError('每次执行的产物总量最多 8 MiB', 413);
              const id = randomUUID(),
                file = join(this.directory, `${runId}.${id}.bin`),
                temporary = file + '.part';
              let bytes = 0;
              const hash = createHash('sha256');
              const inspect = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  bytes += chunk.length;
                  if (bytes > attrs.size || total + bytes > SANDBOX_ARTIFACT_BYTES)
                    return callback(new AppError('产物大小发生变化', 409));
                  hash.update(chunk);
                  callback(null, chunk);
                },
              });
              try {
                await pipeline(
                  attrs.size
                    ? ftp.createReadStream(actual, { start: 0, end: attrs.size - 1 })
                    : Readable.from([]),
                  inspect,
                  storageGrowth(lease, temporary, SANDBOX_ARTIFACT_BYTES),
                  createWriteStream(temporary, { flags: 'wx', mode: 0o600, flush: true }),
                  { signal: combined },
                );
                if (bytes !== attrs.size) throw new AppError('产物读取不完整：' + path, 409);
                combined.throwIfAborted();
                await rename(temporary, file);
                saved({ id, name: posix.basename(path), path, bytes, sha256: hash.digest('hex') });
                total += bytes;
              } finally {
                try {
                  await rm(temporary, { force: true });
                } catch (error) {
                  lease.cleanupPending(error);
                  throw error;
                }
                if (!lease.pendingCleanup) await lease.releaseTemporary(temporary);
              }
            }
          },
          signal,
        );
      },
    );
  }

  async download(job: JobView | undefined, artifactId: string) {
    z.uuid().parse(artifactId);
    if (!job?.id) throw new AppError('执行记录不存在或已过期', 404);
    const runId = z.uuid().parse(job?.id);
    const artifact = job?.execution?.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new AppError('产物不存在或执行记录已过期', 404);
    const file = join(this.directory, `${runId}.${artifactId}.bin`);
    return storageRuntime.run(
      {
        owner: 'core:sandbox-artifact-read',
        taskId: 'artifact-read:' + randomUUID(),
        label: 'Read sandbox artifact',
        mode: 'read',
        paths: [file],
        buffers: SANDBOX_ARTIFACT_BYTES * 3,
        files: 1,
      },
      async () => {
        const info = await lstat(file);
        if (!info.isFile() || info.size > SANDBOX_ARTIFACT_BYTES || info.size !== artifact.bytes)
          throw new AppError('产物校验失败：文件长度无效', 409);
        const data = await readFile(file).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('产物文件已不可用', 404);
          throw error;
        });
        if (
          data.length !== artifact.bytes ||
          createHash('sha256').update(data).digest('hex') !== artifact.sha256
        )
          throw new AppError('产物校验失败', 409);
        return { ...artifact, base64: data.toString('base64') };
      },
    );
  }

  async prune(jobs: JobView[]) {
    const retained = new Map(jobs.map((job) => [job.id, job]));
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      // Only delete our flat, generated files; never follow directories or user paths.
      const match = /^([a-f0-9-]{36})\.([a-f0-9-]{36})\.bin(?:\.part)?$/.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const job = retained.get(match[1]);
      // A running collector may be between its atomic rename and metadata update.
      if (job?.status === 'running') continue;
      const keep =
        !entry.name.endsWith('.part') && job?.execution?.artifacts.some((item) => item.id === match[2]);
      if (!keep) await rm(join(this.directory, entry.name), { force: true });
    }
  }
}
