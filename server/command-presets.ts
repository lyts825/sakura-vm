/**
 * 模块职责：保存参数化命令收藏并执行声明过的参数，限制收藏数量和未声明输入。
 * Module purpose: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
 */
import type { ProjectTerminalsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { projectMetadataFile } from './project-catalog.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { envPrefix } from './project-services.ts';
import { privateLog, redactValues } from './secrets.ts';
import { readStore, writeStore } from './local-store.ts';
import { readVersionedStore, writeVersionedStore } from './plugin-data.ts';
import { join } from 'node:path';
import { vmDir } from './paths.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityTask } from './project-run-scope.ts';

export const presetSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    command: z.string().trim().min(1).max(8192),
    parameters: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/),
            value: z.string().max(4096).default(''),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict()
  .refine((p) => new Set(p.parameters.map((v) => v.name)).size === p.parameters.length, '参数名称不能重复');
export type CommandPreset = z.infer<typeof presetSchema> & { id: string };
const savedPresets = z.array(presetSchema.safeExtend({ id: z.uuid() }));
/**
 * 入口 / Entry: presetScript.
 * 功能：在保存参数化命令收藏并执行声明过的参数中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``${envPrefix(parameters)}\n${preset.command}`` 供上层消费（`command-presets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `command-presets.ts`; this entry produces ``${envPrefix(parameters)}\n${preset.command}`` for its caller. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
 * 处理：通过 `preset.parameters.map`, `envPrefix` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `preset.parameters.map`, `envPrefix`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: preset: CommandPreset; values: Record<string, string>
 * 输出 / Returns: ``${envPrefix(parameters)}\n${preset.command}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `Object.keys(values).some((key) => !Object.hasOwn(parameters, key))`; 异常 / errors `new AppError('包含未声明的命令参数')`.
 */
