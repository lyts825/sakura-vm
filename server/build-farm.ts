/**
 * 模块职责：维护构建队列与项目执行任务；重启中断的构建保留记录，由用户核查后重试。
 * Module purpose: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
 */
import type { JobsV1, ProjectTerminalsV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { Jobs } from './jobs.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { type JobView } from '../shared/contracts/jobs.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdSchema } from './project-catalog.ts';
import { redactProjectOutput } from './project-execution.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { quote } from './shell.ts';
import { projectPrivateValues } from './workspaces.ts';
import { privateLog, redactValues } from './secrets.ts';

const label = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const labels = z.array(label).max(8).refine((items) => new Set(items).size === items.length,
  '标签不能重复');
const nodeInput = z.object({ vmId: z.uuid(), slots: z.number().int().min(1).max(4),
  labels, enabled: z.boolean(), projectId: projectIdSchema.optional() }).strict();
const workdir = z.string().regex(/^\/(?:workspace|opt\/projects|srv\/projects)(?:\/[a-zA-Z0-9._-]+)*$/)
  .refine((value) => value.split('/').every((segment) => segment !== '.' && segment !== '..'),
    '工作目录不能包含点路径');
const buildInput = z.object({ name: z.string().trim().min(1).max(80),
  command: z.string().trim().min(1).max(4096),
  cwd: workdir.optional(),
  labels, timeoutSeconds: z.number().int().min(5).max(1800) }).strict();
const taskSchema = buildInput.extend({ id: z.uuid(), retryOf: z.uuid().optional(),
  status: z.enum(['queued', 'running', 'done', 'error', 'cancelled', 'interrupted']),
  vmId: z.uuid().optional(), jobId: z.uuid().optional(), createdAt: z.string(),
  startedAt: z.string().optional(), finishedAt: z.string().optional(),
  error: z.string().optional(), errorCode: z.string().optional(), projectId: projectIdSchema.optional(),
  directory: z.string().optional(), projectDirectory: z.string().optional(),
  configVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  networkIsolation: z.enum(['host', 'private']).optional() }).strict();
const storeSchema = z.object({ version: z.literal(1), nodes: z.array(nodeInput).max(32),
  tasks: z.array(taskSchema).max(256) }).strict();
