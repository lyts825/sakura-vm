import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';

export function dataDirectory(initial: string) {
  let current = resolve(initial);
  const seen = new Set<string>();
  for (let step = 0; step < 32; step++) {
    const key = process.platform === 'win32' ? current.toLowerCase() : current;
    if (seen.has(key)) throw new Error('数据目录重定向存在循环');
    seen.add(key);
    const file = join(current, '.sakura-redirect.json');
    if (!existsSync(file)) return current;
    const redirect = JSON.parse(readFileSync(file, 'utf8'));
    if (redirect.version !== 1 || typeof redirect.target !== 'string' || !isAbsolute(redirect.target))
      throw new Error('数据目录切换记录无效');
    const marker = JSON.parse(readFileSync(join(redirect.target, '.sakura-migration.json'), 'utf8'));
    if (marker.id !== redirect.id || marker.source !== current || !marker.completedAt)
      throw new Error('数据目录迁移尚未完成，保留原目录后重试');
    current = resolve(redirect.target);
  }
  throw new Error('数据目录切换层数过多');
}
