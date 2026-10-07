/**
 * 模块职责：管理实例项目索引与当前项目上下文，通过已提交目录读取和更新项目元数据。
 * Module purpose: Owns VM project indexes and active context, reading/updating project metadata through committed catalogue state.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { readStore, readCommittedStore, writeStore } from './local-store.ts';

export const projectIdSchema = z.string().regex(/^(default|[a-f0-9]{16})$/);
export const projectIndexSchema = z
  .object({
    active: projectIdSchema,
    projects: z
      .array(z.object({ id: projectIdSchema, name: z.string().trim().min(1).max(64) }).strict())
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.projects.map((p) => p.id)).size === v.projects.length &&
      v.projects.some((p) => p.id === v.active) &&
      v.projects.some((p) => p.id === 'default'),
    '项目目录损坏',
  );
export class ProjectCatalog {
  private context = new AsyncLocalStorage<{ vmId: string; projectId: string }>();
  /**
   * 入口 / Entry: ProjectCatalog.constructor.
   * 功能：建立 ProjectCatalog 的管理实例项目索引与当前项目上下文上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectCatalog context for this module's responsibility: Owns VM project indexes and active context, reading/updating project metadata through committed catalogue state. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines) {}
  /**
   * 入口 / Entry: ProjectCatalog.current.
   * 功能：从当前输入或状态计算 `value?.vmId === id ? value.projectId : 'default'`，供调用方后续验证或使用。
   * Purpose: Computes `value?.vmId === id ? value.projectId : 'default'` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `value?.vmId === id ? value.projectId : 'default'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  current(id: string) {
    const value = this.context.getStore();
    return value?.vmId === id ? value.projectId : 'default';
  }
  /**
   * 入口 / Entry: ProjectCatalog.key.
   * 功能：从当前输入或状态计算 `project === 'default' ? id : `${id}:${project}``，供调用方后续验证或使用。
   * Purpose: Computes `project === 'default' ? id : `${id}:${project}`` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `project === 'default' ? id : `${id}:${project}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  key(id: string) {
    const project = this.current(id);
    return project === 'default' ? id : `${id}:${project}`;
  }
  /**
   * 入口 / Entry: ProjectCatalog.list.
   * 功能：在管理实例项目索引与当前项目上下文中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `projectIndexSchema.parse( await readStore(join(vmDir(id), 'projects.json'), () => ({ active: 'default', projects: [{ id: 'def…` 供上层消费（`ProjectCatalog`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectCatalog`; this entry produces `projectIndexSchema.parse( await readStore(join(vmDir(id), 'projects.json'), () => ({ active: 'default', projects: [{ id: 'def…` for its caller. Module context: Owns VM project indexes and active context, reading/updating project metadata through committed catalogue state.
   * 处理：通过 `this.machines.get`, `projectIndexSchema.parse`, `readStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `projectIndexSchema.parse`, `readStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `projectIndexSchema.parse( await readStore(join(vmDir(id), 'projects.json'), () => ({ active: 'default', projects: [{ id: 'def…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(id: string) {
    this.machines.get(id);
    return projectIndexSchema.parse(
      await readStore(join(vmDir(id), 'projects.json'), () => ({
        active: 'default',
        projects: [{ id: 'default', name: '默认项目' }],
      })),
    );
  }
  /** Admission checkpoints may hold a metadata writer; observe its last committed publication without queueing. */
  /**
   * 入口 / Entry: ProjectCatalog.readCommittedList.
   * 功能：在管理实例项目索引与当前项目上下文中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `projectIndexSchema.parse(await readCommittedStore(join(vmDir(id), 'projects.json'), () => ({ active: 'default', projects: [{ …` 供上层消费（`ProjectCatalog`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectCatalog`; this entry produces `projectIndexSchema.parse(await readCommittedStore(join(vmDir(id), 'projects.json'), () => ({ active: 'default', projects: [{ …` for its caller. Module context: Owns VM project indexes and active context, reading/updating project metadata through committed catalogue state.
   * 处理：通过 `this.machines.get`, `projectIndexSchema.parse`, `readCommittedStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `projectIndexSchema.parse`, `readCommittedStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `projectIndexSchema.parse(await readCommittedStore(join(vmDir(id), 'projects.json'), () => ({ active: 'default', projects: [{ …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async readCommittedList(id: string) {
    this.machines.get(id);
    return projectIndexSchema.parse(await readCommittedStore(join(vmDir(id), 'projects.json'), () => ({
      active: 'default', projects: [{ id: 'default', name: '默认项目' }],
    })));
  }
  /**
   * 入口 / Entry: ProjectCatalog.with.
   * 功能：在管理实例项目索引与当前项目上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.inScope(id, projectId, action)` 供上层消费（`ProjectCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCatalog`; this entry produces `this.inScope(id, projectId, action)` for its caller. Module context: Owns VM project indexes and active context, reading/updating project metadata through committed catalogue state.
   * 处理：通过 `this.list`, `projectIdSchema.parse`, `index.projects.some`, `this.inScope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.list`, `projectIdSchema.parse`, `index.projects.some`, `this.inScope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; requested: string | null | undefined; action: () => Promise<T>
   * 输出 / Returns: `this.inScope(id, projectId, action)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!index.projects.some((p) => p.id === projectId)`; 异常 / errors `new AppError('项目不存在', 404)`.
   */
  async with<T>(id: string, requested: string | null | undefined, action: () => Promise<T>) {
    const index = await this.list(id),
      projectId = projectIdSchema.parse(requested || index.active);
    if (!index.projects.some((p) => p.id === projectId)) throw new AppError('项目不存在', 404);
    return this.inScope(id, projectId, action);
  }
  /**
   * 入口 / Entry: ProjectCatalog.inScope.
   * 功能：把本层请求转交 `this.context.run`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.context.run` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; projectId: string; action: () => T
   * 输出 / Returns: `this.context.run({ vmId: id, projectId }, action)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  inScope<T>(id: string, projectId: string, action: () => T) {
    return this.context.run({ vmId: id, projectId }, action);
  }
  /**
   * 入口 / Entry: ProjectCatalog.create.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; name: string; initialize: () => Promise<void>
   * 输出 / Returns: `this.machines.locked(`catalog:${id}`, async () => { const index = await this.list(id); if (index.projects.length >= 20) throw…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async create(id: string, name: string, initialize: () => Promise<void>) {
    /**
     * 入口 / Entry: ProjectCatalog.create.callback@68.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `index`.
     * 副作用 / Effects: `rm`; `index.projects.push`; `writeStore`; 更新 / updates `name`, `index.active`.
     * 拒绝 / Refusals: 条件 / conditions `index.projects.length >= 20`; `index.projects.some((p) => p.name === name)`; 异常 / errors `new AppError('每个实例最多 20 个项目')`; `new AppError('项目名称已存在', 409)`.
     * 失败处理：catch 分支执行 `await rm(join(vmDir(id), `project-${projectId}.json`), { force: true });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `await rm(join(vmDir(id), `project-${projectId}.json`), { force: true });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.machines.locked(`catalog:${id}`, async () => {
      const index = await this.list(id);
      if (index.projects.length >= 20) throw new AppError('每个实例最多 20 个项目');
      name = z.string().trim().min(1).max(64).parse(name);
      if (index.projects.some((p) => p.name === name)) throw new AppError('项目名称已存在', 409);
      const projectId = randomBytes(8).toString('hex');
      try {
        await this.inScope(id, projectId, initialize);
      } catch (error) {
        await rm(join(vmDir(id), `project-${projectId}.json`), { force: true });
        throw error;
      }
      index.projects.push({ id: projectId, name });
      index.active = projectId;
      await writeStore(join(vmDir(id), 'projects.json'), index);
      return index;
    });
  }
  /**
   * 入口 / Entry: ProjectCatalog.update.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; project: string; name: string optional
   * 输出 / Returns: `this.machines.locked(`catalog:${id}`, async () => { const index = await this.list(id), entry = index.projects.find((p) => p.i…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async update(id: string, project: string, name?: string) {
    /**
     * 入口 / Entry: ProjectCatalog.update.callback@87.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `index`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `name`, `entry.name`, `index.active`.
     * 拒绝 / Refusals: 条件 / conditions `!entry`; `name !== undefined`; `index.projects.some((p) => p.id !== project && p.name === name)`; 异常 / errors `new AppError('项目不存在', 404)`; `new AppError('项目名称已存在', 409)`.
     */
    return this.machines.locked(`catalog:${id}`, async () => {
      const index = await this.list(id),
        entry = index.projects.find((p) => p.id === projectIdSchema.parse(project));
      if (!entry) throw new AppError('项目不存在', 404);
      if (name !== undefined) {
        name = z.string().trim().min(1).max(64).parse(name);
        if (index.projects.some((p) => p.id !== project && p.name === name))
          throw new AppError('项目名称已存在', 409);
        entry.name = name;
      } else index.active = project;
      await writeStore(join(vmDir(id), 'projects.json'), index);
      return index;
    });
  }
}
/** Host domain storage adapter. Public project services expose identities, never filesystem paths. */
/**
 * 入口 / Entry: projectMetadataFile.
 * 功能：在管理实例项目索引与当前项目上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), `${name}${project === 'default' ? '' : '-' + project}.json`)` 供上层消费（`project-catalog.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-catalog.ts`; this entry produces `join(vmDir(id), `${name}${project === 'default' ? '' : '-' + project}.json`)` for its caller. Module context: Owns VM project indexes and active context, reading/updating project metadata through committed catalogue state.
 * 处理：通过 `projectIdSchema.parse`, `inline.test`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `inline.test`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; project: string; name: default='project'
 * 输出 / Returns: `join(vmDir(id), `${name}${project === 'default' ? '' : '-' + project}.json`)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!/^[a-z][a-z0-9-]{0,63}$/.test(name)`; 异常 / errors `new AppError('项目元数据类型无效', 400)`.
 */
export function projectMetadataFile(id: string, project: string, name = 'project') {
  projectIdSchema.parse(project);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new AppError('项目元数据类型无效', 400);
  return join(vmDir(id), `${name}${project === 'default' ? '' : '-' + project}.json`);
}
