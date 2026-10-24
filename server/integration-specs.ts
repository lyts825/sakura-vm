/** 工作空间登记、固定契约、容量与引用账本。 Owner workspace registry, contracts and package ledger. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { IntegrationSpecsV1 } from './service-contracts/integration-lab.ts';
import {
  IntegrationDefinitions,
  IntegrationRows,
  ilIdentity,
  ilHash,
  ilBytes,
  ilFail,
} from './integration-store.ts';
import { validateContract, compareContracts } from './integration-validation.ts';
import {
  httpContractSchema,
  workspaceSchema,
  capacitySchema,
  comparisonSchema,
  ilRef,
  ilScope,
  ilName,
  type HttpContract,
  type IntegrationScope,
  type IntegrationRef,
  type IntegrationCapacity,
} from '../shared/contracts/integration-lab.ts';
export type IntegrationMetadataFactory = (name: string) => PluginMetadata;
export class IntegrationSpecs extends IntegrationDefinitions<HttpContract> implements IntegrationSpecsV1 {
  private spaces;
  private capacity;
  private refs;
  private differences;
  constructor(meta: IntegrationMetadataFactory) {
    super(meta('contracts'), httpContractSchema, null as unknown as IntegrationSpecsV1, 'specs');
    this.specs = this;
    this.spaces = new IntegrationRows(meta('workspaces'), workspaceSchema);
    this.capacity = new IntegrationRows(meta('capacity'), capacitySchema);
    this.refs = new IntegrationRows(
      meta('references'),
      z.object({ workspaceId: z.uuid(), ref: ilRef, owner: ilName, consumer: ilName }).strict(),
    );
    this.differences = new IntegrationRows(meta('comparisons'), comparisonSchema);
  }
  protected override async validate(_scope: IntegrationScope, content: HttpContract) {
    validateContract(content);
  }
  async createWorkspace(raw: { name: string; importing?: boolean }) {
    const input = z.object({ name: ilName, importing: z.boolean().optional() }).strict().parse(raw),
      who = await ilIdentity();
    return this.spaces.change((rows) => {
      if (rows.length >= 32) ilFail('PACKAGE_CAPACITY_EXCEEDED');
      const base = {
        id: randomUUID(),
        name: input.name,
        owner: who.actor,
        state: input.importing ? ('importing' as const) : ('active' as const),
        createdAt: new Date().toISOString(),
      };
      const row = { ...base, revision: ilHash(base) };
      rows.push(row);
      return row;
    });
  }
  async workspaces() {
    const who = await ilIdentity();
    return (await this.spaces.all()).filter((r) => r.owner === who.actor);
  }
  async assertWorkspace(raw: IntegrationScope & { expectedRevision?: string; allowImporting?: boolean }) {
    const input = ilScope
        .extend({ expectedRevision: z.string().optional(), allowImporting: z.boolean().optional() })
        .parse(raw),
      who = await ilIdentity();
    const workspace = (await this.spaces.all()).find(
      (r) => r.id === input.workspaceId && r.owner === who.actor,
    );
    if (!workspace) ilFail('WORKSPACE_FORBIDDEN', '工作空间不属于当前 owner', 403);
    if (workspace.state === 'archived' || (workspace.state === 'importing' && !input.allowImporting))
      ilFail('WORKSPACE_NOT_ACTIVE');
    if (input.expectedRevision && input.expectedRevision !== workspace.revision) ilFail('REVISION_CONFLICT');
    return { workspace, consumer: who.consumer, requestId: who.requestId };
  }
  async publishWorkspace(scope: IntegrationScope, expectedRevision: string) {
    await this.assertWorkspace({ ...scope, expectedRevision, allowImporting: true });
    return this.spaces.change((rows) => {
      const row = rows.find((r) => r.id === scope.workspaceId)!;
      if (row.revision !== expectedRevision) ilFail('REVISION_CONFLICT');
      row.state = 'active';
      row.revision = ilHash({ ...row, revision: undefined });
      return row;
    });
  }
  async reserveCapacity(
    scope: IntegrationScope,
    raw: { objects: number; revisions: number; bytes: number; metadataBytes: number; controlBytes: number },
  ) {
    const input = capacitySchema
        .pick({ objects: true, revisions: true, bytes: true, metadataBytes: true, controlBytes: true })
        .parse(raw),
      who = await this.assertWorkspace({ ...scope, allowImporting: true });
    return this.capacity.change((rows) => {
      const active = rows.filter((r) => r.state !== 'released');
      const sums = (key: keyof typeof input) => active.reduce((n, r) => n + r[key], 0) + input[key];
      if (
        sums('objects') > 10000 ||
        sums('revisions') > 50000 ||
        sums('bytes') > 32 * 1024 ** 3 ||
        // 为账本、引用索引和原子元数据头保留 32 MiB，不挤占控制记录空间。
        // Reserve index overhead separately from cancellation/control capacity.
        sums('metadataBytes') > 224 * 1024 ** 2 ||
        sums('controlBytes') > 32 * 1024 ** 2
      )
        ilFail('PACKAGE_CAPACITY_EXCEEDED');
      const row: IntegrationCapacity = {
        ...input,
        token: randomUUID(),
        workspaceId: scope.workspaceId,
        consumer: who.consumer,
        state: 'reserved',
      };
      rows.push(row);
      return row;
    });
  }
  private async capacityState(scope: IntegrationScope, token: string, state: 'committed' | 'released') {
    const who = await this.assertWorkspace({ ...scope, allowImporting: true });
    return this.capacity.change((rows) => {
      const row = rows.find(
        (r) => r.token === token && r.workspaceId === scope.workspaceId && r.consumer === who.consumer,
      );
      if (!row) ilFail('CAPACITY_RECEIPT_MISMATCH');
      if (row.state === 'released' && state !== 'released') ilFail('CAPACITY_RELEASED');
      row.state = state;
      return row;
    });
  }
  async commitCapacity(
    scope: IntegrationScope,
    token: string,
    actual?: {
      objects: number;
      revisions: number;
      bytes: number;
      metadataBytes: number;
      controlBytes: number;
    },
  ) {
    if (!actual) return this.capacityState(scope, token, 'committed');
    const input = capacitySchema
      .pick({ objects: true, revisions: true, bytes: true, metadataBytes: true, controlBytes: true })
      .parse(actual);
    const who = await this.assertWorkspace({ ...scope, allowImporting: true });
    return this.capacity.change((rows) => {
      const row = rows.find(
        (r) => r.token === token && r.workspaceId === scope.workspaceId && r.consumer === who.consumer,
      );
      if (!row || row.state === 'released') ilFail('CAPACITY_RECEIPT_MISMATCH');
      for (const key of Object.keys(input) as (keyof typeof input)[])
        if (input[key] > row[key]) ilFail('CAPACITY_RESERVATION_EXCEEDED');
      Object.assign(row, input, { state: 'committed' });
      return row;
    });
  }
  async releaseCapacity(scope: IntegrationScope, token: string) {
    return this.capacityState(scope, token, 'released');
  }
  async reference(scope: IntegrationScope, ref: IntegrationRef, owner: string, release = false) {
    ilRef.parse(ref);
    ilName.parse(owner);
    const who = await this.assertWorkspace({ ...scope, allowImporting: true });
    await this.refs.change((rows) => {
      const ix = rows.findIndex(
        (r) =>
          r.workspaceId === scope.workspaceId &&
          r.ref.id === ref.id &&
          r.ref.revision === ref.revision &&
          r.owner === owner &&
          r.consumer === who.consumer,
      );
      if (release) {
        if (ix >= 0) rows.splice(ix, 1);
      } else if (ix < 0) {
        if (rows.length >= 50000) ilFail('PACKAGE_CAPACITY_EXCEEDED');
        rows.push({ workspaceId: scope.workspaceId, ref, owner, consumer: who.consumer });
      }
    });
  }
  async references(scope: IntegrationScope, ref: IntegrationRef) {
    await this.assertWorkspace({ ...scope, allowImporting: true });
    return (await this.refs.all())
      .filter(
        (r) => r.workspaceId === scope.workspaceId && r.ref.id === ref.id && r.ref.revision === ref.revision,
      )
      .map((r) => r.owner);
  }
  async compare(scope: IntegrationScope, before: IntegrationRef, after: IntegrationRef) {
    const a = await this.get(scope, before),
      b = await this.get(scope, after);
    const row = comparisonSchema.parse({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      before,
      after,
      direction: 'old-client-new-service',
      rulesVersion: 1,
      items: compareContracts(a.content, b.content),
    });
    const size = ilBytes(row);
    const cap = await this.reserveCapacity(scope, {
      objects: 1,
      revisions: 1,
      bytes: size * 2,
      metadataBytes: size,
      controlBytes: 0,
    });
    await this.differences.change((rows) => rows.push(row));
    await this.commitCapacity(scope, cap.token);
    return row;
  }
  async comparisons(scope: IntegrationScope) {
    await this.assertWorkspace(scope);
    return (await this.differences.all()).filter((r) => r.workspaceId === scope.workspaceId);
  }
  override async close() {
    await Promise.all([
      super.close(),
      this.spaces.close(),
      this.capacity.close(),
      this.refs.close(),
      this.differences.close(),
    ]);
  }
}
