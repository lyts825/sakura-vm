import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, rm, rmdir, stat, statfs, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, DATA, VM_ROOT, checkedId, setVmStorageRoot, vmDir } from './model.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';

const idSchema = z.string().regex(/^(default|[a-f0-9]{16})$/);
export const storagePoolInput = z.object({
  mode: z.enum(['list', 'create', 'remove', 'move', 'cleanup']).default('list'),
  name: z.string().trim().max(60).default(''),
  path: z.string().max(4096).default(''),
  poolId: idSchema.default('default'),
  vmId: z.uuid().optional(),
}).strict();
const poolSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  name: z.string().min(1).max(60),
  root: z.string().min(1).max(4096),
  createdAt: z.iso.datetime(),
}).strict();
type Pool = z.infer<typeof poolSchema>;
const orphanSchema = z.object({
  vmId: z.uuid(), sourcePoolId: idSchema, targetPoolId: idSchema,
  addedAt: z.iso.datetime(),
}).strict();
const storeSchema = z.object({
  version: z.literal(1), pools: z.array(poolSchema).max(8),
  pendingCleanup: z.array(orphanSchema).max(128).default([]),
}).strict();
const poolFolder = (root: string) => join(root, 'sakura-machines');
const marker = (root: string) => join(poolFolder(root), '.sakura-pool.json');

