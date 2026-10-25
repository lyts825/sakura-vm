/** 固定图与原提供者回执组成可恢复流程。批准只作用于当前具体阶段。 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as F from '../shared/contracts/flow-studio.ts';
import {
  delegatedTicketSchema,
  type DelegatedInput,
  type DelegatedPlan,
  type DelegatedReceipt,
  type DelegatedIntent,
  type DelegatedTicket,
} from '../shared/contracts/delegated-actions.ts';
import { flowUpload, flowTimeline } from '../shared/contracts/flow-http.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type * as P from './service-contracts/flow-studio.ts';
import type { DelegatedActionsV1 } from './service-contracts/delegated-actions.ts';
import type { IntegrationRunnersV1 } from './service-contracts/integration-lab.ts';
import {
  SuiteStore,
  SuiteRoot,
  suiteActor,
  suiteHash,
  suiteSha,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { readSuiteText } from './suite-compute.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { flowTopology, flowReady, flowRefresh } from './flow-analysis.ts';
type Peers = Readonly<Record<string, S.SuiteRecordsV1>>;
const scope = (p: S.SuiteScope) => ({ workspaceId: p.workspaceId }),
  ref = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision }),
  pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision }),
  json = (v: unknown) => S.suiteJson.parse(v),
  same = (a: S.SuiteRef, b: S.SuiteRef) => suiteHash(a) === suiteHash(b),
  now = () => new Date().toISOString();
function consumer(ids: string[]) {
  const c = resourceContext(),
    who = c?.serviceConsumerPluginInstanceId;
  if (!who || !c?.serviceConsumerPluginGeneration || !ids.some((id) => who === 'official:' + id))
    suiteFail('FLOW_INTERNAL_CONSUMER', '仅原流程领域可以调用内部推进入口', 403);
  return c.serviceConsumerPluginGeneration;
}
class FlowStore extends SuiteStore {
  constructor(domain: string, m: PluginMetadata, a: SuiteAuthorize, root: P.FlowDefinitionsV1, peers: Peers) {
    super(domain, m, a, root, peers);
  }
  protected async native<T>(s: S.SuiteScope, r: S.SuiteRef, schema: z.ZodType<T>, domain: string) {
    if (r.domain !== domain) suiteFail('FLOW_DOMAIN');
    const row = await this.fixed(s, r);
    if (row.origin !== 'local' || row.actor !== suiteActor()) suiteFail('FLOW_LOCAL_REQUIRED');
    return { row, value: schema.parse(row.content) };
  }
  protected async head(s: S.SuiteScope, id: string) {
    await this.access(s);
    const row =
      (await this.readState()).rows
        .filter((r) => r.workspaceId === s.workspaceId && r.id === id && r.actor === suiteActor())
        .sort((a, b) => b.sequence - a.sequence)[0] ?? suiteFail('FLOW_RECORD_NOT_FOUND');
    return this.get(pin(s, ref(row)));
  }
  protected async write(
    s: S.SuiteScope,
    name: string,
    content: unknown,
    references: S.SuiteRef[],
    previous?: S.SuiteRecord,
  ) {
    return this.put(
      {
        ...s,
        name,
        content: json(content),
        references: [...new Map(references.map((r) => [suiteHash(r), r])).values()],
        ...(previous ? { id: previous.id, expectedRevision: previous.revision } : {}),
      },
      'result',
      true,
    );
  }
  override async archive(raw: S.SuitePin) {
    const p = S.suitePin.parse(raw);
    await this.get(p);
    const versions = (await this.readState()).rows.filter(
        (r) => r.workspaceId === p.workspaceId && r.id === p.id && r.actor === suiteActor(),
      ),
      head = versions.reduce((a, b) => (a.sequence > b.sequence ? a : b));
    if (head.revision === p.revision && versions.length > 1)
      suiteFail('FLOW_CURRENT_STATE_PROTECTED', '请先清理未受保护的旧修订，避免旧批准或运行状态复活');
    return super.archive(p);
  }
}
export class FlowDefinitions extends SuiteRoot implements P.FlowDefinitionsV1 {
  constructor(m: PluginMetadata, a: SuiteAuthorize) {
    super('flow-definitions', m, a, 1024 ** 3);
  }
  async compile(raw: z.input<typeof F.flowCompile>) {
    const p = F.flowCompile.parse(raw),
      order = flowTopology(p.graph);
    await this.access(scope(p));
    if (
      (await this.readState()).rows.filter(
        (row) =>
          row.workspaceId === p.workspaceId &&
          row.state !== 'archived' &&
          F.flowDefinition.safeParse(row.content).success,
      ).length >= 200
    )
      suiteFail('FLOW_DEFINITION_LIMIT');
    return this.put(
      {
        ...scope(p),
        name: p.name,
        content: json(F.flowDefinition.parse({ format: 'sakura-flow-definition/1', ...p.graph, order })),
        references: [],
      },
      'result',
      true,
    );
  }
  async validate(raw: S.SuiteScope & { definition: S.SuiteRef }) {
    const p = F.flowSelect('definition').parse(raw);
    if (p.definition.domain !== this.domain) suiteFail('FLOW_DEFINITION_REQUIRED');
    const row = await this.fixed(scope(p), p.definition),
      definition = F.flowDefinition.parse(row.content);
    if (row.origin !== 'local') suiteFail('FLOW_LOCAL_REQUIRED');
    return { valid: true as const, order: flowTopology(definition) };
  }
}
export class FlowInputs extends SuiteMaterials implements P.FlowInputsV1 {
  constructor(m: PluginMetadata, u: PluginMetadata, a: SuiteAuthorize, root: P.FlowDefinitionsV1) {
    super('flow-inputs', m, u, a, 1024 ** 3, 4 * 1024 ** 2, ['json', 'text'], root);
  }
  async upload(raw: z.input<typeof flowUpload>) {
    const p = flowUpload.parse(raw),
      data = Buffer.from(p.text);
    if (data.length > 1024 ** 2) suiteFail('FLOW_INPUT_BYTES');
    const u = await this.beginUpload({
      ...scope(p),
      name: p.name,
      format: 'json',
      bytes: data.length,
      digest: suiteSha(data),
      allowExport: p.allowExport,
    });
    for (let offset = 0; offset < data.length; offset += 524288)
      await this.appendUpload({
        ...scope(p),
        id: u.id,
        offset,
        data: data.subarray(offset, offset + 524288).toString('base64'),
      });
    return this.finishUpload({ ...scope(p), id: u.id });
  }
  async bind(raw: z.input<typeof F.flowBind>) {
    const p = F.flowBind.parse(raw);
    if (p.source.domain !== this.domain) suiteFail('FLOW_INPUT_SOURCE');
    const row = await this.fixed(scope(p), p.source);
    if (row.origin !== 'local' || row.kind !== 'source') suiteFail('FLOW_INPUT_SOURCE');
    const source = await readSuiteText(this, scope(p), p.source, 1024 ** 2),
      bindings = F.flowInput.shape.bindings.parse(parseSuiteJson(source.text, 1024 ** 2));
    if (Object.keys(bindings).length > 100) suiteFail('FLOW_BINDING_LIMIT');
    return this.put(
      {
        ...scope(p),
        name: row.name + ' · 固定输入',
        content: json(
          F.flowInput.parse({
            format: 'sakura-flow-input/1',
            source: p.source,
            sourceDigest: S.suiteMaterial.parse(row.content).digest,
            bindings,
            reviewed: true,
          }),
        ),
        references: [p.source],
      },
      'result',
      true,
    );
  }
  async resolve(raw: S.SuiteScope & { inputs: S.SuiteRef; name: string }) {
    const p = F.flowSelect('inputs').extend({ name: F.flowBinding }).strict().parse(raw);
    if (p.inputs.domain !== this.domain) suiteFail('FLOW_INPUT_REQUIRED');
    const row = await this.fixed(scope(p), p.inputs);
    if (row.origin !== 'local') suiteFail('FLOW_LOCAL_REQUIRED');
    const value = F.flowInput.parse(row.content);
    if (!Object.hasOwn(value.bindings, p.name)) suiteFail('FLOW_BINDING_MISSING');
    return { value: value.bindings[p.name], digest: suiteHash(value.bindings[p.name]) };
  }
}
export class FlowConnectors extends FlowStore implements P.FlowConnectorsV1 {
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: P.FlowDefinitionsV1,
    private delegated: () => DelegatedActionsV1 | undefined,
    private integration: () => IntegrationRunnersV1 | undefined,
  ) {
    super('flow-connectors', m, a, root, {});
  }
  private host() {
    return this.delegated() ?? suiteFail('FLOW_DELEGATION_UNAVAILABLE', '原委派服务未运行', 503);
  }
  async catalogue() {
    await this.access();
    const providers = this.delegated() ? await this.host().providers() : [];
    return (['integration-run', 'knowledge-publish'] as const).map((adapter) => ({
      adapter,
      available: providers.some((p) => p.adapter === adapter && p.available),
      description:
        adapter === 'integration-run'
          ? '原接口验证计划、隔离运行与原资源清理'
          : '固定知识文稿与当前审阅的本机发布',
    }));
  }
  async inspectProvider(raw: { target: DelegatedInput }) {
    const p = z.object({ target: F.flowProviderInput }).strict().parse(raw);
    return {
      adapter: p.target.adapter,
      available: (await this.catalogue()).some((v) => v.adapter === p.target.adapter && v.available),
    };
  }
  async preview(raw: { target: DelegatedInput }) {
    consumer(['flow-plans']);
    const p = z.object({ target: F.flowProviderInput }).strict().parse(raw);
    await this.access();
    return this.host().preview(p.target);
  }
  async dispatch(
    raw: { ticket: DelegatedTicket },
    commit: (plan: DelegatedPlan) => Promise<DelegatedIntent>,
  ) {
    consumer(['flow-runs']);
    const p = z.object({ ticket: delegatedTicketSchema }).strict().parse(raw);
    if (!['integration-run', 'knowledge-publish'].includes(p.ticket.adapter))
      suiteFail('FLOW_ADAPTER_DENIED');
    await this.access();
    return this.host().dispatch(p.ticket, commit);
  }
  async inspect(raw: { ticket: DelegatedTicket }) {
    consumer(['flow-runs']);
    const p = z.object({ ticket: delegatedTicketSchema }).strict().parse(raw);
    if (!['integration-run', 'knowledge-publish'].includes(p.ticket.adapter))
      suiteFail('FLOW_ADAPTER_DENIED');
    await this.access();
    return this.host().inspect(p.ticket);
  }
  private async control(raw: { ticket: DelegatedTicket }, operation: 'cancel' | 'recover') {
    const receipt = await this.inspect(raw);
    if (receipt.plan.input.adapter !== 'integration-run' || !receipt.result) return receipt;
    const saved = z
        .object({
          runId: z.uuid(),
          originalPlanId: z.uuid(),
          originalPlanDigest: S.suiteDigest,
          createdAt: z.iso.datetime(),
        })
        .passthrough()
        .parse(receipt.result),
      runs = this.integration() ?? suiteFail('FLOW_PROVIDER_UNAVAILABLE'),
      run = await runs.inspect(receipt.plan.input.scope, saved.runId);
    if (
      run.plan.id !== saved.originalPlanId ||
      run.plan.digest !== saved.originalPlanDigest ||
      run.createdAt !== saved.createdAt
    )
      suiteFail('FLOW_ORIGINAL_RUN_CHANGED');
    await runs[operation](receipt.plan.input.scope, saved.runId);
    return this.inspect(raw);
  }
  cancel(raw: { ticket: DelegatedTicket }) {
    return this.control(raw, 'cancel');
  }
  reconcile(raw: { ticket: DelegatedTicket }) {
    return this.control(raw, 'recover');
  }
}
export class FlowPlans extends FlowStore implements P.FlowPlansV1 {
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: P.FlowDefinitionsV1,
    peers: Peers,
    private connectors: P.FlowConnectorsV1,
  ) {
    super('flow-plans', m, a, root, peers);
  }
  private async data(p: z.infer<typeof F.flowPreview>) {
    return {
      definition: (await this.native(scope(p), p.definition, F.flowDefinition, 'flow-definitions')).value,
      inputs: (await this.native(scope(p), p.inputs, F.flowInput, 'flow-inputs')).value,
    };
  }
  async previewFlow(raw: z.input<typeof F.flowPreview>) {
    const p = F.flowPreview.parse(raw),
      d = await this.data(p),
      providers = await this.connectors.catalogue(),
      issues: string[] = [];
    for (const node of d.definition.nodes) {
      if (
        (node.type === 'material' || node.type === 'condition') &&
        !Object.hasOwn(d.inputs.bindings, node.binding)
      )
        issues.push('缺少固定变量：' + node.binding);
      if (
        node.type === 'provider' &&
        !providers.some((v) => v.adapter === node.target.adapter && v.available)
      )
        issues.push('原提供者未就绪：' + node.target.adapter);
      if (node.type === 'wait' && Date.parse(node.until) > Date.now() + 30 * 86400000)
        issues.push('等待超过 30 天：' + node.id);
    }
    return this.write(
      scope(p),
      '流程拓扑与就绪预览',
      F.flowGraphPlan.parse({
        format: 'sakura-flow-plan/1',
        kind: 'graph',
        definition: p.definition,
        inputs: p.inputs,
        order: flowTopology(d.definition),
        providers: providers.map(({ adapter, available }) => ({ adapter, available })),
        valid: !issues.length,
        issues,
        actor: suiteActor(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        invalidated: false,
      }),
      [p.definition, p.inputs],
    );
  }
  async previewStep(raw: z.input<typeof F.flowStepReady>, authorize: () => Promise<void>) {
    const generation = consumer(['flow-runs']),
      p = F.flowStepReady.parse(raw),
      d = await this.data(p),
      node = d.definition.nodes.find((n) => n.id === p.nodeId) ?? suiteFail('FLOW_NODE_UNKNOWN');
    for (const r of p.dependencies) await this.fixed(scope(p), r);
    await authorize();
    const providerPlan =
      node.type === 'provider' ? await this.connectors.preview({ target: node.target }) : null;
    await authorize();
    return this.write(
      scope(p),
      '阶段预览 · ' + node.label,
      F.flowStepPlan.parse({
        format: 'sakura-flow-plan/1',
        kind: 'step',
        definition: p.definition,
        inputs: p.inputs,
        runId: p.runId,
        runRevision: p.runRevision,
        node,
        providerPlan,
        dependencies: p.dependencies,
        actor: suiteActor(),
        runGeneration: generation,
        expiresAt: new Date(
          Math.min(Date.now() + 300000, providerPlan ? Date.parse(providerPlan.expiresAt) : Infinity),
        ).toISOString(),
        invalidated: false,
      }),
      [p.definition, p.inputs, ...p.dependencies],
    );
  }
  async inspect(raw: S.SuiteScope & { plan: S.SuiteRef }) {
    const p = F.flowSelect('plan').parse(raw),
      d = await this.native(scope(p), p.plan, F.flowPlan, this.domain),
      head = await this.head(scope(p), p.plan.id);
    if (
      head.revision !== p.plan.revision ||
      d.value.invalidated ||
      d.value.actor !== suiteActor() ||
      Date.parse(d.value.expiresAt) <= Date.now()
    )
      suiteFail('FLOW_PLAN_EXPIRED', '阶段计划已变更或过期，请重新预览');
    return d.row;
  }
  async invalidate(raw: S.SuiteScope & { plan: S.SuiteRef }) {
    const p = F.flowSelect('plan').parse(raw),
      d = await this.native(scope(p), p.plan, F.flowPlan, this.domain);
    return this.write(scope(p), d.row.name, { ...d.value, invalidated: true }, d.row.references, d.row);
  }
}
export class FlowApprovals extends FlowStore implements P.FlowApprovalsV1 {
  private epoch = randomUUID();
  private gate: Promise<unknown> = Promise.resolve();
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: P.FlowDefinitionsV1,
    private plans: P.FlowPlansV1,
  ) {
    super('flow-approvals', m, a, root, { 'flow-plans': plans });
  }
  async approve(raw: z.input<typeof F.flowApprove>) {
    const p = F.flowApprove.parse(raw),
      plan = F.flowStepPlan.parse((await this.plans.inspect({ ...scope(p), plan: p.plan })).content);
    if (plan.actor !== suiteActor()) suiteFail('FLOW_APPROVER');
    return this.write(
      scope(p),
      '单账户阶段批准',
      F.flowApproval.parse({
        format: 'sakura-flow-approval/1',
        plan: p.plan,
        decision: 'approved',
        actor: suiteActor(),
        epoch: this.epoch,
        reason: p.reason,
        expiresAt: plan.expiresAt,
        consumedBy: null,
      }),
      [p.plan],
    );
  }
  async inspect(raw: S.SuiteScope & { approval: S.SuiteRef }) {
    const p = F.flowSelect('approval').parse(raw),
      d = await this.native(scope(p), p.approval, F.flowApproval, this.domain),
      head = await this.head(scope(p), p.approval.id);
    if (
      head.revision !== p.approval.revision ||
      d.value.decision !== 'approved' ||
      d.value.epoch !== this.epoch ||
      Date.parse(d.value.expiresAt) <= Date.now() ||
      d.value.actor !== suiteActor()
    )
      suiteFail('FLOW_APPROVAL_EXPIRED', '批准已撤销、消费、过期或跨越插件重启');
    await this.plans.inspect({ ...scope(p), plan: d.value.plan });
    return d.row;
  }
  async revoke(raw: z.input<typeof F.flowRevoke>) {
    const p = F.flowRevoke.parse(raw),
      d = await this.native(scope(p), p.approval, F.flowApproval, this.domain);
    if (d.value.decision === 'consumed')
      suiteFail('FLOW_ALREADY_DISPATCHED', '已消费的批准不能撤回原动作；请取消运行并核对原回执');
    return this.write(
      scope(p),
      d.row.name,
      { ...d.value, decision: 'revoked', reason: p.reason },
      d.row.references,
      d.row,
    );
  }
  claim(raw: z.input<typeof F.flowClaim>) {
    const generation = consumer(['flow-runs']),
      task = this.gate.then(async () => {
        const p = F.flowClaim.parse(raw),
          row = await this.inspect({ ...scope(p), approval: p.approval }),
          a = F.flowApproval.parse(row.content),
          step = F.flowStepPlan.parse((await this.plans.inspect({ ...scope(p), plan: a.plan })).content);
        if (
          !same(a.plan, p.plan) ||
          step.runId !== p.runId ||
          step.runRevision !== p.runRevision ||
          step.node.id !== p.nodeId ||
          step.runGeneration !== generation
        )
          suiteFail('FLOW_APPROVAL_SCOPE');
        return this.write(
          scope(p),
          row.name,
          { ...a, decision: 'consumed', consumedBy: p.runId },
          row.references,
          row,
        );
      });
    this.gate = task.catch(() => {});
    return task;
  }
  override async close() {
    await this.gate;
    await super.close();
  }
}
export class FlowJournal extends FlowStore implements P.FlowJournalV1 {
  private gate: Promise<unknown> = Promise.resolve();
  constructor(m: PluginMetadata, a: SuiteAuthorize, root: P.FlowDefinitionsV1, peers: Peers) {
    super('flow-journal', m, a, root, peers);
  }
  private async events(s: S.SuiteScope, runId: string) {
    await this.access(s);
    return (await this.readState()).rows
      .filter(
        (row) =>
          row.workspaceId === s.workspaceId &&
          row.actor === suiteActor() &&
          row.state === 'sealed' &&
          row.origin === 'local' &&
          F.flowEvent.safeParse(row.content).success &&
          (row.content as Record<string, S.SuiteJson>).runId === runId,
      )
      .sort((a, b) => F.flowEvent.parse(a.content).index - F.flowEvent.parse(b.content).index);
  }
  append(raw: z.input<typeof F.flowAppend>) {
    consumer(['flow-runs']);
    const task = this.gate.then(async () => {
      const p = F.flowAppend.parse(raw),
        events = await this.events(scope(p), p.runId);
      if (events.length >= 10000) suiteFail('FLOW_JOURNAL_LIMIT');
      await this.verify({ ...scope(p), runId: p.runId });
      return this.write(
        scope(p),
        '流程事件 ' + (events.length + 1),
        F.flowEvent.parse({
          format: 'sakura-flow-event/1',
          runId: p.runId,
          index: events.length + 1,
          previous: events.at(-1)?.revision ?? null,
          kind: p.kind,
          nodeId: p.nodeId,
          actor: suiteActor(),
          at: now(),
          data: p.data,
        }),
        p.references,
      );
    });
    this.gate = task.catch(() => {});
    return task;
  }
  async readTimeline(raw: z.input<typeof flowTimeline>) {
    const p = flowTimeline.parse(raw),
      all = await this.events(scope(p), p.runId),
      items = all.slice(p.cursor, p.cursor + p.limit);
    for (const row of items) await this.get(pin(scope(p), ref(row)));
    return { items, next: p.cursor + items.length < all.length ? p.cursor + items.length : null };
  }
  async verify(raw: S.SuiteScope & { runId: string }) {
    const p = S.suiteScope.extend({ runId: S.suiteId }).strict().parse(raw),
      all = await this.events(scope(p), p.runId);
    let previous: string | null = null;
    for (let i = 0; i < all.length; i++) {
      const row = await this.get(pin(scope(p), ref(all[i]))),
        event = F.flowEvent.parse(row.content);
      if (event.index !== i + 1 || event.previous !== previous) suiteFail('FLOW_JOURNAL_GAP');
      previous = row.revision;
    }
    return { valid: true as const, events: all.length, tail: previous };
  }
  override async close() {
    await this.gate;
    await super.close();
  }
}
export class FlowRuns extends FlowStore implements P.FlowRunsV1 {
  private readonly ownGeneration = pluginAuthority()?.generation;
  private gate: Promise<unknown> = Promise.resolve();
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: P.FlowDefinitionsV1,
    peers: Peers,
    private plans: P.FlowPlansV1,
    private approvals: P.FlowApprovalsV1,
    private connectors: P.FlowConnectorsV1,
    private journal: P.FlowJournalV1,
  ) {
    super('flow-runs', m, a, root, peers);
  }
  private serial<T>(f: () => Promise<T>) {
    const task = this.gate.then(f);
    this.gate = task.catch(() => {});
    return task;
  }
  private generation() {
    const context = resourceContext();
    return (
      this.ownGeneration ??
      (context?.pluginInstanceId === 'official:flow-runs' ? context.pluginGeneration : undefined) ??
      suiteFail('FLOW_GENERATION_REQUIRED')
    );
  }
  private async current(raw: z.input<typeof F.flowRunKey>) {
    const p = F.flowRunKey.parse({ workspaceId: raw.workspaceId, id: raw.id }),
      row = await this.head(scope(p), p.id);
    if (row.origin !== 'local') suiteFail('FLOW_LOCAL_REQUIRED');
    const run = F.flowRun.parse(row.content),
      definition = (await this.native(scope(p), run.definition, F.flowDefinition, 'flow-definitions')).value,
      inputs = (await this.native(scope(p), run.inputs, F.flowInput, 'flow-inputs')).value;
    return { p, row, run, definition, inputs };
  }
  private runReferences(run: F.FlowRun) {
    return [
      run.graphPlan,
      run.definition,
      run.inputs,
      ...run.journal,
      ...run.nodes.flatMap((n) => [n.plan, n.approval, n.event].filter((r): r is S.SuiteRef => !!r)),
    ];
  }
  private persistRun(s: S.SuiteScope, row: S.SuiteRecord, run: F.FlowRun, definition: F.FlowDefinition) {
    run.updatedAt = now();
    flowRefresh(definition, run);
    return this.write(s, row.name, F.flowRun.parse(run), this.runReferences(run), row);
  }
  private dependencies(definition: F.FlowDefinition, run: F.FlowRun, nodeId: string) {
    return definition.edges
      .filter((e) => e.to === nodeId)
      .map((e) => run.nodes.find((n) => n.id === e.from)?.event ?? suiteFail('FLOW_DEPENDENCY_RECEIPT'));
  }
  private async verifyPredecessors(
    s: S.SuiteScope,
    definition: F.FlowDefinition,
    run: F.FlowRun,
    nodeId: string,
  ) {
    for (const edge of definition.edges.filter((e) => e.to === nodeId)) {
      const prior = run.nodes.find((n) => n.id === edge.from)!;
      if (!prior.plan) continue;
      const step = (await this.native(s, prior.plan, F.flowStepPlan, 'flow-plans')).value;
      if (!step.providerPlan) continue;
      const receipt = await this.connectors.inspect({ ticket: step.providerPlan.ticket });
      if (
        !prior.receipt ||
        receipt.status !== 'returned' ||
        suiteHash(receipt.result) !== suiteHash(prior.receipt.result)
      )
        suiteFail('FLOW_PREDECESSOR_CHANGED', '前序原资源或结果已变化，请核对原回执');
    }
  }
  private async event(
    s: S.SuiteScope,
    id: string,
    run: F.FlowRun,
    kind: z.infer<typeof F.flowEvent>['kind'],
    nodeId: string | null,
    data: unknown,
  ) {
    if (run.journal.length >= 100) suiteFail('FLOW_JOURNAL_RUN_LIMIT');
    const row = await this.journal.append({
      ...s,
      runId: id,
      kind,
      nodeId,
      data: json(data),
      references: [run.definition, run.inputs],
    });
    run.journal.push(ref(row));
    if (nodeId) run.nodes.find((n) => n.id === nodeId)!.event = ref(row);
    return row;
  }
  start(raw: S.SuiteScope & { plan: S.SuiteRef }) {
    return this.serial(async () => {
      const p = F.flowSelect('plan').parse(raw),
        plan = F.flowGraphPlan.parse((await this.plans.inspect({ ...scope(p), plan: p.plan })).content);
      if (!plan.valid) suiteFail('FLOW_GRAPH_NOT_READY');
      const heads = new Map<string, S.SuiteRecord>();
      for (const row of (await this.readState()).rows)
        if (row.actor === suiteActor() && (!heads.has(row.id) || heads.get(row.id)!.sequence < row.sequence))
          heads.set(row.id, row);
      const active = [...heads.values()].filter((row) => {
        const parsed = F.flowRun.safeParse(row.content);
        return (
          row.origin === 'local' &&
          parsed.success &&
          (!['completed', 'cancelled'].includes(parsed.data.status) ||
            parsed.data.nodes.some((node) => ['running', 'unknown'].includes(node.status)))
        );
      });
      if (active.length >= 8) suiteFail('FLOW_ACTIVE_PACKAGE_LIMIT');
      if (active.some((row) => row.workspaceId === p.workspaceId))
        suiteFail('FLOW_ACTIVE_WORKSPACE_LIMIT', '同一空间已有未结束流程');
      const definition = (await this.native(scope(p), plan.definition, F.flowDefinition, 'flow-definitions'))
          .value,
        run = F.flowRun.parse({
          format: 'sakura-flow-run/1',
          graphPlan: p.plan,
          definition: plan.definition,
          inputs: plan.inputs,
          status: 'active',
          nodes: definition.nodes.map((n) => ({
            id: n.id,
            status: 'blocked',
            outcome: null,
            plan: null,
            approval: null,
            receipt: null,
            event: null,
            until: null,
            error: null,
          })),
          startedAt: now(),
          updatedAt: now(),
          cancelled: false,
          generation: this.generation(),
          journal: [],
          limitations: [
            '仅本机单账户批准；未知结果不会自动重发',
            '等待到期需要显式释放；原动作取消不等于回滚',
          ],
        });
      flowRefresh(definition, run);
      const row = await this.write(scope(p), '流程运行', run, this.runReferences(run));
      await this.event(scope(p), row.id, run, 'started', null, {
        definition: plan.definition.id,
        inputs: plan.inputs.id,
      });
      return this.persistRun(scope(p), row, run, definition);
    });
  }
  async inspect(raw: z.input<typeof F.flowRunKey>) {
    const d = await this.current(F.flowRunKey.parse(raw));
    return d.row;
  }
  override async archive(raw: S.SuitePin) {
    const p = S.suitePin.parse(raw),
      row = await this.get(p),
      head = await this.head(scope(p), p.id),
      run = F.flowRun.safeParse(row.content);
    if (
      head.revision === p.revision &&
      run.success &&
      (!['completed', 'cancelled'].includes(run.data.status) ||
        run.data.nodes.some((node) => ['running', 'unknown'].includes(node.status)))
    )
      suiteFail('FLOW_ACTIVE_STATE_PROTECTED', '请先结束流程并核对所有原动作，当前活动状态不能归档');
    return super.archive(p);
  }
  previewStep(raw: z.input<typeof F.flowNodeKey>) {
    return this.serial(async () => {
      const p = F.flowNodeKey.parse(raw),
        d = await this.current(p);
      if (!flowReady(d.definition, d.run, p.nodeId)) suiteFail('FLOW_NODE_NOT_READY');
      if (d.row.sequence >= 85)
        suiteFail('FLOW_REVISION_BUDGET', '本运行已达到推进预算，请核对并结束当前运行');
      await this.verifyPredecessors(scope(p), d.definition, d.run, p.nodeId);
      const generation = this.generation(),
        dependencies = this.dependencies(d.definition, d.run, p.nodeId),
        authorize = async () => {
          const current = await this.current(p);
          if (
            current.row.revision !== d.row.revision ||
            !flowReady(current.definition, current.run, p.nodeId)
          )
            suiteFail('FLOW_STAGE_CHANGED');
          await this.verifyPredecessors(scope(p), current.definition, current.run, p.nodeId);
        };
      const plan = await this.plans.previewStep(
        {
          ...scope(p),
          definition: d.run.definition,
          inputs: d.run.inputs,
          runId: p.id,
          runRevision: d.row.revision,
          nodeId: p.nodeId,
          dependencies,
        },
        authorize,
      );
      await authorize();
      const node = d.run.nodes.find((n) => n.id === p.nodeId)!;
      node.plan = ref(plan);
      node.stageBaseRevision = d.row.revision;
      node.approval = null;
      d.run.generation = generation;
      await this.persistRun(scope(p), d.row, d.run, d.definition);
      return plan;
    });
  }
  private applyReceipt(node: z.infer<typeof F.flowNodeState>, receipt: DelegatedReceipt) {
    node.receipt = receipt;
    const result = receipt.result as Record<string, S.SuiteJson> | null;
    if (['rejected', 'expired'].includes(receipt.status)) {
      node.status = 'failed';
      node.outcome = false;
    } else if (receipt.status === 'returned' && result?.completed === true) {
      node.status =
        result.uncertain === true ? 'unknown' : result.succeeded === true ? 'completed' : 'failed';
      node.outcome = node.status === 'completed' ? true : node.status === 'failed' ? false : null;
    } else if (receipt.status === 'returned' && result?.completed === false) {
      node.status = 'running';
      node.outcome = null;
    } else {
      node.status = 'unknown';
      node.outcome = null;
    }
    node.error =
      node.status === 'unknown'
        ? '原动作结果未知，请核对原回执；禁止重发'
        : node.status === 'failed'
          ? '原提供者报告未通过'
          : null;
  }
  advance(raw: z.input<typeof F.flowAdvance>) {
    return this.serial(async () => {
      const p = F.flowAdvance.parse(raw),
        d = await this.current(p),
        node = d.run.nodes.find((n) => n.id === p.nodeId) ?? suiteFail('FLOW_NODE_UNKNOWN');
      if (node.approval?.id === p.approval.id) return d.row;
      if (
        d.row.revision !== p.expectedRevision ||
        !flowReady(d.definition, d.run, p.nodeId) ||
        !node.plan ||
        !node.stageBaseRevision
      )
        suiteFail('FLOW_STAGE_CHANGED');
      const step = F.flowStepPlan.parse((await this.plans.inspect({ ...scope(p), plan: node.plan })).content);
      if (
        step.runId !== p.id ||
        step.runRevision !== node.stageBaseRevision ||
        step.node.id !== node.id ||
        step.runGeneration !== this.generation() ||
        !same(step.definition, d.run.definition) ||
        !same(step.inputs, d.run.inputs) ||
        suiteHash(step.dependencies) !== suiteHash(this.dependencies(d.definition, d.run, node.id))
      )
        suiteFail('FLOW_STAGE_BINDING');
      await this.verifyPredecessors(scope(p), d.definition, d.run, node.id);
      const claimed = await this.approvals.claim({
        ...scope(p),
        approval: p.approval,
        plan: node.plan,
        runId: p.id,
        runRevision: node.stageBaseRevision,
        nodeId: node.id,
      });
      node.approval = ref(claimed);
      node.status = 'running';
      const intent = await this.event(scope(p), p.id, d.run, 'intent', node.id, {
        planId: node.plan.id,
        planDigest: node.plan.revision,
        approvalId: claimed.id,
        approvalDigest: claimed.revision,
      });
      let row = await this.persistRun(scope(p), d.row, d.run, d.definition);
      try {
        if (step.node.type === 'provider') {
          if (!step.providerPlan) suiteFail('FLOW_PROVIDER_PLAN_REQUIRED');
          const receipt = await this.connectors.dispatch(
            { ticket: step.providerPlan.ticket },
            async (original) => {
              const current = await this.current(p);
              if (
                current.row.revision !== row.revision ||
                current.run.cancelled ||
                original.ticket.digest !== step.providerPlan!.ticket.digest
              )
                suiteFail('FLOW_INTENT_CHANGED');
              await this.verifyPredecessors(scope(p), current.definition, current.run, node.id);
              return { intentDigest: intent.revision };
            },
          );
          this.applyReceipt(node, receipt);
        } else if (step.node.type === 'wait') {
          node.status = 'waiting';
          node.until = step.node.until;
          node.outcome = null;
        } else {
          node.status = 'completed';
          node.outcome =
            step.node.type === 'condition'
              ? suiteHash(d.inputs.bindings[step.node.binding]) === suiteHash(step.node.equals)
              : true;
          if (step.node.type === 'material' && !Object.hasOwn(d.inputs.bindings, step.node.binding))
            suiteFail('FLOW_BINDING_MISSING');
        }
        await this.event(scope(p), p.id, d.run, node.status === 'waiting' ? 'waiting' : 'returned', node.id, {
          status: node.status,
          outcome: node.outcome,
          receipt: node.receipt,
        });
        return this.persistRun(scope(p), row, d.run, d.definition);
      } catch (error) {
        node.status = 'unknown';
        node.outcome = null;
        node.error = '阶段意图已保存，但未获得完整结果；请核对原回执';
        try {
          await this.event(scope(p), p.id, d.run, 'failed', node.id, { code: 'FLOW_DISPATCH_UNKNOWN' });
          row = await this.persistRun(scope(p), row, d.run, d.definition);
        } catch {}
        throw error;
      }
    });
  }
  cancel(raw: z.input<typeof F.flowRunKey>) {
    return this.serial(async () => {
      const d = await this.current(F.flowRunKey.parse(raw));
      if (d.run.cancelled) return d.row;
      d.run.cancelled = true;
      for (const node of d.run.nodes) {
        if (['running', 'unknown'].includes(node.status) && node.plan) {
          const step = (await this.native(scope(d.p), node.plan, F.flowStepPlan, 'flow-plans')).value;
          if (step.providerPlan)
            try {
              this.applyReceipt(node, await this.connectors.cancel({ ticket: step.providerPlan.ticket }));
            } catch {
              node.status = 'unknown';
              node.error = '取消未取得原提供者的完整清理回执';
            }
          else {
            node.status = 'cancelled';
            node.outcome = null;
          }
        } else if (!['completed', 'failed'].includes(node.status)) {
          node.status = 'cancelled';
          node.outcome = null;
        }
      }
      await this.event(scope(d.p), d.p.id, d.run, 'cancelled', null, {
        reason: '当前账户终止后续阶段',
        originalResourcesRequireReceipt: true,
      });
      return this.persistRun(scope(d.p), d.row, d.run, d.definition);
    });
  }
  reconcile(raw: z.input<typeof F.flowNodeKey>) {
    return this.serial(async () => {
      const p = F.flowNodeKey.parse(raw),
        d = await this.current(p),
        node = d.run.nodes.find((n) => n.id === p.nodeId) ?? suiteFail('FLOW_NODE_UNKNOWN');
      if (!['running', 'unknown'].includes(node.status) || !node.plan) suiteFail('FLOW_RECONCILE_STATE');
      const step = (await this.native(scope(p), node.plan, F.flowStepPlan, 'flow-plans')).value;
      if (!step.providerPlan)
        suiteFail('FLOW_NO_ORIGINAL_RECEIPT', '本地中断阶段不能推断成功，请结束流程后重新创建');
      let receipt = await this.connectors.inspect({ ticket: step.providerPlan.ticket });
      const r = receipt.result as Record<string, S.SuiteJson> | null;
      if (
        r &&
        r.cleanupConfirmed === false &&
        ['cleanup-pending', 'effect-unknown', 'interrupted'].includes(String(r.state))
      )
        receipt = await this.connectors.reconcile({ ticket: step.providerPlan.ticket });
      if (
        node.receipt &&
        node.receipt.status === receipt.status &&
        suiteHash(node.receipt.result) === suiteHash(receipt.result)
      )
        return d.row;
      this.applyReceipt(node, receipt);
      if (node.status === 'running' && d.row.sequence >= 95) return d.row;
      await this.event(scope(p), p.id, d.run, 'reconciled', node.id, { status: node.status, receipt });
      return this.persistRun(scope(p), d.row, d.run, d.definition);
    });
  }
  wake(raw: z.input<typeof F.flowWake>) {
    consumer(['flow-timers']);
    return this.serial(async () => {
      const p = F.flowWake.parse(raw),
        d = await this.current(p),
        node = d.run.nodes.find((n) => n.id === p.nodeId) ?? suiteFail('FLOW_NODE_UNKNOWN');
      if (node.timerId === p.timerId && node.status === 'completed') return d.row;
      if (
        d.run.cancelled ||
        node.status !== 'waiting' ||
        node.until !== p.until ||
        Date.now() < Date.parse(p.until)
      )
        suiteFail('FLOW_WAIT_NOT_DUE');
      node.timerId = p.timerId;
      node.status = 'completed';
      node.outcome = true;
      await this.event(scope(p), p.id, d.run, 'woke', node.id, { timerId: p.timerId, until: p.until });
      return this.persistRun(scope(p), d.row, d.run, d.definition);
    });
  }
  override async close() {
    await this.gate;
    await super.close();
  }
}
export class FlowTimers extends FlowStore implements P.FlowTimersV1 {
  private gate: Promise<unknown> = Promise.resolve();
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: P.FlowDefinitionsV1,
    private runs: P.FlowRunsV1,
  ) {
    super('flow-timers', m, a, root, { 'flow-runs': runs });
  }
  private serial<T>(f: () => Promise<T>) {
    const task = this.gate.then(f);
    this.gate = task.catch(() => {});
    return task;
  }
  scheduleWait(raw: z.input<typeof F.flowWait>) {
    return this.serial(async () => {
      const p = F.flowWait.parse(raw),
        row = await this.runs.inspect({ ...scope(p), id: p.id }),
        run = F.flowRun.parse(row.content),
        node = run.nodes.find((n) => n.id === p.nodeId);
      if (
        run.cancelled ||
        node?.status !== 'waiting' ||
        node.until !== p.until ||
        Date.parse(p.until) > Date.now() + 30 * 86400000
      )
        suiteFail('FLOW_WAIT_STATE');
      const existing = (await this.list({ ...scope(p), limit: 100 })).items.find((r) => {
        const x = F.flowTimer.safeParse(r.content);
        return (
          x.success &&
          x.data.runId === p.id &&
          x.data.nodeId === p.nodeId &&
          ['scheduled', 'consumed', 'unknown'].includes(x.data.state)
        );
      });
      if (existing) return existing;
      return this.write(
        scope(p),
        '等待 · ' + p.nodeId,
        F.flowTimer.parse({
          format: 'sakura-flow-timer/1',
          runId: p.id,
          nodeId: p.nodeId,
          run: ref(row),
          until: p.until,
          state: 'scheduled',
          actor: suiteActor(),
          result: null,
        }),
        [ref(row)],
      );
    });
  }
  async due(raw: S.SuiteScope) {
    const p = S.suiteScope.parse(raw),
      rows = await this.list({ ...p, limit: 100 });
    return rows.items
      .filter((r) => F.flowTimer.safeParse(r.content).success)
      .map((timer) => ({
        timer,
        due:
          F.flowTimer.parse(timer.content).state === 'scheduled' &&
          Date.now() >= Date.parse(F.flowTimer.parse(timer.content).until),
      }));
  }
  release(raw: S.SuiteScope & { timer: S.SuiteRef }) {
    return this.serial(async () => {
      const p = F.flowSelect('timer').parse(raw),
        d = await this.native(scope(p), p.timer, F.flowTimer, this.domain),
        head = await this.head(scope(p), p.timer.id),
        value = F.flowTimer.parse(head.content);
      if (value.state === 'released') return head;
      if (!['scheduled', 'consumed', 'unknown'].includes(value.state) || Date.now() < Date.parse(value.until))
        suiteFail('FLOW_WAIT_NOT_DUE');
      let row = await this.write(scope(p), head.name, { ...value, state: 'consumed' }, head.references, head);
      try {
        const result = await this.runs.wake({
          ...scope(p),
          id: value.runId,
          nodeId: value.nodeId,
          timerId: row.id,
          until: value.until,
        });
        return this.write(
          scope(p),
          row.name,
          { ...value, state: 'released', result: ref(result) },
          [value.run, ref(result)],
          row,
        );
      } catch (error) {
        await this.write(scope(p), row.name, { ...value, state: 'unknown' }, row.references, row);
        throw error;
      }
    });
  }
  cancelWait(raw: S.SuiteScope & { timer: S.SuiteRef }) {
    return this.serial(async () => {
      const p = F.flowSelect('timer').parse(raw),
        d = await this.native(scope(p), p.timer, F.flowTimer, this.domain),
        head = await this.head(scope(p), p.timer.id),
        timer = F.flowTimer.parse(head.content);
      if (timer.state === 'released') suiteFail('FLOW_WAIT_ALREADY_RELEASED');
      return this.write(scope(p), head.name, { ...timer, state: 'cancelled' }, head.references, head);
    });
  }
  override async close() {
    await this.gate;
    await super.close();
  }
}
export class FlowWorkbench extends FlowStore implements P.FlowWorkbenchV1 {
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    private definitions: P.FlowDefinitionsV1,
    private domains: Peers,
  ) {
    super('flow-workbench', m, a, definitions, domains);
  }
  async view(raw: z.input<typeof F.flowViewRequest>) {
    const p = F.flowViewRequest.parse(raw);
    await this.access();
    const workspaces = await this.definitions.listWorkspaces(),
      domains: z.infer<typeof F.flowView>['domains'] = [];
    if (p.workspaceId)
      for (const [id, port] of Object.entries(this.domains)) {
        const page = await port.list({ workspaceId: p.workspaceId, cursor: p.cursor, limit: 20 });
        domains.push({
          id,
          records: page.items.map((row) =>
            F.flowSummary.parse(
              Object.fromEntries(
                Object.keys(F.flowSummary.shape).map((k) => [k, row[k as keyof S.SuiteRecord]]),
              ),
            ),
          ),
          next: page.next,
        });
      }
    return F.flowView.parse({ workspaces, domains });
  }
  async templates() {
    const id = '00000000-0000-4000-a000-000000000001',
      digest = '0'.repeat(64);
    return z.array(F.flowTemplate).parse([
      {
        id: 'review-and-release',
        name: '材料审阅与等待',
        description: '固定输入后逐阶段核对，人工批准不代表多人签署。',
        suggestedOnly: true,
        needsProvider: null,
        graph: {
          nodes: [
            { id: 'material', label: '核对材料', type: 'material', binding: 'message' },
            { id: 'review', label: '当前账户确认', type: 'approval', prompt: '确认固定材料与处理目的。' },
            {
              id: 'wait',
              label: '固定时间等待',
              type: 'wait',
              until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            },
          ],
          edges: [
            { from: 'material', to: 'review', on: 'success' },
            { from: 'review', to: 'wait', on: 'success' },
          ],
        },
      },
      {
        id: 'integration-release',
        name: '接口验证后人工放行',
        description: '先替换占位的工作区、场景、断言与镜像固定引用，再预览原隔离运行。',
        suggestedOnly: true,
        needsProvider: 'integration-run',
        graph: {
          nodes: [
            {
              id: 'verify',
              label: '原接口验证',
              type: 'provider',
              target: {
                adapter: 'integration-run',
                scope: { workspaceId: id },
                input: {
                  scenario: { id, revision: digest },
                  mock: null,
                  assertions: { id, revision: digest },
                  image: { assetId: digest, digest },
                  mode: 'functional',
                  requests: 1,
                  rate: 1,
                  durationSeconds: 60,
                  retainFields: [],
                },
                approveWrites: false,
              },
            },
            { id: 'release', label: '人工放行', type: 'approval', prompt: '核对原断言与资源清理回执。' },
          ],
          edges: [{ from: 'verify', to: 'release', on: 'success' }],
        },
      },
      {
        id: 'document-publish',
        name: '文稿批准后本机发布',
        description: '先替换占位的知识空间、文稿和已接受审阅引用。批准只覆盖原服务展示的本次发布。',
        suggestedOnly: true,
        needsProvider: 'knowledge-publish',
        graph: {
          nodes: [
            { id: 'review', label: '发布前确认', type: 'approval', prompt: '确认发布目标与文稿的适用范围。' },
            {
              id: 'publish',
              label: '原知识发布',
              type: 'provider',
              target: {
                adapter: 'knowledge-publish',
                spaceId: id,
                document: { id, revision: 1 },
                review: { id, revision: 1 },
              },
            },
          ],
          edges: [{ from: 'review', to: 'publish', on: 'success' }],
        },
      },
      {
        id: 'conditional-review',
        name: '条件分支核对',
        description: '比较固定标量；只进入匹配的分支，无脚本执行。',
        suggestedOnly: true,
        needsProvider: null,
        graph: {
          nodes: [
            { id: 'condition', label: '是否发布', type: 'condition', binding: 'publish', equals: true },
            {
              id: 'accept',
              label: '准备原服务发布',
              type: 'approval',
              prompt: '检查原知识文稿、审阅与发布目标后添加 provider 节点。',
            },
            { id: 'hold', label: '保留草稿', type: 'approval', prompt: '确认不发布。' },
          ],
          edges: [
            { from: 'condition', to: 'accept', on: 'success' },
            { from: 'condition', to: 'hold', on: 'failure' },
          ],
        },
      },
    ]);
  }
}
