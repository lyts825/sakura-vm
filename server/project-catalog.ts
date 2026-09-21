import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import { readStore, writeStore } from './local-store.ts';

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
  constructor(private machines: Machines) {}
  current(id: string) {
    const value = this.context.getStore();
    return value?.vmId === id ? value.projectId : 'default';
  }
  key(id: string) {
    const project = this.current(id);
    return project === 'default' ? id : `${id}:${project}`;
  }
  file(id: string, name = 'project') {
    const project = this.current(id);
    return join(vmDir(id), `${name}${project === 'default' ? '' : '-' + project}.json`);
  }
  async list(id: string) {
    this.machines.get(id);
    return projectIndexSchema.parse(
      await readStore(join(vmDir(id), 'projects.json'), () => ({
        active: 'default',
        projects: [{ id: 'default', name: '默认项目' }],
      })),
    );
  }
  async with<T>(id: string, requested: string | null | undefined, action: () => Promise<T>) {
    const index = await this.list(id),
      projectId = projectIdSchema.parse(requested || index.active);
    if (!index.projects.some((p) => p.id === projectId)) throw new AppError('项目不存在', 404);
    return this.inScope(id, projectId, action);
  }
  inScope<T>(id: string, projectId: string, action: () => T) {
    return this.context.run({ vmId: id, projectId }, action);
  }
  async create(id: string, name: string, initialize: () => Promise<void>) {
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
  async update(id: string, project: string, name?: string) {
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
