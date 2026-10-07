/**
 * 模块职责：集中定义应用及数据目录路径，实例目录解析受已登记存储池位置约束。
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from './data-directory.ts';
import { checkedId } from '../shared/paths.ts';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA = dataDirectory(process.env.SAKURA_DATA_DIR || join(ROOT, '.data'));
export const VM_ROOT = join(DATA, 'machines');
const vmStorageRoots = new Map<string, string>();
export function setVmStorageRoot(id: string, root?: string) {
  checkedId(id);
  if (root) vmStorageRoots.set(id, resolve(root));
  else vmStorageRoots.delete(id);
}
export const IMAGE = resolve(process.env.SAKURA_IMAGE_PATH || join(DATA, 'images', 'alpine-3.23.qcow2'));
export const PORT = Number(process.env.SAKURA_PORT || 7337);
export function vmDir(id: string) {
  const checked = checkedId(id);
  return join(vmStorageRoots.get(checked) || VM_ROOT, checked);
}
