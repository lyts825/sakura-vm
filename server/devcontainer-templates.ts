/**
 * 模块职责：声明受支持的 Dev Container 模板及版本规则，应用前核对模板元数据。
 * Module purpose: Declares supported Dev Container templates and version rules, checking provider metadata before application.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';

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

/**
 * 入口 / Entry: devcontainerTemplateReference.
 * 功能：在声明受支持的 Dev Container 模板及版本规则中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``ghcr.io/devcontainers/templates/${id}${version ? ':' + version : ''}`` 供上层消费（`devcontainer-templates.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `devcontainer-templates.ts`; this entry produces ``ghcr.io/devcontainers/templates/${id}${version ? ':' + version : ''}`` for its caller. Module context: Declares supported Dev Container templates and version rules, checking provider metadata before application.
 * 处理：通过 `devcontainerTemplateId.parse`, `devcontainerTemplateVersion.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `devcontainerTemplateId.parse`, `devcontainerTemplateVersion.parse`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `version !== undefined`.
 * 输入 / Inputs: id: string; version: string optional
 * 输出 / Returns: ``ghcr.io/devcontainers/templates/${id}${version ? ':' + version : ''}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function devcontainerTemplateReference(id: string, version?: string) {
  devcontainerTemplateId.parse(id);
  if (version !== undefined) devcontainerTemplateVersion.parse(version);
  return `ghcr.io/devcontainers/templates/${id}${version ? ':' + version : ''}`;
}

/**
 * 入口 / Entry: verifyDevcontainerTemplateMetadata.
 * 功能：在声明受支持的 Dev Container 模板及版本规则中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ id: metadata.id, version: metadata.version, name: metadata.name, description: metadata.description, documentationURL: metad…` 供上层消费（`devcontainer-templates.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `devcontainer-templates.ts`; this entry produces `{ id: metadata.id, version: metadata.version, name: metadata.name, description: metadata.description, documentationURL: metad…` for its caller. Module context: Declares supported Dev Container templates and version rules, checking provider metadata before application.
 * 处理：通过 `devcontainerTemplateId.parse`, `stdout.trim().split().findLast`, `stdout.trim().split`, `stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `devcontainerTemplateId.parse`, `stdout.trim().split().findLast`, `stdout.trim().split`, `stdout.trim`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: stdout: string; id: string; version: string optional
 * 输出 / Returns: `{ id: metadata.id, version: metadata.version, name: metadata.name, description: metadata.description, documentationURL: metad…`.
 * 副作用 / Effects: 更新 / updates `metadata`.
 * 拒绝 / Refusals: 条件 / conditions `!line`; `metadata.id !== id || metadata.publisher !== 'Dev Container Spec Maintainers' || metadata.documentationURL !== `https://githu…`; 异常 / errors `new AppError('模板源未返回元数据', 502)`; `new AppError('模板源元数据无效', 502)`.
 * 失败处理：catch 分支执行 `throw new AppError('模板源元数据无效', 502);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('模板源元数据无效', 502);`; these statements determine whether a failure is absorbed or rejected again.
 */
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
