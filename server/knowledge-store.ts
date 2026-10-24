/** 串行修订、固定计划和容量结算。 Serialized revisions, scoped plans and conservative accounting. */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck } from './operation-context.ts';
import { AppError } from '../shared/errors.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type { KnowledgeSourcesV1 } from './service-contracts/knowledge-studio.ts';
export type KnowledgeAuthorize = () => Promise<void>;
export function fail(code: string, message: string, status = 409): never {
  throw new AppError(message, status, code);
}
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(v)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
export const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
export const hash = (v: unknown) => sha(canonical(v));
export const actor = () => resourceContext()?.actorId || 'local-owner-session';
export const consumer = () =>
  resourceContext()?.serviceConsumerPluginInstanceId ||
  resourceContext()?.pluginInstanceId ||
  'local-owner-session';
export const binding = () =>
  `${consumer()}:${actor()}:${resourceContext()?.serviceConsumerPluginGeneration || resourceContext()?.callerPluginGeneration || ''}`;
export const now = () => new Date().toISOString();
export const ref = (v: K.Ref): K.Ref => ({ id: v.id, revision: v.revision });
export const uniqueDeps = (deps: K.Dependency[]) =>
  [...new Map(deps.map((d) => [`${d.id}:${d.revision}`, d])).values()].sort(
    (a, b) => a.id.localeCompare(b.id) || a.revision - b.revision,
  );
