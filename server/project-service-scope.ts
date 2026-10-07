/**
 * 模块职责：定义项目常驻服务票据和控制器；启动意图先持久化，停止核对原完整运行域。
 * Module purpose: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import type { ProjectService } from './project-services.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { quote } from './shell.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';

const decimal = z.string().regex(/^[1-9][0-9]*$/);
/**
 * 入口 / Entry: callback@34.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: record; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const projectServiceRecordSchema = z.object({
  version: z.literal(1),
  projectId: projectIdSchema,
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  session: z.string().regex(/^sakura-service-[a-z0-9-]+$/),
  runId: z.uuid(),
  bootId: z.uuid(),
  scopeName: z.string().regex(/^sakura-service-[a-f0-9-]{36}$/),
  inode: decimal.nullable(),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'prepared', 'running', 'stopped']),
  sessionId: z.string().regex(/^\$[0-9]+$/).nullable(),
  paneId: z.string().regex(/^%[0-9]+$/).nullable(),
  panePid: z.number().int().min(2).nullable(),
  paneStartTicks: decimal.nullable(),
}).strict().superRefine((record, ctx) => {
  const expected = `sakura-service-${record.projectId === 'default' ? '' : record.projectId + '-'}${record.name}`;
  if (record.scopeName !== 'sakura-service-' + record.runId || record.session !== expected)
    ctx.addIssue({ code: 'custom', message: '服务运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null))
    ctx.addIssue({ code: 'custom', message: '服务 pane 归属记录不完整' });
  if ((record.phase === 'prepared' || record.phase === 'running') && record.inode === null)
    ctx.addIssue({ code: 'custom', message: '服务 cgroup 归属记录不完整' });
  if (record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '服务尚未登记 pane 身份' });
});
export type ProjectServiceRecord = z.infer<typeof projectServiceRecordSchema>;
/**
 * 入口 / Entry: callback@55.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: record; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const projectMainRecordSchema = z.object({
  version: z.literal(2), kind: z.literal('main'), projectId: projectIdSchema,
  session: z.string().regex(/^sakura-project(?:-[a-f0-9]{16})?$/),
  runId: z.uuid(), bootId: z.uuid(), scopeName: z.string().regex(/^sakura-main-[a-f0-9-]{36}$/),
  inode: decimal.nullable(), binding: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'prepared', 'running', 'stopped']),
  sessionId: z.string().regex(/^\$[0-9]+$/).nullable(), paneId: z.string().regex(/^%[0-9]+$/).nullable(),
  panePid: z.number().int().min(2).nullable(), paneStartTicks: decimal.nullable(),
}).strict().superRefine((record, ctx) => {
  const session = record.projectId === 'default' ? 'sakura-project' : `sakura-project-${record.projectId}`;
  if (record.session !== session || record.scopeName !== 'sakura-main-' + record.runId)
    ctx.addIssue({ code: 'custom', message: '项目主命令路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null))
    ctx.addIssue({ code: 'custom', message: '项目主命令 pane 归属记录不完整' });
  if ((record.phase === 'prepared' || record.phase === 'running') && record.inode === null)
    ctx.addIssue({ code: 'custom', message: '项目主命令 cgroup 归属记录不完整' });
  if (record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '项目主命令尚未登记 pane 身份' });
});
export type ProjectMainRecord = z.infer<typeof projectMainRecordSchema>;
type ProjectScopeRecord = ProjectServiceRecord | ProjectMainRecord;
type ScopeTarget = { kind: 'service'; name: string; namespace?: 'browser-ide' | 'notebook' | 'reverse-tunnel' | 'desktop' | 'mesh'; deadline?: number } | { kind: 'main' };
export const projectBrowserIdeRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('browser-ide'), session: z.string().regex(/^sakura-browser-ide-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  if (record.session !== 'sakura-browser-ide-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId)
    ctx.addIssue({ code: 'custom', message: '浏览器 IDE 运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '浏览器 IDE 的完整 cgroup/pane 身份缺失' });
});
export type ProjectBrowserIdeRecord = z.infer<typeof projectBrowserIdeRecordSchema>;
/**
 * 入口 / Entry: projectBrowserIdeScopePaths.
 * 功能：从当前输入或状态计算 `{ namespace: 'browser-ide' as const, projectId, name: 'browser-ide', session: 'sakura-browser-ide-' + projectId, guest: '/run…`，供调用方后续验证或使用。
 * Purpose: Computes `{ namespace: 'browser-ide' as const, projectId, name: 'browser-ide', session: 'sakura-browser-ide-' + projectId, guest: '/run…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `{ namespace: 'browser-ide' as const, projectId, name: 'browser-ide', session: 'sakura-browser-ide-' + projectId, guest: '/run…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectBrowserIdeScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'browser-ide' as const, projectId, name: 'browser-ide',
    session: 'sakura-browser-ide-' + projectId, guest: '/run/sakura-browser-ide/' + projectId };
}
export const projectNotebookRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('notebook'), session: z.string().regex(/^sakura-notebook-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  if (record.session !== 'sakura-notebook-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId)
    ctx.addIssue({ code: 'custom', message: 'Notebook 运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: 'Notebook 的完整 cgroup/pane 身份缺失' });
});
export type ProjectNotebookRecord = z.infer<typeof projectNotebookRecordSchema>;
export const projectReverseTunnelRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('reverse-tunnel'), session: z.string().regex(/^sakura-reverse-tunnel-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  if (record.session !== 'sakura-reverse-tunnel-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId)
    ctx.addIssue({ code: 'custom', message: '临时隧道运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '临时隧道的完整 cgroup/pane 身份缺失' });
});
export type ProjectReverseTunnelRecord = z.infer<typeof projectReverseTunnelRecordSchema>;
export const projectMeshRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('mesh'), session: z.string().regex(/^sakura-mesh-uid-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  if (record.session !== 'sakura-mesh-uid-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId)
    ctx.addIssue({ code: 'custom', message: '服务网格运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '服务网格完整 cgroup/pane 身份缺失' });
});
export type ProjectMeshRecord = z.infer<typeof projectMeshRecordSchema>;
/**
 * 入口 / Entry: projectMeshScopePaths.
 * 功能：从当前输入或状态计算 `{ namespace: 'mesh' as const, projectId, name: 'mesh', session: 'sakura-mesh-uid-' + projectId, guest: '/run/sakura-project-m…`，供调用方后续验证或使用。
 * Purpose: Computes `{ namespace: 'mesh' as const, projectId, name: 'mesh', session: 'sakura-mesh-uid-' + projectId, guest: '/run/sakura-project-m…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `{ namespace: 'mesh' as const, projectId, name: 'mesh', session: 'sakura-mesh-uid-' + projectId, guest: '/run/sakura-project-m…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectMeshScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'mesh' as const, projectId, name: 'mesh',
    session: 'sakura-mesh-uid-' + projectId, guest: '/run/sakura-project-mesh/' + projectId };
}
/**
 * 入口 / Entry: projectReverseTunnelScopePaths.
 * 功能：从当前输入或状态计算 `{ namespace: 'reverse-tunnel' as const, projectId, name: 'reverse-tunnel', session: 'sakura-reverse-tunnel-' + projectId, gue…`，供调用方后续验证或使用。
 * Purpose: Computes `{ namespace: 'reverse-tunnel' as const, projectId, name: 'reverse-tunnel', session: 'sakura-reverse-tunnel-' + projectId, gue…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `{ namespace: 'reverse-tunnel' as const, projectId, name: 'reverse-tunnel', session: 'sakura-reverse-tunnel-' + projectId, gue…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectReverseTunnelScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'reverse-tunnel' as const, projectId, name: 'reverse-tunnel',
    session: 'sakura-reverse-tunnel-' + projectId, guest: '/run/sakura-reverse-tunnels/' + projectId };
}
/**
 * 入口 / Entry: projectNotebookScopePaths.
 * 功能：从当前输入或状态计算 `{ namespace: 'notebook' as const, projectId, name: 'notebook', session: 'sakura-notebook-' + projectId, guest: '/run/sakura-n…`，供调用方后续验证或使用。
 * Purpose: Computes `{ namespace: 'notebook' as const, projectId, name: 'notebook', session: 'sakura-notebook-' + projectId, guest: '/run/sakura-n…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `{ namespace: 'notebook' as const, projectId, name: 'notebook', session: 'sakura-notebook-' + projectId, guest: '/run/sakura-n…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectNotebookScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'notebook' as const, projectId, name: 'notebook',
    session: 'sakura-notebook-' + projectId, guest: '/run/sakura-notebook/' + projectId };
}
export const projectDesktopRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('desktop'), session: z.string().regex(/^sakura-desktop-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (record.session !== 'sakura-desktop-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId ||
      panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: 'Desktop 的完整 cgroup/pane 身份缺失' });
});
export type ProjectDesktopRecord = z.infer<typeof projectDesktopRecordSchema>;
/**
 * 入口 / Entry: projectDesktopScopePaths.
 * 功能：从当前输入或状态计算 `{ namespace: 'desktop' as const, projectId, name: 'desktop', session: 'sakura-desktop-' + projectId, guest: '/run/sakura-proj…`，供调用方后续验证或使用。
 * Purpose: Computes `{ namespace: 'desktop' as const, projectId, name: 'desktop', session: 'sakura-desktop-' + projectId, guest: '/run/sakura-proj…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `{ namespace: 'desktop' as const, projectId, name: 'desktop', session: 'sakura-desktop-' + projectId, guest: '/run/sakura-proj…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectDesktopScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'desktop' as const, projectId, name: 'desktop',
    session: 'sakura-desktop-' + projectId, guest: '/run/sakura-project-desktop/' + projectId };
}
export type ProjectScopeInput = { runId: string; command: string; input: Buffer; sha256: string };
const transportSchema = z.object({ version: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(128 * 1024),
});
/**
 * 入口 / Entry: responseSchema.
 * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z.object({ status: z.enum(['absent', 'prepared', 'running', 'exited', 'stopped', 'unconfirmed', 'unmanaged']), bootId: z.uuid…` 供上层消费（`project-service-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-service-scope.ts`; this entry produces `z.object({ status: z.enum(['absent', 'prepared', 'running', 'exited', 'stopped', 'unconfirmed', 'unmanaged']), bootId: z.uuid…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 * 处理：通过 `z.object().strict().superRefine`, `z.object().strict`, `z.object`, `z.enum` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.object().strict().superRefine`, `z.object().strict`, `z.object`, `z.enum`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: schema: z.ZodType<Record>
 * 输出 / Returns: `z.object({ status: z.enum(['absent', 'prepared', 'running', 'exited', 'stopped', 'unconfirmed', 'unmanaged']), bootId: z.uuid…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const responseSchema = <Record extends ProjectScopeRecord>(schema: z.ZodType<Record>) => z.object({
  status: z.enum(['absent', 'prepared', 'running', 'exited', 'stopped', 'unconfirmed', 'unmanaged']),
  bootId: z.uuid(),
  record: schema.nullable(),
}).strict().superRefine((response, ctx) => {
  if (['prepared', 'running', 'exited', 'stopped', 'unconfirmed'].includes(response.status) && !response.record)
    ctx.addIssue({ code: 'custom', message: '服务状态缺少可验证归属记录' });
});
export type ProjectScopeStatus<Record extends ProjectScopeRecord> = {
  status: 'absent' | 'prepared' | 'running' | 'exited' | 'stopped' | 'unconfirmed' | 'unmanaged';
  bootId: string; record: Record | null;
};
export type ProjectServiceStatus = ProjectScopeStatus<ProjectServiceRecord>;
type Operation = 'status' | 'prepare' | 'start' | 'commit' | 'stop';
/**
 * 入口 / Entry: projectServiceScopePaths.
 * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ projectId, name, session: `sakura-service-${projectId === 'default' ? '' : projectId + '-'}${name}`, guest: `/run/sakura-pr…` 供上层消费（`project-service-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-service-scope.ts`; this entry produces `{ projectId, name, session: `sakura-service-${projectId === 'default' ? '' : projectId + '-'}${name}`, guest: `/run/sakura-pr…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 * 处理：通过 `projectIdSchema.parse`, `z.string().regex().parse`, `z.string().regex`, `z.string` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.string().regex().parse`, `z.string().regex`, `z.string`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; name: string
 * 输出 / Returns: `{ projectId, name, session: `sakura-service-${projectId === 'default' ? '' : projectId + '-'}${name}`, guest: `/run/sakura-pr…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectServiceScopePaths(project: Project, name: string) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).parse(name);
  return { projectId, name,
    session: `sakura-service-${projectId === 'default' ? '' : projectId + '-'}${name}`,
    guest: `/run/sakura-project-services/${projectId}/${name}`,
  };
}
/**
 * 入口 / Entry: projectMainScopePaths.
 * 功能：从当前输入或状态计算 `{ kind: 'main' as const, projectId, session: projectId === 'default' ? 'sakura-project' : `sakura-project-${projectId}`, gues…`，供调用方后续验证或使用。
 * Purpose: Computes `{ kind: 'main' as const, projectId, session: projectId === 'default' ? 'sakura-project' : `sakura-project-${projectId}`, gues…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `{ kind: 'main' as const, projectId, session: projectId === 'default' ? 'sakura-project' : `sakura-project-${projectId}`, gues…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectMainScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { kind: 'main' as const, projectId,
    session: projectId === 'default' ? 'sakura-project' : `sakura-project-${projectId}`,
    guest: `/run/sakura-project-main/${projectId}` };
}
/**
 * 入口 / Entry: scopePaths.
 * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `target.kind === 'main' ? projectMainScopePaths(project) : target.namespace === 'browser-ide' ? projectBrowserIdeScopePaths(pr…` 供上层消费（`project-service-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-service-scope.ts`; this entry produces `target.kind === 'main' ? projectMainScopePaths(project) : target.namespace === 'browser-ide' ? projectBrowserIdeScopePaths(pr…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 * 处理：通过 `projectMainScopePaths`, `projectBrowserIdeScopePaths`, `projectNotebookScopePaths`, `projectReverseTunnelScopePaths` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectMainScopePaths`, `projectBrowserIdeScopePaths`, `projectNotebookScopePaths`, `projectReverseTunnelScopePaths`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; target: ScopeTarget
 * 输出 / Returns: `target.kind === 'main' ? projectMainScopePaths(project) : target.namespace === 'browser-ide' ? projectBrowserIdeScopePaths(pr…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const scopePaths = (project: Project, target: ScopeTarget) => target.kind === 'main'
  ? projectMainScopePaths(project) : target.namespace === 'browser-ide'
    ? projectBrowserIdeScopePaths(project) : target.namespace === 'notebook'
      ? projectNotebookScopePaths(project) : target.namespace === 'reverse-tunnel'
        ? projectReverseTunnelScopePaths(project) : target.namespace === 'mesh'
          ? projectMeshScopePaths(project) : target.namespace === 'desktop'
            ? projectDesktopScopePaths(project) : projectServiceScopePaths(project, target.name);
/**
 * 入口 / Entry: projectMainBinding.
 * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(['main-uid-v3', project._workspace || 'default', project.directory, project.networ…` 供上层消费（`project-service-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-service-scope.ts`; this entry produces `createHash('sha256').update(JSON.stringify(['main-uid-v3', project._workspace || 'default', project.directory, project.networ…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(['main-uid-v3', project._workspace || 'default', project.directory, project.networ…`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectMainBinding(project: Project) {
  return createHash('sha256').update(JSON.stringify(['main-uid-v3',
    project._workspace || 'default', project.directory, project.networkIsolation || 'host',
    project.command, project.environment || {}, project.secrets || {}, project.runtimes || {},
    Boolean(project.services?.length),
  ])).digest('hex');
}
/**
 * 入口 / Entry: projectServiceBinding.
 * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(['service-uid-v2', project._workspace || 'default', project.directory, project.net…` 供上层消费（`project-service-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-service-scope.ts`; this entry produces `createHash('sha256').update(JSON.stringify(['service-uid-v2', project._workspace || 'default', project.directory, project.net…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; service: ProjectService
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(['service-uid-v2', project._workspace || 'default', project.directory, project.net…`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectServiceBinding(project: Project, service: ProjectService) {
  return createHash('sha256').update(JSON.stringify(['service-uid-v2',
    project._workspace || 'default', project.directory, project.networkIsolation || 'host',
    project.environment || {}, service.name, service.command, service.environment || {},
  ])).digest('hex');
}

// The helper and the pane launcher run with isolated Python before any project
// environment or command. A persistent service deliberately has no task timeout.
const helper = `import fcntl,hashlib,json,os,re,signal,stat,subprocess,sys,tempfile,time
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
folder=request['guest']; owner_file=folder+'/owner.json'; cancel_file=folder+'/cancel'
main=request.get('kind')=='main'
root='/run/sakura-project-main' if main else '/run/sakura-browser-ide' if request.get('namespace')=='browser-ide' else '/run/sakura-notebook' if request.get('namespace')=='notebook' else '/run/sakura-reverse-tunnels' if request.get('namespace')=='reverse-tunnel' else '/run/sakura-project-mesh' if request.get('namespace')=='mesh' else '/run/sakura-project-desktop' if request.get('namespace')=='desktop' else '/run/sakura-project-services'
readonly=request.get('namespace')=='desktop' and request['op']=='status'
scope_prefix='sakura-main-' if main else 'sakura-service-'
def refuse(message): raise RuntimeError(message)
def trusted_directory(path):
 if not readonly:
  try: os.mkdir(path,0o700)
  except FileExistsError: pass
 info=os.lstat(path)
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属目录权限无法核对')
try:
 for path in [root,folder.rsplit('/',1)[0],folder]: trusted_directory(path)
 lock=os.open(folder+'/lock',(os.O_RDONLY if readonly else os.O_CREAT|os.O_RDWR)|os.O_NOFOLLOW,0o600)
except FileNotFoundError:
 if not readonly: raise
 result=subprocess.run(['/usr/bin/tmux','has-session','-t','='+request['session']],capture_output=True,text=True)
 if result.returncode==0: raise RuntimeError('Desktop 同名 pane 缺少完整归属，拒绝接管')
 if not any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']): raise RuntimeError('Desktop 同名 pane 状态无法核对')
 print(json.dumps({'status':'absent','bootId':boot,'record':None})); sys.exit(0)
info=os.fstat(lock)
if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属锁权限无法核对')
def read_owner():
 try:
  descriptor=os.open(owner_file,os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError: return None
 with os.fdopen(descriptor) as stream:
  info=os.fstat(stream.fileno())
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属文件权限无法核对')
  record=json.load(stream)
 fields={'version','projectId','session','runId','bootId','scopeName','inode','binding','phase','sessionId','paneId','panePid','paneStartTicks','kind' if main else 'name'}
 if not isinstance(record,dict) or set(record)!=fields or record['version']!=(2 if main else 1): refuse('服务归属记录不完整')
 if record['projectId']!=request['projectId'] or record['session']!=request['session']: refuse('服务归属项目不符')
 if (main and record['kind']!='main') or (not main and record['name']!=request['name']): refuse('服务归属类型不符')
 if not isinstance(record['runId'],str) or not re.fullmatch('[a-f0-9-]{36}',record['runId']) or record['scopeName']!=scope_prefix+record['runId']: refuse('服务 cgroup 路径无法核对')
 if record['phase'] not in ['prepared','running','stopped']: refuse('服务归属阶段不符')
 if record['inode'] is not None and (not isinstance(record['inode'],str) or not re.fullmatch('[1-9][0-9]*',record['inode'])): refuse('服务 cgroup inode 无法核对')
 return record
def write_owner(record):
 descriptor,temporary=tempfile.mkstemp(dir=folder,prefix='.owner-')
 try:
  with os.fdopen(descriptor,'w') as stream: json.dump(record,stream); stream.flush(); os.fsync(stream.fileno())
  os.replace(temporary,owner_file)
  directory=os.open(folder,os.O_DIRECTORY); os.fsync(directory); os.close(directory)
 finally:
  if os.path.exists(temporary): os.unlink(temporary)
def cancelled(record):
 try:
  descriptor=os.open(cancel_file,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(descriptor) as stream: return stream.read().strip()==record['runId']
 except FileNotFoundError: return False
def cancel(record):
 descriptor=os.open(cancel_file,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
 with os.fdopen(descriptor,'w') as stream: stream.write(record['runId']); stream.flush(); os.fsync(stream.fileno())
def tmux_panes():
 present=subprocess.run(['/usr/bin/tmux','has-session','-t','='+request['session']],capture_output=True,text=True)
 if present.returncode:
  if any(text in present.stderr for text in ["can't find session",'no server running','No such file or directory']): return []
  refuse('无法核对 tmux 会话：'+present.stderr.strip())
 result=subprocess.run(['/usr/bin/tmux','list-panes','-s','-t','='+request['session']+':','-F','#{session_id} #{pane_id} #{pane_pid} #{pane_dead}'],capture_output=True,text=True)
 if result.returncode:
  if any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']): return []
  refuse('无法核对 tmux 会话：'+result.stderr.strip())
 return [line.split() for line in result.stdout.splitlines() if line.strip()]
def proc_fields(pid):
 try: return open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()
 except (FileNotFoundError,ProcessLookupError): return None
def pane_identity(record,panes):
 if not panes: return
 if record['panePid'] is None or len(panes)!=1: refuse('tmux pane 归属未知，拒绝终止未核对会话')
 row=panes[0]
 if len(row)!=4 or row[:3]!=[record['sessionId'],record['paneId'],str(record['panePid'])]: refuse('tmux session/pane 身份已改变，拒绝旧服务停止')
 fields=proc_fields(record['panePid'])
 if fields is not None and fields[19]!=record['paneStartTicks']: refuse('服务 pane PID 已复用，拒绝旧服务停止')
 if fields is None and row[3]!='1': refuse('服务 pane 进程身份无法核对')
def scope_path(record): return '/sys/fs/cgroup/'+record['scopeName']
def scope_descriptor(record):
 try: descriptor=os.open(scope_path(record),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 except FileNotFoundError: return None
 if record['inode'] is None or str(os.fstat(descriptor).st_ino)!=record['inode']:
  os.close(descriptor); refuse('服务 cgroup inode 已改变，拒绝旧服务停止')
 return descriptor
def populated(descriptor):
 with open('/proc/self/fd/'+str(descriptor)+'/cgroup.events') as stream:
  events=dict(line.split() for line in stream.read().splitlines())
 if events.get('populated') not in ['0','1']: refuse('服务 cgroup 空状态无法核对')
 return events['populated']=='1'

def input_file(record): return folder+'/input-'+record['runId']+'.bin'
def input_header(record,descriptor):
 info=os.fstat(descriptor)
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077 or info.st_nlink!=1: refuse('服务受保护正文权限无法核对')
 header=b''
 while not header.endswith(b'\\n') and len(header)<4096:
  part=os.read(descriptor,1)
  if not part: refuse('服务受保护正文归属不完整')
  header+=part
 value=json.loads(header)
 fields={'version','bootId','runId','scopeName','inode','binding','fileDevice','fileInode','sha256','bytes'}
 if not isinstance(value,dict) or set(value)!=fields or value['version']!=1: refuse('服务受保护正文归属不完整')
 for key in ['bootId','runId','scopeName','inode','binding']:
  if value[key]!=record[key]: refuse('服务受保护正文属于其他运行')
 if value['fileDevice']!=str(info.st_dev) or value['fileInode']!=str(info.st_ino): refuse('服务受保护正文文件已被替换')
 expected=request.get('transport')
 if not isinstance(expected,dict) or set(expected)!={'version','sha256','bytes'} or expected['version']!=1 or value['sha256']!=expected['sha256'] or value['bytes']!=expected['bytes']: refuse('服务受保护正文与主机摘要不符')
 return value

def stage_input(record):
 expected=request['transport']
 if not isinstance(expected['bytes'],int) or expected['bytes']<1 or expected['bytes']>131072 or not re.fullmatch('[a-f0-9]{64}',expected['sha256']): refuse('服务受保护正文预算或摘要不符')
 data=sys.stdin.buffer.read(expected['bytes']+1)
 if len(data)!=expected['bytes'] or hashlib.sha256(data).hexdigest()!=expected['sha256']: refuse('服务受保护正文运输未确认；项目代码未执行')
 info=os.lstat(folder)
 if info.st_mode&0o077: refuse('服务正文目录需要 root 0700；项目代码未执行')
 descriptor=os.open(input_file(record),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  info=os.fstat(descriptor)
  header={key:record[key] for key in ['bootId','runId','scopeName','inode','binding']}
  header.update(version=1,fileDevice=str(info.st_dev),fileInode=str(info.st_ino),sha256=expected['sha256'],bytes=len(data))
  with os.fdopen(descriptor,'wb',closefd=False) as stream:
   stream.write(json.dumps(header,separators=(',',':')).encode()+b'\\n'); stream.write(data); stream.flush(); os.fsync(descriptor)
 finally: os.close(descriptor)
 directory=os.open(folder,os.O_DIRECTORY)
 try: os.fsync(directory)
 finally: os.close(directory)

def consume_input(record):
 descriptor=os.open(input_file(record),os.O_RDONLY|os.O_NOFOLLOW)
 try:
  header=input_header(record,descriptor)
  with os.fdopen(descriptor,'rb',closefd=False) as stream: data=stream.read(header['bytes']+1)
  if len(data)!=header['bytes'] or hashlib.sha256(data).hexdigest()!=header['sha256']: refuse('服务受保护正文长度或摘要已改变；项目代码未执行')
  return data
 finally: os.close(descriptor)

def clean_input(record):
 try: descriptor=os.open(input_file(record),os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError: return
 try:
  input_header(record,descriptor)
  actual=os.lstat(input_file(record)); pinned=os.fstat(descriptor)
  if actual.st_dev!=pinned.st_dev or actual.st_ino!=pinned.st_ino: refuse('服务受保护正文在清理前已被替换')
  os.unlink(input_file(record))
 finally: os.close(descriptor)
def expect_owner(record):
 expected=request['record']
 if expected['bootId']!=boot or record['bootId']!=boot: refuse('客户机 boot 身份已改变，拒绝旧服务操作')
 for key in ['runId','scopeName','binding']:
  if record[key]!=expected[key]: refuse('服务 run 身份已改变，拒绝旧服务操作')
 if expected['inode'] is not None and record['inode']!=expected['inode']: refuse('服务 cgroup inode 记录已改变')
 if expected['panePid'] is not None:
  for key in ['sessionId','paneId','panePid','paneStartTicks']:
   if record[key]!=expected[key]: refuse('服务 pane 记录已改变')
def capabilities():
 unified=False
 for line in open('/proc/self/mountinfo'):
  fields=line.split()
  if len(fields)>9 and fields[4]=='/sys/fs/cgroup' and fields[fields.index('-')+1]=='cgroup2': unified=True
 if not unified and os.path.isfile('/sbin/rc-service'):
  subprocess.run(['/sbin/rc-service','cgroups','start'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for line in open('/proc/self/mountinfo'):
   fields=line.split()
   if fields[4]=='/sys/fs/cgroup' and fields[fields.index('-')+1]=='cgroup2': unified=True
 if not unified or os.path.islink('/sys/fs/cgroup'): refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 服务需要可写 cgroup v2；项目代码未执行')
 if not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'): refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 服务需要 Linux pidfd；项目代码未执行')
 descriptor=os.pidfd_open(os.getpid()); os.close(descriptor)
def result(status,record=None): print(json.dumps({'status':status,'bootId':boot,'record':record}))
def status():
 fcntl.flock(lock,fcntl.LOCK_SH if readonly else fcntl.LOCK_EX)
 record=read_owner(); panes=tmux_panes()
 if record is None: result('unmanaged' if panes else 'absent'); return
 if record['bootId']!=boot: refuse('服务归属 boot 身份已改变')
 pane_identity(record,panes)
 descriptor=scope_descriptor(record)
 if record['phase']=='stopped':
  if descriptor is not None or panes: refuse('已停止服务的 scope 或 pane 被替换')
  result('stopped',record); return
 if descriptor is None:
  if panes: refuse('服务 cgroup 归属已缺失，但 pane 仍存在')
  result('exited',record); return
 try:
  busy=populated(descriptor)
  if record['phase']=='running':
   fields=proc_fields(record['panePid'])
   if not panes or fields is None or fields[0] in ['Z','X'] or not busy:
    result('exited',record); return
   if '0::/'+record['scopeName'] not in open('/proc/'+str(record['panePid'])+'/cgroup').read().splitlines(): refuse('服务 pane 已离开所属 cgroup')
  result(record['phase'],record)
 finally: os.close(descriptor)
def prepare():
 fcntl.flock(lock,fcntl.LOCK_EX)
 expected=request['record']
 if expected['bootId']!=boot: refuse('客户机 boot 身份已改变；服务未创建')
 if cancelled(expected): refuse('服务启动已取消；项目代码未执行')
 record=read_owner()
 if tmux_panes(): refuse('tmux 会话已有运行或未知归属，拒绝替换')
 if record is not None and record['phase']!='stopped': refuse('已有服务归属尚未停止')
 if record is not None and os.path.lexists(scope_path(record)): refuse('已停止服务的旧 cgroup 被替换，拒绝覆盖归属')
 capabilities()
 path=scope_path(expected)
 try: os.mkdir(path)
 except OSError as error: refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 无法创建服务 cgroup；项目代码未执行：'+str(error))
 record=dict(expected,phase='prepared',inode=str(os.stat(path).st_ino))
 write_owner(record)
 if not os.access(path+'/cgroup.kill',os.W_OK): refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 客户机缺少可写 cgroup.kill；项目代码未执行')
 result('prepared',record)
def launch():
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner()
 if record is None: refuse('服务 prepared 归属缺失')
 expect_owner(record)
 if record['phase']!='prepared' or cancelled(record): refuse('服务启动已取消或提交')
 descriptor=scope_descriptor(record)
 if descriptor is None: refuse('服务 prepared cgroup 已缺失')
 os.close(descriptor)
 if tmux_panes(): refuse('tmux 会话已被占用，拒绝替换')
 stage_input(record)
 pane_script=request['paneScript']
 pane_file=folder+'/pane-'+record['runId']+'.py'
 script_file=os.open(pane_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(script_file,'w') as stream: stream.write(pane_script); stream.flush(); os.fsync(stream.fileno())
 created=subprocess.run(['/usr/bin/tmux','new-session','-d','-s',request['session'],'-c','/','-P','-F','#{session_id} #{pane_id} #{pane_pid}', '/usr/bin/env','-i','PATH=/usr/sbin:/usr/bin:/sbin:/bin','HOME=/root','LANG=C','LC_ALL=C','/usr/bin/python3','-I','-S',pane_file],capture_output=True,text=True)
 if created.returncode: refuse('无法创建服务 pane：'+created.stderr.strip())
 row=created.stdout.strip().split()
 if len(row)!=3 or not re.fullmatch(r'\\$[0-9]+',row[0]) or not re.fullmatch('%[0-9]+',row[1]) or not row[2].isdigit(): refuse('新建服务 pane 身份无法核对')
 fields=proc_fields(int(row[2]))
 if fields is None: refuse('新建服务 pane 已退出')
 record.update(sessionId=row[0],paneId=row[1],panePid=int(row[2]),paneStartTicks=fields[19])
 write_owner(record)
 options=subprocess.run(['/usr/bin/tmux','set-window-option','-t',record['paneId'],'remain-on-exit','off'],capture_output=True,text=True)
 if options.returncode: refuse('无法确认服务 pane 退出策略：'+options.stderr.strip())
 fcntl.flock(lock,fcntl.LOCK_UN)
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  fcntl.flock(lock,fcntl.LOCK_EX)
  current=read_owner(); expect_owner(current)
  if cancelled(current): refuse('服务启动已取消')
  pane_identity(current,tmux_panes())
  try: groups=open('/proc/'+str(current['panePid'])+'/cgroup').read().splitlines()
  except FileNotFoundError: refuse('服务 pane 在提交前退出')
  if '0::/'+current['scopeName'] in groups: result('prepared',current); return
  fcntl.flock(lock,fcntl.LOCK_UN); time.sleep(0.05)
 refuse('服务 pane 未进入已登记 cgroup；项目代码未执行')
def commit():
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner(); expect_owner(record)
 if cancelled(record) or record['phase']!='prepared': refuse('服务启动已取消或已提交')
 pane_identity(record,tmux_panes())
 descriptor=scope_descriptor(record)
 if descriptor is None: refuse('服务 cgroup 已缺失')
 os.close(descriptor)
 if '0::/'+record['scopeName'] not in open('/proc/'+str(record['panePid'])+'/cgroup').read().splitlines(): refuse('服务 pane 未进入 cgroup；拒绝执行项目代码')
 record['phase']='running'; write_owner(record)
 if request.get('namespace') in ('browser-ide','reverse-tunnel'):
  deadline=request.get('deadline')
  if not isinstance(deadline,int) or not time.time()<deadline<=time.time()+14400: refuse('限时服务时限不符')
  path=folder+'/watchdog-'+record['runId']+'.py'
  descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(descriptor,'w') as stream: stream.write(request['watchdogScript']); stream.flush(); os.fsync(stream.fileno())
  subprocess.Popen(['/usr/bin/python3','-I','-S',path],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','LC_ALL':'C'},close_fds=True,start_new_session=True)
 result('running',record)
def stop():
 fcntl.flock(lock,fcntl.LOCK_EX)
 expected=request['record']
 if expected['bootId']!=boot: refuse('客户机 boot 身份已改变，拒绝旧服务停止')
 record=read_owner()
 if record is None or (record['runId']!=expected['runId'] and record['phase']=='stopped'):
  if os.path.lexists(scope_path(expected)) or tmux_panes(): refuse('服务归属未知，拒绝未核对停止')
  if record is not None and os.path.lexists(scope_path(record)): refuse('旧服务 cgroup 已被替换，拒绝覆盖归属')
  cancel(expected); clean_input(expected); stopped=dict(expected,phase='stopped'); write_owner(stopped); result('stopped',stopped); return
 expect_owner(record)
 panes=tmux_panes(); pane_identity(record,panes)
 descriptor=scope_descriptor(record)
 cancel(record)
 pidfd=None
 try:
  if record['panePid'] is not None:
   fields=proc_fields(record['panePid'])
   if fields is not None and fields[0] not in ['Z','X']:
    if fields[19]!=record['paneStartTicks']: refuse('服务 pane PID 已复用')
    pidfd=os.pidfd_open(record['panePid'])
    again=proc_fields(record['panePid'])
    if again is None or again[19]!=record['paneStartTicks']: refuse('服务 pane 身份在停止前已改变')
    if record['phase']=='running' and '0::/'+record['scopeName'] not in open('/proc/'+str(record['panePid'])+'/cgroup').read().splitlines(): refuse('已提交服务 pane 离开所属 cgroup，拒绝猜测停止')
    signal.pidfd_send_signal(pidfd,signal.SIGTERM)
  if descriptor is not None:
   if '0::/'+record['scopeName'] in open('/proc/self/cgroup').read().splitlines(): refuse('不能从被停止的服务 cgroup 内执行清理')
   time.sleep(0.2)
   if populated(descriptor):
    kill=os.open('cgroup.kill',os.O_WRONLY,dir_fd=descriptor)
    try: os.write(kill,b'1')
    finally: os.close(kill)
   deadline=time.monotonic()+10
   while populated(descriptor):
    if time.monotonic()>=deadline: refuse('服务 cgroup 子进程尚未停止')
    time.sleep(0.05)
  # A registered pane may still be waiting for the scope lock before its first
  # cgroup entry. pidfd addresses that exact process, never a reused PID.
  if pidfd is not None:
   try: signal.pidfd_send_signal(pidfd,signal.SIGKILL)
   except ProcessLookupError: pass
  deadline=time.monotonic()+5
  while tmux_panes():
   pane_identity(record,tmux_panes())
   if time.monotonic()>=deadline: refuse('原服务 pane 尚未退出，停止未确认')
   time.sleep(0.05)
  if descriptor is not None:
   if str(os.stat(scope_path(record)).st_ino)!=record['inode']: refuse('服务 cgroup 路径在删除前已改变')
   for path,children,files in os.walk(scope_path(record),topdown=False): os.rmdir(path)
  clean_input(record)
  for prefix in ['pane-','watchdog-']:
   try: os.unlink(folder+'/'+prefix+record['runId']+'.py')
   except FileNotFoundError: pass
  record['phase']='stopped'; write_owner(record); result('stopped',record)
 finally:
  if pidfd is not None: os.close(pidfd)
  if descriptor is not None: os.close(descriptor)
def watchdog():
 expected=request['record']; deadline=request['deadline']
 if request.get('namespace') not in ('browser-ide','reverse-tunnel') or not isinstance(deadline,int) or deadline>time.time()+14400: refuse('限时服务 guard 身份不符')
 # The guard runs outside the service. Hold the original cgroup descriptor;
 # its inode cannot become authority over a later run with a reused name.
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner(); expect_owner(record)
 if record['phase']=='stopped': return
 descriptor=scope_descriptor(record)
 if descriptor is None: refuse('浏览器 IDE guard 缺少原完整域')
 fcntl.flock(lock,fcntl.LOCK_UN)
 try:
  until=time.monotonic()+max(0,deadline-time.time())
  while time.monotonic()<until:
   time.sleep(max(0,min(5,until-time.monotonic())))
   fcntl.flock(lock,fcntl.LOCK_EX)
   record=read_owner()
   if record is None or record['runId']!=expected['runId'] or record['phase']=='stopped': return
   expect_owner(record)
   fcntl.flock(lock,fcntl.LOCK_UN)
  # stop rechecks the original receipt, boot, pane ticks and inode and removes
  # the whole group. Native ticket retirement is left for host recovery.
  stop()
 finally: os.close(descriptor)
def pane():
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  fcntl.flock(lock,fcntl.LOCK_EX)
  record=read_owner(); expect_owner(record)
  if cancelled(record) or record['phase']=='stopped': refuse('服务启动已取消；项目代码未执行')
  if record['panePid'] is not None:
   if record['panePid']!=os.getpid() or proc_fields(os.getpid())[19]!=record['paneStartTicks']: refuse('当前 pane 不属于本次启动')
   pane_identity(record,tmux_panes())
   descriptor=scope_descriptor(record)
   if descriptor is None: refuse('服务 cgroup 已缺失；项目代码未执行')
   try:
    with open('/proc/self/fd/'+str(descriptor)+'/cgroup.procs','w') as stream: stream.write(str(os.getpid()))
   finally: os.close(descriptor)
   if '0::/'+record['scopeName'] not in open('/proc/self/cgroup').read().splitlines(): refuse('服务未进入已登记 cgroup；项目代码未执行')
   if record['phase']=='running':
    data=consume_input(record)
    fcntl.flock(lock,fcntl.LOCK_UN)
    os.close(lock)
    log_file=request['logFile']
    log_descriptor=os.open(log_file,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    info=os.fstat(log_descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1: refuse('服务日志归属无法核对')
    os.fchmod(log_descriptor,0o600)
    os.ftruncate(log_descriptor,0)
    with os.fdopen(log_descriptor,'wb') as output:
     child=subprocess.Popen(['/bin/sh','-c',request['command']],stdin=subprocess.PIPE,stdout=output,stderr=output,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','LC_ALL':'C'},close_fds=True)
     child.communicate(data)
    sys.exit(child.returncode if child.returncode>=0 else 128-child.returncode)
  fcntl.flock(lock,fcntl.LOCK_UN); time.sleep(0.05)
 refuse('服务提交等待超时；项目代码未执行；归属记录已保留')
try:
 {'status':status,'prepare':prepare,'start':launch,'commit':commit,'stop':stop,'pane':pane,'watchdog':watchdog}[request['op']]()
except Exception as error:
 print('SAKURA_SERVICE_SCOPE_REFUSED: '+str(error),file=sys.stderr); sys.exit(73)
`;

/**
 * 入口 / Entry: projectBrowserIdeScopeCommand.
 * 功能：把本层请求转交 `projectScopeCommand`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `projectScopeCommand` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project; op: Operation; record: ProjectBrowserIdeRecord optional; payload: ProjectScopeInput optional; deadline: number optional; transport: z.infer<typeof transportSchema> optional
 * 输出 / Returns: `projectScopeCommand(project, { kind: 'service', name: 'browser-ide', namespace: 'browser-ide', deadline }, op, record, payloa…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectBrowserIdeScopeCommand(project: Project, op: Operation, record?: ProjectBrowserIdeRecord, payload?: ProjectScopeInput, deadline?: number, transport?: z.infer<typeof transportSchema>) {
  return projectScopeCommand(project, { kind: 'service', name: 'browser-ide', namespace: 'browser-ide', deadline }, op, record, payload, transport);
}

/**
 * 入口 / Entry: projectNotebookScopeCommand.
 * 功能：把本层请求转交 `projectScopeCommand`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `projectScopeCommand` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project; op: Operation; record: ProjectNotebookRecord optional; payload: ProjectScopeInput optional; transport: z.infer<typeof transportSchema> optional
 * 输出 / Returns: `projectScopeCommand(project, { kind: 'service', name: 'notebook', namespace: 'notebook' }, op, record, payload, transport)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectNotebookScopeCommand(project: Project, op: Operation, record?: ProjectNotebookRecord,
  payload?: ProjectScopeInput, transport?: z.infer<typeof transportSchema>) {
  return projectScopeCommand(project, { kind: 'service', name: 'notebook', namespace: 'notebook' }, op, record, payload, transport);
}

/**
 * 入口 / Entry: python.
 * 功能：从当前输入或状态计算 ``request=json.loads(${JSON.stringify(JSON.stringify(request))})\n``，供调用方后续验证或使用。
 * Purpose: Computes ``request=json.loads(${JSON.stringify(JSON.stringify(request))})\n`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: request: object
 * 输出 / Returns: ``request=json.loads(${JSON.stringify(JSON.stringify(request))})\n``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function python(request: object) {
  return `request=json.loads(${JSON.stringify(JSON.stringify(request))})\n`;
}
/**
 * 入口 / Entry: projectScopeCommand.
 * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_${op.toUpperCase()}\n` + `# SAKURA_PROJECT_${target.kind ===…` 供上层消费（`project-service-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-service-scope.ts`; this entry produces ``# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_${op.toUpperCase()}\n` + `# SAKURA_PROJECT_${target.kind ===…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
 * 处理：通过 `scopePaths`, `helper.replaceAll().replaceAll`, `helper.replaceAll`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `scopePaths`, `helper.replaceAll().replaceAll`, `helper.replaceAll`, `inline.includes`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; target: ScopeTarget; op: Operation; record: ProjectScopeRecord optional; payload: ProjectScopeInput optional; transport: z.infer<typeof transportSchema> optional
 * 输出 / Returns: ``# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_${op.toUpperCase()}\n` + `# SAKURA_PROJECT_${target.kind ===…`.
 * 副作用 / Effects: `helper.replaceAll().replaceAll`; `helper.replaceAll`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `request.deadline`, `request.watchdogScript`, `request.transport`, `request.paneScript`.
 * 拒绝 / Refusals: 条件 / conditions `target.kind === 'service' && ['browser-ide', 'reverse-tunnel'].includes(target.namespace || '') && op === 'commit'`; `!record || !Number.isSafeInteger(target.deadline) || target.deadline! <= Math.floor(Date.now() / 1000) || target.deadline! > …`; `op === 'start'`; 异常 / errors `new AppError('限时服务时限或原运行记录不符', 409, target.namespace === 'browser-ide' ? 'BROWSER_IDE_SCOPE_CHANGED' : 'SERVICE_SCOPE_CHANGED…`; `new AppError('项目账号受保护正文或运行身份无法核对', 409, target.kind === 'main' ? 'PROJECT_MAIN_SCOPE_CHANGED' : 'SERVICE_SCOPE_CHANGED')`.
 */
