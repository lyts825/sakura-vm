import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PLUGINS } from '../shared/plugins.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';

const ids = new Set<string>(PLUGINS.map((plugin) => plugin.id));
const pluginId = z.string().refine((id) => ids.has(id), '插件不存在');
const policyInput = z.object({
  pluginId,
  enabled: z.boolean(),
  percentage: z.number().int().min(0).max(100),
  cohortVersion: z.string().trim().min(1).max(64),
}).strict();
const policySchema = policyInput.extend({
  revision: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
const storeSchema = z.object({
  version: z.literal(1),
  hostId: z.uuid(),
  policies: z.array(policySchema).max(PLUGINS.length),
}).strict();
type Store = z.infer<typeof storeSchema>;
export type RolloutPolicy = Store['policies'][number];
export const featureRolloutRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), revision: z.number().int().positive().optional(),
    policy: policyInput }).strict(),
  z.object({ operation: z.literal('remove'), pluginId,
    revision: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('preview'), policy: policyInput }).strict(),
]);
const initial = (): Store => ({ version: 1, hostId: randomUUID(), policies: [] });

/** A persisted host cohort decides whether a selected plugin starts on the next service launch. */
export class FeatureRollouts {
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    private file = join(DATA, 'feature-rollouts.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private now = Date.now,
  ) {}

  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 256 * 1024))
      throw new AppError('功能灰度存储类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.policies.map((item) => item.pluginId)).size !== this.state.policies.length)
      throw new AppError('功能灰度记录重复');
    if (!info) await writeStore(this.file, this.state);
  }

  decision(id: string, draft?: z.infer<typeof policyInput>) {
    const policy = draft || this.state.policies.find((item) => item.pluginId === id);
    const bucket = policy ? parseInt(createHash('sha256')
      .update(`${this.state.hostId}:${id}:${policy.cohortVersion}`).digest('hex').slice(0, 8), 16) % 10_000 : null;
    return {
      pluginId: id,
      allowed: !policy || (policy.enabled && bucket! < policy.percentage * 100),
      bucket,
      ...(policy ? { policy } : {}),
    };
  }

  view() {
    return {
      hostId: this.state.hostId,
      plugins: PLUGINS.map((plugin) => ({ id: plugin.id, name: plugin.name,
        ...this.decision(plugin.id) })),
      policies: structuredClone(this.state.policies),
    };
  }

  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = featureRolloutRequest.parse(input);
    if (value.operation === 'preview') return this.decision(value.policy.pluginId, value.policy);
    this.mutation(1);
    try {
      const task = this.queue.catch(() => {}).then(async () => {
        if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
        const next = structuredClone(this.state);
        if (value.operation === 'remove') {
          const index = next.policies.findIndex((item) => item.pluginId === value.pluginId);
          if (index < 0) throw new AppError('灰度策略不存在', 404);
          if (next.policies[index].revision !== value.revision)
            throw new AppError('灰度策略已变化，请刷新', 409);
          next.policies.splice(index, 1);
        } else {
          const index = next.policies.findIndex((item) => item.pluginId === value.policy.pluginId);
          if (index >= 0 && next.policies[index].revision !== value.revision)
            throw new AppError('灰度策略已变化，请刷新', 409);
          if (index < 0 && value.revision) throw new AppError('灰度策略不存在', 404);
          const policy = { ...value.policy, revision: (next.policies[index]?.revision || 0) + 1,
            updatedAt: this.now() };
          if (index >= 0) next.policies[index] = policy;
          else next.policies.push(policy);
        }
        await writeStore(this.file, next);
        this.state = next;
        return this.view();
      });
      this.queue = task;
      return await task;
    } finally {
      this.mutation(-1);
    }
  }

  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
  }
}
