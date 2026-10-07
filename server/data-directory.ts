/**
 * 模块职责：解析数据目录切换记录；检测循环、未完成迁移和超深重定向，保留原目录边界。
 * Module purpose: Resolves directory switch records, rejecting cycles, incomplete migrations and excessive redirection depth.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';

/**
 * 入口 / Entry: dataDirectory.
 * 功能：在解析数据目录切换记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` 供上层消费（`data-directory.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `data-directory.ts`; this entry produces `current` for its caller. Module context: Resolves directory switch records, rejecting cycles, incomplete migrations and excessive redirection depth.
 * 处理：通过 `resolve`, `current.toLowerCase`, `seen.has`, `seen.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `resolve`, `current.toLowerCase`, `seen.has`, `seen.add`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!existsSync(file)`.
 * 输入 / Inputs: initial: string
 * 输出 / Returns: `current`.
 * 副作用 / Effects: `seen.add`; 更新 / updates `current`.
 * 拒绝 / Refusals: 条件 / conditions `seen.has(key)`; `redirect.version !== 1 || typeof redirect.target !== 'string' || !isAbsolute(redirect.target)`; `marker.id !== redirect.id || marker.source !== current || !marker.completedAt`; 异常 / errors `new Error('数据目录重定向存在循环')`; `new Error('数据目录切换记录无效')`.
 */
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
