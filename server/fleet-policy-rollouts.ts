import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { rolloutPolicyInput } from './feature-rollouts.ts';
import type { HostPeers, PeerRolloutView } from './host-peers.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';

const targetSchema = z.object({
  peerId: z.uuid(), hostId: z.uuid(), name: z.string().min(1).max(128),
  beforeRevision: z.number().int().nonnegative(),
  state: z.enum(['pending', 'applied', 'failed']),
  error: z.string().max(500).optional(), appliedAt: z.string().optional(),
}).strict();
const batchSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(),
  policy: rolloutPolicyInput, targets: z.array(targetSchema).min(1).max(16),
  createdAt: z.string(), updatedAt: z.string(),
}).strict();
const storeSchema = z.object({ version: z.literal(1), batches: z.array(batchSchema).max(50) }).strict();
type Store = z.infer<typeof storeSchema>;
type Batch = Store['batches'][number];
const createSchema = z.object({ operation: z.literal('create'), policy: rolloutPolicyInput,
  peers: z.array(z.uuid()).min(1).max(16) }).strict();
const publishSchema = z.object({ operation: z.literal('publish'), id: z.uuid(),
  revision: z.number().int().positive() }).strict();
export const fleetRolloutRequest = z.discriminatedUnion('operation', [createSchema, publishSchema]);
const initial = (): Store => ({ version: 1, batches: [] });
const samePolicy = (left: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string },
  right: Batch['policy']) => left.pluginId === right.pluginId && left.enabled === right.enabled &&
    left.percentage === right.percentage && left.cohortVersion === right.cohortVersion;

/** Durable, reviewable policy batches with per-peer reconciliation after ambiguous responses. */
export class FleetPolicyRollouts {
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private peers: HostPeers,
    private file = join(DATA, 'fleet-policy-rollouts.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {}) {}

  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 256 * 1024))
      throw new AppError('集群策略记录类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.batches.map((batch) => batch.id)).size !== this.state.batches.length)
      throw new AppError('集群策略批次重复');
    if (!info) await writeStore(this.file, this.state);
  }
  view() { return { batches: structuredClone(this.state.batches) }; }
  private serialized<T>(work: () => Promise<T>) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    const task = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      return work();
    });
    this.queue = task;
    return task.finally(() => this.mutation(-1));
  }
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.state = next;
  }
  async configure(input: unknown) {
    const value = fleetRolloutRequest.parse(input);
    return this.serialized(async () => {
      if (value.operation === 'create') {
        if (new Set(value.peers).size !== value.peers.length)
          throw new AppError('发布目标重复');
        if (this.state.batches.length >= 50) throw new AppError('集群策略批次已达上限', 409);
        const known = new Map(this.peers.view().outbound.map((peer) => [peer.id, peer]));
        const targets = [];
        for (const peerId of value.peers) {
          const peer = known.get(peerId);
          if (!peer) throw new AppError('发布目标未配对或已移除', 409);
          const status = await this.peers.rolloutStatus(peerId);
          const previous = status.policies.find((policy) => policy.pluginId === value.policy.pluginId);
          targets.push({ peerId, hostId: status.hostId, name: peer.name,
            beforeRevision: previous?.revision || 0, state: 'pending' as const });
        }
        const timestamp = new Date().toISOString();
        const batch: Batch = { id: randomUUID(), revision: 1, policy: value.policy,
          targets, createdAt: timestamp, updatedAt: timestamp };
        await this.save({ ...this.state, batches: [batch, ...this.state.batches] });
        return structuredClone(batch);
      }
      const next = structuredClone(this.state);
      const batch = next.batches.find((item) => item.id === value.id);
      if (!batch) throw new AppError('策略批次不存在', 404);
      if (batch.revision !== value.revision) throw new AppError('策略批次已变化，请刷新', 409);
      for (const target of batch.targets) {
        if (target.state === 'applied') continue;
        try {
          const current = await this.peers.rolloutStatus(target.peerId);
          if (current.hostId !== target.hostId) throw new AppError('目标主机身份已变化', 409);
          const policy = current.policies.find((item) => item.pluginId === batch.policy.pluginId);
          const revision = policy?.revision || 0;
          if (revision === target.beforeRevision + 1 && policy && samePolicy(policy, batch.policy)) {
            target.state = 'applied'; target.appliedAt = new Date().toISOString();
          } else {
            if (revision !== target.beforeRevision)
              throw new AppError('目标策略已被其他操作修改，请创建新批次', 409);
            const result: PeerRolloutView = await this.peers.publishRollout(target.peerId, {
              operation: 'save', ...(revision ? { revision } : {}), policy: batch.policy,
            });
            const applied = result.policies.find((item) => item.pluginId === batch.policy.pluginId);
            if (result.hostId !== target.hostId || !applied ||
                applied.revision !== target.beforeRevision + 1 || !samePolicy(applied, batch.policy))
              throw new AppError('目标未确认策略版本，请重试核对', 502);
            target.state = 'applied'; target.appliedAt = new Date().toISOString();
          }
          delete target.error;
        } catch (error) {
          target.state = 'failed'; target.error = String((error as Error).message || error).slice(0, 500);
        }
        batch.revision++;
        batch.updatedAt = new Date().toISOString();
        await this.save(structuredClone(next));
      }
      return structuredClone(batch);
    });
  }
  async close() { this.closed = true; await this.queue.catch(() => {}); }
}
