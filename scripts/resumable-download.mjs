import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, lstat, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const existing = (path) =>
  lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
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
