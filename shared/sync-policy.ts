/**
 * 模块职责（中文）：同步路径策略、合并驱动和重命名识别规则，按匹配顺序决定路径的传输行为。
 * Module responsibility (English): Matching sync paths, selecting merge drivers and identifying unambiguous renames.
 * 详细范围（中文）：公开入口包括 syncPattern, syncPolicySchema, SyncPolicy, syncMergeDriverSchema, SyncMergeDriver, matchesSyncPattern, pathPolicy, mergeDriver, policyAllows, SyncRename, detectSyncRenames；职责覆盖匹配同步路径、决策合并驱动并识别无歧义重命名，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include syncPattern, syncPolicySchema, SyncPolicy, syncMergeDriverSchema, SyncMergeDriver, matchesSyncPattern, pathPolicy, mergeDriver, policyAllows, SyncRename, detectSyncRenames. The scope covers Matching sync paths, selecting merge drivers and identifying unambiguous renames. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

export const syncPattern = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) => !/[\\\x00-\x1f]/.test(value) && !value.split('/').includes('..') && !value.startsWith('/'),
    '规则需要相对路径，使用 / 分隔',
  );
export const syncPolicySchema = z
  .object({
    pattern: syncPattern,
    direction: z.enum(['both', 'push', 'pull', 'readonly']),
    guestMode: z
      .string()
      .regex(/^[0-7]{3}$/, 'Linux 权限使用三位八进制，例如 644')
      .optional(),
  })
  .strict();
export type SyncPolicy = z.infer<typeof syncPolicySchema>;

export const syncMergeDriverSchema = z.object({
  pattern: syncPattern,
  mode: z.enum(['manual', 'keep-both', 'prefer-host', 'prefer-guest', 'merge-text']),
}).strict();
export type SyncMergeDriver = z.infer<typeof syncMergeDriverSchema>;

// 这是同步专用模式：单星不跨目录、双星可跨目录；无斜杠的模式可匹配任意层级的名称。
/**
 * 中文：按同步专用的简化 glob 规则判断路径是否符合任一模式；空模式列表返回 false，匹配结果供同步策略与合并驱动选择使用。
 * English: Test whether a path matches any pattern under the sync-specific simplified glob rules. An empty pattern list returns false; policy and merge-driver selection use the result.
 * 中文：输入：path：目标文件或请求路径；patterns：签名所示 string[] 业务值（缺省 []）
 * English: Inputs: path: target file/request path; patterns: the string[] domain value in the signature (default [])
 */
export function matchesSyncPattern(path: string, patterns: string[] = []) {
  return patterns.some(/**
   * 中文功能：把一个同步路径模式编译为转义后的正则表达式，并匹配 path。
   * English: Compile one sync-path pattern into an escaped regular expression and test path.
   * 输入 / Inputs: pattern 为当前模式字符串 / the current pattern string; path 来自外层函数 / captured from the outer function.
   * 结果与影响：返回布尔匹配值；仅分配局部字符串与正则，不读写文件。
   * Result and effects: Return a boolean match; allocate local strings and a regular expression without file I/O.
   * 设计思路：先分离 ** 再处理 *，使前者跨目录、后者限制在单一路径段；字面部分转义防止意外正则含义。含斜杠的模式从路径开头匹配，无斜杠的模式可从任一路径段开始；末尾边界也接受后续子目录。这里使用项目的简化规则，不实现完整 gitignore 语法。
   * Design: Split ** before processing * so the former crosses directories and the latter stays within a segment; escape literal parts to avoid accidental regex meaning. Slash-containing patterns anchor at the path start, while other patterns can start at any segment; the ending boundary also permits descendants. These are the project's simplified rules, rather than the full gitignore syntax.
   */ (pattern) => {
    const value = pattern.replace(/\/$/, '');
    const regex = value
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    return new RegExp(`${value.includes('/') ? '^' : '(^|/)'}${regex}($|/)`).test(path);
  });
}

/**
 * 中文：按声明顺序返回首个模式匹配的同步策略，未匹配保留 undefined 供默认双向策略使用。
 * English: Return the first declared matching sync policy, retaining undefined for the default bidirectional policy when unmatched.
 * 中文：输入：path：目标文件或请求路径；policies：签名所示 SyncPolicy[] 业务值（缺省 []）
 * English: Inputs: path: target file/request path; policies: the SyncPolicy[] domain value in the signature (default [])
 */
