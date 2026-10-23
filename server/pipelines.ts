/**
 * 模块职责：保存并执行项目流水线，管理运行记录和产物，执行中的流水线配置受保护。
 * Module purpose: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
 */
import type { FilesV1, ProjectTerminalsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { projectMetadataFile } from './project-catalog.ts';
import { createHash, randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { Files } from './files.ts';
import { privateLog, redactValues } from './secrets.ts';
import { readStore, writeStore } from './local-store.ts';
import { repositoryPath } from './git-workbench.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { pipelineGraph, pipelineSelection, schedulePipeline } from './pipeline-graph.ts';
import { quote } from './shell.ts';

const stepId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const pipelineRerunSchema = z.object({ sourceRunId: z.uuid(), stepIds: z.array(stepId).min(1).max(20) }).strict();
export type PipelineRerun = z.infer<typeof pipelineRerunSchema>;

export const pipelineSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    steps: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            command: z.string().trim().min(1).max(8192),
            timeout: z.number().int().min(1).max(3600).default(300),
            id: stepId.optional(),
            dependsOn: z.array(stepId).max(20).optional(),
            rerunnable: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    artifacts: z.array(repositoryPath).max(20).default([]),
    maxConcurrency: z.number().int().min(1).max(4).optional(),
    inputs: z.array(repositoryPath).max(20).optional(),
  })
  .strict().superRefine((value, context) => {
    try { pipelineGraph(value.steps); }
    catch (error) { context.addIssue({ code: 'custom', path: ['steps'], message: (error as Error).message }); }
  });
