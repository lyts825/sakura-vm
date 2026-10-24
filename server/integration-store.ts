/** 模块职责：授权、不可变修订、并发写入和累计额度预留。 Scoped immutable storage and capacity reservations. */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { IntegrationSpecsV1, IntegrationDefinitionsV1 } from './service-contracts/integration-lab.ts';
import {
  revisionSchema,
  saveBase,
  ilScope,
  ilRef,
  type IntegrationScope,
  type IntegrationRef,
  type IntegrationSave,
  type IntegrationRevision,
} from '../shared/contracts/integration-lab.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, operationReceiptId } from './operation-context.ts';
import { AppError } from '../shared/errors.ts';
export function ilCanonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(ilCanonical).join(',') + ']';
  return (
    '{' +
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => JSON.stringify(k) + ':' + ilCanonical(x))
      .join(',') +
    '}'
  );
}
export const ilHash = (v: unknown) => createHash('sha256').update(ilCanonical(v)).digest('hex');
export const ilBytes = (v: unknown) => Buffer.byteLength(ilCanonical(v));
export function ilFail(code: string, message = code, status = 409): never {
  throw new AppError(message, status, code);
}
export async function ilIdentity() {
  await captureOperationCheck()();
  const c = resourceContext();
  if (!c?.actorId) ilFail('OWNER_CONTEXT_REQUIRED', '需要已鉴权宿主 owner 上下文', 403);
  return {
    actor: c.actorId,
    consumer: c.serviceConsumerPluginInstanceId || c.callerPluginInstanceId || c.pluginInstanceId || c.owner,
    requestId: operationReceiptId() || c.operationId || '',
  };
}
export function ilConsumer(plugin: string) {
  const c = resourceContext();
  const consumer = c?.serviceConsumerPluginInstanceId || c?.callerPluginInstanceId || '';
  if (!(consumer === 'official:' + plugin || consumer.startsWith('official:' + plugin + ':')))
    ilFail('INTERNAL_CONSUMER_REQUIRED', '操作仅允许原领域消费者', 403);
}
export class IntegrationRows<T> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly metadata: PluginMetadata,
    readonly schema: z.ZodType<T>,
  ) {}
  async all(): Promise<T[]> {
    return z
      .array(this.schema)
      .max(50000)
      .parse((await this.metadata.read()).value ?? []);
  }
  async change<R>(edit: (rows: T[]) => Promise<R> | R): Promise<R> {
    const work = this.tail.then(async () => {
      const snap = await this.metadata.read();
      const rows = z
        .array(this.schema)
        .max(50000)
        .parse(snap.value ?? []);
      const result = await edit(rows);
      await this.metadata.replace(z.array(this.schema).max(50000).parse(rows), {
        expectedRevision: snap.revision,
      });
      return structuredClone(result);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async close() {
    await this.tail;
  }
}
/** 每个领域使用自己的元数据；跨域引用只能经过公共 specs。 Each domain owns its metadata. */
export class IntegrationDefinitions<T> implements IntegrationDefinitionsV1<T> {
  protected rows: IntegrationRows<IntegrationRevision<T>>;
  constructor(
    meta: PluginMetadata,
    protected contentSchema: z.ZodType<T>,
    protected specs: IntegrationSpecsV1,
    protected domain: string,
  ) {
    this.rows = new IntegrationRows(meta, revisionSchema(contentSchema) as z.ZodType<IntegrationRevision<T>>);
  }
  protected async validate(_scope: IntegrationScope, _content: T): Promise<void> {}
  protected dependencyRefs(_content: T): IntegrationRef[] {
    return [];
  }
  async list(scope: IntegrationScope) {
    ilScope.parse(scope);
    await this.specs.assertWorkspace({ ...scope, allowImporting: true });
    return (await this.rows.all()).filter((r) => r.workspaceId === scope.workspaceId);
  }
  async get(scope: IntegrationScope, ref: IntegrationRef) {
    ilRef.parse(ref);
    const r = (await this.list(scope)).find((v) => v.id === ref.id && v.revision === ref.revision);
    if (!r) ilFail('REVISION_NOT_FOUND');
    if (ilHash({ content: r.content, parent: r.parent, id: r.id, sequence: r.sequence }) !== r.revision)
      ilFail('CONTENT_DIGEST_MISMATCH');
    return r;
  }
  async save(scope: IntegrationScope, raw: IntegrationSave<T>) {
    const input = saveBase.extend({ content: this.contentSchema }).parse(raw);
    const access = await this.specs.assertWorkspace({ ...scope, allowImporting: true });
    await this.validate(scope, input.content);
    return this.rows.change(async (rows) => {
      const versions = rows.filter((r) => r.workspaceId === scope.workspaceId && r.id === input.id);
      const head = versions.at(-1);
      if (
        (input.id && (!head || head.revision !== input.expectedRevision)) ||
        (!input.id && input.expectedRevision)
      )
        ilFail('REVISION_CONFLICT');
      if (versions.length >= 100) ilFail('REVISION_LIMIT');
      const base = {
        id: input.id ?? randomUUID(),
        parent: head?.revision ?? null,
        content: input.content,
        sequence: versions.length + 1,
      };
      const row: IntegrationRevision<T> = {
        ...base,
        workspaceId: scope.workspaceId,
        revision: ilHash(base),
        createdAt: new Date().toISOString(),
        createdBy: access.workspace.owner,
        state: 'draft',
      };
      const size = ilBytes(row);
      const capacity = await this.specs.reserveCapacity(scope, {
        objects: head ? 0 : 1,
        revisions: 1,
        bytes: size * 2,
        metadataBytes: size,
        controlBytes: 0,
      });
      // 保守保留原子写峰值；失败记录不提前释放，供恢复审阅。 Keep peak reservation on unknown publication.
      rows.push(row);
      await this.specs.commitCapacity(scope, capacity.token);
      return row;
    });
  }
  async seal(scope: IntegrationScope, ref: IntegrationRef) {
    const row = await this.get(scope, ref);
    await this.validate(scope, row.content);
    for (const dependency of this.dependencyRefs(row.content))
      await this.specs.reference(scope, dependency, this.domain + ':' + ref.id + ':' + ref.revision);
    return this.rows.change((rows) => {
      const r = rows.find(
        (v) => v.id === ref.id && v.revision === ref.revision && v.workspaceId === scope.workspaceId,
      )!;
      if (r.state === 'archived') ilFail('REVISION_ARCHIVED');
      r.state = 'sealed';
      return r;
    });
  }
  async archive(scope: IntegrationScope, ref: IntegrationRef) {
    const row = await this.get(scope, ref);
    if ((await this.specs.references(scope, ref)).length) ilFail('CONTENT_REFERENCED');
    const archived = await this.rows.change((rows) => {
      const r = rows.find(
        (v) => v.id === ref.id && v.revision === ref.revision && v.workspaceId === scope.workspaceId,
      )!;
      r.state = 'archived';
      return r;
    });
    for (const dependency of this.dependencyRefs(row.content))
      await this.specs.reference(scope, dependency, this.domain + ':' + ref.id + ':' + ref.revision, true);
    return archived;
  }
  async close() {
    await this.rows.close();
  }
}
export async function ilSealed<T>(
  service: IntegrationDefinitionsV1<T>,
  scope: IntegrationScope,
  ref: IntegrationRef,
) {
  const row = await service.get(scope, ref);
  if (row.state !== 'sealed') ilFail('REVISION_NOT_SEALED');
  return row;
}
