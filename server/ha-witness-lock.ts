import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { AppError } from './model.ts';

type Owner = { version: 1; host: string; pid: number; token: string };

function livePid(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // EPERM and every ambiguous result must be treated as a live owner.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** One authority per canonical state file. Kernel IPC serializes local stale-lock recovery. */
export async function lockHaWitnessState(file: string) {
  const canonical = await realpath(file);
  const info = await lstat(canonical);
  if (!info.isFile() || info.nlink !== 1)
    throw new AppError('见证状态须为独立普通文件，不能使用硬链接', 503, 'HA_WITNESS_STATE_LOCKED');
  const key = createHash('sha256').update(process.platform === 'win32'
    ? canonical.toLowerCase() : canonical).digest('hex');
  const ipcPath = process.platform === 'win32' ? `\\\\.\\pipe\\sakura-ha-${key}`
    : process.platform === 'linux' ? `\0sakura-ha-${key}` : null;
  if (!ipcPath)
    throw new AppError('见证状态独占锁支持 Windows 和 Linux 第三节点', 503,
      'HA_WITNESS_STATE_LOCKED');
  // Named pipes and Linux abstract sockets disappear on process death. Never
  // decide that an authority has died merely because a lock file is absent.
  const mutex = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new AppError('已有见证进程占用此状态文件', 503,
        'HA_WITNESS_STATE_LOCKED'));
      mutex.once('error', fail);
      mutex.listen(ipcPath, () => { mutex.off('error', fail); resolve(); });
    });
  } catch (error) { mutex.close(); throw error; }
  mutex.unref();
  const lockFile = `${canonical}.lock`;
  const owner: Owner = { version: 1, host: hostname(), pid: process.pid, token: randomUUID() };
  let acquired = false;
  const closeMutex = async () => {
    await new Promise<void>((resolve) => mutex.close(() => resolve()));
  };
  try {
    try {
      const text = await readFile(lockFile, 'utf8');
      let raw: unknown;
      try { raw = JSON.parse(text); }
      catch { throw new AppError('见证状态锁损坏；不能自动接管', 503, 'HA_WITNESS_STATE_LOCKED'); }
      const previous = raw as Partial<Owner> | null;
      if (previous?.version !== 1 || typeof previous.host !== 'string' ||
          !Number.isSafeInteger(previous.pid) || (previous.pid || 0) <= 0 ||
          typeof previous.token !== 'string' ||
          previous.host !== owner.host || livePid(previous.pid!))
        throw new AppError('见证状态锁的原持有者仍存活或身份不明；不能自动接管', 503,
          'HA_WITNESS_STATE_LOCKED');
      // All local contenders hold this same kernel mutex before inspecting or
      // removing a dead local owner's record. A remote owner is never reclaimed.
      await unlink(lockFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFile(lockFile, JSON.stringify(owner), { flag: 'wx', mode: 0o600, flush: true });
    acquired = true;
  } catch (error) {
    await closeMutex();
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new AppError('另一见证节点已占用此状态文件', 503, 'HA_WITNESS_STATE_LOCKED');
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      if (acquired) {
        const current = JSON.parse(await readFile(lockFile, 'utf8')) as Owner;
        if (current.token !== owner.token)
          throw new AppError('见证状态锁的持有者发生变化，须人工核对', 503,
            'HA_WITNESS_STATE_LOCKED');
        await unlink(lockFile);
      }
    } finally { await closeMutex(); }
  };
}