export type Pipeline = z.infer<typeof pipelineSchema> & { id: string };
export type PipelineRun = {
  id: string;
  pipelineId: string;
  name: string;
  projectId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
  error?: string;
  errorCode?: string;
  sourceRunId?: string;
  selectedStepIds?: string[];
  fingerprint?: string;
  rerunUnavailable?: string;
  steps: {
    name: string;
    id?: string;
    dependsOn?: string[];
    blockedReason?: string;
    status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
    startedAt?: string;
    finishedAt?: string;
    code?: number;
    errorCode?: string;
    log: string;
  }[];
  artifacts: { name: string; bytes: number; index: number }[];
};
export class Pipelines {
  jobs = new Jobs('pipelines');
  private active = new Map<string, PipelineRun>();
  private ownedTerminals?: ProjectTerminals;
  /**
   * 入口 / Entry: Pipelines.constructor.
   * 功能：建立 Pipelines 的保存并执行项目流水线上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Pipelines context for this module's responsibility: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; files: FilesV1; options: { terminals?: Pick<ProjectTerminalsV1, 'prepare'>; runTask?: typeof projectIdentityTa… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private files: FilesV1,
    private options: { terminals?: Pick<ProjectTerminalsV1, 'prepare'>;
      runTask?: typeof projectIdentityTask } = {},
  ) {}
  /**
   * 入口 / Entry: Pipelines.file.
   * 功能：在保存并执行项目流水线中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectMetadataFile(id, this.workspaces.projects.current(id), kind)` 供上层消费（`Pipelines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Pipelines`; this entry produces `projectMetadataFile(id, this.workspaces.projects.current(id), kind)` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `projectMetadataFile`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectMetadataFile`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; kind: default='pipelines'
   * 输出 / Returns: `projectMetadataFile(id, this.workspaces.projects.current(id), kind)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string, kind = 'pipelines') {
    return projectMetadataFile(id, this.workspaces.projects.current(id), kind);
  }
  /**
   * 入口 / Entry: Pipelines.list.
   * 功能：在保存并执行项目流水线中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `readStore<Pipeline[]>(this.file(id), () => [])` 供上层消费（`Pipelines`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Pipelines`; this entry produces `readStore<Pipeline[]>(this.file(id), () => [])` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `this.machines.get`, `readStore`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `readStore`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `readStore<Pipeline[]>(this.file(id), () => [])`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(id: string) {
    this.machines.get(id);
    return readStore<Pipeline[]>(this.file(id), () => []);
  }
  /**
   * 入口 / Entry: Pipelines.save.
   * 功能：在保存并执行项目流水线中，校验并提交领域状态变更；本入口产生 `this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => { const list = await this.list(id), entry =…` 供上层消费（`Pipelines`）。
   * Purpose: Validates and commits a domain state change in `Pipelines`; this entry produces `this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => { const list = await this.list(id), entry =…` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `pipelineSchema.parse`, `this.machines.locked`, `this.workspaces.projects.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pipelineSchema.parse`, `this.machines.locked`, `this.workspaces.projects.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => { const list = await this.list(id), entry =…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async save(id: string, input: unknown) {
    const value = pipelineSchema.parse(input);
    /**
     * 入口 / Entry: Pipelines.save.callback@84.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `entry`.
     * 副作用 / Effects: `writeStore`.
     * 拒绝 / Refusals: 条件 / conditions `list.length >= 30 && !list.some((p) => p.id === entry.id)`; 异常 / errors `new AppError('最多 30 个流水线')`.
     */
    return this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => {
      const list = await this.list(id),
        entry = { ...value, id: value.id || randomUUID() };
      if (this.jobs.view(this.workspaces.projects.key(id))?.status === 'running')
        throw new AppError('请等待流水线结束后修改配置', 409);
      if (list.length >= 30 && !list.some((p) => p.id === entry.id)) throw new AppError('最多 30 个流水线');
      await writeStore(this.file(id), [...list.filter((p) => p.id !== entry.id), entry]);
      return entry;
    });
  }
  /**
   * 入口 / Entry: Pipelines.remove.
   * 功能：在保存并执行项目流水线中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => { if (this.jobs.view(this.workspaces.projec…` 供上层消费（`Pipelines`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Pipelines`; this entry produces `this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => { if (this.jobs.view(this.workspaces.projec…` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.machines.locked`, `this.workspaces.projects.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.machines.locked`, `this.workspaces.projects.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: `this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => { if (this.jobs.view(this.workspaces.projec…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async remove(id: string, key: string) {
    z.uuid().parse(key);
    return this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => {
      if (this.jobs.view(this.workspaces.projects.key(id))?.status === 'running')
        throw new AppError('请等待流水线结束', 409);
      await writeStore(
        this.file(id),
        (await this.list(id)).filter((p) => p.id !== key),
      );
      return { ok: true };
    });
  }
  /**
   * 入口 / Entry: Pipelines.runs.
   * 功能：在保存并执行项目流水线中，执行此领域的具体处理步骤并返回其结果；本入口产生 `values.map( (v) => this.active.get(v.id) || (v.status === 'running' ? { ...v, status: 'interrupted' as const, error: '服务重启，运行…` 供上层消费（`Pipelines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Pipelines`; this entry produces `values.map( (v) => this.active.get(v.id) || (v.status === 'running' ? { ...v, status: 'interrupted' as const, error: '服务重启，运行…` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `readStore`, `this.file`, `values.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `this.file`, `values.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `values.map( (v) => this.active.get(v.id) || (v.status === 'running' ? { ...v, status: 'interrupted' as const, error: '服务重启，运行…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async runs(id: string) {
    const values = await readStore<PipelineRun[]>(this.file(id, 'pipeline-runs'), () => []);
    return values.map(
      (v) =>
        this.active.get(v.id) ||
        (v.status === 'running'
          ? { ...v, status: 'interrupted' as const, error: '服务重启，运行已中断' }
          : v),
    );
  }
  /**
   * 入口 / Entry: Pipelines.view.
   * 功能：在保存并执行项目流水线中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ projectId: this.workspaces.projects.current(id), pipelines: await this.list(id), runs: (await this.runs(id)).reverse(), job…` 供上层消费（`Pipelines`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Pipelines`; this entry produces `{ projectId: this.workspaces.projects.current(id), pipelines: await this.list(id), runs: (await this.runs(id)).reverse(), job…` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `this.workspaces.projects.current`, `this.list`, `inline.reverse`, `this.runs` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.list`, `inline.reverse`, `this.runs`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ projectId: this.workspaces.projects.current(id), pipelines: await this.list(id), runs: (await this.runs(id)).reverse(), job…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    return {
      projectId: this.workspaces.projects.current(id),
      pipelines: await this.list(id),
      runs: (await this.runs(id)).reverse(),
      job: this.jobs.view(this.workspaces.projects.key(id)),
    };
  }
  /**
   * 入口 / Entry: Pipelines.run.
   * 功能：在保存并执行项目流水线中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, pipelineId, projectId))` 供上层消费（`Pipelines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Pipelines`; this entry produces `this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, pipelineId, projectId))` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `this.workspaces.projects.current`, `this.workspaces.projects.inScope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.workspaces.projects.inScope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; pipelineId: string
   * 输出 / Returns: `this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, pipelineId, projectId))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(id: string, pipelineId: string, rerun?: PipelineRerun) {
    const projectId = this.workspaces.projects.current(id);
    const selection = rerun ? pipelineRerunSchema.parse(rerun) : undefined;
    return this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, pipelineId, projectId, selection));
  }
  /**
   * 入口 / Entry: Pipelines.runSelected.
   * 功能：读取选定流水线并按步骤登记、运行项目任务，保存结果和收集产物。
   * Purpose: Loads a selected pipeline, registers/runs project steps and persists results/artifacts.
   * 设计：定义与原项目在开始时捕获，步骤失败或取消停止后续工作；日志、产物及清理仍归属于原流水线运行。
   * Design: Definitions/project identity are captured at admission; step failure/cancellation stops successors while logs/artifacts/cleanup retain original ownership.
   * 输入 / Inputs: id: string; pipelineId: string; projectId: string
   * 输出 / Returns: `this.jobs.start( this.workspaces.projects.key(id), async (rawLog, signal, update) => { this.active.set(record.id, record); le…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `!definition`; 异常 / errors `new AppError('请先启动发行版')`; `new AppError('流水线不存在', 404)`.
   */
  private async runSelected(id: string, pipelineId: string, projectId: string, rerun?: PipelineRerun) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const saved = (await this.list(id)).find((p) => p.id === pipelineId);
    if (!saved) throw new AppError('流水线不存在', 404);
    const definition = { ...pipelineSchema.parse(saved), id: saved.id };
    const graph = pipelineGraph(definition.steps);
    const selected = rerun ? pipelineSelection(graph, rerun.stepIds) : new Set(graph.map(node => node.id));
    const source = rerun ? (await this.runs(id)).find(run => run.id === rerun.sourceRunId) : undefined;
    if (rerun) {
      if (!source || source.projectId !== projectId || source.pipelineId !== pipelineId ||
          !['done', 'error'].includes(source.status) || !source.fingerprint || source.errorCode?.endsWith('_CLEANUP_FAILED'))
        throw new AppError('原运行未确认或缺少指纹，请核对结果后重新完整运行', 409);
      for (const node of graph.filter(node => selected.has(node.id))) {
        const oldStep = source.steps.find(step => step.id === node.id);
        if (!definition.steps[node.index].rerunnable || !oldStep ||
            (oldStep.startedAt && oldStep.code === undefined) || oldStep.errorCode?.endsWith('_CLEANUP_FAILED'))
          throw new AppError(`步骤 ${node.id} 未声明可重跑或原执行结果未确认`, 409);
      }
    }
    const record: PipelineRun = {
      id: randomUUID(),
      pipelineId,
      name: definition.name,
      projectId,
      startedAt: new Date().toISOString(),
      status: 'running',
      sourceRunId: rerun?.sourceRunId,
      selectedStepIds: rerun ? [...selected] : undefined,
      steps: definition.steps.map((s, index) => ({ name: s.name, id: graph[index].id,
        dependsOn: graph[index].dependencies, status: 'pending', log: '',
        blockedReason: selected.has(graph[index].id) ? undefined : '未选入本次重跑' })),
      artifacts: [],
    };
    const file = this.file(id, 'pipeline-runs');
    /**
     * 入口 / Entry: Pipelines.runSelected.persist.
     * 功能：在保存并执行项目流水线中，校验并提交领域状态变更；完成下述调用及状态处理（`Pipelines`）。
     * Purpose: Validates and commits a domain state change in `Pipelines`; the calls and state transitions below complete the operation. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
     * 处理：通过 `readStore`, `runs.filter`, `next.splice`, `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `readStore`, `runs.filter`, `next.splice`, `writeStore`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `next.splice`; `writeStore`; `rm`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    let persistence = Promise.resolve();
    const persist = () => {
      const nextWrite = persistence.then(async () => {
      const runs = await readStore<PipelineRun[]>(file, () => []);
      const next = [...runs.filter((r) => r.id !== record.id), record];
      const expired = next.splice(0, Math.max(0, next.length - 30));
      await writeStore(file, next);
      for (const old of expired) {
        z.uuid().parse(old.id);
        await rm(join(vmDir(id), 'pipeline-artifacts', old.id), { recursive: true, force: true });
      }
      });
      persistence = nextWrite.catch(() => {});
      return nextWrite;
    };
    /**
     * 入口 / Entry: Pipelines.runSelected.callback@153.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: rawLog; signal; update
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.active.set`; `persist`; `executionSignal.throwIfAborted`; `update`; `mkdir`; 更新 / updates `this.ownedTerminals`, `prepared`, `privateValues`, `step.status`.
     * 拒绝 / Refusals: 条件 / conditions `!captured || !executionSignal || this.machines.live.get(id) !== captured.live`; `result.code !== 0`; `info.size > 32 * 1024 ** 2 || total > 64 * 1024 ** 2`; 异常 / errors `new AppError('流水线准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError(`步骤「${step.name}」退出码 ${result.code}`)`.
     * 收尾：退出 try 区域时始终执行 `record.finishedAt = new Date().toISOString();`; `try { await persist(); } finally { this.active.delete(record.id); await prepared?.release(); }`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `record.finishedAt = new Date().toISOString();`; `try { await persist(); } finally { this.active.delete(record.id); await prepared?.release(); }`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `const cleanupFailed = error instanceof AppError && /_CLEANUP_FAILED$/.test(error.code || '');`; `record.status = signal.aborted && !cleanupFailed ? 'cancelled' : 'error';`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `const cleanupFailed = error instanceof AppError && /_CLEANUP_FAILED$/.test(error.code || '');`; `record.status = signal.aborted && !cleanupFailed ? 'cancelled' : 'error';`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      this.workspaces.projects.key(id),
      async (rawLog, signal, update) => {
        this.active.set(record.id, record);
        let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
        let privateValues: string[] = [];
        try {
          await persist();
          const terminals = this.options.terminals ||
            (this.ownedTerminals ||= projectTerminalsFor(this.machines, this.workspaces));
          prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
          const { captured, signal: executionSignal } = prepared;
          if (!captured || !executionSignal || this.machines.live.get(id) !== captured.live)
            throw new AppError('流水线准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
          privateValues = projectPrivateValues(captured.project);
          const project = await this.workspaces.resolveProject(id, captured.project);
          privateValues = projectPrivateValues(project);
          executionSignal.throwIfAborted();
          if (definition.steps.some(step => step.rerunnable)) {
            // 同一项目账户读取代码、输入及启动身份；仅记录摘要，不保存环境值。
            // Read code/inputs/boot identity through the same project account; persist digests only.
            const command = ['set -eu', 'status=$(git status --porcelain --untracked-files=all --ignore-submodules=none)', 'test -z "$status"',
              'git rev-parse --verify HEAD', 'cat /proc/sys/kernel/random/boot_id', 'id -u',
              ...(definition.inputs || []).map(path => `test -f ${quote(path)} && sha256sum < ${quote(path)}`)].join('\n');
            const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project,
              { command, environment: project.environment }, executionSignal, undefined, 30000, undefined, undefined,
              { expectedLive: captured.live });
            if (result.code === 0 && result.stdout.trim().split('\n').length === 3 + (definition.inputs?.length || 0)) {
              record.fingerprint = createHash('sha256').update(JSON.stringify({ definition, project,
                projectId, vmId: id, identity: captured.identity, configVersion: captured.configVersion,
                evidence: result.stdout.trim() })).digest('hex');
            } else record.rerunUnavailable = '需要干净的 Git 工作区、可读取的声明输入和客户机启动身份';
            if (rerun && record.fingerprint !== source!.fingerprint)
              throw new AppError('代码、配置、输入或客户机身份已变化，请重新完整运行', 409, 'PIPELINE_FINGERPRINT_CHANGED');
            await persist();
          }
          let finished = 0;
          await schedulePipeline(graph, definition.maxConcurrency || 1, selected, executionSignal, async i => {
            executionSignal.throwIfAborted();
            const step = record.steps[i],
              definitionStep = definition.steps[i];
            step.status = 'running';
            step.startedAt = new Date().toISOString();
            await persist();
            update(`${finished}/${selected.size} · ${step.name}`, (finished / selected.size) * 100);
            const output = privateLog((text) => {
              step.log = (step.log + text).slice(-16384);
              rawLog(text);
            }, privateValues);
            try {
              const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project,
                { command: definitionStep.command, environment: project.environment }, executionSignal,
                output.write, definitionStep.timeout * 1000, undefined, undefined, { expectedLive: captured.live });
              step.code = result.code;
              if (result.code !== 0) throw new AppError(`步骤「${step.name}」退出码 ${result.code}`);
              step.status = 'done';
            } catch (error) {
              const cleanupFailed = error instanceof AppError && /_CLEANUP_FAILED$/.test(error.code || '');
              step.status = signal.aborted && !cleanupFailed ? 'cancelled' : 'error';
              step.errorCode = error instanceof AppError ? error.code : undefined;
              throw error;
            } finally {
              output.flush();
              step.finishedAt = new Date().toISOString();
              finished++;
              await persist();
            }
          }, (index, reason) => { record.steps[index].blockedReason = reason; });
          let total = 0;
          // 局部运行不发布整条流水线的产物；其他分支可能尚未验证。
          // Partial runs do not publish whole-pipeline artifacts from unverified branches.
          for (const name of rerun ? [] : definition.artifacts) {
            executionSignal.throwIfAborted();
            const path = posix.join(project.directory, name),
              info = await this.files.info(id, path);
            total += info.size;
            if (info.size > 32 * 1024 ** 2 || total > 64 * 1024 ** 2)
              throw new AppError('产物单文件上限 32 MiB，每次运行总计 64 MiB');
            const dir = join(vmDir(id), 'pipeline-artifacts', record.id);
            await mkdir(dir, { recursive: true });
            const index = record.artifacts.length;
            await this.files.download(
              id,
              path,
              createWriteStream(join(dir, String(index)), { flags: 'wx', mode: 0o600 }),
              () => {},
              executionSignal,
            );
            record.artifacts.push({ name, bytes: info.size, index });
          }
          record.status = 'done';
        } catch (error) {
          const cleanupFailed = error instanceof AppError && /_CLEANUP_FAILED$/.test(error.code || '');
          record.status = signal.aborted && !cleanupFailed ? 'cancelled' : 'error';
          record.error = redactValues((error as Error).message, privateValues);
          record.errorCode = error instanceof AppError ? error.code : undefined;
          throw new AppError(record.error, error instanceof AppError ? error.status : 409, record.errorCode);
        } finally {
          record.finishedAt = new Date().toISOString();
          try { await persist(); }
          finally {
            try { await prepared?.release(); }
            catch (error) {
              record.status = 'error';
              record.error = redactValues((error as Error).message, privateValues);
              record.errorCode = 'PIPELINE_CLEANUP_FAILED';
              await persist();
              throw new AppError(record.error, 503, record.errorCode);
            } finally { this.active.delete(record.id); }
          }
        }
      },
      {
        title: `流水线 · ${definition.name}`,
        vmId: id,
        projectId: record.projectId,
        action: rerun ? `rerun:${record.id}` : `run:${definition.id}`,
      },
    );
  }
  /**
   * 入口 / Entry: Pipelines.artifact.
   * 功能：在保存并执行项目流水线中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ file: join(vmDir(id), 'pipeline-artifacts', runId, String(index)), name: posix.basename(artifact.name), }` 供上层消费（`Pipelines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Pipelines`; this entry produces `{ file: join(vmDir(id), 'pipeline-artifacts', runId, String(index)), name: posix.basename(artifact.name), }` for its caller. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `z.number().int().min().max().parse`, `z.number().int().min().max` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `z.number().int().min().max().parse`, `z.number().int().min().max`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; runId: string; index: number
   * 输出 / Returns: `{ file: join(vmDir(id), 'pipeline-artifacts', runId, String(index)), name: posix.basename(artifact.name), }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!artifact`; 异常 / errors `new AppError('产物不存在', 404)`.
   */
  async artifact(id: string, runId: string, index: number) {
    z.uuid().parse(runId);
    z.number().int().min(0).max(19).parse(index);
    const run = (await this.runs(id)).find((r) => r.id === runId),
      artifact = run?.artifacts.find((a) => a.index === index);
    if (!artifact) throw new AppError('产物不存在', 404);
    return {
      file: join(vmDir(id), 'pipeline-artifacts', runId, String(index)),
      name: posix.basename(artifact.name),
    };
  }
  /**
   * 入口 / Entry: Pipelines.close.
   * 功能：在保存并执行项目流水线中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Pipelines`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Pipelines`; the calls and state transitions below complete the operation. Module context: Persists/runs project pipelines and owns run records/artifacts, protecting settings while execution is active.
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
