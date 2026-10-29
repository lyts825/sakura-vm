/**
 * 模块职责：校验插件路由及 socket 贡献并解析归属，加载器目录来自生成的插件清单。
 * Module purpose: Validates route/socket contributions and resolves owners using generated plugin loaders.
 */
import { PLUGINS, PLUGIN_PACKS, type HttpContribution } from '../../shared/plugins.ts';
import { validateCatalog } from '../../shared/plugin-selection.ts';
import { loaders } from './loaders.generated.ts';
import { createOperationPathIndex } from '../operation-paths.ts';
export { matchOperationPath } from '../operation-paths.ts';
export { loaders } from './loaders.generated.ts';
export type { PluginModule } from '../plugin-api.ts';
/** Exact dispatch endpoints. Prefix declarations remain package ownership metadata only. */
/**
 * 入口 / Entry: pluginHttpRoutes.
 * 功能：把本层请求转交 `PLUGINS.flatMap`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `PLUGINS.flatMap` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `PLUGINS.flatMap((plugin) => plugin.contributes.routes.map((route) => ({ ...route, owner: plugin.id, methods: [route.method] a…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function pluginHttpRoutes() {
  return PLUGINS.flatMap((plugin) => plugin.contributes.routes.map((route) => ({
    ...route, owner: plugin.id, methods: [route.method] as HttpContribution['methods'],
    projectScoped: route.policy.projectScoped,
  })));
}
/** 静态声明只索引一次；请求路径和参数不进入缓存。 / Index declarations once, never request paths or parameters. */
const matchPluginRoutes = createOperationPathIndex(pluginHttpRoutes(), route => route.path,
  pattern => pattern.match(/[:{]/g)?.length || 0);
/**
 * 入口 / Entry: validateRegistry.
 * 功能：在校验插件路由及 socket 贡献并解析归属中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`plugins/registry.ts`）。
 * Purpose: Checks admission, input or resource ownership in `plugins/registry.ts`; the calls and state transitions below complete the operation. Module context: Validates route/socket contributions and resolves owners using generated plugin loaders.
 * 处理：通过 `validateCatalog`, `PLUGINS.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `validateCatalog`, `PLUGINS.some`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `Object.keys(loaders).length !== PLUGINS.length || PLUGINS.some((plugin) => !Object.hasOwn(loaders, plugin.id))`; 异常 / errors `new Error('插件声明与服务入口不一致')`.
 */
export function validateRegistry() {
  validateCatalog(PLUGINS, PLUGIN_PACKS);
  if (
    Object.keys(loaders).length !== PLUGINS.length ||
    PLUGINS.some((plugin) => !Object.hasOwn(loaders, plugin.id))
  )
    throw new Error('插件声明与服务入口不一致');
}
/**
 * 入口 / Entry: routeContribution.
 * 功能：在校验插件路由及 socket 贡献并解析归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `{ owner: 'tasks', path: '/api/' + parts[1], methods: parts.length === 4 && parts[3] !== 'result' ? ['POST'] : ['GET'], projec…` 供上层消费（`plugins/registry.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugins/registry.ts`; this entry produces `undefined` / `{ owner: 'tasks', path: '/api/' + parts[1], methods: parts.length === 4 && parts[3] !== 'result' ? ['POST'] : ['GET'], projec…` for its caller. Module context: Validates route/socket contributions and resolves owners using generated plugin loaders.
 * 处理：通过 `path.split().filter`, `path.split`, `inline.includes`, `matchPluginRoutes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `path.split().filter`, `path.split`, `inline.includes`, `matchPluginRoutes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `parts[0] !== 'api'`; `(parts[1] === 'events' && parts.length === 2) || (parts[1] === 'jobs' && (parts.length === 2 || (par…`; `!first`.
 * 输入 / Inputs: path: string
 * 输出 / Returns: (HttpContribution & { owner: string }) | undefined；结果来自 / values from `undefined`; `{ owner: 'tasks', path: '/api/' + parts[1], methods: parts.length === 4 && parts[3] !== 'result' ? ['POST'] : ['GET'], projec…`; `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function routeContribution(path: string): (HttpContribution & { owner: string }) | undefined {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api') return undefined;
  // Task aggregation is a host endpoint; it only sees services of active plugins.
  if ((parts[1] === 'events' && parts.length === 2) ||
      (parts[1] === 'jobs' && (parts.length === 2 || (parts.length === 4 && ['cancel', 'retry', 'result'].includes(parts[3])))))
    return {
      owner: 'tasks',
      path: '/api/' + parts[1],
      methods: parts.length === 4 && parts[3] !== 'result' ? ['POST'] : ['GET'],
      projectScoped: false,
    };
  const matches = matchPluginRoutes(path).map(match => match.entry);
  const first = matches[0];
  if (!first) return;
  return { ...first, methods: matches.filter(route => route.path === first.path).flatMap(route => route.methods) };
}
/**
 * 入口 / Entry: routeOwner.
 * 功能：从当前输入或状态计算 `routeContribution(path)?.owner`，供调用方后续验证或使用。
 * Purpose: Computes `routeContribution(path)?.owner` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `routeContribution(path)?.owner`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const routeOwner = (path: string) => routeContribution(path)?.owner;
/**
 * 入口 / Entry: socketOwner.
 * 功能：从当前输入或状态计算 `PLUGINS.find((plugin) => plugin.contributes.sockets.includes(channel))?.id`，供调用方后续验证或使用。
 * Purpose: Computes `PLUGINS.find((plugin) => plugin.contributes.sockets.includes(channel))?.id` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: channel: 'desktop' | 'terminal-session'
 * 输出 / Returns: `PLUGINS.find((plugin) => plugin.contributes.sockets.includes(channel))?.id`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function socketOwner(channel: 'desktop' | 'terminal-session') {
  return PLUGINS.find((plugin) => plugin.contributes.sockets.includes(channel))?.id;
}
