import { AppError } from './errors.ts';

export function checkedId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new AppError('无效的实例标识', 400);
  return id;
}
export function guestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new AppError('需要有效的 Linux 绝对路径');
  return value;
}
