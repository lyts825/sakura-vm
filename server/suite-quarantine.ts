/** 隔离接收只核销本包已有对象；旧业务动作不重放，未知字节继续计费。 */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as S from '../shared/contracts/suite-common.ts';
import {
  SuiteStore,
  suiteActor,
  suiteControlReceipt,
  suiteFail,
  suiteHash,
  type SuiteAuthorize,
} from './suite-store.ts';
const reference = (row: S.SuiteRecord): S.SuiteRef => ({
  domain: row.domain,
  id: row.id,
  revision: row.revision,
});
const pin = (scope: S.SuiteScope, ref: S.SuiteRef) => ({ ...scope, id: ref.id, revision: ref.revision });
const key = (ref: S.SuiteRef) => `${ref.domain}:${ref.id}:${ref.revision}`;
const targetInput = S.suiteScope.extend({ targetWorkspaceId: S.suiteId }).strict();
const recordSummary = z
  .object({
    reference: S.suiteRef,
    name: S.suiteName,
    state: S.suiteRecord.shape.state,
    kind: S.suiteRecord.shape.kind,
    origin: S.suiteRecord.shape.origin,
    references: z.array(S.suiteRef).max(1000),
    control: z.boolean(),
    material: S.suiteMaterial.nullable(),
    policy: z
      .object({ allowRead: z.boolean(), allowExport: z.boolean(), revision: z.number().int().positive() })
      .strict()
      .nullable(),
  })
  .strict();
const snapshotSchema = z
  .object({
    records: z.array(recordSummary).max(5000),
    publications: z
      .array(z.object({ domain: S.suiteRef.shape.domain, publication: S.suitePublication }).strict())
      .max(2000),
    uploads: z.array(S.suiteUpload).max(10000),
    reservations: S.suiteQuarantine.shape.reservations,
  })
  .strict();
const recoverySchema = z.object({ domain: S.suiteRef.shape.domain, plan: S.suitePlan }).strict();
const discardInput = z
  .object({
    targetWorkspaceId: S.suiteId,
    targetRevision: z.number().int().positive(),
    mode: z.enum(['discard', 'confirm-closed']),
    snapshot: snapshotSchema.nullable(),
    recoveries: z.array(recoverySchema).max(2000),
    createsBusinessResources: z.literal(false),
  })
  .strict();
const discardReceipt = z
  .object({
    format: z.literal('sakura-suite-quarantine-discard/1'),
    planId: S.suiteId,
    targetWorkspaceId: S.suiteId,
    state: z.enum(['staged', 'confirmed']),
    removedRecords: z.number().int().min(0),
    discardedUploads: z.array(S.suiteId).max(10000),
    controlReceiptsRetained: z.number().int().min(0),
    evidence: z.array(S.suiteRecord).max(5000).default([]),
    workspacePolicyRevision: z.number().int().positive().nullable(),
    replayedBusinessActions: z.literal(false),
  })
  .strict();
