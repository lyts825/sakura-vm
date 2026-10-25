/** 数据库声明、原执行回执与固定恢复基线分别由所属领域保存。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as D from '../shared/contracts/database-evolution.ts';
import * as E from '../shared/contracts/suite-execution.ts';
import type * as Ports from './service-contracts/database-evolution.ts';
import type { DatabaseRehearsalV1 } from './service-contracts/suite-execution.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import {
  SuiteStore,
  suiteActor,
  suiteBinding,
  suiteHash,
  suiteSha,
  suiteCanonical,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { readSuiteText } from './suite-compute.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { resourceContext } from './host-runtime/context.ts';
import {
  validateDatabaseDataset,
  validateDatabaseSchema,
  compileDatabaseProgram,
  generateDatabaseDataset,
  databaseTemplateOperations,
  parseDatabaseCsv,
} from './suite-database-analysis.ts';
const scope = (value: S.SuiteScope) => ({ workspaceId: value.workspaceId });
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const json = (value: unknown) => S.suiteJson.parse(value);
const native = (row: S.SuiteRecord) => {
  if (row.origin !== 'local' || row.state !== 'sealed')
    suiteFail('DATABASE_LOCAL_REQUIRED', '先在本机明确审阅输入并创建执行对象');
  return row;
};
const same = (a: S.SuiteRef, b: S.SuiteRef) => suiteHash(a) === suiteHash(b);
async function capturedBaseline(
  fixture: z.infer<typeof D.databaseFixture>,
  get: (reference: S.SuiteRef) => Promise<S.SuiteRecord>,
) {
  let current = fixture;
  for (let depth = 0; depth < 16; depth++) {
    if (current.result?.baseline) return current.result.baseline;
    if (!current.parentFixture) return null;
    current = D.databaseFixture.parse(native(await get(current.parentFixture)).content);
  }
  suiteFail('DATABASE_BASELINE_DEPTH');
}
const originalConsumer = (names: string[]) => {
  const who = resourceContext()?.serviceConsumerPluginInstanceId;
  if (
    !who ||
    !names.some((name) => who === `official:database-${name}` || who.startsWith(`official:database-${name}:`))
  )
    suiteFail('DATABASE_INTERNAL_CONSUMER', '此方法只允许原数据库领域消费者调用', 403);
};

export class DatabaseSources extends SuiteMaterials implements Ports.DatabaseSourcesV1 {
  constructor(meta: PluginMetadata, uploads: PluginMetadata, auth: SuiteAuthorize) {
    super('database-sources', meta, uploads, auth, 64 * 1024 ** 3, 8 * 1024 ** 2, ['json', 'csv']);
  }
  async upload(raw: z.input<typeof D.databaseUpload>) {
    const p = D.databaseUpload.parse(raw),
      bytes = Buffer.from(p.text);
    const upload = await this.beginUpload({
      ...scope(p),
      name: p.name,
      format: p.format,
      bytes: bytes.length,
      digest: suiteSha(bytes),
      allowExport: p.allowExport,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.appendUpload({
        ...scope(p),
        id: upload.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...scope(p), id: upload.id });
  }
  async pin(raw: z.infer<typeof D.databasePin>) {
    const p = D.databasePin.parse(raw),
      row = await this.fixed(scope(p), p.source);
    if (row.domain !== this.domain || row.kind !== 'source') suiteFail('DATABASE_SOURCE_REQUIRED');
    const material = await readSuiteText(this, scope(p), p.source);
    if (material.format !== 'json') suiteFail('DATABASE_JSON_REQUIRED');
    const dataset = validateDatabaseDataset(parseSuiteJson(material.text, 8 * 1024 ** 2));
    return this.put(
      {
        ...scope(p),
        name: row.name + ' · 固定输入',
        references: [p.source],
        content: json({
          format: 'sakura-database-pinned/1',
          source: p.source,
          dataset,
          digest: suiteHash(dataset),
          reviewed: true,
          authorship: dataset.source === 'synthetic' ? 'synthetic' : 'human-reviewed',
        }),
      },
      'result',
      true,
    );
  }
  async generate(raw: z.input<typeof D.databaseGenerate>) {
    const p = D.databaseGenerate.parse(raw),
      data = generateDatabaseDataset(p.template, p.rows, p.seed),
      source = await this.upload({
        ...scope(p),
        name: p.template + ' · 合成数据',
        text: suiteCanonical(data),
        format: 'json',
        allowExport: false,
      });
    return this.pin({ ...scope(p), source: ref(source), reviewed: true });
  }
  async importRows(raw: z.input<typeof D.databaseImportRows>) {
    const p = D.databaseImportRows.parse(raw),
      row = await this.fixed(scope(p), p.source);
    if (row.domain !== this.domain || row.kind !== 'source') suiteFail('DATABASE_SOURCE_REQUIRED');
    const schema = validateDatabaseSchema(p.schema);
    if (schema.tables.length !== 1 || schema.tables[0].name !== p.table)
      suiteFail('DATABASE_CSV_SINGLE_TABLE');
    const material = await readSuiteText(this, scope(p), p.source);
    if (material.format !== 'csv') suiteFail('DATABASE_CSV_REQUIRED');
    const rows = parseDatabaseCsv(material.text),
      table = schema.tables[0];
    if (suiteHash(rows.shift()) !== suiteHash(table.columns.map((c) => c.name)))
      suiteFail('DATABASE_CSV_HEADER');
    const data = validateDatabaseDataset({
      format: 'sakura-database-dataset/1',
      schema,
      data: [
        {
          table: p.table,
          rows: rows.map((r) =>
            r.map((value, i) =>
              value === p.nullToken
                ? null
                : table.columns[i]?.type === 'boolean'
                  ? value === 'true'
                    ? true
                    : value === 'false'
                      ? false
                      : suiteFail('DATABASE_CSV_BOOLEAN')
                  : value,
            ),
          ),
        },
      ],
      source: 'reviewed-input',
      generatorSeed: null,
    });
    return this.put(
      {
        ...scope(p),
        name: row.name + ' · CSV 固定输入',
        references: [p.source],
        content: json({
          format: 'sakura-database-pinned/1',
          source: p.source,
          dataset: data,
          digest: suiteHash(data),
          reviewed: true,
          authorship: 'human-reviewed',
        }),
      },
      'result',
      true,
    );
  }
}
export class DatabaseSchemas extends SuiteStore implements Ports.DatabaseSchemasV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: Ports.DatabaseSourcesV1,
  ) {
    super('database-schemas', meta, auth, sources, { 'database-sources': sources });
  }
  async validate(raw: S.SuiteScope & { source: S.SuiteRef }) {
    const p = D.databaseSelect('source').parse(raw),
      row = await this.fixed(scope(p), p.source),
      input = D.databasePinned.parse(row.content),
      dataset = validateDatabaseDataset(input.dataset);
    if (suiteHash(dataset) !== input.digest) suiteFail('DATABASE_SOURCE_DIGEST');
    return this.put(
      {
        ...scope(p),
        name: row.name + ' · 结构',
        references: [p.source],
        content: json({
          format: 'sakura-database-validated/1',
          source: p.source,
          schema: dataset.schema,
          digest: suiteHash(dataset.schema),
          rows: dataset.data.reduce((n, t) => n + t.rows.length, 0),
          declaredOnly: true,
        }),
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof D.databaseCompare>) {
    const p = D.databaseCompare.parse(raw),
      a = D.databaseValidated.parse((await this.fixed(scope(p), p.before)).content),
      b = D.databaseValidated.parse((await this.fixed(scope(p), p.after)).content),
      before = new Map(a.schema.tables.map((t) => [t.name, t])),
      after = new Map(b.schema.tables.map((t) => [t.name, t]));
    return this.put(
      {
        ...scope(p),
        name: '固定数据库结构差异',
        references: [p.before, p.after],
        content: json({
          format: 'sakura-database-schema-diff/1',
          added: [...after.keys()].filter((n) => !before.has(n)),
          removed: [...before.keys()].filter((n) => !after.has(n)),
          changed: [...after.keys()].filter(
            (n) => before.has(n) && suiteHash(before.get(n)) !== suiteHash(after.get(n)),
          ),
          declaredOnly: true,
        }),
      },
      'result',
      true,
    );
  }
}
export class DatabaseChanges extends SuiteStore implements Ports.DatabaseChangesV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: Ports.DatabaseSourcesV1,
    schemas: Ports.DatabaseSchemasV1,
  ) {
    super('database-changes', meta, auth, sources, {
      'database-sources': sources,
      'database-schemas': schemas,
    });
  }
  async compile(raw: z.infer<typeof D.databaseCompile>) {
    const p = D.databaseCompile.parse(raw),
      row = native(await this.fixed(scope(p), p.schema)),
      schema = D.databaseValidated.parse(row.content),
      program = compileDatabaseProgram(schema.schema, p.schema, p.operations);
    return this.put(
      {
        ...scope(p),
        name: '固定变更 · ' + p.operations.length + ' 步',
        references: [p.schema],
        content: json(program),
      },
      'result',
      true,
    );
  }
  async riskSummary(raw: S.SuiteScope & { changes: S.SuiteRef }) {
    const p = D.databaseSelect('changes').parse(raw);
    return this.fixed(scope(p), p.changes);
  }
}

const fixturePlanInput = z
  .object({
    name: S.suiteName,
    source: S.suiteRef,
    changes: S.suiteRef.nullable(),
    parentFixture: S.suiteRef.nullable(),
    mode: z.enum(['baseline', 'rehearse', 'restore']),
    expectedBaselineDigest: S.suiteDigest.nullable(),
    executionPlan: E.suiteExecutionPlan,
  })
  .strict();
export class DatabaseFixtures extends SuiteStore implements Ports.DatabaseFixturesV1 {
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: Ports.DatabaseSourcesV1,
    private changes: Ports.DatabaseChangesV1,
    private tool: () => DatabaseRehearsalV1,
  ) {
    super('database-fixtures', meta, auth, sources, {
      'database-sources': sources,
      'database-changes': changes,
    });
  }
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.pending.set(key, next);
    void next
      .finally(() => {
        if (this.pending.get(key) === next) this.pending.delete(key);
      })
      .catch(() => {});
    return next;
  }
  private async latest(s: S.SuiteScope, reference: S.SuiteRef) {
    const fixed = native(await this.fixed(s, reference));
    if (fixed.domain !== this.domain) suiteFail('DATABASE_FIXTURE_REQUIRED');
    const rows = (await this.readState()).rows.filter(
      (r) => r.workspaceId === s.workspaceId && r.actor === suiteActor() && r.id === fixed.id,
    );
    const head = rows.reduce((a, b) => (a.sequence > b.sequence ? a : b), fixed);
    return native(await this.get(pin(s, ref(head))));
  }
  private async preview(
    s: S.SuiteScope,
    p: {
      name: string;
      source: S.SuiteRef;
      changes: S.SuiteRef | null;
      parentFixture: S.SuiteRef | null;
      mode: 'baseline' | 'rehearse' | 'restore';
      image: { assetId: string; digest: string };
      dataset: D.DatabaseDataset;
      operations: D.DatabaseOperation[];
      expectedBaselineDigest: string | null;
    },
  ) {
    const input = D.databaseWorkerInput.parse({
      format: 'sakura-database-worker/1',
      mode: p.mode === 'restore' ? 'restore' : 'rehearse',
      dataset: p.dataset,
      operations: p.operations,
      expectedBaselineDigest: p.expectedBaselineDigest,
      deadline: new Date(Date.now() + 900000).toISOString(),
      lockTimeoutMs: 2000,
      statementTimeoutMs: 10000,
    });
    const executionPlan = await this.tool().preview({
      ...s,
      image: p.image,
      input: json(input),
      inputDigest: suiteHash(input),
      maxSeconds: 600,
    });
    return this.plan(
      s,
      'database-' + p.mode,
      json({
        name: p.name,
        source: p.source,
        changes: p.changes,
        parentFixture: p.parentFixture,
        mode: p.mode,
        expectedBaselineDigest: p.expectedBaselineDigest,
        executionPlan,
      }),
      [p.source, ...(p.changes ? [p.changes] : []), ...(p.parentFixture ? [p.parentFixture] : [])],
    );
  }
  async prepare(raw: z.input<typeof D.databaseFixturePrepare>) {
    const p = D.databaseFixturePrepare.parse(raw),
      source = native(await this.fixed(scope(p), p.source)),
      pinned = D.databasePinned.parse(source.content);
    validateDatabaseDataset(pinned.dataset);
    return this.preview(scope(p), {
      name: p.name,
      source: p.source,
      changes: null,
      parentFixture: null,
      mode: 'baseline',
      image: p.image,
      dataset: pinned.dataset,
      operations: [],
      expectedBaselineDigest: null,
    });
  }
  async planExecution(raw: z.infer<typeof D.databaseRunPreview>) {
    originalConsumer(['runners']);
    const p = D.databaseRunPreview.parse(raw),
      row = await this.inspect({ ...scope(p), fixture: p.fixture }),
      fixture = D.databaseFixture.parse(row.content),
      program = D.databaseProgram.parse(native(await this.fixed(scope(p), p.changes)).content),
      baseline = fixture.result?.baseline;
    if (
      fixture.mode !== 'baseline' ||
      fixture.session?.state !== 'completed' ||
      fixture.result?.outcome !== 'passed' ||
      !baseline
    )
      suiteFail('DATABASE_BASELINE_NOT_READY');
    if (suiteHash(baseline.schema) !== program.baselineDigest) suiteFail('DATABASE_BASELINE_SCHEMA_CHANGED');
    if (program.risks.some((r) => r.destructive) && !p.confirmDestructive)
      suiteFail('DATABASE_DESTRUCTIVE_APPROVAL', '此计划包含数据删除或覆盖，须明确核对');
    compileDatabaseProgram(baseline.schema, program.baseline, program.operations);
    return this.preview(scope(p), {
      name: 'PostgreSQL 变更执行',
      source: fixture.source,
      changes: p.changes,
      parentFixture: ref(row),
      mode: 'rehearse',
      image: fixture.executionPlan.image,
      dataset: {
        format: 'sakura-database-dataset/1',
        schema: baseline.schema,
        data: baseline.data,
        source: 'captured-baseline',
        generatorSeed: null,
      },
      operations: program.operations,
      expectedBaselineDigest: baseline.digest,
    });
  }
  async planRestore(raw: S.SuiteScope & { fixture: S.SuiteRef; image: { assetId: string; digest: string } }) {
    originalConsumer(['runners']);
    const p = D.databaseSelect('fixture')
        .extend({ image: D.databaseFixturePrepare.shape.image })
        .strict()
        .parse(raw),
      row = await this.inspect({ ...scope(p), fixture: p.fixture }),
      fixture = D.databaseFixture.parse(row.content),
      baseline = await capturedBaseline(fixture, (r) => this.fixed(scope(p), r));
    if (!baseline)
      suiteFail('DATABASE_CAPTURED_BASELINE_REQUIRED', '原工具尚未保存完整基线，不能生成恢复证明');
    return this.preview(scope(p), {
      name: '独立基线恢复',
      source: fixture.source,
      changes: null,
      parentFixture: ref(row),
      mode: 'restore',
      image: p.image,
      dataset: {
        format: 'sakura-database-dataset/1',
        schema: baseline.schema,
        data: baseline.data,
        source: 'captured-baseline',
        generatorSeed: null,
      },
      operations: [],
      expectedBaselineDigest: baseline.digest,
    });
  }
  private async apply(raw: S.SuiteApproval, mode: 'baseline' | 'rehearse' | 'restore') {
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.consume(p, 'database-' + mode, true),
        s = scope(p);
      if (plan.result) return this.get(pin(s, plan.result));
      const prior = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === s.workspaceId &&
          r.actor === suiteActor() &&
          r.kind === 'result' &&
          D.databaseFixture.safeParse(r.content).success &&
          D.databaseFixture.parse(r.content).planId === plan.id,
      );
      if (prior) {
        await this.complete(plan, prior);
        return this.inspect({ ...s, fixture: ref(prior) });
      }
      const input = fixturePlanInput.parse(plan.input);
      let pending: S.SuiteRecord | undefined;
      const session = await this.tool().start(
        { ...s, planId: input.executionPlan.id, digest: input.executionPlan.digest },
        async (challenge) => {
          if (
            challenge.planId !== input.executionPlan.id ||
            challenge.digest !== input.executionPlan.digest ||
            challenge.inputDigest !== input.executionPlan.inputDigest
          )
            suiteFail('DATABASE_EXECUTION_CHANGED');
          const intentDigest = suiteHash({ plan: plan.id, challenge });
          pending = await this.put(
            {
              ...s,
              name: input.name,
              references: plan.references,
              content: json({
                format: 'sakura-database-fixture/1',
                planId: plan.id,
                source: input.source,
                changes: input.changes,
                parentFixture: input.parentFixture,
                mode: input.mode,
                executionPlan: input.executionPlan,
                sessionId: challenge.sessionId,
                session: null,
                result: null,
                localExecution: true,
                dispatchIntent: intentDigest,
              }),
            },
            'result',
            true,
          );
          return { intentDigest };
        },
        async () => {
          await this.access(s);
          for (const r of plan.references) await this.fixed(s, r);
        },
      );
      if (!pending) suiteFail('DATABASE_INTENT_REQUIRED');
      const content = D.databaseFixture.parse(pending.content);
      const record = await this.put(
        {
          ...s,
          id: pending.id,
          expectedRevision: pending.revision,
          name: pending.name,
          references: pending.references,
          content: json({ ...content, session: E.suiteExecutionReceipt.parse(session) }),
        },
        'result',
        true,
      );
      await this.complete(plan, record);
      return record;
    });
  }
  async discardPreview(raw: S.SuiteApproval) {
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.inspectPlan({ ...scope(p), planId: p.planId });
      if (
        plan.digest !== p.digest ||
        plan.binding !== suiteBinding() ||
        !['database-baseline', 'database-rehearse', 'database-restore'].includes(plan.action) ||
        !['ready', 'failed'].includes(plan.state)
      )
        suiteFail('DATABASE_PLAN_CHANGED');
      const input = fixturePlanInput.parse(plan.input);
      await this.tool().discardPreview({
        ...scope(p),
        planId: input.executionPlan.id,
        digest: input.executionPlan.digest,
      });
      return this.edit(
        (state) => {
          const value = state.plans.find((x) => x.id === plan.id)!;
          value.state = 'failed';
          return value;
        },
        true,
        scope(p),
      );
    });
  }
  async checkpoint(raw: S.SuiteApproval) {
    return this.apply(raw, 'baseline');
  }
  async submitExecution(raw: S.SuiteApproval) {
    originalConsumer(['runners']);
    return this.apply(raw, 'rehearse');
  }
  async submitRestore(raw: S.SuiteApproval) {
    originalConsumer(['runners']);
    return this.apply(raw, 'restore');
  }
  private async readOutput(s: S.SuiteScope, receipt: E.SuiteExecutionReceipt) {
    if (!receipt.output) return null;
    const parts: Buffer[] = [];
    let offset = 0;
    do {
      const chunk = await this.tool().output({
          ...s,
          id: receipt.id,
          offset,
          length: Math.max(1, Math.min(512 * 1024, receipt.output.bytes - offset)),
        }),
        bytes = Buffer.from(chunk.data, 'base64');
      if (
        chunk.offset !== offset + bytes.length ||
        chunk.total !== receipt.output.bytes ||
        chunk.digest !== receipt.output.digest ||
        (!bytes.length && !chunk.eof)
      )
        suiteFail('DATABASE_OUTPUT_PROTOCOL');
      parts.push(bytes);
      offset = chunk.offset;
      if (chunk.eof) break;
    } while (offset < receipt.output.bytes);
    const bytes = Buffer.concat(parts);
    if (bytes.length !== receipt.output.bytes || suiteSha(bytes) !== receipt.output.digest)
      suiteFail('DATABASE_OUTPUT_DIGEST');
    return D.databaseWorkerResult.parse(
      parseSuiteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 8 * 1024 ** 2),
    );
  }
  async inspect(raw: S.SuiteScope & { fixture: S.SuiteRef }) {
    const p = D.databaseSelect('fixture').parse(raw);
    return this.serial(p.fixture.id, async () => {
      const row = await this.latest(scope(p), p.fixture),
        value = D.databaseFixture.parse(row.content),
        session = E.suiteExecutionReceipt.parse(
          await this.tool().inspect({ ...scope(p), id: value.sessionId }),
        ),
        result =
          session.output && session.cleanup === 'confirmed'
            ? await this.readOutput(scope(p), session)
            : value.result;
      for (const r of row.references) await this.fixed(scope(p), r);
      if (suiteHash(session) === suiteHash(value.session) && suiteHash(result) === suiteHash(value.result))
        return row;
      return this.put(
        {
          ...scope(p),
          id: row.id,
          expectedRevision: row.revision,
          name: row.name,
          references: row.references,
          content: json({ ...value, session, result }),
        },
        'result',
        true,
      );
    });
  }
  async stopExecution(raw: S.SuiteScope & { fixture: S.SuiteRef }) {
    const p = D.databaseSelect('fixture').parse(raw),
      row = await this.latest(scope(p), p.fixture),
      value = D.databaseFixture.parse(row.content);
    await this.tool().cancel({ ...scope(p), id: value.sessionId });
    return this.inspect(p);
  }
  async cancel(raw: S.SuiteScope & { fixture: S.SuiteRef }) {
    return this.stopExecution(raw);
  }
  async cleanupPreview(raw: S.SuiteScope & { fixture: S.SuiteRef }) {
    const p = D.databaseSelect('fixture').parse(raw),
      row = await this.inspect(p),
      value = D.databaseFixture.parse(row.content);
    return this.plan(
      scope(p),
      'database-fixture-cleanup',
      json({ fixture: ref(row), sessionId: value.sessionId, originalVm: value.session?.vm ?? null }),
      [ref(row)],
    );
  }
  override async cleanup(raw: S.SuiteApproval) {
    const input = S.suiteApproval.parse(raw),
      found = await this.inspectPlan({ ...scope(input), planId: input.planId });
    if (found.action !== 'database-fixture-cleanup') return super.cleanup(input);
    const plan = await this.consume(input, 'database-fixture-cleanup', true);
    if (plan.result) return this.get(pin(scope(input), plan.result));
    const data = z
      .object({ fixture: S.suiteRef, sessionId: S.suiteId, originalVm: S.suiteJson })
      .strict()
      .parse(plan.input);
    const row = await this.latest(scope(input), data.fixture),
      value = D.databaseFixture.parse(row.content);
    if (value.sessionId !== data.sessionId) suiteFail('DATABASE_SESSION_CHANGED');
    const session = await this.tool().reconcile({ ...scope(input), id: data.sessionId });
    const saved = await this.put(
      {
        ...scope(input),
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        references: row.references,
        content: json({ ...value, session }),
      },
      'result',
      true,
    );
    await this.complete(plan, saved);
    return saved;
  }
  protected override async releaseOwned(s: S.SuiteScope, row: S.SuiteRecord) {
    const parsed = D.databaseFixture.safeParse(row.content);
    if (parsed.success) {
      const session = await this.tool().inspect({ ...s, id: parsed.data.sessionId });
      if (session.cleanup !== 'confirmed')
        suiteFail('DATABASE_RESOURCE_RETAINED', '原副本仍待核销，保留记录与来源引用');
      const remaining = (await this.readState()).rows.filter(
        (x) => x.workspaceId === s.workspaceId && x.id === row.id && x.revision !== row.revision,
      );
      if (!remaining.length) await this.tool().release({ ...s, id: parsed.data.sessionId });
    }
  }
  override async close() {
    await Promise.allSettled([...this.pending.values()]);
    await super.close();
  }
}

class DatabaseLiveStore extends SuiteStore {
  private observations = new Map<string, Promise<unknown>>();
  protected serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.observations.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.observations.set(key, next);
    void next
      .finally(() => {
        if (this.observations.get(key) === next) this.observations.delete(key);
      })
      .catch(() => {});
    return next;
  }
  protected async discard(
    raw: S.SuiteApproval,
    actions: string[],
    work: (plan: S.SuitePlan) => Promise<unknown>,
  ) {
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.inspectPlan({ ...scope(p), planId: p.planId });
      if (
        plan.digest !== p.digest ||
        plan.binding !== suiteBinding() ||
        !actions.includes(plan.action) ||
        !['ready', 'failed'].includes(plan.state)
      )
        suiteFail('DATABASE_PLAN_CHANGED');
      await work(plan);
      return this.edit(
        (state) => {
          const value = state.plans.find((x) => x.id === plan.id)!;
          value.state = 'failed';
          return value;
        },
        true,
        scope(p),
      );
    });
  }
  protected async latest(s: S.SuiteScope, reference: S.SuiteRef) {
    const fixed = native(await this.fixed(s, reference));
    if (fixed.domain !== this.domain) suiteFail('DATABASE_DOMAIN');
    const rows = (await this.readState()).rows.filter(
        (r) => r.workspaceId === s.workspaceId && r.actor === suiteActor() && r.id === fixed.id,
      ),
      head = rows.reduce((a, b) => (a.sequence > b.sequence ? a : b), fixed);
    return native(await this.get(pin(s, ref(head))));
  }
  override async close() {
    await Promise.allSettled([...this.observations.values()]);
    await super.close();
  }
}

const runPlan = z
  .object({
    fixturePlan: S.suitePlan,
    changes: S.suiteRef.nullable(),
    restores: S.suiteRef.nullable(),
    mode: z.enum(['rehearse', 'restore']),
  })
  .strict();
export class DatabaseRunners extends DatabaseLiveStore implements Ports.DatabaseRunnersV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: Ports.DatabaseSourcesV1,
    private fixtures: Ports.DatabaseFixturesV1,
    changes: Ports.DatabaseChangesV1,
  ) {
    super('database-runners', meta, auth, sources, {
      'database-sources': sources,
      'database-fixtures': fixtures,
      'database-changes': changes,
    });
  }
  async discardPreview(raw: S.SuiteApproval) {
    return this.discard(raw, ['database-run', 'database-restore'], async (plan) => {
      const v = runPlan.parse(plan.input);
      await this.fixtures.discardPreview({
        ...scope(raw),
        planId: v.fixturePlan.id,
        digest: v.fixturePlan.digest,
      });
    });
  }
  async preview(raw: z.infer<typeof D.databaseRunPreview>) {
    const p = D.databaseRunPreview.parse(raw),
      plan = await this.fixtures.planExecution(p);
    return this.plan(
      scope(p),
      'database-run',
      json({ fixturePlan: plan, changes: p.changes, restores: null, mode: 'rehearse' }),
      [p.fixture, p.changes],
    );
  }
  private apply(raw: S.SuiteApproval, action: string) {
    return this.serial('plan:' + raw.planId, () => this.applyOnce(raw, action));
  }
  private async applyOnce(raw: S.SuiteApproval, action: string) {
    const plan = await this.consume(raw, action, true),
      s = scope(raw);
    if (plan.result) return this.get(pin(s, plan.result));
    const input = runPlan.parse(plan.input),
      fixture = await (input.mode === 'restore'
        ? this.fixtures.submitRestore({
            ...s,
            planId: input.fixturePlan.id,
            digest: input.fixturePlan.digest,
          })
        : this.fixtures.submitExecution({
            ...s,
            planId: input.fixturePlan.id,
            digest: input.fixturePlan.digest,
          }));
    const prior = (await this.readState()).rows.find(
      (r) =>
        r.workspaceId === s.workspaceId &&
        r.actor === suiteActor() &&
        D.databaseRun.safeParse(r.content).success &&
        D.databaseRun.parse(r.content).fixture.id === fixture.id,
    );
    if (prior) {
      await this.complete(plan, prior);
      return prior;
    }
    const row = await this.put(
      {
        ...s,
        name: input.mode === 'restore' ? '固定基线独立恢复' : '数据库变更运行',
        references: [
          ref(fixture),
          ...(input.changes ? [input.changes] : []),
          ...(input.restores ? [input.restores] : []),
        ],
        content: json({
          format: 'sakura-database-run/1',
          fixture: ref(fixture),
          changes: input.changes,
          mode: input.mode,
          restores: input.restores,
        }),
      },
      'result',
      true,
    );
    await this.complete(plan, row);
    return row;
  }
  async execute(raw: S.SuiteApproval) {
    return this.apply(raw, 'database-run');
  }
  async inspect(raw: z.infer<typeof D.databaseRunAction>) {
    const p = D.databaseRunAction.parse(raw);
    return this.serial(p.run.id, async () => {
      const row = await this.latest(scope(p), p.run),
        value = D.databaseRun.parse(row.content),
        fixture = await this.fixtures.inspect({ ...scope(p), fixture: value.fixture });
      if (same(value.fixture, ref(fixture))) return row;
      return this.put(
        {
          ...scope(p),
          id: row.id,
          expectedRevision: row.revision,
          name: row.name,
          references: [
            ref(fixture),
            ...(value.changes ? [value.changes] : []),
            ...(value.restores ? [value.restores] : []),
          ],
          content: json({ ...value, fixture: ref(fixture) }),
        },
        'result',
        true,
      );
    });
  }
  async cancel(raw: z.infer<typeof D.databaseRunAction>) {
    const p = D.databaseRunAction.parse(raw),
      row = native(await this.fixed(scope(p), p.run)),
      value = D.databaseRun.parse(row.content);
    await this.fixtures.stopExecution({ ...scope(p), fixture: value.fixture });
    return this.inspect(p);
  }
  async reconcile(raw: z.infer<typeof D.databaseRunAction>) {
    const p = D.databaseRunAction.parse(raw),
      row = native(await this.fixed(scope(p), p.run)),
      value = D.databaseRun.parse(row.content),
      cleanup = await this.fixtures.cleanupPreview({ ...scope(p), fixture: value.fixture });
    return this.plan(scope(p), 'database-run-cleanup', json({ run: p.run, cleanup }), [p.run]);
  }
  async confirmReconcile(raw: S.SuiteApproval) {
    const plan = await this.consume(raw, 'database-run-cleanup', true),
      s = scope(raw);
    if (plan.result) return this.get(pin(s, plan.result));
    const p = z.object({ run: S.suiteRef, cleanup: S.suitePlan }).strict().parse(plan.input);
    await this.fixtures.cleanup({ ...s, planId: p.cleanup.id, digest: p.cleanup.digest });
    const row = await this.inspect({ ...s, run: p.run });
    await this.complete(plan, row);
    return row;
  }
  async previewRestore(raw: z.infer<typeof D.databaseRecovery>) {
    const p = D.databaseRecovery.parse(raw),
      row = native(await this.fixed(scope(p), p.run)),
      value = D.databaseRun.parse(row.content),
      plan = await this.fixtures.planRestore({ ...scope(p), fixture: value.fixture, image: p.image });
    return this.plan(
      scope(p),
      'database-restore',
      json({ fixturePlan: plan, changes: null, restores: p.run, mode: 'restore' }),
      [p.run],
    );
  }
  async restore(raw: S.SuiteApproval) {
    return this.apply(raw, 'database-restore');
  }
}

export class DatabaseChecks extends SuiteStore implements Ports.DatabaseChecksV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: Ports.DatabaseSourcesV1,
    private runners: Ports.DatabaseRunnersV1,
    private fixtures: Ports.DatabaseFixturesV1,
    private changes: Ports.DatabaseChangesV1,
  ) {
    super('database-checks', meta, auth, sources, {
      'database-sources': sources,
      'database-runners': runners,
      'database-fixtures': fixtures,
      'database-changes': changes,
    });
  }
  async evaluate(raw: z.infer<typeof D.databaseRunAction>) {
    const p = D.databaseRunAction.parse(raw),
      run = await this.runners.inspect(p),
      rv = D.databaseRun.parse(run.content),
      fixture = await this.fixtures.inspect({ ...scope(p), fixture: rv.fixture }),
      value = D.databaseFixture.parse(fixture.content),
      result = value.result,
      baseline = await capturedBaseline(value, (r) => this.fixed(scope(p), r)),
      findings: string[] = [];
    if (!result) findings.push('工具尚未提交完整结果，不能据此认定写入完成。');
    if (value.session?.cleanup !== 'confirmed') findings.push('原 VM 和工具仍待核销。');
    const observed = result?.steps.filter((x) => x.state === 'observed').length ?? 0,
      failed = result?.steps.filter((x) => x.state === 'failed').length ?? 0,
      unknown = result?.steps.filter((x) => x.state === 'unknown').length ?? 0;
    if (result?.error) findings.push(result.error);
    if (result?.recovery && !result.recovery.confirmed) findings.push('恢复后的完整行集合与原基线不同。');
    const total = rv.changes
      ? D.databaseProgram.parse((await this.fixed(scope(p), rv.changes)).content).operations.length
      : 0;
    if (observed + failed + unknown < total)
      findings.push(`${total - observed - failed - unknown} 条操作没有执行完成记录；不会自动重放。`);
    if (result?.outcome === 'passed' && (observed !== total || failed || unknown))
      suiteFail('DATABASE_RESULT_COVERAGE');
    const assessment = D.databaseCheck.parse({
      format: 'sakura-database-check/1',
      run: ref(run),
      fixture: ref(fixture),
      outcome:
        result && value.session?.state === 'completed'
          ? result.outcome
          : result?.outcome === 'failed'
            ? 'failed'
            : 'inconclusive',
      cleanup: value.session?.cleanup ?? 'unknown',
      coverage: 'complete-selected-data',
      baselineDigest: baseline?.digest ?? null,
      afterDigest: result?.after?.digest ?? null,
      totalSteps: total,
      observedSteps: observed,
      failedSteps: failed,
      unknownSteps: unknown,
      findings,
      recovery: result?.recovery ?? null,
      sourceClaimOnly: false,
    });
    const existing = (await this.readState()).rows.find(
      (r) =>
        r.workspaceId === p.workspaceId &&
        r.actor === suiteActor() &&
        suiteHash(r.content) === suiteHash(assessment) &&
        r.state === 'sealed',
    );
    if (existing) return this.get(pin(scope(p), ref(existing)));
    return this.put(
      {
        ...scope(p),
        name: '完整数据与原执行检查',
        references: [ref(run), ref(fixture)],
        content: json(assessment),
      },
      'result',
      true,
    );
  }
  async explain(raw: S.SuiteScope & { check: S.SuiteRef }) {
    const p = D.databaseSelect('check').parse(raw);
    return this.fixed(scope(p), p.check);
  }
}
export class DatabaseRehearsals extends DatabaseLiveStore implements Ports.DatabaseRehearsalsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: Ports.DatabaseSourcesV1,
    private runners: Ports.DatabaseRunnersV1,
    private checks: Ports.DatabaseChecksV1,
    fixtures: Ports.DatabaseFixturesV1,
    changes: Ports.DatabaseChangesV1,
  ) {
    super('database-rehearsals', meta, auth, sources, {
      'database-sources': sources,
      'database-runners': runners,
      'database-checks': checks,
      'database-fixtures': fixtures,
      'database-changes': changes,
    });
  }
  async discardPreview(raw: S.SuiteApproval) {
    return this.discard(raw, ['database-rehearsal', 'database-rehearsal-restore'], async (plan) => {
      const v = plan.input as Record<string, unknown>,
        execution = S.suitePlan.parse(v.execution ?? v.recovery);
      await this.runners.discardPreview({ ...scope(raw), planId: execution.id, digest: execution.digest });
    });
  }
  async preview(raw: z.infer<typeof D.databaseRunPreview>) {
    const p = D.databaseRunPreview.parse(raw),
      execution = await this.runners.preview(p);
    return this.plan(scope(p), 'database-rehearsal', json({ execution }), [p.fixture, p.changes]);
  }
  async start(raw: S.SuiteApproval) {
    return this.serial('plan:' + raw.planId, () => this.startOnce(raw));
  }
  private async startOnce(raw: S.SuiteApproval) {
    const plan = await this.consume(raw, 'database-rehearsal', true),
      s = scope(raw);
    if (plan.result) return this.get(pin(s, plan.result));
    const input = z.object({ execution: S.suitePlan }).strict().parse(plan.input),
      run = await this.runners.execute({ ...s, planId: input.execution.id, digest: input.execution.digest }),
      prior = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === s.workspaceId &&
          r.actor === suiteActor() &&
          D.databaseRehearsal.safeParse(r.content).success &&
          D.databaseRehearsal.parse(r.content).run.id === run.id &&
          D.databaseRehearsal.parse(r.content).recovery === null,
      );
    if (prior) {
      await this.complete(plan, prior);
      return prior;
    }
    const row = await this.put(
      {
        ...s,
        name: '数据库变更与恢复演练',
        references: [ref(run)],
        content: json({
          format: 'sakura-database-rehearsal/1',
          run: ref(run),
          recovery: null,
          check: null,
          stage: 'running',
          intentOnly: false,
        }),
      },
      'result',
      true,
    );
    await this.complete(plan, row);
    return row;
  }
  async inspect(raw: S.SuiteScope & { rehearsal: S.SuiteRef }) {
    const p = D.databaseSelect('rehearsal').parse(raw);
    return this.serial(p.rehearsal.id, async () => {
      const row = await this.latest(scope(p), p.rehearsal),
        value = D.databaseRehearsal.parse(row.content),
        run = await this.runners.inspect({ ...scope(p), run: value.recovery ?? value.run }),
        check = await this.checks.evaluate({ ...scope(p), run: ref(run) }),
        content = json({
          ...value,
          ...(value.recovery ? { recovery: ref(run) } : { run: ref(run) }),
          check: ref(check),
          stage: 'review',
        });
      if (suiteHash(content) === suiteHash(row.content)) return row;
      return this.put(
        {
          ...scope(p),
          id: row.id,
          expectedRevision: row.revision,
          name: row.name,
          references: [...(value.recovery ? [value.run, ref(run)] : [ref(run)]), ref(check)],
          content,
        },
        'result',
        true,
      );
    });
  }
  async cancel(raw: S.SuiteScope & { rehearsal: S.SuiteRef }) {
    const p = D.databaseSelect('rehearsal').parse(raw),
      value = D.databaseRehearsal.parse(native(await this.fixed(scope(p), p.rehearsal)).content);
    await this.runners.cancel({ ...scope(p), run: value.recovery ?? value.run });
    return this.inspect(p);
  }
  async recover(raw: S.SuiteScope & { rehearsal: S.SuiteRef; image: { assetId: string; digest: string } }) {
    const p = D.databaseSelect('rehearsal')
        .extend({ image: D.databaseFixturePrepare.shape.image })
        .strict()
        .parse(raw),
      value = D.databaseRehearsal.parse(native(await this.fixed(scope(p), p.rehearsal)).content),
      recovery = await this.runners.previewRestore({ ...scope(p), run: value.run, image: p.image });
    return this.plan(scope(p), 'database-rehearsal-restore', json({ rehearsal: p.rehearsal, recovery }), [
      p.rehearsal,
    ]);
  }
  async confirmRecovery(raw: S.SuiteApproval) {
    return this.serial('plan:' + raw.planId, () => this.confirmRecoveryOnce(raw));
  }
  private async confirmRecoveryOnce(raw: S.SuiteApproval) {
    const plan = await this.consume(raw, 'database-rehearsal-restore', true),
      s = scope(raw);
    if (plan.result) return this.get(pin(s, plan.result));
    const p = z.object({ rehearsal: S.suiteRef, recovery: S.suitePlan }).strict().parse(plan.input),
      source = await this.fixed(s, p.rehearsal),
      value = D.databaseRehearsal.parse(source.content),
      run = await this.runners.restore({ ...s, planId: p.recovery.id, digest: p.recovery.digest }),
      row = await this.put(
        {
          ...s,
          name: source.name + ' · 独立恢复',
          references: [p.rehearsal, value.run, ref(run)],
          content: json({ ...value, recovery: ref(run), check: null, stage: 'recovering' }),
        },
        'result',
        true,
      );
    await this.complete(plan, row);
    return row;
  }
}
export class DatabaseReports extends SuiteStore implements Ports.DatabaseReportsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: Ports.DatabaseSourcesV1,
    private runners: Ports.DatabaseRunnersV1,
    private checks: Ports.DatabaseChecksV1,
    rehearsals: Ports.DatabaseRehearsalsV1,
  ) {
    super('database-reports', meta, auth, sources, {
      'database-sources': sources,
      'database-runners': runners,
      'database-checks': checks,
      'database-rehearsals': rehearsals,
    });
  }
  async sealReport(raw: z.infer<typeof D.databaseReportInput>) {
    const p = D.databaseReportInput.parse(raw),
      check = native(await this.fixed(scope(p), p.checks)),
      assessment = D.databaseCheck.parse(check.content);
    if (!same(assessment.run, p.run)) suiteFail('DATABASE_REPORT_WINDOW');
    if (assessment.cleanup !== 'confirmed')
      suiteFail('DATABASE_CLEANUP_REQUIRED', '先核销原副本，再封存最终报告');
    const fresh = await this.checks.evaluate({ ...scope(p), run: p.run }),
      current = D.databaseCheck.parse(fresh.content);
    if (
      !same(current.run, p.run) ||
      current.cleanup !== 'confirmed' ||
      current.baselineDigest !== assessment.baselineDigest ||
      current.afterDigest !== assessment.afterDigest ||
      current.outcome !== assessment.outcome
    )
      suiteFail('DATABASE_REPORT_CHANGED');
    if (p.recovery) {
      const recovery = D.databaseCheck.parse(
        (await this.checks.evaluate({ ...scope(p), run: p.recovery })).content,
      );
      if (
        recovery.cleanup !== 'confirmed' ||
        !recovery.recovery?.confirmed ||
        recovery.recovery.expectedDigest !== assessment.baselineDigest
      )
        suiteFail('DATABASE_RECOVERY_UNCONFIRMED');
    }
    return this.put(
      {
        ...scope(p),
        name: '固定数据库演练报告',
        references: [p.run, p.checks, ...(p.recovery ? [p.recovery] : [])],
        content: json({
          format: 'sakura-database-report/1',
          run: p.run,
          check: p.checks,
          recovery: p.recovery,
          summary: p.summary,
          unresolved: p.unresolved,
          assessment,
          sealedBy: suiteActor(),
          sourceTrust: 'local-original-provider',
          restoreKind: 'canonical-logical-baseline',
          notProductionApproval: true,
        }),
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof D.databaseCompare>) {
    const p = D.databaseCompare.parse(raw),
      a = D.databaseReport.parse((await this.fixed(scope(p), p.before)).content),
      b = D.databaseReport.parse((await this.fixed(scope(p), p.after)).content);
    return this.put(
      {
        ...scope(p),
        name: '固定演练报告比较',
        references: [p.before, p.after],
        content: json({
          format: 'sakura-database-report-diff/1',
          sameBaseline: a.assessment.baselineDigest === b.assessment.baselineDigest,
          before: a.assessment.outcome,
          after: b.assessment.outcome,
          sameResult: a.assessment.afterDigest === b.assessment.afterDigest,
          productionApproval: false,
        }),
      },
      'result',
      true,
    );
  }
}
export class DatabaseWorkbench extends SuiteStore implements Ports.DatabaseWorkbenchV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: Ports.DatabaseSourcesV1,
    private domains: Record<string, S.SuiteRecordsV1>,
  ) {
    super(
      'database-workbench',
      meta,
      auth,
      sources,
      Object.fromEntries(Object.entries(domains).map(([k, v]) => ['database-' + k, v])),
    );
  }
  async templates() {
    await this.access();
    return D.databaseWorkbenchTemplates.parse(
      [
        {
          id: 'add-column-backfill',
          name: '新增字段与回填',
          description: '新增可空列、固定表达式回填，再添加非空约束。',
        },
        {
          id: 'unique-conflict',
          name: '唯一约束冲突',
          description: '用明确的重复合成值观察约束拒绝与停止后续写入。',
        },
        {
          id: 'independent-recovery',
          name: '失败后的独立恢复',
          description: '精度丢失会拒绝转换；从原工具读回基线恢复到新副本。',
        },
      ].map((t) => ({
        ...t,
        operations: databaseTemplateOperations(t.id),
        suggestedOnly: true,
        automaticExecution: false,
      })),
    );
  }
  async view(raw: z.input<typeof D.databaseWorkbenchRequest>) {
    const p = D.databaseWorkbenchRequest.parse(raw),
      workspaces = await this.sources.listWorkspaces();
    if (!p.workspaceId) return { workspaces, workspace: null, domains: [], capacity: null };
    const s = { workspaceId: p.workspaceId },
      workspace = await this.sources.workspace(s),
      domains: z.infer<typeof D.databaseWorkbenchView>['domains'] = [];
    for (const [id, port] of Object.entries(this.domains)) {
      const page = await port.list({
        ...s,
        cursor: p.cursor,
        limit: p.limit,
        history: false,
        archived: false,
      });
      domains.push({
        id,
        records: page.items.map((row) => {
          const f = D.databaseFixture.safeParse(row.content),
            c = D.databaseCheck.safeParse(row.content);
          return {
            reference: ref(row),
            name: row.name,
            state: row.state,
            kind: row.kind,
            origin: row.origin,
            summary: json(
              f.success
                ? {
                    mode: f.data.mode,
                    state: f.data.session?.state ?? 'preparing',
                    outcome: f.data.session?.outcome ?? 'inconclusive',
                    cleanup: f.data.session?.cleanup ?? 'unknown',
                  }
                : c.success
                  ? { outcome: c.data.outcome, cleanup: c.data.cleanup, observedSteps: c.data.observedSteps }
                  : null,
            ),
          };
        }),
        next: page.next,
      });
    }
    await this.sources.workspace(s);
    return D.databaseWorkbenchView.parse({
      workspaces,
      workspace,
      domains,
      capacity: await this.sources.capacity(s),
    });
  }
}
