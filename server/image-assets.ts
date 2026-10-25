/** 本体镜像内容、引用及准确 VM 归属；账本不属于供应插件的生命周期。 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { z } from 'zod';
import { DATA, vmDir } from './paths.ts';
import { MetadataStore } from './metadata-store.ts';
import { captureOperationCheck } from './operation-context.ts';
import { storageRuntime } from './storage-runtime.ts';
import { distroInfo } from './images.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { AppError } from '../shared/errors.ts';
import type { VmAccess } from './vm-access.ts';
import { vmHostIdentity } from './vm-reference.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import {
  imageAssetSchema,
  imageCreateSchema,
  imageDigestSchema,
  imageLeaseSchema,
  imageOwnerSchema,
  imageRefSchema,
  imageUploadSchema,
  ownedImageVmSchema,
  type ImageAsset,
  type ImageRef,
  type ImageCreate,
  type ImageUpload,
  type OwnedImageVm,
} from '../shared/contracts/image-assets.ts';
const stateSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(imageAssetSchema),
    uploads: z.array(imageUploadSchema),
    references: z.record(imageDigestSchema, z.array(imageOwnerSchema)),
    leases: z.array(imageLeaseSchema),
    vms: z.array(ownedImageVmSchema),
    claims: z.record(z.string(), z.string()).default({}),
    uploadOwners: z.record(z.string(), z.string()).default({}),
    retired: z.array(imageAssetSchema).default([]),
    completed: z.record(z.string(), imageDigestSchema).default({}),
    discardedUploads: z.array(z.uuid()).default([]),
    staging: z
      .array(
        z.object({ id: z.uuid(), owner: imageOwnerSchema, bytes: z.number().int().nonnegative() }).strict(),
      )
      .default([]),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
/** 本体装配只提供原记录查询与停止/删除，不授予创建、网络或执行。 */
export type OriginalImageVmCleanupPort = Pick<VmAccess, 'records' | 'live' | 'stop' | 'delete'>;
const drillOwnership = new WeakMap<object, ImageAssets>();
/** 本体内部适配器读取原服务账本，插件公开契约不包含此入口。
 * Internal adapter access to the originating ledger, outside the public plugin contract. */
