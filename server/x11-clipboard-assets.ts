import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT, AppError } from './model.ts';

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
