/**
 * 模块职责：校验仓库 URL 与认证范围，拒绝点路径和重复分隔符以避免路径授权歧义。
 * Module purpose: Validates repository URLs/authentication scope, refusing dot paths and duplicate separators that obscure authorization boundaries.
 */
import { dependencyEndpoint } from './dependency-downloads.ts';

export const repositoryUrl = dependencyEndpoint.refine(value => {
  // Inspect the original path too: URL() normalizes dot segments before validation.
  try {
    const path = /^https?:\/\/[^/]+(\/[^?#]*)?/.exec(value)?.[1] || '/';
    const decoded = decodeURIComponent(path);
    return !decoded.includes('//') && !decoded.split('/').some(part => part === '.' || part === '..');
  } catch { return false; }
}, '仓库路径不能包含点路径或重复分隔符');

/**
 * 入口 / Entry: repositoryAuthorizationScope.
 * 功能：在校验仓库 URL 与认证范围中，执行此领域的具体处理步骤并返回其结果；本入口产生 `target.origin === scope.origin && (target.pathname === path || target.pathname.startsWith(path + '/'))` 供上层消费（`repository-url.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `repository-url.ts`; this entry produces `target.origin === scope.origin && (target.pathname === path || target.pathname.startsWith(path + '/'))` for its caller. Module context: Validates repository URLs/authentication scope, refusing dot paths and duplicate separators that obscure authorization boundaries.
 * 处理：通过 `repositoryUrl.parse`, `scope.pathname.replace`, `target.pathname.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `repositoryUrl.parse`, `scope.pathname.replace`, `target.pathname.startsWith`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: repository: string; endpoint: string
 * 输出 / Returns: `target.origin === scope.origin && (target.pathname === path || target.pathname.startsWith(path + '/'))`.
 * 副作用 / Effects: `scope.pathname.replace`; `target.pathname.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function repositoryAuthorizationScope(repository: string, endpoint: string) {
  const target = new URL(repositoryUrl.parse(repository)), scope = new URL(repositoryUrl.parse(endpoint));
  const path = scope.pathname.replace(/\/$/, '');
  return target.origin === scope.origin && (target.pathname === path || target.pathname.startsWith(path + '/'));
}