function projectScopeCommand(project: Project, target: ScopeTarget, op: Operation,
  record?: ProjectScopeRecord, payload?: ProjectScopeInput,
  transport?: z.infer<typeof transportSchema>) {
  const paths = scopePaths(project, target);
  const executionHelper = target.kind === 'main'
    ? helper.replaceAll('服务', '项目主命令').replaceAll('SAKURA_SERVICE_SCOPE_', 'SAKURA_PROJECT_MAIN_SCOPE_') : helper;
  const request: any = { op, ...paths, ...(record ? { record } : {}), ...(transport ? { transport } : {}) };
  if (target.kind === 'service' && ['browser-ide', 'reverse-tunnel'].includes(target.namespace || '') && op === 'commit') {
    if (!record || !Number.isSafeInteger(target.deadline) || target.deadline! <= Math.floor(Date.now() / 1000) ||
        target.deadline! > Math.floor(Date.now() / 1000) + 14400)
      throw new AppError('限时服务时限或原运行记录不符', 409,
        target.namespace === 'browser-ide' ? 'BROWSER_IDE_SCOPE_CHANGED' : 'SERVICE_SCOPE_CHANGED');
    request.deadline = target.deadline;
    request.watchdogScript = 'import json\n' + python({ op: 'watchdog', ...paths,
      record: { ...record, phase: 'running' }, deadline: target.deadline,
      ...(transport ? { transport } : {}) }) + executionHelper;
  }
  if (op === 'start') {
    if (!record || !payload || payload.runId !== record.runId || !Buffer.isBuffer(payload.input) ||
        !/^[a-f0-9]{64}$/.test(payload.sha256) || payload.input.length < 1 || payload.input.length > 128 * 1024 ||
        createHash('sha256').update(payload.input).digest('hex') !== payload.sha256 ||
        typeof payload.command !== 'string' || payload.command.length > 8192 || /[\x00-\x1f\x7f]/.test(payload.command))
      throw new AppError('项目账号受保护正文或运行身份无法核对', 409,
        target.kind === 'main' ? 'PROJECT_MAIN_SCOPE_CHANGED' : 'SERVICE_SCOPE_CHANGED');
    request.transport = transportSchema.parse({ version: 1, sha256: payload.sha256, bytes: payload.input.length });
    const paneRequest = { op: 'pane', ...paths, record, transport: request.transport,
      command: payload.command, logFile: `/tmp/${paths.session}.log` };
    request.paneScript = 'import json\n' + python(paneRequest) + executionHelper;
  }
  const source = 'import json\n' + python(request) + executionHelper;
  const { paneScript: _paneScript, watchdogScript: _watchdogScript, ...metadata } = request;
  return `# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_${op.toUpperCase()}\n` +
    `# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_REQUEST=${Buffer.from(JSON.stringify(metadata)).toString('base64')}\n` +
    `set -eu\nif [ ! -x /usr/bin/python3 ] || [ ! -x /usr/bin/tmux ]; then ` +
    `echo 'SAKURA_${target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_SCOPE_UNAVAILABLE: ` +
    `受管运行需要 python3、tmux 和可写 cgroup v2；项目代码未执行' >&2; exit 73; fi\n` +
    `/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`;
}
/**
 * 入口 / Entry: projectServiceScopeCommand.
 * 功能：把本层请求转交 `projectScopeCommand`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `projectScopeCommand` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project; name: string; op: Operation; record: ProjectServiceRecord optional; payload: ProjectScopeInput optional
 * 输出 / Returns: `projectScopeCommand(project, { kind: 'service', name }, op, record, payload)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectServiceScopeCommand(project: Project, name: string, op: Operation,
  record?: ProjectServiceRecord, payload?: ProjectScopeInput) {
  return projectScopeCommand(project, { kind: 'service', name }, op, record, payload);
}
/**
 * 入口 / Entry: projectMainScopeCommand.
 * 功能：把本层请求转交 `projectScopeCommand`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `projectScopeCommand` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project; op: Operation; record: ProjectMainRecord optional; payload: ProjectScopeInput optional
 * 输出 / Returns: `projectScopeCommand(project, { kind: 'main' }, op, record, payload)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectMainScopeCommand(project: Project, op: Operation, record?: ProjectMainRecord, payload?: ProjectScopeInput) {
  return projectScopeCommand(project, { kind: 'main' }, op, record, payload);
}

class ProjectProcessScope<Record extends ProjectScopeRecord> {
  private readonly instance: object | undefined;
  /**
   * 入口 / Entry: ProjectProcessScope.constructor.
   * 功能：建立 ProjectProcessScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectProcessScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project; target: ScopeTarget; schema: z.ZodType<Record>; instance: object | undefined
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.instance`.
   */
  constructor(private machines: Machines, private id: string, protected project: Project,
    private target: ScopeTarget, private schema: z.ZodType<Record>, instance: object | undefined) {
    this.instance = instance;
  }
  /**
   * 入口 / Entry: ProjectProcessScope.code.
   * 功能：从当前输入或状态计算 ``${this.target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_${suffix}``，供调用方后续验证或使用。
   * Purpose: Computes ``${this.target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_${suffix}`` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: suffix: string
   * 输出 / Returns: ``${this.target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_${suffix}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private code(suffix: string) { return `${this.target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_${suffix}`; }
  /**
   * 入口 / Entry: ProjectProcessScope.label.
   * 功能：向调用者提供 `this.target.kind === 'main' ? '项目主命令' : `服务 ${this.target.name}`` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.target.kind === 'main' ? '项目主命令' : `服务 ${this.target.name}`` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.target.kind === 'main' ? '项目主命令' : `服务 ${this.target.name}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get label() { return this.target.kind === 'main' ? '项目主命令' : `服务 ${this.target.name}`; }
  /**
   * 入口 / Entry: ProjectProcessScope.assertLive.
   * 功能：在定义项目常驻服务票据和控制器中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectProcessScope`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectProcessScope`; the calls and state transitions below complete the operation. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.machines.live.get`, `this.code` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.code`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.instance || this.machines.live.get(this.id) !== this.instance`; 异常 / errors `new AppError(`客户机 live 实例已改变，拒绝旧${this.label}操作`, 409, this.code('SCOPE_CHANGED'))`.
   */
  private assertLive() {
    if (!this.instance || this.machines.live.get(this.id) !== this.instance)
      throw new AppError(`客户机 live 实例已改变，拒绝旧${this.label}操作`, 409, this.code('SCOPE_CHANGED'));
  }
  /**
   * 入口 / Entry: ProjectProcessScope.receipt.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.target.kind === 'service' && this.target.namespace === 'browser-ide' ? join(vmDir(this.id), 'project-browser-ide', p.pro…` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `this.target.kind === 'service' && this.target.namespace === 'browser-ide' ? join(vmDir(this.id), 'project-browser-ide', p.pro…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `scopePaths`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scopePaths`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.target.kind === 'service' && this.target.namespace === 'browser-ide' ? join(vmDir(this.id), 'project-browser-ide', p.pro…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  receipt() {
    const p = scopePaths(this.project, this.target);
    return this.target.kind === 'service' && this.target.namespace === 'browser-ide'
      ? join(vmDir(this.id), 'project-browser-ide', p.projectId, 'runtime.json')
      : this.target.kind === 'service' && this.target.namespace === 'reverse-tunnel'
      ? join(vmDir(this.id), 'project-reverse-tunnels', p.projectId, 'runtime.json')
      : this.target.kind === 'service' && this.target.namespace === 'mesh'
      ? join(vmDir(this.id), 'project-mesh', p.projectId, 'runtime.json')
      : this.target.kind === 'service' && this.target.namespace === 'notebook'
      ? join(vmDir(this.id), 'project-notebooks', p.projectId, 'runtime.json')
      : this.target.kind === 'service' && this.target.namespace === 'desktop'
      ? join(vmDir(this.id), 'project-desktop', p.projectId, 'runtime.json')
      : this.target.kind === 'main'
      ? join(vmDir(this.id), 'project-main', p.projectId, 'runtime.json')
      : join(vmDir(this.id), 'project-services', p.projectId, this.target.name, 'runtime.json');
  }
  /**
   * 入口 / Entry: ProjectProcessScope.hasReceipt.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` / `false` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `true` / `false` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `lstat`, `this.receipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `lstat`, `this.receipt`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `true`; `false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async hasReceipt() {
    try { await lstat(this.receipt()); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  /**
   * 入口 / Entry: ProjectProcessScope.metadata.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `saved === null ? null : this.schema.parse(saved)` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `saved === null ? null : this.schema.parse(saved)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `readStore`, `this.receipt`, `this.schema.parse`, `this.code` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `this.receipt`, `this.schema.parse`, `this.code`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `saved === null ? null : this.schema.parse(saved)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError(`主机${this.label}归属记录无法核对`, 409, this.code('SCOPE_CHANGED'))`.
   * 失败处理：catch 分支执行 `throw new AppError(`主机${this.label}归属记录无法核对`, 409, this.code('SCOPE_CHANGED'));`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError(`主机${this.label}归属记录无法核对`, 409, this.code('SCOPE_CHANGED'));`; these statements determine whether a failure is absorbed or rejected again.
   */
  async metadata() {
    try {
      const saved = await readStore<unknown>(this.receipt(), () => null);
      return saved === null ? null : this.schema.parse(saved);
    }
    catch { throw new AppError(`主机${this.label}归属记录无法核对`, 409, this.code('SCOPE_CHANGED')); }
  }
  /**
   * 入口 / Entry: ProjectProcessScope.save.
   * 功能：在定义项目常驻服务票据和控制器中，校验并提交领域状态变更；完成下述调用及状态处理（`ProjectProcessScope`）。
   * Purpose: Validates and commits a domain state change in `ProjectProcessScope`; the calls and state transitions below complete the operation. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.assertLive`, `this.receipt`, `regularDirectory`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertLive`, `this.receipt`, `regularDirectory`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: Record
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(record: Record) {
    this.assertLive();
    const file = this.receipt();
    await regularDirectory(join(file, '..'));
    await writeStore(file, this.schema.parse(record));
    this.assertLive();
  }
  /**
   * 入口 / Entry: ProjectProcessScope.persistIntent.
   * 功能：在定义项目常驻服务票据和控制器中，校验并提交领域状态变更；本入口产生 `void` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Validates and commits a domain state change in `ProjectProcessScope`; this entry produces `void` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.code`, `this.assertLive`, `this.metadata`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.code`, `this.assertLive`, `this.metadata`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `JSON.stringify(previous) === JSON.stringify(record)`; `await identities.hasRun(this.id, previous.projectId, previous.runId)`.
   * 输入 / Inputs: record: Record
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `identities.closeAfterScopeStopped`; `this.save`.
   * 拒绝 / Refusals: 条件 / conditions `record.phase !== 'intent'`; `previous`; `previous.phase !== 'stopped' || previous.runId === record.runId`; 异常 / errors `new AppError('运行意图阶段不符', 409, this.code('SCOPE_CHANGED'))`; `new AppError(`${this.label}原运行尚未完成清理，拒绝覆盖归属记录`, 409, this.code('SCOPE_CHANGED'))`.
   */
  async persistIntent(record: Record) {
    if (record.phase !== 'intent') throw new AppError('运行意图阶段不符', 409, this.code('SCOPE_CHANGED'));
    this.assertLive();
    const previous = await this.metadata();
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(record)) return;
      if (previous.phase !== 'stopped' || previous.runId === record.runId)
        throw new AppError(`${this.label}原运行尚未完成清理，拒绝覆盖归属记录`, 409, this.code('SCOPE_CHANGED'));
      const identities = new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines);
      if (await identities.hasRun(this.id, previous.projectId, previous.runId))
        await identities.closeAfterScopeStopped(this.id, previous.projectId, previous.runId);
      this.assertLive();
      if (JSON.stringify(await this.metadata()) !== JSON.stringify(previous))
        throw new AppError(`${this.label}归属在账号清理期间已改变，拒绝覆盖`, 409, this.code('SCOPE_CHANGED'));
    }
    await this.save(record);
  }
  /**
   * 入口 / Entry: ProjectProcessScope.transportFile.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.receipt(), '..', `transport-${record.runId}.json`)` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `join(this.receipt(), '..', `transport-${record.runId}.json`)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `join`, `this.receipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `this.receipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: Record
   * 输出 / Returns: `join(this.receipt(), '..', `transport-${record.runId}.json`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private transportFile(record: Record) {
    return join(this.receipt(), '..', `transport-${record.runId}.json`);
  }
  /**
   * 入口 / Entry: ProjectProcessScope.transport.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `transportSchema.parse({ version: 1, sha256: stored.sha256, bytes: stored.bytes })` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `undefined` / `transportSchema.parse({ version: 1, sha256: stored.sha256, bytes: stored.bytes })` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `readStore`, `this.transportFile`, `z.object().strict().parse`, `z.object().strict` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `this.transportFile`, `z.object().strict().parse`, `z.object().strict`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value === null`.
   * 输入 / Inputs: record: Record
   * 输出 / Returns: `undefined`; `transportSchema.parse({ version: 1, sha256: stored.sha256, bytes: stored.bytes })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError(`${this.label}受保护正文归属记录无法核对`, 409, this.code('SCOPE_CHANGED'))`.
   * 失败处理：catch 分支执行 `throw new AppError(`${this.label}受保护正文归属记录无法核对`, 409, this.code('SCOPE_CHANGED'));`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError(`${this.label}受保护正文归属记录无法核对`, 409, this.code('SCOPE_CHANGED'));`; these statements determine whether a failure is absorbed or rejected again.
   */
  protected async transport(record: Record) {
    try {
      const value = await readStore<unknown>(this.transportFile(record), () => null);
      if (value === null) return undefined;
      const stored = z.object({ version: z.literal(1), record: this.schema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(128 * 1024),
        commandSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value);
      this.sameOwner(stored.record, record);
      return transportSchema.parse({ version: 1, sha256: stored.sha256, bytes: stored.bytes });
    } catch { throw new AppError(`${this.label}受保护正文归属记录无法核对`, 409, this.code('SCOPE_CHANGED')); }
  }
  /**
   * 入口 / Entry: ProjectProcessScope.saveTransport.
   * 功能：在定义项目常驻服务票据和控制器中，校验并提交领域状态变更；完成下述调用及状态处理（`ProjectProcessScope`）。
   * Purpose: Validates and commits a domain state change in `ProjectProcessScope`; the calls and state transitions below complete the operation. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.assertLive`, `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertLive`, `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: Record; payload: ProjectScopeInput
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `writeFile`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async saveTransport(record: Record, payload: ProjectScopeInput) {
    this.assertLive();
    const metadata = { version: 1, record, sha256: payload.sha256, bytes: payload.input.length,
      commandSha256: createHash('sha256').update(payload.command).digest('hex') };
    // 每次运行的不可变运输元数据先落盘再传正文，丢失回执后的重试不能覆盖原帧。
    await writeFile(this.transportFile(record), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    this.assertLive();
  }
  /**
   * 入口 / Entry: ProjectProcessScope.execute.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `response` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `response` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.assertLive`, `this.transport`, `projectScopeCommand`, `this.machines.execInput` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertLive`, `this.transport`, `projectScopeCommand`, `this.machines.execInput`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `record && response.record`.
   * 输入 / Inputs: op: Operation; record: Record optional; payload: ProjectScopeInput optional; signal: AbortSignal optional
   * 输出 / Returns: `response`.
   * 副作用 / Effects: `this.machines.execInput`; `this.machines.exec`; `request.catch`; 更新 / updates `response`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; `response.record && response.record.bootId !== response.bootId`; `record && response.bootId !== record.bootId`; 异常 / errors `new AppError(result.stderr.trim() || `无法${op}${this.label}`, 409, result.stderr.includes(this.code('SCOPE_UNAVAILABLE')) ? th…`; `new AppError(`${this.label}归属回执无法核对，拒绝继续操作`, 409, this.code('SCOPE_CHANGED'))`.
   * 失败处理：catch 分支执行 `throw new AppError(`${this.label}归属回执无法核对，拒绝继续操作`, 409, this.code('SCOPE_CHANGED'));`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError(`${this.label}归属回执无法核对，拒绝继续操作`, 409, this.code('SCOPE_CHANGED'));`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async execute(op: Operation, record?: Record,
    payload?: ProjectScopeInput, signal?: AbortSignal) {
    this.assertLive();
    const transport = record ? await this.transport(record) : undefined;
    const command = projectScopeCommand(this.project, this.target, op, record, payload, transport);
    const request = op === 'start'
      ? this.machines.execInput(this.id, command, payload!.input, 30_000, signal)
      : this.machines.exec(this.id, command, 30_000, signal);
    /**
     * 入口 / Entry: ProjectProcessScope.execute.callback@741.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（request.catch）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (request.catch).
     * 输入 / Inputs: error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.target.kind !== 'main'`; 异常 / errors `error`; `new AppError(`项目主命令控制回执未确认：${error instanceof Error ? error.message : String(error)}`, 409, this.code('SCOPE_CHANGED'))`.
     */
    const result = await request.catch((error) => {
        signal?.throwIfAborted();
        this.assertLive();
        if (this.target.kind !== 'main') throw error;
        throw new AppError(`项目主命令控制回执未确认：${error instanceof Error ? error.message : String(error)}`,
          409, this.code('SCOPE_CHANGED'));
      });
    this.assertLive();
    if (result.code !== 0)
      throw new AppError(result.stderr.trim() || `无法${op}${this.label}`, 409,
        result.stderr.includes(this.code('SCOPE_UNAVAILABLE')) ? this.code('SCOPE_UNAVAILABLE') : this.code('SCOPE_CHANGED'));
    let response: ProjectScopeStatus<Record>;
    try { response = responseSchema(this.schema).parse(JSON.parse(result.stdout)); }
    catch { throw new AppError(`${this.label}归属回执无法核对，拒绝继续操作`, 409, this.code('SCOPE_CHANGED')); }
    if (response.record && response.record.bootId !== response.bootId)
      throw new AppError(`${this.label}回执 boot 身份不符`, 409, this.code('SCOPE_CHANGED'));
    if (record && response.bootId !== record.bootId)
      throw new AppError('客户机 boot 身份已改变', 409, this.code('SCOPE_CHANGED'));
    if (record && response.record && (response.record.runId !== record.runId || response.record.scopeName !== record.scopeName))
      throw new AppError(`客体回执与本次${this.label} run 不符`, 409, this.code('SCOPE_CHANGED'));
    if (record && response.record) this.sameOwner(record, response.record);
    return response;
  }
  /**
   * 入口 / Entry: ProjectProcessScope.sameOwner.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; the calls and state transitions below complete the operation. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.code` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.code`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: expected: Record; actual: Record
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `expected[key] !== actual[key]`; `expected[key] !== null && expected[key] !== actual[key]`; 异常 / errors `new AppError(`${this.label}运行归属已改变，拒绝旧操作`, 409, this.code('SCOPE_CHANGED'))`; `new AppError(`${this.label} cgroup 或 pane 归属已改变，拒绝旧操作`, 409, this.code('SCOPE_CHANGED'))`.
   */
  private sameOwner(expected: Record, actual: Record) {
    for (const key of ['runId', 'bootId', 'scopeName', 'binding'] as const)
      if (expected[key] !== actual[key])
        throw new AppError(`${this.label}运行归属已改变，拒绝旧操作`, 409, this.code('SCOPE_CHANGED'));
    for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
      if (expected[key] !== null && expected[key] !== actual[key])
        throw new AppError(`${this.label} cgroup 或 pane 归属已改变，拒绝旧操作`, 409, this.code('SCOPE_CHANGED'));
  }
  /**
   * 入口 / Entry: ProjectProcessScope.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...status, status: 'unconfirmed' as const, record: saved }` / `status` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectProcessScope`; this entry produces `{ ...status, status: 'unconfirmed' as const, record: saved }` / `status` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.execute`, `this.code`, `this.metadata`, `this.sameOwner` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.execute`, `this.code`, `this.metadata`, `this.sameOwner`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `saved && status.record`; `saved && !status.record && status.status === 'absent' && saved.phase !== 'stopped' && saved.bootId =…`.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `{ ...status, status: 'unconfirmed' as const, record: saved }`; `status`.
   * 副作用 / Effects: `this.execute`.
   * 拒绝 / Refusals: 条件 / conditions `status.status === 'unmanaged'`; 异常 / errors `new AppError(`旧 tmux ${this.label}缺少可验证归属，请明确关闭旧会话后重新启动；未自动停止任何进程`, 409, this.code('SCOPE_UNMANAGED'))`.
   */
  async status(signal?: AbortSignal) {
    const status = await this.execute('status', undefined, undefined, signal);
    if (status.status === 'unmanaged')
      throw new AppError(`旧 tmux ${this.label}缺少可验证归属，请明确关闭旧会话后重新启动；未自动停止任何进程`, 409, this.code('SCOPE_UNMANAGED'));
    const saved = await this.metadata();
    if (saved && status.record) this.sameOwner(saved, status.record);
    if (saved && !status.record && status.status === 'absent' && saved.phase !== 'stopped' && saved.bootId === status.bootId)
      return { ...status, status: 'unconfirmed' as const, record: saved };
    return status;
  }
  /**
   * 入口 / Entry: ProjectProcessScope.newIntent.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.schema.parse({ ...(this.target.kind === 'main' ? { version: 2, kind: 'main' } : { version: 1, name: this.target.name }),…` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `this.schema.parse({ ...(this.target.kind === 'main' ? { version: 2, kind: 'main' } : { version: 1, name: this.target.name }),…` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `scopePaths`, `randomUUID`, `this.schema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scopePaths`, `randomUUID`, `this.schema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: binding: string; bootId: string
   * 输出 / Returns: Record；结果来自 / values from `this.schema.parse({ ...(this.target.kind === 'main' ? { version: 2, kind: 'main' } : { version: 1, name: this.target.name }),…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  newIntent(binding: string, bootId: string): Record {
    const paths = scopePaths(this.project, this.target), runId = randomUUID();
    return this.schema.parse({ ...(this.target.kind === 'main' ? { version: 2, kind: 'main' }
      : { version: 1, name: this.target.name }), projectId: paths.projectId, session: paths.session,
      runId, bootId, scopeName: `sakura-${this.target.kind === 'main' ? 'main' : 'service'}-${runId}`, inode: null,
      binding, phase: 'intent', sessionId: null, paneId: null, panePid: null, paneStartTicks: null });
  }
  /**
   * 入口 / Entry: ProjectProcessScope.start.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `session.perform(active => this.startNative(record, payload, active, session), signal)` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `session.perform(active => this.startNative(record, payload, active, session), signal)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `projectScopeCommand`, `this.persistIntent`, `ProjectSessionLifetime.acquire`, `session.perform` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectScopeCommand`, `this.persistIntent`, `ProjectSessionLifetime.acquire`, `session.perform`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: Record; payload: ProjectScopeInput; signal: AbortSignal
   * 输出 / Returns: `session.perform(active => this.startNative(record, payload, active, session), signal)`.
   * 副作用 / Effects: `this.persistIntent`; `ProjectSessionLifetime.acquire`; 更新 / updates `payload`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async start(record: Record, payload: ProjectScopeInput, signal: AbortSignal) {
    // 首次 await 前校验并复制正文；root 命令只含固定控制逻辑，项目正文经 execInput 的 stdin 交付。
    projectScopeCommand(this.project, this.target, 'start', record, payload);
    payload = { ...payload, input: Buffer.from(payload.input) };
    await this.persistIntent(record);
    const session = await ProjectSessionLifetime.acquire({ machines: this.machines, vmId: this.id,
      kind: this.target.kind, receipt: record, signal,
      live: this.instance as NonNullable<ReturnType<Machines['live']['get']>>,
      /**
       * 入口 / Entry: ProjectProcessScope.start.cleanup.
       * 功能：把本层请求转交 `this.stopNative`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.stopNative` and propagates the provider result or rejection.
       * 输入 / Inputs: current
       * 输出 / Returns: `this.stopNative(current)`.
       * 副作用 / Effects: `this.stopNative`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      cleanup: current => this.stopNative(current) });
    return session.perform(active => this.startNative(record, payload, active, session), signal);
  }
  /**
   * 入口 / Entry: ProjectProcessScope.startNative.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `committed.record` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `committed.record` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `inline.ProjectRunScopes.hasRun`, `inline`, `this.code`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.ProjectRunScopes.hasRun`, `inline`, `this.code`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: Record; payload: ProjectScopeInput; signal: AbortSignal; session: ProjectSessionLifetime<Record>
   * 输出 / Returns: `committed.record`.
   * 副作用 / Effects: `this.execute`; `this.save`; `this.saveTransport`.
   * 拒绝 / Refusals: 条件 / conditions `!await new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines).hasRun(this.id, record.projectId, record.…`; `prepared.status !== 'prepared' || !prepared.record`; `pane.status !== 'prepared' || !pane.record?.panePid`; 异常 / errors `new AppError(`${this.label}缺少已保存的项目账号运行票据，项目代码未执行`, 409, this.code('IDENTITY_REQUIRED'))`; `new AppError(`${this.label} prepared 回执不完整`, 409, this.code('SCOPE_CHANGED'))`.
   */
  private async startNative(record: Record, payload: ProjectScopeInput, signal: AbortSignal,
    session: ProjectSessionLifetime<Record>) {
    if (!await new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines).hasRun(this.id, record.projectId, record.runId))
      throw new AppError(`${this.label}缺少已保存的项目账号运行票据，项目代码未执行`, 409, this.code('IDENTITY_REQUIRED'));
    signal.throwIfAborted();
    const prepared = await this.execute('prepare', record, undefined, signal);
    if (prepared.status !== 'prepared' || !prepared.record)
      throw new AppError(`${this.label} prepared 回执不完整`, 409, this.code('SCOPE_CHANGED'));
    await this.save(prepared.record);
    session.pin(prepared.record);
    await this.saveTransport(prepared.record, payload);
    const pane = await this.execute('start', prepared.record, payload, signal);
    if (pane.status !== 'prepared' || !pane.record?.panePid)
      throw new AppError(`${this.label} pane 回执不完整`, 409, this.code('SCOPE_CHANGED'));
    await this.save(pane.record);
    session.pin(pane.record);
    const committed = await this.execute('commit', pane.record, undefined, signal);
    if (committed.status !== 'running' || !committed.record)
      throw new AppError(`${this.label}提交回执未确认`, 409, this.code('SCOPE_CHANGED'));
    await this.save(committed.record);
    session.pin(committed.record);
    return committed.record;
  }
  /**
   * 入口 / Entry: ProjectProcessScope.retireRebootedService.
   * 功能：在定义项目常驻服务票据和控制器中，结束、撤销或清理本次拥有的领域资源；本入口产生 `false` / `true` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProcessScope`; this entry produces `false` / `true` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.assertLive`, `scopePaths`, `unchanged`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertLive`, `scopePaths`, `unchanged`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.target.kind !== 'service'`; `!response.data.retired`; `saved.phase !== 'stopped'`.
   * 输入 / Inputs: record: Record; log: (text: string) => void optional
   * 输出 / Returns: `false`; `true`.
   * 副作用 / Effects: `this.machines.exec`; `this.save`; `identities.closeAfterScopeStopped`.
   * 拒绝 / Refusals: 条件 / conditions `!response || !response.success || response.data.retired !== (response.data.bootId !== record.bootId)`; 异常 / errors `new AppError(result.stderr.trim() || '服务重启归属回执未确认', 409, this.code('SCOPE_CHANGED'))`.
   */
  private async retireRebootedService(record: Record, log?: (text: string) => void) {
    if (this.target.kind !== 'service') return false;
    this.assertLive();
    const request = { op: 'probe-reboot', ...scopePaths(this.project, this.target), record };
    const source = `import fcntl,json,os,stat,subprocess
request=json.loads(${JSON.stringify(JSON.stringify(request))})
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
if boot==request['record']['bootId']:
 print(json.dumps({'bootId':boot,'retired':False}))
else:
 folder=request['guest']
 root='/run/sakura-browser-ide' if request.get('namespace')=='browser-ide' else '/run/sakura-notebook' if request.get('namespace')=='notebook' else '/run/sakura-reverse-tunnels' if request.get('namespace')=='reverse-tunnel' else '/run/sakura-project-mesh' if request.get('namespace')=='mesh' else '/run/sakura-project-desktop' if request.get('namespace')=='desktop' else '/run/sakura-project-services'
 for path in [root,folder.rsplit('/',1)[0],folder]:
  try: os.mkdir(path,0o700)
  except FileExistsError: pass
  info=os.lstat(path)
  assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 lock=os.open(folder+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 info=os.fstat(lock)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 fcntl.flock(lock,fcntl.LOCK_EX)
 assert not os.path.lexists(folder+'/owner.json'),'新 boot 已有服务归属，拒绝旧运行停止'
 assert not os.path.lexists('/sys/fs/cgroup/'+request['record']['scopeName']),'新 boot 已有同路径 cgroup，拒绝旧运行停止'
 result=subprocess.run(['/usr/bin/tmux','has-session','-t','='+request['session']],capture_output=True,text=True)
 assert result.returncode!=0,'新 boot 已有同名 pane，拒绝旧运行停止'
 assert any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']),'新 boot 的 tmux 状态无法核对'
 print(json.dumps({'bootId':boot,'retired':True}))
`;
    /**
     * 入口 / Entry: ProjectProcessScope.retireRebootedService.unchanged.
     * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `saved` 供上层消费（`ProjectProcessScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProcessScope`; this entry produces `saved` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
     * 处理：通过 `this.assertLive`, `this.metadata`, `this.code` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.assertLive`, `this.metadata`, `this.code`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `saved`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!saved || JSON.stringify({ ...saved, phase: record.phase }) !== JSON.stringify(record) || (saved.phase !== record.phase && sa…`; 异常 / errors `new AppError('主机服务完整归属已改变，拒绝旧运行停止', 409, this.code('SCOPE_CHANGED'))`.
     */
    const unchanged = async () => {
      this.assertLive();
      const saved = await this.metadata(); this.assertLive();
      if (!saved || JSON.stringify({ ...saved, phase: record.phase }) !== JSON.stringify(record) ||
          (saved.phase !== record.phase && saved.phase !== 'stopped'))
        throw new AppError('主机服务完整归属已改变，拒绝旧运行停止', 409, this.code('SCOPE_CHANGED'));
      return saved;
    };
    await unchanged();
    const result = await this.machines.exec(this.id, '# SAKURA_PROJECT_SERVICE_REBOOT_STOP\n' +
      '# SAKURA_PROJECT_SERVICE_REQUEST=' + Buffer.from(JSON.stringify(request)).toString('base64') + '\n' +
      `/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`, 10000);
    const saved = await unchanged();
    const response = result.code === 0 && z.object({ bootId: z.uuid(), retired: z.boolean() }).strict()
      .safeParse((() => { try { return JSON.parse(result.stdout); } catch { return null; } })());
    if (!response || !response.success || response.data.retired !== (response.data.bootId !== record.bootId))
      throw new AppError(result.stderr.trim() || '服务重启归属回执未确认', 409, this.code('SCOPE_CHANGED'));
    if (!response.data.retired) return false;
    if (saved.phase !== 'stopped') await this.save({ ...saved, phase: 'stopped' });
    await unchanged();
    const identities = new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines);
    if (await identities.hasRun(this.id, record.projectId, record.runId))
      await identities.closeAfterScopeStopped(this.id, record.projectId, record.runId);
    await unchanged(); log?.(`${this.label}所属旧 boot 已结束；未向新 boot 进程发送停止信号\n`);
    return true;
  }
  /**
   * 入口 / Entry: ProjectProcessScope.stop.
   * 功能：把本层请求转交 `ProjectSessionLifetime.retire`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `ProjectSessionLifetime.retire` and propagates the provider result or rejection.
   * 输入 / Inputs: record: Record; log: (text: string) => void optional; verifyReboot: () => Promise<boolean> optional
   * 输出 / Returns: `ProjectSessionLifetime.retire(this.machines, this.id, record, async current => { if (await verifyReboot?.()) return; await th…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(record: Record, log?: (text: string) => void, verifyReboot?: () => Promise<boolean>) {
    return ProjectSessionLifetime.retire(this.machines, this.id, record, async current => {
      if (await verifyReboot?.()) return;
      await this.stopNative(current, log);
    });
  }
  /**
   * 入口 / Entry: ProjectProcessScope.stopNative.
   * 功能：在定义项目常驻服务票据和控制器中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ProjectProcessScope`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProcessScope`; this entry produces `void` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.assertLive`, `this.metadata`, `this.code`, `this.retireRebootedService` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertLive`, `this.metadata`, `this.code`, `this.retireRebootedService`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `await this.retireRebootedService(stored || record, log)`; `await identities.hasRun(this.id, record.projectId, record.runId)`; `this.machines.live.get(this.id) !== this.instance`.
   * 输入 / Inputs: record: Record; log: (text: string) => void optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.execute`; `this.save`; `identities.closeAfterScopeStopped`; 更新 / updates `expected`, `failure`.
   * 拒绝 / Refusals: 条件 / conditions `stored`; `current[key] !== record[key]`; `current[key] !== null && record[key] !== null && current[key] !== record[key]`; 异常 / errors `new AppError(`主机${this.label} run 已改变，拒绝旧回滚`, 409, this.code('SCOPE_CHANGED'))`; `new AppError(`主机${this.label} cgroup 或 pane 已改变，拒绝旧回滚`, 409, this.code('SCOPE_CHANGED'))`.
   * 失败处理：catch 分支执行 `failure = error;`; `log?.(`${this.label}清理第 ${attempt + 1} 次未确认：${error instanceof Error ? error.message : String(error)}\n`);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failure = error;`; `log?.(`${this.label}清理第 ${attempt + 1} 次未确认：${error instanceof Error ? error.message : String(error)}\n`);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async stopNative(record: Record, log?: (text: string) => void) {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; ++attempt) {
      try {
        this.assertLive();
        const stored = await this.metadata();
        let expected = record;
        if (stored) {
          const current = stored;
          // An interrupted prepare can leave the host intent less complete than
          // the guest's root-owned receipt. Compare every identity both sides
          // know, then carry the fuller identity into the guarded guest stop.
          for (const key of ['runId', 'bootId', 'scopeName', 'binding'] as const)
            if (current[key] !== record[key])
              throw new AppError(`主机${this.label} run 已改变，拒绝旧回滚`, 409, this.code('SCOPE_CHANGED'));
          for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
            if (current[key] !== null && record[key] !== null && current[key] !== record[key])
              throw new AppError(`主机${this.label} cgroup 或 pane 已改变，拒绝旧回滚`, 409, this.code('SCOPE_CHANGED'));
          expected = { ...record, inode: current.inode ?? record.inode,
            sessionId: current.sessionId ?? record.sessionId, paneId: current.paneId ?? record.paneId,
            panePid: current.panePid ?? record.panePid, paneStartTicks: current.paneStartTicks ?? record.paneStartTicks };
        }
        if (await this.retireRebootedService(stored || record, log)) return;
        const stopped = await this.execute('stop', expected);
        if (stopped.status !== 'stopped' || !stopped.record)
          throw new AppError(`${this.label}全 scope 停止未确认`, 409, this.code('SCOPE_CHANGED'));
        await this.save(stopped.record);
        const identities = new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines);
        if (await identities.hasRun(this.id, record.projectId, record.runId))
          await identities.closeAfterScopeStopped(this.id, record.projectId, record.runId);
        this.assertLive();
        return;
      } catch (error) {
        failure = error;
        log?.(`${this.label}清理第 ${attempt + 1} 次未确认：${error instanceof Error ? error.message : String(error)}\n`);
        if (this.machines.live.get(this.id) !== this.instance) break;
        if (attempt < 2) await delay(250 * (attempt + 1));
      }
    }
    throw new AppError(`${this.label}清理未确认：${failure instanceof Error ? failure.message : String(failure)}；` +
      `已保留运行记录 ${this.receipt()}`, 503, this.code('CLEANUP_FAILED'));
  }
}

export class ProjectServiceScopes {
  private readonly instance: object | undefined;
  /**
   * 入口 / Entry: ProjectServiceScopes.constructor.
   * 功能：建立 ProjectServiceScopes 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectServiceScopes context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.instance`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private id: string, private project: Project) {
    this.instance = machines.live.get(id);
  }
  /**
   * 入口 / Entry: ProjectServiceScopes.scope.
   * 功能：从当前输入或状态计算 `new ProjectProcessScope(this.machines, this.id, this.project, { kind: 'service', name }, projectServiceRecordSchema, this.ins…`，供调用方后续验证或使用。
   * Purpose: Computes `new ProjectProcessScope(this.machines, this.id, this.project, { kind: 'service', name }, projectServiceRecordSchema, this.ins…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: name: string
   * 输出 / Returns: `new ProjectProcessScope(this.machines, this.id, this.project, { kind: 'service', name }, projectServiceRecordSchema, this.ins…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private scope(name: string) {
    return new ProjectProcessScope(this.machines, this.id, this.project,
      { kind: 'service', name }, projectServiceRecordSchema, this.instance);
  }
  /**
   * 入口 / Entry: ProjectServiceScopes.receipt.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.scope(name).receipt()` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectServiceScopes`; this entry produces `this.scope(name).receipt()` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().receipt`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().receipt`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string
   * 输出 / Returns: `this.scope(name).receipt()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  receipt(name: string) { return this.scope(name).receipt(); }
  /**
   * 入口 / Entry: ProjectServiceScopes.hasReceipt.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.scope(name).hasReceipt()` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectServiceScopes`; this entry produces `this.scope(name).hasReceipt()` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().hasReceipt`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().hasReceipt`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string
   * 输出 / Returns: `this.scope(name).hasReceipt()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  hasReceipt(name: string) { return this.scope(name).hasReceipt(); }
  /**
   * 入口 / Entry: ProjectServiceScopes.metadata.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.scope(name).metadata()` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectServiceScopes`; this entry produces `this.scope(name).metadata()` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().metadata`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().metadata`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string
   * 输出 / Returns: `this.scope(name).metadata()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  metadata(name: string) { return this.scope(name).metadata(); }
  /**
   * 入口 / Entry: ProjectServiceScopes.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.scope(name).status(signal)` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectServiceScopes`; this entry produces `this.scope(name).status(signal)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().status`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().status`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string; signal: AbortSignal optional
   * 输出 / Returns: `this.scope(name).status(signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  status(name: string, signal?: AbortSignal) { return this.scope(name).status(signal); }
  /**
   * 入口 / Entry: ProjectServiceScopes.intent.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.scope(service.name).newIntent(projectServiceBinding(this.project, service), bootId)` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectServiceScopes`; this entry produces `this.scope(service.name).newIntent(projectServiceBinding(this.project, service), bootId)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().newIntent`, `this.scope`, `projectServiceBinding` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().newIntent`, `this.scope`, `projectServiceBinding`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: service: ProjectService; bootId: string
   * 输出 / Returns: `this.scope(service.name).newIntent(projectServiceBinding(this.project, service), bootId)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  intent(service: ProjectService, bootId: string) {
    return this.scope(service.name).newIntent(projectServiceBinding(this.project, service), bootId);
  }
  /**
   * 入口 / Entry: ProjectServiceScopes.persistIntent.
   * 功能：在定义项目常驻服务票据和控制器中，校验并提交领域状态变更；本入口产生 `this.scope(record.name).persistIntent(record)` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Validates and commits a domain state change in `ProjectServiceScopes`; this entry produces `this.scope(record.name).persistIntent(record)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().persistIntent`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().persistIntent`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: ProjectServiceRecord
   * 输出 / Returns: `this.scope(record.name).persistIntent(record)`.
   * 副作用 / Effects: `this.scope().persistIntent`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  persistIntent(record: ProjectServiceRecord) { return this.scope(record.name).persistIntent(record); }
  /**
   * 入口 / Entry: ProjectServiceScopes.start.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.scope(record.name).start(record, payload, signal)` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectServiceScopes`; this entry produces `this.scope(record.name).start(record, payload, signal)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().start`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().start`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: ProjectServiceRecord; payload: ProjectScopeInput; signal: AbortSignal
   * 输出 / Returns: `this.scope(record.name).start(record, payload, signal)`.
   * 副作用 / Effects: `this.scope().start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  start(record: ProjectServiceRecord, payload: ProjectScopeInput, signal: AbortSignal) {
    return this.scope(record.name).start(record, payload, signal);
  }
  /**
   * 入口 / Entry: ProjectServiceScopes.stop.
   * 功能：在定义项目常驻服务票据和控制器中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.scope(record.name).stop(record, log)` 供上层消费（`ProjectServiceScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectServiceScopes`; this entry produces `this.scope(record.name).stop(record, log)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.scope().stop`, `this.scope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope().stop`, `this.scope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: ProjectServiceRecord; log: (text: string) => void optional
   * 输出 / Returns: `this.scope(record.name).stop(record, log)`.
   * 副作用 / Effects: `this.scope().stop`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  stop(record: ProjectServiceRecord, log?: (text: string) => void) { return this.scope(record.name).stop(record, log); }
}

export class ProjectMainScope extends ProjectProcessScope<ProjectMainRecord> {
  /**
   * 入口 / Entry: ProjectMainScope.constructor.
   * 功能：建立 ProjectMainScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectMainScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, id: string, project: Project) {
    super(machines, id, project, { kind: 'main' }, projectMainRecordSchema, machines.live.get(id));
  }
  /**
   * 入口 / Entry: ProjectMainScope.intent.
   * 功能：在定义项目常驻服务票据和控制器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.newIntent(projectMainBinding(this.project), bootId)` 供上层消费（`ProjectMainScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectMainScope`; this entry produces `this.newIntent(projectMainBinding(this.project), bootId)` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `this.newIntent`, `projectMainBinding` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.newIntent`, `projectMainBinding`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: bootId: string
   * 输出 / Returns: `this.newIntent(projectMainBinding(this.project), bootId)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  intent(bootId: string) { return this.newIntent(projectMainBinding(this.project), bootId); }
}

/** A separate namespace reuses the proven service UUID domain without reserving user service names. */
export class ProjectBrowserIdeScope extends ProjectProcessScope<ProjectBrowserIdeRecord> {
  /**
   * 入口 / Entry: ProjectBrowserIdeScope.constructor.
   * 功能：建立 ProjectBrowserIdeScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectBrowserIdeScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project; expiresAt: string optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, id: string, project: Project, expiresAt?: string) {
    super(machines, id, project, { kind: 'service', name: 'browser-ide', namespace: 'browser-ide',
      ...(expiresAt ? { deadline: Math.floor(Date.parse(expiresAt) / 1000) } : {}) },
      projectBrowserIdeRecordSchema, machines.live.get(id));
  }
  /**
   * 入口 / Entry: ProjectBrowserIdeScope.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `status` 供上层消费（`ProjectBrowserIdeScope`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectBrowserIdeScope`; this entry produces `status` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `inline.status`, `this.transport`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.status`, `this.transport`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signal: AbortSignal optional; payloadSha256: string optional
   * 输出 / Returns: `status`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `payloadSha256 !== undefined`; `!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256`; 异常 / errors `new AppError('浏览器 IDE 受保护正文与原记录不符', 409, 'BROWSER_IDE_SCOPE_CHANGED')`.
   */
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('浏览器 IDE 受保护正文与原记录不符', 409, 'BROWSER_IDE_SCOPE_CHANGED');
    }
    return status;
  }
}

