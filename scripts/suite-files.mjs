/** CLI 材料文件的有界读取及原文件身份核销。 */
import { lstat, open, unlink } from 'node:fs/promises';
export async function readSuiteFile(file, maximumBytes) {
  const original = await lstat(file);
  if (!original.isFile() || original.isSymbolicLink() || original.size > maximumBytes)
    throw new Error('材料须为限定大小的普通文件');
  const handle = await open(file, 'r');
  try {
    const bound = await handle.stat();
    if (
      !bound.isFile() ||
      bound.ino !== original.ino ||
      bound.dev !== original.dev ||
      bound.size !== original.size
    )
      throw new Error('材料文件身份已变化');
    const bytes = Buffer.alloc(original.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const final = await handle.stat();
    if (
      offset !== original.size ||
      final.size !== original.size ||
      final.mtimeMs !== bound.mtimeMs ||
      final.ctimeMs !== bound.ctimeMs
    )
      throw new Error('材料读取期间发生变化');
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
export async function removeSuitePartial(file, identity) {
  const info = await lstat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!info) return;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.ino !== identity.ino ||
    info.dev !== identity.dev
  )
    throw Object.assign(new Error('输出文件身份已变化，保留原路径等待核对'), { exitCode: 4 });
  await unlink(file);
}
