/**
 * 模块职责：提供本地 JSON 存储与目录检查，原子写入及串行化由元数据层处理。
 * Module purpose: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 */
import { readFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, isAbsolute, resolve } from 'node:path';
import { serializedMetadata } from './metadata-queue.ts';
import { atomicMetadataWrite } from './metadata-io.ts';
import { AppError } from '../shared/errors.ts';

/** 不等待已准入变更，直接读取最后一次原子发布的 JSON，便于持有其他领域租约时重查授权。
 * 该读取不能用于无锁的读改写，变更仍需同文件串行化和对应领域校验。 */
/**
 * 入口 / Entry: readCommittedStore.
 * 功能：在提供本地 JSON 存储与目录检查中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `JSON.parse(await readFile(file, 'utf8'))` / `fallback()` 供上层消费（`local-store.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `local-store.ts`; this entry produces `JSON.parse(await readFile(file, 'utf8'))` / `fallback()` for its caller. Module context: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 * 处理：通过 `readFile`, `fallback` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readFile`, `fallback`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; fallback: () => T
 * 输出 / Returns: Promise<T>；结果来自 / values from `JSON.parse(await readFile(file, 'utf8'))`; `fallback()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return fallback();`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return fallback();`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function readCommittedStore<T>(file: string, fallback: () => T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return fallback();
  }
}
/**
 * 入口 / Entry: readStore.
 * 功能：在提供本地 JSON 存储与目录检查中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `serializedMetadata(target, false, () => readCommittedStore(target, fallback))` 供上层消费（`local-store.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `local-store.ts`; this entry produces `serializedMetadata(target, false, () => readCommittedStore(target, fallback))` for its caller. Module context: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 * 处理：通过 `resolve`, `serializedMetadata` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `resolve`, `serializedMetadata`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; fallback: () => T
 * 输出 / Returns: Promise<T>；结果来自 / values from `serializedMetadata(target, false, () => readCommittedStore(target, fallback))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function readStore<T>(file: string, fallback: () => T): Promise<T> {
  const target = resolve(file);
  return serializedMetadata(target, false, () => readCommittedStore(target, fallback));
}
/**
 * 入口 / Entry: writeStore.
 * 功能：在提供本地 JSON 存储与目录检查中，校验并提交领域状态变更；本入口产生 `serializedMetadata(target, true, (mark) => atomicMetadataWrite(target, contents, undefined, mark))` 供上层消费（`local-store.ts`）。
 * Purpose: Validates and commits a domain state change in `local-store.ts`; this entry produces `serializedMetadata(target, true, (mark) => atomicMetadataWrite(target, contents, undefined, mark))` for its caller. Module context: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 * 处理：通过 `resolve`, `serializedMetadata` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `resolve`, `serializedMetadata`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; value: unknown
 * 输出 / Returns: `serializedMetadata(target, true, (mark) => atomicMetadataWrite(target, contents, undefined, mark))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `contents === undefined`; 异常 / errors `new TypeError('Metadata must be JSON serializable')`.
 */
export async function writeStore(file: string, value: unknown) {
  // 入队前同步序列化，避免调用方后续改变同一对象而使已提交队列的内容随之变化。
  const contents = JSON.stringify(value, null, 2);
  if (contents === undefined) throw new TypeError('Metadata must be JSON serializable');
  const target = resolve(file);
  return serializedMetadata(target, true, (mark) => atomicMetadataWrite(target, contents, undefined, mark));
}

/**
 * 入口 / Entry: within.
 * 功能：在提供本地 JSON 存储与目录检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `path === '' || (!path.startsWith('..') && !isAbsolute(path))` 供上层消费（`local-store.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `local-store.ts`; this entry produces `path === '' || (!path.startsWith('..') && !isAbsolute(path))` for its caller. Module context: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 * 处理：通过 `relative`, `resolve`, `path.startsWith`, `isAbsolute` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `relative`, `resolve`, `path.startsWith`, `isAbsolute`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string; target: string
 * 输出 / Returns: `path === '' || (!path.startsWith('..') && !isAbsolute(path))`.
 * 副作用 / Effects: `path.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function within(root: string, target: string) {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
/**
 * 入口 / Entry: regularDirectory.
 * 功能：在提供本地 JSON 存储与目录检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `resolve(path)` 供上层消费（`local-store.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `local-store.ts`; this entry produces `resolve(path)` for its caller. Module context: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 * 处理：通过 `isAbsolute`, `inline.test`, `resolve`, `lstat().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `isAbsolute`, `inline.test`, `resolve`, `lstat().catch`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `parent === current`.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `resolve(path)`.
 * 副作用 / Effects: 更新 / updates `current`.
 * 拒绝 / Refusals: 条件 / conditions `!isAbsolute(path) || /[\x00-\x1f]/.test(path)`; `info && (!info.isDirectory() || info.isSymbolicLink())`; 异常 / errors `new AppError('需要本机绝对目录路径')`; `new AppError('目录不能包含符号链接或目录联接')`.
 */
export async function regularDirectory(path: string) {
  if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new AppError('需要本机绝对目录路径');
  let current = resolve(path);
  while (true) {
    const info = await lstat(current).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new AppError('目录不能包含符号链接或目录联接');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(path);
}
/**
 * 入口 / Entry: fileHash.
 * 功能：在提供本地 JSON 存储与目录检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `hash.digest('hex')` 供上层消费（`local-store.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `local-store.ts`; this entry produces `hash.digest('hex')` for its caller. Module context: Provides local JSON storage and directory checks, delegating atomic publication and serialization to metadata primitives.
 * 处理：通过 `createHash`, `createReadStream`, `hash.update`, `input.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash`, `createReadStream`, `hash.update`, `input.destroy`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; signal: AbortSignal optional
 * 输出 / Returns: `hash.digest('hex')`.
 * 副作用 / Effects: `createHash`; `createReadStream`; `hash.update`; `input.destroy`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `input.destroy();`; `await finished(input).catch(() => {});`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `input.destroy();`; `await finished(input).catch(() => {});`; these steps also apply to exceptional exits.
 */
export async function fileHash(file: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  const input = createReadStream(file, { signal });
  try {
    for await (const chunk of input) hash.update(chunk);
  } finally {
    input.destroy();
    await finished(input).catch(() => {});
  }
  return hash.digest('hex');
}
