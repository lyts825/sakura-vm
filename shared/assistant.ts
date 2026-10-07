/**
 * 模块职责（中文）：本地助手请求/结果及命令计划契约，包含向模型发送上下文前的敏感信息脱敏规则。
 * Module responsibility (English): Defining local-assistant/command-plan contracts and redacting context.
 * 详细范围（中文）：公开入口包括 assistantModes, AssistantMode, AssistantSettings, AssistantView, AssistantPreview, CommandPlan, AssistantResult, redactAssistantContext；职责覆盖定义本地助手与命令计划契约并脱敏上下文，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include assistantModes, AssistantMode, AssistantSettings, AssistantView, AssistantPreview, CommandPlan, AssistantResult, redactAssistantContext. The scope covers Defining local-assistant/command-plan contracts and redacting context. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export const assistantModes = ['ask', 'explain', 'tests', 'fix', 'plan'] as const;
export type AssistantMode = (typeof assistantModes)[number];
export type AssistantSettings = {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutSeconds: number;
  maxTokens: number;
};
export type AssistantView = { version: number; settings: AssistantSettings; busy: boolean };
export type AssistantPreview = {
  id: string;
  mode: AssistantMode;
  content: string;
  redactions: number;
  expiresAt: number;
  model: string;
  endpoint: string;
};
export type CommandPlan = {
  goal: string;
  assumptions: string[];
  steps: Array<{ purpose: string; command: string; risk: 'read' | 'change' | 'destructive'; verify: string }>;
};
export type AssistantResult = {
  mode: AssistantMode;
  model: string;
  content: string;
  plan?: CommandPlan;
  generatedAt: string;
  truncated: boolean;
};

/** Best-effort recognizers. Preview remains necessary for identifiers outside these formats. */
/**
 * 中文：为定义本地助手与命令计划契约并脱敏上下文构造包含 content、redactions 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
 * English: Build a local data object containing content, redactions for Defining local-assistant/command-plan contracts and redacting context, using current inputs/explicit defaults for subsequent form/state processing
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：包含 content、redactions 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing content, redactions for caller state reads/operations
 */
export function redactAssistantContext(input: string) {
  let count = 0;
  /**
   * 中文：更新 input 以维护定义本地助手与命令计划契约并脱敏上下文当前状态；这些赋值属于此输入/事件的状态转换
   * English: Update input to maintain current state for Defining local-assistant/command-plan contracts and redacting context; these assignments belong to this input/event transition
   * 中文：输入：pattern：签名所示 RegExp 业务值；replacement：签名所示 string | ((...parts: string[]) => string) 业务值
   * English: Inputs: pattern: the RegExp domain value in the signature; replacement: the string | ((...parts: string[]) => string) domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const replace = (pattern: RegExp, replacement: string | (/** 中文：根据正则命中组生成脱敏替换文本，保留非敏感结构；这是 redactAssistantContext.replace 的调用契约 | English: Produce redacted replacement text from regex groups while retaining nonsensitive structure; this is the callable contract of redactAssistantContext.replace | 中文：输入：parts：签名所示 string[] 业务值 | English: Inputs: parts: the string[] domain value in the signature | 中文：结果：string；调用者依赖此类型约定 | English: Result: string; callers depend on this type contract */ (...parts: string[]) => string)) => {
    input = input.replace(pattern, (...parts) => {
      count++;
      return typeof replacement === 'string' ? replacement : replacement(...parts);
    });
  };
  replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g, '[REDACTED PRIVATE KEY]');
  replace(/PuTTY-User-Key-File-\d+:[\s\S]*/g, '[REDACTED PRIVATE KEY]');
  replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|xox[baprs]-[A-Za-z0-9-]{15,255}|sk-[A-Za-z0-9_-]{16,255}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
    '[REDACTED TOKEN]',
  );
  replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g, '[REDACTED JWT]');
  replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, (_all, scheme) => scheme + '[REDACTED]@');
  replace(
    /([?&](?:token|key|password|secret|api[_-]?key|access[_-]?token)=)[^\s&#"']+/gi,
    (_all, prefix) => prefix + '[REDACTED]',
  );
  replace(
    /\b((?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*:\s*)[^\r\n]+/gi,
    (_all, prefix) => prefix + '[REDACTED]',
  );
  replace(
    /\b((?:[A-Za-z0-9_-]*[_-])?(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|secret|token)["']?\s*[:=]\s*)[^\r\n]+/gi,
    (_all, prefix) => prefix + '[REDACTED]',
  );
  return { content: input, redactions: count };
}
