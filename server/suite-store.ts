/** 各插件独立元数据的修订、原作用域授权、容量与保护引用。 */
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck } from './operation-context.ts';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/suite-common.ts';

export function suiteFail(code: string, message = code, status = 409): never {
  throw new AppError(message, status, code);
}
export function suiteCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(suiteCanonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + suiteCanonical(v))
      .join(',') +
    '}'
  );
}
export const suiteSha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const suiteHash = (value: unknown) => suiteSha(suiteCanonical(value));
export const suiteBytes = (value: unknown) => Buffer.byteLength(suiteCanonical(value));
const persistedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2));
export function suiteActor(): string {
  const id = resourceContext()?.actorId;
  if (id) return S.suiteId.parse(id);
  return suiteFail('SUITE_OWNER_REQUIRED', '需要已认证的所有者上下文', 403);
}
export function suiteBinding(): string {
  const c = resourceContext();
  if (!c) suiteFail('SUITE_OWNER_REQUIRED', '缺少原调用身份', 403);
  const consumer = c.serviceConsumerPluginInstanceId || c.callerPluginInstanceId || c.pluginInstanceId;
  const generation = c.serviceConsumerPluginGeneration || c.callerPluginGeneration || c.pluginGeneration;
  if (!consumer || !generation) suiteFail('SUITE_GENERATION_REQUIRED', '缺少原插件代次', 403);
  return `${suiteActor()}:${consumer}:${generation}`;
}
export type SuiteAuthorize = () => Promise<void>;
function quotaConsumer(): string {
  const context = resourceContext();
  const identity =
    context?.serviceConsumerPluginInstanceId || context?.callerPluginInstanceId || context?.pluginInstanceId;
  if (!identity) suiteFail('SUITE_INTERNAL_CONSUMER');
  return /^(official:[a-z0-9-]+)/.exec(identity)?.[1] ?? identity;
}
export type SuitePeer = S.SuiteRecordsV1;
const holdSchema = z
  .object({
    id: S.suiteId,
    revision: S.suiteDigest,
    holder: z.string().min(1).max(512),
    consumer: z.string(),
  })
  .strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    rows: z.array(S.suiteRecord).max(100000),
    plans: z.array(S.suitePlan).max(2000),
    holds: z.array(holdSchema).max(100000),
    workspaces: z.array(S.suiteWorkspace).max(50),
    quota: z.array(S.suiteQuota).max(50000),
    policies: z
      .array(
        z
          .object({
            id: S.suiteId,
            workspaceId: S.suiteId,
            revision: z.number().int().positive(),
            allowRead: z.boolean(),
            allowExport: z.boolean(),
          })
          .strict(),
      )
      .max(50000),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