/** Notebook owns a separate receipt namespace and the complete service UUID domain. */
export class ProjectNotebookScope extends ProjectProcessScope<ProjectNotebookRecord> {
  /**
   * 入口 / Entry: ProjectNotebookScope.constructor.
   * 功能：建立 ProjectNotebookScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectNotebookScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, id: string, project: Project) {
    super(machines, id, project, { kind: 'service', name: 'notebook', namespace: 'notebook' },
      projectNotebookRecordSchema, machines.live.get(id));
  }
  /**
   * 入口 / Entry: ProjectNotebookScope.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `status` 供上层消费（`ProjectNotebookScope`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectNotebookScope`; this entry produces `status` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `inline.status`, `this.transport`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.status`, `this.transport`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signal: AbortSignal optional; payloadSha256: string optional
   * 输出 / Returns: `status`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `payloadSha256 !== undefined`; `!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256`; 异常 / errors `new AppError('Notebook 受保护正文与原记录不符', 409, 'NOTEBOOK_SCOPE_CHANGED')`.
   */
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('Notebook 受保护正文与原记录不符', 409, 'NOTEBOOK_SCOPE_CHANGED');
    }
    return status;
  }
}

/** Reverse tunnels own a separate service receipt and the complete UID broker domain. */
export class ProjectReverseTunnelScope extends ProjectProcessScope<ProjectReverseTunnelRecord> {
  /**
   * 签名 / Signature: ProjectReverseTunnelScope.expiration.
   * 功能：为定义项目常驻服务票据和控制器声明 expiration 的输入与结果契约，所属容器为 ProjectReverseTunnelScope。
   * Purpose: Declares the input/result contract for expiration in ProjectReverseTunnelScope. Module responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: string | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private expiration: () => string | undefined;
  /**
   * 入口 / Entry: ProjectReverseTunnelScope.constructor.
   * 功能：建立 ProjectReverseTunnelScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectReverseTunnelScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project; durationSeconds: number optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.expiration`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, id: string, project: Project, durationSeconds?: number) {
    if (durationSeconds !== undefined) z.number().int().min(10).max(600).parse(durationSeconds);
    let deadline: number | undefined;
    // 慢速准备及 pane 创建结束后才从 commit 开始计时；首次读取固定所有 watchdog 共用的截止时间。
    const target: ScopeTarget = { kind: 'service', name: 'reverse-tunnel', namespace: 'reverse-tunnel',
      /**
       * 入口 / Entry: ProjectReverseTunnelScope.constructor.deadline.
       * 功能：向调用者提供 `durationSeconds === undefined ? undefined : deadline ??= Math.floor(Date.now() / 1000) + durationSeconds` 的当前视图，不复制独立的业务状态。
       * Purpose: Exposes the current `durationSeconds === undefined ? undefined : deadline ??= Math.floor(Date.now() / 1000) + durationSeconds` view rather than creating separate domain state.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `durationSeconds === undefined ? undefined : deadline ??= Math.floor(Date.now() / 1000) + durationSeconds`.
       * 副作用 / Effects: 更新 / updates `deadline`.
       */
      get deadline() { return durationSeconds === undefined ? undefined : deadline ??= Math.floor(Date.now() / 1000) + durationSeconds; } };
    super(machines, id, project, target, projectReverseTunnelRecordSchema, machines.live.get(id));
    /**
     * 入口 / Entry: ProjectReverseTunnelScope.constructor.this.expiration.
     * 功能：从当前输入或状态计算 `deadline === undefined ? undefined : new Date(deadline * 1000).toISOString()`，供调用方后续验证或使用。
     * Purpose: Computes `deadline === undefined ? undefined : new Date(deadline * 1000).toISOString()` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `deadline === undefined ? undefined : new Date(deadline * 1000).toISOString()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    this.expiration = () => deadline === undefined ? undefined : new Date(deadline * 1000).toISOString();
  }
  /**
   * 入口 / Entry: ProjectReverseTunnelScope.expiresAt.
   * 功能：把本层请求转交 `this.expiration`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.expiration` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.expiration()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  expiresAt() { return this.expiration(); }
  /**
   * 入口 / Entry: ProjectReverseTunnelScope.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `status` 供上层消费（`ProjectReverseTunnelScope`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectReverseTunnelScope`; this entry produces `status` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `inline.status`, `this.transport`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.status`, `this.transport`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signal: AbortSignal optional; payloadSha256: string optional
   * 输出 / Returns: `status`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `payloadSha256 !== undefined`; `!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256`; 异常 / errors `new AppError('临时隧道受保护正文与原记录不符', 409, 'SERVICE_SCOPE_CHANGED')`.
   */
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('临时隧道受保护正文与原记录不符', 409, 'SERVICE_SCOPE_CHANGED');
    }
    return status;
  }
}

