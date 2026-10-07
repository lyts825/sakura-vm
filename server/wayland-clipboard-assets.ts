/**
 * 模块职责：读取并校验 Wayland 剪贴板固定资源，逐文件及聚合摘要必须匹配发布清单。
 * Module purpose: Reads/verifies fixed Wayland assets with per-file and aggregate release-manifest digests.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT } from './paths.ts';
import { AppError } from '../shared/errors.ts';

export const waylandAssetNames = [
  'controller.py',
  'proxy.py',
  'sources.json',
  'wayland.xml',
  'xdg-shell.xml',
  'viewporter.xml',
  'presentation-time.xml',
  'primary-selection-unstable-v1.xml',
  'xdg-decoration-unstable-v1.xml',
  'xdg-output-unstable-v1.xml',
  'relative-pointer-unstable-v1.xml',
  'pointer-constraints-unstable-v1.xml',
  'pointer-gestures-unstable-v1.xml',
  'text-input-unstable-v3.xml',
  'linux-dmabuf-unstable-v1.xml',
  'fractional-scale-v1.xml',
  'cursor-shape-v1.xml',
  'xdg-activation-v1.xml',
  'ext-data-control-v1.xml',
  'tablet-unstable-v2.xml',
] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const waylandManifestSchema = z
  .object({
    version: z.literal(1),
    build: digest,
    files: z
      .array(
        z.object({
          name: z.enum(waylandAssetNames),
          size: z.number().int().min(1).max(262144),
          sha256: digest,
        }).strict(),
      )
      .length(waylandAssetNames.length),
  })
  .strict()
  .refine((value) => new Set(value.files.map((file) => file.name)).size === waylandAssetNames.length);

/**
 * 入口 / Entry: waylandSourceBundle.
 * 功能：在读取并校验 Wayland 剪贴板固定资源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ manifest, files, directory: `/usr/local/lib/sakura-wayland-clipboard/${manifest.build}` }` 供上层消费（`wayland-clipboard-assets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `wayland-clipboard-assets.ts`; this entry produces `{ manifest, files, directory: `/usr/local/lib/sakura-wayland-clipboard/${manifest.build}` }` for its caller. Module context: Reads/verifies fixed Wayland assets with per-file and aggregate release-manifest digests.
 * 处理：通过 `waylandManifestSchema.parse`, `readFile`, `join`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `waylandManifestSchema.parse`, `readFile`, `join`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: directory: default=join(ROOT, '.sakura-server/assets/wayland-clipboard')
 * 输出 / Returns: `{ manifest, files, directory: `/usr/local/lib/sakura-wayland-clipboard/${manifest.build}` }`.
 * 副作用 / Effects: `createHash`; `createHash().update().digest`; `createHash().update`; `build.update().update`; `build.update`.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256`; `build.digest('hex') !== manifest.build`; 异常 / errors `new AppError('Wayland 剪贴板源码摘要不符', 503)`; `new AppError('Wayland 剪贴板版本摘要不符', 503)`.
 */
export async function waylandSourceBundle(directory = join(ROOT, '.sakura-server/assets/wayland-clipboard')) {
  const manifest = waylandManifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
  const files = new Map<string, Buffer>(), build = createHash('sha256');
  for (const name of waylandAssetNames) {
    const bytes = await readFile(join(directory, name)), expected = manifest.files.find((file) => file.name === name)!;
    if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256)
      throw new AppError('Wayland 剪贴板源码摘要不符', 503);
    build.update(name).update(bytes);
    files.set(name, bytes);
  }
  if (build.digest('hex') !== manifest.build) throw new AppError('Wayland 剪贴板版本摘要不符', 503);
  return { manifest, files, directory: `/usr/local/lib/sakura-wayland-clipboard/${manifest.build}` };
}
