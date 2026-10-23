/** 为单次沙箱执行准备受限文本输入。 Prepare bounded text inputs for one sandbox run. */
import type { VmAccess } from './vm-access.ts';
import { ftpStat } from './files.ts';
import { repairFilesSchema, type RepairFile } from '../shared/contracts/repair-session.ts';
import { AppError } from '../shared/errors.ts';
export const sandboxInputDirectory = '/workspace/sakura-input';
/** 在用户命令前建立私有空目录，逐级拒绝链接并独占创建文件。
 * Before the user command, create a private empty directory, reject links and create files exclusively. */
export async function stageSandboxInputs(machines: VmAccess, id: string, files: RepairFile[], signal: AbortSignal) {
  const input = repairFilesSchema.parse(files), live = machines.live.get(id);
  const created = new Set<string>();
  /** 输入阶段只能作用于捕获的沙箱运行。 Input staging is restricted to the captured sandbox runtime. */
  const check = () => {
    signal.throwIfAborted();
    if (!live || machines.live.get(id) !== live || !machines.get(id).sandbox)
      throw new AppError('沙箱运行身份已变化', 409, 'SANDBOX_INPUT_REFUSED');
  };
  check();
  await machines.sftp(id, async ftp => {
    const workspace = await ftpStat(ftp, '/workspace'); check();
    if (workspace && !workspace.isDirectory()) throw new AppError('沙箱工作目录不能是链接或普通文件', 409);
    if (!workspace) await new Promise<void>((resolve, reject) => ftp.mkdir('/workspace', { mode: 0o700 }, error => error ? reject(error) : resolve()));
    /** 新建目录拒绝覆盖；只有本轮已创建的父目录允许复用。 Refuse existing directories except parents created in this staging pass. */
    const directory = async (path: string) => {
      check();
      if (!created.has(path)) {
        await new Promise<void>((resolve, reject) => ftp.mkdir(path, { mode: 0o700 }, error => error ? reject(error) : resolve()));
        created.add(path);
      }
      const info = await ftpStat(ftp, path); check();
      if (!info?.isDirectory() || (info.mode & 0o777) !== 0o700)
        throw new AppError('沙箱输入目录身份或权限不符合要求', 409);
    };
    await directory(sandboxInputDirectory);
    for (const file of input) {
      let parent = sandboxInputDirectory;
      const parts = file.path.split('/');
      for (const part of parts.slice(0, -1)) { parent += '/' + part; await directory(parent); }
      check();
      const path = parent + '/' + parts.at(-1), data = Buffer.from(file.content);
      const handle = await new Promise<Buffer>((resolve, reject) => ftp.open(path, 'wx', { mode: 0o600 }, (error, value) => error ? reject(error) : resolve(value)));
      try {
        check();
        await new Promise<void>((resolve, reject) => ftp.write(handle, data, 0, data.length, 0, error => error ? reject(error) : resolve()));
      } finally { await new Promise<void>((resolve, reject) => ftp.close(handle, error => error ? reject(error) : resolve())); }
    }
    check();
  }, signal);
}
