import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import {
  assistantModes,
  redactAssistantContext,
  type AssistantView,
  type AssistantPreview,
  type AssistantResult,
  type AssistantMode,
} from '../shared/assistant.ts';

const modelName = z
  .string()
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$|^$/);
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
  constructor(
    private file = join(DATA, 'local-assistant.json'),
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  async init() {
    this.state = z
      .object({ version: z.number().int().positive(), settings: settingsSchema })
      .strict()
      .parse(await readStore(this.file, () => this.state));
  }
  view(): AssistantView {
    return { ...structuredClone(this.state), busy: !!this.pending };
  }
  revoke() {
    this.previews.clear();
    this.active?.abort();
  }
  configure(version: number, input: unknown) {
    const settings = settingsSchema.parse(input);
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
  models(signal?: AbortSignal) {
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
  generate(id: string, signal?: AbortSignal) {
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
  async close() {
    this.closed = true;
    this.previews.clear();
    this.active?.abort();
    await this.pending?.catch(() => {});
    await this.queue.catch(() => {});
  }
}