export async function assertImageDrillOwnership(machines: VmAccess, receipt: OwnedImageVm, consumer: string) {
  const assets = drillOwnership.get(vmHostIdentity(machines));
  if (!assets) throw new AppError('镜像归属服务尚未就绪', 503, 'DRILL_OWNER_UNAVAILABLE');
  return assets.assertDrillOwnership(receipt, consumer);
}
const empty = (): State => ({
  version: 1,
  assets: [],
  uploads: [],
  references: {},
  leases: [],
  vms: [],
  claims: {},
  uploadOwners: {},
  retired: [],
  completed: {},
  discardedUploads: [],
  staging: [],
});
/** 全字节哈希，调用方在读取前后核对文件身份。 */
export async function imageFileHash(file: string) {
  const h = createHash('sha256');
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest('hex');
}
/** 拒绝祖先链接和非目录，所有写入限制在指定内容根目录。 */
export async function imageSafeDirectory(root: string) {
  const full = resolve(root),
    base = parse(full).root;
  let p = base;
  for (const part of full.slice(base.length).split(/[\\/]/).filter(Boolean)) {
    p = join(p, part);
    try {
      const st = await lstat(p);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new AppError('镜像目录包含链接或非目录', 409);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await mkdir(p);
    }
  }
}
export class ImageAssets implements ImageAssetsV1 {
  private store: MetadataStore<State>;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private plans = new Map<string, { revision: string; ids: string[]; expires: number }>();
  constructor(
    private machines: VmAccess,
    private root = join(DATA, 'image-assets'),
  ) {
    this.store = new MetadataStore(join(root, 'index.json'), { fallback: empty });
    drillOwnership.set(vmHostIdentity(machines), this);
  }
  private async authorize() {
    if (this.closed) throw new AppError('镜像资产服务已关闭', 503);
    await captureOperationCheck()();
  }
  private async state() {
    await this.authorize();
    await imageSafeDirectory(this.root);
    const s = await this.store.read();
    return { value: stateSchema.parse(s.value), revision: s.revision };
  }
  private async mutate<T>(fn: (s: State) => Promise<T> | T) {
    const task = this.queue.then(async () => {
      const s = await this.state();
      const result = await fn(s.value);
      await this.store.replace(stateSchema.parse(s.value), {
        expectedRevision: s.revision,
        beforeCommit: () => this.authorize(),
      });
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private principal() {
    return (
      resourceContext()?.serviceConsumerPluginInstanceId ||
      resourceContext()?.callerPluginInstanceId ||
      pluginAuthority()?.identity ||
      'core:application'
    );
  }
  private claim(s: State, owner: string) {
    imageOwnerSchema.parse(owner);
    const principal = this.principal();
    if (principal.startsWith('official:') && !owner.startsWith(principal.slice(9) + ':'))
      throw new AppError('消费者命名空间与当前插件不符', 403);
    if (s.claims[owner] && s.claims[owner] !== principal) throw new AppError('资源属于另一消费者', 403);
    s.claims[owner] = principal;
  }
  private file(id: string) {
    return join(this.root, imageDigestSchema.parse(id) + '.qcow2');
  }
  private part(id: string) {
    return join(this.root, z.uuid().parse(id) + '.part');
  }
  private async regular(file: string) {
    const s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new AppError('镜像必须是独占普通文件', 409);
    return s;
  }
  async init() {
    await this.state();
  }
  async list() {
    return structuredClone((await this.state()).value.assets);
  }
  async inspect(ref: ImageRef) {
    imageRefSchema.parse(ref);
    const item = (await this.list()).find((x) => x.id === ref.assetId && x.digest === ref.digest);
    if (!item) throw new AppError('镜像资产不存在或摘要不匹配', 404);
    return item;
  }
  async verify(ref: ImageRef) {
    const a = await this.inspect(ref),
      p = this.file(a.id),
      before = await this.regular(p);
    if (before.size !== a.bytes || (await imageFileHash(p)) !== a.digest)
      throw new AppError('镜像内容摘要不匹配', 409);
    const after = await this.regular(p);
    if (after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.size !== before.size)
      throw new AppError('镜像核验期间发生变化', 409);
    return a;
  }
  async begin(input: Pick<ImageUpload, 'digest' | 'bytes' | 'distro' | 'architecture' | 'source'>) {
    return this.mutate(async (s) => {
      const row = imageUploadSchema.parse({
        ...input,
        id: randomUUID(),
        offset: 0,
        createdAt: new Date().toISOString(),
      });
      if (
        s.uploads.length >= 32 ||
        [...s.assets, ...s.retired, ...s.staging, ...s.uploads].reduce((n, a) => n + a.bytes, 0) + row.bytes >
          128 * 1024 ** 3
      )
        throw new AppError('镜像库或暂存配额不足', 507);
      const f = await open(this.part(row.id), 'wx', 0o600);
      await f.close();
      s.uploads.push(row);
      s.uploadOwners[row.id] = this.principal();
      return row;
    });
  }
  async append(id: string, offset: number, data: string) {
    return this.mutate(async (s) => {
      const u = s.uploads.find((x) => x.id === id);
      if (!u) throw new AppError('上传不存在', 404);
      if (s.uploadOwners[id] !== this.principal()) throw new AppError('上传不属于当前消费者', 403);
      if (s.discardedUploads.includes(id)) throw new AppError('上传正在丢弃，请完成回收', 409);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
        throw new AppError('分块编码无效');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length || bytes.length > 524288 || offset !== u.offset || offset + bytes.length > u.bytes)
        throw new AppError('分块偏移或大小无效', 409);
      const p = this.part(id);
      const fileSize = (await this.regular(p)).size;
      if (fileSize === offset + bytes.length) {
        const f = await open(p, 'r');
        try {
          const old = Buffer.alloc(bytes.length);
          if ((await f.read(old, 0, old.length, offset)).bytesRead !== old.length || !old.equals(bytes))
            throw new AppError('重试分块与原字节不符', 409);
        } finally {
          await f.close();
        }
        u.offset += bytes.length;
        return structuredClone(u);
      }
      if (fileSize !== offset) throw new AppError('上传文件与账本偏移不符，保留以供检查', 409);
      await storageRuntime.run(
        {
          owner: 'core:image-assets',
          taskId: id,
          label: '写入镜像分块',
          paths: [p],
          mode: 'write',
          buffers: 1,
          files: 1,
        },
        async () => {
          const f = await open(p, 'r+');
          try {
            let written = 0;
            while (written < bytes.length) {
              const part = await f.write(bytes, written, bytes.length - written, offset + written);
              if (!part.bytesWritten) throw new AppError('镜像分块写入中断', 507);
              written += part.bytesWritten;
            }
            await f.sync();
          } finally {
            await f.close();
          }
        },
      );
      u.offset += bytes.length;
      return structuredClone(u);
    });
  }
  private async diskInfo(file: string) {
    const info = JSON.parse(
      await this.machines.engine.run('sakura-img', ['info', '-f', 'qcow2', '--output=json', file], {
        timeoutMs: 60000,
      }),
    );
    if (
      info.format !== 'qcow2' ||
      info['backing-filename'] ||
      info['format-specific']?.data?.['data-file'] ||
      !Number.isSafeInteger(info['virtual-size']) ||
      info['virtual-size'] > 128 * 1024 ** 3 ||
      info['virtual-size'] < 1024 ** 2
    )
      throw new AppError('需要无外部依赖的 QCOW2 镜像', 409);
    return info['virtual-size'] as number;
  }
  async finish(id: string) {
    return this.mutate(async (s) => {
      const u = s.uploads.find((x) => x.id === id);
      if (s.uploadOwners[id] !== this.principal()) throw new AppError('上传不属于当前消费者', 403);
      if (s.discardedUploads.includes(id)) throw new AppError('上传正在丢弃，请完成回收', 409);
      if (!u && s.completed[id]) {
        const done = s.assets.find((a) => a.id === s.completed[id]);
        if (done) return done;
      }
      if (!u) throw new AppError('镜像上传尚未完整', 409);
      let p = this.part(id);
      try {
        await this.regular(p);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        p = this.file(u.digest);
      }
      if ((await this.regular(p)).size !== u.bytes || (await imageFileHash(p)) !== u.digest)
        throw new AppError('镜像上传摘要不匹配', 409);
      // 全长摘要也覆盖封存重命名成功、偏移账本尚未提交的恢复情形。
      u.offset = u.bytes;
      const virtualBytes = await this.diskInfo(p);
      let a = s.assets.find((x) => x.id === u.digest);
      if (a) {
        if (a.distro !== u.distro || a.architecture !== u.architecture)
          throw new AppError('相同镜像内容的系统声明冲突', 409);
        if (p !== this.file(a.id)) await unlink(p);
      } else {
        a = imageAssetSchema.parse({
          id: u.digest,
          digest: u.digest,
          bytes: u.bytes,
          virtualBytes,
          distro: u.distro,
          architecture: u.architecture,
          source: u.source,
          createdAt: new Date().toISOString(),
        });
        const target = this.file(a.id);
        if (p !== target)
          try {
            await lstat(target);
            throw new AppError('存在未登记镜像文件，须检查恢复', 409);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          }
        if (p !== target) await rename(p, target);
        s.assets.push(a);
      }
      s.uploads = s.uploads.filter((x) => x.id !== id);
      s.completed[id] = a.id;
      return a;
    });
  }
  async uploads() {
    const s = (await this.state()).value;
    return s.uploads.filter((u) => s.uploadOwners[u.id] === this.principal());
  }
  async discardUpload(id: string) {
    z.uuid().parse(id);
    await this.mutate((s) => {
      if (s.uploadOwners[id] !== this.principal()) throw new AppError('上传不属于当前消费者', 403);
      if (!s.uploads.some((u) => u.id === id)) throw new AppError('只能丢弃未完成上传', 409);
      if (!s.discardedUploads.includes(id)) s.discardedUploads.push(id);
    });
    try {
      await this.regular(this.part(id));
      await unlink(this.part(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await this.mutate((s) => {
      s.uploads = s.uploads.filter((u) => u.id !== id);
      s.discardedUploads = s.discardedUploads.filter((u) => u !== id);
      delete s.uploadOwners[id];
    });
  }
  async prepareBuiltin(distro: ImageAsset['distro'], architecture: ImageAsset['architecture']) {
    await this.authorize();
    const image = distroInfo(distro, architecture),
      before = await this.regular(image.file),
      digest = await imageFileHash(image.file);
    const existing = (await this.list()).find((x) => x.id === digest);
    if (existing) return this.verify({ assetId: digest, digest });
    const u = await this.begin({
      digest,
      bytes: before.size,
      distro,
      architecture,
      source: 'builtin:' + distro + ':' + architecture,
    });
    await this.mutate(async (s) => {
      const current = await this.regular(image.file);
      if (current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs)
        throw new AppError('基础镜像在固定期间改变', 409);
      await storageRuntime.run(
        {
          owner: 'core:image-assets',
          taskId: u.id,
          label: '固定基础镜像',
          paths: [image.file, this.part(u.id)],
          mode: 'write',
          buffers: 1,
          files: 2,
          temporary: [{ path: this.part(u.id), bytes: before.size }],
        },
        async () => {
          await copyFile(image.file, this.part(u.id));
        },
      );
      s.uploads.find((x) => x.id === u.id)!.offset = before.size;
    });
    return this.finish(u.id);
  }
  async retain(ref: ImageRef, owner: string) {
    imageOwnerSchema.parse(owner);
    await this.inspect(ref);
    await this.mutate((s) => {
      this.claim(s, owner);
      const refs = (s.references[ref.assetId] ??= []);
      if (!refs.includes(owner)) refs.push(owner);
      s.references[ref.assetId] = refs;
    });
  }
  async references(ref: ImageRef) {
    await this.inspect(ref);
    return [...((await this.state()).value.references[ref.assetId] || [])];
  }
  async release(ref: ImageRef, owner: string) {
    imageOwnerSchema.parse(owner);
    await this.inspect(ref);
    await this.mutate((s) => {
      this.claim(s, owner);
      s.references[ref.assetId] = (s.references[ref.assetId] || []).filter((x) => x !== owner);
    });
  }
  async acquire(ref: ImageRef, owner: string) {
    await this.verify(ref);
    imageOwnerSchema.parse(owner);
    return this.mutate((s) => {
      this.claim(s, owner);
      s.leases = s.leases.filter((x) => Date.parse(x.expiresAt) > Date.now());
      if (s.leases.length >= 128) throw new AppError('镜像读取租约已满', 429);
      const lease = imageLeaseSchema.parse({
        token: randomUUID(),
        imageRef: ref,
        owner,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });
      s.leases.push(lease);
      return lease;
    });
  }
  async closeLease(token: string) {
    z.uuid().parse(token);
    await this.mutate((s) => {
      const l = s.leases.find((x) => x.token === token);
      if (l) this.claim(s, l.owner);
      s.leases = s.leases.filter((x) => x.token !== token);
    });
  }
  async read(ref: ImageRef, token: string, offset: number, length: number) {
    const s = (await this.state()).value;
    if (
      !s.leases.some(
        (x) =>
          x.token === token &&
          x.imageRef.assetId === ref.assetId &&
          x.imageRef.digest === ref.digest &&
          Date.parse(x.expiresAt) > Date.now(),
      )
    )
      throw new AppError('镜像读取租约无效', 403);
    const lease = s.leases.find((x) => x.token === token)!;
    this.claim(s, lease.owner);
    const a = await this.inspect(ref);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > a.bytes ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 524288
    )
      throw new AppError('镜像读取范围无效');
    const f = await open(this.file(a.id), 'r');
    try {
      const b = Buffer.alloc(Math.min(length, a.bytes - offset)),
        r = await f.read(b, 0, b.length, offset);
      return {
        data: b.subarray(0, r.bytesRead).toString('base64'),
        offset: offset + r.bytesRead,
        eof: offset + r.bytesRead === a.bytes,
      };
    } finally {
      await f.close();
    }
  }
  async createOwnedVm(raw: ImageCreate) {
    const input = imageCreateSchema.parse(raw);
    const a = await this.verify(input.imageRef);
    const lease = await this.acquire(input.imageRef, input.owner);
    const stagingId = randomUUID(),
      staging = join(this.root, stagingId + '.clone');
    const diskGiB = Math.max(8, Math.ceil(a.virtualBytes / 1024 ** 3));
    let receipt: OwnedImageVm | undefined;
    try {
      await this.mutate((s) => {
        this.claim(s, input.owner);
        if (
          [...s.assets, ...s.retired, ...s.staging, ...s.uploads].reduce((n, item) => n + item.bytes, 0) +
            a.bytes >
          128 * 1024 ** 3
        )
          throw new AppError('独立副本超过镜像库暂存预算', 507);
        s.staging.push({ id: stagingId, owner: input.owner, bytes: a.bytes });
      });
      await storageRuntime.run(
        {
          owner: 'core:image-assets',
          taskId: stagingId,
          label: '准备独立镜像磁盘',
          paths: [this.file(a.id), staging],
          mode: 'write',
          buffers: 1,
          files: 2,
          temporary: [{ path: staging, bytes: a.bytes + 1024 ** 2 }],
        },
        async () => {
          await copyFile(this.file(a.id), staging, 1);
          if (diskGiB * 1024 ** 3 > a.virtualBytes)
            await this.machines.engine.run('sakura-img', ['resize', '-f', 'qcow2', staging, diskGiB + 'G'], {
              timeoutMs: 60000,
            });
        },
      );
      const expiresAt = input.persistent
        ? null
        : new Date(Date.now() + input.lifetimeMinutes * 60000).toISOString();
      await this.machines.importDisk(
        {
          name: input.name,
          distro: a.distro,
          architecture: a.architecture,
          cpus: input.cpus,
          memoryMiB: Math.max(input.memoryMiB, distroInfo(a.distro, a.architecture).minimumMemory),
          diskGiB,
          template: 'none',
          forwards: [],
        },
        staging,
        {
          network: input.network,
          ...(expiresAt
            ? {
                sandbox: {
                  network: input.network,
                  expiresAt,
                  onExpire: 'stop' as const,
                  storage: 'persistent' as const,
                },
              }
            : {}),
          record: async (vm) => {
            receipt = ownedImageVmSchema.parse({
              token: randomUUID(),
              owner: input.owner,
              vmId: vm.id,
              createdAt: vm.createdAt,
              imageRef: input.imageRef,
              persistent: input.persistent,
              expiresAt,
              cleanup: 'pending',
            });
            await this.mutate((s) => {
              this.claim(s, input.owner);
              s.vms.push(receipt!);
              s.references[a.id] = [...new Set([...(s.references[a.id] || []), 'vm:' + vm.id])];
            });
          },
        },
      );
      if (!receipt) throw new AppError('创建缺少归属回执', 503);
      return receipt;
    } catch (e) {
      if (receipt)
        await this.mutate((s) => {
          s.vms.find((x) => x.token === receipt!.token)!.cleanup = 'unknown';
        });
      throw e;
    } finally {
      try {
        await this.regular(staging);
        await unlink(staging);
        await this.mutate((s) => {
          s.staging = s.staging.filter((x) => x.id !== stagingId);
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await this.closeLease(lease.token);
    }
  }
  async owned(owner: string) {
    imageOwnerSchema.parse(owner);
    const s = (await this.state()).value;
    this.claim(s, owner);
    return structuredClone(s.vms.filter((x) => x.owner === owner));
  }
  /** 本体装配专用核验，不进入 ImageAssetsV1 或插件服务代理。
   * Verify the recorded creator and original isolated VM for the core drill adapter only. */
  async assertDrillOwnership(input: OwnedImageVm, consumerIdentity: string) {
    const receipt = ownedImageVmSchema.parse(input);
    const state = (await this.state()).value;
    if (consumerIdentity !== 'official:resilience-fixtures' ||
        state.claims[receipt.owner] !== consumerIdentity)
      throw new AppError('演练实例不属于原夹具消费者', 403, 'DRILL_OWNER_MISMATCH');
    const row = state.vms.find(value => value.token === receipt.token);
    if (!row || JSON.stringify(row) !== JSON.stringify(receipt) || row.cleanup !== 'pending')
      throw new AppError('演练实例原回执不匹配或尚待核销', 409, 'DRILL_RECEIPT_MISMATCH');
    const vm = this.machines.get(row.vmId), live = this.machines.live.get(row.vmId);
    if (vm.createdAt !== row.createdAt || !live || this.machines.state(vm.id) !== 'running' ||
        vm.cpus > 2 || vm.memoryMiB > 2048 || vm.diskGiB > 32 || vm.forwards.length ||
        vm.managedNetwork !== 'isolated')
      throw new AppError('演练实例身份、网络或资源限制不匹配', 409, 'DRILL_VM_UNSAFE');
    const network = await this.machines.networkIsolation(vm.id, vm.createdAt, live.startedAt);
    if (!network.isolated || this.machines.live.get(vm.id) !== live ||
        this.machines.get(vm.id).createdAt !== row.createdAt)
      throw new AppError('演练核验期间实例身份或网络变化', 409, 'DRILL_VM_CHANGED');
    return structuredClone(row);
  }
  async destroyOwnedVm(input: OwnedImageVm) {
    return this.destroyOriginalVm(input, this.machines);
  }
  /** 装配专用：闭包仅回收已固定的原账本对象，不进入公共服务契约。 */
  async originalExecutionCleanup(principal: string, owner: string, ref: ImageRef,
    expected: OwnedImageVm | null, machines: OriginalImageVmCleanupPort) {
    const state = (await this.state()).value;
    if (state.claims[owner] !== principal || this.principal() !== principal)
      throw new AppError('原镜像消费者不匹配', 403, 'SUITE_EXECUTION_CLEANUP_PRINCIPAL');
    const rows = state.vms.filter((r) => r.owner === owner);
    if (rows.length > 1 || (expected && (!rows[0] || rows[0].token !== expected.token || rows[0].vmId !== expected.vmId || rows[0].createdAt !== expected.createdAt)) ||
      rows.some((r) => r.imageRef.assetId !== ref.assetId || r.imageRef.digest !== ref.digest))
      throw new AppError('原镜像资源身份不匹配', 403, 'SUITE_EXECUTION_CLEANUP_IDENTITY');
    const original = rows[0] ? structuredClone(rows[0]) : null;
    return async () => {
      const current = (await this.state()).value;
      if (current.claims[owner] !== principal || this.principal() !== principal)
        throw new AppError('原镜像消费者已改变', 403, 'SUITE_EXECUTION_CLEANUP_PRINCIPAL');
      const now = current.vms.filter((r) => r.owner === owner);
      if (now.length !== (original ? 1 : 0) || (original && (!now[0] || now[0].token !== original.token || now[0].vmId !== original.vmId || now[0].createdAt !== original.createdAt)))
        throw new AppError('原资源被替换', 403, 'SUITE_EXECUTION_CLEANUP_IDENTITY');
      const result = now[0] ? await this.destroyOriginalVm(now[0], machines) : null;
      await this.release(ref, owner);
      return result;
    };
  }
  /** 装配专用的实际缓存清单；删除未确认或文件身份未知时不归还容量。 */
  async executionImageInventory() {
    const state=(await this.state()).value, result:ImageAsset[]=[];
    for(const asset of [...state.assets,...state.retired]) {
      try { const file=await this.regular(this.file(asset.id)); if(file.size!==asset.bytes)throw new AppError('原镜像缓存大小改变',409,'SUITE_EXECUTION_IMAGE_CHANGED');result.push(asset); }
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&state.retired.some(r=>r.id===asset.id))continue;throw error;}
    }
    return result;
  }
  private async destroyOriginalVm(input: OwnedImageVm, machines: OriginalImageVmCleanupPort) {
    ownedImageVmSchema.parse(input);
    const state = (await this.state()).value;
    this.claim(state, input.owner);
    const row = state.vms.find(
      (x) =>
        x.token === input.token &&
        x.owner === input.owner &&
        x.vmId === input.vmId &&
        x.createdAt === input.createdAt,
    );
    if (!row || JSON.stringify(row) !== JSON.stringify(input)) throw new AppError('实例归属回执不匹配', 403);
    if (row.cleanup === 'confirmed') return row;
    try {
      const vm = machines.records.get(row.vmId);
      if (vm) {
        if (vm.createdAt !== row.createdAt) throw new AppError('实例创建身份已改变', 409);
        if (machines.live.has(row.vmId)) await machines.stop(row.vmId, true);
        if (machines.live.has(row.vmId)) throw new AppError('实例停止尚未确认', 503);
        await machines.delete(row.vmId);
      }
      if (machines.live.has(row.vmId) || machines.records.has(row.vmId))
        throw new AppError('实例核销未完成', 503);
      try {
        await lstat(vmDir(row.vmId));
        throw new AppError('实例目录仍存在，保留原记录', 503);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      return this.mutate((s) => {
        const r = s.vms.find((x) => x.token === row.token)!;
        r.cleanup = 'confirmed';
        s.references[row.imageRef.assetId] = (s.references[row.imageRef.assetId] || []).filter(
          (x) => x !== 'vm:' + row.vmId,
        );
        return r;
      });
    } catch (e) {
      await this.mutate((s) => {
        s.vms.find((x) => x.token === row.token)!.cleanup = 'unknown';
      });
      throw e;
    }
  }
  async captureVm(vmId: string, createdAt: string) {
    await this.authorize();
    const state = (await this.state()).value;
    const receipt = state.vms.find((r) => r.vmId === vmId && r.createdAt === createdAt);
    if (!receipt) throw new AppError('只能封存本体已登记归属的实例', 403);
    this.claim(state, receipt.owner);
    return this.machines.locked(vmId, async () => {
      const vm = this.machines.get(vmId);
      if (vm.createdAt !== createdAt) throw new AppError('制作实例身份已改变', 409);
      this.machines.requireStopped(vmId);
      this.machines.requireUnlocked(vmId);
      const file = join(this.root, randomUUID() + '.capture');
      await imageSafeDirectory(this.root);
      await storageRuntime.run(
        {
          owner: 'core:image-assets',
          taskId: randomUUID(),
          label: '封存镜像磁盘',
          paths: [vmDir(vmId), this.root],
          mode: 'write',
          buffers: 1,
          files: 2,
          temporary: [{ path: file, bytes: vm.diskGiB * 1024 ** 3 }],
        },
        async () => {
          await this.machines.engine.run(
            'sakura-img',
            [
              'convert',
              '-f',
              'qcow2',
              '-O',
              'qcow2',
              '-o',
              'compat=1.1',
              join(vmDir(vmId), 'disk.qcow2'),
              file,
            ],
            { timeoutMs: 3600000 },
          );
        },
      );
      const bytes = (await this.regular(file)).size,
        digest = await imageFileHash(file);
      const u = await this.begin({
        digest,
        bytes,
        distro: vm.distro || 'alpine',
        architecture: vm.architecture || 'x86_64',
        source: 'vm:' + vm.id + ':' + createdAt,
      });
      await this.mutate(async (s) => {
        await unlink(this.part(u.id));
        await rename(file, this.part(u.id));
        s.uploads.find((x) => x.id === u.id)!.offset = bytes;
      });
      return this.finish(u.id);
    });
  }
  async cleanupPlan() {
    const s = await this.state(),
      protectedIds = s.value.assets
        .filter(
          (a) =>
            (s.value.references[a.id]?.length || 0) > 0 ||
            s.value.leases.some((l) => l.imageRef.assetId === a.id && Date.parse(l.expiresAt) > Date.now()),
        )
        .map((a) => a.id);
    const ids = [
        ...new Set([
          ...s.value.assets.filter((a) => !protectedIds.includes(a.id)).map((a) => a.id),
          ...s.value.retired.map((a) => a.id),
        ]),
      ],
      token = randomUUID();
    this.plans.set(token, { revision: s.revision, ids, expires: Date.now() + 300000 });
    return { token, assets: ids, protected: protectedIds };
  }
  async cleanup(token: string) {
    const p = this.plans.get(token);
    if (!p || p.expires < Date.now()) throw new AppError('清理计划已过期', 409);
    this.plans.delete(token);
    await this.mutate(async (s) => {
      const current = await this.state();
      if (current.revision !== p.revision) throw new AppError('镜像引用已改变，重新预览清理', 409);
      for (const id of p.ids) {
        const asset = s.assets.find((a) => a.id === id);
        if (asset && !s.retired.some((a) => a.id === id)) s.retired.push(asset);
      }
      s.assets = s.assets.filter((a) => !p.ids.includes(a.id));
    });
    let removed = 0;
    for (const id of p.ids) {
      try {
        await this.regular(this.file(id));
        await unlink(this.file(id));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await this.mutate((s) => {
        s.retired = s.retired.filter((a) => a.id !== id);
        delete s.references[id];
        for (const token of Object.keys(s.completed))
          if (s.completed[token] === id) {
            delete s.completed[token];
            delete s.uploadOwners[token];
          }
      });
      removed++;
    }
    return { removed };
  }
  async close() {
    await this.queue;
    await this.store.flush();
    this.closed = true;
    if (drillOwnership.get(vmHostIdentity(this.machines)) === this)
      drillOwnership.delete(vmHostIdentity(this.machines));
  }
}
