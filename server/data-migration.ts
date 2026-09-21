import { mkdir, readdir, lstat, statfs, copyFile, rename, rm, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, dirname, resolve, basename, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DATA, AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { Jobs } from './jobs.ts';
import { fileHash, regularDirectory, within, readStore, writeStore } from './local-store.ts';

type MigrationFile = { path: string; bytes: number; modified: number };
export class DataMigration {
  jobs = new Jobs('migration');
  private target?: string;
  private copyPublished = false;
  blocked = false;
  constructor(
    private machines: Machines,
    private stores: () => Jobs[],
    private source = DATA,
  ) {}
  async view() {
    return {
      source: this.source,
      target: this.target,
      restartRequired: this.copyPublished,
      blocked: this.blocked,
      job: this.jobs.view('data'),
      previous: await readStore(join(this.source, '.sakura-migration.json'), () => null),
    };
  }
  private async files() {
    const items: MigrationFile[] = [];
    const scan = async (folder: string) => {
      for (const item of await readdir(join(this.source, folder), { withFileTypes: true })) {
        const path = join(folder, item.name);
        if (
          !folder &&
          (['posixloom', '.sakura-redirect.json', '.sakura-migration.json'].includes(item.name) ||
            /^\.(decrypt|encrypted-import)-/.test(item.name))
        )
          continue;
        if (
          path === join('jobs', 'migration.json') ||
          item.name.endsWith('.tmp') ||
          item.name.endsWith('.part')
        )
          continue;
        const info = await lstat(join(this.source, path));
        if (info.isSymbolicLink()) throw new AppError(`迁移目录含符号链接或联接，请先处理：${path}`);
        if (info.isDirectory()) await scan(path);
        else if (info.isFile()) items.push({ path, bytes: info.size, modified: info.mtimeMs });
        else throw new AppError(`不支持迁移的文件类型：${path}`);
      }
    };
    await scan('');
    return items.sort((a, b) => a.path.localeCompare(b.path));
  }
  async plan(input: string) {
    if (typeof input !== 'string' || !isAbsolute(input))
      throw new AppError('请输入目标磁盘上的新目录绝对路径');
    const target = await regularDirectory(input);
    const source = await realpath(await regularDirectory(this.source));
    if (within(source, target) || within(target, source))
      throw new AppError('目标目录不能与当前数据目录相同或相互包含');
    const exists = await lstat(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (exists) throw new AppError('目标目录必须尚未存在，迁移会为你创建');
    await Promise.all(this.stores().map((store) => store.flush()));
    const files = await this.files(),
      bytes = files.reduce((total, item) => total + item.bytes, 0);
    let parent = dirname(target);
    while (!(await lstat(parent).catch(() => null))) parent = dirname(parent);
    const volume = await statfs(parent),
      available = volume.bavail * volume.bsize;
    if (available < bytes + 64 * 1024 ** 2) throw new AppError('目标磁盘空间不足，需额外保留 64 MiB');
    const token = createHash('sha256').update(JSON.stringify({ source, target, files })).digest('hex');
    return { source, target, bytes, available, count: files.length, token, files };
  }
  async start(input: string, token: string) {
    if (this.blocked) throw new AppError('另一项迁移正在进行或等待重启', 409);
    if (this.stores().some((store) => store.list().some((job) => job.status === 'running')))
      throw new AppError('请等待全部后台任务结束', 409);
    this.machines.enterMaintenance();
    this.blocked = true;
    try {
      await Promise.all(this.stores().map((store) => store.flush()));
      const plan = await this.plan(input);
      if (plan.token !== token) throw new AppError('数据已变化，请重新预览迁移', 409);
      this.target = plan.target;
      const id = randomUUID(),
        stage = join(dirname(plan.target), `.sakura-migrate-${id}`);
      const job = this.jobs.start(
        'data',
        async (log, signal, update) => {
          let staged = false;
          try {
            await mkdir(dirname(stage), { recursive: true });
            await mkdir(stage, { mode: 0o700 });
            staged = true;
            let copied = 0;
            for (const file of plan.files) {
              signal.throwIfAborted();
              const sourceFile = join(this.source, file.path),
                destination = join(stage, file.path);
              if (!within(stage, destination)) throw new AppError('迁移路径越界');
              await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
              update(`复制与校验 ${file.path}`, plan.bytes ? (copied / plan.bytes) * 75 : 0);
              await copyFile(sourceFile, destination, constants.COPYFILE_EXCL);
              const [before, after] = await Promise.all([
                fileHash(sourceFile, signal),
                fileHash(destination, signal),
              ]);
              const info = await lstat(sourceFile);
              if (before !== after || info.size !== file.bytes || info.mtimeMs !== file.modified)
                throw new AppError(`源文件发生变化或校验失败：${file.path}`);
              copied += file.bytes;
            }
            for (const vm of this.machines.records.values()) {
              signal.throwIfAborted();
              const disk = join(stage, 'machines', vm.id, 'disk.qcow2');
              const info = JSON.parse(
                await this.machines.engine.run('sakura-img', ['info', '--output=json', '-f', 'qcow2', disk], {
                  signal,
                }),
              );
              const backing: string | undefined = info['full-backing-filename'] || info['backing-filename'];
              if (backing && within(this.source, resolve(backing))) {
                const next = join(plan.target, relative(this.source, resolve(backing)));
                await this.machines.engine.run(
                  'sakura-img',
                  ['rebase', '-u', '-f', 'qcow2', '-F', 'qcow2', '-b', next, disk],
                  { signal },
                );
                log(`已修复 ${vm.name} 的基础镜像路径。\n`);
              }
            }
            for (const file of plan.files.filter((item) =>
              /^backups[\\/][^\\/]+[\\/]index\.json$/.test(item.path),
            )) {
              const backup = await readStore<{
                policy: { directory?: string };
                items: { directory?: string }[];
              }>(join(stage, file.path), () => ({ policy: {}, items: [] }));
              let changed = false;
              for (const entry of [backup.policy, ...backup.items])
                if (entry.directory && within(this.source, entry.directory)) {
                  entry.directory = join(plan.target, relative(this.source, entry.directory));
                  changed = true;
                }
              if (changed) await writeStore(join(stage, file.path), backup);
            }
            // Managed SSH entries are regenerated after restart, before using any VM.
            await rm(join(stage, 'ssh', 'config'), { force: true });
            signal.throwIfAborted();
            await rename(stage, plan.target);
            staged = false;
            update('核对迁移后的虚拟磁盘', 85);
            for (const vm of this.machines.records.values()) {
              signal.throwIfAborted();
              await this.machines.engine.run(
                'sakura-img',
                [
                  'compare',
                  '-f',
                  'qcow2',
                  '-F',
                  'qcow2',
                  join(this.source, 'machines', vm.id, 'disk.qcow2'),
                  join(plan.target, 'machines', vm.id, 'disk.qcow2'),
                ],
                { signal },
              );
            }
            const marker = {
              id,
              source: resolve(this.source),
              target: plan.target,
              completedAt: new Date().toISOString(),
              bytes: plan.bytes,
              files: plan.count,
            };
            await writeStore(join(plan.target, '.sakura-migration.json'), marker);
            signal.throwIfAborted();
            await writeStore(join(this.source, '.sakura-redirect.json'), {
              version: 1,
              target: plan.target,
              id,
            });
            this.copyPublished = true;
            log('复制、校验和路径修复已完成。重启服务后使用新目录；原目录仍保留。\n');
          } catch (error) {
            this.blocked = false;
            this.machines.maintenance = false;
            throw error;
          } finally {
            if (
              staged &&
              dirname(stage) === dirname(plan.target) &&
              basename(stage) === `.sakura-migrate-${id}`
            )
              await rm(stage, { recursive: true, force: true });
          }
        },
        { title: '数据目录迁移' },
      );
      void this.jobs.wait('data').then(() => {
        if (!this.copyPublished) {
          this.blocked = false;
          this.machines.maintenance = false;
        }
      });
      return job;
    } catch (error) {
      this.blocked = false;
      this.machines.maintenance = false;
      throw error;
    }
  }
  async cancelActivation() {
    if (!this.copyPublished || this.jobs.view('data')?.status === 'running')
      throw new AppError('迁移尚未完成');
    await rm(join(this.source, '.sakura-redirect.json'));
    this.copyPublished = false;
    this.blocked = false;
    this.machines.maintenance = false;
    return this.view();
  }
  async close() {
    await this.jobs.close();
  }
}
