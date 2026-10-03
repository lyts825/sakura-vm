import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, ROOT } from './model.ts';

export const singleAppAssetNames = ['controller.py', 'directory-view.py', 'sources.json'] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const singleAppManifestSchema = z.object({ version: z.literal(1), build: digest,
  files: z.array(z.object({ name: z.enum(singleAppAssetNames), size: z.number().int().min(1).max(262144),
    sha256: digest }).strict()).length(3),
}).strict().refine(value => value.files.every((file, index) => file.name === singleAppAssetNames[index]));

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
