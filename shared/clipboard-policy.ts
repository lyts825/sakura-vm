/**
 * 模块职责（中文）：跨界面的剪贴板策略契约与判定规则，合并全局/应用设置并给出禁止传输的原因。
 * Module responsibility (English): Validating global/application clipboard rules and explaining transfer decisions.
 * 详细范围（中文）：公开入口包括 clipboardApps, ClipboardApp, ClipboardContext, ClipboardRule, ClipboardPolicies, defaultClipboardRule, defaultClipboardPolicies, clipboardAppNames, parseClipboardPolicies, effectiveClipboardRule, clipboardPolicyReason；职责覆盖校验全局/应用剪贴板规则并判定传输原因，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include clipboardApps, ClipboardApp, ClipboardContext, ClipboardRule, ClipboardPolicies, defaultClipboardRule, defaultClipboardPolicies, clipboardAppNames, parseClipboardPolicies, effectiveClipboardRule, clipboardPolicyReason. The scope covers Validating global/application clipboard rules and explaining transfer decisions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export const clipboardApps = ['workbench', 'terminal', 'files', 'desktop'] as const;
export type ClipboardApp = (typeof clipboardApps)[number];
export type ClipboardContext = { app: ClipboardApp; vmId?: string };
export type ClipboardRule = {
  copy: boolean;
  paste: boolean;
  files: boolean;
  sensitive: boolean;
  maxTextBytes: number;
};
export type ClipboardPolicies = {
  version: 1;
  defaults: Record<ClipboardApp, ClipboardRule>;
  instances: Record<string, Partial<Record<ClipboardApp, ClipboardRule>>>;
};
/**
 * 中文：创建允许复制、粘贴和文件的默认规则，敏感检测默认关闭，文本上限 1 MiB；每次返回独立对象。
 * English: Create a fresh default rule allowing copy/paste/files, with sensitivity disabled and a one-MiB text cap.
 * 中文：结果：ClipboardRule，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ClipboardRule carrying the described computation/transport result; throwing branches do not provide success
 */
export const defaultClipboardRule = (): ClipboardRule => ({
  copy: true,
  paste: true,
  files: true,
  sensitive: false,
  maxTextBytes: 1048576,
});
/**
 * 中文：为每个支持应用建立独立默认规则并初始化空实例覆盖，使用版本 1 协议。
 * English: Create independent defaults for every supported app and empty VM overrides under version-one protocol.
 * 中文：结果：ClipboardPolicies，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ClipboardPolicies carrying the described computation/transport result; throwing branches do not provide success
 */
export const defaultClipboardPolicies = (): ClipboardPolicies => ({
  version: 1,
  defaults: Object.fromEntries(
    clipboardApps.map((app) => [app, defaultClipboardRule()]),
  ) as ClipboardPolicies['defaults'],
  instances: {},
});
export const clipboardAppNames: Record<ClipboardApp, string> = {
  workbench: '工作台其他页面',
  terminal: '终端',
  files: '文件浏览与编辑',
  desktop: '远程桌面',
};
/**
 * 中文：判断未知值为非空、非数组对象，供后续字段读取和白名单验证。
 * English: Check an unknown value is a nonnull/nonarray object before field reads/whitelist validation.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：value is Record<string, unknown>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: value is Record<string, unknown> carrying the described computation/transport result; throwing branches do not provide success
 */
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/**
 * 中文：验证对象全部键在允许列表中，拒绝未知字段而不隐式丢弃。
 * English: Validate all object keys against the allowed list, rejecting unknown fields rather than silently dropping them.
 * 中文：输入：value：待校验、转换或保存的输入值；names：签名所示 readonly string[] 业务值
 * English: Inputs: value: input value to validate/transform/save; names: the readonly string[] domain value in the signature
 */
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((key) => names.includes(key));
/**
 * 中文：校验规则只有允许字段、四个布尔开关和 1 KiB 至 1 MiB 的整数文本上限。
 * English: Validate allowed fields, four boolean switches and an integer text cap from one KiB to one MiB.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：value is ClipboardRule，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: value is ClipboardRule carrying the described computation/transport result; throwing branches do not provide success
 */
