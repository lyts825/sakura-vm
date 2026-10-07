/**
 * 模块职责：独占保护见证持久状态文件，拒绝硬链接以避免多个名称共享不可核对的状态。
 * Module purpose: Exclusively locks durable witness files and refuses hard links that create ambiguous shared state names.
 */
import { networkFor } from './network/index.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, unlink, writeFile } from 'node:fs/promises';

import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { AppError } from '../shared/errors.ts';

const { createServer } = networkFor('core:ha-witness-lock');

type Owner = { version: 1; host: string; pid: number; token: string };

/**
 * 入口 / Entry: livePid.
 * 功能：在独占保护见证持久状态文件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` / `(error as NodeJS.ErrnoException).code !== 'ESRCH'` 供上层消费（`ha-witness-lock.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-lock.ts`; this entry produces `true` / `(error as NodeJS.ErrnoException).code !== 'ESRCH'` for its caller. Module context: Exclusively locks durable witness files and refuses hard links that create ambiguous shared state names.
 * 处理：通过 `process.kill` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `process.kill`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: pid: number
 * 输出 / Returns: `true`; `(error as NodeJS.ErrnoException).code !== 'ESRCH'`.
 * 副作用 / Effects: `process.kill`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return (error as NodeJS.ErrnoException).code !== 'ESRCH';`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return (error as NodeJS.ErrnoException).code !== 'ESRCH';`; these statements determine whether a failure is absorbed or rejected again.
 */
function livePid(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // EPERM and every ambiguous result must be treated as a live owner.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** One authority per canonical state file. Kernel IPC serializes local stale-lock recovery. */
/**
 * 入口 / Entry: lockHaWitnessState.
 * 功能：在独占保护见证持久状态文件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `async () => { if (released) return; released = true; try { if (acquired) { const current = JSON.parse(await readFile(lockFile…` 供上层消费（`ha-witness-lock.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-lock.ts`; this entry produces `async () => { if (released) return; released = true; try { if (acquired) { const current = JSON.parse(await readFile(lockFile…` for its caller. Module context: Exclusively locks durable witness files and refuses hard links that create ambiguous shared state names.
 * 处理：通过 `realpath().catch`, `realpath`, `lstat().catch`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `realpath().catch`, `realpath`, `lstat().catch`, `lstat`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; options: { allowMissing?: boolean } default={}
 * 输出 / Returns: `async () => { if (released) return; released = true; try { if (acquired) { const current = JSON.parse(await readFile(lockFile…`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `createServer`; `mutex.close`; 更新 / updates `raw`, `acquired`.
 * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.nlink !== 1)`; `!ipcPath`; `previous?.version !== 1 || typeof previous.host !== 'string' || !Number.isSafeInteger(previous.pid) || (previous.pid || 0) <=…`; 异常 / errors `new AppError('见证状态须为独立普通文件，不能使用硬链接', 503, 'HA_WITNESS_STATE_LOCKED')`; `new AppError('见证状态独占锁支持 Windows 和 Linux 第三节点', 503, 'HA_WITNESS_STATE_LOCKED')`.
 * 失败处理：catch 分支执行 `mutex.close();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `mutex.close();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function lockHaWitnessState(file: string, options: { allowMissing?: boolean } = {}) {
  const canonical = await realpath(file).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.allowMissing) throw error;
    return join(await realpath(dirname(file)), basename(file));
  });
  const info = await lstat(canonical).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.allowMissing) throw error;
    return null;
  });
  if (info && (!info.isFile() || info.nlink !== 1))
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
      /**
       * 入口 / Entry: lockHaWitnessState.fail.
       * 功能：把本层请求转交 `reject`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `reject` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `reject(new AppError('已有见证进程占用此状态文件', 503, 'HA_WITNESS_STATE_LOCKED'))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
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
  /**
   * 入口 / Entry: lockHaWitnessState.closeMutex.
   * 功能：在独占保护见证持久状态文件中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ha-witness-lock.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ha-witness-lock.ts`; the calls and state transitions below complete the operation. Module context: Exclusively locks durable witness files and refuses hard links that create ambiguous shared state names.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
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
  /**
   * 入口 / Entry: lockHaWitnessState.callback@89.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `unlink`; `closeMutex`; 更新 / updates `released`.
   * 拒绝 / Refusals: 条件 / conditions `acquired`; `current.token !== owner.token`; 异常 / errors `new AppError('见证状态锁的持有者发生变化，须人工核对', 503, 'HA_WITNESS_STATE_LOCKED')`.
   * 收尾：退出 try 区域时始终执行 `await closeMutex();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await closeMutex();`; these steps also apply to exceptional exits.
   */
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
