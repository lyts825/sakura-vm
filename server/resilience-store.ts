/** 独立领域元数据事务和 owner 准入；跨领域数据只能从公共服务取得。
 * Independent domain transactions and owner admission; cross-domain data uses public services. */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { captureOperationCheck } from './operation-context.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { AppError } from '../shared/errors.ts';
import { resilienceScopeSchema, type ResilienceScope } from '../shared/contracts/resilience-lab.ts';
export const resilienceHash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const resilienceNow = () => new Date().toISOString();
export const resilienceId = () => randomUUID();
export const sameScope = (a: ResilienceScope, b: ResilienceScope) => a.workspaceId === b.workspaceId;
export function resilienceError(message: string, code = 'RESILIENCE_PLAN_STALE'): never {
  throw new AppError(message, 409, code);
}
export type ResilienceAuthorize = (scope: ResilienceScope) => Promise<void>;
export const resilienceAuthorize =
  (signal: AbortSignal): ResilienceAuthorize =>
  async (scope) => {
    resilienceScopeSchema.parse(scope);
    resilienceActor();
    signal.throwIfAborted();
    await captureOperationCheck()();
  };
export function resilienceActor() {
  const actor = resourceContext()?.actorId;
  if (!actor) resilienceError('缺少经过认证的 owner 身份', 'RESILIENCE_IDENTITY_STALE');
  return actor;
}
export function resilienceConsumer(...allowed: string[]) {
  const id = resourceContext()?.serviceConsumerPluginInstanceId;
  if (!id || !allowed.some((p) => id === 'official:' + p))
    resilienceError('当前服务消费者无权调用内部演练步骤', 'RESILIENCE_IDENTITY_STALE');
}
export function syntheticSamples(count: number) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      id: 'item-' + String(i).padStart(4, '0'),
      value: resilienceHash('sakura-drill:' + i),
    })),
  );
}
export class ResilienceStore<T> {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private metadata: Pick<PluginMetadata<unknown>, 'read' | 'replace'>,
    private schema: z.ZodType<T>,
    private empty: () => T,
    readonly authorize: ResilienceAuthorize,
  ) {}
  private envelope(value: unknown) {
    if (value === null || value === undefined)
      return { version: 1 as const, owners: {} as Record<string, string>, value: this.empty() };
    return z
      .object({ version: z.literal(1), owners: z.record(z.string(), z.string().min(1)), value: this.schema })
      .strict()
      .parse(value);
  }
  private checkOwner(owners: Record<string, string>, scope: ResilienceScope, actor: string) {
    if (Object.hasOwn(owners, scope.workspaceId) && owners[scope.workspaceId] !== actor)
      resilienceError('档案属于另一 owner', 'RESILIENCE_IDENTITY_STALE');
  }
  async read(scope: ResilienceScope) {
    await this.authorize(scope);
    const s = this.envelope((await this.metadata.read()).value);
    this.checkOwner(s.owners, scope, resilienceActor());
    return s.value;
  }
  mutate<R>(scope: ResilienceScope, work: (s: T) => Promise<R> | R) {
    const actor = resilienceActor();
    const p = this.queue.then(async () => {
      await this.authorize(scope);
      const s = await this.metadata.read(),
        envelope = this.envelope(s.value);
      this.checkOwner(envelope.owners, scope, actor);
      envelope.owners[scope.workspaceId] = actor;
      const value = envelope.value;
      const result = await work(value);
      await this.metadata.replace(
        { ...envelope, value: this.schema.parse(value) },
        {
          expectedRevision: s.revision,
          beforeCommit: () => this.authorize(scope),
        },
      );
      return structuredClone(result);
    });
    this.queue = p.catch(() => {});
    return p;
  }
  /** 仅激活阶段标记待核销，不选择 owner、不恢复任何业务副作用。
   * Activation-only reconciliation marking neither selects an owner nor resumes effects. */
  async recover(work: (value: T) => void) {
    const instance = pluginAuthority();
    if (!instance || instance.phase !== 'activating')
      resilienceError('非激活阶段不能使用领域恢复入口', 'RESILIENCE_IDENTITY_STALE');
    instance.signal.throwIfAborted();
    const snapshot = await this.metadata.read(),
      envelope = this.envelope(snapshot.value);
    work(envelope.value);
    await this.metadata.replace(
      { ...envelope, value: this.schema.parse(envelope.value) },
      { expectedRevision: snapshot.revision },
    );
  }
}