function rule(value: unknown): value is ClipboardRule {
  return (
    record(value) &&
    keys(value, ['copy', 'paste', 'files', 'sensitive', 'maxTextBytes']) &&
    ['copy', 'paste', 'files', 'sensitive'].every((key) => typeof value[key] === 'boolean') &&
    Number.isInteger(value.maxTextBytes) &&
    Number(value.maxTextBytes) >= 1024 &&
    Number(value.maxTextBytes) <= 1048576
  );
}
/**
 * 中文：严格校验版本、所有应用默认和至多 64 个实例覆盖，拒绝未知字段与无效身份；structuredClone 返回隔离副本避免外部修改策略。
 * English: Strictly validate version/all app defaults/up to sixty-four VM overrides, rejecting unknown fields/invalid identities. Return a structuredClone so caller mutation cannot alter policy state.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：ClipboardPolicies，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ClipboardPolicies carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：剪贴板策略无效；实例剪贴板策略无效。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 剪贴板策略无效; 实例剪贴板策略无效. These errors reach the direct caller or this function's catch handler
 */
export function parseClipboardPolicies(value: unknown): ClipboardPolicies {
  if (
    !record(value) ||
    !keys(value, ['version', 'defaults', 'instances']) ||
    value.version !== 1 ||
    !record(value.defaults) ||
    !keys(value.defaults, clipboardApps) ||
    !clipboardApps.every((app) => rule((value.defaults as Record<string, unknown>)[app])) ||
    !record(value.instances) ||
    Object.keys(value.instances).length > 64
  )
    throw new Error('剪贴板策略无效');
  for (const [id, rules] of Object.entries(value.instances))
    if (
      !/^[a-f0-9-]{36}$/.test(id) ||
      !record(rules) ||
      !keys(rules, clipboardApps) ||
      !Object.values(rules).every(rule)
    )
      throw new Error('实例剪贴板策略无效');
  return structuredClone(value) as ClipboardPolicies;
}
/**
 * 中文：优先使用当前实例的应用覆盖，否则使用应用默认，返回已验证规则引用。
 * English: Prefer this VM's app override, otherwise return the app default, using validated rule references.
 * 中文：输入：policies：签名所示 ClipboardPolicies 业务值；context：当前调用所属的应用或工作区上下文
 * English: Inputs: policies: the ClipboardPolicies domain value in the signature; context: application/workspace context for the call
 * 中文：结果：ClipboardRule，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ClipboardRule carrying the described computation/transport result; throwing branches do not provide success
 */
export function effectiveClipboardRule(
  policies: ClipboardPolicies,
  context: ClipboardContext,
): ClipboardRule {
  return policies.instances[context.vmId || '']?.[context.app] || policies.defaults[context.app];
}

/** Metadata-only decision; sensitive text is checked separately without retaining it. */
/**
 * 中文：先检查方向和文件权限，再检查字节上限；终端粘贴另限制到 16 KiB，返回首个阻止原因或 null。
 * English: Check direction/file permission before byte limits, additionally cap terminal paste at sixteen KiB and return the first refusal reason or null.
 * 中文：输入：rule：签名所示 ClipboardRule 业务值；direction：复制或粘贴的传输方向；textBytes：签名所示 number 业务值；hasFiles：本次剪贴板内容是否包含文件；app：签名所示 ClipboardApp 业务值
 * English: Inputs: rule: the ClipboardRule domain value in the signature; direction: copy/paste transfer direction; textBytes: the number domain value in the signature; hasFiles: whether clipboard content contains files; app: the ClipboardApp domain value in the signature
 * 中文：结果：string | null，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: string | null carrying the described computation/transport result; throwing branches do not provide success
 */
export function clipboardPolicyReason(
  rule: ClipboardRule,
  direction: 'copy' | 'paste',
  textBytes: number,
  hasFiles: boolean,
  app: ClipboardApp,
): string | null {
  if (!rule[direction])
    return direction === 'copy' ? '此应用禁止向宿主剪贴板复制' : '此应用禁止从宿主剪贴板粘贴';
  if (hasFiles && !rule.files) return '此应用禁止剪贴板文件与图片';
  const maximum =
    app === 'terminal' && direction === 'paste' ? Math.min(rule.maxTextBytes, 16384) : rule.maxTextBytes;
  if (textBytes > maximum) return `文本超过 ${maximum / 1024} KiB 限制`;
  return null;
}
