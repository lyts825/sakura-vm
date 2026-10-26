/** 每个插件拥有自己的存储；复用原计划、保护引用和容量，固定算法在受管执行域运行。 */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { suiteHash, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { readSuiteText } from './suite-compute.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as T from '../shared/contracts/seventh-common.ts';
import catalog from '../shared/seventh-catalog.json';
import type { SeventhComputePortV1 } from '../shared/contracts/seventh-common.ts';
import type { SuiteExecutionSessionsV1 } from './service-contracts/seventh-execution.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import * as E from '../shared/contracts/seventh-execution.ts';
import { imageRefSchema } from '../shared/contracts/image-assets.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { suiteSha } from './suite-store.ts';
import { prepareLocalNotificationDelivery } from './seventh-creation-notifications.ts';
type Peers = Readonly<Record<string, S.SuiteRecordsV1>>;
const writing = new Set([
  'define',
  'configure',
  'save',
  'compose',
  'select',
  'connect',
  'allocate',
  'bind',
  'derive',
  'attach',
  'annotate',
  'classify',
  'resolve',
  'decide',
  'review',
  'record',
  'open',
  'edit',
  'defineSet',
  'saveView',
  'recordException',
  'expire',
  'prepare',
  'recordDecision',
  'importProfile',
  'proposeResolution',
]);
const pin = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision });
const toolIdentity = z
  .object({ manifestDigest: S.suiteDigest, workerDigest: S.suiteDigest, helperDigest: S.suiteDigest })
  .strict();
const nativeTicket = z
  .object({
    id: S.suiteId,
    reservationId: S.suiteId,
    workspaceId: S.suiteId,
    planId: S.suiteId,
    packId: z.string().max(128),
    action: z.string().max(128),
    toolIdentity,
    state: z.string().max(32),
    digest: S.suiteDigest,
  })
  .strict();
