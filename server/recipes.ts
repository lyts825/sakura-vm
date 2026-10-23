/**
 * 模块职责：导出和应用项目配方，变更前要求项目任务已经结束。
 * Module purpose: Exports/applies project recipes after running project tasks have completed.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import { posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createSchema } from '../shared/contracts/vm.ts';
import { AppError } from '../shared/errors.ts';
import { projectSchema } from './project-config.ts';
import type { RecipeChange, RecipePlan } from '../shared/contracts/recipe-plan.ts';
import { recipeApplyPlanRequestSchema } from '../shared/contracts/recipe-plan.ts';
import { vmLifetime } from './vm-lifetime.ts';

import type { VmAccess as Machines } from './vm-access.ts';

export const recipeSchema = z
  .object({
    version: z.literal(1),
    resources: z
      .object({
        cpus: createSchema.shape.cpus,
        memoryMiB: createSchema.shape.memoryMiB,
        diskGiB: createSchema.shape.diskGiB,
        accelerator: createSchema.shape.accelerator,
        distro: createSchema.shape.distro,
        template: createSchema.shape.template,
        forwards: createSchema.shape.forwards,
      })
      .strict()
      .partial()
      .default({}),
    project: projectSchema,
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;
type SavedPlan = { result: RecipePlan; recipe: Recipe; sourceVersion: string; binding: string };

/** 递归排序对象，保留数组顺序。 Sort object keys recursively while preserving array order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value ?? null);
}
/** 摘要只证明配置内容相同，不代表安装状态。 Hash configuration content, never installed state. */
function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }

/** 显示差异并避免在预览中重复公开环境变量值。 Present differences without echoing environment values. */
function display(field: string, value: unknown) {
  if (value === undefined) return '未声明';
  if (['project.environment', 'project.secrets', 'project.services'].includes(field))
    return '配置摘要 ' + digest(value).slice(0, 16);
  return canonical(value);
}
export class Recipes {
  private plans = new Map<string, SavedPlan>();
  /**
   * 入口 / Entry: Recipes.constructor.
   * 功能：建立 Recipes 的导出和应用项目配方上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Recipes context for this module's responsibility: Exports/applies project recipes after running project tasks have completed. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
  ) {}
  /** 绑定实例代次、项目和全部资源配置。 Bind VM generation, project and all resource settings. */
  private binding(id: string) {
    const vm = this.machines.get(id);
    const live = this.machines.live.get(id);
    return digest({ vm, projectId: this.workspaces.projects.current(id), state: this.machines.state(id),
      lifetime: live ? vmLifetime(id, live).capture() : null });
  }

