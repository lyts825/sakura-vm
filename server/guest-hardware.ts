/**
 * 模块职责：校验并统计客户机 CPU 集合表达式，为硬件状态读取提供明确的格式边界。
 * Module purpose: Validates and counts guest CPU-set expressions, imposing explicit format and numeric bounds.
 */
import { AppError } from '../shared/errors.ts';

/**
 * 入口 / Entry: cpuSetSize.
 * 功能：在校验并统计客户机 CPU 集合表达式中，执行此领域的具体处理步骤并返回其结果；本入口产生 `0` / `text .trim() .split(',') .reduce((sum, range) => { const [from, to = from] = range.split('-').map(Number); if (to < from || t…` 供上层消费（`guest-hardware.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `guest-hardware.ts`; this entry produces `0` / `text .trim() .split(',') .reduce((sum, range) => { const [from, to = from] = range.split('-').map(Number); if (to < from || t…` for its caller. Module context: Validates and counts guest CPU-set expressions, imposing explicit format and numeric bounds.
 * 处理：通过 `inline.test`, `text.trim`, `text.trim().split().reduce`, `text.trim().split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `text.trim`, `text.trim().split().reduce`, `text.trim().split`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text.trim())`.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `0`; `text .trim() .split(',') .reduce((sum, range) => { const [from, to = from] = range.split('-').map(Number); if (to < from || t…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function cpuSetSize(text: string) {
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text.trim())) return 0;
  return text
    .trim()
    .split(',')
    .reduce((sum, range) => {
      const [from, to = from] = range.split('-').map(Number);
      if (to < from || to > 65535) throw new AppError('客户机 CPU 集合无效');
      return sum + to - from + 1;
    }, 0);
}