const authorizationReads = new AsyncLocalStorage<{ reads: number; depth: number; active: Set<string> }>();
const empty = (): State => ({
  schemaVersion: 1,
  rows: [],
  plans: [],
  holds: [],
  workspaces: [],
  quota: [],
  policies: [],
});
export class SuiteStore implements S.SuiteRecordsV1 {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly domain: string,
    protected metadata: PluginMetadata,
    protected authorize: SuiteAuthorize,
    protected root?: S.SuiteWorkspacePortV1,
    protected peers: Readonly<Record<string, SuitePeer>> = {},
    protected definition: z.ZodType<S.SuiteJson> | null = null,
  ) {}
  protected allowsQuarantine(_workspaceId: string): boolean {
    return false;
  }
  protected async access(scope?: S.SuiteScope): Promise<void> {
    await this.authorize();
    await captureOperationCheck()();
    suiteActor();
    if (scope) {
      S.suiteScope.parse(scope);
      if (this.root) await this.root.workspace(scope);
      else {
        const snap = stateSchema.parse((await this.metadata.read()).value ?? empty());
        const space = snap.workspaces.find((w) => w.id === scope.workspaceId && w.owner === suiteActor());
        if (!space || space.revoked || (space.quarantined && !this.allowsQuarantine(scope.workspaceId)))
          suiteFail('SUITE_WORKSPACE_DENIED', '空间不存在或已撤销', 403);
      }
    }
    await this.authorize();
  }
  protected async readState(): Promise<State> {
    await this.access();
    const state = stateSchema.parse((await this.metadata.read()).value ?? empty());
    await this.access();
    return state;
  }
  protected validateState(_state: State, _priorBytes = 0): void {}
  protected edit<T>(
    work: (state: State) => T | Promise<T>,
    control = false,
    scope?: S.SuiteScope,
  ): Promise<T> {
    const check = captureOperationCheck();
    const pending = this.tail.then(async () => {
      await this.access();
      await check();
      const snapshot = await this.metadata.read(),
        state = stateSchema.parse(snapshot.value ?? empty());
      const beforeDigest = this.root ? suiteHash(state) : '',
        result = await work(state),
        after = persistedBytes(state);
      const publishedDigest = this.root ? suiteHash(state) : '';
      if (after > (control ? 128 : 96) * 1024 ** 2)
        suiteFail('SUITE_METADATA_LIMIT', '领域元数据容量不足', 413);
      this.validateState(state, persistedBytes(stateSchema.parse(snapshot.value ?? empty())));
      const workspaceId =
        scope?.workspaceId ??
        (result && typeof result === 'object' && 'workspaceId' in result
          ? String(result.workspaceId)
          : undefined);
      if (this.root && workspaceId)
        await this.root.reconcileMetadata({
          workspaceId,
          slot: this.domain + '/' + this.metadata.name,
          payloadDigest: beforeDigest,
          bytes: persistedBytes(stateSchema.parse(snapshot.value ?? empty())),
        });
      const reservation =
        this.root && workspaceId && publishedDigest !== beforeDigest
          ? await this.root.reserve({
              workspaceId,
              bytes: after,
              kind: 'metadata',
              slot: this.domain + '/' + this.metadata.name,
              payloadDigest: publishedDigest,
            })
          : undefined;
      const beforeCommit = async () => {
        await this.authorize();
        await check();
        if (workspaceId) {
          if (this.root) await this.access({ workspaceId });
          else {
            const space = state.workspaces.find((w) => w.id === workspaceId && w.owner === suiteActor());
            if (!space || space.revoked || (space.quarantined && !this.allowsQuarantine(workspaceId)))
              suiteFail('SUITE_WORKSPACE_DENIED', '原空间已变化', 403);
          }
        }
      };
      await beforeCommit();
      await this.metadata.replace(stateSchema.parse(state), {
        expectedRevision: snapshot.revision,
        beforeCommit,
      });
      if (reservation)
        await this.root!.settle({
          workspaceId: reservation.workspaceId,
          id: reservation.id,
          actualBytes: after,
          payloadDigest: publishedDigest,
        });
      return structuredClone(result);
    });
    this.tail = pending.catch(() => {});
    return pending;
  }
  async list(raw: z.input<typeof S.suiteList>): Promise<S.SuitePage> {
    const p = S.suiteList.parse(raw);
    await this.access({ workspaceId: p.workspaceId });
    let rows = (await this.readState()).rows.filter(
      (r) => r.workspaceId === p.workspaceId && r.actor === suiteActor(),
    );
    if (!p.history) {
      const heads = new Map<string, number>();
      for (const row of rows) heads.set(row.id, Math.max(heads.get(row.id) ?? 0, row.sequence));
      rows = rows.filter((r) => heads.get(r.id) === r.sequence);
    }
    if (!p.archived) rows = rows.filter((r) => r.state !== 'archived');
    rows.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence || a.id.localeCompare(b.id),
    );
    const items = rows.slice(p.cursor, p.cursor + p.limit),
      next = p.cursor + items.length;
    for (const row of items)
      for (const ref of row.references) await this.fixed({ workspaceId: p.workspaceId }, ref, true);
    await this.access({ workspaceId: p.workspaceId });
    return { items, next: next < rows.length ? next : null };
  }
  async get(raw: S.SuitePin): Promise<S.SuiteRecord> {
    const enter = async () => {
      const p = S.suitePin.parse(raw),
        context = authorizationReads.getStore()!;
      const identity = `${this.domain}:${p.workspaceId}:${p.id}:${p.revision}`;
      if (++context.reads > 4096 || context.depth >= 64)
        suiteFail('SUITE_REFERENCE_LIMIT', '引用图读取超过有界预算', 413);
      if (context.active.has(identity)) suiteFail('SUITE_REFERENCE_CYCLE');
      context.active.add(identity);
      context.depth++;
      try {
        return await this.readRecord(p);
      } finally {
        context.depth--;
        context.active.delete(identity);
      }
    };
    return authorizationReads.getStore()
      ? enter()
      : authorizationReads.run({ reads: 0, depth: 0, active: new Set() }, enter);
  }
  private async readRecord(raw: S.SuitePin): Promise<S.SuiteRecord> {
    const p = S.suitePin.parse(raw);
    await this.access({ workspaceId: p.workspaceId });
    const row = (await this.readState()).rows.find(
      (r) =>
        r.workspaceId === p.workspaceId &&
        r.actor === suiteActor() &&
        r.id === p.id &&
        r.revision === p.revision,
    );
    if (!row) suiteFail('SUITE_REVISION_NOT_FOUND', '固定修订不存在', 404);
    const { id, parent, sequence, content, references } = row;
    if (row.revision !== suiteHash({ id, parent, sequence, content, references }))
      suiteFail('SUITE_DIGEST_MISMATCH');
    const permissions: string[] = [];
    for (const ref of row.references) {
      const dependency = await this.fixed({ workspaceId: p.workspaceId }, ref, true);
      permissions.push(dependency.authorizationDigest ?? suiteHash(dependency.policyRevision));
    }
    row.authorizationDigest = suiteHash({ policyRevision: row.policyRevision, permissions });
    await this.access({ workspaceId: p.workspaceId });
    return row;
  }
  async fixed(scope: S.SuiteScope, ref: S.SuiteRef, allowImported = false): Promise<S.SuiteRecord> {
    S.suiteRef.parse(ref);
    const peer =
      ref.domain === this.domain
        ? this
        : Object.hasOwn(this.peers, ref.domain)
          ? this.peers[ref.domain]
          : undefined;
    if (!peer) suiteFail('SUITE_UNDECLARED_DEPENDENCY', '材料不属于已声明的直接依赖', 403);
    const row = await peer.get({ ...scope, id: ref.id, revision: ref.revision });
    if (row.state !== 'sealed') suiteFail('SUITE_INPUT_NOT_SEALED', '输入须为封存修订');
    if (!allowImported && row.origin === 'imported' && ['result', 'review', 'import'].includes(row.kind))
      suiteFail('SUITE_IMPORTED_EVIDENCE', '外来结果不能充当本地执行或批准证明', 403);
    return row;
  }
  protected async put(
    raw: S.SuiteSave,
    kind: S.SuiteRecord['kind'],
    seal = false,
    origin: 'local' | 'imported' = 'local',
  ): Promise<S.SuiteRecord> {
    if (!raw || !S.isSuiteJsonBounded(raw.content))
      suiteFail('SUITE_CONTENT_LIMIT', '内容结构或深度超出限制', 413);
    const p = S.suiteSave.parse(raw);
    const scope = { workspaceId: p.workspaceId };
    await this.access(scope);
    for (const ref of p.references) await this.fixed(scope, ref, origin === 'imported');
    const id = p.id ?? randomUUID();
    const stored = await this.edit(async (state) => {
      const versions = state.rows.filter((r) => r.workspaceId === p.workspaceId && r.id === id);
      const head = versions.at(-1);
      if ((p.id && (!head || head.revision !== p.expectedRevision)) || (!p.id && p.expectedRevision))
        suiteFail('SUITE_REVISION_CONFLICT');
      if (versions.length >= 100) suiteFail('SUITE_REVISION_LIMIT');
      const base = {
        id,
        parent: head?.revision ?? null,
        sequence: versions.length + 1,
        content: p.content,
        references: p.references,
      };
      const row: S.SuiteRecord = {
        ...base,
        domain: this.domain,
        workspaceId: p.workspaceId,
        policyRevision: head?.policyRevision ?? 1,
        actor: suiteActor(),
        createdAt: new Date().toISOString(),
        revision: suiteHash(base),
        name: p.name,
        state: seal ? 'sealed' : 'draft',
        kind,
        origin,
      };
      for (const ref of row.references) {
        const peer = ref.domain === this.domain ? this : this.peers[ref.domain];
        if (peer === this) {
          const original = state.rows.find(
            (r) =>
              r.workspaceId === p.workspaceId &&
              r.id === ref.id &&
              r.revision === ref.revision &&
              r.state === 'sealed',
          );
          if (!original) suiteFail('SUITE_INPUT_NOT_SEALED');
          state.holds.push({
            id: ref.id,
            revision: ref.revision,
            holder: `${this.domain}:${id}:${row.revision}`,
            consumer: this.domain,
          });
        } else
          await peer.retain({
            ...scope,
            id: ref.id,
            revision: ref.revision,
            holder: `${this.domain}:${id}:${row.revision}`,
          });
      }
      state.rows.push(row);
      return row;
    });
    for (const ref of stored.references) await this.fixed(scope, ref, origin === 'imported');
    await this.access(scope);
    return stored;
  }
  async save(raw: S.SuiteSave): Promise<S.SuiteRecord> {
    if (!raw || !S.isSuiteJsonBounded(raw.content))
      suiteFail('SUITE_CONTENT_LIMIT', '内容结构或深度超出限制', 413);
    if (!this.definition) suiteFail('SUITE_RESULT_READ_ONLY', '此领域只接受经过验证的业务操作', 403);
    const p = S.suiteSave.parse(raw);
    return this.put({ ...p, content: this.definition.parse(p.content) }, 'definition');
  }
  async importRecord(
    raw: S.SuiteScope & {
      name: string;
      kind: 'definition' | 'result' | 'review' | 'import';
      content: S.SuiteJson;
      references: S.SuiteRef[];
    },
  ) {
    if (!raw || !S.isSuiteJsonBounded(raw.content))
      suiteFail('SUITE_CONTENT_LIMIT', '导入内容结构超出限制', 413);
    const input = S.suiteScope
      .extend({
        name: S.suiteName,
        kind: z.enum(['definition', 'result', 'review', 'import']),
        content: S.suiteJson,
        references: z.array(S.suiteRef).max(1000),
      })
      .strict()
      .parse(raw);
    const consumer = resourceContext()?.serviceConsumerPluginInstanceId,
      allowed = 'official:' + this.domain.split('-')[0] + '-exchange';
    if (!consumer || (consumer !== allowed && !consumer.startsWith(allowed + ':')))
      suiteFail('SUITE_IMPORT_CONSUMER', '只允许本包原交换服务接收对象', 403);
    if (input.kind === 'definition') {
      if (!this.definition) suiteFail('SUITE_DEFINITION_UNSUPPORTED');
      this.definition.parse(input.content);
    }
    return this.put(
      {
        workspaceId: input.workspaceId,
        name: input.name,
        content: input.content,
        references: input.references,
      },
      input.kind,
      true,
      'imported',
    );
  }
  async seal(raw: S.SuitePin): Promise<S.SuiteRecord> {
    const p = S.suitePin.parse(raw),
      row = await this.get(p);
    for (const ref of row.references) await this.fixed({ workspaceId: p.workspaceId }, ref);
    return this.edit((state) => {
      const current = state.rows.find(
        (r) => r.workspaceId === p.workspaceId && r.id === p.id && r.revision === p.revision,
      )!;
      if (current.state === 'archived') suiteFail('SUITE_ARCHIVED');
      current.state = 'sealed';
      return current;
    });
  }
  async references(raw: S.SuitePin): Promise<{ holders: string[] }> {
    const p = S.suitePin.parse(raw);
    await this.get(p);
    return {
      holders: (await this.readState()).holds
        .filter((h) => h.id === p.id && h.revision === p.revision)
        .map((h) => h.holder),
    };
  }
  async retain(raw: S.SuitePin & { holder: string; release?: boolean }): Promise<{ holders: string[] }> {
    const p = S.suitePin
      .extend({ holder: z.string().min(1).max(512), release: z.boolean().optional() })
      .strict()
      .parse(raw);
    if (!p.release) await this.get({ workspaceId: p.workspaceId, id: p.id, revision: p.revision });
    else await this.access({ workspaceId: p.workspaceId });
    const context = resourceContext()!;
    const consumer =
      context.serviceConsumerPluginInstanceId || context.callerPluginInstanceId || context.pluginInstanceId;
    if (!consumer) suiteFail('SUITE_INTERNAL_CONSUMER', '缺少真实材料消费者', 403);
    return this.edit(
      (state) => {
        const current = state.rows.find(
          (r) =>
            r.workspaceId === p.workspaceId &&
            r.actor === suiteActor() &&
            r.id === p.id &&
            r.revision === p.revision,
        );
        const same = (h: State['holds'][number]) =>
          h.id === p.id && h.revision === p.revision && h.holder === p.holder && h.consumer === consumer;
        if (!current) {
          if (p.release && !state.holds.some((h) => h.id === p.id && h.revision === p.revision))
            return { holders: [] };
          suiteFail('SUITE_CONTENT_UNAVAILABLE');
        }
        if (!p.release && current.state !== 'sealed') suiteFail('SUITE_INPUT_NOT_SEALED');
        if (p.release) state.holds = state.holds.filter((h) => !same(h));
        else if (!state.holds.some(same))
          state.holds.push({ id: p.id, revision: p.revision, holder: p.holder, consumer });
        return {
          holders: state.holds.filter((h) => h.id === p.id && h.revision === p.revision).map((h) => h.holder),
        };
      },
      true,
      { workspaceId: p.workspaceId },
    );
  }
  async archive(raw: S.SuitePin): Promise<S.SuiteRecord> {
    const p = S.suitePin.parse(raw);
    await this.get(p);
    return this.edit((state) => {
      if (state.holds.some((h) => h.id === p.id && h.revision === p.revision))
        suiteFail('SUITE_CONTENT_PROTECTED');
      const row = state.rows.find(
        (r) => r.workspaceId === p.workspaceId && r.id === p.id && r.revision === p.revision,
      )!;
      row.state = 'archived';
      return row;
    }, true);
  }
  protected async releaseOwned(_scope: S.SuiteScope, _record: S.SuiteRecord): Promise<void> {}
  async inspectPlan(raw: S.SuiteScope & { planId: string }): Promise<S.SuitePlan> {
    const input = S.suiteScope.extend({ planId: S.suiteId }).strict().parse(raw);
    await this.access({ workspaceId: input.workspaceId });
    const plan = (await this.readState()).plans.find(
      (p) => p.id === input.planId && p.workspaceId === input.workspaceId && p.actor === suiteActor(),
    );
    return plan ?? suiteFail('SUITE_PLAN_NOT_FOUND', '原计划不存在', 404);
  }
  async previewRecovery(raw: S.SuiteScope & { planId: string }): Promise<S.SuitePlan> {
    const original = await this.inspectPlan(raw);
    if (original.action !== 'cleanup' || original.state !== 'consumed')
      suiteFail('SUITE_RECOVERY_NOT_APPLICABLE', '此操作不属于可继续核销的原清理');
    const input = original.input;
    if (!input || typeof input !== 'object' || Array.isArray(input))
      suiteFail('SUITE_RECOVERY_NOT_APPLICABLE');
    return this.plan(
      { workspaceId: original.workspaceId },
      'cleanup',
      { ...input, recoveryOf: original.id },
      [],
    );
  }
  async previewCleanup(raw: S.SuiteScope & { references: S.SuiteRef[] }) {
    const input = S.suiteScope
      .extend({ references: z.array(S.suiteRef).min(1).max(50) })
      .strict()
      .parse(raw);
    await this.access({ workspaceId: input.workspaceId });
    const state = await this.readState();
    const selected = input.references.map((ref) => {
      if (ref.domain !== this.domain) suiteFail('SUITE_CLEANUP_DOMAIN');
      const row = state.rows.find(
        (r) =>
          r.workspaceId === input.workspaceId &&
          r.actor === suiteActor() &&
          r.id === ref.id &&
          r.revision === ref.revision,
      );
      if (!row || row.state !== 'archived') suiteFail('SUITE_CLEANUP_ARCHIVE_REQUIRED');
      if (state.holds.some((h) => h.id === row.id && h.revision === row.revision))
        suiteFail('SUITE_CONTENT_PROTECTED');
      return { reference: ref, dependencies: row.references };
    });
    if (new Set(selected.map((x) => x.reference.id + ':' + x.reference.revision)).size !== selected.length)
      suiteFail('SUITE_CLEANUP_DUPLICATE');
    return this.plan({ workspaceId: input.workspaceId }, 'cleanup', { selected }, []);
  }
  async cleanup(raw: S.SuiteApproval): Promise<S.SuiteRecord> {
    const plan = await this.consume(raw, 'cleanup', true),
      scope = { workspaceId: plan.workspaceId };
    if (plan.state === 'completed' && plan.result)
      return this.get({ ...scope, id: plan.result.id, revision: plan.result.revision });
    const selection = z
      .object({
        recoveryOf: S.suiteId.optional(),
        selected: z
          .array(z.object({ reference: S.suiteRef, dependencies: z.array(S.suiteRef) }).strict())
          .min(1)
          .max(50),
      })
      .strict()
      .parse(plan.input);
    for (const item of selection.selected) {
      const row = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === scope.workspaceId &&
          r.id === item.reference.id &&
          r.revision === item.reference.revision,
      );
      if (row) {
        if (
          row.state !== 'archived' ||
          (await this.readState()).holds.some((h) => h.id === row.id && h.revision === row.revision)
        )
          suiteFail('SUITE_CONTENT_PROTECTED');
        await this.releaseOwned(scope, row);
        await this.edit(
          (state) => {
            if (state.holds.some((h) => h.id === row.id && h.revision === row.revision))
              suiteFail('SUITE_CONTENT_PROTECTED');
            state.rows = state.rows.filter(
              (r) => !(r.workspaceId === scope.workspaceId && r.id === row.id && r.revision === row.revision),
            );
            if (!state.rows.some((r) => r.workspaceId === scope.workspaceId && r.id === row.id))
              state.policies = state.policies.filter(
                (p) => !(p.workspaceId === scope.workspaceId && p.id === row.id),
              );
            state.holds = state.holds.filter(
              (h) =>
                !item.dependencies.some(
                  (ref) =>
                    ref.domain === this.domain &&
                    h.id === ref.id &&
                    h.revision === ref.revision &&
                    h.holder === `${this.domain}:${row.id}:${row.revision}`,
                ),
            );
            return { workspaceId: scope.workspaceId };
          },
          true,
          scope,
        );
      }
      for (const ref of item.dependencies.filter((r) => r.domain !== this.domain)) {
        const peer = this.peers[ref.domain];
        if (!peer) suiteFail('SUITE_UNDECLARED_DEPENDENCY');
        await peer.retain({
          ...scope,
          id: ref.id,
          revision: ref.revision,
          holder: `${this.domain}:${item.reference.id}:${item.reference.revision}`,
          release: true,
        });
      }
    }
    const result = await this.put(
      {
        ...scope,
        name: '原资源清理回执',
        references: [],
        content: {
          ...(selection.recoveryOf ? { recoveryOf: selection.recoveryOf } : {}),
          removed: selection.selected.map((x) => x.reference),
          cleanup: 'confirmed',
        },
      },
      'result',
      true,
    );
    await this.complete(plan, result);
    return result;
  }
  protected async plan(
    scope: S.SuiteScope,
    action: string,
    input: S.SuiteJson,
    references: S.SuiteRef[],
  ): Promise<S.SuitePlan> {
    await this.access(scope);
    references.forEach((r) => S.suiteRef.parse(r));
    const permissions: S.SuitePlan['permissions'] = [];
    for (const ref of references) {
      const record = await this.fixed(scope, ref);
      permissions.push({
        ref,
        policyRevision: record.policyRevision,
        policyDigest: record.authorizationDigest ?? suiteHash(record.policyRevision),
      });
    }
    const workspace = this.root
      ? await this.root.workspace(scope)
      : (await this.readState()).workspaces.find((w) => w.id === scope.workspaceId)!;
    return this.edit((state) => {
      state.plans = state.plans.filter((p) =>
        p.state === 'ready' ? Date.parse(p.expiresAt) > Date.now() : true,
      );
      if (state.plans.length >= 2000) suiteFail('SUITE_PLAN_LIMIT');
      const core = {
        id: randomUUID(),
        ...scope,
        actor: suiteActor(),
        binding: suiteBinding(),
        action,
        input,
        references,
        permissions,
        workspacePolicyRevision: workspace.policyRevision,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
      const result: S.SuitePlan = { ...core, digest: suiteHash(core), state: 'ready', result: null };
      state.plans.push(result);
      return result;
    });
  }
  protected async consume(raw: S.SuiteApproval, action: string, resumable = false): Promise<S.SuitePlan> {
    const p = S.suiteApproval.parse(raw);
    await this.access({ workspaceId: p.workspaceId });
    const found = (await this.readState()).plans.find(
      (v) => v.id === p.planId && v.workspaceId === p.workspaceId,
    );
    if (
      !found ||
      found.digest !== p.digest ||
      found.actor !== suiteActor() ||
      found.binding !== suiteBinding() ||
      found.action !== action
    )
      suiteFail('SUITE_PLAN_CHANGED', '原计划或批准身份已变化');
    const scope = { workspaceId: p.workspaceId };
    const workspace = this.root
      ? await this.root.workspace(scope)
      : (await this.readState()).workspaces.find((w) => w.id === p.workspaceId)!;
    if (workspace.policyRevision !== found.workspacePolicyRevision) suiteFail('SUITE_POLICY_CHANGED');
    for (const guard of found.permissions) {
      const record = await this.fixed(scope, guard.ref);
      if (
        record.policyRevision !== guard.policyRevision ||
        (record.authorizationDigest ?? suiteHash(record.policyRevision)) !== guard.policyDigest
      )
        suiteFail('SUITE_POLICY_CHANGED');
    }
    return this.edit((state) => {
      const row = state.plans.find((v) => v.id === p.planId)!;
      if (row.state === 'completed') return row;
      if (resumable && row.state === 'consumed') return row;
      if (Date.parse(row.expiresAt) <= Date.now()) suiteFail('SUITE_PLAN_EXPIRED');
      if (row.state !== 'ready') suiteFail('SUITE_PLAN_CONSUMED', '计划已提交，请查询原操作结果');
      row.state = 'consumed';
      return row;
    });
  }
  protected async complete(plan: S.SuitePlan, result: S.SuiteRecord): Promise<void> {
    await this.edit((state) => {
      const row = state.plans.find((p) => p.id === plan.id)!;
      row.state = 'completed';
      row.result = { domain: result.domain, id: result.id, revision: result.revision };
      if (
        plan.action === 'cleanup' &&
        result.content &&
        typeof result.content === 'object' &&
        !Array.isArray(result.content) &&
        typeof result.content.recoveryOf === 'string'
      ) {
        const recoveryOf = result.content.recoveryOf;
        const original = state.plans.find(
          (p) =>
            p.id === recoveryOf &&
            p.actor === suiteActor() &&
            p.workspaceId === plan.workspaceId &&
            p.action === 'cleanup' &&
            p.state === 'consumed',
        );
        if (original) {
          original.state = 'completed';
          original.result = row.result;
        }
      }
      return row;
    }, true);
  }
  async close(): Promise<void> {
    await this.tail;
  }
}

