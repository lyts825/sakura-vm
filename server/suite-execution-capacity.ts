/** 宿主总额度只在既有 SuiteCapacity 队列中准入。 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MetadataStore } from './metadata-store.ts';
import { serializedMetadata } from './metadata-queue.ts';
import type { SuiteCapacity, SuiteRootCapacitySpec } from './suite-capacity.ts';
import { suiteQuota, type SuiteQuota } from '../shared/contracts/suite-common.ts';
import { imageAssetSchema, type ImageAsset } from '../shared/contracts/image-assets.ts';
import { AppError } from '../shared/errors.ts';
export const suiteExecutionCapacitySpecs = (directory: string): SuiteRootCapacitySpec[] =>
  ['browser', 'database', 'event', 'media', 'learning', 'schedule-probe', 'extension-build', 'protocol-scenario', 'multi-service', 'native', 'images'].map((profile) => ({
    pluginId: 'suite-execution-' + profile,
    file: join(directory, 'suite-execution', profile, 'state.json'),
    ...(profile === 'images'
      ? {
          memberDirectories: ['browser', 'database', 'event', 'media', 'learning', 'schedule-probe', 'extension-build', 'protocol-scenario', 'multi-service'].map((id) =>
            join(directory, 'suite-execution', id),
          ),
        }
      : {}),
  }));
export class SuiteExecutionLedger<T> {
  private readonly store: MetadataStore<unknown>;
  constructor(
    readonly spec: SuiteRootCapacitySpec,
    private capacity: SuiteCapacity,
    private schema: z.ZodType<T>,
    private empty: () => T,
  ) {
    if (!capacity.owns(spec.pluginId, spec.file))
      throw new AppError('执行根账本未纳入宿主容量', 503, 'SUITE_EXECUTION_CAPACITY_UNAVAILABLE');
    this.store = new MetadataStore(spec.file, { fallback: () => null });
  }
  async read(): Promise<T> {
    const value = (await this.store.read()).value;
    return value === null ? this.empty() : this.schema.parse(value);
  }
  change<R>(edit: (value: T) => Promise<R> | R, control = false): Promise<R> {
    return serializedMetadata(this.spec.file + '.execution', false, async () => {
      const snapshot = await this.store.read(),
        value = snapshot.value === null ? this.empty() : this.schema.parse(snapshot.value);
      const result = await edit(value),
        next = this.schema.parse(value);
      await this.capacity.publish(this.spec.pluginId, this.spec.file, next, control, undefined, (captured) =>
        this.store.replace(captured, { expectedRevision: snapshot.revision }),
      );
      return structuredClone(result);
    });
  }
}
export function executionQuota(
  workspaceId: string,
  consumer: string,
  bytes: number,
  kind: SuiteQuota['kind'],
): SuiteQuota {
  return {
    id: randomUUID(),
    workspaceId,
    consumer,
    bytes,
    kind,
    slot: null,
    payloadDigest: null,
    sequence: 0,
    state: 'reserved',
    createdAt: new Date().toISOString(),
  };
}
const imageState = z
  .object({
    schemaVersion: z.literal(1),
    quota: z.array(suiteQuota).max(50000),
    images: z.array(imageAssetSchema).max(10000),
  })
  .strict();
/** 镜像实际字节按摘要全局计一次；结束会话不假定缓存已删除。 */
export class SuiteExecutionImageCapacity {
  private ledger: SuiteExecutionLedger<z.infer<typeof imageState>>;
  constructor(directory: string, capacity: SuiteCapacity) {
    this.ledger = new SuiteExecutionLedger(
      suiteExecutionCapacitySpecs(directory).find((s) => s.pluginId.endsWith('-images'))!,
      capacity,
      imageState,
      () => ({ schemaVersion: 1, quota: [], images: [] }),
    );
  }
  async init() {
    await this.ledger.change(() => {}, true);
  }
  async synchronize(physical: readonly ImageAsset[]) {
    const present = new Set(physical.map((image) => image.digest));
    if ((await this.ledger.read()).images.every((image) => present.has(image.digest))) return;
    await this.ledger.change((state) => {
      const removed = new Set(
        state.images.filter((image) => !present.has(image.digest)).map((image) => image.digest),
      );
      state.images = state.images.filter((image) => !removed.has(image.digest));
      for (const quota of state.quota)
        if (quota.payloadDigest && removed.has(quota.payloadDigest)) quota.state = 'released';
    }, true);
  }
  async ensure(image: ImageAsset, workspaceId: string) {
    return this.ledger.change((state) => {
      const existing = state.images.find((value) => value.digest === image.digest);
      if (existing) {
        if (existing.bytes !== image.bytes || existing.virtualBytes !== image.virtualBytes)
          throw new AppError('原镜像容量身份改变', 409, 'SUITE_EXECUTION_IMAGE_CHANGED');
        return;
      }
      const quota = executionQuota(workspaceId, 'suite-execution-images', image.bytes, 'material');
      quota.state = 'committed';
      quota.payloadDigest = image.digest;
      state.quota.push(quota);
      state.images.push(image);
    });
  }
}
