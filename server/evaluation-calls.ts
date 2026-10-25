/** 本体固定本机调用，先保存意图，断线或重启不重发。 */
import { z } from 'zod';
import { performance } from 'node:perf_hooks';
import { networkFor } from './network/index.ts';
import { PORT } from './paths.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck } from './operation-context.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { EvaluationCallsV1 } from './service-contracts/evaluation-calls.ts';
import * as C from '../shared/contracts/evaluation-calls.ts';
import { suiteFail, suiteHash, suiteSha } from './suite-store.ts';
const fetcher = networkFor('core:evaluation-calls').fetch;
const now = () => new Date().toISOString();
const bearerSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((v) => !/[\r\n\0]/.test(v));
export class EvaluationCalls implements EvaluationCallsV1 {
  private tail: Promise<unknown> = Promise.resolve();
  private active = new Map<string, { abort: AbortController; done: Promise<C.EvaluationCallReceipt> }>();
  private closed = false;
  private reservations = 0;
  private shutdown = new AbortController();
  private pending = new Set<Promise<C.EvaluationCallReceipt>>();
  constructor(
    private metadata: PluginMetadata,
    private fetch: typeof fetcher = fetcher,
  ) {}
  private caller(executing = false) {
    const c = resourceContext(),
      consumer = c?.serviceConsumerPluginInstanceId ?? c?.callerPluginInstanceId;
    const ids = executing
      ? ['evaluation-runners', 'evaluation-scorers']
      : ['evaluation-endpoints', 'evaluation-runners', 'evaluation-scorers'];
    if (
      !c?.actorId ||
      !consumer ||
      !c.serviceConsumerPluginGeneration ||
      !ids.some((id) => consumer === 'official:' + id || consumer.startsWith('official:' + id + ':'))
    )
      suiteFail('EVALUATION_CALLER_DENIED', '需要原模型评测消费者', 403);
    return { actor: c.actorId, consumer, generation: c.serviceConsumerPluginGeneration };
  }
  private async rows() {
    return z
      .array(C.evaluationCallReceipt)
      .max(1000)
      .parse((await this.metadata.read()).value ?? []);
  }
  private change<T>(work: (rows: C.EvaluationCallReceipt[]) => T) {
    const task = this.tail.then(async () => {
      const snapshot = await this.metadata.read(),
        rows = z
          .array(C.evaluationCallReceipt)
          .max(1000)
          .parse(snapshot.value ?? []),
        result = work(rows);
      if (Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 ** 2)
        suiteFail('EVALUATION_CALL_LEDGER_FULL', '原调用账本容量不足');
      await this.metadata.replace(rows, { expectedRevision: snapshot.revision });
      return structuredClone(result);
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async init() {
    await this.change((rows) => {
      for (const r of rows)
        if (['intent', 'sent'].includes(r.state)) {
          r.state = r.state === 'sent' ? 'unknown' : 'rejected';
          r.error = 'CONTROLLER_RESTARTED';
          r.finishedAt = now();
        }
    });
  }
  private target(raw: C.EvaluationTarget) {
    const p = C.evaluationTarget.parse(raw);
    const port = Number(new URL(p.url).port);
    if ([PORT, 7337].includes(port)) suiteFail('EVALUATION_CONTROL_ENDPOINT', '拒绝宿主控制端口');
    if (/(?:^|[:-])cloud(?:$|[:/-])/i.test(p.model)) suiteFail('EVALUATION_REMOTE_MODEL_DENIED');
    return { ...p, url: new URL(p.url).origin };
  }
  private async json(
    target: C.EvaluationTarget,
    path: '/api/show' | '/api/chat',
    data: unknown,
    auth: C.EvaluationAuthorization,
    signal: AbortSignal,
  ) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth.bearer !== null) headers.authorization = 'Bearer ' + bearerSchema.parse(auth.bearer);
    const response = await this.fetch(target.url + path, {
      method: 'POST',
      body: JSON.stringify(data),
      headers,
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      suiteFail('EVALUATION_MODEL_HTTP', '本机模型返回 HTTP ' + response.status, 502);
    }
    if (!response.body) suiteFail('EVALUATION_EMPTY_RESPONSE');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const p = await reader.read();
        if (p.done) break;
        bytes += p.value.length;
        if (bytes > 1024 * 1024) suiteFail('EVALUATION_RESPONSE_LIMIT');
        chunks.push(p.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  private async probe(target: C.EvaluationTarget, auth: C.EvaluationAuthorization, signal: AbortSignal) {
    const v = z
      .object({
        remote_host: z.string().optional(),
        remote_model: z.string().optional(),
        details: z.object({ format: z.string().optional() }).passthrough(),
        model_info: z.record(z.string(), z.unknown()),
        capabilities: z.array(z.string()).optional(),
      })
      .passthrough()
      .parse(await this.json(target, '/api/show', { model: target.model }, auth, signal));
    if (v.remote_host || v.remote_model || v.details.format !== 'gguf' || !Object.keys(v.model_info).length)
      suiteFail('EVALUATION_LOCAL_WEIGHTS_REQUIRED', '模型未提供本地权重信息，未发送样例');
    return C.evaluationConnection.parse({
      modelDigest: suiteHash({ model: target.model, details: v.details, model_info: v.model_info }),
      protocolVersion: null,
      localWeights: true,
      checkedAt: now(),
    });
  }
  async check(raw: C.EvaluationTarget, authorize: () => Promise<C.EvaluationAuthorization>) {
    this.caller();
    if (this.closed) suiteFail('EVALUATION_CLOSED');
    const check = captureOperationCheck();
    await check();
    const target = this.target(raw),
      auth = await authorize();
    if ((auth.bearer === null) !== (target.secretVersion === null)) suiteFail('EVALUATION_SECRET_BINDING');
    const result = await this.probe(
      target,
      auth,
      AbortSignal.any([AbortSignal.timeout(15000), this.shutdown.signal]),
    );
    await check();
    await authorize();
    return result;
  }
  execute(
    raw: C.EvaluationCallInput,
    commitIntent: (digest: string) => Promise<C.EvaluationAuthorization & { intentDigest: string }>,
  ): Promise<C.EvaluationCallReceipt> {
    const task = this.perform(raw, commitIntent);
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return task;
  }
  private async perform(
    raw: C.EvaluationCallInput,
    commitIntent: (digest: string) => Promise<C.EvaluationAuthorization & { intentDigest: string }>,
  ): Promise<C.EvaluationCallReceipt> {
    const input = C.evaluationCallInput.parse(raw),
      who = this.caller(true),
      check = captureOperationCheck();
    if (Buffer.byteLength(input.system) > 8192 || Buffer.byteLength(input.prompt) > 65536)
      suiteFail('EVALUATION_REQUEST_BYTES');
    await check();
    if (this.closed) suiteFail('EVALUATION_CLOSED');
    const target = this.target(input.target),
      remaining = Date.parse(input.deadline) - Date.now();
    if (remaining <= 0 || remaining > 60000) suiteFail('EVALUATION_CALL_DEADLINE');
    const digest = suiteHash(input),
      existing = (await this.rows()).find((r) => r.id === input.id);
    if (existing) {
      this.assertOwner(existing, who);
      if (existing.requestDigest !== digest) suiteFail('EVALUATION_CALL_CHANGED');
      return existing;
    }
    if (this.closed) suiteFail('EVALUATION_CLOSED');
    if (this.reservations >= 2) suiteFail('EVALUATION_CALL_BUSY');
    this.reservations++;
    const receipt = C.evaluationCallReceipt.parse({
      ...who,
      id: input.id,
      requestDigest: digest,
      planDigest: input.planDigest,
      modelDigest: input.modelDigest,
      state: 'intent',
      createdAt: now(),
      sentAt: null,
      finishedAt: null,
      output: null,
      outputDigest: null,
      elapsedMs: null,
      usage: { input: null, output: null },
      truncated: false,
      error: null,
      intentDigest: null,
    });
    try {
      await this.change((rows) => {
        if (rows.some((r) => r.id === input.id)) suiteFail('EVALUATION_CALL_REPLAY');
        if (rows.length >= 1000 || Buffer.byteLength(JSON.stringify(rows)) + 80 * 1024 > 8 * 1024 ** 2)
          suiteFail('EVALUATION_CALL_LEDGER_FULL');
        rows.push(receipt);
      });
    } catch (error) {
      this.reservations--;
      throw error;
    }
    const abort = new AbortController(),
      signal = AbortSignal.any([abort.signal, AbortSignal.timeout(remaining), this.shutdown.signal]);
    const work = async () => {
      let sent = false;
      const begin = performance.now();
      try {
        const auth = await commitIntent(digest);
        if ((auth.bearer === null) !== (target.secretVersion === null))
          suiteFail('EVALUATION_SECRET_BINDING');
        await check();
        signal.throwIfAborted();
        const model = await this.probe(target, auth, signal);
        if (model.modelDigest !== input.modelDigest) suiteFail('EVALUATION_MODEL_CHANGED');
        const fresh = await commitIntent(digest);
        if (fresh.intentDigest !== auth.intentDigest || fresh.bearer !== auth.bearer)
          suiteFail('EVALUATION_AUTHORIZATION_CHANGED');
        await check();
        signal.throwIfAborted();
        await this.update(input.id, { intentDigest: auth.intentDigest, state: 'sent', sentAt: now() });
        sent = true;
        const v = z
          .object({
            model: C.evaluationModel,
            done: z.literal(true),
            done_reason: z.string().optional(),
            remote_host: z.string().optional(),
            remote_model: z.string().optional(),
            message: z.object({
              role: z.literal('assistant'),
              content: z.string().max(65536),
              tool_calls: z.array(z.unknown()).optional(),
            }),
            prompt_eval_count: z.number().int().min(0).optional(),
            eval_count: z.number().int().min(0).optional(),
          })
          .passthrough()
          .parse(
            await this.json(
              target,
              '/api/chat',
              {
                model: target.model,
                stream: false,
                messages: [
                  { role: 'system', content: input.system },
                  { role: 'user', content: input.prompt },
                ],
                options: {
                  temperature: input.options.temperature,
                  num_predict: input.options.maxTokens,
                  seed: input.options.seed,
                },
              },
              auth,
              signal,
            ),
          );
        if (v.remote_host || v.remote_model || v.message.tool_calls?.length || v.model !== target.model)
          suiteFail('EVALUATION_RESPONSE_IDENTITY');
        if (auth.bearer && v.message.content.includes(auth.bearer))
          suiteFail('EVALUATION_RESPONSE_CREDENTIAL');
        if (Buffer.byteLength(v.message.content) > (input.maxOutputBytes ?? 65536))
          suiteFail('EVALUATION_OUTPUT_BUDGET');
        await check();
        await commitIntent(digest);
        signal.throwIfAborted();
        return await this.update(input.id, {
          state: 'returned',
          finishedAt: now(),
          output: v.message.content,
          outputDigest: suiteSha(v.message.content),
          elapsedMs: Math.round(performance.now() - begin),
          usage: { input: v.prompt_eval_count ?? null, output: v.eval_count ?? null },
          truncated: v.done_reason === 'length',
        });
      } catch (error) {
        return this.update(input.id, {
          state: sent ? 'unknown' : 'rejected',
          finishedAt: now(),
          elapsedMs: Math.round(performance.now() - begin),
          error: signal.aborted
            ? 'CANCELLED_OR_TIMEOUT'
            : typeof (error as { code?: unknown }).code === 'string'
              ? String((error as { code: string }).code).slice(0, 120)
              : 'MODEL_PROTOCOL_OR_AUTHORIZATION_FAILED',
        });
      } finally {
        this.active.delete(input.id);
        this.reservations--;
      }
    };
    const done = work();
    this.active.set(input.id, { abort, done });
    return done;
  }
  private update(id: string, patch: Partial<C.EvaluationCallReceipt>) {
    return this.change((rows) => {
      const row = rows.find((r) => r.id === id) ?? suiteFail('EVALUATION_CALL_NOT_FOUND');
      Object.assign(row, patch);
      return C.evaluationCallReceipt.parse(row);
    });
  }
  private assertOwner(row: C.EvaluationCallReceipt, who: ReturnType<EvaluationCalls['caller']>) {
    if (row.actor !== who.actor || row.consumer !== who.consumer)
      suiteFail('EVALUATION_CALL_OWNER', '调用属于其他主体或消费者', 403);
  }
  async inspect(id: string) {
    const who = this.caller(),
      row = (await this.rows()).find((r) => r.id === id) ?? suiteFail('EVALUATION_CALL_NOT_FOUND');
    this.assertOwner(row, who);
    return row;
  }
  async cancel(id: string) {
    await this.inspect(id);
    const active = this.active.get(id);
    if (active) {
      active.abort.abort();
      await active.done;
    }
    return this.inspect(id);
  }
  async close() {
    this.closed = true;
    this.shutdown.abort();
    for (const p of this.active.values()) p.abort.abort();
    await Promise.allSettled([...this.pending]);
    await this.tail;
  }
}