  /** 对比声明字段并生成限时单次令牌；不连接客户机。 Compare declarations and issue a short-lived token without guest I/O. */
  async preview(id: string, input: unknown): Promise<RecipePlan> {
    const recipe = recipeSchema.parse(input);
    const binding = this.binding(id), current = await this.workspaces.view(id);
    const vm = this.machines.get(id);
    if (binding !== this.binding(id)) throw new AppError('环境已变化，请重新预览', 409, 'RECIPE_PLAN_STALE');
    const changes: RecipeChange[] = [];
    /** 仅为实际差异创建一行。 Add one row only for an actual difference. */
    const add = (field: string, before: unknown, after: unknown, disposition: RecipeChange['disposition'], reason: string) => {
      if (canonical(before) !== canonical(after)) changes.push({ field, before: display(field, before),
        after: display(field, after), disposition, reason });
    };
    for (const [key, after] of Object.entries(recipe.resources)) {
      if (after === undefined) continue;
      const before = vm[key as keyof Recipe['resources']];
      let disposition: RecipeChange['disposition'] = 'stop-required';
      let reason = '请在实例资源面板修改；硬件变更需要停机后执行，再重新预览。';
      if (key === 'distro' || key === 'template') {
        disposition = 'rebuild-required'; reason = '请使用“从 sakura.json 创建环境”新建实例；本操作不更换现有磁盘镜像。';
      } else if (key === 'forwards') {
        disposition = 'separate-operation'; reason = '请在端口转发面板核对占用并修改，再重新预览。';
      } else if (key === 'diskGiB') {
        disposition = Number(after) < Number(before) ? 'unsupported' : 'stop-required';
        reason = disposition === 'unsupported' ? '现有磁盘不支持缩容。请创建新实例并迁移数据。' :
          '请在实例资源面板停机扩容，并完成客户机文件系统扩容，再重新预览。';
      }
      add('resources.' + key, before, after, disposition, reason);
    }
    for (const key of new Set([...Object.keys(current.project), ...Object.keys(recipe.project)])) {
      if (key === '_workspace') continue;
      if (key === 'runtimes') {
        for (const tool of ['node', 'python'] as const) add('project.runtimes.' + tool,
          current.project.runtimes?.[tool], recipe.project.runtimes?.[tool], 'apply',
          '保存版本声明；请在“运行时版本”面板安装并探测实际版本。此处不安装运行时。');
      } else {
        add('project.' + key, current.project[key as keyof typeof current.project],
          recipe.project[key as keyof typeof recipe.project], key === 'directory' ? 'separate-operation' : 'apply',
          key === 'directory' ? '请在项目配置中完成目录迁移，再重新预览。' :
            '保存项目配置；相关服务可能停止，环境准备和服务启动由现有项目操作执行。');
      }
    }
    const now = Date.now();
    for (const [token, plan] of this.plans) if (Date.parse(plan.result.expiresAt) <= now) this.plans.delete(token);
    while (this.plans.size >= 128) this.plans.delete(this.plans.keys().next().value!);
    const result: RecipePlan = { token: randomUUID(), expiresAt: new Date(now + 600_000).toISOString(),
      vmId: id, projectId: current.projectId, inputSha256: digest(recipe),
      configurationSha256: digest(current.project),
      resourceDeclarationSha256: digest({ distro: vm.distro, template: vm.template, resources: recipe.resources }),
      canApply: changes.every(change => change.disposition === 'apply') && current.job?.status !== 'running',
      unchanged: changes.length === 0, changes,
      runtimeVerification: 'not-probed', dependencyVerification: 'not-probed', imageVerification: 'not-probed',
      warnings: ['摘要仅覆盖配置声明，不包含镜像文件、依赖锁文件或实际安装结果。',
        '保存配置后，请按需准备环境，展开“核对实际 Node/Python 运行时”，并按需执行工程任务的环境锁校验。',
        ...(current.job?.status === 'running' ? ['项目任务正在运行，结束后请重新预览。'] : [])] };
    this.plans.set(result.token, { result, recipe, sourceVersion: current.version, binding });
    return result;
  }

