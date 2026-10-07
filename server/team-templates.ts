/**
 * 模块职责：管理团队项目模板的导入和应用，校验内容及目录条目唯一性。
 * Module purpose: Imports/applies team project templates after checking content integrity and unique index entries.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { createSchema } from '../shared/contracts/vm.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectSchema } from './project-config.ts';

import type { VmAccess as Machines } from './vm-access.ts';

const resourceSchema = z.object({
  cpus: createSchema.shape.cpus,
  memoryMiB: createSchema.shape.memoryMiB,
  diskGiB: createSchema.shape.diskGiB,
  accelerator: createSchema.shape.accelerator,
  distro: z.enum(['alpine', 'debian', 'ubuntu']).default('alpine'),
  architecture: z.enum(['x86_64', 'aarch64']).optional(),
  firmware: z.enum(['bios', 'uefi']).default('bios'),
  template: z.enum(['none', 'node', 'python', 'rust']).default('none'),
}).strict();
const projectBlueprint = z.object({
  directory: z.literal('/workspace'),
  template: projectSchema.shape.template,
  repository: projectSchema.shape.repository,
  previewPort: projectSchema.shape.previewPort,
  networkIsolation: projectSchema.shape.networkIsolation,
  runtimes: projectSchema.shape.runtimes,
}).strict();
const contentSchema = z.object({ resources: resourceSchema, project: projectBlueprint }).strict();
type Content = z.infer<typeof contentSchema>;
const itemSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(64),
  version: z.number().int().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  content: contentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), templates: z.array(itemSchema).max(40) }).strict();
type State = z.infer<typeof stateSchema>;

export const teamTemplateInput = z.object({
  mode: z.enum(['list', 'capture', 'inspect', 'create', 'delete']).default('list'),
  name: z.string().trim().min(1).max(64).optional(),
  templateId: z.uuid().optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  previousFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  targetName: createSchema.shape.name.optional(),
}).strict();

/**
 * 入口 / Entry: digest.
 * 功能：在管理团队项目模板的导入和应用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(content)).digest('hex')` 供上层消费（`team-templates.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `team-templates.ts`; this entry produces `createHash('sha256').update(JSON.stringify(content)).digest('hex')` for its caller. Module context: Imports/applies team project templates after checking content integrity and unique index entries.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: content: Content
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(content)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (content: Content) => createHash('sha256').update(JSON.stringify(content)).digest('hex');
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1, templates: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, templates: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: State；结果来自 / values from `({ version: 1, templates: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): State => ({ version: 1, templates: [] });

/** A host catalog of reviewed, portable VM/project blueprints. */
export class TeamTemplates {
  /**
   * 入口 / Entry: TeamTemplates.constructor.
   * 功能：建立 TeamTemplates 的管理团队项目模板的导入和应用上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the TeamTemplates context for this module's responsibility: Imports/applies team project templates after checking content integrity and unique index entries. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; file: default=join(DATA, 'team-templates.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private file = join(DATA, 'team-templates.json'),
  ) {}

  /**
   * 入口 / Entry: TeamTemplates.state.
   * 功能：在管理团队项目模板的导入和应用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `state` 供上层消费（`TeamTemplates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TeamTemplates`; this entry produces `state` for its caller. Module context: Imports/applies team project templates after checking content integrity and unique index entries.
   * 处理：通过 `stateSchema.parse`, `readStore`, `digest`, `state.templates.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `digest`, `state.templates.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `state`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `item.fingerprint !== digest(item.content)`; `new Set(state.templates.map((item) => item.id)).size !== state.templates.length || new Set(state.templates.map((item) => item…`; 异常 / errors `new AppError('团队模板内容校验失败：' + item.id, 409)`; `new AppError('团队模板目录包含重复条目', 409)`.
   */
  private async state() {
    const state = stateSchema.parse(await readStore(this.file, defaults));
    for (const item of state.templates)
      if (item.fingerprint !== digest(item.content))
        throw new AppError('团队模板内容校验失败：' + item.id, 409);
    if (new Set(state.templates.map((item) => item.id)).size !== state.templates.length ||
        new Set(state.templates.map((item) => item.name)).size !== state.templates.length)
      throw new AppError('团队模板目录包含重复条目', 409);
    return state;
  }

