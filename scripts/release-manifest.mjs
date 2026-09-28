import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export const releaseEntries = [
  '.sakura-server', 'dist', 'browser-extension', 'scripts', 'package.json',
  'package-lock.json', 'README.md',
];

export function inside(root, path) {
  const base = resolve(root), target = resolve(path);
  const prefix = process.platform === 'win32' ? base.toLowerCase() : base;
  const checked = process.platform === 'win32' ? target.toLowerCase() : target;
  return checked.startsWith(prefix + sep);
}

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function list(root, part, files) {
  const path = join(root, part);
  if (!inside(root, path)) throw new Error('发行包路径越界');
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`发行包不允许链接：${part}`);
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) await list(root, join(part, entry), files);
  } else if (info.isFile()) {
    files.push({ path: relative(root, path).split(sep).join('/'), size: info.size,
      sha256: await sha256(path) });
  } else throw new Error(`发行包包含特殊文件：${part}`);
}

export async function releaseFiles(root) {
  const files = [];
  for (const entry of releaseEntries) await list(root, entry, files);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export async function writeReleaseManifest(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files = await releaseFiles(root);
  const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const manifest = { schemaVersion: 1, name: 'sakura-vm', version: pkg.version,
    fingerprint, files };
  await writeFile(join(root, 'sakura-release.json'), JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' });
  return manifest;
}

export async function verifyReleaseManifest(root) {
  const raw = await readFile(join(root, 'sakura-release.json'), 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.schemaVersion !== 1 || manifest.name !== 'sakura-vm' ||
      typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version) ||
      !/^[a-f0-9]{64}$/.test(manifest.fingerprint) || !Array.isArray(manifest.files))
    throw new Error('发行包清单无效');
  const files = await releaseFiles(root);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files))
    throw new Error('发行包文件与 SHA-256 清单不符');
  if (createHash('sha256').update(JSON.stringify(files)).digest('hex') !== manifest.fingerprint)
    throw new Error('发行包摘要不符');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== manifest.name || pkg.version !== manifest.version)
    throw new Error('发行包版本与 package.json 不符');
  return manifest;
}