  /** 消费预览令牌，复核版本后保存；失败需重新预览。 Consume the token and save after CAS checks; failures require a new preview. */
  async applyPlan(id: string, input: unknown) {
    const { token } = recipeApplyPlanRequestSchema.parse(input), plan = this.plans.get(token);
    if (!plan || plan.result.vmId !== id || Date.parse(plan.result.expiresAt) <= Date.now())
      throw new AppError('预览已失效，请重新预览', 409, 'RECIPE_PLAN_STALE');
    this.plans.delete(token);
    /** 在锁内和提交前检查实例、项目及资源。 Recheck VM, project and resources inside the lock and before commit. */
    const guard = () => {
      if (plan.binding !== this.binding(id) || plan.result.projectId !== this.workspaces.projects.current(id))
        throw new AppError('环境已变化，请重新预览', 409, 'RECIPE_PLAN_STALE');
    };
    guard();
    const current = await this.workspaces.view(id);
    guard();
    if (current.version !== plan.sourceVersion)
      throw new AppError('项目配置已变化，请重新预览', 409, 'RECIPE_PLAN_STALE');
    if (!plan.result.canApply) throw new AppError('请先处理预览中的独立操作，再重新预览', 409, 'RECIPE_PLAN_BLOCKED');
    if (plan.result.unchanged) return current;
    await this.workspaces.save(id, plan.recipe.project, undefined, plan.sourceVersion, guard);
    return this.workspaces.view(id);
  }
  /**
   * 入口 / Entry: Recipes.export.
   * 功能：在导出和应用项目配方中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ version: 1, resources: { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template }, project: await this.workspace…` 供上层消费（`Recipes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Recipes`; this entry produces `{ version: 1, resources: { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template }, project: await this.workspace…` for its caller. Module context: Exports/applies project recipes after running project tasks have completed.
   * 处理：通过 `this.machines.get`, `this.workspaces.config` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.workspaces.config`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Recipe>；结果来自 / values from `{ version: 1, resources: { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template }, project: await this.workspace…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async export(id: string): Promise<Recipe> {
    const { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template } = this.machines.get(id);
    return {
      version: 1,
      resources: { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template },
      project: await this.workspaces.config(id),
    };
  }
  /**
   * 入口 / Entry: Recipes.read.
   * 功能：在导出和应用项目配方中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `recipeSchema.parse( JSON.parse(await this.machines.readGuestFile(id, posix.join(project.directory, 'sakura.json'))), )` 供上层消费（`Recipes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Recipes`; this entry produces `recipeSchema.parse( JSON.parse(await this.machines.readGuestFile(id, posix.join(project.directory, 'sakura.json'))), )` for its caller. Module context: Exports/applies project recipes after running project tasks have completed.
   * 处理：通过 `this.workspaces.config`, `recipeSchema.parse`, `this.machines.readGuestFile`, `posix.join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.config`, `recipeSchema.parse`, `this.machines.readGuestFile`, `posix.join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `recipeSchema.parse( JSON.parse(await this.machines.readGuestFile(id, posix.join(project.directory, 'sakura.json'))), )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async read(id: string) {
    const project = await this.workspaces.config(id);
    return recipeSchema.parse(
      JSON.parse(await this.machines.readGuestFile(id, posix.join(project.directory, 'sakura.json'))),
    );
  }
  /**
   * 入口 / Entry: Recipes.write.
   * 功能：在导出和应用项目配方中，校验并提交领域状态变更；本入口产生 `recipe` 供上层消费（`Recipes`）。
   * Purpose: Validates and commits a domain state change in `Recipes`; this entry produces `recipe` for its caller. Module context: Exports/applies project recipes after running project tasks have completed.
   * 处理：通过 `this.export`, `this.machines.writeGuestFile`, `posix.join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.export`, `this.machines.writeGuestFile`, `posix.join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `recipe`.
   * 副作用 / Effects: `this.machines.writeGuestFile`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async write(id: string) {
    const recipe = await this.export(id);
    await this.machines.writeGuestFile(
      id,
      posix.join(recipe.project.directory, 'sakura.json'),
      JSON.stringify(recipe, null, 2) + '\n',
      false,
    );
    return recipe;
  }
  /**
   * 入口 / Entry: Recipes.create.
   * 功能：在导出和应用项目配方中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.view(vm.id)` 供上层消费（`Recipes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Recipes`; this entry produces `this.machines.view(vm.id)` for its caller. Module context: Exports/applies project recipes after running project tasks have completed.
   * 处理：通过 `recipeSchema.parse`, `this.machines.create`, `this.workspaces.save`, `this.machines.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `recipeSchema.parse`, `this.machines.create`, `this.workspaces.save`, `this.machines.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string; value: unknown
   * 输出 / Returns: `this.machines.view(vm.id)`.
   * 副作用 / Effects: `this.machines.create`; `this.workspaces.save`; `this.machines.delete`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `await this.machines.delete(vm.id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.machines.delete(vm.id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async create(name: string, value: unknown) {
    const recipe = recipeSchema.parse(value);
    const vm = await this.machines.create({ ...recipe.resources, name });
    try {
      await this.workspaces.save(vm.id, recipe.project);
    } catch (error) {
      await this.machines.delete(vm.id);
      throw error;
    }
    return this.machines.view(vm.id);
  }
  /**
   * 入口 / Entry: Recipes.apply.
   * 功能：在导出和应用项目配方中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces.view(id)` 供上层消费（`Recipes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Recipes`; this entry produces `this.workspaces.view(id)` for its caller. Module context: Exports/applies project recipes after running project tasks have completed.
   * 处理：通过 `recipeSchema.parse`, `this.machines.get`, `this.workspaces.jobs.view`, `this.workspaces.save` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `recipeSchema.parse`, `this.machines.get`, `this.workspaces.jobs.view`, `this.workspaces.save`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.workspaces.view(id)`.
   * 副作用 / Effects: `this.workspaces.save`.
   * 拒绝 / Refusals: 条件 / conditions `this.workspaces.jobs.view(id)?.status === 'running'`; 异常 / errors `new AppError('请等待项目任务完成', 409)`.
   */
  async apply(id: string, input: unknown) {
    const recipe = recipeSchema.parse(input);
    const vm = this.machines.get(id);
    // Applying to an existing workspace changes project commands only. Disk and
    // running machine settings remain explicit operations in the resource panel.
    if (this.workspaces.jobs.view(id)?.status === 'running') throw new AppError('请等待项目任务完成', 409);
    await this.workspaces.save(vm.id, recipe.project);
    return this.workspaces.view(id);
  }
}
