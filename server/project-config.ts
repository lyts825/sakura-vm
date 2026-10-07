/**
 * 模块职责：定义项目配置及内容版本，校验目录与私有网络的预览端口约束。
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { guestPath } from '../shared/paths.ts';
import { environmentSchema, serviceOrder, serviceSchema } from './project-services.ts';
import { repositoryUrl } from './repository-url.ts';
import { runtimesSchema } from './runtime-config.ts';
import { secretRefsSchema } from './secrets.ts';

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
export const projectVersion = (project: Project) =>
  createHash('sha256').update(JSON.stringify(project)).digest('hex');
