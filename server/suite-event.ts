/** 固定事件声明与独立领域账本；实际进程只能通过 EventSessionsV1 创建。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as E from '../shared/contracts/event-lab.ts';
import {
  eventWorkerInput,
  eventWorkerOutput,
  eventExecutionBudget,
} from '../shared/contracts/suite-execution-event.ts';
import { suiteExecutionPlan, type SuiteExecutionReceipt } from '../shared/contracts/suite-execution.ts';
import type * as P from './service-contracts/event-lab.ts';
import type { EventSessionsV1 } from './service-contracts/suite-execution.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
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
import { evaluateEventEvidence } from '../shared/event-evidence.ts';
export const eventRef = (r: S.SuiteRecord): S.SuiteRef => ({
  domain: r.domain,
  id: r.id,
  revision: r.revision,
});
const scope = (p: S.SuiteScope) => ({ workspaceId: p.workspaceId });
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const json = (v: unknown) => S.suiteJson.parse(v);
const local = (r: S.SuiteRecord) => {
  if (r.origin !== 'local' || r.state !== 'sealed')
    suiteFail('EVENT_LOCAL_REQUIRED', '执行前必须在本地审阅并固定声明');
  return r;
};
const internal = () => {
  if (resourceContext()?.serviceConsumerPluginInstanceId !== 'official:event-runs')
    suiteFail('EVENT_RUN_CONSUMER_REQUIRED', '仅原运行领域可以申请会话', 403);
};
export function validateEventMessages(contract: z.infer<typeof E.eventContract>, raw: unknown) {
  const rows = E.eventMessages.parse(raw);
  if (new Set(rows.map((m) => m.id)).size !== rows.length) suiteFail('EVENT_MESSAGE_ID_DUPLICATE');
  for (const row of rows) {
    if (Buffer.byteLength(suiteCanonical(row.payload)) > contract.maximumBytes)
      suiteFail('EVENT_MESSAGE_BYTES');
    const payload = row.payload;
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') suiteFail('EVENT_PAYLOAD_OBJECT');
    if (contract.required.some((k) => !Object.hasOwn(payload, k))) suiteFail('EVENT_REQUIRED_FIELD');
    for (const [key, value] of Object.entries(payload)) {
      const type = contract.fields[key];
      if (!type || (value === null ? 'null' : typeof value) !== type) suiteFail('EVENT_FIELD_TYPE');
    }
  }
  return rows;
}
export class EventContracts extends SuiteMaterials implements P.EventContractsV1 {
  constructor(
    meta: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    private imagesPort: ImageAssetsV1,
  ) {
    super('event-contracts', meta, uploads, auth, 16 * 1024 ** 3, 2 * 1024 ** 2, ['json']);
  }
  async images() {
    await this.access();
    const images = await this.imagesPort.list();
    if (images.length > 1000) suiteFail('EVENT_IMAGE_LIST_LIMIT');
    return images;
  }
  async upload(raw: z.input<typeof E.eventUpload>) {
    const p = E.eventUpload.parse(raw),
      bytes = Buffer.from(p.text),
      upload = await this.beginUpload({
        ...scope(p),
        name: p.name,
        format: 'json',
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
  async validate(raw: z.infer<typeof E.eventContractInput>) {
    const p = E.eventContractInput.parse(raw);
    return this.put(
      { ...scope(p), name: p.name, content: json(p.definition), references: [] },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof E.eventCompare>) {
    const p = E.eventCompare.parse(raw),
      a = E.eventContract.parse((await this.fixed(scope(p), p.before)).content),
      b = E.eventContract.parse((await this.fixed(scope(p), p.after)).content),
      breaking = Object.entries(a.fields)
        .filter(([k, t]) => b.fields[k] !== t)
        .map(([k]) => k),
      newRequired = b.required.filter((k) => !a.required.includes(k));
    return this.put(
      {
        ...scope(p),
        name: '消息模式兼容性',
        references: [p.before, p.after],
        content: json({
          format: 'sakura-event-contract-diff/1',
          breaking,
          newRequired,
          compatible: !breaking.length && !newRequired.length && b.maximumBytes >= a.maximumBytes,
          declaredOnly: true,
        }),
      },
      'result',
      true,
    );
  }
}
export class EventFixtures extends SuiteStore implements P.EventFixturesV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private contracts: P.EventContractsV1,
  ) {
    super('event-fixtures', meta, auth, contracts, { 'event-contracts': contracts });
  }
  private async store(
    s: S.SuiteScope,
    contract: S.SuiteRef,
    source: S.SuiteRef,
    sourceKind: 'synthetic' | 'reviewed-input',
  ) {
    const cr = local(await this.fixed(s, contract)),
      definition = E.eventContract.parse(cr.content),
      text = await readSuiteText(this.contracts, s, source),
      messages = validateEventMessages(definition, parseSuiteJson(text.text, 2 * 1024 ** 2));
    return this.put(
      {
        ...s,
        name: '固定消息 · ' + messages.length,
        references: [contract, source],
        content: json({
          format: 'sakura-event-fixture/1',
          contract,
          source,
          messages,
          digest: suiteHash(messages),
          sourceKind,
        }),
      },
      'result',
      true,
    );
  }
  async generate(raw: z.infer<typeof E.eventGenerate>) {
    const p = E.eventGenerate.parse(raw),
      contract = E.eventContract.parse(local(await this.fixed(scope(p), p.contract)).content),
      messages = Array.from({ length: p.count }, (_, i) => ({
        id: p.seed + '-' + i,
        key: 'partition-' + (i % 3),
        payload: Object.fromEntries(
          Object.entries(contract.fields).map(([key, type]) => [
            key,
            type === 'number'
              ? i
              : type === 'boolean'
                ? i % 2 === 0
                : type === 'null'
                  ? null
                  : p.seed + '-' + i,
          ]),
        ),
      }));
    validateEventMessages(contract, messages);
    const source = await this.contracts.upload({
      ...scope(p),
      name: p.name + ' · 合成输入',
      text: suiteCanonical(messages),
      allowExport: false,
    });
    return this.store(scope(p), p.contract, eventRef(source), 'synthetic');
  }
  async importRows(raw: z.infer<typeof E.eventImportRows>) {
    const p = E.eventImportRows.parse(raw);
    return this.store(scope(p), p.contract, p.source, 'reviewed-input');
  }
}
export class EventProducers extends SuiteStore implements P.EventProducersV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: P.EventContractsV1,
    fixtures: P.EventFixturesV1,
  ) {
    super('event-producers', meta, auth, contracts, {
      'event-contracts': contracts,
      'event-fixtures': fixtures,
    });
  }
  async compile(raw: z.input<typeof E.eventProducerInput>) {
    const p = E.eventProducerInput.parse(raw),
      fixture = E.eventFixture.parse(local(await this.fixed(scope(p), p.fixture)).content),
      ids = fixture.messages.map((m) => m.id);
    if (p.reverse) ids.reverse();
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [p.fixture],
        content: json({
          format: 'sakura-event-producer/1',
          fixture: p.fixture,
          ordering: p.ordering,
          messageIds: ids,
          dispatch: 'fixed-batch',
        }),
      },
      'result',
      true,
    );
  }
  async previewMessages(raw: S.SuiteScope & { producer: S.SuiteRef }) {
    const p = E.eventSelect('producer').parse(raw);
    return this.fixed(scope(p), p.producer);
  }
}
export class EventConsumers extends SuiteStore implements P.EventConsumersV1 {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, contracts: P.EventContractsV1) {
    super('event-consumers', meta, auth, contracts, { 'event-contracts': contracts });
  }
  async compile(raw: z.input<typeof E.eventConsumerInput>) {
    const p = E.eventConsumerInput.parse(raw);
    E.eventContract.parse(local(await this.fixed(scope(p), p.contract)).content);
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [p.contract],
        content: json({
          format: 'sakura-event-consumer/1',
          contract: p.contract,
          idempotent: p.idempotent,
          delayMs: p.delayMs,
          retryLimit: p.retryLimit,
          poisonIds: p.poisonIds,
          concurrency: 1,
        }),
      },
      'result',
      true,
    );
  }
  async validatePolicy(raw: S.SuiteScope & { consumer: S.SuiteRef }) {
    const p = E.eventSelect('consumer').parse(raw);
    return this.fixed(scope(p), p.consumer);
  }
}
export class EventScenarios extends SuiteStore implements P.EventScenariosV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: P.EventContractsV1,
    fixtures: P.EventFixturesV1,
    producers: P.EventProducersV1,
    consumers: P.EventConsumersV1,
  ) {
    super('event-scenarios', meta, auth, contracts, {
      'event-contracts': contracts,
      'event-fixtures': fixtures,
      'event-producers': producers,
      'event-consumers': consumers,
    });
  }
  async compile(raw: z.infer<typeof E.eventScenarioInput>) {
    const p = E.eventScenarioInput.parse(raw),
      fixture = E.eventFixture.parse(local(await this.fixed(scope(p), p.fixture)).content),
      producer = E.eventProducer.parse(local(await this.fixed(scope(p), p.producer)).content),
      consumer = E.eventConsumer.parse(local(await this.fixed(scope(p), p.consumer)).content);
    if (
      suiteHash(producer.fixture) !== suiteHash(p.fixture) ||
      suiteHash(consumer.contract) !== suiteHash(fixture.contract) ||
      suiteHash(fixture.messages) !== fixture.digest
    )
      suiteFail('EVENT_SCENARIO_REFERENCE');
    const messages = producer.messageIds.map(
      (id) => fixture.messages.find((m) => m.id === id) ?? suiteFail('EVENT_PRODUCER_MESSAGE'),
    );
    if (messages.length !== fixture.messages.length || new Set(producer.messageIds).size !== messages.length)
      suiteFail('EVENT_PRODUCER_COVERAGE');
    const manifest = eventWorkerInput.parse({
      protocol: 'sakura-event-tool/1',
      experiment: p.experiment,
      messages,
      ordering: producer.ordering,
      idempotent: consumer.idempotent,
      delayMs: consumer.delayMs,
      retryLimit: consumer.retryLimit,
      poisonIds: consumer.poisonIds,
    });
    if (
      manifest.experiment === 'slow-consumer' &&
      eventExecutionBudget(manifest).deliveries * manifest.delayMs > p.maximumSeconds * 1000 - 2000
    )
      suiteFail('EVENT_DECLARED_DEADLINE', '声明的消费延迟超过本次截止');
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [p.fixture, p.producer, p.consumer],
        content: json({
          format: 'sakura-event-scenario/1',
          fixture: p.fixture,
          producer: p.producer,
          consumer: p.consumer,
          manifest,
          digest: suiteHash(manifest),
          maximumSeconds: p.maximumSeconds,
        }),
      },
      'result',
      true,
    );
  }
  async preview(raw: S.SuiteScope & { scenario: S.SuiteRef }) {
    const p = E.eventSelect('scenario').parse(raw);
    return this.fixed(scope(p), p.scenario);
  }
}
class EventMutable extends SuiteStore {
  private eventTail = new Map<string, Promise<unknown>>();
  protected serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.eventTail.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.eventTail.set(id, next);
    void next
      .finally(() => {
        if (this.eventTail.get(id) === next) this.eventTail.delete(id);
      })
      .catch(() => {});
    return next;
  }
  protected async latest(s: S.SuiteScope, r: S.SuiteRef) {
    const base = local(await this.fixed(s, r));
    if (base.domain !== this.domain) suiteFail('EVENT_DOMAIN_MISMATCH');
    const rows = (await this.readState()).rows.filter(
        (x) => x.id === base.id && x.actor === suiteActor() && x.workspaceId === s.workspaceId,
      ),
      head = rows.reduce((a, b) => (a.sequence > b.sequence ? a : b), base);
    return local(await this.get(pin(s, eventRef(head))));
  }
  override async close() {
    await Promise.allSettled([...this.eventTail.values()]);
    await super.close();
  }
}
const brokerPlan = z
  .object({ broker: S.suiteRef, scenario: S.suiteRef, executionPlan: suiteExecutionPlan })
  .strict();
export class EventBrokers extends EventMutable implements P.EventBrokersV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: P.EventContractsV1,
    private scenarios: P.EventScenariosV1,
    private tool: () => EventSessionsV1,
  ) {
    super('event-brokers', meta, auth, contracts, {
      'event-contracts': contracts,
      'event-scenarios': scenarios,
    });
  }
  async prepare(raw: z.infer<typeof E.eventPrepare>) {
    const p = E.eventPrepare.parse(raw);
    await this.access(scope(p));
    const tool = await this.tool().tool();
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [],
        content: json({
          format: 'sakura-event-broker/1',
          image: p.image,
          toolDigest: tool.digest,
          engine: 'sqlite-wal-test-broker',
          executionCreated: false,
        }),
      },
      'result',
      true,
    );
  }
  async observe(raw: S.SuiteScope & { broker: S.SuiteRef }) {
    const p = E.eventSelect('broker').parse(raw);
    return this.fixed(scope(p), p.broker);
  }
  async planExecution(raw: z.infer<typeof E.eventRunPreview>) {
    internal();
    const p = E.eventRunPreview.parse(raw),
      broker = E.eventBroker.parse(local(await this.fixed(scope(p), p.broker)).content),
      scenario = E.eventScenario.parse(local(await this.fixed(scope(p), p.scenario)).content);
    if (suiteHash(scenario.manifest) !== scenario.digest) suiteFail('EVENT_SCENARIO_DIGEST');
    if ((await this.tool().tool()).digest !== broker.toolDigest) suiteFail('EVENT_TOOL_CHANGED');
    const executionPlan = await this.tool().preview({
      ...scope(p),
      image: broker.image,
      input: json(scenario.manifest),
      inputDigest: scenario.digest,
      maxSeconds: scenario.maximumSeconds,
    });
    return this.plan(
      scope(p),
      'event-session',
      json({ broker: p.broker, scenario: p.scenario, executionPlan }),
      [p.broker, p.scenario],
    );
  }
  async submitExecution(raw: S.SuiteApproval) {
    internal();
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.consume(p, 'event-session', true),
        s = scope(p);
      if (plan.result) return this.get(pin(s, plan.result));
      const prior = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === s.workspaceId &&
          r.actor === suiteActor() &&
          E.eventSession.safeParse(r.content).success &&
          E.eventSession.parse(r.content).planId === plan.id,
      );
      if (prior) {
        await this.complete(plan, prior);
        return this.inspectExecution({ ...s, session: eventRef(prior) });
      }
      const input = brokerPlan.parse(plan.input);
      let pending: S.SuiteRecord | undefined;
      const session = await this.tool().start(
        { ...s, planId: input.executionPlan.id, digest: input.executionPlan.digest },
        async (challenge) => {
          if (
            challenge.digest !== input.executionPlan.digest ||
            challenge.inputDigest !== input.executionPlan.inputDigest
          )
            suiteFail('EVENT_INTENT_CHANGED');
          const dispatchIntent = suiteHash({ plan: plan.id, challenge });
          pending = await this.put(
            {
              ...s,
              name: '原事件代理会话',
              references: plan.references,
              content: json({
                format: 'sakura-event-session/1',
                planId: plan.id,
                broker: input.broker,
                scenario: input.scenario,
                executionPlan: input.executionPlan,
                sessionId: challenge.sessionId,
                session: null,
                result: null,
                dispatchIntent,
                localExecution: true,
              }),
            },
            'result',
            true,
          );
          return { intentDigest: dispatchIntent };
        },
        async () => {
          await this.access(s);
          for (const ref of plan.references) await this.fixed(s, ref);
        },
      );
      if (!pending) suiteFail('EVENT_INTENT_REQUIRED');
      const record = await this.put(
        {
          ...s,
          id: pending.id,
          expectedRevision: pending.revision,
          name: pending.name,
          references: pending.references,
          content: json({ ...E.eventSession.parse(pending.content), session }),
        },
        'result',
        true,
      );
      await this.complete(plan, record);
      return record;
    });
  }
  private async output(s: S.SuiteScope, receipt: SuiteExecutionReceipt) {
    if (!receipt.output || receipt.cleanup !== 'confirmed') return null;
    const parts: Buffer[] = [];
    let offset = 0;
    do {
      const chunk = await this.tool().output({ ...s, id: receipt.id, offset, length: 512 * 1024 }),
        part = Buffer.from(chunk.data, 'base64');
      if (
        chunk.offset !== offset + part.length ||
        chunk.total !== receipt.output.bytes ||
        chunk.digest !== receipt.output.digest ||
        (!part.length && !chunk.eof)
      )
        suiteFail('EVENT_OUTPUT_PROTOCOL');
      parts.push(part);
      offset = chunk.offset;
      if (chunk.eof) break;
    } while (offset < receipt.output.bytes);
    const bytes = Buffer.concat(parts);
    if (bytes.length !== receipt.output.bytes || suiteSha(bytes) !== receipt.output.digest)
      suiteFail('EVENT_OUTPUT_DIGEST');
    return eventWorkerOutput.parse(parseSuiteJson(bytes.toString('utf8'), 8 * 1024 ** 2));
  }
  async inspectExecution(raw: S.SuiteScope & { session: S.SuiteRef }) {
    const p = E.eventSelect('session').parse(raw);
    return this.serial(p.session.id, async () => {
      const old = await this.latest(scope(p), p.session),
        value = E.eventSession.parse(old.content),
        session = await this.tool().inspect({ ...scope(p), id: value.sessionId }),
        result = value.result ?? (await this.output(scope(p), session));
      if (suiteHash(value.session) === suiteHash(session) && suiteHash(value.result) === suiteHash(result))
        return old;
      return this.put(
        {
          ...scope(p),
          id: old.id,
          expectedRevision: old.revision,
          name: old.name,
          references: old.references,
          content: json({ ...value, session, result }),
        },
        'result',
        true,
      );
    });
  }
  async stopExecution(raw: S.SuiteScope & { session: S.SuiteRef }) {
    const p = E.eventSelect('session').parse(raw),
      value = E.eventSession.parse((await this.latest(scope(p), p.session)).content);
    await this.tool().cancel({ ...scope(p), id: value.sessionId });
    return this.inspectExecution(p as S.SuiteScope & { session: S.SuiteRef });
  }
  async reconcileExecution(raw: S.SuiteScope & { session: S.SuiteRef }) {
    const p = E.eventSelect('session').parse(raw),
      value = E.eventSession.parse((await this.latest(scope(p), p.session)).content);
    await this.tool().reconcile({ ...scope(p), id: value.sessionId });
    return this.inspectExecution(p as S.SuiteScope & { session: S.SuiteRef });
  }
  async discardPreview(raw: S.SuiteApproval) {
    const p = S.suiteApproval.parse(raw),
      plan = await this.inspectPlan({ ...scope(p), planId: p.planId });
    if (
      plan.binding !== suiteBinding() ||
      plan.digest !== p.digest ||
      plan.action !== 'event-session' ||
      !['ready', 'failed'].includes(plan.state)
    )
      suiteFail('EVENT_PLAN_CHANGED');
    const input = brokerPlan.parse(plan.input);
    await this.tool().discardPreview({
      ...scope(p),
      planId: input.executionPlan.id,
      digest: input.executionPlan.digest,
    });
    return this.edit(
      (s) => {
        const row = s.plans.find((r) => r.id === plan.id)!;
        row.state = 'failed';
        return row;
      },
      true,
      scope(p),
    );
  }
  protected override async releaseOwned(s: S.SuiteScope, row: S.SuiteRecord) {
    const value = E.eventSession.safeParse(row.content);
    if (!value.success || row.origin !== 'local') return;
    const receipt = await this.tool().inspect({ ...s, id: value.data.sessionId });
    if (receipt.cleanup !== 'confirmed') suiteFail('EVENT_CLEANUP_UNKNOWN');
    const remaining = (await this.readState()).rows.some(
      (r) => r.workspaceId === s.workspaceId && r.id === row.id && r.revision !== row.revision,
    );
    if (!remaining) await this.tool().release({ ...s, id: value.data.sessionId });
  }
}
export class EventRuns extends EventMutable implements P.EventRunsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: P.EventContractsV1,
    private brokers: P.EventBrokersV1,
    scenarios: P.EventScenariosV1,
  ) {
    super('event-runs', meta, auth, contracts, {
      'event-contracts': contracts,
      'event-brokers': brokers,
      'event-scenarios': scenarios,
    });
  }
  async preview(raw: z.infer<typeof E.eventRunPreview>) {
    const p = E.eventRunPreview.parse(raw);
    local(await this.fixed(scope(p), p.broker));
    local(await this.fixed(scope(p), p.scenario));
    const execution = await this.brokers.planExecution(p);
    return this.plan(scope(p), 'event-run', json({ execution, scenario: p.scenario }), [
      p.broker,
      p.scenario,
    ]);
  }
  async start(raw: S.SuiteApproval) {
    const p = S.suiteApproval.parse(raw);
    return this.serial(p.planId, async () => {
      const plan = await this.consume(p, 'event-run', true),
        s = scope(p);
      if (plan.result) return this.get(pin(s, plan.result));
      const input = z.object({ execution: S.suitePlan, scenario: S.suiteRef }).strict().parse(plan.input),
        session = await this.brokers.submitExecution({
          ...s,
          planId: input.execution.id,
          digest: input.execution.digest,
        }),
        value = E.eventSession.parse(session.content),
        result = await this.put(
          {
            ...s,
            name: '固定队列实验',
            references: [eventRef(session), input.scenario],
            content: json({
              format: 'sakura-event-run/1',
              brokerSession: eventRef(session),
              scenario: input.scenario,
              state: value.session?.state ?? 'preparing',
              outcome: value.session?.outcome ?? 'inconclusive',
              cleanup: value.session?.cleanup ?? 'pending',
            }),
          },
          'result',
          true,
        );
      await this.complete(plan, result);
      return result;
    });
  }
  async inspect(raw: S.SuiteScope & { run: S.SuiteRef }) {
    const p = E.eventSelect('run').parse(raw);
    return this.serial(p.run.id, async () => {
      const old = await this.latest(scope(p), p.run),
        value = E.eventRun.parse(old.content),
        session = await this.brokers.inspectExecution({ ...scope(p), session: value.brokerSession }),
        sv = E.eventSession.parse(session.content),
        content = json({
          ...value,
          brokerSession: eventRef(session),
          state: sv.session?.state ?? 'preparing',
          outcome: sv.session?.outcome ?? 'inconclusive',
          cleanup: sv.session?.cleanup ?? 'pending',
        });
      if (suiteHash(content) === suiteHash(old.content)) return old;
      return this.put(
        {
          ...scope(p),
          id: old.id,
          expectedRevision: old.revision,
          name: old.name,
          references: [eventRef(session), value.scenario],
          content,
        },
        'result',
        true,
      );
    });
  }
  async cancel(raw: S.SuiteScope & { run: S.SuiteRef }) {
    const p = E.eventSelect('run').parse(raw),
      value = E.eventRun.parse((await this.latest(scope(p), p.run)).content);
    await this.brokers.stopExecution({ ...scope(p), session: value.brokerSession });
    return this.inspect(p as S.SuiteScope & { run: S.SuiteRef });
  }
  async reconcile(raw: S.SuiteScope & { run: S.SuiteRef }) {
    const p = E.eventSelect('run').parse(raw),
      value = E.eventRun.parse((await this.latest(scope(p), p.run)).content);
    await this.brokers.reconcileExecution({ ...scope(p), session: value.brokerSession });
    return this.inspect(p as S.SuiteScope & { run: S.SuiteRef });
  }
  async discardPreview(raw: S.SuiteApproval) {
    const p = S.suiteApproval.parse(raw),
      plan = await this.inspectPlan({ ...scope(p), planId: p.planId });
    if (
      plan.binding !== suiteBinding() ||
      plan.digest !== p.digest ||
      plan.action !== 'event-run' ||
      !['ready', 'failed'].includes(plan.state)
    )
      suiteFail('EVENT_PLAN_CHANGED');
    const execution = S.suitePlan.parse((plan.input as Record<string, unknown>).execution);
    await this.brokers.discardPreview({ ...scope(p), planId: execution.id, digest: execution.digest });
    return this.edit(
      (s) => {
        const row = s.plans.find((r) => r.id === plan.id)!;
        row.state = 'failed';
        return row;
      },
      true,
      scope(p),
    );
  }
}
export class EventAssertions extends SuiteStore implements P.EventAssertionsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: P.EventContractsV1,
    private runs: P.EventRunsV1,
    private brokers: P.EventBrokersV1,
    private scenarios: P.EventScenariosV1,
  ) {
    super('event-assertions', meta, auth, contracts, {
      'event-contracts': contracts,
      'event-runs': runs,
      'event-brokers': brokers,
      'event-scenarios': scenarios,
    });
  }
  async evaluate(raw: S.SuiteScope & { run: S.SuiteRef }) {
    const p = E.eventSelect('run').parse(raw),
      run = await this.runs.inspect(p),
      rv = E.eventRun.parse(run.content),
      broker = await this.brokers.inspectExecution({ ...scope(p), session: rv.brokerSession }),
      session = E.eventSession.parse(broker.content),
      scenario = E.eventScenario.parse((await this.fixed(scope(p), rv.scenario)).content);
    let assessment = session.result
      ? evaluateEventEvidence(scenario.manifest, session.result)
      : {
          outcome: 'inconclusive' as const,
          findings: ['原工具尚未返回完整持久队列结果。'],
          coverage: 'incomplete' as const,
          produced: 0,
          delivered: 0,
          acknowledged: 0,
          deduplicated: 0,
          deadLetters: 0,
          remaining: scenario.manifest.messages.length,
        };
    if (session.session?.cleanup !== 'confirmed' || session.session?.state !== 'completed')
      assessment = {
        ...assessment,
        outcome: assessment.outcome === 'failed' ? 'failed' : 'inconclusive',
        coverage: 'incomplete',
        findings: [...assessment.findings, '原任务未完成或资源尚未核销。'],
      };
    const content = E.eventAssessment.parse({
        format: 'sakura-event-assessment/1',
        run: eventRef(run),
        brokerSession: eventRef(broker),
        ...assessment,
        cleanup: session.session?.cleanup ?? 'unknown',
        sourceTrust: 'local-original-provider',
      }),
      existing = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === p.workspaceId &&
          r.actor === suiteActor() &&
          r.state === 'sealed' &&
          suiteHash(r.content) === suiteHash(content),
      );
    if (existing) return this.get(pin(scope(p), eventRef(existing)));
    return this.put(
      {
        ...scope(p),
        name: '逐投递与应用结果检查',
        references: [eventRef(run), eventRef(broker), rv.scenario],
        content: json(content),
      },
      'result',
      true,
    );
  }
  async explain(raw: S.SuiteScope & { assertion: S.SuiteRef }) {
    const p = E.eventSelect('assertion').parse(raw);
    return this.fixed(scope(p), p.assertion);
  }
}
export class EventReports extends SuiteStore implements P.EventReportsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: P.EventContractsV1,
    private runs: P.EventRunsV1,
    private assertions: P.EventAssertionsV1,
  ) {
    super('event-reports', meta, auth, contracts, {
      'event-contracts': contracts,
      'event-runs': runs,
      'event-assertions': assertions,
    });
  }
  async sealReport(raw: z.infer<typeof E.eventReportInput>) {
    const p = E.eventReportInput.parse(raw),
      assertion = E.eventAssessment.parse(local(await this.fixed(scope(p), p.assertion)).content),
      run = E.eventRun.parse(local(await this.fixed(scope(p), p.run)).content);
    if (
      suiteHash(assertion.run) !== suiteHash(p.run) ||
      run.cleanup !== 'confirmed' ||
      ['preparing', 'running'].includes(run.state) ||
      assertion.cleanup !== 'confirmed'
    )
      suiteFail('EVENT_REPORT_UNSETTLED');
    const fresh = E.eventAssessment.parse(
      (await this.assertions.evaluate({ ...scope(p), run: p.run })).content,
    );
    if (suiteHash(fresh) !== suiteHash(assertion)) suiteFail('EVENT_REPORT_CHANGED');
    return this.put(
      {
        ...scope(p),
        name: '固定事件实验报告',
        references: [p.run, p.assertion],
        content: json({
          format: 'sakura-event-report/1',
          run: p.run,
          assertion: p.assertion,
          assessment: assertion,
          summary: p.summary,
          unresolved: p.unresolved,
          sealedBy: suiteActor(),
          productionBenchmark: false,
        }),
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof E.eventCompare>) {
    const p = E.eventCompare.parse(raw),
      a = E.eventReport.parse((await this.fixed(scope(p), p.before)).content),
      b = E.eventReport.parse((await this.fixed(scope(p), p.after)).content);
    return this.put(
      {
        ...scope(p),
        name: '事件实验报告差异',
        references: [p.before, p.after],
        content: json({
          format: 'sakura-event-report-diff/1',
          before: a.assessment.outcome,
          after: b.assessment.outcome,
          deliveredDelta: b.assessment.delivered - a.assessment.delivered,
          duplicateDelta: b.assessment.deduplicated - a.assessment.deduplicated,
          productionBenchmark: false,
        }),
      },
      'result',
      true,
    );
  }
}
export class EventWorkbench extends SuiteStore implements P.EventWorkbenchV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private contracts: P.EventContractsV1,
    private fixtures: P.EventFixturesV1,
    private producers: P.EventProducersV1,
    private consumers: P.EventConsumersV1,
    private scenarios: P.EventScenariosV1,
    private brokers: P.EventBrokersV1,
    private domains: Readonly<Record<string, S.SuiteRecordsV1>>,
  ) {
    super('event-workbench', meta, auth, contracts, domains);
  }
  async templates() {
    await this.access();
    return E.eventTemplate.array().parse([
      {
        id: 'duplicate-delivery',
        name: '重复消息去重',
        description: '每条消息真实入队两次；核对只有一次应用结果。',
        idempotent: true,
        retryLimit: 1,
        delayMs: 0,
      },
      {
        id: 'ack-loss',
        name: '确认丢失后重投',
        description: '第一次应用结果写入后丢失确认，重投并按消息 ID 去重。',
        idempotent: true,
        retryLimit: 1,
        delayMs: 0,
      },
      {
        id: 'slow-consumer',
        name: '慢消费者积压',
        description: '真实消费者逐条等待100毫秒，保留原队列轨迹。',
        idempotent: true,
        retryLimit: 1,
        delayMs: 100,
      },
    ]);
  }
  async createExample(raw: z.infer<typeof E.eventExample>) {
    const p = E.eventExample.parse(raw),
      template = (await this.templates()).find((t) => t.id === p.template)!,
      workspace = await this.contracts.createWorkspace({ name: p.name }),
      s = { workspaceId: workspace.id },
      contract = await this.contracts.validate({
        ...s,
        name: '合成事件模式',
        definition: {
          format: 'sakura-event-contract/1',
          fields: { value: 'number', label: 'string' },
          required: ['value', 'label'],
          maximumBytes: 8192,
        },
      }),
      fixture = await this.fixtures.generate({
        ...s,
        contract: eventRef(contract),
        name: template.name,
        count: 20,
        seed: 'event-example',
      }),
      producer = await this.producers.compile({
        ...s,
        name: '固定批次',
        fixture: eventRef(fixture),
        ordering: 'fifo',
        reverse: false,
      }),
      consumer = await this.consumers.compile({
        ...s,
        name: '固定消费状态机',
        contract: eventRef(contract),
        idempotent: template.idempotent,
        delayMs: template.delayMs,
        retryLimit: template.retryLimit,
        poisonIds: [],
      }),
      scenario = await this.scenarios.compile({
        ...s,
        name: template.name,
        fixture: eventRef(fixture),
        producer: eventRef(producer),
        consumer: eventRef(consumer),
        experiment: template.id,
        maximumSeconds: 120,
      }),
      broker = await this.brokers.prepare({ ...s, name: '隔离测试代理', image: p.image });
    return { workspace, contract, fixture, producer, consumer, scenario, broker };
  }
  async view(raw: z.input<typeof E.eventViewInput>) {
    const p = E.eventViewInput.parse(raw),
      workspaces = await this.contracts.listWorkspaces();
    if (!p.workspaceId) return { workspaces, workspace: null, domains: [] };
    const s = { workspaceId: p.workspaceId },
      workspace = await this.contracts.workspace(s),
      domains = [];
    for (const [id, port] of Object.entries(this.domains)) {
      const page = await port.list({ ...s, cursor: p.cursor, limit: p.limit, history: false });
      domains.push({ id, records: page.items, next: page.next });
    }
    return E.eventView.parse({ workspaces, workspace, domains });
  }
}
