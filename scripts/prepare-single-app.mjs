import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = join(process.cwd(), 'native/single-app');
const target = join(process.cwd(), '.sakura-server/assets/single-app');
const metadata = JSON.parse(await readFile(join(source, 'sources.json'), 'utf8'));
if (metadata.version !== 1 || metadata.directoryViewOrigin !== 'native/wayland-clipboard/controller.py' ||
    !/^[a-f0-9]{64}$/.test(metadata.originControllerSha256) || !/^[a-f0-9]{64}$/.test(metadata.functionAstSha256) ||
    !Array.isArray(metadata.functions) || new Set(metadata.functions).size !== metadata.functions.length)
  throw new Error('Single-app directory view provenance is invalid');
const build = createHash('sha256'), files = [];
await mkdir(target, { recursive: true });
for (const name of ['controller.py', 'directory-view.py', 'sources.json']) {
  const bytes = await readFile(join(source, name));
  if (!bytes.length || bytes.length > 262144) throw new Error('Single-app source size is invalid');
  build.update(name).update(bytes);
  files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(join(target, name), bytes);
}
await writeFile(join(target, 'manifest.json'), JSON.stringify({ version: 1, build: build.digest('hex'), files }, null, 2) + '\n');
