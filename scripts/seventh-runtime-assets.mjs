/** 固定原生资源只按清单读取或复制；此入口不启动解释器、辅助程序或网络。 */
import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHash(path, maximum) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum)
    throw new Error(`原生资源身份或大小无效：${path}`);
  const handle = await open(path, 'r'), hash = createHash('sha256');
  const same = value => value.dev === before.dev && value.ino === before.ino && value.size === before.size && value.mtimeMs === before.mtimeMs && value.ctimeMs === before.ctimeMs;
  try {
    if (!same(await handle.stat())) throw new Error('原生资源在打开时变化');
    const buffer = Buffer.alloc(1024 * 1024); let offset = 0;
    for (;;) { const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead; if (offset > before.size) throw new Error('原生资源在读取时增长'); }
    if (offset !== before.size || !same(await handle.stat()) || !same(await lstat(path))) throw new Error('原生资源在读取时变化');
    return {bytes: offset, sha256: hash.digest('hex')};
  } finally { await handle.close(); }
}
async function entries(root, prefix = '') {
  const info = await lstat(root); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('原生资源目录不能是链接');
  const result = [];
  for (const entry of await readdir(root, {withFileTypes:true})) {
    const part = prefix + entry.name, path = join(root, entry.name), info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`原生资源不允许链接：${part}`);
    if (info.isDirectory()) result.push(...await entries(path, part + '/'));
    else if (info.isFile()) result.push(part); else throw new Error(`原生资源不是普通文件：${part}`);
  }
  return result.sort();
}
export async function verifySeventhNative(assetRoot, {worker, source} = {}) {
  const root = resolve(assetRoot), manifestInfo = await lstat(join(root, 'runtime-manifest.json'));
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 4 * 1024 ** 2) throw new Error('原生资源清单无效');
  const raw = await readFile(join(root, 'runtime-manifest.json')), manifest = JSON.parse(raw);
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.architecture !== 'x64' || manifest.backend !== 'windows-appcontainer-job' || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10000 || !Number.isSafeInteger(manifest.runtimeBytes)) throw new Error('原生资源清单架构无效');
  const expected = new Set(['runtime-manifest.json', 'sandbox.exe', 'seventh-creation-native-worker.py']); let bytes = 0;
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[-.a-zA-Z0-9_ /+]+$/.test(entry.path) || entry.path.split('/').some(p => !p || p === '.' || p === '..') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('原生资源清单路径无效');
    const path = resolve(root, 'runtime', entry.path), part = relative(join(root, 'runtime'), path);
    if (!part || part.startsWith('..') || isAbsolute(part) || expected.has('runtime/' + entry.path.toLowerCase())) throw new Error('原生资源路径越界或重复');
    expected.add('runtime/' + entry.path.toLowerCase());
    const actual = await fileHash(path, entry.bytes); if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error(`原生资源摘要不符：${entry.path}`); bytes += actual.bytes;
  }
  if (bytes !== manifest.runtimeBytes) throw new Error('原生运行时总字节不符');
  const helper = await fileHash(join(root, 'sandbox.exe'), 16 * 1024 ** 2), fixedWorker = await fileHash(join(root, 'seventh-creation-native-worker.py'), 1024 * 1024);
  if (helper.sha256 !== manifest.helperSha256 || fixedWorker.sha256 !== manifest.workerSha256) throw new Error('原生辅助程序或 worker 摘要不符');
  if (worker && digest(await readFile(worker)) !== manifest.workerSha256) throw new Error('原生 worker 与发布源码不符');
  if (source && digest(await readFile(source)) !== manifest.sourceSha256) throw new Error('原生辅助程序与发布源码不符');
  const actual = await entries(root); if (actual.length !== expected.size || actual.some(p => !expected.has(p.toLowerCase()))) throw new Error('原生目录有未登记或缺失文件');
  return {manifestDigest:digest(raw), helperDigest:helper.sha256, workerDigest:fixedWorker.sha256, runtimeBytes:bytes, assetBytes:bytes + helper.bytes + fixedWorker.bytes + raw.length, files:actual.length, platform:'win32', architecture:'x64', backend:manifest.backend};
}
export async function copySeventhNative(source, target, options = {}) {
  const result = await verifySeventhNative(source, options), manifest = JSON.parse(await readFile(join(source, 'runtime-manifest.json')));
  await mkdir(target, {recursive:true});
  // Only enumerated files are copied; no caches, local models, or VM test images enter a release.
  for (const part of ['runtime-manifest.json', 'sandbox.exe', 'seventh-creation-native-worker.py', ...manifest.files.map(f => 'runtime/' + f.path)]) {
    const output = join(target, part); await mkdir(resolve(output, '..'), {recursive:true}); await copyFile(join(source, part), output);
  }
  const copied = await verifySeventhNative(target, options); if (JSON.stringify(result) !== JSON.stringify(copied)) throw new Error('原生资源复制后摘要变化'); return copied;
}