export function base(
  spaceId: string,
  content: unknown,
  dependencies: K.Dependency[],
  id: string = randomUUID(),
  revision = 1,
) {
  return {
    spaceId,
    id,
    revision,
    digest: hash(content),
    createdAt: now(),
    actor: actor(),
    dependencies: uniqueDeps(dependencies),
  };
}
export function sensitive(text: string) {
  const found: string[] = [];
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) found.push('发现私钥标记');
  if (/(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{6,}/i.test(text))
    found.push('发现可能的凭据赋值');
  if (/\b(?:AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,})\b/.test(text)) found.push('发现可能的访问令牌');
  return found;
}
export class KnowledgeStore<T extends { id: string; spaceId: string; revision: number }> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly metadata: PluginMetadata,
    readonly schema: z.ZodType<T>,
    readonly authorize: KnowledgeAuthorize,
    readonly sources?: KnowledgeSourcesV1,
  ) {}
  async all() {
    await this.authorize();
    const rows = z
      .array(this.schema)
      .max(50000)
      .parse((await this.metadata.read()).value ?? []);
    await this.authorize();
    return rows;
  }
  async list(spaceId: string) {
    K.kid.parse(spaceId);
    return (await this.all()).filter((r) => r.spaceId === spaceId);
  }
  async get(pin: K.Pin) {
    K.pinSchema.parse(pin);
    const row = (await this.list(pin.spaceId)).find((r) => r.id === pin.id && r.revision === pin.revision);
    return row ?? fail('KNOWLEDGE_NOT_FOUND', '固定修订不存在', 404);
  }
  async change<R>(
    spaceId: string,
    edit: (rows: T[]) => R,
    recovery = false,
    before?: () => Promise<void>,
  ): Promise<R> {
    const check = captureOperationCheck();
    const work = this.tail.then(async () => {
      await check();
      await this.authorize();
      const snap = await this.metadata.read();
      const rows = z
        .array(this.schema)
        .max(50000)
        .parse(snap.value ?? []);
      const result = edit(rows);
      z.array(this.schema).max(50000).parse(rows);
      const bytes = Buffer.byteLength(canonical(rows));
      if (
        bytes > (recovery ? 33 : 32) * 1024 ** 2 ||
        rows.filter((r) => r.spaceId === spaceId).length > 10000
      )
        fail('KNOWLEDGE_QUOTA', '领域元数据达到上限', 413);
      const reservation =
        !recovery && this.sources
          ? await this.sources.reserveCapacity({
              spaceId,
              bytes,
              objects: rows.filter((r) => r.spaceId === spaceId).length,
              kind: 'metadata',
              slot: this.metadata.name,
              operationId: randomUUID(),
            })
          : undefined;
      if (!recovery && this.sources) {
        const previous = Array.isArray(snap.value)
          ? (snap.value as { id: string; spaceId: string; revision: number }[])
          : [];
        for (const row of rows) {
          if (
            previous.some(
              (old) => old.id === row.id && old.spaceId === row.spaceId && old.revision === row.revision,
            ) ||
            !('dependencies' in row)
          )
            continue;
          const dependencies = z.array(K.dependencySchema).parse(row.dependencies);
          for (const dep of dependencies) {
            const source = await this.sources.getSource({
              spaceId: row.spaceId,
              ...ref(dep),
              purpose: 'read',
            });
            await this.sources.retain({
              spaceId: row.spaceId,
              id: source.blobId,
              holder: `${this.metadata.name}:${row.id}:${row.revision}`,
            });
          }
        }
      }
      try {
        await this.metadata.replace(rows, {
          expectedRevision: snap.revision,
          beforeCommit: async () => {
            await check();
            await this.authorize();
            await before?.();
          },
        });
        if (reservation)
          await this.sources!.commitCapacity({ spaceId, token: reservation.token, actual: bytes });
      } catch (error) {
        /* 未确认提交的容量保留。 Uncertain writes retain their reservations. */ throw error;
      }
      return structuredClone(result);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async append(row: T, expectedRevision = 0, before?: () => Promise<void>) {
    return this.change(
      row.spaceId,
      (rows) => {
        const current = Math.max(
          0,
          ...rows.filter((r) => r.spaceId === row.spaceId && r.id === row.id).map((r) => r.revision),
        );
        if (current !== expectedRevision || row.revision !== current + 1)
          fail('REVISION_CONFLICT', '修订已改变，请比较后重新提交');
        rows.push(this.schema.parse(row));
        return row;
      },
      false,
      before,
    );
  }
  async close() {
    await this.tail;
  }
}
const planRowSchema = K.planSchema
  .extend({
    id: K.kid,
    revision: z.literal(1),
    binding: z.string().max(600),
    state: z.enum(['planned', 'consumed']),
    payload: z.string().max(4 * 1024 ** 2),
  })
  .strict();
type PlanRow = z.infer<typeof planRowSchema>;
export class KnowledgePlans {
  private store: KnowledgeStore<PlanRow>;
  private checks = new Map<string, () => Promise<void>>();
  constructor(meta: PluginMetadata, auth: KnowledgeAuthorize, sources?: KnowledgeSourcesV1) {
    this.store = new KnowledgeStore(meta, planRowSchema, auth, sources);
  }
  async create(spaceId: string, payload: unknown, summary: string[], recovery = false) {
    const token = randomUUID();
    const row: PlanRow = {
      token,
      id: token,
      revision: 1,
      spaceId,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      digest: hash(payload),
      summary,
      binding: binding(),
      state: 'planned',
      payload: canonical(payload),
    };
    this.checks.set(token, captureOperationCheck());
    if (recovery)
      await this.store.change(
        spaceId,
        (rows) => {
          rows.push(row);
        },
        true,
      );
    else await this.store.append(row);
    return K.planSchema.parse({ token, spaceId, expiresAt: row.expiresAt, digest: row.digest, summary });
  }
  async consume<T>(spaceId: string, token: string, schema: z.ZodType<T>): Promise<T> {
    const check = this.checks.get(token);
    if (!check) fail('PLAN_EXPIRED', '计划在重启后失效，请重新预览');
    await check();
    return this.store.change(
      spaceId,
      (rows) => {
        const row = rows.find((r) => r.token === token && r.spaceId === spaceId);
        if (
          !row ||
          row.state !== 'planned' ||
          row.binding !== binding() ||
          Date.parse(row.expiresAt) < Date.now()
        )
          fail('PLAN_EXPIRED', '计划已使用、过期或调用身份改变');
        row.state = 'consumed';
        this.checks.delete(token);
        const payload = schema.parse(JSON.parse(row.payload));
        if (hash(payload) !== row.digest) fail('CITATION_MISMATCH', '计划摘要损坏');
        return payload;
      },
      true,
    );
  }
}
