import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { projectPrivateValues, type Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { envPrefix } from './project-services.ts';
import { privateLog, redactValues } from './secrets.ts';
import { readStore, writeStore } from './local-store.ts';
import { readVersionedStore, writeVersionedStore } from './plugin-data.ts';
import { join } from 'node:path';
import { vmDir } from './model.ts';
import { ProjectTerminals } from './project-terminals.ts';
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
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private options: { terminals?: Pick<ProjectTerminals, 'prepare'>;
      runTask?: typeof projectIdentityTask } = {},
  ) {}
  async list(id: string) {
    this.machines.get(id);
    return readVersionedStore(
      this.workspaces.projects?.file(id, 'commands') || join(vmDir(id), 'commands.json'),
      1,
      savedPresets,
      () => [],
      { 0: (records) => savedPresets.parse(records) },
    );
  }
  async save(id: string, input: unknown) {
    const preset = presetSchema.parse(input);
    return this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => {
      const records = await this.list(id),
        value = { ...preset, id: preset.id || randomUUID() };
      if (records.length >= 50 && !records.some((v) => v.id === value.id))
        throw new AppError('最多收藏 50 个命令');
      const next = [...records.filter((v) => v.id !== value.id), value];
      await writeVersionedStore(
        this.workspaces.projects?.file(id, 'commands') || join(vmDir(id), 'commands.json'),
        1,
        savedPresets,
        next,
      );
      return next;
    });
  }
  async remove(id: string, presetId: string) {
    z.uuid().parse(presetId);
    return this.machines.locked(`commands:${this.workspaces.projects?.key(id) || id}`, async () => {
      const next = (await this.list(id)).filter((v) => v.id !== presetId);
      await writeVersionedStore(
        this.workspaces.projects?.file(id, 'commands') || join(vmDir(id), 'commands.json'),
        1,
        savedPresets,
        next,
      );
      return next;
    });
  }
  async run(id: string, presetId: string, input: unknown) {
    const values = z.record(z.string(), z.string().max(4096)).parse(input);
    const projectId = this.workspaces.projects.current(id);
    return this.workspaces.projects.inScope(id, projectId, () => this.runSelected(id, presetId, values, projectId));
  }
  private async runSelected(id: string, presetId: string, values: Record<string, string>, projectId: string) {
    const preset = (await this.list(id)).find((v) => v.id === presetId);
    if (!preset) throw new AppError('收藏命令不存在', 404);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const script = presetScript(preset, values);
    return this.jobs.start(
      this.workspaces.projects?.key(id) || id,
      async (log, signal) => {
        const terminals = this.options.terminals ||
          (this.ownedTerminals ||= new ProjectTerminals(this.machines, this.workspaces));
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
  async close() {
    await this.jobs.close();
    await this.ownedTerminals?.close();
  }
}
