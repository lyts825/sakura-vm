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
export const defaultClipboardRule = (): ClipboardRule => ({
  copy: true,
  paste: true,
  files: true,
  sensitive: false,
  maxTextBytes: 1048576,
});
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
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((key) => names.includes(key));
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
export function effectiveClipboardRule(
  policies: ClipboardPolicies,
  context: ClipboardContext,
): ClipboardRule {
  return policies.instances[context.vmId || '']?.[context.app] || policies.defaults[context.app];
}

/** Metadata-only decision; sensitive text is checked separately without retaining it. */
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
