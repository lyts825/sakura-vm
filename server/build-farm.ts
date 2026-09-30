import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { Jobs } from './jobs.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectExecutionCommand, redactProjectOutput } from './project-execution.ts';
import { guestTask } from './guest-task.ts';
import { projectPrivateValues } from './workspaces.ts';
import { privateLog, redactValues } from './secrets.ts';

const label = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const labels = z.array(label).max(8).refine((items) => new Set(items).size === items.length,
  '标签不能重复');
const nodeInput = z.object({ vmId: z.uuid(), slots: z.number().int().min(1).max(4),
  labels, enabled: z.boolean(), projectId: projectIdSchema.optional() }).strict();
const workdir = z.string().regex(/^\/workspace(?:\/[a-zA-Z0-9._-]+)*$/)
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
  error: z.string().optional(), projectId: projectIdSchema.optional(),
  directory: z.string().optional(), networkIsolation: z.enum(['host', 'private']).optional() }).strict();
const storeSchema = z.object({ version: z.literal(1), nodes: z.array(nodeInput).max(32),
  tasks: z.array(taskSchema).max(256) }).strict();
type Store = z.infer<typeof storeSchema>;
type Task = Store['tasks'][number];
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
  readonly jobs: Jobs;
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private pumping = false;
  private closed = false;
  private schedulerError?: string;
  private terminals: ProjectTerminals;
  private ownsTerminals: boolean;
  constructor(private machines: Machines,
    private file = join(DATA, 'build-farm.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    jobs?: Jobs, terminals?: ProjectTerminals) {
    this.jobs = jobs || new Jobs('build-farm');
    this.ownsTerminals = !terminals;
    this.terminals = terminals || new ProjectTerminals(machines);
  }
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
      task.status = job?.status === 'done' ? 'done' : job?.status === 'error' ? 'error'
        : job?.status === 'cancelled' ? 'cancelled' : 'interrupted';
      task.error = task.status === 'interrupted'
        ? '服务已重启；请检查目标实例后手动重试' : job?.error;
      task.jobId ||= job?.id;
      task.finishedAt = job?.finishedAt || new Date().toISOString();
      changed = true;
    }
    if (changed) await writeStore(this.file, this.state);
    this.timer = setInterval(() => void this.pump(), 2000);
    this.timer.unref();
    void this.pump();
  }
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
  async projects(vmId: string) {
    z.uuid().parse(vmId);
    return { vmId, ...await this.terminals.workspaces.projects.list(vmId) };
  }
  private selectedProject(vmId: string, requested?: string) {
    return this.terminals.workspaces.projects.with(vmId, requested,
      async () => this.terminals.workspaces.projects.current(vmId));
  }
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.state = next;
  }
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
  private matching(task: Pick<Task, 'labels'>) {
    return this.state.nodes.filter((node) => task.labels.every((value) => node.labels.includes(value)));
  }
  private createTask(build: z.infer<typeof buildInput>, retryOf?: string): Task {
    return { ...build, id: randomUUID(), ...(retryOf ? { retryOf } : {}),
      status: 'queued', createdAt: new Date().toISOString() };
  }
  async action(input: unknown) {
    const value = buildFarmRequest.parse(input);
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
        void this.pump();
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
        void this.pump();
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
  private async reconcile() {
    let changed = false;
    const tasks = this.state.tasks.map((task): Task => {
      if (task.status !== 'running') return task;
      const job = task.jobId ? this.jobs.get(task.jobId) : this.jobs.view(task.id);
      if (!job || job.status === 'running') return task;
      changed = true;
      return { ...task, jobId: job.id,
        status: job.status === 'done' ? 'done' : job.status === 'cancelled'
          ? 'cancelled' : job.status === 'error' ? 'error' : 'interrupted',
        error: job.error, finishedAt: job.finishedAt || new Date().toISOString() };
    });
    if (changed) await this.save({ ...this.state, tasks });
  }
  private async pump() {
    if (this.closed || this.blocked() || this.pumping) return;
    this.pumping = true;
    try {
      while (!this.closed && !this.blocked()) {
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
        void this.execute(selected.taskId, selected.vmId, selected.projectId);
      }
    } catch (error) {
      this.schedulerError = `构建调度暂不可用：${String((error as Error).message || error)}`;
    }
    finally { this.pumping = false; }
  }
  private async execute(id: string, vmId: string, projectId: string) {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task || task.status !== 'running') return;
    try {
      const job = this.jobs.start(id, async (log, signal, update, result) => {
        update('在 ' + this.machines.get(vmId).name + ' 执行构建');
        const prepared = await this.terminals.prepare(vmId, projectId, null, false, signal);
        let values: string[] = [];
        try {
          const project = await this.terminals.workspaces.projects.inScope(vmId, projectId,
            () => this.terminals.workspaces.resolvedConfig(vmId));
          values = projectPrivateValues(project);
          const directory = task.cwd || project.directory;
          const relative = posix.relative(project.directory, directory);
          if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative))
            throw new AppError('构建工作目录必须位于节点绑定的项目目录内', 409);
          const binding = { projectId, directory, networkIsolation: project.networkIsolation || 'host' as const };
          await this.serialized(async () => {
            await this.save({ ...this.state, tasks: this.state.tasks.map((item) =>
              item.id === id ? { ...item, ...binding } : item) });
          });
          signal.throwIfAborted();
          const output = privateLog(log, values);
          let completed;
          try {
            completed = redactProjectOutput(project, await guestTask(this.machines, vmId,
              projectExecutionCommand({ ...project, directory }, task.command),
              signal, output.write, task.timeoutSeconds * 1000));
          } finally { output.flush(); }
          await result({ exitCode: completed.code, vmId, ...binding,
            stdout: completed.stdout.slice(-16384), stderr: completed.stderr.slice(-16384) });
          if (completed.code !== 0) throw new AppError(`构建退出码 ${completed.code}`, 409);
        } catch (error) {
          throw new AppError(redactValues(String((error as Error).message || error), values), 409);
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
        const status: Task['status'] = job.status === 'done' ? 'done' :
          job.status === 'cancelled' ? 'cancelled' : 'error';
        await this.save({ ...this.state, tasks: this.state.tasks.map((item) => item.id === id
          ? { ...item, status, error: job.error,
            finishedAt: job.finishedAt || new Date().toISOString() } : item) });
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
            finishedAt: new Date().toISOString() } : item) });
      }).catch(() => {});
    } finally { void this.pump(); }
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.jobs.close();
    if (this.ownsTerminals) await this.terminals.close();
    await this.queue.catch(() => {});
    let changed = false;
    for (const task of this.state.tasks) if (task.status === 'running') {
      const job = task.jobId ? this.jobs.get(task.jobId) : this.jobs.view(task.id);
      task.status = job?.status === 'done' ? 'done' : 'interrupted';
      task.error = task.status === 'interrupted'
        ? '服务已关闭；请检查目标实例后手动重试' : undefined;
      task.jobId ||= job?.id;
      task.finishedAt = job?.finishedAt || new Date().toISOString();
      changed = true;
    }
    if (changed) await this.save({ ...this.state });
  }
}