/** A mesh run owns a separate receipt without reserving a user service name. */
export class ProjectMeshScope extends ProjectProcessScope<ProjectMeshRecord> {
  /**
   * 入口 / Entry: ProjectMeshScope.constructor.
   * 功能：建立 ProjectMeshScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectMeshScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, id: string, project: Project) {
    super(machines, id, project, { kind: 'service', name: 'mesh', namespace: 'mesh' },
      projectMeshRecordSchema, machines.live.get(id));
  }
  /**
   * 入口 / Entry: ProjectMeshScope.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `status` 供上层消费（`ProjectMeshScope`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectMeshScope`; this entry produces `status` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `inline.status`, `this.transport`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.status`, `this.transport`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signal: AbortSignal optional; payloadSha256: string optional
   * 输出 / Returns: `status`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `payloadSha256 !== undefined`; `!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256`; 异常 / errors `new AppError('服务网格受保护正文与原记录不符', 409, 'SERVICE_SCOPE_CHANGED')`.
   */
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('服务网格受保护正文与原记录不符', 409, 'SERVICE_SCOPE_CHANGED');
    }
    return status;
  }
}

/** Desktop owns one complete service domain in a namespace separate from user services. */
export class ProjectDesktopScope extends ProjectProcessScope<ProjectDesktopRecord> {
  /**
   * 入口 / Entry: ProjectDesktopScope.constructor.
   * 功能：建立 ProjectDesktopScope 的定义项目常驻服务票据和控制器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectDesktopScope context for this module's responsibility: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; id: string; project: Project
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, id: string, project: Project) {
    super(machines, id, project, { kind: 'service', name: 'desktop', namespace: 'desktop' },
      projectDesktopRecordSchema, machines.live.get(id));
  }
  /**
   * 入口 / Entry: ProjectDesktopScope.status.
   * 功能：在定义项目常驻服务票据和控制器中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `status` 供上层消费（`ProjectDesktopScope`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectDesktopScope`; this entry produces `status` for its caller. Module context: Defines persistent service tickets/controllers; startup intent is durable before effects and stopping verifies complete original scope.
   * 处理：通过 `inline.status`, `this.transport`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.status`, `this.transport`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signal: AbortSignal optional; payloadSha256: string optional
   * 输出 / Returns: `status`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `payloadSha256 !== undefined`; `!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256`; 异常 / errors `new AppError('Desktop 受保护正文与原记录不符', 409, 'DESKTOP_SCOPE_CHANGED')`.
   */
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('Desktop 受保护正文与原记录不符', 409, 'DESKTOP_SCOPE_CHANGED');
    }
    return status;
  }
}
import { ProjectSessionLifetime } from './project-session-lifetime.ts';
