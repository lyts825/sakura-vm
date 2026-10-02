import { randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import { type Workspaces, projectPrivateValues } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { Files } from './files.ts';
import { privateLog, redactValues } from './secrets.ts';
import { readStore, writeStore } from './local-store.ts';
import { repositoryPath } from './git-workbench.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityTask } from './project-run-scope.ts';

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
          })
          .strict(),
      )
      .min(1)
      .max(20),
    artifacts: z.array(repositoryPath).max(20).default([]),
  })
  .strict();
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
  steps: {
    name: string;
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
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private files: Files,
    private options: { terminals?: Pick<ProjectTerminals, 'prepare'>;
      runTask?: typeof projectIdentityTask } = {},
  ) {}
  private file(id: string, kind = 'pipelines') {
    return this.workspaces.projects.file(id, kind);
  }
  async list(id: string) {
    this.machines.get(id);
    return readStore<Pipeline[]>(this.file(id), () => []);
  }
  async save(id: string, input: unknown) {
    const value = pipelineSchema.parse(input);
    return this.machines.locked(`pipelines:${this.workspaces.projects.key(id)}`, async () => {
      const list = await this.list(id),
        entry = { ...value, id: value.id || randomUUID() };
      if (list.length >= 30 && !list.some((p) => p.id === entry.id)) throw new AppError('最多 30 个流水线');
      await writeStore(this.file(id), [...list.filter((p) => p.id !== entry.id), entry]);
      return entry;
    });
  }
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
  async view(id: string) {
    return {
      projectId: this.workspaces.projects.current(id),
      pipelines: await this.list(id),
      runs: (await this.runs(id)).reverse(),
      job: this.jobs.view(this.workspaces.projects.key(id)),
    };
  }
  async run(id: string, pipelineId: string) {
    const projectId = this.workspaces.projects.current(id);
    return this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, pipelineId, projectId));
  }
  private async runSelected(id: string, pipelineId: string, projectId: string) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const definition = (await this.list(id)).find((p) => p.id === pipelineId);
    if (!definition) throw new AppError('流水线不存在', 404);
    const record: PipelineRun = {
      id: randomUUID(),
      pipelineId,
      name: definition.name,
      projectId,
      startedAt: new Date().toISOString(),
      status: 'running',
      steps: definition.steps.map((s) => ({ name: s.name, status: 'pending', log: '' })),
      artifacts: [],
    };
    const file = this.file(id, 'pipeline-runs');
    const persist = async () => {
      const runs = await readStore<PipelineRun[]>(file, () => []);
      const next = [...runs.filter((r) => r.id !== record.id), record];
      const expired = next.splice(0, Math.max(0, next.length - 30));
      await writeStore(file, next);
      for (const old of expired) {
        z.uuid().parse(old.id);
        await rm(join(vmDir(id), 'pipeline-artifacts', old.id), { recursive: true, force: true });
      }
    };
    return this.jobs.start(
      this.workspaces.projects.key(id),
      async (rawLog, signal, update) => {
        this.active.set(record.id, record);
        let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
        let privateValues: string[] = [];
        try {
          await persist();
          const terminals = this.options.terminals ||
            (this.ownedTerminals ||= new ProjectTerminals(this.machines, this.workspaces));
          prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
          const { captured, signal: executionSignal } = prepared;
          if (!captured || !executionSignal || this.machines.live.get(id) !== captured.live)
            throw new AppError('流水线准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
          privateValues = projectPrivateValues(captured.project);
          const project = await this.workspaces.resolveProject(id, captured.project);
          privateValues = projectPrivateValues(project);
          executionSignal.throwIfAborted();
          for (let i = 0; i < definition.steps.length; i++) {
            executionSignal.throwIfAborted();
            const step = record.steps[i],
              definitionStep = definition.steps[i];
            step.status = 'running';
            step.startedAt = new Date().toISOString();
            await persist();
            update(`${i + 1}/${record.steps.length} · ${step.name}`, (i / record.steps.length) * 100);
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
              await persist();
            }
          }
          let total = 0;
          for (const name of definition.artifacts) {
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
          finally { this.active.delete(record.id); await prepared?.release(); }
        }
      },
      {
        title: `流水线 · ${definition.name}`,
        vmId: id,
        projectId: record.projectId,
        action: `run:${definition.id}`,
      },
    );
  }
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
  async close() {
    await this.jobs.close();
    await this.ownedTerminals?.close();
  }
}
