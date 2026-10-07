/**
 * 模块职责：定义项目配置及内容版本，校验目录与私有网络的预览端口约束。
 * Module purpose: Defines project configuration/content versions and validates directory/private-network preview constraints.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { guestPath } from '../shared/paths.ts';
import { environmentSchema, serviceOrder, serviceSchema } from './project-services.ts';
import { repositoryUrl } from './repository-url.ts';
import { runtimesSchema } from './runtime-config.ts';
import { secretRefsSchema } from './secrets.ts';

/**
 * 入口 / Entry: callback@37.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: project; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['services'] });`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['services'] });`; these statements determine whether a failure is absorbed or rejected again.
 */
export const projectSchema = z
  .object({
    directory: z
      .string()
      .default('/workspace')
      .refine((value) => {
        try {
          guestPath(value);
          return true;
        } catch {
          return false;
        }
      }, '需要有效的 Linux 绝对路径'),
    template: z.enum(['none', 'node', 'python', 'rust']).default('none'),
    repository: z.union([z.literal(''), repositoryUrl]).default(''),
    setup: z.string().max(8192).default(''),
    command: z.string().max(8192).default(''),
    previewPort: z.number().int().min(1024).max(65535).optional(),
    networkIsolation: z.enum(['host', 'private']).optional(),
    environment: environmentSchema.optional(),
    secrets: secretRefsSchema.optional(),
    runtimes: runtimesSchema.optional(),
    services: z.array(serviceSchema).max(12).optional(),
  })
  .strict()
  .superRefine((project, ctx) => {
    try {
      serviceOrder(project.services || []);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['services'] });
    }
    if (project.networkIsolation === 'private' && project.previewPort)
      ctx.addIssue({
        code: 'custom',
        message: '私有网络命名空间不开放 Windows 预览端口',
        path: ['previewPort'],
      });
  });
export type Project = z.infer<typeof projectSchema> & { _workspace?: string };
/**
 * 入口 / Entry: projectVersion.
 * 功能：在定义项目配置及内容版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(project)).digest('hex')` 供上层消费（`project-config.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-config.ts`; this entry produces `createHash('sha256').update(JSON.stringify(project)).digest('hex')` for its caller. Module context: Defines project configuration/content versions and validates directory/private-network preview constraints.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(project)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const projectVersion = (project: Project) =>
  createHash('sha256').update(JSON.stringify(project)).digest('hex');
