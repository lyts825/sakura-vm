/**
 * 模块职责：读取并校验 X11 剪贴板固定资源，固定源码内容必须与发布摘要一致。
 * Module purpose: Reads/verifies fixed X11 clipboard sources against their packaged per-file and aggregate digests.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT } from './paths.ts';
import { AppError } from '../shared/errors.ts';

export const x11AssetNames = ['protocol.h', 'policy.cpp', 'controller.py'] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const x11ManifestSchema = z
  .object({
    version: z.literal(1),
    build: digest,
    files: z
      .array(
        z
          .object({ name: z.enum(x11AssetNames), size: z.number().int().min(1).max(262144), sha256: digest })
          .strict(),
      )
      .length(3),
  })
  .strict()
  .refine((value) => new Set(value.files.map((file) => file.name)).size === 3);

/**
 * 入口 / Entry: x11SourceBundle.
 * 功能：在读取并校验 X11 剪贴板固定资源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ manifest, files, directory: `/usr/local/lib/sakura-x11-clipboard/${manifest.build}` }` 供上层消费（`x11-clipboard-assets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `x11-clipboard-assets.ts`; this entry produces `{ manifest, files, directory: `/usr/local/lib/sakura-x11-clipboard/${manifest.build}` }` for its caller. Module context: Reads/verifies fixed X11 clipboard sources against their packaged per-file and aggregate digests.
 * 处理：通过 `x11ManifestSchema.parse`, `readFile`, `join`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `x11ManifestSchema.parse`, `readFile`, `join`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: directory: default=join(ROOT, '.sakura-server/assets/linux-clipboard')
 * 输出 / Returns: `{ manifest, files, directory: `/usr/local/lib/sakura-x11-clipboard/${manifest.build}` }`.
 * 副作用 / Effects: `createHash`; `createHash().update().digest`; `createHash().update`; `build.update().update`; `build.update`.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256`; `build.digest('hex') !== manifest.build`; 异常 / errors `new AppError('Linux 原生剪贴板源码摘要不符', 503)`; `new AppError('Linux 原生剪贴板版本摘要不符', 503)`.
 */
export async function x11SourceBundle(directory = join(ROOT, '.sakura-server/assets/linux-clipboard')) {
  const manifest = x11ManifestSchema.parse(
    JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')),
  );
  const files = new Map<string, Buffer>(),
    build = createHash('sha256');
  for (const name of x11AssetNames) {
    const bytes = await readFile(join(directory, name)),
      expected = manifest.files.find((file) => file.name === name)!;
    if (
      bytes.length !== expected.size ||
      createHash('sha256').update(bytes).digest('hex') !== expected.sha256
    )
      throw new AppError('Linux 原生剪贴板源码摘要不符', 503);
    build.update(name).update(bytes);
    files.set(name, bytes);
  }
  if (build.digest('hex') !== manifest.build) throw new AppError('Linux 原生剪贴板版本摘要不符', 503);
  return { manifest, files, directory: `/usr/local/lib/sakura-x11-clipboard/${manifest.build}` };
}