export class SuiteRoot extends SuiteStore implements S.SuiteWorkspacePortV1 {
  private accepting = new AsyncLocalStorage<string>();
  constructor(
    domain: string,
    metadata: PluginMetadata,
    authorize: SuiteAuthorize,
    private totalLimit: number,
    definition: z.ZodType<S.SuiteJson> | null = null,
  ) {
    super(domain, metadata, authorize, undefined, {}, definition);
  }
  protected override allowsQuarantine(workspaceId: string): boolean {
    return this.accepting.getStore() === workspaceId;
  }
  protected override validateState(state: State, priorBytes = 0): void {
    // 保留每个槽位的序号水位，已释放回执只保留最近一千条。
    if (state.quota.length > 2000) {
      const watermark = new Map<string, S.SuiteQuota>();
      for (const ticket of state.quota.filter((q) => q.kind === 'metadata')) {
        const key = ticket.consumer + ':' + ticket.slot;
        if ((watermark.get(key)?.sequence ?? -1) < ticket.sequence) watermark.set(key, ticket);
      }
      const released = new Set(
        state.quota
          .filter((q) => q.state === 'released')
          .slice(-1000)
          .map((q) => q.id),
      );
      state.quota = state.quota.filter(
        (q) =>
          q.state !== 'released' ||
          released.has(q.id) ||
          watermark.get(q.consumer + ':' + q.slot)?.id === q.id,
      );
    }
    const own = persistedBytes(state),
      occupied = state.quota.filter((q) => q.state !== 'released');
    if (
      own + priorBytes + occupied.reduce((n, q) => n + q.bytes, 32 * 1024 ** 2) > this.totalLimit ||
      own + this.metadataUsage(occupied) > 128 * 1024 ** 2
    )
      suiteFail('SUITE_QUOTA_EXCEEDED', '空间容量及恢复预留不足', 413);
  }
  private metadataUsage(tickets: S.SuiteQuota[]) {
    const slots = new Map<string, number>();
    for (const ticket of tickets.filter((q) => q.kind === 'metadata')) {
      const id = ticket.slot ? ticket.consumer + ':' + ticket.slot : ticket.id;
      slots.set(id, Math.max(slots.get(id) ?? 0, ticket.bytes));
    }
    return [...slots.values()].reduce((sum, bytes) => sum + bytes, 0);
  }
  async createWorkspace(raw: { name: string }): Promise<S.SuiteWorkspace> {
    const p = z.object({ name: S.suiteName }).strict().parse(raw);
    return this.edit((state) => {
      if (state.workspaces.length >= 50) suiteFail('SUITE_WORKSPACE_LIMIT');
      const space: S.SuiteWorkspace = {
        id: randomUUID(),
        name: p.name,
        owner: suiteActor(),
        createdAt: new Date().toISOString(),
        revoked: false,
        policyRevision: 1,
        quarantined: false,
      };
      state.workspaces.push(space);
      return space;
    });
  }
  async listWorkspaces(): Promise<S.SuiteWorkspace[]> {
    return (await this.readState()).workspaces.filter((w) => w.owner === suiteActor() && !w.quarantined);
  }
  async workspace(raw: S.SuiteScope): Promise<S.SuiteWorkspace> {
    const p = S.suiteScope.parse(raw);
    await this.access(p);
    const row = (await this.readState()).workspaces.find(
      (w) => w.id === p.workspaceId && w.owner === suiteActor(),
    );
    if (!row || row.revoked || (row.quarantined && !this.allowsQuarantine(p.workspaceId)))
      suiteFail('SUITE_WORKSPACE_DENIED', '空间不存在或已撤销', 403);
    return row;
  }
  async revokeWorkspace(
    raw: S.SuiteScope & { expectedRevision: number; revoked: boolean },
  ): Promise<S.SuiteWorkspace> {
    const p = S.suiteScope
      .extend({ expectedRevision: z.number().int().positive(), revoked: z.boolean() })
      .strict()
      .parse(raw);
    return this.edit((state) => {
      const row = state.workspaces.find((w) => w.id === p.workspaceId && w.owner === suiteActor());
      if (!row || row.policyRevision !== p.expectedRevision) suiteFail('SUITE_REVISION_CONFLICT');
      row.revoked = p.revoked;
      row.policyRevision++;
      return row;
    }, true);
  }
  async reserve(raw: S.SuiteReservation): Promise<S.SuiteQuota> {
    return this.reserveFor(raw, quotaConsumer());
  }
  protected async reserveFor(raw: S.SuiteReservation, consumer: string): Promise<S.SuiteQuota> {
    const p = S.suiteScope
      .extend({
        bytes: z.number().int().min(0).max(this.totalLimit),
        kind: z.enum(['metadata', 'material', 'temporary']),
        slot: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,79}\/[a-zA-Z0-9_.-]{1,80}$/)
          .optional(),
        payloadDigest: S.suiteDigest.optional(),
      })
      .strict()
      .parse(raw);
    await this.access({ workspaceId: p.workspaceId });
    if (p.kind === 'metadata' && (!p.slot || !p.payloadDigest)) suiteFail('SUITE_METADATA_RECEIPT_REQUIRED');
    if (p.kind !== 'metadata' && (p.slot || p.payloadDigest)) suiteFail('SUITE_RESERVATION_KIND');
    return this.edit((state) => {
      const occupied = state.quota.filter((q) => q.state !== 'released'),
        own = persistedBytes(state);
      if (occupied.reduce((n, q) => n + q.bytes, own + 32 * 1024 ** 2) + p.bytes > this.totalLimit)
        suiteFail('SUITE_QUOTA_EXCEEDED', '材料、元数据或恢复预算不足', 413);
      const ticket: S.SuiteQuota = {
        ...p,
        slot: p.slot ?? null,
        payloadDigest: p.payloadDigest ?? null,
        sequence:
          p.kind === 'metadata'
            ? 1 +
              state.quota
                .filter((q) => q.kind === 'metadata' && q.consumer === consumer && q.slot === p.slot)
                .reduce((n, q) => Math.max(n, q.sequence), 0)
            : 0,
        id: randomUUID(),
        consumer,
        state: 'reserved',
        createdAt: new Date().toISOString(),
      };
      state.quota.push(ticket);
      return ticket;
    });
  }
  async settle(raw: S.SuiteSettlement): Promise<S.SuiteQuota> {
    return this.settleFor(raw, quotaConsumer());
  }
  async reconcileMetadata(
    raw: S.SuiteScope & { slot: string; payloadDigest: string; bytes: number },
  ): Promise<{ reconciled: number }> {
    const p = S.suiteScope
      .extend({
        slot: z.string().regex(/^[a-z][a-z0-9-]{0,79}\/[a-zA-Z0-9_.-]{1,80}$/),
        payloadDigest: S.suiteDigest,
        bytes: z
          .number()
          .int()
          .min(0)
          .max(128 * 1024 ** 2),
      })
      .strict()
      .parse(raw);
    await this.access({ workspaceId: p.workspaceId });
    const consumer = quotaConsumer();
    // 只有原存储提供者能核对自己的持久槽位；不公开为 HTTP。
    return this.edit(
      (state) => {
        const tickets = state.quota.filter(
          (q) => q.consumer === consumer && q.slot === p.slot && q.kind === 'metadata',
        );
        const matching = tickets
          .filter((q) => q.payloadDigest === p.payloadDigest && q.state !== 'released')
          .at(-1);
        if (matching && p.bytes > matching.bytes) suiteFail('SUITE_METADATA_RECEIPT_CHANGED');
        let reconciled = 0;
        for (const ticket of tickets) {
          if (ticket === matching) {
            if (ticket.state !== 'committed') reconciled++;
            ticket.state = 'committed';
            ticket.bytes = p.bytes;
          } else if (ticket.state !== 'released') {
            // 调用方已串行读取实际槽位，其他预留未发布或已经被替换。
            ticket.state = 'released';
            reconciled++;
          }
        }
        return { reconciled };
      },
      true,
      { workspaceId: p.workspaceId },
    );
  }
  protected async settleFor(raw: S.SuiteSettlement, consumer: string): Promise<S.SuiteQuota> {
    const p = S.suiteScope
      .extend({
        id: S.suiteId,
        release: z.boolean().optional(),
        actualBytes: z.number().int().min(0).optional(),
        payloadDigest: S.suiteDigest.optional(),
      })
      .strict()
      .parse(raw);
    await this.access({ workspaceId: p.workspaceId });
    return this.edit((state) => {
      const ticket = state.quota.find(
        (q) => q.id === p.id && q.workspaceId === p.workspaceId && q.consumer === consumer,
      );
      if (!ticket) suiteFail('SUITE_RESERVATION_NOT_OWNED');
      if (ticket.state === 'released' && !p.release) suiteFail('SUITE_RESERVATION_RELEASED');
      if (p.release && ticket.kind === 'metadata' && ticket.state === 'committed')
        suiteFail('SUITE_METADATA_PUBLICATION_REQUIRED', '已发布元数据必须用新修订核销');
      if (!p.release && ticket.kind === 'metadata') {
        if (
          p.actualBytes === undefined ||
          p.actualBytes > ticket.bytes ||
          p.payloadDigest !== ticket.payloadDigest
        )
          suiteFail('SUITE_METADATA_RECEIPT_CHANGED');
        if (ticket.state === 'committed') return ticket;
        if (
          state.quota.some(
            (q) =>
              q.kind === 'metadata' &&
              q.consumer === ticket.consumer &&
              q.slot === ticket.slot &&
              q.state === 'committed' &&
              q.sequence > ticket.sequence,
          )
        )
          suiteFail('SUITE_METADATA_PUBLICATION_STALE', '较新的元数据已经完成发布');
        for (const old of state.quota)
          if (
            old.id !== ticket.id &&
            old.consumer === ticket.consumer &&
            old.slot === ticket.slot &&
            old.kind === 'metadata' &&
            old.state === 'committed'
          )
            old.state = 'released';
        ticket.bytes = p.actualBytes;
      }
      ticket.state = p.release ? 'released' : 'committed';
      return ticket;
    }, true);
  }
  async capacity(raw: S.SuiteScope) {
    const p = S.suiteScope.parse(raw);
    await this.access(p);
    const state = await this.readState();
    return {
      used: state.quota
        .filter((q) => q.state === 'committed')
        .reduce((n, q) => n + q.bytes, persistedBytes(state)),
      reserved: state.quota
        .filter((q) => q.state === 'reserved')
        .reduce((n, q) => n + q.bytes, 32 * 1024 ** 2),
      limit: this.totalLimit,
      metadataLimit: 128 * 1024 ** 2,
    };
  }
  async acceptWorkspace(raw: { name: string }, work: (scope: S.SuiteScope) => Promise<S.SuiteJson>) {
    const input = z.object({ name: S.suiteName }).strict().parse(raw);
    const consumer = resourceContext()?.serviceConsumerPluginInstanceId,
      allowed = 'official:' + this.domain.split('-')[0] + '-exchange';
    if (!consumer || (consumer !== allowed && !consumer.startsWith(allowed + ':')))
      suiteFail('SUITE_IMPORT_CONSUMER');
    const space = await this.edit((state) => {
      if (state.workspaces.length >= 50) suiteFail('SUITE_WORKSPACE_LIMIT');
      const space: S.SuiteWorkspace = {
        id: randomUUID(),
        name: input.name,
        owner: suiteActor(),
        createdAt: new Date().toISOString(),
        revoked: false,
        policyRevision: 1,
        quarantined: true,
      };
      state.workspaces.push(space);
      return space;
    });
    return this.accepting.run(space.id, async () => {
      const result = S.suiteJson.parse(await work({ workspaceId: space.id }));
      const workspace = await this.edit((state) => {
        const row = state.workspaces.find((w) => w.id === space.id && w.owner === suiteActor());
        if (!row || !row.quarantined) suiteFail('SUITE_IMPORT_CHANGED');
        row.quarantined = false;
        row.policyRevision++;
        return row;
      });
      return { workspace, result };
    });
  }
}
