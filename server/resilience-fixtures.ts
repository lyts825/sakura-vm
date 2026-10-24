/** fixtures 始终保存原 ImageAssets 回执；委派不转移资产所有权。
 * Fixtures retains original ImageAssets receipts; delegation never transfers asset ownership. */
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { VmAccess } from './vm-access.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { DrillSupervisionV1 } from './service-contracts/drill-supervision.ts';
import type { ResilienceFixturesV1, ResilienceTargetsV1 } from './service-contracts/resilience-lab.ts';
import type { DrillDelegation } from '../shared/contracts/drill-supervision.ts';
import { ownedImageVmSchema, type ImageUpload } from '../shared/contracts/image-assets.ts';
import {
  resilienceReplicaSchema,
  resilienceCleanupSchema,
  resilienceRefSchema,
  resilienceScopeSchema,
  resilienceImageImportSchema,
  type ResilienceScope as Scope,
  type ResilienceRef as Ref,
  type ResilienceCleanup,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceHash,
  resilienceId,
  resilienceNow,
  resilienceError,
  sameScope,
  syntheticSamples,
  resilienceConsumer,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const row = z
  .object({ value: resilienceReplicaSchema, receipt: ownedImageVmSchema.nullable(), owner: z.string() })
  .strict();
const schema = z
  .object({
    rows: z.array(row).max(1000),
    imports: z
      .array(z.object({ scope: resilienceScopeSchema, id: z.uuid() }).strict())
      .max(1000)
      .default([]),
    retained: z
      .array(
        z
          .object({ scope: resilienceScopeSchema, target: resilienceRefSchema, reference: z.string() })
          .strict(),
      )
      .max(2000),
    reads: z
      .array(z.object({ id: z.uuid(), scope: resilienceScopeSchema, target: resilienceRefSchema }).strict())
      .max(100),
  })
  .strict();
export class ResilienceFixtures implements ResilienceFixturesV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(
    metadata: PluginMetadata<unknown>,
    private targets: ResilienceTargetsV1,
    private assets: ImageAssetsV1,
    private vm: VmAccess,
    private supervision: DrillSupervisionV1,
    private workspaces: WorkspacesV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(
      metadata,
      schema,
      () => ({ rows: [], imports: [], retained: [], reads: [] }),
      authorize,
    );
  }
  private async preparedProject(scope: Scope, vmId: string) {
    const until = Date.now() + 180000;
    while (this.vm.state(vmId) !== 'running') {
      await this.store.authorize(scope);
      if (Date.now() > until || ['error', 'stopped'].includes(this.vm.state(vmId)))
        resilienceError('专用副本未能完成初始化启动，请检查来源镜像能否使用新 seed 初始化', 'RESILIENCE_BOOT_FAILED');
      await delay(200);
    }
    return this.workspaces.projects.with(vmId, 'default', async () => {
      // 合成业务由固定监管资产运行；项目配置不接受额外 setup 或任意命令。
      // The fixed supervised asset owns synthetic business; project config accepts no setup or arbitrary command.
      await this.workspaces.save(
        vmId,
        {
          directory: '/workspace/resilience',
          template: 'none',
          repository: '',
          setup: '',
          command: '',
          networkIsolation: 'private',
        },
      );
      return resilienceHash(await this.workspaces.readCommittedConfig(vmId));
    });
  }
  async view(scope: Scope) {
    return (await this.store.read(scope)).rows
      .filter((x) => sameScope(x.value.scope, scope))
      .map((x) => x.value);
  }
  async sources(scope: Scope) {
    await this.store.authorize(scope);
    return this.assets.list();
  }
  async prepareBuiltin(
    scope: Scope,
    distro: ImageUpload['distro'],
    architecture: ImageUpload['architecture'],
  ) {
    await this.store.authorize(scope);
    return this.assets.prepareBuiltin(distro, architecture);
  }
  async beginImport(
    scope: Scope,
    raw: Pick<ImageUpload, 'digest' | 'bytes' | 'distro' | 'architecture' | 'source'>,
  ) {
    await this.store.authorize(scope);
    const input = resilienceImageImportSchema.parse(raw),
      upload = await this.assets.begin({ ...input, source: 'resilience-local:' + input.source });
    await this.store.mutate(scope, (s) => {
      s.imports.push({ scope, id: upload.id });
    });
    return upload;
  }
  private async checkImport(scope: Scope, id: string) {
    z.uuid().parse(id);
    if (!(await this.store.read(scope)).imports.some((x) => sameScope(x.scope, scope) && x.id === id))
      resilienceError('上传不属于当前档案', 'RESILIENCE_IDENTITY_STALE');
  }
  async appendImport(scope: Scope, id: string, offset: number, data: string) {
    await this.checkImport(scope, id);
    return this.assets.append(id, offset, data);
  }
  async finishImport(scope: Scope, id: string) {
    await this.checkImport(scope, id);
    return this.assets.finish(id);
  }
  private async row(scope: Scope, id: string) {
    z.uuid().parse(id);
    return (
      (await this.store.read(scope)).rows.find((x) => x.value.id === id && sameScope(x.value.scope, scope)) ||
      resilienceError('副本原记录不存在')
    );
  }
  async get(scope: Scope, id: string) {
    return (await this.row(scope, id)).value;
  }
  async prepare(scope: Scope, ref: Ref, runId: string) {
    z.uuid().parse(runId);
    const target = await this.targets.get(scope, ref),
      asset = await this.assets.verify(target.image);
    if (asset.distro !== 'alpine' || asset.architecture !== 'x86_64')
      resilienceError('固定演练与检查点初始化当前仅支持 Alpine x86_64 镜像', 'RESILIENCE_IMAGE_UNSUPPORTED');
    if (asset.virtualBytes > 32 * 1024 ** 3)
      resilienceError('固定镜像超出 32 GiB 虚拟磁盘预算', 'RESILIENCE_BUDGET_EXCEEDED');
    const id = resilienceId(),
      owner = 'resilience-fixtures:' + id;
    await this.store.mutate(scope, (s) => {
      if (s.rows.filter((x) => x.value.cleanup !== 'confirmed').length >= 2)
        resilienceError('已有 2 个未核销副本', 'RESILIENCE_BUDGET_EXCEEDED');
      s.rows.push({
        owner,
        receipt: null,
        value: {
          id,
          runId,
          target: ref,
          scope,
          identity: null,
          state: 'creating',
          createdAt: resilienceNow(),
          checkpoint: null,
          cleanup: 'pending',
        },
      });
    });
    try {
      await this.assets.retain(target.image, owner);
      const receipt = await this.assets.createOwnedVm({
        imageRef: target.image,
        owner,
        name: 'drill-' + id.slice(0, 8),
        memoryMiB: target.memoryMiB,
        cpus: target.cpus,
        network: 'isolated',
        persistent: false,
        lifetimeMinutes: 60,
      });
      await this.store.mutate(scope, (s) => {
        const r = s.rows.find((x) => x.value.id === id)!;
        r.receipt = receipt;
        r.value.state = 'preparing';
      });
      await this.vm.start(receipt.vmId);
      const projectRevision = await this.preparedProject(scope, receipt.vmId);
      const identity = await this.supervision.prepare({
        runId: id,
        replica: receipt,
        sampleDigest: target.sampleDigest,
        count: target.sampleCount,
        projectRevision,
      });
      return this.store.mutate(scope, (s) => {
        const r = s.rows.find((x) => x.value.id === id)!;
        r.value.identity = identity;
        r.value.state = 'ready';
        return r.value;
      });
    } catch (e) {
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.value.id === id)!.value.state = 'unknown';
      });
      throw e;
    }
  }
  async authorizeDrill(scope: Scope, id: string, input: Omit<DrillDelegation, 'replica' | 'identity'>) {
    resilienceConsumer('resilience-guard');
    const r = await this.row(scope, id);
    if (!r.receipt || !r.value.identity || r.value.state !== 'ready' || input.runId !== r.value.id)
      resilienceError('原副本尚未就绪');
    await this.targets.get(scope, r.value.target);
    return this.supervision.delegate({ ...input, replica: r.receipt, identity: r.value.identity });
  }
  async checkpoint(scope: Scope, id: string) {
    resilienceConsumer('resilience-runs', 'resilience-recovery');
    const r = await this.row(scope, id);
    if (!r.receipt) resilienceError('缺少原 VM 回执');
    await this.vm.stop(r.receipt.vmId, true);
    const asset = await this.assets.captureVm(r.receipt.vmId, r.receipt.createdAt);
    await this.assets.retain({ assetId: asset.id, digest: asset.digest }, r.owner);
    return this.store.mutate(scope, (s) => {
      const x = s.rows.find((x) => x.value.id === id)!;
      x.value.checkpoint = { assetId: asset.id, digest: asset.digest };
      return x.value;
    });
  }
  async restore(scope: Scope, id: string, runId: string, confirmedIds: string[]) {
    resilienceConsumer('resilience-recovery');
    const old = await this.row(scope, id);
    if (!old.receipt || !old.value.checkpoint) resilienceError('缺少固定检查点');
    if (this.vm.live.has(old.receipt.vmId)) resilienceError('旧副本仍在运行，禁止交接');
    const target = await this.targets.get(scope, old.value.target),
      newId = resilienceId(),
      owner = 'resilience-fixtures:' + newId,
      checkpoint = old.value.checkpoint;
    await this.assets.verify(checkpoint);
    await this.store.mutate(scope, (s) => {
      if (s.rows.filter((x) => x.value.cleanup !== 'confirmed').length >= 2)
        resilienceError('恢复双副本预算不足');
      s.rows.push({
        owner,
        receipt: null,
        value: {
          id: newId,
          runId,
          target: old.value.target,
          scope,
          identity: null,
          state: 'creating',
          createdAt: resilienceNow(),
          checkpoint,
          cleanup: 'pending',
        },
      });
    });
    try {
      const receipt = await this.assets.createOwnedVm({
        imageRef: checkpoint,
        owner,
        name: 'restore-' + newId.slice(0, 8),
        memoryMiB: target.memoryMiB,
        cpus: target.cpus,
        network: 'isolated',
        persistent: false,
        lifetimeMinutes: 60,
      });
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.value.id === newId)!.receipt = receipt;
      });
      await this.vm.start(receipt.vmId);
      const projectRevision = await this.preparedProject(scope, receipt.vmId);
      const identity = await this.supervision.prepare({
        runId: newId,
        replica: receipt,
        sampleDigest: target.sampleDigest,
        count: target.sampleCount,
        projectRevision,
        restoreFrom: { runId: old.value.id, confirmedIds },
      });
      return this.store.mutate(scope, (s) => {
        const x = s.rows.find((x) => x.value.id === newId)!;
        x.value.identity = identity;
        x.value.state = 'ready';
        return x.value;
      });
    } catch (e) {
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.value.id === newId)!.value.state = 'unknown';
      });
      throw e;
    }
  }
  async cleanupPreview(scope: Scope, id: string) {
    const r = await this.row(scope, id);
    return resilienceCleanupSchema.parse({
      id: resilienceId(),
      scope,
      replicaId: id,
      digest: resilienceHash(r),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      resources: [r.owner, ...(r.receipt ? ['vm:' + r.receipt.vmId] : [])],
    });
  }
  async cleanup(scope: Scope, raw: ResilienceCleanup) {
    const plan = resilienceCleanupSchema.parse(raw),
      r = await this.row(scope, plan.replicaId);
    if (
      !sameScope(plan.scope, scope) ||
      plan.digest !== resilienceHash(r) ||
      Date.now() >= Date.parse(plan.expiresAt)
    )
      resilienceError('清理预览已失效');
    await this.store.mutate(scope, (s) => {
      s.rows.find((x) => x.value.id === r.value.id)!.value.state = 'cleanup-pending';
    });
    try {
      const candidates = await this.assets.owned(r.owner);
      if (candidates.length > 1)
        resilienceError('同一所有者存在多份回执，保留核销', 'RESILIENCE_CLEANUP_PENDING');
      const owned = candidates[0];
      if (
        r.receipt &&
        (!owned ||
          owned.token !== r.receipt.token ||
          owned.vmId !== r.receipt.vmId ||
          owned.createdAt !== r.receipt.createdAt)
      )
        resilienceError('原资产回执缺失或身份变化，保留核销', 'RESILIENCE_CLEANUP_PENDING');
      if (owned) {
        await this.assets.destroyOwnedVm(owned);
      }
      const target = await this.targets.get(scope, r.value.target);
      await this.assets.release(target.image, r.owner);
      return this.store.mutate(scope, (s) => {
        const x = s.rows.find((x) => x.value.id === r.value.id)!;
        x.value.state = 'cleaned';
        x.value.cleanup = 'confirmed';
        return x.value;
      });
    } catch (e) {
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.value.id === r.value.id)!.value.cleanup = 'unknown';
      });
      throw e;
    }
  }
  async retainInput(scope: Scope, target: Ref, reference: string) {
    resilienceConsumer('resilience-reports');
    await this.targets.get(scope, target);
    z.string().min(1).max(200).parse(reference);
    await this.store.mutate(scope, (s) => {
      if (
        !s.retained.some(
          (x) => sameScope(x.scope, scope) && x.target.id === target.id && x.reference === reference,
        )
      )
        s.retained.push({ scope, target, reference });
    });
  }
  async releaseInput(scope: Scope, target: Ref, reference: string) {
    resilienceConsumer('resilience-reports');
    await this.store.mutate(scope, (s) => {
      if (s.reads.some((x) => sameScope(x.scope, scope) && x.target.id === target.id))
        resilienceError('输入仍有活动读取租约');
      s.retained = s.retained.filter(
        (x) => !(sameScope(x.scope, scope) && x.target.id === target.id && x.reference === reference),
      );
    });
  }
  async openInputRead(scope: Scope, target: Ref) {
    resilienceConsumer('resilience-reports');
    const row = await this.targets.get(scope, target),
      id = resilienceId();
    await this.store.mutate(scope, (s) => {
      s.reads.push({ scope, target, id });
    });
    return { id, digest: row.sampleDigest, data: syntheticSamples(row.sampleCount) };
  }
  async closeInputRead(scope: Scope, id: string) {
    resilienceConsumer('resilience-reports');
    await this.store.mutate(scope, (s) => {
      s.reads = s.reads.filter((x) => !(sameScope(x.scope, scope) && x.id === id));
    });
  }
}
