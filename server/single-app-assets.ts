/**
 * 模块职责：读取单应用固定资源清单并校验逐文件和聚合摘要，拒绝使用未经验证的源码。
 * Module purpose: Reads fixed single-app manifests and verifies per-file/aggregate digests before accepting source assets.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { ROOT } from './paths.ts';

export const singleAppAssetNames = ['controller.py', 'directory-view.py', 'sources.json'] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const singleAppManifestSchema = z.object({ version: z.literal(1), build: digest,
  files: z.array(z.object({ name: z.enum(singleAppAssetNames), size: z.number().int().min(1).max(262144),
    sha256: digest }).strict()).length(3),
}).strict().refine(value => value.files.every((file, index) => file.name === singleAppAssetNames[index]));

/**
 * 入口 / Entry: singleAppSources.
 * 功能：在读取单应用固定资源清单并校验逐文件和聚合摘要中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ manifest, files, directory: '/usr/local/lib/sakura-single-app/' + manifest.build }` 供上层消费（`single-app-assets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `single-app-assets.ts`; this entry produces `{ manifest, files, directory: '/usr/local/lib/sakura-single-app/' + manifest.build }` for its caller. Module context: Reads fixed single-app manifests and verifies per-file/aggregate digests before accepting source assets.
 * 处理：通过 `singleAppManifestSchema.parse`, `readFile`, `join`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `singleAppManifestSchema.parse`, `readFile`, `join`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: directory: default=join(ROOT, '.sakura-server/assets/single-app')
 * 输出 / Returns: `{ manifest, files, directory: '/usr/local/lib/sakura-single-app/' + manifest.build }`.
 * 副作用 / Effects: `createHash`; `createHash().update().digest`; `createHash().update`; `build.update().update`; `build.update`.
 * 拒绝 / Refusals: 条件 / conditions `raw.length !== expected.size || createHash('sha256').update(raw).digest('hex') !== expected.sha256`; `build.digest('hex') !== manifest.build`; 异常 / errors `new AppError('单应用固定源码摘要不符', 503, 'SINGLE_APP_SOURCE_CHANGED')`; `new AppError('单应用固定源码版本不符', 503, 'SINGLE_APP_SOURCE_CHANGED')`.
 */
export async function singleAppSources(directory = join(ROOT, '.sakura-server/assets/single-app')) {
  const manifest = singleAppManifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
  const build = createHash('sha256'), files = new Map<string, Buffer>();
  for (const name of singleAppAssetNames) {
    const raw = await readFile(join(directory, name)), expected = manifest.files.find(file => file.name === name)!;
    if (raw.length !== expected.size || createHash('sha256').update(raw).digest('hex') !== expected.sha256)
      throw new AppError('单应用固定源码摘要不符', 503, 'SINGLE_APP_SOURCE_CHANGED');
    build.update(name).update(raw);
    files.set(name, raw);
  }
  if (build.digest('hex') !== manifest.build)
    throw new AppError('单应用固定源码版本不符', 503, 'SINGLE_APP_SOURCE_CHANGED');
  return { manifest, files, directory: '/usr/local/lib/sakura-single-app/' + manifest.build };
}