export function presetScript(preset: CommandPreset, values: Record<string, string>) {
  const parameters = Object.fromEntries(
    preset.parameters.map((param) => [param.name, values[param.name] ?? param.value]),
  );
  if (Object.keys(values).some((key) => !Object.hasOwn(parameters, key)))
    throw new AppError('包含未声明的命令参数');
  return `${envPrefix(parameters)}\n${preset.command}`;
}
export class CommandPresets {
  jobs = new Jobs('commands');
  private ownedTerminals?: ProjectTerminals;
  /**
   * 入口 / Entry: CommandPresets.constructor.
   * 功能：建立 CommandPresets 的保存参数化命令收藏并执行声明过的参数上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the CommandPresets context for this module's responsibility: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: { terminals?: Pick<ProjectTerminalsV1, 'prepare'>; runTask?: typeof projectIdentityTa… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private options: { terminals?: Pick<ProjectTerminalsV1, 'prepare'>;
      runTask?: typeof projectIdentityTask } = {},
  ) {}
  /**
   * 入口 / Entry: CommandPresets.list.
   * 功能：在保存参数化命令收藏并执行声明过的参数中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `readVersionedStore( projectMetadataFile(id, this.workspaces.projects?.current(id) || 'default', 'commands') || join(vmDir(id)…` 供上层消费（`CommandPresets`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `CommandPresets`; this entry produces `readVersionedStore( projectMetadataFile(id, this.workspaces.projects?.current(id) || 'default', 'commands') || join(vmDir(id)…` for its caller. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
   * 处理：通过 `this.machines.get`, `readVersionedStore`, `projectMetadataFile`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `readVersionedStore`, `projectMetadataFile`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `readVersionedStore( projectMetadataFile(id, this.workspaces.projects?.current(id) || 'default', 'commands') || join(vmDir(id)…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(id: string) {
    this.machines.get(id);
    return readVersionedStore(
      projectMetadataFile(id, this.workspaces.projects?.current(id) || 'default', 'commands') || join(vmDir(id), 'commands.json'),
      1,
      savedPresets,
      () => [],
      {
      /**
       * 入口 / Entry: CommandPresets.list.0.
       * 功能：把本层请求转交 `savedPresets.parse`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `savedPresets.parse` and propagates the provider result or rejection.
       * 输入 / Inputs: records
       * 输出 / Returns: `savedPresets.parse(records)`.
       * 副作用 / Effects: `savedPresets.parse`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      0: (records) => savedPresets.parse(records) },
    );
  }
  /**
   * 入口 / Entry: CommandPresets.save.
   * 功能：在保存参数化命令收藏并执行声明过的参数中，校验并提交领域状态变更；本入口产生 `this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => { const records = await this.list(id)…` 供上层消费（`CommandPresets`）。
   * Purpose: Validates and commits a domain state change in `CommandPresets`; this entry produces `this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => { const records = await this.list(id)…` for its caller. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
   * 处理：通过 `presetSchema.parse`, `this.machines.locked`, `this.workspaces.projects.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `presetSchema.parse`, `this.machines.locked`, `this.workspaces.projects.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => { const records = await this.list(id)…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async save(id: string, input: unknown) {
    const preset = presetSchema.parse(input);
    /**
     * 入口 / Entry: CommandPresets.save.callback@71.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `next`.
     * 副作用 / Effects: `writeVersionedStore`.
     * 拒绝 / Refusals: 条件 / conditions `records.length >= 50 && !records.some((v) => v.id === value.id)`; 异常 / errors `new AppError('最多收藏 50 个命令')`.
     */
    return this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => {
      const records = await this.list(id),
        value = { ...preset, id: preset.id || randomUUID() };
      if (records.length >= 50 && !records.some((v) => v.id === value.id))
        throw new AppError('最多收藏 50 个命令');
      const next = [...records.filter((v) => v.id !== value.id), value];
      await writeVersionedStore(
        projectMetadataFile(id, this.workspaces.projects?.current(id) || 'default', 'commands') || join(vmDir(id), 'commands.json'),
        1,
        savedPresets,
        next,
      );
      return next;
    });
  }
  /**
   * 入口 / Entry: CommandPresets.remove.
   * 功能：在保存参数化命令收藏并执行声明过的参数中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => { const next = (await this.list(id)).…` 供上层消费（`CommandPresets`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `CommandPresets`; this entry produces `this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => { const next = (await this.list(id)).…` for its caller. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.machines.locked`, `this.workspaces.projects.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.machines.locked`, `this.workspaces.projects.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; presetId: string
   * 输出 / Returns: `this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => { const next = (await this.list(id)).…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async remove(id: string, presetId: string) {
    z.uuid().parse(presetId);
    return this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => {
      const next = (await this.list(id)).filter((v) => v.id !== presetId);
      await writeVersionedStore(
        projectMetadataFile(id, this.workspaces.projects?.current(id) || 'default', 'commands') || join(vmDir(id), 'commands.json'),
        1,
        savedPresets,
        next,
      );
      return next;
    });
  }
  /**
   * 入口 / Entry: CommandPresets.run.
   * 功能：在保存参数化命令收藏并执行声明过的参数中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, presetId, values, projectId))` 供上层消费（`CommandPresets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommandPresets`; this entry produces `this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, presetId, values, projectId))` for its caller. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
   * 处理：通过 `z.record().parse`, `z.record`, `z.string`, `z.string().max` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.record().parse`, `z.record`, `z.string`, `z.string().max`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; presetId: string; input: unknown
   * 输出 / Returns: `this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, presetId, values, projectId))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(id: string, presetId: string, input: unknown) {
    const values = z.record(z.string(), z.string().max(4096)).parse(input);
    const projectId = this.workspaces.projects.current(id);
    return this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, presetId, values, projectId));
  }
  /**
   * 入口 / Entry: CommandPresets.runSelected.
   * 功能：在保存参数化命令收藏并执行声明过的参数中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( this.workspaces.projects?.key(id) || id, async (log, signal) => { const terminals = this.options.terminals |…` 供上层消费（`CommandPresets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommandPresets`; this entry produces `this.jobs.start( this.workspaces.projects?.key(id) || id, async (log, signal) => { const terminals = this.options.terminals |…` for its caller. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
   * 处理：通过 `inline.find`, `this.list`, `this.machines.state`, `presetScript` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `this.list`, `this.machines.state`, `presetScript`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; presetId: string; values: Record<string, string>; projectId: string
   * 输出 / Returns: `this.jobs.start( this.workspaces.projects?.key(id) || id, async (log, signal) => { const terminals = this.options.terminals |…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `!preset`; `this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('收藏命令不存在', 404)`; `new AppError('请先启动发行版')`.
   */
  private async runSelected(id: string, presetId: string, values: Record<string, string>, projectId: string) {
    const preset = (await this.list(id)).find((v) => v.id === presetId);
    if (!preset) throw new AppError('收藏命令不存在', 404);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const script = presetScript(preset, values);
    /**
     * 入口 / Entry: CommandPresets.runSelected.callback@111.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `executionSignal.throwIfAborted`; `prepared.release`; 更新 / updates `this.ownedTerminals`, `privateValues`.
     * 拒绝 / Refusals: 条件 / conditions `!captured || !executionSignal || this.machines.live.get(id) !== captured.live`; `result.code !== 0`; 异常 / errors `new AppError('收藏命令准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError(result.stderr || `命令退出码 ${result.code}`)`.
     * 收尾：退出 try 区域时始终执行 `await prepared.release();`; `output.flush();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await prepared.release();`; `output.flush();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `throw new AppError(redactValues(String((error as Error).message || error), privateValues), error instanceof AppError ? error.…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `throw new AppError(redactValues(String((error as Error).message || error), privateValues), error instanceof AppError ? error.…`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      this.workspaces.projects?.key(id) || id,
      async (log, signal) => {
        const terminals = this.options.terminals ||
          (this.ownedTerminals ||= projectTerminalsFor(this.machines, this.workspaces));
        const prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
        let privateValues: string[] = [];
        try {
          const { captured, signal: executionSignal } = prepared;
          if (!captured || !executionSignal || this.machines.live.get(id) !== captured.live)
            throw new AppError('收藏命令准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
          privateValues = projectPrivateValues(captured.project);
          const project = await this.workspaces.resolveProject(id, captured.project);
          privateValues = projectPrivateValues(project);
          executionSignal.throwIfAborted();
          const output = privateLog(log, privateValues);
          try {
            const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project,
              { command: script, environment: project.environment }, executionSignal, output.write,
              undefined, undefined, undefined, { expectedLive: captured.live });
            if (result.code !== 0) throw new AppError(result.stderr || `命令退出码 ${result.code}`);
          } finally { output.flush(); }
        } catch (error) {
          throw new AppError(redactValues(String((error as Error).message || error), privateValues),
            error instanceof AppError ? error.status : 409, error instanceof AppError ? error.code : undefined);
        } finally { await prepared.release(); }
      },
      { title: `收藏命令 · ${preset.name}`, vmId: id, projectId },
    );
  }
  /**
   * 入口 / Entry: CommandPresets.close.
   * 功能：在保存参数化命令收藏并执行声明过的参数中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`CommandPresets`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `CommandPresets`; the calls and state transitions below complete the operation. Module context: Stores parameterized command favourites, admitting only declared parameters and bounded saved entries.
   * 处理：通过 `this.jobs.close`, `this.ownedTerminals.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`, `this.ownedTerminals.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; `this.ownedTerminals.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    await this.jobs.close();
    await this.ownedTerminals?.close();
  }
}
