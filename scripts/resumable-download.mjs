/** CLI 可恢复文件下载，按清单逐块核对 SHA-256 并复用有效块，完整校验后原子发布且拒绝覆盖已有目标。
 * Resume manifest-bound chunks with per-chunk/whole-file hashes, fsync partial data and publish the completed file atomically without overwriting. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, lstat, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

/** 返回字节的 SHA-256，用于逐块与整文件完整性核对。
 * Return SHA-256 for chunk/whole-file integrity verification. */
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** lstat 观察目标对象，只有 ENOENT 代表缺失，其他错误继续抛出，避免将权限问题当可创建路径。
 * Observe targets with lstat; only ENOENT means absence while other errors propagate rather than authorizing creation. */
const existing = (path) =>
  lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
/** 把 VM/路径与块清单绑定到续传元数据，重验已有块后仅补缺块并同步；核对整文件摘要后用同目录 link 原子不覆盖发布，失败保留可验证续传证据。
 * Bind VM/path/chunk manifest to resume metadata, revalidate existing chunks and fetch/fsync missing ones; after whole-file hashing, publish via atomic no-overwrite same-directory link and retain verifiable resume evidence on failure. */
export async function resumableDownload(api, vmId, path, destination) {
  const output = resolve(destination),
    partial = output + '.sakura-part',
    metadata = partial + '.json';
  if (await existing(output)) throw new Error('目标文件已存在，拒绝覆盖');
  const endpoint = `/vms/${encodeURIComponent(vmId)}/download-chunks?path=${encodeURIComponent(path)}`;
  const manifest = await api(endpoint);
  if (
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 0 ||
    manifest.size > 2 * 1024 ** 3 ||
    manifest.chunkBytes !== 1024 ** 2 ||
    !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !== Math.ceil(manifest.size / manifest.chunkBytes) ||
    ![manifest.sha256, ...manifest.chunks].every((value) => /^[a-f0-9]{64}$/.test(value))
  )
    throw new Error('服务返回了无效下载清单');
  const owner = { vmId, path, manifest },
    // 续传记录绑定实例、远端路径及全部块摘要；远端变化时保留旧部分文件并要求新目标。
    previous = await existing(metadata),
    file = await existing(partial);
  if (previous) {
    if (!previous.isFile() || previous.isSymbolicLink() || previous.size > 512 * 1024)
      throw new Error('下载续传记录无效');
    const saved = JSON.parse(await readFile(metadata, 'utf8'));
    if (JSON.stringify(saved) !== JSON.stringify(owner))
      throw new Error('远端文件已变化或目标属于其他下载，请选择新文件名');
    if (file && (!file.isFile() || file.isSymbolicLink())) throw new Error('续传文件必须是普通文件');
  } else {
    if (file) throw new Error('部分文件缺少续传记录，拒绝覆盖');
    await writeFile(metadata, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  }
  const handle = await open(partial, file ? 'r+' : 'wx', 0o600);
  let received = 0,
    downloaded = 0;
  try {
    const size = (await handle.stat()).size;
    for (let index = 0; index < manifest.chunks.length; index++) {
      const offset = index * manifest.chunkBytes,
        count = Math.min(manifest.chunkBytes, manifest.size - offset);
      let data = Buffer.alloc(count),
        valid = false;
      if (offset + count <= size) {
        let read = 0;
        while (read < count) {
          const result = await handle.read(data, read, count - read, offset + read);
          if (!result.bytesRead) break;
          read += result.bytesRead;
        }
        valid = read === count && sha(data) === manifest.chunks[index];
      }
      if (!valid) {
        const chunk = await api(endpoint + '&chunk=' + index);
        data = Buffer.from(chunk.data || '', 'base64');
        if (chunk.index !== index || data.length !== count || sha(data) !== manifest.chunks[index])
          throw new Error('下载分块校验失败，已保留可续传内容');
        let written = 0;
        while (written < data.length) {
          const result = await handle.write(data, written, data.length - written, offset + written);
          if (!result.bytesWritten) throw new Error('写入下载文件失败');
          written += result.bytesWritten;
        }
        await handle.sync();
        downloaded++;
      }
      received += count;
    }
    await handle.truncate(manifest.size);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(partial)) hash.update(chunk);
  if (hash.digest('hex') !== manifest.sha256) throw new Error('完整下载校验失败，保留部分文件供重试');
  // Same-directory hard-link publication is atomic and refuses an existing destination.
  await link(partial, output);
  await unlink(partial);
  await unlink(metadata);
  return {
    output,
    bytes: received,
    sha256: manifest.sha256,
    downloadedChunks: downloaded,
    reusedChunks: manifest.chunks.length - downloaded,
  };
}
