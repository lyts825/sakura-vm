import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = join(process.cwd(), 'native', 'project-identity');
const target = join(process.cwd(), '.sakura-server', 'assets', 'project-identity');
const build = createHash('sha256'), files = [];
await mkdir(target, { recursive: true });
for (const name of ['protocol.h', 'launcher.c', 'controller.py']) {
  const bytes = await readFile(join(source, name));
  build.update(name).update(bytes);
  files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(join(target, name), bytes);
}
await writeFile(join(target, 'manifest.json'),
  JSON.stringify({ version: 1, build: build.digest('hex'), files }, null, 2) + '\n');
