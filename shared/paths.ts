/**
 * 模块职责：校验资源标识和客户机绝对路径，拒绝不符合接口约束的输入。
 */
import { AppError } from './errors.ts';

export function checkedId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new AppError('无效的实例标识', 400);
  return id;
}
// 这里只检查接口路径形状，不做文件系统解析或权限判断；路径归属和访问权限由实际执行层校验。
export function guestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new AppError('需要有效的 Linux 绝对路径');
  return value;
}
