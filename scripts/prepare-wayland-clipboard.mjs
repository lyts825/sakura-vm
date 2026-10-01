import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = join(process.cwd(), 'native/wayland-clipboard');
const target = join(process.cwd(), '.sakura-server/assets/wayland-clipboard');
const metadata = JSON.parse(await readFile(join(source, 'sources.json'), 'utf8'));
if (metadata.version !== 1 || metadata.files.length !== 17 ||
    new Set(metadata.files.map(file => file.name)).size !== metadata.files.length)
  throw new Error('Wayland protocol provenance is invalid');
const build = createHash('sha256'), files = [];
await mkdir(target, { recursive: true });
for (const name of ['controller.py', 'proxy.py', 'sources.json', ...metadata.files.map(file => file.name)]) {
  if (!/^[a-z0-9-]+\.(py|json|xml)$/.test(name)) throw new Error('Invalid Wayland asset name');
  const bytes = await readFile(join(source, name));
  const digest = createHash('sha256').update(bytes).digest('hex');
  const original = metadata.files.find(file => file.name === name);
  if (original && (original.size !== bytes.length || original.sha256 !== digest))
    throw new Error(`Pinned Wayland protocol changed: ${name}`);
  if (bytes.length < 1 || bytes.length > 262144) throw new Error('Wayland source size is invalid');
  build.update(name).update(bytes);
  files.push({ name, size: bytes.length, sha256: digest });
  await writeFile(join(target, name), bytes);
}
await writeFile(join(target, 'manifest.json'),
  JSON.stringify({ version: 1, build: build.digest('hex'), files }, null, 2) + '\n');