  /**
   * 入口 / Entry: TeamTemplates.draft.
   * 功能：在管理团队项目模板的导入和应用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `contentSchema.parse({ resources: { cpus: vm.cpus, memoryMiB: vm.memoryMiB, diskGiB: vm.diskGiB, accelerator: vm.accelerator, …` 供上层消费（`TeamTemplates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TeamTemplates`; this entry produces `contentSchema.parse({ resources: { cpus: vm.cpus, memoryMiB: vm.memoryMiB, diskGiB: vm.diskGiB, accelerator: vm.accelerator, …` for its caller. Module context: Imports/applies team project templates after checking content integrity and unique index entries.
   * 处理：通过 `this.machines.get`, `this.workspaces.config`, `contentSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.workspaces.config`, `contentSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `project.repository`; `url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Content>；结果来自 / values from `contentSchema.parse({ resources: { cpus: vm.cpus, memoryMiB: vm.memoryMiB, diskGiB: vm.diskGiB, accelerator: vm.accelerator, …`.
   * 副作用 / Effects: 更新 / updates `repository`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async draft(id: string): Promise<Content> {
    const vm = this.machines.get(id);
    const project = await this.workspaces.config(id);
    let repository = '';
    if (project.repository) {
      const url = new URL(project.repository);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash)
        repository = project.repository;
    }
    return contentSchema.parse({
      resources: {
        cpus: vm.cpus, memoryMiB: vm.memoryMiB, diskGiB: vm.diskGiB,
        accelerator: vm.accelerator, distro: vm.distro || 'alpine',
        architecture: vm.architecture,
        firmware: vm.firmware || 'bios', template: project.template,
      },
      project: {
        directory: '/workspace', template: project.template, repository,
        previewPort: project.previewPort, networkIsolation: project.networkIsolation,
        runtimes: project.runtimes,
      },
    });
  }

  /**
   * 入口 / Entry: TeamTemplates.item.
   * 功能：在管理团队项目模板的导入和应用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `item` 供上层消费（`TeamTemplates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TeamTemplates`; this entry produces `item` for its caller. Module context: Imports/applies team project templates after checking content integrity and unique index entries.
   * 处理：通过 `state.templates.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `state.templates.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: state: State; id: string optional
   * 输出 / Returns: `item`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!item`; 异常 / errors `new AppError('团队模板不存在', 404)`.
   */
  private item(state: State, id?: string) {
    const item = state.templates.find((entry) => entry.id === id);
    if (!item) throw new AppError('团队模板不存在', 404);
    return item;
  }