export class SeventhService extends SuiteMaterials {
  private operations = new Map<string, AbortController>();
  private tasks = new Set<Promise<unknown>>();
  private runLocks = new Set<string>();
  private inboxTail: Promise<unknown> = Promise.resolve();
  private recovering = new Map<string, Promise<z.infer<typeof T.seventhStatus>>>();
  readonly pack: (typeof catalog)[number];
  readonly member: (typeof catalog)[number]['members'][number];
  constructor(
    domain: string,
    metadata: PluginMetadata,
    uploads: PluginMetadata,
    authorize: SuiteAuthorize,
    root: S.SuiteMaterialsV1 | undefined,
    peers: Peers,
    private executionPort: SeventhComputePortV1,
    private lifetime: AbortSignal,
    private sessions?: SuiteExecutionSessionsV1,
    private assets?: ImageAssetsV1,
  ) {
    super(
      domain,
      metadata,
      uploads,
      authorize,
      2 * 1024 ** 3,
      256 * 1024 ** 2,
      ['json', 'csv', 'text', 'image', 'bundle', 'png', 'jpeg', 'webp', 'wav', 'mp4', 'site'],
      root,
    );
    this.pack = catalog.find((p) => p.members.some((m) => m.id === domain)) ?? suiteFail('SEVENTH_DOMAIN');
    this.member = this.pack.members.find((m) => m.id === domain)!;
    this.peers = peers;
    this.definition = S.suiteJson;
  }
  async templates(_input: Record<string, never> = {}): Promise<S.SuiteJson> {
    await this.authorize();
    const m =
      this.pack.group === 'data'
        ? await import('./seventh-data-compute.ts')
        : this.pack.group === 'creation'
          ? await import('./seventh-creation-compute.ts')
          : await import('./seventh-engineering-compute.ts');
    const value = Reflect.get(
      m,
      this.pack.group === 'data'
        ? 'SEVENTH_DATA_TEMPLATES'
        : this.pack.group === 'creation'
          ? 'SEVENTH_CREATION_TEMPLATES'
          : 'SEVENTH_ENGINEERING_TEMPLATES',
    );
    return S.suiteJson.parse(
      Array.isArray(value)
        ? value.filter((t: { packId?: string }) => t.packId === this.pack.id)
        : (value[this.pack.id] ?? []),
    );
  }
  async availableActions(_input: Record<string, never> = {}): Promise<string[]> {
    await this.authorize();
    const actions = await this.executionPort.actions();
    return this.sessions
      ? [...new Set([...actions, this.member.id.slice(this.pack.prefix.length + 1) + '.start'])]
      : actions;
  }
  async view(raw: S.SuiteScope): Promise<S.SuiteJson> {
    const scope = S.suiteScope.parse(raw);
    await this.access(scope);
    const domains = await Promise.all(
      Object.entries({ [this.domain]: this, ...this.peers }).map(async ([id, peer]) => {
        const page = await peer.list({ ...scope, limit: 10 });
        return {
          id,
          items: page.items.map(({ id, name, state, revision, kind, origin, createdAt }) => ({
            id,
            name,
            state,
            revision,
            kind,
            origin,
            createdAt,
          })),
          next: page.next,
        };
      }),
    );
    return S.suiteJson.parse({
      packId: this.pack.id,
      workspace: this.root ? await this.root.workspace(scope) : await this.workspace(scope),
      domains,
      actions: await this.availableActions(),
    });
  }
  async upload(raw: z.infer<typeof T.seventhUpload>): Promise<S.SuiteRecord> {
    const p = T.seventhUpload.parse(raw),
      data = Buffer.from(p.text, 'utf8');
    const u = await this.beginUpload({
      workspaceId: p.workspaceId,
      name: p.name,
      format: p.format,
      bytes: data.length,
      digest: await import('node:crypto').then(({ createHash }) =>
        createHash('sha256').update(data).digest('hex'),
      ),
      allowExport: p.allowExport,
    });
    for (let offset = 0; offset < data.length; offset += 512 * 1024)
      await this.appendUpload({
        workspaceId: p.workspaceId,
        id: u.id,
        offset,
        data: data.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ workspaceId: p.workspaceId, id: u.id });
  }
  override async beginUpload(raw: z.input<typeof T.seventhMaterialUpload>): Promise<S.SuiteUpload> {
    const input = T.seventhMaterialUpload.parse(raw),
      aliases = { jsonl: 'text', pdf: 'image', wasm: 'bundle', binary: 'bundle' } as const;
    const format = Object.hasOwn(aliases, input.format)
      ? aliases[input.format as keyof typeof aliases]
      : S.suiteUploadInput.shape.format.parse(input.format);
    const upload = await super.beginUpload({ ...input, format });
    if (format !== input.format) {
      const scope = { workspaceId: input.workspaceId };
      const plan = await this.plan(
        scope,
        'seventh-upload-format',
        { uploadId: upload.id, format: input.format },
        [],
      );
      await this.consume({ ...scope, planId: plan.id, digest: plan.digest }, 'seventh-upload-format');
    }
    return upload;
  }
  override async finishUpload(raw: S.SuiteScope & { id: string }): Promise<S.SuiteRecord> {
    const input = S.suiteScope.extend({ id: S.suiteId }).strict().parse(raw),
      scope = { workspaceId: input.workspaceId };
    const formats = (await this.readState()).plans.filter(
      (p) =>
        p.action === 'seventh-upload-format' &&
        p.workspaceId === input.workspaceId &&
        p.input &&
        typeof p.input === 'object' &&
        !Array.isArray(p.input) &&
        p.input.uploadId === input.id,
    );
    const plan = formats.at(-1);
    if (plan?.result) return this.get({ ...scope, id: plan.result.id, revision: plan.result.revision });
    const row = await super.finishUpload(input);
    if (!plan) return row;
    const desired = z
      .object({ uploadId: S.suiteId, format: T.seventhMaterialUpload.shape.format })
      .strict()
      .parse(plan.input);
    const existing = (await this.readState()).rows
      .filter(
        (r) =>
          r.id === row.id &&
          r.kind === 'source' &&
          r.content &&
          typeof r.content === 'object' &&
          !Array.isArray(r.content) &&
          r.content.format === desired.format,
      )
      .at(-1);
    const result =
      existing ??
      (await this.put(
        {
          ...scope,
          id: row.id,
          expectedRevision: row.revision,
          name: row.name,
          content: S.suiteJson.parse({ ...S.suiteMaterial.parse(row.content), format: desired.format }),
          references: row.references,
        },
        'source',
        true,
      ));
    await this.complete(plan, result);
    return result;
  }
  private async payload(
    p: T.SeventhAction,
  ): Promise<{ input: Record<string, S.SuiteJson>; references: S.SuiteRef[] }> {
    const input = { ...p.input };
    const references = [...p.references];
    for (const [field, binding] of Object.entries(p.bindings)) {
      const spec = 'ref' in binding ? binding : { ref: binding, path: [], encoding: undefined };
      const ref = spec.ref;
      if (Object.hasOwn(input, field)) suiteFail('SEVENTH_BINDING_COLLISION', '输入字段和来源绑定重名', 400);
      const row = await this.fixed({ workspaceId: p.workspaceId }, ref);
      references.push(ref);
      if (row.kind === 'source') {
        const provider = (ref.domain === this.domain ? this : this.peers[ref.domain]) as
          S.SuiteByteMaterialsV1 | undefined;
        if (!provider || typeof provider.openRead !== 'function') suiteFail('SEVENTH_MATERIAL_DEPENDENCY');
        const material = S.suiteMaterial.parse(row.content);
        if (material.bytes > 1024 * 1024)
          suiteFail('SEVENTH_BINDING_LIMIT', '首版可计算材料最多1MiB；较大材料可保存及交接', 413);
        const encoding =
          spec.encoding ?? (/Base64$/.test(field) ? 'base64' : material.format === 'json' ? 'json' : 'text');
        if (encoding === 'base64') {
          const lease = await provider.openRead({
              workspaceId: p.workspaceId,
              id: ref.id,
              revision: ref.revision,
            }),
            parts: Buffer[] = [];
          try {
            for (let offset = 0; offset < material.bytes;) {
              const chunk = await provider.readLease({
                workspaceId: p.workspaceId,
                id: lease.id,
                offset,
                length: Math.min(512 * 1024, material.bytes - offset),
              });
              const data = Buffer.from(chunk.data, 'base64');
              if (!data.length || chunk.offset !== offset + data.length)
                suiteFail('SEVENTH_MATERIAL_PROTOCOL');
              parts.push(data);
              offset = chunk.offset;
            }
            const data = Buffer.concat(parts);
            if (suiteSha(data) !== material.digest) suiteFail('SEVENTH_MATERIAL_DIGEST');
            input[field] = data.toString('base64');
          } finally {
            await provider.closeRead({ workspaceId: p.workspaceId, id: lease.id });
          }
        } else {
          if (!['json', 'jsonl', 'csv', 'text'].includes(material.format))
            suiteFail('SEVENTH_BINDING_ENCODING', '二进制材料须显式选择base64绑定', 422);
          const value = await readSuiteText(provider, { workspaceId: p.workspaceId }, ref, 1024 * 1024);
          if (encoding === 'json') {
            const parsed: unknown = JSON.parse(value.text);
            if (!S.isSuiteJsonBounded(parsed))
              suiteFail('SEVENTH_BINDING_CONTENT', '材料含保留字段或超出允许结构', 400);
            input[field] = S.suiteJson.parse(parsed);
          } else input[field] = value.text;
        }
      } else input[field] = row.content;
      for (const part of spec.path) {
        if (['__proto__', 'prototype', 'constructor'].includes(String(part)))
          suiteFail('SEVENTH_BINDING_PATH');
        const value = input[field];
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, part))
          suiteFail('SEVENTH_BINDING_PATH', '所选原修订没有该字段', 422);
        input[field] = Reflect.get(value, String(part)) as S.SuiteJson;
      }
    }
    const fixed = [...new Map(references.map((r) => [`${r.domain}/${r.id}/${r.revision}`, r])).values()];
    if (fixed.length > 100 || Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 ** 2)
      suiteFail('SEVENTH_PLAN_LIMIT', '完整计划最多2MiB、100个固定引用', 413);
    return { input, references: fixed };
  }
  async previewAction(raw: z.infer<typeof T.seventhPreview>): Promise<S.SuitePlan> {
    const p = T.seventhPreview.parse(raw);
    if (!this.member.methods.includes(p.method)) suiteFail('SEVENTH_METHOD', '未声明的领域动作', 400);
    const payload = await this.payload(p);
    const action = this.member.id.slice(this.pack.prefix.length + 1) + '.' + p.method;
    if (this.domain === 'ntpl-inboxes' && p.method === 'deliverLocal') {
      if (Object.hasOwn(payload.input, 'existingKeys'))
        suiteFail('SEVENTH_DELIVERY_KEYS_SERVER_OWNED', '投递去重键由宿主原账本提供', 400);
      prepareLocalNotificationDelivery(payload.input);
    }
    let provider: E.SuiteExecutionPlan | undefined;
    if (this.sessions && p.method === 'start') {
      const { image, maxSeconds, ...workerInput } = payload.input;
      const selected = imageRefSchema.parse(image),
        seconds = maxSeconds === undefined ? 120 : z.number().int().min(1).max(900).parse(maxSeconds);
      provider = await this.sessions.preview({
        workspaceId: p.workspaceId,
        image: selected,
        input: S.suiteJson.parse(workerInput),
        inputDigest: suiteHash(workerInput),
        maxSeconds: seconds,
      });
      payload.input = workerInput;
    } else if (!(await this.executionPort.actions()).includes(action))
      suiteFail('SEVENTH_ACTION_UNSUPPORTED', '此动作尚未提供计算实现；定义编辑请使用保存入口', 422);
    const tool = provider ? null : await this.executionPort.toolIdentity(action, this.lifetime);
    return this.plan(
      { workspaceId: p.workspaceId },
      'seventh:' + p.method,
      S.suiteJson.parse({
        method: p.method,
        name: p.name ?? this.member.name,
        input: payload.input,
        inputDigest: suiteHash(payload.input),
        toolIdentity: tool,
        ...(provider ? { provider } : {}),
      }),
      payload.references,
    );
  }
  async executeAction(raw: S.SuiteApproval): Promise<S.SuiteRecord> {
    const p = S.suiteApproval.parse(raw);
    if (this.runLocks.has(p.planId)) suiteFail('SEVENTH_RUNNING', '原计划仍在处理');
    this.runLocks.add(p.planId);
    try {
      if (this.domain === 'ntpl-inboxes') {
        const task = this.inboxTail.then(() => this.executeWithRecovery(p));
        this.inboxTail = task.catch(() => {});
        return await task;
      }
      return await this.executeWithRecovery(p);
    } finally {
      this.runLocks.delete(p.planId);
    }
  }
  private async executeWithRecovery(p: S.SuiteApproval): Promise<S.SuiteRecord> {
    try {
      return await this.executePlan(p);
    } catch (error) {
      if (this.lifetime.aborted) throw error;
      const plan = await this.inspectPlan({ workspaceId: p.workspaceId, planId: p.planId });
      const content = T.seventhPayload.parse(plan.input);
      if (plan.state === 'consumed' && plan.result && (content.toolIdentity || content.provider)) {
        const recovered = await this.reconcile({ workspaceId: p.workspaceId, planId: plan.id });
        if (recovered.plan.state === 'completed' && recovered.result) return recovered.result;
      }
      throw error;
    }
  }
  private async executePlan(raw: S.SuiteApproval): Promise<S.SuiteRecord> {
    const p = S.suiteApproval.parse(raw),
      original = await this.inspectPlan({ workspaceId: p.workspaceId, planId: p.planId });
    if (!original.action.startsWith('seventh:')) suiteFail('SEVENTH_PLAN_ACTION');
    const method = original.action.slice(8),
      plan = await this.consume(p, original.action, true);
    if (plan.state === 'completed' && plan.result) {
      await this.releaseEvidenceHold(plan);
      return this.get({ workspaceId: p.workspaceId, id: plan.result.id, revision: plan.result.revision });
    }
    if (this.operations.has(plan.id)) suiteFail('SEVENTH_RUNNING', '原任务仍在运行，请查询原计划');
    // 消费后没有运行中记录即可能经历重启；必须先有本次新消费证据。
    if (original.state === 'consumed')
      suiteFail('SEVENTH_INTERRUPTED', '原任务已中断，保留原计划，不自动重发');
    const content = z
      .object({
        method: z.string(),
        name: S.suiteName,
        input: T.seventhPayload,
        inputDigest: S.suiteDigest,
        toolIdentity: toolIdentity.nullable().optional(),
        provider: E.suiteExecutionPlan.optional(),
      })
      .strict()
      .parse(plan.input);
    if (suiteHash(content.input) !== content.inputDigest) suiteFail('SEVENTH_PLAN_DIGEST');
    const abort = new AbortController();
    this.operations.set(plan.id, abort);
    const task = (async () => {
      let record: S.SuiteRecord;
      try {
        const action = this.member.id.slice(this.pack.prefix.length + 1) + '.' + method;
        const records = await Promise.all(
          plan.references.map((ref) => this.fixed({ workspaceId: p.workspaceId }, ref)),
        );
        let runtimeInput = content.input;
        if (this.domain === 'ntpl-inboxes' && method === 'deliverLocal') {
          const keys = new Set<string>();
          for (const prior of (await this.readState()).plans) {
            if (
              prior.id === plan.id ||
              prior.workspaceId !== plan.workspaceId ||
              !['consumed', 'completed'].includes(prior.state) ||
              prior.action !== 'seventh:deliverLocal'
            )
              continue;
            const data = T.seventhPayload.parse(prior.input);
            const entries = prepareLocalNotificationDelivery(T.seventhPayload.parse(data.input)).entries;
            for (const entry of entries) keys.add(entry.key);
            if (keys.size > 10000)
              suiteFail('SEVENTH_DELIVERY_KEY_LIMIT', '当前空间的本地投递去重记录超过一万键，请另建空间');
          }
          runtimeInput = { ...content.input, existingKeys: [...keys] };
        }
        const signal = AbortSignal.any([abort.signal, this.lifetime]);
        const output = content.provider
          ? await this.runVm(plan, content.provider, content.name, signal)
          : content.toolIdentity
            ? await this.runNative(
                plan,
                action,
                runtimeInput,
                content.name,
                content.toolIdentity,
                records,
                signal,
              )
            : await this.executionPort.execute(
                {
                  action,
                  input: runtimeInput,
                  workspaceId: p.workspaceId,
                  planId: plan.id,
                  records,
                  toolIdentity: content.toolIdentity,
                },
                signal,
              );
        await this.assertPlan(plan);
        const evidence =
          content.provider || content.toolIdentity
            ? (await this.inspectPlan({ workspaceId: p.workspaceId, planId: plan.id })).result
            : null;
        const resultReferences = [...plan.references, ...(evidence ? [evidence] : [])];
        if (!content.provider && (await this.executionPort.lifecycle(action))) {
          const product = z
            .object({
              kind: z.enum(['definition', 'review', 'result']),
              content: S.suiteJson,
              references: z.array(S.suiteRef).max(1000),
              seal: z.boolean(),
            })
            .strict()
            .parse(output);
          record = await this.put(
            {
              workspaceId: p.workspaceId,
              name: content.name,
              content: product.content,
              references: product.references,
            },
            product.kind,
            product.seal,
          );
        } else {
          const receipt = content.provider
            ? (output as { receipt?: E.SuiteExecutionReceipt }).receipt
            : undefined;
          const state = receipt
            ? receipt.state === 'completed'
              ? 'completed'
              : receipt.state === 'cancelled'
                ? 'cancelled'
                : 'failed'
            : 'completed';
          record = await this.put(
            {
              workspaceId: p.workspaceId,
              name: content.name,
              content: S.suiteJson.parse({
                format: 'sakura-seventh-result/1',
                packId: this.pack.id,
                planId: plan.id,
                action: method,
                inputDigest: content.inputDigest,
                state,
                output,
                ...(evidence ? { evidence } : {}),
              }),
              references: resultReferences,
            },
            'result',
            true,
          );
        }
      } catch (error) {
        if (this.lifetime.aborted) throw error;
        const e = error as Error & { code?: string };
        if (
          [
            'SEVENTH_EXECUTION_CLEANUP_PENDING',
            'NATIVE_CLEANUP_PENDING',
            'NATIVE_CAPACITY_CLEANUP_PENDING',
          ].includes(e.code ?? '')
        )
          throw error;
        if (
          content.provider &&
          (await this.inspectPlan({ workspaceId: p.workspaceId, planId: plan.id })).result
        )
          throw error;
        if (
          content.toolIdentity &&
          (await this.inspectPlan({ workspaceId: p.workspaceId, planId: plan.id })).result
        )
          throw error;
        record = await this.put(
          {
            workspaceId: p.workspaceId,
            name: content.name,
            content: {
              format: 'sakura-seventh-result/1',
              packId: this.pack.id,
              planId: plan.id,
              action: method,
              inputDigest: content.inputDigest,
              state: abort.signal.aborted ? 'cancelled' : 'failed',
              error: { code: e.code ?? 'SEVENTH_FAILED', message: e.message.slice(0, 1000) },
            },
            references: plan.references,
          },
          'result',
          true,
        );
      }
      await this.complete(plan, record);
      return record;
    })();
    this.tasks.add(task);
    try {
      return await task;
    } finally {
      this.tasks.delete(task);
      this.operations.delete(plan.id);
    }
  }
  async status(raw: z.infer<typeof T.seventhJob>): Promise<z.infer<typeof T.seventhStatus>> {
    const p = T.seventhJob.parse(raw),
      plan = await this.inspectPlan(p);
    const result = plan.result
      ? await this.get({ workspaceId: p.workspaceId, id: plan.result.id, revision: plan.result.revision })
      : null;
    const saved = result?.content as { state?: string } | undefined;
    const state =
      plan.state === 'ready'
        ? 'ready'
        : this.operations.has(plan.id)
          ? 'running'
          : plan.state === 'completed'
            ? saved?.state === 'failed'
              ? 'failed'
              : saved?.state === 'cancelled'
                ? 'cancelled'
                : 'completed'
            : 'interrupted';
    return { plan, state, result };
  }
  async cancel(raw: z.infer<typeof T.seventhJob>) {
    const p = T.seventhJob.parse(raw);
    await this.inspectPlan(p);
    this.operations.get(p.planId)?.abort(new Error('任务已取消'));
    return this.status(p);
  }
  async reconcile(raw: z.infer<typeof T.seventhJob>) {
    const input = T.seventhJob.parse(raw);
    await this.inspectPlan(input);
    const existing = this.recovering.get(input.planId);
    if (existing) return existing;
    const task = this.reconcilePlan(input);
    this.recovering.set(input.planId, task);
    try {
      return await task;
    } finally {
      this.recovering.delete(input.planId);
    }
  }
  private async reconcilePlan(raw: z.infer<typeof T.seventhJob>) {
    const p = T.seventhJob.parse(raw);
    let plan = await this.inspectPlan(p);
    if (plan.state === 'completed') {
      await this.releaseEvidenceHold(plan);
      return this.status(p);
    }
    if (plan.state !== 'consumed' || this.operations.has(plan.id)) return this.status(p);
    if (!plan.result) {
      const definition = T.seventhPayload.parse(plan.input);
      if (definition.provider && this.sessions) {
        const provider = E.suiteExecutionPlan.parse(definition.provider);
        const receipt = await this.sessions.resolve({ workspaceId: p.workspaceId, planId: provider.id });
        if (!receipt) return this.status(p);
        const intent = await this.put(
          {
            workspaceId: p.workspaceId,
            name: String(definition.name),
            content: S.suiteJson.parse({
              format: 'sakura-seventh-execution-intent/1',
              planId: plan.id,
              provider,
              sessionId: receipt.id,
              cleanup: receipt.cleanup,
              recovered: true,
            }),
            references: plan.references,
          },
          'result',
          true,
        );
        await this.rememberEvidence(plan, intent);
        plan = await this.inspectPlan(p);
      } else {
        if (!definition.toolIdentity) return this.status(p);
        try {
          const recovered = await this.executionPort.reconcileNative(
            { workspaceId: p.workspaceId, planId: plan.id },
            this.lifetime,
          );
          const ticket = nativeTicket.parse(recovered.ticket);
          if (
            ticket.planId !== plan.id ||
            ticket.workspaceId !== plan.workspaceId ||
            ticket.packId !== this.pack.id
          )
            suiteFail('SEVENTH_NATIVE_INTENT_CHANGED');
          const intent = await this.put(
            {
              workspaceId: p.workspaceId,
              name: String(definition.name),
              content: S.suiteJson.parse({
                format: 'sakura-seventh-native-intent/1',
                planId: plan.id,
                ticket,
                cleanup: recovered.cleanup,
                recovered: true,
              }),
              references: plan.references,
            },
            'result',
            true,
          );
          await this.rememberEvidence(plan, intent);
          plan = await this.inspectPlan(p);
        } catch (error) {
          if ((error as { code?: string }).code === 'NATIVE_TASK_NOT_FOUND') return this.status(p);
          throw error;
        }
      }
    }
    if (!plan.result) return this.status(p);
    const saved = await this.get({
      workspaceId: p.workspaceId,
      id: plan.result.id,
      revision: plan.result.revision,
    });
    const value = T.seventhPayload.parse(saved.content),
      content = T.seventhPayload.parse(plan.input);
    if (['sakura-seventh-native-intent/1', 'sakura-seventh-native-output/1'].includes(String(value.format))) {
      const savedOutput = value.format === 'sakura-seventh-native-output/1';
      const recovery = savedOutput
        ? undefined
        : await this.executionPort.reconcileNative(
            { workspaceId: p.workspaceId, planId: plan.id },
            this.lifetime,
          );
      if (recovery && recovery.cleanup !== 'confirmed') return this.status(p);
      const ticket = nativeTicket.parse(savedOutput ? value.ticket : recovery!.ticket);
      if (
        ticket.planId !== plan.id ||
        ticket.workspaceId !== plan.workspaceId ||
        ticket.packId !== this.pack.id
      )
        suiteFail('SEVENTH_NATIVE_INTENT_CHANGED');
      const output = savedOutput ? value.output : recovery!.output,
        error = savedOutput ? value.error : recovery!.error;
      const staged = savedOutput
        ? saved
        : await this.put(
            {
              workspaceId: p.workspaceId,
              name: String(content.name) + ' · 原工具结果',
              content: S.suiteJson.parse({
                format: 'sakura-seventh-native-output/1',
                planId: plan.id,
                ticket,
                output: output ?? null,
                error: error ?? null,
                state: recovery!.state,
                cleanup: 'pending',
              }),
              references: [...plan.references, pin(saved)],
            },
            'result',
            true,
          );
      await this.rememberEvidence(plan, staged);
      await this.executionPort.acknowledgeNative({
        workspaceId: p.workspaceId,
        planId: plan.id,
        id: ticket.id,
        reference: pin(staged),
      });
      await this.assertPlan(plan);
      const businessState = savedOutput ? String(value.state) : recovery!.state;
      const state =
        businessState === 'completed' ? 'completed' : businessState === 'cancelled' ? 'cancelled' : 'failed';
      const result = await this.put(
        {
          workspaceId: p.workspaceId,
          name: String(content.name),
          content: S.suiteJson.parse({
            format: 'sakura-seventh-result/1',
            packId: this.pack.id,
            planId: plan.id,
            action: content.method,
            inputDigest: content.inputDigest,
            state,
            output: output ?? null,
            error: error ?? null,
            recovered: true,
            evidence: pin(staged),
          }),
          references: [...plan.references, pin(staged)],
        },
        'result',
        true,
      );
      await this.complete(plan, result);
      return this.status(p);
    }
    if (!this.sessions) return this.status(p);
    if (!['sakura-seventh-execution-intent/1', 'sakura-seventh-vm-output/1'].includes(String(value.format)))
      return this.status(p);
    const staged = value.format === 'sakura-seventh-vm-output/1';
    const id = staged ? E.suiteExecutionReceipt.parse(value.receipt).id : S.suiteId.parse(value.sessionId);
    const receipt = await this.sessions.reconcile({ workspaceId: p.workspaceId, id });
    if (receipt.cleanup !== 'confirmed') return this.status(p);
    const output = await this.finishVm(
      plan,
      receipt,
      String(content.name),
      staged ? undefined : saved,
      staged ? saved : undefined,
    );
    await this.assertPlan(plan);
    const state =
      receipt.state === 'completed' ? 'completed' : receipt.state === 'cancelled' ? 'cancelled' : 'failed';
    const result = await this.put(
      {
        workspaceId: p.workspaceId,
        name: String(content.name),
        content: S.suiteJson.parse({
          format: 'sakura-seventh-result/1',
          packId: this.pack.id,
          planId: plan.id,
          action: content.method,
          inputDigest: content.inputDigest,
          state,
          output,
          recovered: true,
        }),
        references: [
          ...plan.references,
          ...((output as { evidence?: S.SuiteRef }).evidence
            ? [(output as { evidence: S.SuiteRef }).evidence]
            : []),
        ],
      },
      'result',
      true,
    );
    await this.complete(plan, result);
    return this.status(p);
  }
  override async archive(raw: S.SuitePin | (S.SuiteScope & { expectedRevision: number })): Promise<any> {
    if (this.domain === this.pack.root && 'expectedRevision' in raw)
      return this.revokeWorkspace({ ...raw, revoked: true });
    return super.archive(S.suitePin.parse(raw));
  }
  async tool() {
    await this.authorize();
    return this.sessions ? this.sessions.tool() : suiteFail('SEVENTH_EXECUTION_UNAVAILABLE');
  }
  async images() {
    await this.authorize();
    return this.assets ? this.assets.list() : suiteFail('SEVENTH_IMAGE_UNAVAILABLE');
  }
  private async imageProvider() {
    await this.authorize();
    if (!this.assets || !this.sessions) suiteFail('SEVENTH_IMAGE_UNAVAILABLE');
    return this.assets;
  }
  async beginImageImport(
    raw: Pick<
      import('../shared/contracts/image-assets.ts').ImageUpload,
      'digest' | 'bytes' | 'distro' | 'architecture' | 'source'
    >,
  ) {
    const assets = await this.imageProvider();
    if (raw.distro !== 'alpine' || raw.architecture !== 'x86_64') suiteFail('SEVENTH_IMAGE_PLATFORM');
    return assets.begin(raw);
  }
  async appendImageImport(raw: { id: string; offset: number; data: string }) {
    return (await this.imageProvider()).append(raw.id, raw.offset, raw.data);
  }
  async finishImageImport(raw: { id: string }) {
    return (await this.imageProvider()).finish(raw.id);
  }
  async imageImports(_raw: Record<string, never> = {}) {
    return (await this.imageProvider()).uploads();
  }
  async discardImageImport(raw: { id: string }): Promise<{ discarded: true }> {
    await (await this.imageProvider()).discardUpload(raw.id);
    return { discarded: true };
  }
  async verifyImage(raw: import('../shared/contracts/image-assets.ts').ImageRef) {
    return (await this.imageProvider()).verify(imageRefSchema.parse(raw));
  }
  private async assertPlan(plan: S.SuitePlan) {
    const scope = { workspaceId: plan.workspaceId };
    await this.access(scope);
    const space = this.root ? await this.root.workspace(scope) : await this.workspace(scope);
    if (space.policyRevision !== plan.workspacePolicyRevision) suiteFail('SEVENTH_WORKSPACE_CHANGED');
    for (const guard of plan.permissions) {
      const row = await this.fixed(scope, guard.ref);
      if (
        row.policyRevision !== guard.policyRevision ||
        (row.authorizationDigest ?? suiteHash(row.policyRevision)) !== guard.policyDigest
      )
        suiteFail('SEVENTH_SOURCE_CHANGED');
    }
  }
  /** 指针与保护同一事务落盘；未保护原证据前不能删除提供者的结果缓存。 */
  private async rememberEvidence(plan: S.SuitePlan, record: S.SuiteRecord) {
    const holder = this.domain + ':seventh-plan:' + plan.id;
    await this.edit((state) => {
      const current = state.plans.find((row) => row.id === plan.id && row.workspaceId === plan.workspaceId);
      const evidence = state.rows.find(
        (row) =>
          row.id === record.id && row.revision === record.revision && row.workspaceId === plan.workspaceId,
      );
      if (!current || current.state !== 'consumed' || !evidence || evidence.state !== 'sealed')
        suiteFail('SEVENTH_EVIDENCE_UNAVAILABLE');
      state.holds = state.holds.filter((hold) => hold.holder !== holder || hold.consumer !== this.domain);
      state.holds.push({ id: evidence.id, revision: evidence.revision, holder, consumer: this.domain });
      current.result = pin(evidence);
    }, true);
  }
  private async releaseEvidenceHold(plan: S.SuitePlan) {
    const holder = this.domain + ':seventh-plan:' + plan.id;
    if (
      !(await this.readState()).holds.some((hold) => hold.holder === holder && hold.consumer === this.domain)
    )
      return;
    await this.edit((state) => {
      if (
        !state.plans.some(
          (row) => row.id === plan.id && row.workspaceId === plan.workspaceId && row.state === 'completed',
        )
      )
        suiteFail('SEVENTH_EVIDENCE_RELEASE_NOT_READY');
      state.holds = state.holds.filter((hold) => hold.holder !== holder || hold.consumer !== this.domain);
    }, true);
  }
  protected override async complete(plan: S.SuitePlan, result: S.SuiteRecord): Promise<void> {
    await super.complete(plan, result);
    await this.releaseEvidenceHold(plan);
  }
  private async runNative(
    plan: S.SuitePlan,
    action: string,
    input: Record<string, S.SuiteJson>,
    name: string,
    tool: T.SeventhToolIdentity,
    records: S.SuiteRecord[],
    signal: AbortSignal,
  ): Promise<S.SuiteJson> {
    const ticket = nativeTicket.parse(
      await this.executionPort.prepareNative(
        { workspaceId: plan.workspaceId, planId: plan.id, action, toolIdentity: tool },
        signal,
      ),
    );
    if (
      ticket.planId !== plan.id ||
      ticket.workspaceId !== plan.workspaceId ||
      ticket.packId !== this.pack.id ||
      ticket.action !== action ||
      suiteHash(ticket.toolIdentity) !== suiteHash(tool)
    )
      suiteFail('SEVENTH_NATIVE_INTENT_CHANGED');
    const intent = await this.put(
      {
        workspaceId: plan.workspaceId,
        name,
        content: S.suiteJson.parse({
          format: 'sakura-seventh-native-intent/1',
          planId: plan.id,
          ticket,
          cleanup: 'pending',
        }),
        references: plan.references,
      },
      'result',
      true,
    );
    await this.rememberEvidence(plan, intent);
    if (ticket.state !== 'prepared')
      suiteFail('SEVENTH_NATIVE_PREPARE_INCOMPLETE', '原生准备未完成，核对原票据后恢复');
    const output = await this.executionPort.execute(
      {
        action,
        input,
        workspaceId: plan.workspaceId,
        planId: plan.id,
        records,
        toolIdentity: tool,
        nativeIntentId: ticket.id,
      },
      signal,
    );
    const staged = await this.put(
      {
        workspaceId: plan.workspaceId,
        name: name + ' · 原工具结果',
        content: S.suiteJson.parse({
          format: 'sakura-seventh-native-output/1',
          planId: plan.id,
          ticket,
          output,
          state: 'completed',
          cleanup: 'pending',
        }),
        references: [...plan.references, pin(intent)],
      },
      'result',
      true,
    );
    await this.rememberEvidence(plan, staged);
    await this.executionPort.acknowledgeNative({
      workspaceId: plan.workspaceId,
      planId: plan.id,
      id: ticket.id,
      reference: pin(staged),
    });
    return output;
  }
  private async runVm(
    plan: S.SuitePlan,
    provider: E.SuiteExecutionPlan,
    name: string,
    signal: AbortSignal,
  ): Promise<S.SuiteJson> {
    if (!this.sessions) suiteFail('SEVENTH_EXECUTION_UNAVAILABLE');
    let original: S.SuiteRecord | undefined;
    let receipt = await this.sessions.start(
      { workspaceId: plan.workspaceId, planId: provider.id, digest: provider.digest },
      async (challenge) => {
        await this.access({ workspaceId: plan.workspaceId });
        if (
          challenge.planId !== provider.id ||
          challenge.digest !== provider.digest ||
          challenge.inputDigest !== provider.inputDigest
        )
          suiteFail('SEVENTH_EXECUTION_CHALLENGE');
        original = await this.put(
          {
            workspaceId: plan.workspaceId,
            name,
            content: S.suiteJson.parse({
              format: 'sakura-seventh-execution-intent/1',
              planId: plan.id,
              provider,
              sessionId: challenge.sessionId,
              cleanup: 'pending',
            }),
            references: plan.references,
          },
          'result',
          true,
        );
        await this.rememberEvidence(plan, original!);
        return { intentDigest: suiteHash(original.content) };
      },
      async () => this.assertPlan(plan),
    );
    let cancelled = false;
    while (['preparing', 'running'].includes(receipt.state)) {
      if (signal.aborted && !cancelled) {
        cancelled = true;
        receipt = await this.sessions.cancel({ workspaceId: plan.workspaceId, id: receipt.id });
      } else {
        await delay(250);
        receipt = await this.sessions.inspect({ workspaceId: plan.workspaceId, id: receipt.id });
      }
    }
    const cleanupDeadline = Math.min(Date.parse(receipt.deadline) + 10000, Date.now() + 30000);
    while (receipt.cleanup !== 'confirmed' && Date.now() < cleanupDeadline) {
      receipt = await this.sessions.reconcile({ workspaceId: plan.workspaceId, id: receipt.id });
      if (receipt.cleanup === 'confirmed') break;
      await delay(250);
    }
    if (receipt.cleanup !== 'confirmed')
      suiteFail('SEVENTH_EXECUTION_CLEANUP_PENDING', '原客户机尚未确认退出');
    return this.finishVm(plan, receipt, name, original);
  }
  private async finishVm(
    plan: S.SuitePlan,
    receipt: E.SuiteExecutionReceipt,
    name: string,
    original?: S.SuiteRecord,
    saved?: S.SuiteRecord,
  ): Promise<S.SuiteJson> {
    if (!this.sessions) suiteFail('SEVENTH_EXECUTION_UNAVAILABLE');
    let output: S.SuiteJson = saved ? T.seventhPayload.parse(saved.content).output : null;
    if (!saved && receipt.output) {
      const parts: Buffer[] = [];
      for (let offset = 0; offset < receipt.output.bytes;) {
        const part = await this.sessions.output({
          workspaceId: plan.workspaceId,
          id: receipt.id,
          offset,
          length: Math.min(512 * 1024, receipt.output.bytes - offset),
        });
        const data = Buffer.from(part.data, 'base64');
        if (
          !data.length ||
          part.offset !== offset + data.length ||
          part.digest !== receipt.output.digest ||
          part.total !== receipt.output.bytes
        )
          suiteFail('SEVENTH_OUTPUT_PROTOCOL');
        parts.push(data);
        offset = part.offset;
      }
      const data = Buffer.concat(parts);
      if (suiteSha(data) !== receipt.output.digest) suiteFail('SEVENTH_OUTPUT_DIGEST');
      output = S.suiteJson.parse(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(data)));
    }
    const staged =
      saved ??
      (await this.put(
        {
          workspaceId: plan.workspaceId,
          name: name + ' · 原工具结果',
          content: S.suiteJson.parse({
            format: 'sakura-seventh-vm-output/1',
            planId: plan.id,
            receipt,
            output,
            materialCleanup: 'pending',
          }),
          references: [...plan.references, ...(original ? [pin(original)] : [])],
        },
        'result',
        true,
      ));
    await this.rememberEvidence(plan, staged);
    const releaseDeadline = Date.now() + 5000;
    for (;;) {
      try {
        await this.sessions.release({ workspaceId: plan.workspaceId, id: receipt.id });
        break;
      } catch (error) {
        if (
          (error as { code?: string }).code !== 'SUITE_EXECUTION_CLEANUP_PENDING' ||
          Date.now() >= releaseDeadline
        )
          throw error;
        await delay(100);
      }
    }
    return S.suiteJson.parse({ receipt, output, materialCleanup: 'confirmed', evidence: pin(staged) });
  }
  async perform(method: string, raw: unknown): Promise<S.SuiteJson> {
    if (!this.member.methods.includes(method)) suiteFail('SEVENTH_METHOD');
    if (method === 'create' && this.member.id === this.pack.root)
      return S.suiteJson.parse(
        await this.createWorkspace(z.object({ name: S.suiteName }).strict().parse(raw)),
      );
    if (method === 'erasePreview' && this.domain === 'fform-submissions') {
      if (raw && typeof raw === 'object' && 'planId' in raw)
        return S.suiteJson.parse(await this.cleanup(S.suiteApproval.parse(raw)));
      const input = T.seventhAction.parse(raw),
        refs = input.references;
      if (
        !refs.length ||
        refs.length > 50 ||
        Object.keys(input.input).length ||
        Object.keys(input.bindings).length
      )
        suiteFail('SEVENTH_PREVIEW_ERASE_INPUT', '仅能选择本域 1..50 个本地试填固定记录', 400);
      for (const ref of refs) {
        if (ref.domain !== this.domain) suiteFail('SEVENTH_PREVIEW_ERASE_DOMAIN');
        const row = await this.get({ workspaceId: input.workspaceId, id: ref.id, revision: ref.revision });
        if (
          row.origin !== 'local' ||
          row.kind !== 'result' ||
          T.seventhPayload.parse(row.content).submissionType !== 'local-preview-sample'
        )
          suiteFail('SEVENTH_PREVIEW_ERASE_KIND');
        if (
          (await this.references({ workspaceId: input.workspaceId, id: ref.id, revision: ref.revision }))
            .holders.length
        )
          suiteFail('SUITE_CONTENT_PROTECTED');
      }
      for (const ref of refs)
        await this.archive({ workspaceId: input.workspaceId, id: ref.id, revision: ref.revision });
      return S.suiteJson.parse(
        await this.previewCleanup({ workspaceId: input.workspaceId, references: refs }),
      );
    }
    if (raw && typeof raw === 'object' && 'planId' in raw)
      return S.suiteJson.parse(await this.executeAction(S.suiteApproval.parse(raw)));
    const p = T.seventhAction.parse(raw);
    const action = this.member.id.slice(this.pack.prefix.length + 1) + '.' + method;
    if (method === 'preview' && this.sessions)
      return S.suiteJson.parse(await this.previewAction({ ...p, method: 'start' }));
    if (method === 'preview' && !(await this.executionPort.actions()).includes(action)) {
      const prefix = this.member.id.slice(this.pack.prefix.length + 1) + '.';
      const target = (await this.executionPort.actions()).find(
        (a) => a.startsWith(prefix) && !a.endsWith('.preview'),
      );
      if (!target) suiteFail('SEVENTH_ACTION_UNSUPPORTED');
      return S.suiteJson.parse(await this.previewAction({ ...p, method: target.slice(prefix.length) }));
    }
    if ((await this.executionPort.actions()).includes(action)) {
      const plan = await this.previewAction({ ...p, method });
      return S.suiteJson.parse(plan);
    }
    if (writing.has(method)) {
      const payload = await this.payload(p);
      return S.suiteJson.parse(
        await this.put(
          {
            workspaceId: p.workspaceId,
            name: p.name ?? this.member.name,
            content: payload.input,
            references: payload.references,
          },
          ['decide', 'review', 'recordDecision', 'resolve'].includes(method) ? 'review' : 'definition',
          false,
        ),
      );
    }
    if (['inspect', 'read', 'explain', 'listFindings'].includes(method)) {
      const refs = [...p.references, ...Object.values(p.bindings).map((b) => ('ref' in b ? b.ref : b))];
      if (!refs.length) suiteFail('SEVENTH_REFERENCE_REQUIRED', '读取说明必须提供原固定引用', 400);
      const records = await Promise.all(
        [...new Map(refs.map((r) => [`${r.domain}/${r.id}/${r.revision}`, r])).values()].map((r) =>
          this.fixed({ workspaceId: p.workspaceId }, r),
        ),
      );
      return S.suiteJson.parse({
        format: 'sakura-seventh-evidence-view/1',
        records,
        claims: 'original-records-only',
      });
    }
    suiteFail('SEVENTH_ACTION_UNSUPPORTED', '此动作尚无领域实现', 422);
  }
  async dispose() {
    for (const a of this.operations.values()) a.abort(new Error('插件停止'));
    await Promise.allSettled([...this.tasks]);
    await super.close();
  }
}
