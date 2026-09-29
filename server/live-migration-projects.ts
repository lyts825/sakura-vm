import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import { projectIdSchema, projectIndexSchema } from './project-catalog.ts';
import { projectSchema } from './workspaces.ts';

export const liveMigrationProjectsSchema = projectIndexSchema.safeExtend({
  configs: z.record(projectIdSchema, projectSchema),
}).refine((value) => Object.keys(value.configs).every((id) =>
  value.projects.some((entry) => entry.id === id)), '项目配置不属于项目目录')
  .refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 512 * 1024,
    '项目配置超过在线迁移大小上限');
export type LiveMigrationProjects = z.infer<typeof liveMigrationProjectsSchema>;

async function optionalProjectJson(file: string) {
  try {
    if ((await stat(file)).size > 512 * 1024)
      throw new AppError('项目配置超过在线迁移大小上限', 413);
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readLiveMigrationProjects(id: string) {
  const directory = vmDir(id);
  const [indexRaw, defaultRaw] = await Promise.all([
    optionalProjectJson(join(directory, 'projects.json')),
    optionalProjectJson(join(directory, 'project.json')),
  ]);
  if (indexRaw === undefined && defaultRaw === undefined) return undefined;
  const index = projectIndexSchema.parse(indexRaw || {
    active: 'default', projects: [{ id: 'default', name: '默认项目' }],
  });
  const configs: Record<string, z.infer<typeof projectSchema>> = {};
  if (defaultRaw !== undefined) configs.default = projectSchema.parse(defaultRaw);
  for (const entry of index.projects) {
    if (entry.id === 'default') continue;
    const raw = await optionalProjectJson(join(directory, `project-${entry.id}.json`));
    if (raw !== undefined) configs[entry.id] = projectSchema.parse(raw);
  }
  const projects = liveMigrationProjectsSchema.parse({ ...index, configs });
  if (Object.values(projects.configs).some((project) =>
    Object.keys(project.secrets || {}).length ||
    (project.services || []).some((service) => Object.keys(service.secrets || {}).length)))
    throw new AppError('项目引用了宿主私密配置，尚不能在线迁移', 409);
  return projects;
}