  /**
   * 入口 / Entry: TeamTemplates.action.
   * 功能：在管理团队项目模板的导入和应用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: false, templates: state.templates.map( ({ content: _, ...metadata }) => metadata) }` / `{ ready: true, executed: false, name: templateName, fingerprint, previousFingerprint: existing?.fingerprint, content, exclude…` 供上层消费（`TeamTemplates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TeamTemplates`; this entry produces `{ ready: true, executed: false, templates: state.templates.map( ({ content: _, ...metadata }) => metadata) }` / `{ ready: true, executed: false, name: templateName, fingerprint, previousFingerprint: existing?.fingerprint, content, exclude…` for its caller. Module context: Imports/applies team project templates after checking content integrity and unique index entries.
   * 处理：通过 `teamTemplateInput.parse`, `this.machines.get`, `this.state`, `state.templates.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `teamTemplateInput.parse`, `this.machines.get`, `this.state`, `state.templates.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.mode === 'list'`; `action === 'check'`; `action === 'check' || value.mode === 'inspect'`.
   * 输入 / Inputs: id: string; input: unknown; action: 'check' | 'run'
   * 输出 / Returns: `{ ready: true, executed: false, templates: state.templates.map( ({ content: _, ...metadata }) => metadata) }`; `{ ready: true, executed: false, name: templateName, fingerprint, previousFingerprint: existing?.fingerprint, content, exclude…`; `this.machines.locked('team-templates', async () => { const state = await this.state(); const existing = value.templateId ? th…`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `value.mode === 'capture'`; `!value.name`; `value.fingerprint !== fingerprint`; 异常 / errors `new AppError('保存模板需要名称')`; `new AppError('来源项目或资源已变化，请重新预览模板', 409)`.
   */
  async action(id: string, input: unknown, action: 'check' | 'run') {
    const value = teamTemplateInput.parse(input);
    this.machines.get(id);
    if (value.mode === 'list') {
      const state = await this.state();
      return { ready: true, executed: false, templates: state.templates.map(
        ({ content: _, ...metadata }) => metadata) };
    }
    if (value.mode === 'capture') {
      if (!value.name) throw new AppError('保存模板需要名称');
      const templateName = value.name;
      const content = await this.draft(id);
      const fingerprint = digest(content);
      if (action === 'check') {
        const existing = value.templateId ? this.item(await this.state(), value.templateId) : undefined;
        return { ready: true, executed: false, name: templateName, fingerprint,
          previousFingerprint: existing?.fingerprint, content,
          excluded: ['环境变量', '私密配置', '服务命令', '安装命令', '启动命令', '端口转发'] };
      }
      if (value.fingerprint !== fingerprint)
        throw new AppError('来源项目或资源已变化，请重新预览模板', 409);
      /**
       * 入口 / Entry: TeamTemplates.action.callback@130.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked / team-templates）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked / team-templates).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ready: true, executed: false, unchanged: true, template: existing }`; `{ ready: true, executed: true, template: saved }`.
       * 副作用 / Effects: `state.templates.push`; `writeStore`; 更新 / updates `state.templates[state.templates.indexOf(existing)]`.
       * 拒绝 / Refusals: 条件 / conditions `existing && existing.fingerprint !== value.previousFingerprint`; `existing && existing.name !== templateName`; `state.templates.some((item) => item.name === templateName && item !== existing)`; 异常 / errors `new AppError('团队模板已更新，请重新预览', 409)`; `new AppError('更新模板时名称必须保持不变', 409)`.
       */
      return this.machines.locked('team-templates', async () => {
        const state = await this.state();
        const existing = value.templateId ? this.item(state, value.templateId) : undefined;
        if (existing && existing.fingerprint !== value.previousFingerprint)
          throw new AppError('团队模板已更新，请重新预览', 409);
        if (existing && existing.name !== templateName)
          throw new AppError('更新模板时名称必须保持不变', 409);
        if (state.templates.some((item) => item.name === templateName && item !== existing))
          throw new AppError('同名团队模板已存在', 409);
        if (!existing && state.templates.length >= 40)
          throw new AppError('最多保留 40 个团队模板', 409);
        if (existing?.fingerprint === fingerprint)
          return { ready: true, executed: false, unchanged: true, template: existing };
        const time = new Date().toISOString();
        const saved = existing
          ? { ...existing, content, fingerprint, version: existing.version + 1, updatedAt: time }
          : { id: randomUUID(), name: templateName, version: 1, content, fingerprint,
              createdAt: time, updatedAt: time };
        if (existing) state.templates[state.templates.indexOf(existing)] = saved;
        else state.templates.push(saved);
        await writeStore(this.file, state);
        return { ready: true, executed: true, template: saved };
      });
    }
    if (!value.templateId) throw new AppError('请选择团队模板');
    if (action === 'check' || value.mode === 'inspect') {
      const template = this.item(await this.state(), value.templateId);
      return { ready: true, executed: false, template,
        message: value.mode === 'create' ? '新实例使用模板中的资源与项目设置，不复制文件、密钥或端口转发。' : undefined };
    }
    if (!value.fingerprint) throw new AppError('请先预览并提交模板指纹', 409);
    /**
     * 入口 / Entry: TeamTemplates.action.callback@161.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked / team-templates）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked / team-templates).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ready: true, executed: true, deleted: template.id }`; `{ ready: true, executed: true, templateId: template.id, vmId: vm.id, vm: await this.machines.view(vm.id) }`.
     * 副作用 / Effects: `writeStore`; `this.machines.create`; `this.workspaces.save`; `this.machines.delete`; 更新 / updates `state.templates`.
     * 拒绝 / Refusals: 条件 / conditions `template.fingerprint !== value.fingerprint`; `value.mode !== 'create' || !value.targetName`; 异常 / errors `new AppError('团队模板已更新，请重新预览', 409)`; `new AppError('创建实例需要目标名称')`.
     * 失败处理：catch 分支执行 `await this.machines.delete(vm.id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `await this.machines.delete(vm.id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.machines.locked('team-templates', async () => {
      const state = await this.state();
      const template = this.item(state, value.templateId);
      if (template.fingerprint !== value.fingerprint)
        throw new AppError('团队模板已更新，请重新预览', 409);
      if (value.mode === 'delete') {
        state.templates = state.templates.filter((entry) => entry.id !== template.id);
        await writeStore(this.file, state);
        return { ready: true, executed: true, deleted: template.id };
      }
      if (value.mode !== 'create' || !value.targetName)
        throw new AppError('创建实例需要目标名称');
      const vm = await this.machines.create({ ...template.content.resources,
        name: value.targetName, forwards: [] });
      try {
        await this.workspaces.save(vm.id, template.content.project);
      } catch (error) {
        await this.machines.delete(vm.id);
        throw error;
      }
      return { ready: true, executed: true, templateId: template.id,
        vmId: vm.id, vm: await this.machines.view(vm.id) };
    });
  }
}
