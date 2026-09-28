import { z } from 'zod';
import { AppError } from './model.ts';

const templatePath = z.string().min(1).max(512).refine((value) =>
  !value.startsWith('/') && !value.includes('\\') && !value.includes(':') &&
  !value.split('/').includes('..') && !/[\x00-\x1f]/.test(value),
  '需要模板内的相对路径');

export const devcontainerTemplates = [
  { id: 'debian', name: 'Debian', description: '通用 Debian 开发环境' },
  { id: 'javascript-node', name: 'Node.js', description: 'Node.js 与 JavaScript' },
  { id: 'python', name: 'Python', description: 'Python 3 开发环境' },
  { id: 'go', name: 'Go', description: 'Go 开发环境' },
  { id: 'rust', name: 'Rust', description: 'Rust 开发环境' },
] as const;

export const devcontainerTemplateId = z.enum(
  devcontainerTemplates.map((template) => template.id) as [string, ...string[]],
);
export const devcontainerTemplateVersion = z.string().regex(/^\d+\.\d+\.\d+$/);

const option = z.object({
  type: z.literal('string'),
  default: z.string().max(80),
  proposals: z.array(z.string().max(80)).max(40).optional(),
  enum: z.array(z.string().max(80)).max(40).optional(),
}).passthrough();
const metadataSchema = z.object({
  id: z.string(),
  version: devcontainerTemplateVersion,
  name: z.string().max(120),
  description: z.string().max(1000),
  publisher: z.string(),
  documentationURL: z.url(),
  options: z.record(z.string(), option).default({}),
  optionalPaths: z.array(templatePath).max(100).default([]),
  files: z.array(templatePath).max(300),
}).passthrough();

export function devcontainerTemplateReference(id: string, version?: string) {
  devcontainerTemplateId.parse(id);
  if (version !== undefined) devcontainerTemplateVersion.parse(version);
  return `ghcr.io/devcontainers/templates/${id}${version ? ':' + version : ''}`;
}

export function verifyDevcontainerTemplateMetadata(stdout: string, id: string, version?: string) {
  devcontainerTemplateId.parse(id);
  const line = stdout.trim().split(/\r?\n/).findLast((entry) => entry.startsWith('{'));
  if (!line) throw new AppError('模板源未返回元数据', 502);
  let metadata: z.infer<typeof metadataSchema>;
  try { metadata = metadataSchema.parse(JSON.parse(line)); }
  catch { throw new AppError('模板源元数据无效', 502); }
  if (metadata.id !== id ||
      metadata.publisher !== 'Dev Container Spec Maintainers' ||
      metadata.documentationURL !== `https://github.com/devcontainers/templates/tree/main/src/${id}` ||
      (version && metadata.version !== version) ||
      !metadata.files.includes('.devcontainer/devcontainer.json'))
    throw new AppError('模板来源或版本与官方目录不匹配', 502);
  return {
    id: metadata.id,
    version: metadata.version,
    name: metadata.name,
    description: metadata.description,
    documentationURL: metadata.documentationURL,
    reference: devcontainerTemplateReference(id, metadata.version),
    sourceMatched: true,
    imageVariant: metadata.options.imageVariant
      ? { default: metadata.options.imageVariant.default,
          choices: [...new Set([metadata.options.imageVariant.default,
            ...(metadata.options.imageVariant.enum || metadata.options.imageVariant.proposals || [])])] }
      : undefined,
    optionalPaths: metadata.optionalPaths,
    files: metadata.files,
  };
}

export const devcontainerTemplateApplyInput = z.object({
  action: z.literal('template-apply'),
  templateId: devcontainerTemplateId,
  version: devcontainerTemplateVersion,
  imageVariant: z.string().max(80).optional(),
  omitPaths: z.array(templatePath).max(100).default([]),
}).strict();
