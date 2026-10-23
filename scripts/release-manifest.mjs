/** 发行清单读写与核实：拒绝链接和特殊文件，以有序逐文件摘要绑定允许的安装入口及包版本。
 * Enumerate allowed release files, reject links/special objects and generate/verify deterministic size/hash/version fingerprints. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const legacyReleaseEntries = [
  '.sakura-server', 'dist', 'browser-extension', 'scripts', 'package.json',
  'package-lock.json', 'README.md',
];
export const releaseEntries = [...legacyReleaseEntries, '.sakura-witness'];

/** 按发行包 schema 选择明确允许的根条目，旧布局与带见证的新布局分别核实。
 * Select the explicitly allowed release root entries by schema, validating legacy and witness layouts separately. */
export function releaseEntriesFor(schemaVersion) {
  if (schemaVersion === 1) return legacyReleaseEntries;
  if (schemaVersion === 2) return releaseEntries;
  throw new Error('发行包清单版本无效');
}

/** 判断路径是否位于指定根内，处理平台绝对路径与父目录跳出，不依赖字符串前缀。
 * Check containment by path relations, accounting for platform absolute paths and parent escape rather than string prefixes. */
export function inside(root, path) {
  const base = resolve(root), target = resolve(path);
  const prefix = process.platform === 'win32' ? base.toLowerCase() : base;
  const checked = process.platform === 'win32' ? target.toLowerCase() : target;
  return checked.startsWith(prefix + sep);
}

/** 计算实际输入字节的 SHA-256，作为清单内容身份。
 * Hash actual bytes with SHA-256 for manifest content identity. */
export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** 递归列举允许发行条目，lstat 拒绝链接/特殊对象并核对根边界，返回稳定相对路径。
 * Recursively enumerate allowed release entries, refusing links/special objects via lstat and checking containment for stable relative paths. */
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

/** 枚举全部发行文件并读取大小/摘要，排序后用于内容指纹，不能漏掉后加文件。
 * Enumerate all release files with sizes/hashes in stable order for the content fingerprint, including newly added files. */
export async function releaseFiles(root, schemaVersion = 2) {
  const files = [];
  for (const entry of releaseEntriesFor(schemaVersion)) await list(root, entry, files);
  if (schemaVersion === 2 && !files.some((file) => file.path === '.sakura-witness/ha-witness.js'))
    throw new Error('发行包缺少见证程序入口');
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** 校验发行布局与包版本后生成稳定清单及聚合指纹，独占写入防止覆盖已有记录。
 * Validate layout/package version and generate deterministic manifest/fingerprint with exclusive writing to avoid overwriting records. */
export async function writeReleaseManifest(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files = await releaseFiles(root);
  const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const manifest = { schemaVersion: 2, name: 'sakura-vm', version: pkg.version,
    fingerprint, files };
  await writeFile(join(root, 'sakura-release.json'), JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' });
  return manifest;
}

/** 重枚举实际发行文件并核对版本、逐文件大小/摘要与聚合指纹，任何新增、缺失或篡改都拒绝。
 * Re-enumerate actual files and verify version/sizes/hashes/fingerprint, rejecting additions, omissions or tampering. */
export async function verifyReleaseManifest(root) {
  // 重新枚举允许的发行入口，整份有序清单逐字比较，同时发现增删文件和字节篡改。
  const manifestPath = join(root, 'sakura-release.json'), manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('发行清单必须是普通文件');
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (![1, 2].includes(manifest.schemaVersion) || manifest.name !== 'sakura-vm' ||
      typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version) ||
      !/^[a-f0-9]{64}$/.test(manifest.fingerprint) || !Array.isArray(manifest.files))
    throw new Error('发行包清单无效');
  const files = await releaseFiles(root, manifest.schemaVersion);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files))
    throw new Error('发行包文件与 SHA-256 清单不符');
  if (createHash('sha256').update(JSON.stringify(files)).digest('hex') !== manifest.fingerprint)
    throw new Error('发行包摘要不符');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== manifest.name || pkg.version !== manifest.version)
    throw new Error('发行包版本与 package.json 不符');
  return manifest;
}