type Store = z.infer<typeof storeSchema>;
type Task = Store['tasks'][number];
/**
 * 入口 / Entry: initial.
 * 功能：从当前输入或状态计算 `({ version: 1, nodes: [], tasks: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, nodes: [], tasks: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, nodes: [], tasks: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const initial = (): Store => ({ version: 1, nodes: [], tasks: [] });

export const buildFarmRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save-node'), node: nodeInput }).strict(),
  z.object({ operation: z.literal('remove-node'), vmId: z.uuid() }).strict(),
  z.object({ operation: z.literal('submit'), build: buildInput }).strict(),
  z.object({ operation: z.literal('retry'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('cancel'), id: z.uuid() }).strict(),
]);

/** Build commands run inside registered Linux instances; only queue metadata is stored here. */
export class BuildFarm {
  readonly jobs: JobsV1;
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ScheduleHandle;
  private pumping = false;
  private closed = false;
  private schedulerError?: string;
  private terminals: ProjectTerminals;
  private ownsTerminals: boolean;
  /**
   * 入口 / Entry: BuildFarm.constructor.
   * 功能：建立 BuildFarm 的维护构建队列与项目执行任务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the BuildFarm context for this module's responsibility: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'build-farm.json'); blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; jobs: JobsV1 optional; terminals: ProjectTerminalsV1 optional; runTask: typeof projectIdentityTask default=projectIdentityTask
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.jobs`, `this.ownsTerminals`, `this.terminals`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines,
    private file = join(DATA, 'build-farm.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    jobs?: JobsV1, terminals?: ProjectTerminalsV1,
    private runTask: typeof projectIdentityTask = projectIdentityTask) {
    this.jobs = jobs || new Jobs('build-farm');
    this.ownsTerminals = !terminals;
    this.terminals = terminals || projectTerminalsFor(machines);
  }
  /**
   * 入口 / Entry: BuildFarm.init.
   * 功能：在维护构建队列与项目执行任务中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `node.projectId`, `this.timer`（`BuildFarm`）。
   * Purpose: Initializes and verifies current domain state in `BuildFarm`; the outcome is recorded in `this.state`, `node.projectId`, `this.timer`. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!node.projectId && this.machines.records.has(node.vmId)`; `task.status === 'running'`; `changed`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; `scheduler.register`; 更新 / updates `this.state`, `node.projectId`, `changed`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 1024 * 1024)`; `new Set(this.state.nodes.map((node) => node.vmId)).size !== this.state.nodes.length || new Set(this.state.tasks.map((task) =>…`; 异常 / errors `new AppError('构建队列记录类型或大小无效')`; `new AppError('构建农场记录包含重复标识')`.
   */
  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 1024 * 1024))
      throw new AppError('构建队列记录类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.nodes.map((node) => node.vmId)).size !== this.state.nodes.length ||
        new Set(this.state.tasks.map((task) => task.id)).size !== this.state.tasks.length)
      throw new AppError('构建农场记录包含重复标识');
    let changed = !info;
    for (const node of this.state.nodes) if (!node.projectId && this.machines.records.has(node.vmId)) {
      node.projectId = await this.selectedProject(node.vmId);
      changed = true;
    }
    for (const task of this.state.tasks) if (task.status === 'running') {
      const job = task.jobId ? this.jobs.get(task.jobId) : this.jobs.view(task.id);
      Object.assign(task, this.finished(task, job, '服务已重启；请检查目标实例后手动重试'));
      changed = true;
    }
    if (changed) await writeStore(this.file, this.state);
    this.timer = scheduler.register({ owner: 'core:build-farm', label: '构建队列调度', intervalMs: 2000,
      immediate: true, overlap: 'coalesce',
      /**
       * 入口 / Entry: BuildFarm.init.run.
       * 功能：把本层请求转交 `this.pump`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.pump` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.pump()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: () => this.pump() });
  }
  /**
   * 入口 / Entry: BuildFarm.view.
   * 功能：在维护构建队列与项目执行任务中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ nodes: this.state.nodes.map((node) => ({ ...node, vmName: this.machines.records.get(node.vmId)?.name || null, status: this.…` 供上层消费（`BuildFarm`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `BuildFarm`; this entry produces `{ nodes: this.state.nodes.map((node) => ({ ...node, vmName: this.machines.records.get(node.vmId)?.name || null, status: this.…` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `running.set`, `running.get`, `this.state.nodes.map`, `this.state.tasks.slice().reverse().map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `running.set`, `running.get`, `this.state.nodes.map`, `this.state.tasks.slice().reverse().map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `task.status === 'running' && task.vmId`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ nodes: this.state.nodes.map((node) => ({ ...node, vmName: this.machines.records.get(node.vmId)?.name || null, status: this.…`.
   * 副作用 / Effects: `running.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    const running = new Map<string, number>();
    for (const task of this.state.tasks) if (task.status === 'running' && task.vmId)
      running.set(task.vmId, (running.get(task.vmId) || 0) + 1);
    return { nodes: this.state.nodes.map((node) => ({ ...node,
      vmName: this.machines.records.get(node.vmId)?.name || null,
      status: this.machines.records.has(node.vmId) ? this.machines.state(node.vmId) : 'missing',
      busy: running.get(node.vmId) || 0 })),
    tasks: this.state.tasks.slice(-100).reverse().map((task) => ({ ...task,
      job: task.jobId ? this.jobs.get(task.jobId) || null : null })),
    persistenceError: this.schedulerError || this.jobs.persistenceError };
  }
  /**
   * 入口 / Entry: BuildFarm.projects.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ vmId, ...await this.terminals.workspaces.projects.list(vmId) }` 供上层消费（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; this entry produces `{ vmId, ...await this.terminals.workspaces.projects.list(vmId) }` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.terminals.workspaces.projects.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.terminals.workspaces.projects.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `{ vmId, ...await this.terminals.workspaces.projects.list(vmId) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async projects(vmId: string) {
    z.uuid().parse(vmId);
    return { vmId, ...await this.terminals.workspaces.projects.list(vmId) };
  }
  /**
   * 入口 / Entry: BuildFarm.selectedProject.
   * 功能：把本层请求转交 `this.terminals.workspaces.projects.with`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.terminals.workspaces.projects.with` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; requested: string optional
   * 输出 / Returns: `this.terminals.workspaces.projects.with(vmId, requested, async () => this.terminals.workspaces.projects.current(vmId))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private selectedProject(vmId: string, requested?: string) {
    return this.terminals.workspaces.projects.with(vmId, requested,
      async () => this.terminals.workspaces.projects.current(vmId));
  }
  /**
   * 入口 / Entry: BuildFarm.save.
   * 功能：在维护构建队列与项目执行任务中，校验并提交领域状态变更；处理结果记录到 `this.state`（`BuildFarm`）。
   * Purpose: Validates and commits a domain state change in `BuildFarm`; the outcome is recorded in `this.state`. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: next: Store
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.state = next;
  }
  /**
   * 入口 / Entry: BuildFarm.serialized.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task.finally(() => this.mutation(-1))` 供上层消费（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; this entry produces `task.finally(() => this.mutation(-1))` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `this.blocked`, `this.mutation`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.mutation`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `task.finally(() => this.mutation(-1))`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    const task = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      return work();
    });
    this.queue = task;
    return task.finally(() => this.mutation(-1));
  }
  /**
   * 入口 / Entry: BuildFarm.matching.
   * 功能：从当前输入或状态计算 `this.state.nodes.filter((node) => task.labels.every((value) => node.labels.includes(value)))`，供调用方后续验证或使用。
   * Purpose: Computes `this.state.nodes.filter((node) => task.labels.every((value) => node.labels.includes(value)))` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: task: Pick<Task, 'labels'>
   * 输出 / Returns: `this.state.nodes.filter((node) => task.labels.every((value) => node.labels.includes(value)))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private matching(task: Pick<Task, 'labels'>) {
    return this.state.nodes.filter((node) => task.labels.every((value) => node.labels.includes(value)));
  }
  /**
   * 入口 / Entry: BuildFarm.createTask.
   * 功能：从当前输入或状态计算 `{ ...build, id: randomUUID(), ...(retryOf ? { retryOf } : {}), status: 'queued', createdAt: new Date().toISOString() }`，供调用方后续验证或使用。
   * Purpose: Computes `{ ...build, id: randomUUID(), ...(retryOf ? { retryOf } : {}), status: 'queued', createdAt: new Date().toISOString() }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: build: z.infer<typeof buildInput>; retryOf: string optional
   * 输出 / Returns: Task；结果来自 / values from `{ ...build, id: randomUUID(), ...(retryOf ? { retryOf } : {}), status: 'queued', createdAt: new Date().toISOString() }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private createTask(build: z.infer<typeof buildInput>, retryOf?: string): Task {
    return { ...build, id: randomUUID(), ...(retryOf ? { retryOf } : {}),
      status: 'queued', createdAt: new Date().toISOString() };
  }
  /**
   * 入口 / Entry: BuildFarm.action.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serialized(async () => { if (value.operation === 'save-node') { const vm = this.machines.get(value.node.vmId); if (vm.sa…` 供上层消费（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; this entry produces `this.serialized(async () => { if (value.operation === 'save-node') { const vm = this.machines.get(value.node.vmId); if (vm.sa…` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `buildFarmRequest.parse`, `this.serialized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `buildFarmRequest.parse`, `this.serialized`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serialized(async () => { if (value.operation === 'save-node') { const vm = this.machines.get(value.node.vmId); if (vm.sa…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(input: unknown) {
    const value = buildFarmRequest.parse(input);
    /**
     * 入口 / Entry: BuildFarm.action.callback@149.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialized）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialized).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `node`; `{ removed: value.vmId }`; `task`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `this.save`; `this.createTask`; `tasks.splice`; 更新 / updates `build`.
     * 拒绝 / Refusals: 条件 / conditions `value.operation === 'save-node'`; `vm.sandbox || vm.rescueOf`; `previous && previous.projectId !== node.projectId && this.state.tasks.some((task) => task.vmId === vm.id && task.status === '…`; 异常 / errors `new AppError('构建节点必须是普通实例', 409)`; `new AppError('节点仍在执行构建，请先等待或取消，再更换项目', 409)`.
     */
    return this.serialized(async () => {
      if (value.operation === 'save-node') {
        const vm = this.machines.get(value.node.vmId);
        if (vm.sandbox || vm.rescueOf) throw new AppError('构建节点必须是普通实例', 409);
        const node = { ...value.node, projectId: await this.selectedProject(vm.id, value.node.projectId) };
        const previous = this.state.nodes.find((item) => item.vmId === vm.id);
        if (previous && previous.projectId !== node.projectId && this.state.tasks.some((task) =>
          task.vmId === vm.id && task.status === 'running'))
          throw new AppError('节点仍在执行构建，请先等待或取消，再更换项目', 409);
        const nodes = [...this.state.nodes.filter((node) => node.vmId !== vm.id), node];
        if (nodes.length > 32) throw new AppError('构建节点已达上限', 409);
        await this.save({ ...this.state, nodes });
        this.timer?.trigger();
        return node;
      }
      if (value.operation === 'remove-node') {
        if (this.state.tasks.some((task) => task.vmId === value.vmId && task.status === 'running'))
          throw new AppError('节点仍在执行构建，请先等待或取消', 409);
        await this.save({ ...this.state,
          nodes: this.state.nodes.filter((node) => node.vmId !== value.vmId) });
        return { removed: value.vmId };
      }
      if (value.operation === 'submit' || value.operation === 'retry') {
        let build: z.infer<typeof buildInput>;
        if (value.operation === 'submit') build = value.build;
        else {
          const source = this.state.tasks.find((task) => task.id === value.id);
          if (!source) throw new AppError('构建记录不存在', 404);
          if (!['error', 'cancelled', 'interrupted'].includes(source.status))
            throw new AppError('只有失败或中断的构建可以重试', 409);
          build = buildInput.parse({ name: source.name, command: source.command,
            cwd: source.cwd, labels: source.labels, timeoutSeconds: source.timeoutSeconds });
        }
        if (!this.matching(build).length)
          throw new AppError('没有标签匹配的构建节点，请先登记节点', 409);
        if (this.state.tasks.length >= 256) {
          const removable = this.state.tasks.findIndex((task) =>
            !['queued', 'running'].includes(task.status));
          if (removable < 0) throw new AppError('构建队列已达上限', 409);
        }
        const task = this.createTask(build, value.operation === 'retry' ? value.id : undefined);
        const tasks = [...this.state.tasks, task];
        if (tasks.length > 256) tasks.splice(tasks.findIndex((item) =>
          !['queued', 'running'].includes(item.status)), 1);
        await this.save({ ...this.state, tasks });
        this.timer?.trigger();
        return task;
      }
      const task = this.state.tasks.find((item) => item.id === value.id);
      if (!task) throw new AppError('构建记录不存在', 404);
      if (task.status === 'queued') {
        const cancelled: Task = { ...task, status: 'cancelled',
          finishedAt: new Date().toISOString() };
        await this.save({ ...this.state, tasks: this.state.tasks.map((item) =>
          item.id === task.id ? cancelled : item) });
        return cancelled;
      } else if (task.status === 'running') this.jobs.cancel(task.id);
      return task;
    });
  }
  /**
   * 入口 / Entry: BuildFarm.choose.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ task, node }` / `null` 供上层消费（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; this entry produces `{ task, node }` / `null` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `running.set`, `running.get`, `this.matching().filter().sort`, `this.matching().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `running.set`, `running.get`, `this.matching().filter().sort`, `this.matching().filter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `task.status === 'running' && task.vmId`; `task.status !== 'queued'`; `node`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ task, node }`; `null`.
   * 副作用 / Effects: `running.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private choose() {
    const running = new Map<string, number>();
    for (const task of this.state.tasks) if (task.status === 'running' && task.vmId)
      running.set(task.vmId, (running.get(task.vmId) || 0) + 1);
    for (const task of this.state.tasks) {
      if (task.status !== 'queued') continue;
      const node = this.matching(task).filter((item) => item.enabled &&
        item.projectId &&
        this.machines.records.has(item.vmId) &&
        this.machines.state(item.vmId) === 'running' &&
        (running.get(item.vmId) || 0) < item.slots)
        .sort((a, b) => ((running.get(a.vmId) || 0) / a.slots) -
          ((running.get(b.vmId) || 0) / b.slots) || a.vmId.localeCompare(b.vmId))[0];
      if (node) return { task, node };
    }
    return null;
  }
  /**
   * 入口 / Entry: BuildFarm.finished.
   * 功能：从当前输入或状态计算 `{ ...task, status, jobId: task.jobId || job?.id, error: status === 'interrupted' ? job?.error || interrupted : job?.error, er…`，供调用方后续验证或使用。
   * Purpose: Computes `{ ...task, status, jobId: task.jobId || job?.id, error: status === 'interrupted' ? job?.error || interrupted : job?.error, er…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: task: Task; job: JobView | null | undefined; interrupted: string
   * 输出 / Returns: Task；结果来自 / values from `{ ...task, status, jobId: task.jobId || job?.id, error: status === 'interrupted' ? job?.error || interrupted : job?.error, er…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private finished(task: Task, job: JobView | null | undefined, interrupted: string): Task {
    const status = job && job.status !== 'running' ? job.status : 'interrupted';
    return { ...task, status, jobId: task.jobId || job?.id,
      error: status === 'interrupted' ? job?.error || interrupted : job?.error,
      errorCode: job?.errorCode, finishedAt: job?.finishedAt || new Date().toISOString() };
  }
  /**
   * 入口 / Entry: BuildFarm.reconcile.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; the calls and state transitions below complete the operation. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `this.state.tasks.map`, `this.save` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.tasks.map`, `this.save`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `changed`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.save`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async reconcile() {
    let changed = false;
    /**
     * 入口 / Entry: BuildFarm.reconcile.callback@234.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.state.tasks.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.state.tasks.map).
     * 输入 / Inputs: task
     * 输出 / Returns: Task；结果来自 / values from `task`; `this.finished(task, job, '构建运行状态未确认，请检查目标实例后手动重试')`.
     * 副作用 / Effects: 更新 / updates `changed`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const tasks = this.state.tasks.map((task): Task => {
      if (task.status !== 'running') return task;
      const job = task.jobId ? this.jobs.get(task.jobId) : this.jobs.view(task.id);
      if (job?.status === 'running') return task;
      changed = true;
      return this.finished(task, job, '构建运行状态未确认，请检查目标实例后手动重试');
    });
    if (changed) await this.save({ ...this.state, tasks });
  }
  /**
   * 入口 / Entry: BuildFarm.pump.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; this entry produces `void` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `this.blocked`, `this.serialized`, `Jobs.detached` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.serialized`, `Jobs.detached`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.blocked() || this.pumping`; `!selected`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.pumping`, `this.schedulerError`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.pumping = false;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.pumping = false;`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `this.schedulerError = `构建调度暂不可用：${String((error as Error).message || error)}`;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.schedulerError = `构建调度暂不可用：${String((error as Error).message || error)}`;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async pump() {
    if (this.closed || this.blocked() || this.pumping) return;
    this.pumping = true;
    try {
      while (!this.closed && !this.blocked()) {
        /**
         * 入口 / Entry: BuildFarm.pump.callback@248.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialized）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialized).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `null`; `{ taskId: chosen.task.id, vmId: chosen.node.vmId, projectId: chosen.node.projectId! }`.
         * 副作用 / Effects: `this.save`; 更新 / updates `this.schedulerError`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const selected = await this.serialized(async () => {
          await this.reconcile();
          this.schedulerError = undefined;
          const chosen = this.choose();
          if (!chosen) return null;
          const tasks = this.state.tasks.map((task) => task.id === chosen.task.id
            ? { ...task, status: 'running' as const, vmId: chosen.node.vmId,
              projectId: chosen.node.projectId, startedAt: new Date().toISOString() } : task);
          await this.save({ ...this.state, tasks });
          this.schedulerError = undefined;
          return { taskId: chosen.task.id, vmId: chosen.node.vmId, projectId: chosen.node.projectId! };
        });
        if (!selected) break;
        void Jobs.detached(() => this.execute(selected.taskId, selected.vmId, selected.projectId));
      }
    } catch (error) {
      this.schedulerError = `构建调度暂不可用：${String((error as Error).message || error)}`;
    }
    finally { this.pumping = false; }
  }
  /**
   * 入口 / Entry: BuildFarm.execute.
   * 功能：在维护构建队列与项目执行任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`BuildFarm`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BuildFarm`; this entry produces `void` for its caller. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `this.state.tasks.find`, `this.jobs.start`, `this.serialized().catch`, `this.serialized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.tasks.find`, `this.jobs.start`, `this.serialized().catch`, `this.serialized`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!task || task.status !== 'running'`; `this.closed`; `!this.closed`.
   * 输入 / Inputs: id: string; vmId: string; projectId: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.timer?.trigger();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.timer?.trigger();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (!this.closed) await this.serialized(async () => { const current = this.state.tasks.find((item) => item.id === id); if (cu…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (!this.closed) await this.serialized(async () => { const current = this.state.tasks.find((item) => item.id === id); if (cu…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async execute(id: string, vmId: string, projectId: string) {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task || task.status !== 'running') return;
    try {
      /**
       * 入口 / Entry: BuildFarm.execute.callback@272.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; signal; update; result
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `update`; `relative.startsWith`; `executionSignal.throwIfAborted`; `prepared.release`; 更新 / updates `values`, `completed`.
       * 拒绝 / Refusals: 条件 / conditions `!captured || !executionSignal || this.machines.live.get(vmId) !== captured.live`; `relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)`; `completed.code !== 0`; 异常 / errors `new AppError('构建准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('构建工作目录必须位于节点绑定的项目目录内', 409)`.
       * 收尾：退出 try 区域时始终执行 `prepared.release();`; `output.flush();`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `prepared.release();`; `output.flush();`; these steps also apply to exceptional exits.
       * 失败处理：catch 分支执行 `throw new AppError(redactValues(String((error as Error).message || error), values), error instanceof AppError ? error.status …`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `throw new AppError(redactValues(String((error as Error).message || error), values), error instanceof AppError ? error.status …`; these statements determine whether a failure is absorbed or rejected again.
       */
      const job = this.jobs.start(id, async (log, signal, update, result) => {
        update('在 ' + this.machines.get(vmId).name + ' 执行构建');
        const prepared = await this.terminals.prepare(vmId, projectId, null, false, signal, undefined, { mode: 'task' });
        let values: string[] = [];
        try {
          const { captured, signal: executionSignal } = prepared;
          if (!captured || !executionSignal || this.machines.live.get(vmId) !== captured.live)
            throw new AppError('构建准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
          values = projectPrivateValues(captured.project);
          const project = await this.terminals.workspaces.resolveProject(vmId, captured.project);
          values = projectPrivateValues(project);
          const directory = task.cwd || project.directory;
          const relative = posix.relative(project.directory, directory);
          if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative))
            throw new AppError('构建工作目录必须位于节点绑定的项目目录内', 409);
          const binding = { projectId, directory, projectDirectory: project.directory,
            configVersion: captured.configVersion, networkIsolation: project.networkIsolation || 'host' as const };
          await this.serialized(async () => {
            await this.save({ ...this.state, tasks: this.state.tasks.map((item) =>
              item.id === id ? { ...item, ...binding } : item) });
          });
          executionSignal.throwIfAborted();
          const output = privateLog(log, values);
          let completed;
          try {
            completed = redactProjectOutput(project, await this.runTask(this.machines, vmId, project,
              { command: relative ? `cd ${quote('./' + relative)} || exit 72\n${task.command}` : task.command,
                environment: project.environment },
              executionSignal, output.write, task.timeoutSeconds * 1000, undefined, undefined,
              { expectedLive: captured.live }));
          } finally { output.flush(); }
          await result({ exitCode: completed.code, vmId, ...binding,
            stdout: completed.stdout.slice(-16384), stderr: completed.stderr.slice(-16384) });
          if (completed.code !== 0) throw new AppError(`构建退出码 ${completed.code}`, 409);
        } catch (error) {
          throw new AppError(redactValues(String((error as Error).message || error), values),
            error instanceof AppError ? error.status : 409, error instanceof AppError ? error.code : undefined);
        } finally { prepared.release(); }
      }, { title: task.name, vmId, projectId, action: 'build-farm' });
      await this.serialized(async () => {
        const current = this.state.tasks.find((item) => item.id === id);
        if (current?.status !== 'running') return;
        await this.save({ ...this.state, tasks: this.state.tasks.map((item) =>
          item.id === id ? { ...item, jobId: job.id } : item) });
      }).catch((error) => {
        this.schedulerError = `构建记录保存失败：${String((error as Error).message || error)}`;
      });
      await this.jobs.wait(id);
      if (this.closed) return;
      await this.serialized(async () => {
        const current = this.state.tasks.find((item) => item.id === id);
        if (current?.status !== 'running') return;
        await this.save({ ...this.state, tasks: this.state.tasks.map((item) => item.id === id
          ? this.finished(item, job, '构建运行状态未确认，请检查目标实例后手动重试') : item) });
      }).catch((error) => {
        this.schedulerError = `构建结果保存失败：${String((error as Error).message || error)}`;
      });
    } catch (error) {
      if (!this.closed) await this.serialized(async () => {
        const current = this.state.tasks.find((item) => item.id === id);
        if (current?.status !== 'running') return;
        await this.save({ ...this.state, tasks: this.state.tasks.map((item) => item.id === id
          ? { ...item, status: 'error' as const,
            error: String((error as Error).message || error),
            errorCode: error instanceof AppError ? error.code : undefined,
            finishedAt: new Date().toISOString() } : item) });
      }).catch((failure) => {
        this.schedulerError = `构建失败记录保存未确认：${String((failure as Error).message || failure)}`;
      });
    } finally { this.timer?.trigger(); }
  }
  /**
   * 入口 / Entry: BuildFarm.close.
   * 功能：在维护构建队列与项目执行任务中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`BuildFarm`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `BuildFarm`; the outcome is recorded in `this.closed`. Module context: Owns build queues and project executions; interrupted builds retain records for inspection before explicit retry.
   * 处理：通过 `this.timer.close`, `this.jobs.close`, `this.terminals.close`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`, `this.jobs.close`, `this.terminals.close`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.ownsTerminals`; `task.status === 'running'`; `changed`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; `this.jobs.close`; `this.terminals.close`; `this.save`; 更新 / updates `this.closed`, `changed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.timer?.close();
    await this.jobs.close();
    if (this.ownsTerminals) await this.terminals.close();
    await this.queue.catch(() => {});
    let changed = false;
    for (const task of this.state.tasks) if (task.status === 'running') {
      const job = task.jobId ? this.jobs.get(task.jobId) : this.jobs.view(task.id);
      Object.assign(task, this.finished(task, job, '服务已关闭；请检查目标实例后手动重试'));
      changed = true;
    }
    if (changed) await this.save({ ...this.state });
  }
}
