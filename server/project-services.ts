/**
 * 模块职责：声明项目服务及依赖顺序，生成环境和启动命令并绑定项目服务运行作用域。
 * Module purpose: Declares service dependency order, builds environment/start commands and binds project service run scopes.
 */
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { guestTask } from './guest-task.ts';
import { secretRefsSchema } from './secrets.ts';
import {
  ProjectServiceScopes,
  projectServiceBinding,
  type ProjectServiceRecord,
} from './project-service-scope.ts';

export const environmentSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096))
  .refine((v) => Object.keys(v).length <= 64, '最多 64 个环境变量');
export const serviceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    command: z.string().trim().min(1).max(8192),
    dependsOn: z.array(z.string()).max(12).default([]),
    ready: z.string().max(2048).default(''),
    timeout: z.number().int().min(5).max(300).default(30),
    environment: environmentSchema.optional(),
    secrets: secretRefsSchema.optional(),
    health: z
      .object({
        command: z.string().trim().min(1).max(2048),
        interval: z.number().int().min(5).max(3600).default(30),
        timeout: z.number().int().min(1).max(30).default(5),
        failures: z.number().int().min(1).max(10).default(3),
        restart: z.boolean().default(false),
        maxRestarts: z.number().int().min(0).max(5).default(3),
        backoff: z.number().int().min(5).max(300).default(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ProjectService = z.infer<typeof serviceSchema>;
/**
 * 入口 / Entry: serviceOrder.
 * 功能：在声明项目服务及依赖顺序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `order` / `order.filter((s) => needed.has(s.name))` 供上层消费（`project-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-services.ts`; this entry produces `order` / `order.filter((s) => needed.has(s.name))` for its caller. Module context: Declares service dependency order, builds environment/start commands and binds project service run scopes.
 * 处理：通过 `services.map`, `visit`, `byName.has`, `include` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `services.map`, `visit`, `byName.has`, `include`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!only`.
 * 输入 / Inputs: services: ProjectService[]; only: string optional
 * 输出 / Returns: `order`; `order.filter((s) => needed.has(s.name))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `byName.size !== services.length`; `!byName.has(only)`; 异常 / errors `new AppError('服务名称不能重复')`; `new AppError('服务不存在', 404)`.
 */
export function serviceOrder(services: ProjectService[], only?: string) {
  const byName = new Map(services.map((s) => [s.name, s]));
  if (byName.size !== services.length) throw new AppError('服务名称不能重复');
  const seen = new Set<string>(),
    pending = new Set<string>(),
    order: ProjectService[] = [];
  /**
   * 入口 / Entry: serviceOrder.visit.
   * 功能：在声明项目服务及依赖顺序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`project-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-services.ts`; this entry produces `void` for its caller. Module context: Declares service dependency order, builds environment/start commands and binds project service run scopes.
   * 处理：通过 `seen.has`, `pending.has`, `byName.get`, `pending.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `seen.has`, `pending.has`, `byName.get`, `pending.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `seen.has(name)`.
   * 输入 / Inputs: name: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `pending.add`; `pending.delete`; `seen.add`; `order.push`.
   * 拒绝 / Refusals: 条件 / conditions `pending.has(name)`; `!service`; 异常 / errors `new AppError('服务依赖存在循环')`; `new AppError(`依赖的服务不存在：${name}`)`.
   */
  const visit = (name: string) => {
    if (seen.has(name)) return;
    if (pending.has(name)) throw new AppError('服务依赖存在循环');
    const service = byName.get(name);
    if (!service) throw new AppError(`依赖的服务不存在：${name}`);
    pending.add(name);
    for (const dep of service.dependsOn) visit(dep);
    pending.delete(name);
    seen.add(name);
    order.push(service);
  };
  for (const service of services) visit(service.name);
  if (!only) return order;
  if (!byName.has(only)) throw new AppError('服务不存在', 404);
  const needed = new Set<string>();
  /**
   * 入口 / Entry: serviceOrder.include.
   * 功能：在声明项目服务及依赖顺序中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`project-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-services.ts`; the calls and state transitions below complete the operation. Module context: Declares service dependency order, builds environment/start commands and binds project service run scopes.
   * 处理：通过 `needed.add`, `byName.get`, `include` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `needed.add`, `byName.get`, `include`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `needed.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const include = (name: string) => {
    needed.add(name);
    for (const dep of byName.get(name)!.dependsOn) include(dep);
  };
  include(only);
  return order.filter((s) => needed.has(s.name));
}
/**
 * 入口 / Entry: serviceSession.
 * 功能：从当前输入或状态计算 ``sakura-service-${project?._workspace ? project._workspace + '-' : ''}${name}``，供调用方后续验证或使用。
 * Purpose: Computes ``sakura-service-${project?._workspace ? project._workspace + '-' : ''}${name}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: name: string; project: Project optional
 * 输出 / Returns: ``sakura-service-${project?._workspace ? project._workspace + '-' : ''}${name}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export const serviceSession = (name: string, project?: Project) =>
  `sakura-service-${project?._workspace ? project._workspace + '-' : ''}${name}`;
/**
 * 入口 / Entry: serviceLog.
 * 功能：从当前输入或状态计算 ``/tmp/${serviceSession(name, project)}.log``，供调用方后续验证或使用。
 * Purpose: Computes ``/tmp/${serviceSession(name, project)}.log`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: name: string; project: Project optional
 * 输出 / Returns: ``/tmp/${serviceSession(name, project)}.log``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const serviceLog = (name: string, project?: Project) => `/tmp/${serviceSession(name, project)}.log`;
/**
 * 入口 / Entry: envPrefix.
 * 功能：从当前输入或状态计算 `Object.entries(values) .map(([name, value]) => `export ${name}=${quote(value)}`) .join('\n')`，供调用方后续验证或使用。
 * Purpose: Computes `Object.entries(values) .map(([name, value]) => `export ${name}=${quote(value)}`) .join('\n')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: values: Record<string, string> default={}
 * 输出 / Returns: `Object.entries(values) .map(([name, value]) => `export ${name}=${quote(value)}`) .join('\n')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function envPrefix(values: Record<string, string> = {}) {
  return Object.entries(values)
    .map(([name, value]) => `export ${name}=${quote(value)}`)
    .join('\n');
}
/**
 * 入口 / Entry: prepareProjectScopeTools.
 * 功能：在声明项目服务及依赖顺序中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`project-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-services.ts`; the calls and state transitions below complete the operation. Module context: Declares service dependency order, builds environment/start commands and binds project service run scopes.
 * 处理：通过 `machines.get`, `guestTask().catch`, `guestTask` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.get`, `guestTask().catch`, `guestTask`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal; kind: 'service' | 'main' default='service'
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `dependencies.code !== 0`; 异常 / errors `new AppError('无法准备运行归属工具 python3/tmux；项目代码未执行', 409, prefix + '_SCOPE_UNAVAILABLE')`.
 */
export async function prepareProjectScopeTools(machines: Machines, id: string, signal: AbortSignal,
  kind: 'service' | 'main' = 'service') {
  const prefix = kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE';
  const distro = machines.get(id).distro;
  const dependencies = await guestTask(machines, id,
    `# SAKURA_PROJECT_${kind === 'main' ? 'MAIN' : 'SERVICE'}_DEPENDENCIES\nset -eu\n` +
    `if [ -x /usr/bin/python3 ] && [ -x /usr/bin/tmux ]; then exit 0; fi\n` +
    (distro === 'alpine'
      ? `apk add --no-cache --timeout 30 python3 tmux\n`
      : `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n` +
        `apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends python3 tmux\n`) +
    `test -x /usr/bin/python3 && test -x /usr/bin/tmux`, signal, undefined, 180_000)
    .catch((error) => {
      if ((error as AppError).code === 'GUEST_TASK_SCOPE_UNAVAILABLE')
        throw new AppError((error as Error).message, 409, prefix + '_SCOPE_UNAVAILABLE');
      throw error;
    });
  if (dependencies.code !== 0)
    throw new AppError('无法准备运行归属工具 python3/tmux；项目代码未执行', 409, prefix + '_SCOPE_UNAVAILABLE');
}
/**
 * 入口 / Entry: runServices.
 * 功能：按依赖顺序启动、停止或重启选定项目服务，核验每项完整运行记录。
 * Purpose: Starts/stops/restarts selected project services in dependency order using complete run records.
 * 设计：启动按依赖前向、停止逆序，未知或未确认原运行拒绝覆盖；正文通过账户域运输，管理员控制脚本保持固定。
 * Design: Start follows dependencies and stop reverses them; unknown/pending runs cannot be overwritten and payload transport stays account-scoped.
 * 输入 / Inputs: machines: Machines; id: string; project: Project; action: 'start' | 'stop'; log: (s: string) => void; signal: AbortSignal; only: string optional
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `scopes.stop`; `started.push`; `scopes.persistIntent`; `scopes.start`; `started.reverse`; 更新 / updates `ready`.
 * 拒绝 / Refusals: 条件 / conditions `action === 'stop'`; `only`; `live.status === 'running' || live.status === 'prepared' || live.status === 'exited' || live.status === 'unconfirmed'`; 异常 / errors `new AppError(`请先停止依赖服务 ${dependent.name}`, 409)`; `new AppError(`${service.name} 的上次启动尚未确认，请先停止并重建`, 409, 'SERVICE_SCOPE_CHANGED')`.
 * 失败处理：catch 分支执行 `const failures: string[] = [];`; `for (const record of started.reverse()) { try { await scopes.stop(record, log); } catch (cleanupError) { failures.push(cleanu…`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `const failures: string[] = [];`; `for (const record of started.reverse()) { try { await scopes.stop(record, log); } catch (cleanupError) { failures.push(cleanu…`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function runServices(
  machines: Machines,
  id: string,
  project: Project,
  action: 'start' | 'stop',
  log: (s: string) => void,
  signal: AbortSignal,
  only?: string,
) {
  const services = project.services || [];
  const order = serviceOrder(services, only);
  if (action === 'start' && order.length) await prepareProjectScopeTools(machines, id, signal);
  const scopes = new ProjectServiceScopes(machines, id, project);
  const { ProjectRunScopes, projectIdentityTask } = await import('./project-run-scope.ts');
  const identities = new ProjectRunScopes(machines);
  if (action === 'stop') {
    if (only) {
      const dependents = services.filter(
        (s) => s.name !== only && serviceOrder(services, s.name).some((d) => d.name === only),
      );
      for (const dependent of dependents) {
        const live = await scopes.status(dependent.name, signal);
        if (live.status === 'running' || live.status === 'prepared' || live.status === 'exited' || live.status === 'unconfirmed')
          throw new AppError(`请先停止依赖服务 ${dependent.name}`, 409);
      }
    }
    for (const service of [...order].reverse().filter((s) => !only || s.name === only)) {
      signal.throwIfAborted();
      const state = await scopes.status(service.name, signal);
      const record = state.record || (await scopes.hasReceipt(service.name) ? await scopes.metadata(service.name) : null);
      if (record) await scopes.stop(record, log);
      log(`已停止 ${service.name}\n`);
    }
    return;
  }
  const started: ProjectServiceRecord[] = [];
  try {
    for (const service of order) {
      signal.throwIfAborted();
      const live = await scopes.status(service.name, signal);
      if (live.status === 'prepared' || live.status === 'unconfirmed')
        throw new AppError(`${service.name} 的上次启动尚未确认，请先停止并重建`, 409, 'SERVICE_SCOPE_CHANGED');
      if (live.status === 'exited')
        throw new AppError(`${service.name} 主 pane 已退出，请先停止清理仍归属此服务的进程`, 409, 'SERVICE_SCOPE_CHANGED');
      if (live.status === 'running') {
        if (!live.record || !await identities.hasRun(id, live.record.projectId, live.record.runId))
          throw new AppError(`旧服务 ${service.name} 尚未接入项目账号，请先确认停止全部后代再重新启动`,
            409, 'SERVICE_IDENTITY_REQUIRED');
        if (!await identities.active(id, live.record.projectId, live.record.runId, signal))
          throw new AppError(`${service.name} 的账号启动回执尚未确认，请先停止并核对`, 409, 'SERVICE_SCOPE_CHANGED');
        if (live.record.binding !== projectServiceBinding(project, service))
          throw new AppError(`${service.name} 启动配置已改变，请先停止并重建`, 409, 'SERVICE_SCOPE_CHANGED');
      }
      if (live.status !== 'running') {
        log(`启动 ${service.name}…\n`);
        const intent = scopes.intent(service, live.bootId);
        started.push(intent);
        await scopes.persistIntent(intent);
        const payload = await identities.inherited(id, project,
          { command: service.command, environment: { ...project.environment, ...service.environment } },
          { kind: 'service', runId: intent.runId, bootId: intent.bootId }, signal);
        await scopes.start(intent, payload, signal);
      }
      const deadline = Date.now() + service.timeout * 1000;
      const identityDeadline = Math.min(deadline, Date.now() + 10000);
      let ready = false;
      do {
        await delay(300, undefined, { signal });
        const alive = await scopes.status(service.name, signal);
        if (alive.status !== 'running') throw new AppError(`${service.name} 已退出，请查看服务日志`);
        if (!alive.record || !await identities.active(id, alive.record.projectId, alive.record.runId, signal)) {
          if (Date.now() >= identityDeadline)
            throw new AppError(`${service.name} 的账号启动回执未确认，请检查日志`, 409, 'SERVICE_SCOPE_CHANGED');
          continue;
        }
        if (!service.ready.trim()) {
          ready = true;
          break;
        }
        const check = await projectIdentityTask(
          machines,
          id,
          project,
          { command: service.ready, environment: { ...project.environment, ...service.environment } },
          signal,
          undefined,
          Math.min(5000, Math.max(1000, deadline - Date.now())),
        ).catch((error) => {
          signal.throwIfAborted();
          if ((error as AppError).status === 408) return { code: 1 };
          throw error;
        });
        ready = check.code === 0;
      } while (!ready && Date.now() < deadline);
      if (!ready) throw new AppError(`${service.name} 就绪检查超时`);
      log(`${service.name} 已就绪\n`);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const record of started.reverse()) {
      try { await scopes.stop(record, log); }
      catch (cleanupError) { failures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)); }
    }
    if (failures.length)
      throw new AppError(`项目服务启动失败：${error instanceof Error ? error.message : String(error)}；` +
        `回滚清理未确认：${failures.join('；')}`, 503, 'SERVICE_CLEANUP_FAILED');
    throw error;
  }
}