export class StoragePools {
  private state?: z.infer<typeof storeSchema>;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private machines: Machines, private file = join(DATA, 'storage-pools.json')) {}

  async init() {
    this.state = storeSchema.parse(await readStore(this.file,
      () => ({ version: 1, pools: [], pendingCleanup: [] })));
    const paths = [DATA, ...this.state.pools.map((pool) => pool.root)];
    for (const root of paths) {
      if (!isAbsolute(root) || /[\x00-\x1f]/.test(root))
        throw new AppError('存储池目录无效，无法加载实例', 503);
    }
    for (let i = 1; i < paths.length; i++)
      for (let j = 0; j < i; j++)
        if (within(paths[i], paths[j]) || within(paths[j], paths[i]))
          throw new AppError('存储池目录重叠，无法加载实例', 503);
  }

  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.state!);
      const result = edit(next);
      await writeStore(this.file, next);
      this.state = next;
      return result;
    });
    this.writes = operation;
    return operation;
  }

  private pool(id: string): Pool | null {
    if (id === 'default') return null;
    const pool = this.state!.pools.find((item) => item.id === id);
    if (!pool) throw new AppError('存储池不存在', 404);
    return pool;
  }

  directory(id: string, poolId = 'default') {
    const pool = this.pool(idSchema.parse(poolId));
    return join(pool ? poolFolder(pool.root) : VM_ROOT, checkedId(id));
  }

  bind(id: string, poolId = 'default') {
    const pool = this.pool(idSchema.parse(poolId));
    setVmStorageRoot(id, pool ? poolFolder(pool.root) : undefined);
  }

  unbind(id: string) { setVmStorageRoot(id); }

  conflictsWithDataTarget(target: string) {
    return this.state?.pools.some((pool) =>
      within(pool.root, target) || within(target, pool.root)) || false;
  }

  async ensure(poolId = 'default') {
    const pool = this.pool(idSchema.parse(poolId));
    if (!pool) {
      await mkdir(VM_ROOT, { recursive: true });
      return regularDirectory(VM_ROOT);
    }
    const root = await regularDirectory(pool.root);
    const folder = await regularDirectory(poolFolder(root));
    const info = await stat(folder).catch(() => null);
    if (!info?.isDirectory()) throw new AppError('存储池目录不可用', 503);
    const markerInfo = await lstat(marker(root)).catch(() => null);
    if (!markerInfo?.isFile() || markerInfo.isSymbolicLink())
      throw new AppError('存储池所有权标记无效', 409);
    const saved = await readStore<{ id: string } | null>(marker(root), () => null);
    if (saved?.id !== pool.id) throw new AppError('存储池所有权标记不匹配', 409);
    return folder;
  }

  async view(id?: string) {
    const records = [...this.machines.records.values()];
    const pools = [{ id: 'default', name: '默认数据目录', root: VM_ROOT, createdAt: '' },
      ...this.state!.pools];
    return { currentPoolId: id ? this.machines.get(id).storagePoolId || 'default' : null,
      pendingCleanup: this.state!.pendingCleanup,
      pools: await Promise.all(pools.map(async (pool) => {
        const members = records.filter((vm) => (vm.storagePoolId || 'default') === pool.id);
        const root = pool.id === 'default' ? VM_ROOT : pool.root;
        const accessible = await this.ensure(pool.id).catch(() => null);
        const capacity = accessible ? await statfs(root).catch(() => null) : null;
        const bytes = await Promise.all(members.map(async (vm) =>
          (await stat(join(vmDir(vm.id), 'disk.qcow2')).catch(() => null))?.size || 0));
        return { id: pool.id, name: pool.name, root, createdAt: pool.createdAt,
          available: !!capacity, totalBytes: capacity ? capacity.blocks * capacity.bsize : null,
          freeBytes: capacity ? capacity.bavail * capacity.bsize : null,
          allocatedBytes: bytes.reduce((sum, value) => sum + value, 0),
          vms: members.map((vm, index) => ({ id: vm.id, name: vm.name, diskBytes: bytes[index] })) };
      })) };
  }

  async create(name: string, path: string) {
    const label = z.string().trim().min(1).max(60).parse(name);
    if (this.state!.pools.length >= 8) throw new AppError('最多创建 8 个外部存储池', 409);
    const root = await regularDirectory(path);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) throw new AppError('请选择已存在的本机目录', 400);
    if (within(DATA, root) || within(root, DATA))
      throw new AppError('存储池不能与 Sakura 数据目录重叠', 409);
    for (const pool of this.state!.pools)
      if (within(pool.root, root) || within(root, pool.root))
        throw new AppError('存储池目录不能相互重叠', 409);
    if (this.state!.pools.some((pool) => pool.name === label))
      throw new AppError('存储池名称已存在', 409);
    const folder = poolFolder(root);
    await regularDirectory(folder);
    const existing = await lstat(folder).catch(() => null);
    if (existing && (!existing.isDirectory() || (await readdir(folder)).length))
      throw new AppError('此路径已有 Sakura 存储池数据', 409);
    const pool: Pool = { id: randomBytes(8).toString('hex'), name: label, root,
      createdAt: new Date().toISOString() };
    await mkdir(folder, { recursive: true });
    try {
      await writeFile(marker(root), JSON.stringify({ id: pool.id }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await rmdir(folder).catch(() => {});
      throw error;
    }
    try {
      await this.change((state) => { state.pools.push(pool); });
    } catch (error) {
      await rm(marker(root), { force: true });
      await rmdir(folder).catch(() => {});
      throw error;
    }
    return pool;
  }

  async remove(poolId: string) {
    const pool = this.pool(idSchema.parse(poolId));
    if (!pool) throw new AppError('默认存储池不能删除', 409);
    if ([...this.machines.records.values()].some((vm) => vm.storagePoolId === pool.id))
      throw new AppError('存储池仍有实例，请先迁出', 409);
    if (this.state!.pendingCleanup.some((item) =>
      item.sourcePoolId === pool.id || item.targetPoolId === pool.id))
      throw new AppError('存储池仍有待清理的迁移数据', 409);
    await this.ensure(pool.id);
    const entries = await readdir(poolFolder(pool.root));
    if (entries.some((entry) => entry !== '.sakura-pool.json'))
      throw new AppError('存储池中仍有未登记数据，请先检查', 409);
    await rm(marker(pool.root));
    try { await rmdir(poolFolder(pool.root)); }
    catch (error) {
      await writeFile(marker(pool.root), JSON.stringify({ id: pool.id }), { mode: 0o600 });
      throw error;
    }
    try {
      await this.change((state) => {
        state.pools = state.pools.filter((item) => item.id !== pool.id);
      });
    } catch (error) {
      await mkdir(poolFolder(pool.root));
      await writeFile(marker(pool.root), JSON.stringify({ id: pool.id }), { mode: 0o600 });
      throw error;
    }
    return { removed: pool.id };
  }

  hasPendingCleanup(vmId: string) {
    return this.state?.pendingCleanup.some((item) => item.vmId === vmId) || false;
  }

  async registerCleanup(vmId: string, sourcePoolId: string, targetPoolId: string) {
    await this.change((state) => {
      if (state.pendingCleanup.some((item) => item.vmId === vmId))
        throw new AppError('此实例仍有待清理的存储池迁移', 409);
      state.pendingCleanup.push({ vmId, sourcePoolId, targetPoolId,
        addedAt: new Date().toISOString() });
    });
  }

  async clearCleanup(vmId: string, sourcePoolId: string, targetPoolId: string) {
    await this.change((state) => {
      state.pendingCleanup = state.pendingCleanup.filter((item) =>
        !(item.vmId === vmId && item.sourcePoolId === sourcePoolId &&
          item.targetPoolId === targetPoolId));
    });
  }

  async cleanup() {
    const completed: string[] = [];
    const errors: { vmId: string; message: string }[] = [];
    for (const item of this.state!.pendingCleanup) {
      try {
        const vm = this.machines.records.get(item.vmId);
        if (!vm) throw new AppError('实例记录不存在，需要人工检查两份数据', 409);
        const current = vm.storagePoolId || 'default';
        const obsolete = current === item.sourcePoolId ? item.targetPoolId
          : current === item.targetPoolId ? item.sourcePoolId : null;
        if (!obsolete) throw new AppError('实例存储池已再次变化，需要人工检查', 409);
        const root = await this.ensure(obsolete);
        const dir = this.directory(item.vmId, obsolete);
        if (!within(root, dir)) throw new AppError('待清理目录超出存储池', 409);
        await regularDirectory(dir);
        await rm(dir, { recursive: true, force: true });
        await this.clearCleanup(item.vmId, item.sourcePoolId, item.targetPoolId);
        completed.push(item.vmId);
      } catch (error) {
        errors.push({ vmId: item.vmId, message: String((error as Error).message || error) });
      }
    }
    return { completed, errors };
  }

  async run(id: string | undefined, input: unknown, action: 'check' | 'run',
    signal?: AbortSignal, log: (text: string) => void = () => {}) {
    const value = storagePoolInput.parse(input);
    if (id && value.vmId && value.vmId !== id)
      throw new AppError('当前实例与参数中的实例不一致', 409);
    const vmId = id || value.vmId;
    if (vmId) this.machines.get(vmId);
    if (action === 'check' || value.mode === 'list')
      return { ...(await this.view(vmId)), ready: true, executed: false };
    if (value.mode === 'create') {
      const pool = await this.machines.locked('storage-pools',
        () => this.create(value.name, value.path));
      return { ...(await this.view(vmId)), ready: true, executed: true, created: pool };
    }
    if (value.mode === 'remove') {
      const removed = await this.machines.locked('storage-pools',
        () => this.remove(value.poolId));
      return { ...(await this.view(vmId)), ready: true, executed: true, ...removed };
    }
    if (value.mode === 'cleanup') {
      const cleanup = await this.machines.locked('storage-pools', () => this.cleanup());
      return { ...(await this.view(vmId)), ready: true, executed: true, cleanup };
    }
    if (!vmId) throw new AppError('移动实例时需要 vmId');
    const moved = await this.machines.moveStoragePool(vmId, value.poolId, signal, log);
    return { ...(await this.view(vmId)), ready: true, executed: true, moved };
  }
}
