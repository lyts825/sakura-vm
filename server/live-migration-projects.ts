/**
 * 模块职责：读取在线迁移所需项目配置，限制配置大小并验证其与项目目录的关系。
 * Module purpose: Reads project state for live migration within size bounds and validates project-directory relationships.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { projectIdSchema, projectIndexSchema } from './project-catalog.ts';
import { projectSchema } from './project-config.ts';

export const liveMigrationProjectsSchema = projectIndexSchema.safeExtend({
  configs: z.record(projectIdSchema, projectSchema),
}).refine((value) => Object.keys(value.configs).every((id) =>
  value.projects.some((entry) => entry.id === id)), '项目配置不属于项目目录')
  .refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 512 * 1024,
    '项目配置超过在线迁移大小上限');
export type LiveMigrationProjects = z.infer<typeof liveMigrationProjectsSchema>;

/**
 * 入口 / Entry: optionalProjectJson.
 * 功能：在读取在线迁移所需项目配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.parse(await readFile(file, 'utf8')) as unknown` / `undefined` 供上层消费（`live-migration-projects.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-projects.ts`; this entry produces `JSON.parse(await readFile(file, 'utf8')) as unknown` / `undefined` for its caller. Module context: Reads project state for live migration within size bounds and validates project-directory relationships.
 * 处理：通过 `stat`, `readFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `stat`, `readFile`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `JSON.parse(await readFile(file, 'utf8')) as unknown`; `undefined`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(await stat(file)).size > 512 * 1024`; 异常 / errors `new AppError('项目配置超过在线迁移大小上限', 413)`; `error`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
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

/**
 * 入口 / Entry: readLiveMigrationProjects.
 * 功能：在读取在线迁移所需项目配置中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `undefined` / `projects` 供上层消费（`live-migration-projects.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `live-migration-projects.ts`; this entry produces `undefined` / `projects` for its caller. Module context: Reads project state for live migration within size bounds and validates project-directory relationships.
 * 处理：通过 `vmDir`, `Promise.all`, `optionalProjectJson`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `vmDir`, `Promise.all`, `optionalProjectJson`, `join`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `indexRaw === undefined && defaultRaw === undefined`; `defaultRaw !== undefined`; `entry.id === 'default'`.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `undefined`; `projects`.
 * 副作用 / Effects: 更新 / updates `configs.default`, `configs[entry.id]`.
 * 拒绝 / Refusals: 条件 / conditions `Object.values(projects.configs).some((project) => Object.keys(project.secrets || {}).length || (project.services || []).some(…`; 异常 / errors `new AppError('项目引用了宿主私密配置，尚不能在线迁移', 409)`.
 */
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