export function pathPolicy(path: string, policies: SyncPolicy[] = []) {
  return policies.find((policy) => matchesSyncPattern(path, [policy.pattern]));
}

/**
 * 中文：按声明顺序选第一个路径模式匹配的合并驱动，未匹配由同步流程使用默认处理。
 * English: Select the first declared path-matching merge driver, allowing the sync flow's default handling when unmatched.
 * 中文：输入：path：目标文件或请求路径；drivers：签名所示 SyncMergeDriver[] 业务值（缺省 []）
 * English: Inputs: path: target file/request path; drivers: the SyncMergeDriver[] domain value in the signature (default [])
 */
export function mergeDriver(path: string, drivers: SyncMergeDriver[] = []) {
  return drivers.find((driver) => matchesSyncPattern(path, [driver.pattern]));
}

/**
 * 中文：skip/same 始终允许，其余操作按 readonly/both/push/pull 限制；推拉各自只允许对应目标侧创建、删除和重命名。
 * English: Always allow skip/same and restrict other actions by readonly/both/push/pull; push/pull permit creation/deletion/rename only on their corresponding target side.
 * 中文：输入：path：目标文件或请求路径；action：本次动作或状态机输入；policies：签名所示 SyncPolicy[] 业务值（缺省 []）
 * English: Inputs: path: target file/request path; action: current action/state-machine input; policies: the SyncPolicy[] domain value in the signature (default [])
 */
export function policyAllows(path: string, action: string, policies: SyncPolicy[] = []) {
  const direction = pathPolicy(path, policies)?.direction || 'both';
  if (action === 'skip' || action === 'same') return true;
  if (direction === 'readonly') return false;
  if (direction === 'both') return true;
  return (
    direction === 'push'
      ? ['push', 'mkdir-guest', 'delete-guest', 'rename-guest']
      : ['pull', 'mkdir-host', 'delete-host', 'rename-host']
  ).includes(action);
}

export type SyncRename = { from: string; path: string; action: 'rename-host' | 'rename-guest'; sha: string };
// A rename is only inferred for a unique, unchanged file with an untouched peer.
// Duplicate content remains a normal copy/deletion decision.
/**
 * 中文：只在原文件一侧缺失、另一侧仍保留原摘要且新增内容唯一时推断重命名；重复内容或仅大小写改变继续使用普通复制/删除决策。
 * English: Infer renames only when one original path disappears, the peer retains its old digest and added content is unique. Duplicate content or case-only changes retain ordinary copy/deletion decisions.
 * 中文：输入：host：签名所示 Map<string, string> 业务值；guest：签名所示 Map<string, string> 业务值；previous：用于比较或复用的上一快照
 * English: Inputs: host: the Map<string, string> domain value in the signature; guest: the Map<string, string> domain value in the signature; previous: previous snapshot for comparison/reuse
 */
export function detectSyncRenames(
  host: Map<string, string>,
  guest: Map<string, string>,
  previous: Record<string, string>,
) {
  const result: SyncRename[] = [];
  for (const [source, target, action] of [
    [host, guest, 'rename-guest'],
    [guest, host, 'rename-host'],
  ] as const) {
    const missing = new Map<string, string[]>(),
      added = new Map<string, string[]>();
    for (const [name, sha] of Object.entries(previous)) {
      if (!source.has(name) && target.get(name) === sha)
        missing.set(sha, [...(missing.get(sha) || []), name]);
    }
    for (const [name, sha] of source) {
      if (!Object.hasOwn(previous, name) && !target.has(name))
        added.set(sha, [...(added.get(sha) || []), name]);
    }
    for (const [sha, oldNames] of missing) {
      const newNames = added.get(sha);
      if (
        oldNames.length === 1 &&
        newNames?.length === 1 &&
        oldNames[0].toLowerCase() !== newNames[0].toLowerCase()
      )
        result.push({ from: oldNames[0], path: newNames[0], sha, action });
    }
  }
  return result;
}
