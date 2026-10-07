/**
 * 模块职责：导出和应用项目配方，变更前要求项目任务已经结束。
 * Module purpose: Exports/applies project recipes after running project tasks have completed.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import { posix } from 'node:path';
import { createSchema } from '../shared/contracts/vm.ts';
import { AppError } from '../shared/errors.ts';
import { projectSchema } from './project-config.ts';

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
export class Recipes {
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
