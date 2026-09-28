import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, lstat, readFile, rename, rm, rmdir, statfs } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  goldenActionSchema,
  goldenEntrySchema,
  goldenLimits,
  type GoldenAction,
  type GoldenEntry,
  type GoldenResult,
} from '../shared/golden-images.ts';
import { AppError, DATA, checkedId } from './model.ts';
import type { Machines } from './machines.ts';
import type { Bundles } from './bundles.ts';
import { Jobs } from './jobs.ts';
import { fileHash, regularDirectory, writeStore } from './local-store.ts';

export class GoldenImages {
  readonly jobs: Jobs;
  constructor(
    private machines: Machines,
    private bundles: Bundles,
    private root = join(DATA, 'golden-images'),
    jobs = new Jobs('golden-images'),
  ) {
    this.jobs = jobs;
  }
  private async directory(id?: string) {
    const path = id ? join(this.root, checkedId(id)) : this.root;
    await regularDirectory(path);
    return path;
  }
  private async regular(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new AppError('模板不能包含链接或特殊文件', 409);
    return info;
  }
  private async entry(id: string) {
    const directory = await this.directory(id),
      file = join(directory, 'manifest.json');
    const info = await this.regular(file);
    if (info.size > 16384) throw new AppError('模板索引过大', 409);
    const entry = goldenEntrySchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (entry.id !== id) throw new AppError('模板标识不一致', 409);
    const bundle = join(directory, 'template.sakura');
    if ((await this.regular(bundle)).size !== entry.bytes) throw new AppError('模板文件大小不一致', 409);
    return { entry, bundle };
  }
  async view() {
    const root = await this.directory();
    const folders = await readdir(root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const templates: GoldenEntry[] = [],
      issues: { id: string; error: string }[] = [];
    for (const folder of folders) {
      if (!goldenEntrySchema.shape.id.safeParse(folder.name).success) continue;
      try {
        templates.push((await this.entry(folder.name)).entry);
      } catch {
        issues.push({ id: folder.name, error: '模板未完成、索引损坏或文件不可用；可检查本机文件后移除。' });
      }
    }
    return {
      templates: templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      issues,
      limits: goldenLimits,
      job: this.jobs.view('library'),
      persistenceError: this.jobs.persistenceError,
    };
  }
  private sourceAllowed(id: string) {
    this.machines.requireUnlocked(id);
    const source = this.machines.records.get(id);
    if (source?.sandbox) throw new AppError('沙箱实例不能固化为黄金镜像', 409);
  }
  private async remove(id: string) {
    const directory = await this.directory(id);
    // Delete only files this service owns; never recursively traverse a replaced directory.
    const files = await readdir(directory);
    for (const name of files) {
      if (
        !['template.sakura', 'template.sakura.part', 'manifest.json'].includes(name) &&
        !/^manifest\.json\.[a-f0-9-]{36}\.tmp$/.test(name)
      )
        throw new AppError('模板目录包含其他文件，请先在本机检查', 409);
      await this.regular(join(directory, name));
    }
    for (const name of files.sort((a, b) => Number(a === 'manifest.json') - Number(b === 'manifest.json')))
      await rm(join(directory, name));
    await rmdir(directory);
  }
  private async create(
    input: Extract<GoldenAction, { action: 'create' }>,
    signal: AbortSignal,
    log: (text: string) => void,
  ) {
    this.sourceAllowed(input.vmId);
    this.machines.requireStopped(input.vmId);
    let source = { ...this.machines.get(input.vmId) };
    const view = await this.view();
    if (view.issues.length) throw new AppError('请先处理未完成或损坏的模板', 409);
    if (view.templates.length >= goldenLimits.count) throw new AppError('最多保留 16 个黄金镜像', 409);
    const root = await this.directory();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const volume = await statfs(root);
    if (volume.bavail * volume.bsize < source.diskGiB * 1024 ** 3 * 2 + 64 * 1024 ** 2)
      throw new AppError('磁盘空间不足，制作模板需要预留两倍虚拟磁盘容量和 64 MiB 临时空间', 409);
    signal.throwIfAborted();
    const id = randomUUID(),
      directory = await this.directory(id);
    await mkdir(directory, { mode: 0o700 });
    let published = false;
    try {
      const part = join(directory, 'template.sakura.part');
      const target = createWriteStream(part, { flags: 'wx', mode: 0o600 });
      // Conversion precedes pipeline setup; observe a file-open error immediately.
      const drained = finished(target).catch(() => {});
      try {
        await once(target, 'open');
        log('正在固化停止后的磁盘与项目配置…\n');
        await this.bundles.export(
          input.vmId,
          target,
          () => {
            source = { ...this.machines.get(input.vmId) };
          },
          signal,
        );
      } finally {
        target.destroy();
        await drained;
      }
      this.sourceAllowed(input.vmId);
      const bytes = (await this.regular(part)).size;
      if (view.templates.reduce((sum, row) => sum + row.bytes, 0) + bytes > goldenLimits.bytes)
        throw new AppError('黄金镜像库总容量不能超过 128 GiB', 409);
      log('正在校验独立实例包…\n');
      const sha256 = await fileHash(part, signal);
      const entry = goldenEntrySchema.parse({
        version: 1,
        id,
        name: input.name,
        note: input.note,
        createdAt: new Date().toISOString(),
        sourceId: source.id,
        sourceName: source.name,
        distro: source.distro || 'alpine',
        architecture: source.architecture,
        diskGiB: source.diskGiB,
        bytes,
        sha256,
      });
      signal.throwIfAborted();
      this.sourceAllowed(input.vmId);
      await rename(part, join(directory, 'template.sakura'));
      await writeStore(join(directory, 'manifest.json'), entry);
      published = true;
      log('黄金镜像已保存，可独立于源实例重复创建新实例。\n');
      return { kind: 'template', id } as const;
    } finally {
      if (!published) await this.remove(id);
    }
  }
  async action(raw: unknown, signal?: AbortSignal): Promise<GoldenResult> {
    const input = goldenActionSchema.parse(raw);
    return this.jobs.track(
      'library',
      async (log, abort) => {
        abort.throwIfAborted();
        if (input.action === 'create') return this.create(input, abort, log);
        if (input.action === 'delete') {
          await this.remove(input.id);
          log('模板已移除；已创建的实例保留。\n');
          return { kind: 'deleted', id: input.id };
        }
        const { entry, bundle } = await this.entry(input.id);
        this.sourceAllowed(entry.sourceId);
        log('正在检查模板 SHA-256…\n');
        if ((await fileHash(bundle, abort)) !== entry.sha256)
          throw new AppError('模板 SHA-256 校验失败', 409);
        this.sourceAllowed(entry.sourceId);
        if (input.action === 'verify') {
          log('模板文件校验通过。\n');
          return { kind: 'verified', id: input.id };
        }
        log('正在创建独立实例…\n');
        const vm = await this.bundles.import(
          input.name,
          createReadStream(bundle, { signal: abort }),
          abort,
          () => this.sourceAllowed(entry.sourceId),
        );
        log(`已创建 ${vm.name}；首次启动将更新控制连接身份。\n`);
        return { kind: 'vm', id: vm.id };
      },
      {
        title: '黄金镜像库',
        action: 'golden:' + input.action,
        ...(input.action === 'create' ? { vmId: input.vmId } : {}),
      },
      signal,
    );
  }
  close() {
    return this.jobs.close();
  }
}
