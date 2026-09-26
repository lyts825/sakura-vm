import { join } from 'node:path';
import { z } from 'zod';
import { AppError, checkedId, DATA } from './model.ts';
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
export async function readAvailabilityReport(id: string, hours: number) {
  checkedId(id);
  const state = await readStore<{ availability?: Record<string, AvailabilitySpan[]> }>(
    join(DATA, 'feature-suite.json'),
    () => ({}),
  );
  return availabilityReport(state.availability?.[id] || [], hours);
}
