/** 持久正文只写入随机原路径；大小、摘要与独占普通文件身份一并核验。 */
import { createHash } from 'node:crypto';
import { lstat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { imageSafeDirectory } from './image-assets.ts';
import { storageRuntime } from './storage-runtime.ts';
export const executionSha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export class SuiteExecutionFiles {
  constructor(private root: string) {}
  private path(id: string, kind: 'input' | 'output') {
    return join(this.root, z.uuid().parse(id) + '.' + kind + '.json');
  }
  async put(id: string, kind: 'input' | 'output', value: Buffer) {
    const file = this.path(id, kind);
    await imageSafeDirectory(this.root);
    await storageRuntime.run(
      {
        owner: 'core:suite-execution',
        taskId: id,
        label: '固定工具正文持久化',
        paths: [file],
        mode: 'write',
        buffers: value.length,
        files: 1,
      },
      async () => {
        const handle = await open(file, 'wx', 0o600);
        try {
          await handle.writeFile(value);
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
    );
  }
  async read(id: string, kind: 'input' | 'output', digest: string, maximum: number) {
    const file = this.path(id, kind);
    return storageRuntime.run(
      {
        owner: 'core:suite-execution',
        taskId: id,
        label: '读取固定工具正文',
        paths: [file],
        mode: 'read',
        buffers: maximum,
        files: 1,
      },
      async () => {
        const before = await lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum)
          throw new AppError('执行正文文件身份或大小无效', 409, 'SUITE_EXECUTION_MATERIAL_CHANGED');
        const handle = await open(file, 'r');
        try {
          const stat = await handle.stat();
          if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size)
            throw new AppError('执行正文文件被替换', 409, 'SUITE_EXECUTION_MATERIAL_CHANGED');
          const bytes = await handle.readFile(),
            after = await handle.stat(),
            path = await lstat(file);
          if (
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            path.ino !== before.ino ||
            path.dev !== before.dev ||
            executionSha(bytes) !== digest
          )
            throw new AppError('执行正文摘要改变', 409, 'SUITE_EXECUTION_MATERIAL_CHANGED');
          return bytes;
        } finally {
          await handle.close();
        }
      },
    );
  }
  async remove(id: string, kind: 'input' | 'output', digest: string, maximum: number) {
    try {
      await this.read(id, kind, digest, maximum);
      await unlink(this.path(id, kind));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
