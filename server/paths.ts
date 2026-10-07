/**
 * 模块职责：集中定义应用及数据目录路径，实例目录解析受已登记存储池位置约束。
 * Module purpose: Defines application/data locations and resolves VM directories against registered storage-pool placements.
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from './data-directory.ts';
import { checkedId } from '../shared/paths.ts';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA = dataDirectory(process.env.SAKURA_DATA_DIR || join(ROOT, '.data'));
export const VM_ROOT = join(DATA, 'machines');
const vmStorageRoots = new Map<string, string>();
/**
 * 入口 / Entry: setVmStorageRoot.
 * 功能：在集中定义应用及数据目录路径中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`paths.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `paths.ts`; the calls and state transitions below complete the operation. Module context: Defines application/data locations and resolves VM directories against registered storage-pool placements.
 * 处理：通过 `checkedId`, `vmStorageRoots.set`, `resolve`, `vmStorageRoots.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `checkedId`, `vmStorageRoots.set`, `resolve`, `vmStorageRoots.delete`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `root`.
 * 输入 / Inputs: id: string; root: string optional
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `vmStorageRoots.set`; `vmStorageRoots.delete`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function setVmStorageRoot(id: string, root?: string) {
  checkedId(id);
  if (root) vmStorageRoots.set(id, resolve(root));
  else vmStorageRoots.delete(id);
}
export const IMAGE = resolve(process.env.SAKURA_IMAGE_PATH || join(DATA, 'images', 'alpine-3.23.qcow2'));
export const PORT = Number(process.env.SAKURA_PORT || 7337);
/**
 * 入口 / Entry: vmDir.
 * 功能：在集中定义应用及数据目录路径中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmStorageRoots.get(checked) || VM_ROOT, checked)` 供上层消费（`paths.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `paths.ts`; this entry produces `join(vmStorageRoots.get(checked) || VM_ROOT, checked)` for its caller. Module context: Defines application/data locations and resolves VM directories against registered storage-pool placements.
 * 处理：通过 `checkedId`, `join`, `vmStorageRoots.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `checkedId`, `join`, `vmStorageRoots.get`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `join(vmStorageRoots.get(checked) || VM_ROOT, checked)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmDir(id: string) {
  const checked = checkedId(id);
  return join(vmStorageRoots.get(checked) || VM_ROOT, checked);
}
