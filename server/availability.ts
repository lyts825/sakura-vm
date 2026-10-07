/**
 * 模块职责：累积实例可用性区间并生成报告；拒绝重叠区间，避免重复计算可用时间。
 * Module purpose: Accumulates VM availability intervals and reports; rejects overlapping intervals to prevent double counting.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { checkedId } from '../shared/paths.ts';
import { DATA } from './paths.ts';
import { readStore } from './local-store.ts';

const statusSchema = z.enum([
  'running',
  'stopped',
  'paused',
  'starting',
  'stopping',
  'error',
  'unreachable',
  'unknown',
]);
export type AvailabilityStatus = z.infer<typeof statusSchema>;
const spanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    status: statusSchema,
  })
  .strict()
  .refine((span) => span.end >= span.start, '可用性记录结束时间早于开始时间');
export type AvailabilitySpan = z.infer<typeof spanSchema>;
const retention = 30 * 86400000;

/** Sample-and-hold intervals; collector outages are explicitly unknown. */
/**
 * 入口 / Entry: observeAvailability.
 * 功能：在累积实例可用性区间并生成报告中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`availability.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `availability.ts`; this entry produces `void` for its caller. Module context: Accumulates VM availability intervals and reports; rejects overlapping intervals to prevent double counting.
 * 处理：通过 `history.at`, `history.push`, `history.shift`, `history.splice` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `history.at`, `history.push`, `history.shift`, `history.splice`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `last && now < last.end`; `last`; `now - last.end > 90000`.
 * 输入 / Inputs: history: AvailabilitySpan[]; status: AvailabilityStatus; now: number
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `history.push`; `history.shift`; `history.splice`; 更新 / updates `last.end`, `history[0].start`.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(now) || now < 0`; 异常 / errors `new AppError('可用性采样时间无效')`.
 */
export function observeAvailability(history: AvailabilitySpan[], status: AvailabilityStatus, now: number) {
  const last = history.at(-1);
  if (!Number.isSafeInteger(now) || now < 0) throw new AppError('可用性采样时间无效');
  if (last && now < last.end) return; // Do not fabricate overlapping time after a host clock rollback.
  if (last) {
    if (now - last.end > 90000) {
      history.push({ start: last.end, end: now, status: 'unknown' });
      history.push({ start: now, end: now, status });
    } else {
      last.end = now;
      if (last.status !== status) history.push({ start: now, end: now, status });
    }
  } else history.push({ start: now, end: now, status });
  const cutoff = now - retention;
  while (history.length && history[0].end < cutoff) history.shift();
  if (history.length) history[0].start = Math.max(history[0].start, cutoff);
  if (history.length > 8000) history.splice(0, history.length - 8000);
}

/**
 * 入口 / Entry: availabilityReport.
 * 功能：在累积实例可用性区间并生成报告中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ from: new Date(start).toISOString(), to: new Date(end).toISOString(), availablePercent: observed ? (durations.running / obs…` 供上层消费（`availability.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `availability.ts`; this entry produces `{ from: new Date(start).toISOString(), to: new Date(end).toISOString(), availablePercent: observed ? (durations.running / obs…` for its caller. Module context: Accumulates VM availability intervals and reports; rejects overlapping intervals to prevent double counting.
 * 处理：通过 `z.array().max().parse`, `z.array().max`, `z.array`, `z.number().min().max().parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.array().max().parse`, `z.array().max`, `z.array`, `z.number().min().max().parse`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `to <= from`.
 * 输入 / Inputs: input: AvailabilitySpan[]; hours: number; now: default=Date.now()
 * 输出 / Returns: `{ from: new Date(start).toISOString(), to: new Date(end).toISOString(), availablePercent: observed ? (durations.running / obs…`.
 * 副作用 / Effects: `intervals.push`; 更新 / updates `hours`, `previousEnd`, `durations[span.status]`, `covered`.
 * 拒绝 / Refusals: 条件 / conditions `span.start < previousEnd`; 异常 / errors `new AppError('可用性记录存在重叠，无法生成报告')`.
 */
export function availabilityReport(input: AvailabilitySpan[], hours: number, now = Date.now()) {
  const history = z.array(spanSchema).max(8000).parse(input);
  hours = z.number().min(1).max(720).parse(hours);
  const end = now,
    start = end - hours * 3600000;
  const durations: Record<AvailabilityStatus, number> = {
    running: 0,
    stopped: 0,
    paused: 0,
    starting: 0,
    stopping: 0,
    error: 0,
    unreachable: 0,
    unknown: 0,
  };
  let previousEnd = -1,
    covered = 0;
  const intervals: Array<{ start: string; end: string; status: AvailabilityStatus; seconds: number }> = [];
  for (const span of history) {
    if (span.start < previousEnd) throw new AppError('可用性记录存在重叠，无法生成报告');
    previousEnd = span.end;
    const from = Math.max(start, span.start),
      to = Math.min(end, span.end);
    if (to <= from) continue;
    const elapsed = to - from;
    durations[span.status] += elapsed;
    covered += elapsed;
    intervals.push({
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      status: span.status,
      seconds: elapsed / 1000,
    });
  }
  const window = end - start;
  durations.unknown += Math.max(0, window - covered);
  const observed = window - durations.unknown;
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    availablePercent: observed ? (durations.running / observed) * 100 : null,
    coveragePercent: (observed / window) * 100,
    observedSeconds: observed / 1000,
    unknownSeconds: durations.unknown / 1000,
    durationsSeconds: Object.fromEntries(
      Object.entries(durations).map(([status, ms]) => [status, ms / 1000]),
    ),
    lastObservedAt: history.length ? new Date(history.at(-1)!.end).toISOString() : null,
    lastStatus: history.at(-1)?.status || 'unknown',
    intervals,
    basis:
      'Running means a successful Linux resource probe. Stopped, paused, booting and failed probes count as observed unavailability. Polling approximates transitions; gaps over 90 seconds and unsampled time are unknown. Retention is 30 days or 8000 intervals.',
  };
}
/**
 * 入口 / Entry: readAvailabilityReport.
 * 功能：在累积实例可用性区间并生成报告中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `availabilityReport(state.availability?.[id] || [], hours)` 供上层消费（`availability.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `availability.ts`; this entry produces `availabilityReport(state.availability?.[id] || [], hours)` for its caller. Module context: Accumulates VM availability intervals and reports; rejects overlapping intervals to prevent double counting.
 * 处理：通过 `checkedId`, `readStore`, `join`, `availabilityReport` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `checkedId`, `readStore`, `join`, `availabilityReport`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; hours: number
 * 输出 / Returns: `availabilityReport(state.availability?.[id] || [], hours)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function readAvailabilityReport(id: string, hours: number) {
  checkedId(id);
  const state = await readStore<{ availability?: Record<string, AvailabilitySpan[]> }>(
    join(DATA, 'feature-suite.json'),
    () => ({}),
  );
  return availabilityReport(state.availability?.[id] || [], hours);
}
