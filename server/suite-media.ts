import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as M from '../shared/contracts/media-studio.ts';
import * as E from '../shared/contracts/suite-execution.ts';
import type * as P from './service-contracts/media-studio.ts';
import type { MediaTasksV1 } from './service-contracts/suite-execution.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { resourceContext } from './host-runtime/context.ts';
import {
  SuiteStore,
  suiteActor,
  suiteBinding,
  suiteHash,
  suiteSha,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import {
  mediaSummary,
  parseMediaCaptions,
  formatMediaCaptions,
  validateMediaRecipe,
} from './suite-media-analysis.ts';
const scope = (v: S.SuiteScope) => ({ workspaceId: v.workspaceId });
const ref = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision });
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const json = (v: unknown) => S.suiteJson.parse(v);
const native = (r: S.SuiteRecord) => {
  if (r.origin !== 'local' || r.state !== 'sealed') suiteFail('MEDIA_LOCAL_REQUIRED');
  return r;
};
const same = (a: unknown, b: unknown) => suiteHash(a) === suiteHash(b);
export async function readMediaBytes(sources: P.MediaSourcesV1, s: S.SuiteScope, r: S.SuiteRef) {
  const row = await sources.get(pin(s, r)),
    material = S.suiteMaterial.parse(row.content);
  if (material.bytes > 4 * 1024 ** 2) suiteFail('MEDIA_BYTES_LIMIT');
  const lease = await sources.openRead(pin(s, r)),
    parts: Buffer[] = [];
  try {
    for (let offset = 0; offset < material.bytes;) {
      const part = await sources.readLease({
          ...s,
          id: lease.id,
          offset,
          length: Math.min(512 * 1024, material.bytes - offset),
        }),
        bytes = Buffer.from(part.data, 'base64');
      if (!bytes.length || part.offset !== offset + bytes.length) suiteFail('MEDIA_READ_PROTOCOL');
      parts.push(bytes);
      offset = part.offset;
    }
  } finally {
    await sources.closeRead({ ...s, id: lease.id });
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== material.bytes || suiteSha(bytes) !== material.digest)
    suiteFail('MEDIA_MATERIAL_CHANGED');
  return { material, bytes };
}
export class MediaSources extends SuiteMaterials implements P.MediaSourcesV1 {
  private publishes = new Map<string, Promise<S.SuiteRecord>>();
  constructor(meta: PluginMetadata, uploads: PluginMetadata, auth: SuiteAuthorize) {
    super('media-sources', meta, uploads, auth, 64 * 1024 ** 3, 4 * 1024 ** 2, [
      'png',
      'jpeg',
      'webp',
      'wav',
      'mp4',
      'text',
    ]);
  }
  async pin(raw: z.infer<typeof M.mediaPin>) {
    const p = M.mediaPin.parse(raw),
      row = native(await this.fixed(scope(p), p.source));
    if (
      row.kind !== 'source' ||
      !M.mediaFacts.shape.format.safeParse(S.suiteMaterial.parse(row.content).format).success
    )
      suiteFail('MEDIA_SOURCE_REQUIRED');
    return this.put(
      {
        ...scope(p),
        name: row.name + ' · 已审阅来源',
        references: [p.source],
        content: json({
          format: 'sakura-media-pinned/1',
          source: p.source,
          license: p.license,
          reviewed: true,
        }),
      },
      'result',
      true,
    );
  }
  async publishDerived(raw: z.infer<typeof M.mediaDerived>) {
    const consumer = resourceContext()?.serviceConsumerPluginInstanceId;
    if (
      !consumer ||
      !['media-workers', 'media-captions'].some(
        (id) => consumer === `official:${id}` || consumer.startsWith(`official:${id}:`),
      )
    )
      suiteFail('MEDIA_INTERNAL_CONSUMER');
    const p = M.mediaDerived.parse(raw),
      key = p.workspaceId + ':' + p.key;
    const pending = (this.publishes.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const bytes = Buffer.concat(p.data.chunks.map((c) => Buffer.from(c, 'base64')));
        if (bytes.length !== p.data.bytes || suiteSha(bytes) !== p.data.digest)
          suiteFail('MEDIA_DERIVED_DIGEST');
        for (const r of p.lineage) await this.fixed(scope(p), r);
        const name = p.key.slice(0, 16) + '-' + p.name,
          format = p.format === 'srt' ? 'text' : p.format;
        let upload = (await this.uploads(scope(p))).find(
          (u) =>
            u.name === name &&
            u.digest === p.data.digest &&
            u.format === format &&
            same(u.lineage, p.lineage) &&
            u.state !== 'discarded',
        );
        if (upload?.state === 'unknown') suiteFail('MEDIA_PUBLICATION_UNKNOWN');
        if (!upload)
          upload = await this.beginDerivedUpload(
            { ...scope(p), name, format, bytes: bytes.length, digest: p.data.digest, allowExport: false },
            p.lineage,
          );
        for (let offset = upload.offset; offset < bytes.length; offset += 512 * 1024)
          await this.appendUpload({
            ...scope(p),
            id: upload.id,
            offset,
            data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
          });
        return this.finishUpload({ ...scope(p), id: upload.id });
      });
    this.publishes.set(key, pending);
    void pending
      .finally(() => {
        if (this.publishes.get(key) === pending) this.publishes.delete(key);
      })
      .catch(() => {});
    return pending;
  }
  override async close() {
    await Promise.allSettled([...this.publishes.values()]);
    await super.close();
  }
}
class MediaExecution extends SuiteStore {
  private operations = new Map<string, Promise<unknown>>();
  constructor(
    domain: string,
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    protected sources: P.MediaSourcesV1,
    peers: Record<string, S.SuiteRecordsV1>,
    private tools: () => MediaTasksV1,
  ) {
    super(domain, meta, auth, sources, { 'media-sources': sources, ...peers });
  }
  protected serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const promise = (this.operations.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.operations.set(key, promise);
    void promise
      .finally(() => {
        if (this.operations.get(key) === promise) this.operations.delete(key);
      })
      .catch(() => {});
    return promise;
  }
  protected async latest(s: S.SuiteScope, r: S.SuiteRef) {
    const fixed = native(await this.fixed(s, r));
    if (fixed.domain !== this.domain) suiteFail('MEDIA_JOB_OWNER');
    const rows = (await this.readState()).rows.filter(
        (x) => x.workspaceId === s.workspaceId && x.actor === suiteActor() && x.id === fixed.id,
      ),
      head = rows.reduce((a, b) => (a.sequence > b.sequence ? a : b), fixed);
    return native(await this.get(pin(s, ref(head))));
  }
  protected async previewJob(
    s: S.SuiteScope,
    name: string,
    image: z.infer<typeof M.mediaInspectPreview>['image'],
    items: {
      key: string;
      source: S.SuiteRef;
      recipe: S.SuiteRef | null;
      value: z.infer<typeof M.mediaRecipe> | null;
    }[],
    mode: 'inspect' | 'transform',
  ) {
    const inputItems = [];
    let total = 0;
    for (const item of items) {
      const source = M.mediaPinned.parse(native(await this.fixed(s, item.source)).content),
        data = await readMediaBytes(this.sources, s, source.source);
      total += data.bytes.length;
      if (total > 4 * 1024 ** 2) suiteFail('MEDIA_BATCH_LIMIT');
      inputItems.push({
        key: item.key,
        format: M.mediaFacts.shape.format.parse(data.material.format),
        source: {
          bytes: data.bytes.length,
          digest: data.material.digest,
          chunks: Array.from({ length: Math.ceil(data.bytes.length / (512 * 1024)) }, (_, i) =>
            data.bytes.subarray(i * 512 * 1024, (i + 1) * 512 * 1024).toString('base64'),
          ),
        },
        recipe: item.value,
      });
    }
    const manifest = M.mediaWorkerInput.parse({ format: 'sakura-media-worker/1', mode, items: inputItems }),
      executionPlan = await this.tools().preview({
        ...s,
        image,
        input: json(manifest),
        inputDigest: suiteHash(manifest),
        maxSeconds: 600,
      });
    try {
      return await this.plan(
        s,
        'media-' + mode,
        json({
          name,
          mode,
          sources: items.map((x) => x.source),
          items: items.map(({ value: _, ...x }) => x),
          executionPlan,
        }),
        [...items.map((x) => x.source), ...items.flatMap((x) => (x.recipe ? [x.recipe] : []))],
      );
    } catch (error) {
      await this.tools()
        .discardPreview({ ...s, planId: executionPlan.id, digest: executionPlan.digest })
        .catch(() => {});
      throw error;
    }
  }
  protected async submit(raw: S.SuiteApproval, mode: 'inspect' | 'transform') {
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.consume(p, 'media-' + mode, true),
        s = scope(p);
      if (plan.result) return this.get(pin(s, plan.result));
      const prior = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === s.workspaceId &&
          r.actor === suiteActor() &&
          M.mediaJob.safeParse(r.content).success &&
          M.mediaJob.parse(r.content).planId === plan.id,
      );
      if (prior) {
        await this.complete(plan, prior);
        return this.poll({ ...s, job: ref(prior) });
      }
      const input = M.mediaJobInput.parse(plan.input);
      let pending: S.SuiteRecord | undefined;
      const session = E.suiteExecutionReceipt.parse(
        await this.tools().start(
          { ...s, planId: input.executionPlan.id, digest: input.executionPlan.digest },
          async (challenge) => {
            if (
              challenge.planId !== input.executionPlan.id ||
              challenge.digest !== input.executionPlan.digest ||
              challenge.inputDigest !== input.executionPlan.inputDigest
            )
              suiteFail('MEDIA_PLAN_CHANGED');
            const intentDigest = suiteHash({ plan: plan.id, challenge });
            pending = await this.put(
              {
                ...s,
                name: input.name,
                references: plan.references,
                content: json({
                  format: 'sakura-media-job/1',
                  planId: plan.id,
                  input,
                  sessionId: challenge.sessionId,
                  intentDigest,
                  session: null,
                  result: null,
                  published: [],
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
        ),
      );
      if (!pending) suiteFail('MEDIA_INTENT_REQUIRED');
      const record = await this.put(
        {
          ...s,
          id: pending.id,
          expectedRevision: pending.revision,
          name: pending.name,
          references: pending.references,
          content: json({ ...M.mediaJob.parse(pending.content), session }),
        },
        'result',
        true,
      );
      await this.complete(plan, record);
      return record;
    });
  }
  private async output(s: S.SuiteScope, receipt: E.SuiteExecutionReceipt) {
    if (!receipt.output) return null;
    const parts: Buffer[] = [];
    for (let offset = 0; offset < receipt.output.bytes;) {
      const c = await this.tools().output({
          ...s,
          id: receipt.id,
          offset,
          length: Math.min(512 * 1024, receipt.output.bytes - offset),
        }),
        b = Buffer.from(c.data, 'base64');
      if (
        c.offset !== offset + b.length ||
        !b.length ||
        c.digest !== receipt.output.digest ||
        c.total !== receipt.output.bytes
      )
        suiteFail('MEDIA_OUTPUT_PROTOCOL');
      parts.push(b);
      offset = c.offset;
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== receipt.output.bytes || suiteSha(bytes) !== receipt.output.digest)
      suiteFail('MEDIA_OUTPUT_DIGEST');
    return M.mediaWorkerResult.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  private async verified(s: S.SuiteScope, job: z.infer<typeof M.mediaJob>, receipt: E.SuiteExecutionReceipt) {
    const result = await this.output(s, receipt);
    if (!result) return null;
    if (
      result.items.length !== job.input.items.length ||
      result.outcome !== (result.items.every((x) => x.state === 'verified') ? 'passed' : 'failed')
    )
      suiteFail('MEDIA_RESULT_COVERAGE');
    let total = 0;
    for (let i = 0; i < result.items.length; i++) {
      const item = result.items[i],
        selected = job.input.items[i],
        source = M.mediaPinned.parse((await this.fixed(s, selected.source)).content),
        material = S.suiteMaterial.parse((await this.sources.get(pin(s, source.source))).content);
      if (
        item.key !== selected.key ||
        item.inputDigest !== material.digest ||
        (item.state === 'failed' && item.outputs.length) ||
        (item.state === 'verified' && (!item.facts || item.error))
      )
        suiteFail('MEDIA_RESULT_BINDING');
      if (job.input.mode === 'inspect' && item.outputs.length) suiteFail('MEDIA_INSPECT_OUTPUT');
      if (job.input.mode === 'transform' && item.state === 'verified' && !item.outputs.length)
        suiteFail('MEDIA_OUTPUT_MISSING');
      for (const o of item.outputs) {
        const data = Buffer.concat(o.bytes.chunks.map((c) => Buffer.from(c, 'base64')));
        total += data.length;
        if (
          data.length !== o.bytes.bytes ||
          suiteSha(data) !== o.bytes.digest ||
          o.facts.format !== o.format ||
          total > 4 * 1024 ** 2
        )
          suiteFail('MEDIA_OUTPUT_BYTES');
      }
    }
    return result;
  }
  async poll(raw: z.infer<typeof M.mediaAction>) {
    const p = M.mediaAction.parse(raw);
    return this.serial(p.job.id, async () => {
      const s = scope(p),
        row = await this.latest(s, p.job),
        job = M.mediaJob.parse(row.content),
        session = E.suiteExecutionReceipt.parse(await this.tools().inspect({ ...s, id: job.sessionId }));
      const result =
        job.result ??
        (session.output && session.cleanup === 'confirmed'
          ? mediaSummary((await this.verified(s, job, session))!)
          : null);
      if (same(session, job.session) && same(result, job.result)) return row;
      return this.put(
        {
          ...s,
          id: row.id,
          expectedRevision: row.revision,
          name: row.name,
          references: row.references,
          content: json({ ...job, session, result }),
        },
        'result',
        true,
      );
    });
  }
  async publish(raw: z.infer<typeof M.mediaAction>) {
    const p = M.mediaAction.parse(raw);
    await this.poll(p);
    return this.serial(p.job.id, async () => {
      const s = scope(p),
        row = await this.latest(s, p.job),
        job = M.mediaJob.parse(row.content);
      if (
        job.input.mode !== 'transform' ||
        !job.session ||
        job.session.state !== 'completed' ||
        job.session.cleanup !== 'confirmed'
      )
        suiteFail('MEDIA_PUBLICATION_NOT_READY');
      const result = await this.verified(s, job, job.session);
      if (!result) suiteFail('MEDIA_OUTPUT_MISSING');
      const published = [...job.published];
      for (const item of result.items) {
        if (item.state !== 'verified') continue;
        const selected = job.input.items.find((x) => x.key === item.key)!;
        for (const output of item.outputs) {
          if (published.some((x) => x.key === item.key && x.name === output.name)) continue;
          const source = M.mediaPinned.parse((await this.fixed(s, selected.source)).content),
            created = await this.sources.publishDerived({
              ...s,
              key: suiteHash({ session: job.sessionId, item: item.key, name: output.name }),
              name: output.name,
              format: output.format,
              lineage: [source.source],
              data: output.bytes,
            });
          published.push({
            key: item.key,
            name: output.name,
            source: ref(created),
            facts: output.facts,
            digest: output.bytes.digest,
          });
        }
      }
      if (same(published, job.published)) return row;
      return this.put(
        {
          ...s,
          id: row.id,
          expectedRevision: row.revision,
          name: row.name,
          references: [
            ...row.references,
            ...published
              .filter((x) => !job.published.some((y) => same(x.source, y.source)))
              .map((x) => x.source),
          ],
          content: json({ ...job, published }),
        },
        'result',
        true,
      );
    });
  }
  async cancel(raw: z.infer<typeof M.mediaAction>) {
    const p = M.mediaAction.parse(raw),
      row = await this.latest(scope(p), p.job),
      job = M.mediaJob.parse(row.content);
    await this.tools().cancel({ ...scope(p), id: job.sessionId });
    return this.poll(p);
  }
  async reconcile(raw: z.infer<typeof M.mediaAction>) {
    const p = M.mediaAction.parse(raw),
      row = await this.latest(scope(p), p.job),
      job = M.mediaJob.parse(row.content);
    return this.plan(
      scope(p),
      'media-reconcile',
      json({ job: ref(row), sessionId: job.sessionId, originalVm: job.session?.vm ?? null }),
      [ref(row)],
    );
  }
  async confirmReconcile(raw: S.SuiteApproval) {
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.consume(p, 'media-reconcile', true);
      if (plan.result) return this.get(pin(scope(p), plan.result));
      const v = z
          .object({ job: S.suiteRef, sessionId: S.suiteId, originalVm: S.suiteJson })
          .strict()
          .parse(plan.input),
        row = await this.latest(scope(p), v.job);
      if (M.mediaJob.parse(row.content).sessionId !== v.sessionId) suiteFail('MEDIA_SESSION_CHANGED');
      await this.tools().reconcile({ ...scope(p), id: v.sessionId });
      const updated = await this.poll({ ...scope(p), job: ref(row) });
      await this.complete(plan, updated);
      return updated;
    });
  }
  async discardPreview(raw: S.SuiteApproval) {
    const p = S.suiteApproval.parse(raw);
    return this.serial('plan:' + p.planId, async () => {
      const plan = await this.inspectPlan({ ...scope(p), planId: p.planId });
      if (
        plan.digest !== p.digest ||
        plan.binding !== suiteBinding() ||
        !['media-inspect', 'media-transform'].includes(plan.action) ||
        !['ready', 'failed'].includes(plan.state)
      )
        suiteFail('MEDIA_PLAN_CHANGED');
      const input = M.mediaJobInput.parse(plan.input);
      await this.tools().discardPreview({
        ...scope(p),
        planId: input.executionPlan.id,
        digest: input.executionPlan.digest,
      });
      return this.edit(
        (state) => {
          const found = state.plans.find((x) => x.id === plan.id)!;
          found.state = 'failed';
          return found;
        },
        true,
        scope(p),
      );
    });
  }
  protected override async releaseOwned(s: S.SuiteScope, row: S.SuiteRecord) {
    const parsed = M.mediaJob.safeParse(row.content);
    if (parsed.success) {
      const session = await this.tools().inspect({ ...s, id: parsed.data.sessionId });
      if (session.cleanup !== 'confirmed') suiteFail('MEDIA_RESOURCE_RETAINED');
      const remaining = (await this.readState()).rows.filter(
        (x) => x.workspaceId === s.workspaceId && x.id === row.id && x.revision !== row.revision,
      );
      if (!remaining.length) await this.tools().release({ ...s, id: parsed.data.sessionId });
    }
  }
  override async close() {
    await Promise.allSettled([...this.operations.values()]);
    await super.close();
  }
}
export class MediaInspect extends MediaExecution implements P.MediaInspectV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: P.MediaSourcesV1,
    tools: () => MediaTasksV1,
  ) {
    super('media-inspect', meta, auth, sources, {}, tools);
  }
  async preview(raw: z.infer<typeof M.mediaInspectPreview>) {
    const p = M.mediaInspectPreview.parse(raw);
    return this.previewJob(
      scope(p),
      p.name,
      p.image,
      p.sources.map((source) => ({ key: randomUUID(), source, recipe: null, value: null })),
      'inspect',
    );
  }
  async inspect(raw: S.SuiteApproval) {
    return this.submit(raw, 'inspect');
  }
}
export class MediaRecipes extends SuiteStore implements P.MediaRecipesV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: P.MediaSourcesV1,
    private inspection: P.MediaInspectV1,
  ) {
    super('media-recipes', meta, auth, sources, { 'media-inspect': inspection, 'media-sources': sources });
  }
  private async checked(raw: z.infer<typeof M.mediaCompile>) {
    const p = M.mediaCompile.parse(raw),
      job = M.mediaJob.parse(native(await this.fixed(scope(p), p.inspection)).content);
    if (
      job.input.mode !== 'inspect' ||
      job.session?.state !== 'completed' ||
      job.session.cleanup !== 'confirmed'
    )
      suiteFail('MEDIA_INSPECTION_REQUIRED');
    const item = job.result?.items.find((x) => x.key === p.item),
      selected = job.input.items.find((x) => x.key === p.item);
    if (!item?.facts || item.state !== 'verified' || !selected) suiteFail('MEDIA_FACTS_REQUIRED');
    const recipe = validateMediaRecipe(p.recipe, item.facts);
    return { p, recipe, item, selected };
  }
  async validate(raw: z.infer<typeof M.mediaCompile>) {
    return { valid: true as const, recipe: (await this.checked(raw)).recipe };
  }
  async compile(raw: z.infer<typeof M.mediaCompile>) {
    const { p, recipe, item, selected } = await this.checked(raw);
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [p.inspection, selected.source],
        content: json({
          format: 'sakura-media-recipe/1',
          inspection: p.inspection,
          item: p.item,
          source: selected.source,
          facts: item.facts,
          recipe,
          rules: 'media-fixed-profiles-v1',
        }),
      },
      'result',
      true,
    );
  }
}
export class MediaWorkers extends MediaExecution implements P.MediaWorkersV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: P.MediaSourcesV1,
    inspection: P.MediaInspectV1,
    recipes: P.MediaRecipesV1,
    tools: () => MediaTasksV1,
  ) {
    super(
      'media-workers',
      meta,
      auth,
      sources,
      { 'media-inspect': inspection, 'media-recipes': recipes },
      tools,
    );
  }
  async preview(raw: z.infer<typeof M.mediaRunPreview>) {
    const p = M.mediaRunPreview.parse(raw),
      items = [];
    for (const r of p.recipes) {
      const recipe = M.mediaCompiled.parse(native(await this.fixed(scope(p), r)).content);
      validateMediaRecipe(recipe.recipe, recipe.facts);
      items.push({ key: randomUUID(), source: recipe.source, recipe: r, value: recipe.recipe });
    }
    return this.previewJob(scope(p), p.name, p.image, items, 'transform');
  }
  async start(raw: S.SuiteApproval) {
    return this.submit(raw, 'transform');
  }
}
export class MediaCaptions extends SuiteStore implements P.MediaCaptionsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: P.MediaSourcesV1,
    workers: P.MediaWorkersV1,
  ) {
    super('media-captions', meta, auth, sources, { 'media-sources': sources, 'media-workers': workers });
  }
  async validateTiming(raw: z.infer<typeof M.mediaCaptionInput>) {
    const p = M.mediaCaptionInput.parse(raw);
    await this.fixed(scope(p), p.source);
    const job = M.mediaJob.parse(native(await this.fixed(scope(p), p.job)).content),
      output = job.published.find((x) => same(x.source, p.source));
    if (
      !output ||
      !['wav', 'mp4'].includes(output.facts.format) ||
      output.facts.durationMs !== p.durationMs ||
      job.session?.cleanup !== 'confirmed'
    )
      suiteFail('MEDIA_CAPTION_MEDIA_TIMING');
    return { valid: true as const, cues: parseMediaCaptions(p.text, p.durationMs) };
  }
  async importText(raw: z.infer<typeof M.mediaCaptionInput>) {
    const p = M.mediaCaptionInput.parse(raw),
      { cues } = await this.validateTiming(p);
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [p.source, p.job],
        content: json({
          format: 'sakura-media-captions/1',
          source: p.source,
          job: p.job,
          durationMs: p.durationMs,
          language: p.language,
          cues,
          timing: 'valid',
        }),
      },
      'result',
      true,
    );
  }
  async exportText(raw: S.SuiteScope & { caption: S.SuiteRef }) {
    const p = M.mediaSelect('caption').parse(raw),
      row = native(await this.fixed(scope(p), p.caption)),
      caption = M.mediaCaption.parse(row.content),
      data = Buffer.from(formatMediaCaptions(caption.cues));
    return this.sources.publishDerived({
      ...scope(p),
      key: suiteHash(p.caption),
      name: 'captions.srt',
      format: 'srt',
      lineage: [caption.source],
      data: { bytes: data.length, digest: suiteSha(data), chunks: [data.toString('base64')] },
    });
  }
}
export class MediaCollections extends SuiteStore implements P.MediaCollectionsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: P.MediaSourcesV1,
    workers: P.MediaWorkersV1,
    captions: P.MediaCaptionsV1,
  ) {
    super('media-collections', meta, auth, sources, {
      'media-sources': sources,
      'media-workers': workers,
      'media-captions': captions,
    });
  }
  async assemble(raw: z.infer<typeof M.mediaAssemble>) {
    const p = M.mediaAssemble.parse(raw);
    if (new Set(p.entries.map((x) => x.name.toLowerCase())).size !== p.entries.length)
      suiteFail('MEDIA_DUPLICATE_NAME');
    const entries = [],
      references: S.SuiteRef[] = [];
    for (const e of p.entries) {
      const row = native(await this.fixed(scope(p), e.source)),
        material = S.suiteMaterial.parse(row.content);
      if (row.domain !== 'media-sources' || row.kind !== 'source' || !!e.job === !!e.caption)
        suiteFail('MEDIA_DERIVED_REQUIRED');
      let format = material.format;
      if (e.job) {
        const job = M.mediaJob.parse(native(await this.fixed(scope(p), e.job)).content),
          published = job.published.find((x) => same(x.source, e.source));
        if (job.session?.cleanup !== 'confirmed' || !published || published.digest !== material.digest)
          suiteFail('MEDIA_PUBLISHED_REQUIRED');
        references.push(e.job);
      }
      if (e.caption) {
        const caption = M.mediaCaption.parse(native(await this.fixed(scope(p), e.caption)).content);
        if (
          material.format !== 'text' ||
          suiteSha(formatMediaCaptions(caption.cues)) !== material.digest ||
          !row.references.some((x) => same(x, caption.source))
        )
          suiteFail('MEDIA_CAPTION_BYTES');
        format = 'srt';
        references.push(e.caption);
      }
      if (!e.name.toLowerCase().endsWith('.' + format)) suiteFail('MEDIA_COLLECTION_EXTENSION');
      entries.push({
        ...e,
        digest: material.digest,
        bytes: material.bytes,
        format: M.mediaFormat.parse(format),
      });
      references.push(e.source);
    }
    return this.put(
      {
        ...scope(p),
        name: p.name,
        references: [...new Map(references.map((r) => [suiteHash(r), r])).values()],
        content: json({ format: 'sakura-media-collection/1', entries }),
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof M.mediaCompare>) {
    const p = M.mediaCompare.parse(raw),
      a = M.mediaCollection.parse((await this.fixed(scope(p), p.left)).content),
      b = M.mediaCollection.parse((await this.fixed(scope(p), p.right)).content);
    return this.put(
      {
        ...scope(p),
        name: '资源版本差异',
        references: [p.left, p.right],
        content: json({
          format: 'sakura-media-collection-diff/1',
          left: p.left,
          right: p.right,
          added: b.entries.filter((x) => !a.entries.some((y) => y.name === x.name)).map((x) => x.name),
          removed: a.entries.filter((x) => !b.entries.some((y) => y.name === x.name)).map((x) => x.name),
          changed: b.entries
            .filter((x) => a.entries.some((y) => y.name === x.name && y.digest !== x.digest))
            .map((x) => x.name),
        }),
      },
      'result',
      true,
    );
  }
}
export class MediaReviews extends SuiteStore implements P.MediaReviewsV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: P.MediaSourcesV1,
    collections: P.MediaCollectionsV1,
    inspection: P.MediaInspectV1,
  ) {
    super('media-reviews', meta, auth, sources, {
      'media-collections': collections,
      'media-inspect': inspection,
    });
  }
  async open(raw: S.SuiteScope & { collection: S.SuiteRef }) {
    const p = M.mediaSelect('collection').parse(raw),
      collection = M.mediaCollection.parse(native(await this.fixed(scope(p), p.collection)).content);
    return this.put(
      {
        ...scope(p),
        name: '媒体资源审阅',
        references: [p.collection],
        content: json({
          format: 'sakura-media-review/1',
          collection: p.collection,
          decision: 'pending',
          observations: '',
          humanPreviewed: false,
          checks: [
            `集合包含 ${collection.entries.length} 项已固定字节`,
            '输出来源、格式与摘要一致',
            '来源许可仍需在导出时复核',
          ],
        }),
      },
      'review',
      true,
    );
  }
  async recheck(raw: S.SuiteScope & { review: S.SuiteRef }) {
    const p = M.mediaSelect('review').parse(raw),
      row = native(await this.fixed(scope(p), p.review)),
      latest = (await this.readState()).rows
        .filter((x) => x.workspaceId === p.workspaceId && x.id === row.id)
        .reduce((a, b) => (a.sequence > b.sequence ? a : b), row);
    if (latest.revision !== row.revision) suiteFail('MEDIA_REVIEW_SUPERSEDED');
    M.mediaReview.parse(row.content);
    return row;
  }
  async decide(raw: z.infer<typeof M.mediaDecision>) {
    const p = M.mediaDecision.parse(raw),
      row = await this.recheck({ ...scope(p), review: p.review }),
      review = M.mediaReview.parse(row.content);
    return this.put(
      {
        ...scope(p),
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        references: row.references,
        content: json({
          ...review,
          decision: p.decision,
          observations: p.observations,
          humanPreviewed: true,
        }),
      },
      'review',
      true,
    );
  }
}
export class MediaWorkbench extends SuiteStore implements P.MediaWorkbenchV1 {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    sources: P.MediaSourcesV1,
    private ports: Record<string, S.SuiteRecordsV1>,
  ) {
    super('media-workbench', meta, auth, sources, ports);
  }
  async templates() {
    await this.access();
    return M.mediaTemplates.parse([
      {
        id: 'responsive-images',
        name: '多尺寸图片',
        recipe: {
          kind: 'image',
          sizes: [
            { width: 320, height: 240 },
            { width: 640, height: 480 },
          ],
          fit: 'contain',
          stripMetadata: true,
        },
      },
      {
        id: 'presentation-clip',
        name: '演示视频片段',
        recipe: {
          kind: 'video',
          width: 640,
          height: 360,
          startMs: 0,
          durationMs: 3000,
          fps: 12,
          thumbnail: true,
          stripMetadata: true,
        },
      },
      {
        id: 'audio-captions',
        name: '音频与手工字幕',
        recipe: {
          kind: 'audio',
          startMs: 0,
          durationMs: 3000,
          sampleRate: 16000,
          channels: 1,
          normalize: true,
          stripMetadata: true,
        },
      },
    ]);
  }
  async view(raw: S.SuiteScope) {
    const s = S.suiteScope.parse(raw);
    await this.access(s);
    const domains = [];
    for (const id of M.mediaDomains) {
      const domain = 'media-' + id,
        port = id === 'workbench' ? this : this.ports[domain];
      domains.push({
        domain,
        records: (await port.list({ ...s, limit: 20 })).items.map((r) => ({
          reference: ref(r),
          name: r.name,
          state: r.state,
        })),
      });
    }
    return M.mediaView.parse({ ...s, domains });
  }
}