export class SuiteQuarantineExchange extends SuiteStore {
  protected transferTail: Promise<unknown> = Promise.resolve();
  protected serializeTransfer<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.transferTail.then(work);
    this.transferTail = pending.catch(() => {});
    return pending;
  }
  constructor(
    domain: string,
    metadata: PluginMetadata,
    auth: SuiteAuthorize,
    protected sources: S.SuiteMaterialsV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
    private readonly materialStores?: Readonly<Record<string, S.SuiteByteMaterialsV1>>,
  ) {
    super(domain, metadata, auth, sources, peers);
  }
  /** 固定装配的原字节所有者；旧包仍只返回其单一 sources。 */
  protected materialProvider(domain: string): S.SuiteByteMaterialsV1 {
    const stores = this.materialProviders();
    return Object.hasOwn(stores, domain)
      ? stores[domain]
      : suiteFail('SUITE_QUARANTINE_MATERIAL_PROVIDER');
  }
  protected materialProviders(): Readonly<Record<string, S.SuiteByteMaterialsV1>> {
    return this.materialStores ?? { [this.sourcesDomainForQuarantine()]: this.sources };
  }
  private async ownedUploads(scope: S.SuiteScope) {
    const uploads: { provider: S.SuiteByteMaterialsV1; upload: S.SuiteUpload }[] = [];
    const ids = new Set<string>();
    for (const provider of Object.values(this.materialProviders()))
      for (const upload of await provider.uploads(scope)) {
        if (ids.has(upload.id)) suiteFail('SUITE_QUARANTINE_UPLOAD_DUPLICATE');
        ids.add(upload.id);
        uploads.push({ provider, upload });
        if (uploads.length > 10000) suiteFail('SUITE_QUARANTINE_UPLOAD_LIMIT');
      }
    return uploads;
  }
  async quarantines(raw: S.SuiteScope): Promise<S.SuiteQuarantine[]> {
    const scope = S.suiteScope.parse(raw);
    await this.access(scope);
    const rows = await this.sources.quarantines();
    await this.access(scope);
    return rows;
  }
  private async quarantine(workspaceId: string): Promise<S.SuiteQuarantine> {
    return (
      (await this.sources.quarantines()).find((row) => row.workspace.id === workspaceId) ??
      suiteFail('SUITE_QUARANTINE_NOT_FOUND', '本包没有此隔离空间', 404)
    );
  }
  private port(domain: string): S.SuiteRecordsV1 {
    return Object.hasOwn(this.peers, domain)
      ? this.peers[domain]
      : suiteFail('SUITE_QUARANTINE_PROVIDER', '原对象提供者不可用');
  }
  private async snapshot(scope: S.SuiteScope): Promise<z.infer<typeof snapshotSchema>> {
    const records: z.infer<typeof recordSummary>[] = [],
      publications: z.infer<typeof snapshotSchema>['publications'] = [];
    for (const [domain, port] of Object.entries(this.peers)) {
      let cursor = 0;
      do {
        const page = await port.list({ ...scope, cursor, limit: 100, history: true, archived: true });
        for (const listed of page.items) {
          if (records.length >= 5000)
            suiteFail('SUITE_QUARANTINE_OBJECT_LIMIT', '隔离对象超过本次核对预算', 413);
          const row = await port.get(pin(scope, reference(listed)));
          if (row.domain !== domain || row.workspaceId !== scope.workspaceId || row.actor !== suiteActor())
            suiteFail('SUITE_QUARANTINE_OWNER');
          const material = row.kind === 'source' ? S.suiteMaterial.parse(row.content) : null;
          records.push({
            reference: reference(row),
            name: row.name,
            state: row.state,
            kind: row.kind,
            origin: row.origin,
            references: row.references,
            control: suiteControlReceipt(row),
            material,
            policy: material ? await this.materialProvider(domain).policy(pin(scope, reference(row))) : null,
          });
        }
        if (page.next === null) break;
        cursor = page.next;
      } while (true);
      cursor = 0;
      do {
        const page = await port.publications({ ...scope, cursor, limit: 100 });
        for (const publication of page.items.filter((row) => ['pending', 'unknown'].includes(row.status))) {
          if (publications.length >= 2000) suiteFail('SUITE_QUARANTINE_PUBLICATION_LIMIT');
          publications.push({ domain, publication });
        }
        if (page.next === null) break;
        cursor = page.next;
      } while (true);
    }
    const info = await this.quarantine(scope.workspaceId);
    return snapshotSchema.parse({
      records,
      publications,
      uploads: (await this.ownedUploads(scope)).map(({ upload }) => upload),
      reservations: info.reservations,
    });
  }
  protected sourcesDomainForQuarantine(): string {
    return this.domain.split('-')[0] + '-sources';
  }
  async previewQuarantineDiscard(raw: S.SuiteScope & { targetWorkspaceId: string }): Promise<S.SuitePlan> {
    return this.serializeTransfer(async () => {
      const input = targetInput.parse(raw),
        scope = { workspaceId: input.workspaceId };
      await this.access(scope);
      if (input.workspaceId === input.targetWorkspaceId) suiteFail('SUITE_QUARANTINE_ORIGINAL_SCOPE');
      const info = await this.quarantine(input.targetWorkspaceId);
      if (info.disposition === 'discarded') {
        if (info.receipt?.workspaceId !== input.workspaceId)
          suiteFail('SUITE_QUARANTINE_RECEIPT_SCOPE', '请切换到原接收空间核对回执');
        return this.plan(
          scope,
          'discard-quarantine',
          {
            targetWorkspaceId: input.targetWorkspaceId,
            targetRevision: info.workspace.policyRevision,
            mode: 'confirm-closed',
            snapshot: null,
            recoveries: [],
            createsBusinessResources: false,
          },
          [],
        );
      }
      const data = await this.sources.withQuarantine(
        { workspaceId: input.targetWorkspaceId, expectedRevision: info.workspace.policyRevision },
        async (destination) => {
          const snapshot = await this.snapshot(destination),
            recoveries: z.infer<typeof recoverySchema>[] = [];
          for (const pending of snapshot.publications)
            recoveries.push({
              domain: pending.domain,
              plan: await this.port(pending.domain).previewPublicationRecovery({
                ...destination,
                id: pending.publication.id,
              }),
            });
          return S.suiteJson.parse({ snapshot, recoveries });
        },
      );
      const details = z
        .object({ snapshot: snapshotSchema, recoveries: z.array(recoverySchema).max(2000) })
        .strict()
        .parse(data);
      return this.plan(
        scope,
        'discard-quarantine',
        S.suiteJson.parse({
          targetWorkspaceId: input.targetWorkspaceId,
          targetRevision: info.workspace.policyRevision,
          mode: 'discard',
          ...details,
          createsBusinessResources: false,
        }),
        [],
      );
    });
  }
  private assertProgress(approved: z.infer<typeof snapshotSchema>, current: z.infer<typeof snapshotSchema>) {
    const allowed = new Map(approved.records.map((row) => [key(row.reference), row]));
    for (const row of current.records.filter((row) => !row.control)) {
      const old = allowed.get(key(row.reference));
      if (
        !old ||
        old.control ||
        suiteHash({ ...old, state: null }) !== suiteHash({ ...row, state: null }) ||
        (old.state === 'archived' && row.state !== 'archived')
      )
        suiteFail('SUITE_QUARANTINE_CHANGED', '隔离业务对象超出原批准范围，请重新预览');
    }
    const pending = new Map(
      approved.publications.map((item) => [item.domain + ':' + item.publication.id, item]),
    );
    if (
      current.publications.some((item) => {
        const original = pending.get(item.domain + ':' + item.publication.id);
        return !original || key(original.publication.reference) !== key(item.publication.reference);
      })
    )
      suiteFail('SUITE_QUARANTINE_CHANGED');
    const uploads = new Map(approved.uploads.map((upload) => [upload.id, upload]));
    for (const upload of current.uploads) {
      const old = uploads.get(upload.id);
      if (
        !old ||
        old.digest !== upload.digest ||
        old.bytes !== upload.bytes ||
        old.reservationId !== upload.reservationId ||
        old.actor !== upload.actor ||
        (upload.state !== 'discarded' && suiteHash(old.identity) !== suiteHash(upload.identity))
      )
        suiteFail('SUITE_QUARANTINE_UPLOAD_CHANGED');
    }
    const reservations = new Map(approved.reservations.map((ticket) => [ticket.id, ticket]));
    if (
      current.reservations.some((ticket) => {
        const old = reservations.get(ticket.id);
        return (
          !old || old.consumer !== ticket.consumer || old.kind !== ticket.kind || ticket.bytes > old.bytes
        );
      })
    )
      suiteFail('SUITE_QUARANTINE_RESERVATION_CHANGED');
  }
  private async removeRecords(
    scope: S.SuiteScope,
    records: z.infer<typeof recordSummary>[],
  ): Promise<number> {
    const remaining = new Map(records.filter((row) => !row.control).map((row) => [key(row.reference), row]));
    let removed = 0;
    while (remaining.size) {
      const parents = new Set([...remaining.values()].flatMap((row) => row.references.map(key))),
        leaves = [...remaining.values()].filter((row) => !parents.has(key(row.reference)));
      if (!leaves.length) suiteFail('SUITE_QUARANTINE_GRAPH', '隔离引用图无法按原归属核销');
      const domain = leaves[0].reference.domain,
        batch = leaves.filter((row) => row.reference.domain === domain).slice(0, 50),
        port = this.port(domain);
      for (const row of batch) if (row.state !== 'archived') await port.archive(pin(scope, row.reference));
      const cleanup = await port.previewCleanup({ ...scope, references: batch.map((row) => row.reference) }),
        receipt = await port.cleanup({ ...scope, planId: cleanup.id, digest: cleanup.digest });
      if (
        !suiteControlReceipt(receipt) ||
        !receipt.content ||
        typeof receipt.content !== 'object' ||
        Array.isArray(receipt.content) ||
        receipt.content.cleanup !== 'confirmed'
      )
        suiteFail('SUITE_QUARANTINE_CLEANUP_UNKNOWN');
      for (const row of batch) {
        remaining.delete(key(row.reference));
        removed++;
      }
    }
    return removed;
  }
  private async confirmDiscard(plan: S.SuitePlan, info: S.SuiteQuarantine): Promise<S.SuiteRecord> {
    if (!info.receipt || info.receipt.workspaceId !== plan.workspaceId)
      suiteFail('SUITE_QUARANTINE_RECEIPT_SCOPE');
    const scope = { workspaceId: plan.workspaceId },
      state = await this.readState(),
      row = state.rows
        .filter(
          (row) =>
            row.workspaceId === plan.workspaceId &&
            row.actor === suiteActor() &&
            row.id === info.receipt!.reference.id,
        )
        .at(-1);
    if (!row || row.origin !== 'local') suiteFail('SUITE_QUARANTINE_RECEIPT_MISSING');
    await this.get(pin(scope, reference(row)));
    const content = discardReceipt.parse(row.content);
    if (content.targetWorkspaceId !== info.workspace.id) suiteFail('SUITE_QUARANTINE_RECEIPT_CHANGED');
    const confirmed =
      content.state === 'confirmed'
        ? row
        : await this.put(
            {
              ...scope,
              id: row.id,
              expectedRevision: row.revision,
              name: row.name,
              references: [],
              content: {
                ...content,
                state: 'confirmed',
                workspacePolicyRevision: info.workspace.policyRevision,
              },
            },
            'result',
            true,
          );
    await this.complete(plan, confirmed);
    const original = (await this.readState()).plans.find(
      (original) =>
        original.id === content.planId &&
        original.workspaceId === plan.workspaceId &&
        original.actor === suiteActor() &&
        original.action === 'discard-quarantine' &&
        original.state === 'consumed',
    );
    if (original) await this.complete(original, confirmed);
    return confirmed;
  }
  async discardQuarantine(raw: S.SuiteApproval): Promise<S.SuiteRecord> {
    return this.serializeTransfer(async () => {
      const plan = await this.consume(raw, 'discard-quarantine', true),
        scope = { workspaceId: plan.workspaceId };
      if (plan.state === 'completed' && plan.result) return this.get(pin(scope, plan.result));
      const input = discardInput.parse(plan.input),
        info = await this.quarantine(input.targetWorkspaceId);
      if (info.disposition === 'discarded') {
        const expected = input.mode === 'discard' ? input.targetRevision + 1 : input.targetRevision;
        if (info.workspace.policyRevision !== expected) suiteFail('SUITE_POLICY_CHANGED');
        return this.confirmDiscard(plan, info);
      }
      if (
        input.mode !== 'discard' ||
        !input.snapshot ||
        info.workspace.policyRevision !== input.targetRevision
      )
        suiteFail('SUITE_QUARANTINE_CHANGED');
      await this.sources.retireQuarantine(
        {
          workspaceId: input.targetWorkspaceId,
          expectedRevision: input.targetRevision,
          receiptWorkspaceId: plan.workspaceId,
        },
        async (destination) => {
          this.assertProgress(input.snapshot!, await this.snapshot(destination));
          for (const recovery of input.recoveries)
            await this.port(recovery.domain).recoverPublication({
              ...destination,
              planId: recovery.plan.id,
              digest: recovery.plan.digest,
            });
          const before = await this.snapshot(destination);
          this.assertProgress(input.snapshot!, before);
          const removed = await this.removeRecords(destination, before.records),
            discarded: string[] = [];
          for (const { provider, upload } of await this.ownedUploads(destination))
            if (upload.state !== 'discarded') {
              await provider.discardUpload({ ...destination, id: upload.id });
              discarded.push(upload.id);
            }
          const after = await this.snapshot(destination);
          if (
            after.records.some((row) => !row.control) ||
            after.publications.length ||
            after.uploads.some((upload) => upload.state !== 'discarded') ||
            after.reservations.length
          )
            suiteFail('SUITE_QUARANTINE_CLEANUP_UNKNOWN', '隔离对象仍有未确认占用，保留原账本');
          const evidence: S.SuiteRecord[] = [];
          for (const control of after.records.filter((row) => row.control))
            evidence.push(await this.port(control.reference.domain).get(pin(destination, control.reference)));
          const receipt = await this.put(
            {
              ...scope,
              name: '隔离材料核销回执',
              references: [],
              content: {
                format: 'sakura-suite-quarantine-discard/1',
                planId: plan.id,
                targetWorkspaceId: input.targetWorkspaceId,
                state: 'staged',
                removedRecords: removed,
                discardedUploads: discarded,
                controlReceiptsRetained: after.records.length,
                evidence: S.suiteJson.parse(evidence),
                workspacePolicyRevision: null,
                replayedBusinessActions: false,
              },
            },
            'result',
            true,
          );
          return reference(receipt);
        },
      );
      return this.confirmDiscard(plan, await this.quarantine(input.targetWorkspaceId));
    });
  }
  override async close() {
    await this.transferTail;
    await super.close();
  }
}
