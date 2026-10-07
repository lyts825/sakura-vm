/**
 * 模块职责：接入本机模型服务并生成可预览命令计划，校验服务地址、配置与输出结构。
 * Module purpose: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
 */
import { networkFor } from './network/index.ts';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import {
  assistantModes,
  redactAssistantContext,
  type AssistantView,
  type AssistantPreview,
  type AssistantResult,
  type AssistantMode,
} from '../shared/assistant.ts';

const { fetch } = networkFor('core:local-assistant');

const modelName = z
  .string()
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$|^$/);
/**
 * 入口 / Entry: callback@32.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().max().refine / 需要本机 HTTP 模型服务根地址）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().max().refine / 需要本机 HTTP 模型服务根地址).
 * 输入 / Inputs: value
 * 输出 / Returns: `( url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password &&…`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    endpoint: z
      .string()
      .max(200)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, '需要本机 HTTP 模型服务根地址'),
    model: modelName,
    timeoutSeconds: z.number().int().min(10).max(300),
    maxTokens: z.number().int().min(128).max(8192),
  })
  .strict();
const inputSchema = z
  .object({
    mode: z.enum(assistantModes),
    instruction: z.string().trim().min(1).max(4000),
    context: z.string().max(20000).default(''),
  })
  .strict();
export const assistantRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      version: z.number().int().positive(),
      settings: settingsSchema,
    })
    .strict(),
  z.object({ action: z.literal('models') }).strict(),
  z.object({ action: z.literal('preview'), input: inputSchema }).strict(),
  z.object({ action: z.literal('generate'), previewId: z.string().regex(/^[a-f0-9]{48}$/) }).strict(),
]);
/**
 * 入口 / Entry: text.
 * 功能：在接入本机模型服务并生成可预览命令计划中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z .string() .min(1) .max(max) .refine((value) => !value.includes('\0'))` 供上层消费（`local-assistant.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `local-assistant.ts`; this entry produces `z .string() .min(1) .max(max) .refine((value) => !value.includes('\0'))` for its caller. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
 * 处理：通过 `z.string().min().max().refine`, `z.string().min().max`, `z.string().min`, `z.string` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.string().min().max().refine`, `z.string().min().max`, `z.string().min`, `z.string`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: max: number
 * 输出 / Returns: `z .string() .min(1) .max(max) .refine((value) => !value.includes('\0'))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0'));
export const commandPlanSchema = z
  .object({
    goal: text(500),
    assumptions: z.array(text(500)).max(8),
    steps: z
      .array(
        z
          .object({
            purpose: text(500),
            command: text(2000),
            risk: z.enum(['read', 'change', 'destructive']),
            verify: text(500),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
const planFormat = z.toJSONSchema(commandPlanSchema, { unrepresentable: 'any' });
const guidance: Record<AssistantMode, string> = {
  ask: '回答用户的编程问题，明确无法从所给材料确定的部分。',
  explain: '解释代码行为、数据流和必要的前提。',
  tests: '根据代码提供可运行的测试建议和边界用例，标明假设的测试框架。',
  fix: '分析问题并给出修复建议或代码，说明验证方式，不宣称已经修改或运行。',
  plan: '为目标生成 Linux shell 命令计划。每步说明用途、影响范围和检查方式。read 表示只读，change 表示会写入，destructive 表示会删除或覆盖。不要声称命令已经执行。只返回符合给定 JSON Schema 的对象。',
};
type PendingPreview = AssistantPreview & { version: number };
/**
 * 入口 / Entry: localModel.
 * 功能：从当前输入或状态计算 `!value.remote_host && !value.remote_model && !/(?:^|[:-])cloud(?:$|[:/-])/i.test(value.name || value.model || '') && value.de…`，供调用方后续验证或使用。
 * Purpose: Computes `!value.remote_host && !value.remote_model && !/(?:^|[:-])cloud(?:$|[:/-])/i.test(value.name || value.model || '') && value.de…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: { name?: string; model?: string; remote_host?: string; remote_model?: string; details…
 * 输出 / Returns: `!value.remote_host && !value.remote_model && !/(?:^|[:-])cloud(?:$|[:/-])/i.test(value.name || value.model || '') && value.de…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const localModel = (value: {
  name?: string;
  model?: string;
  remote_host?: string;
  remote_model?: string;
  details?: { format?: string };
  model_info?: Record<string, unknown>;
}) =>
  !value.remote_host &&
  !value.remote_model &&
  !/(?:^|[:-])cloud(?:$|[:/-])/i.test(value.name || value.model || '') &&
  value.details?.format === 'gguf';
export class LocalAssistant {
  private state = {
    version: 1,
    settings: settingsSchema.parse({
      enabled: false,
      endpoint: 'http://127.0.0.1:11434',
      model: '',
      timeoutSeconds: 120,
      maxTokens: 2048,
    }),
  };
  private previews = new Map<string, PendingPreview>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: Promise<unknown>;
  private active?: AbortController;
  private closed = false;
  /**
   * 入口 / Entry: LocalAssistant.constructor.
   * 功能：建立 LocalAssistant 的接入本机模型服务并生成可预览命令计划上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the LocalAssistant context for this module's responsibility: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: default=join(DATA, 'local-assistant.json'); fetcher: typeof fetch default=fetch; now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private file = join(DATA, 'local-assistant.json'),
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  /**
   * 入口 / Entry: LocalAssistant.init.
   * 功能：在接入本机模型服务并生成可预览命令计划中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`LocalAssistant`）。
   * Purpose: Initializes and verifies current domain state in `LocalAssistant`; the outcome is recorded in `this.state`. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `z.object().strict().parse`, `z.object().strict`, `z.object`, `z.number().int().positive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.object().strict().parse`, `z.object().strict`, `z.object`, `z.number().int().positive`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = z
      .object({ version: z.number().int().positive(), settings: settingsSchema })
      .strict()
      .parse(await readStore(this.file, () => this.state));
  }
  /**
   * 入口 / Entry: LocalAssistant.view.
   * 功能：从当前输入或状态计算 `{ ...structuredClone(this.state), busy: !!this.pending }`，供调用方后续验证或使用。
   * Purpose: Computes `{ ...structuredClone(this.state), busy: !!this.pending }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: AssistantView；结果来自 / values from `{ ...structuredClone(this.state), busy: !!this.pending }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): AssistantView {
    return { ...structuredClone(this.state), busy: !!this.pending };
  }
  /**
   * 入口 / Entry: LocalAssistant.revoke.
   * 功能：在接入本机模型服务并生成可预览命令计划中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`LocalAssistant`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAssistant`; the calls and state transitions below complete the operation. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `this.previews.clear`, `this.active.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.previews.clear`, `this.active.abort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.previews.clear`; `this.active.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  revoke() {
    this.previews.clear();
    this.active?.abort();
  }
  /**
   * 入口 / Entry: LocalAssistant.configure.
   * 功能：在接入本机模型服务并生成可预览命令计划中，校验并提交领域状态变更；本入口产生 `task` 供上层消费（`LocalAssistant`）。
   * Purpose: Validates and commits a domain state change in `LocalAssistant`; this entry produces `task` for its caller. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `settingsSchema.parse`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `settingsSchema.parse`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: version: number; input: unknown
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `settingsSchema.parse`; 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  configure(version: number, input: unknown) {
    const settings = settingsSchema.parse(input);
    /**
     * 入口 / Entry: LocalAssistant.configure.callback@156.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.queue.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.queue.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; `this.previews.clear`; `this.active.abort`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `version !== this.state.version`; 异常 / errors `new AppError('助手服务正在关闭', 503)`; `new AppError('模型设置已变化，请刷新后保存', 409)`.
     */
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('助手服务正在关闭', 503);
        if (version !== this.state.version) throw new AppError('模型设置已变化，请刷新后保存', 409);
        const next = {
          version: version + 1,
          settings: { ...settings, endpoint: new URL(settings.endpoint).origin },
        };
        await writeStore(this.file, next);
        this.state = next;
        this.previews.clear();
        this.active?.abort();
        return this.view();
      });
    this.queue = task;
    return task;
  }
  /**
   * 入口 / Entry: LocalAssistant.preview.
   * 功能：在接入本机模型服务并生成可预览命令计划中，执行此领域的具体处理步骤并返回其结果；本入口产生 `view` 供上层消费（`LocalAssistant`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAssistant`; this entry produces `view` for its caller. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `inputSchema.parse`, `redactAssistantContext`, `this.now`, `this.previews.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inputSchema.parse`, `redactAssistantContext`, `this.now`, `this.previews.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `preview.expiresAt <= this.now()`.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: AssistantPreview；结果来自 / values from `view`.
   * 副作用 / Effects: `this.previews.delete`; `this.previews.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `Buffer.byteLength(combined) > 64000`; 异常 / errors `new AppError('助手服务正在关闭', 503)`; `new AppError('上下文超过 64 KiB，请缩小范围', 413)`.
   */
  preview(input: unknown): AssistantPreview {
    if (this.closed) throw new AppError('助手服务正在关闭', 503);
    const value = inputSchema.parse(input);
    const combined = `用户目标：\n${value.instruction}${value.context ? '\n\n用户提供的代码或上下文：\n' + value.context : ''}`;
    if (Buffer.byteLength(combined) > 64000) throw new AppError('上下文超过 64 KiB，请缩小范围', 413);
    const redacted = redactAssistantContext(combined);
    for (const [id, preview] of this.previews) if (preview.expiresAt <= this.now()) this.previews.delete(id);
    while (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value!);
    const preview = {
      id: randomBytes(24).toString('hex'),
      version: this.state.version,
      mode: value.mode,
      ...redacted,
      expiresAt: this.now() + 5 * 60000,
      model: this.state.settings.model,
      endpoint: this.state.settings.endpoint,
    };
    this.previews.set(preview.id, preview);
    const { version: _version, ...view } = preview;
    return view;
  }
  /**
   * 入口 / Entry: LocalAssistant.operate.
   * 功能：在接入本机模型服务并生成可预览命令计划中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new AppError('助手服务正在关闭', 503))` / `Promise.reject(new AppError('请先启用本地模型连接', 409))` 供上层消费（`LocalAssistant`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAssistant`; this entry produces `Promise.reject(new AppError('助手服务正在关闭', 503))` / `Promise.reject(new AppError('请先启用本地模型连接', 409))` for its caller. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `Promise.reject`, `external.throwIfAborted`, `AbortSignal.any`, `AbortSignal.timeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.reject`, `external.throwIfAborted`, `AbortSignal.any`, `AbortSignal.timeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `!this.state.settings.enabled`; `this.pending`.
   * 输入 / Inputs: work: (signal: AbortSignal) => Promise<T>; external: AbortSignal optional
   * 输出 / Returns: Promise<T>；结果来自 / values from `Promise.reject(new AppError('助手服务正在关闭', 503))`; `Promise.reject(new AppError('请先启用本地模型连接', 409))`; `Promise.reject(new AppError('已有模型请求在进行，请等待或取消', 429))`.
   * 副作用 / Effects: `AbortSignal.any`; `AbortSignal.timeout`; 更新 / updates `this.active`, `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private operate<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new AppError('助手服务正在关闭', 503));
    if (!this.state.settings.enabled) return Promise.reject(new AppError('请先启用本地模型连接', 409));
    if (this.pending) return Promise.reject(new AppError('已有模型请求在进行，请等待或取消', 429));
    external?.throwIfAborted();
    const abort = new AbortController(),
      version = this.state.version;
    this.active = abort;
    const signal = AbortSignal.any([
      abort.signal,
      ...(external ? [external] : []),
      AbortSignal.timeout(this.state.settings.timeoutSeconds * 1000),
    ]);
    const pending = work(signal)
      .then((value) => {
        signal.throwIfAborted();
        if (version !== this.state.version) throw new AppError('模型设置已变化，请重新预览', 409);
        return value;
      })
      .catch((error) => {
        if (signal.aborted) throw new AppError('模型请求已取消或超时，请重新预览后重试', 408);
        if (error instanceof AppError) throw error;
        throw new AppError('无法读取本机模型响应，请检查服务和已下载的模型', 502);
      })
      .finally(() => {
        if (this.pending === pending) {
          this.pending = undefined;
          this.active = undefined;
        }
      });
    this.pending = pending;
    return pending;
  }
  /**
   * 入口 / Entry: LocalAssistant.json.
   * 功能：在接入本机模型服务并生成可预览命令计划中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.parse(Buffer.concat(chunks).toString('utf8'))` 供上层消费（`LocalAssistant`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAssistant`; this entry produces `JSON.parse(Buffer.concat(chunks).toString('utf8'))` for its caller. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `signal.throwIfAborted`, `this.fetcher`, `response.body.cancel`, `response.body.getReader` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.fetcher`, `response.body.cancel`, `response.body.getReader`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `done`.
   * 输入 / Inputs: path: string; signal: AbortSignal; data: unknown optional
   * 输出 / Returns: `JSON.parse(Buffer.concat(chunks).toString('utf8'))`.
   * 副作用 / Effects: `this.fetcher`; `chunks.push`; `reader.releaseLock`; 更新 / updates `bytes`.
   * 拒绝 / Refusals: 条件 / conditions `!response.ok`; `!response.body`; `bytes > 1024 * 1024`; 异常 / errors `new AppError(`本机模型服务返回 HTTP ${response.status}`, 502)`; `new AppError('本机模型响应为空', 502)`.
   * 收尾：退出 try 区域时始终执行 `await reader.cancel().catch(() => {});`; `reader.releaseLock();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await reader.cancel().catch(() => {});`; `reader.releaseLock();`; these steps also apply to exceptional exits.
   */
  private async json(path: string, signal: AbortSignal, data?: unknown) {
    signal.throwIfAborted();
    const response = await this.fetcher(this.state.settings.endpoint + path, {
      method: data === undefined ? 'GET' : 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: data === undefined ? {} : { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(`本机模型服务返回 HTTP ${response.status}`, 502);
    }
    if (!response.body) throw new AppError('本机模型响应为空', 502);
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) throw new AppError('模型响应超过 1 MiB，请降低生成长度', 502);
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  /**
   * 入口 / Entry: LocalAssistant.models.
   * 功能：把本层请求转交 `this.operate`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.operate` and propagates the provider result or rejection.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `this.operate(async (abort) => { const value = z .object({ models: z .array( z .object({ name: modelName, size: z.number().non…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  models(signal?: AbortSignal) {
    /**
     * 入口 / Entry: LocalAssistant.models.callback@260.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.operate）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.operate).
     * 输入 / Inputs: abort
     * 输出 / Returns: `{ models: value.models .filter((model) => model.name && localModel(model)) .map((model) => ({ name: model.name, size: model.s…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.operate(async (abort) => {
      const value = z
        .object({
          models: z
            .array(
              z
                .object({
                  name: modelName,
                  size: z.number().nonnegative(),
                  remote_host: z.string().optional(),
                  remote_model: z.string().optional(),
                  details: z.object({ format: z.string().optional() }).optional(),
                })
                .passthrough(),
            )
            .max(1000),
        })
        .parse(await this.json('/api/tags', abort));
      return {
        models: value.models
          .filter((model) => model.name && localModel(model))
          .map((model) => ({ name: model.name, size: model.size })),
      };
    }, signal);
  }
  /**
   * 入口 / Entry: LocalAssistant.generate.
   * 功能：把本层请求转交 `this.operate`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.operate` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `this.operate<AssistantResult>(async (abort) => { const preview = this.previews.get(id); this.previews.delete(id); if (!previe…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  generate(id: string, signal?: AbortSignal) {
    /**
     * 入口 / Entry: LocalAssistant.generate.callback@286.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.operate）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.operate).
     * 输入 / Inputs: abort
     * 输出 / Returns: `{ mode: preview.mode, model: value.model, content: value.message.content, ...(plan ? { plan } : {}), generatedAt: new Date(th…`.
     * 副作用 / Effects: `this.previews.delete`; 更新 / updates `plan`.
     * 拒绝 / Refusals: 条件 / conditions `!preview || preview.expiresAt <= this.now() || preview.version !== this.state.version`; `!preview.model`; `!localModel({ ...model, name: preview.model }) || !model.model_info || !Object.keys(model.model_info).length`; 异常 / errors `new AppError('发送预览已过期或设置已改变，请重新预览', 409)`; `new AppError('请先选择已下载的本地模型', 409)`.
     * 失败处理：catch 分支执行 `throw new AppError('模型未返回完整的命令计划，请调整目标或生成长度后重试', 502);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `throw new AppError('模型未返回完整的命令计划，请调整目标或生成长度后重试', 502);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.operate<AssistantResult>(async (abort) => {
      const preview = this.previews.get(id);
      this.previews.delete(id);
      if (!preview || preview.expiresAt <= this.now() || preview.version !== this.state.version)
        throw new AppError('发送预览已过期或设置已改变，请重新预览', 409);
      if (!preview.model) throw new AppError('请先选择已下载的本地模型', 409);
      const model = z
        .object({
          remote_host: z.string().optional(),
          remote_model: z.string().optional(),
          details: z.object({ format: z.string().optional() }).optional(),
          model_info: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .parse(await this.json('/api/show', abort, { model: preview.model }));
      if (
        !localModel({ ...model, name: preview.model }) ||
        !model.model_info ||
        !Object.keys(model.model_info).length
      )
        throw new AppError('此模型未提供本地权重信息或声明了远程转发，未发送上下文', 409);
      const raw = await this.json('/api/chat', abort, {
        model: preview.model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: `你是 Sakura 的编程助手，按用户使用的语言回答。你只能根据显式提供的文本给出建议，无法访问文件、终端或执行工具。[REDACTED] 是已隐藏的敏感内容，不要猜测其值。${guidance[preview.mode]}${preview.mode === 'plan' ? '\nJSON Schema: ' + JSON.stringify(planFormat) : ''}`,
          },
          { role: 'user', content: preview.content },
        ],
        options: {
          temperature: preview.mode === 'plan' ? 0 : 0.2,
          num_predict: this.state.settings.maxTokens,
        },
        ...(preview.mode === 'plan' ? { format: planFormat } : {}),
      });
      const value = z
        .object({
          model: z.string().min(1).max(128),
          done: z.literal(true),
          done_reason: z.string().optional(),
          remote_host: z.string().optional(),
          remote_model: z.string().optional(),
          message: z.object({
            role: z.literal('assistant'),
            content: z.string().min(1).max(65536),
            tool_calls: z.array(z.unknown()).optional(),
          }),
        })
        .parse(raw);
      if (value.remote_host || value.remote_model || value.message.tool_calls?.length)
        throw new AppError('模型返回了远程转发或工具调用，结果已拒绝', 502);
      let plan;
      if (preview.mode === 'plan') {
        try {
          plan = commandPlanSchema.parse(JSON.parse(value.message.content));
        } catch {
          throw new AppError('模型未返回完整的命令计划，请调整目标或生成长度后重试', 502);
        }
      }
      return {
        mode: preview.mode,
        model: value.model,
        content: value.message.content,
        ...(plan ? { plan } : {}),
        generatedAt: new Date(this.now()).toISOString(),
        truncated: value.done_reason === 'length',
      };
    }, signal);
  }
  /**
   * 入口 / Entry: LocalAssistant.close.
   * 功能：在接入本机模型服务并生成可预览命令计划中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`LocalAssistant`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `LocalAssistant`; the outcome is recorded in `this.closed`. Module context: Connects a local model service and produces previewable command plans, checking endpoint, settings and output structure.
   * 处理：通过 `this.previews.clear`, `this.active.abort`, `this.pending.catch`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.previews.clear`, `this.active.abort`, `this.pending.catch`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.previews.clear`; `this.active.abort`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.previews.clear();
    this.active?.abort();
    await this.pending?.catch(() => {});
    await this.queue.catch(() => {});
  }
}
