/** 纳秒整数、固定时区资料、区间与迟到窗口；不读取宿主时钟。 */
import { z } from 'zod';
import {
  dataCompare,
  dataId,
  dataRow,
  dataError,
  checkDataSignal,
  uniqueDataIds,
  stableData,
} from '../shared/seventh-data-contracts.ts';

const integerText = z.string().regex(/^[+-]?\d{1,38}$/);
const precision = z.enum(['second', 'millisecond', 'microsecond', 'nanosecond']);
const factors = { second: 1000000000n, millisecond: 1000000n, microsecond: 1000n, nanosecond: 1n };
const maximumNanos = (1n << 127n) - 1n;
function boundedNanos(value: bigint) {
  if (value < -maximumNanos - 1n || value > maximumNanos)
    dataError('TEMPORAL_INTEGER_RANGE', '纳秒整数超出有符号 128 位范围');
  return value;
}
const zoneProfile = z
  .object({
    version: dataId,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    periods: z
      .array(
        z
          .object({
            startUtc: z.string().max(64),
            endUtc: z.string().max(64),
            offsetMinutes: z.number().int().min(-840).max(840),
          })
          .strict(),
      )
      .min(1)
      .max(20000),
  })
  .strict();
export const temporalTimestamp = z.union([
  z.object({ kind: z.literal('epoch'), value: integerText, unit: precision }).strict(),
  z.object({ kind: z.literal('iso'), value: z.string().max(64) }).strict(),
  z
    .object({
      kind: z.literal('local'),
      value: z.string().max(64),
      profile: zoneProfile,
      ambiguity: z.enum(['reject', 'earlier', 'later', 'offset']).default('reject'),
      offsetMinutes: z.number().int().min(-840).max(840).optional(),
      missing: z.enum(['reject', 'first-valid']).default('reject'),
    })
    .strict(),
]);
function isoNanos(value: string, local = false): bigint {
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/,
  );
  if (!m || (!local && !m[8]) || (local && m[8]))
    dataError('TEMPORAL_FORMAT', '时刻须使用明确精度及适当时区的 ISO 格式');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (year < 100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59)
    dataError('TEMPORAL_CALENDAR', '日期或时间字段越界；闰秒不在首版范围');
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    dataError('TEMPORAL_CALENDAR', '不存在的日历日期');
  let offset = 0;
  if (m[8] && m[8] !== 'Z') {
    const h = Number(m[8].slice(1, 3)),
      min = Number(m[8].slice(4, 6));
    if (h > 14 || min > 59 || (h === 14 && min)) dataError('TEMPORAL_OFFSET', '时区偏移超出支持范围');
    offset = (h * 60 + min) * (m[8][0] === '-' ? -1 : 1);
  }
  return (
    BigInt(date.getTime()) * 1000000n +
    BigInt((m[7] ?? '').padEnd(9, '0') || '0') -
    BigInt(offset) * 60000000000n
  );
}
export function parseTemporal(raw: unknown) {
  const input = temporalTimestamp.parse(raw);
  if (input.kind === 'epoch')
    return {
      nanos: boundedNanos(BigInt(input.value) * factors[input.unit]),
      adjusted: false,
      profile: null,
      original: input,
    };
  if (input.kind === 'iso')
    return { nanos: isoNanos(input.value), adjusted: false, profile: null, original: input };
  const local = isoNanos(input.value, true),
    periods = input.profile.periods
      .map((p) => ({
        start: isoNanos(p.startUtc),
        end: isoNanos(p.endUtc),
        offset: BigInt(p.offsetMinutes) * 60000000000n,
        minutes: p.offsetMinutes,
      }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (let i = 0; i < periods.length; i++)
    if (periods[i].start >= periods[i].end || (i && periods[i - 1].end > periods[i].start))
      dataError('TEMPORAL_ZONE_PROFILE', '时区资料的 UTC 区间须非空且不重叠');
  let candidates = periods
    .map((p) => ({ nanos: local - p.offset, offsetMinutes: p.minutes }))
    .filter((c) =>
      periods.some((p) => p.minutes === c.offsetMinutes && c.nanos >= p.start && c.nanos < p.end),
    );
  candidates = [...new Map(candidates.map((c) => [c.nanos.toString(), c])).values()].sort((a, b) =>
    a.nanos < b.nanos ? -1 : 1,
  );
  if (input.ambiguity === 'offset') {
    if (input.offsetMinutes === undefined) dataError('TEMPORAL_OFFSET_REQUIRED', '按偏移消歧须指定偏移');
    candidates = candidates.filter((c) => c.offsetMinutes === input.offsetMinutes);
  }
  if (!candidates.length) {
    if (input.missing === 'first-valid') {
      const next = periods
        .filter((p) => p.start + p.offset > local)
        .sort((a, b) => (a.start + a.offset < b.start + b.offset ? -1 : 1))[0];
      if (next)
        return {
          nanos: next.start,
          adjusted: true,
          profile: { version: input.profile.version, digest: input.profile.digest },
          original: input,
        };
    }
    dataError('TEMPORAL_MISSING_LOCAL', '本地时刻缺失或不在固定时区资料范围');
  }
  if (candidates.length > 1 && (input.ambiguity === 'reject' || input.ambiguity === 'offset'))
    dataError('TEMPORAL_AMBIGUOUS_LOCAL', '本地时刻对应多个绝对时刻，须明确消歧');
  return {
    nanos: (input.ambiguity === 'later' ? candidates.at(-1)! : candidates[0]).nanos,
    adjusted: false,
    profile: { version: input.profile.version, digest: input.profile.digest },
    original: input,
  };
}
const temporalRecord = z
  .object({
    id: dataId,
    time: temporalTimestamp,
    offsetNanos: integerText.default('0'),
    uncertaintyNanos: integerText.default('0'),
    value: z.number().finite().nullable().default(null),
  })
  .strict();
export function alignTemporal(raw: unknown, signal?: AbortSignal) {
  const input = z
    .object({ records: z.array(temporalRecord).max(100000), outputUnit: precision.default('nanosecond') })
    .strict()
    .parse(raw);
  uniqueDataIds(input.records.map((r) => r.id));
  const rows = input.records.map((row) => {
    checkDataSignal(signal);
    const parsed = parseTemporal(row.time),
      adjusted = boundedNanos(parsed.nanos + BigInt(row.offsetNanos)),
      error = BigInt(row.uncertaintyNanos);
    if (error < 0n) dataError('TEMPORAL_UNCERTAINTY', '时间不确定范围须非负');
    const factor = factors[input.outputUnit];
    if (adjusted % factor) dataError('TEMPORAL_PRECISION_LOSS', '目标精度不能无损表示记录：' + row.id);
    return {
      id: row.id,
      original: row.time,
      value: row.value,
      nanos: adjusted.toString(),
      converted: (adjusted / factor).toString(),
      uncertaintyStart: boundedNanos(adjusted - error).toString(),
      uncertaintyEnd: boundedNanos(adjusted + error).toString(),
      adjusted: parsed.adjusted,
      offsetNanos: row.offsetNanos,
      profile: parsed.profile,
    };
  });
  const ordered = [...rows].sort((a, b) =>
    BigInt(a.nanos) < BigInt(b.nanos) ? -1 : BigInt(a.nanos) > BigInt(b.nanos) ? 1 : dataCompare(a.id, b.id),
  );
  return {
    rows,
    outputUnit: input.outputUnit,
    order: ordered.map((row, i) => ({
      id: row.id,
      definitelyAfterPrevious:
        i === 0 ? null : BigInt(row.uncertaintyStart) > BigInt(ordered[i - 1].uncertaintyEnd),
    })),
    clockRead: false,
  };
}
const intervalSchema = z
  .object({
    id: dataId,
    start: temporalTimestamp,
    end: temporalTimestamp,
    startClosed: z.boolean().default(true),
    endClosed: z.boolean().default(false),
  })
  .strict();
export function validateTemporalIntervals(raw: unknown, signal?: AbortSignal) {
  const input = z
    .object({
      intervals: z.array(intervalSchema).max(100000),
      maxDetails: z.number().int().min(1).max(10000).default(1000),
    })
    .strict()
    .parse(raw);
  uniqueDataIds(input.intervals.map((i) => i.id));
  const intervals = input.intervals
    .map((row) => {
      const start = parseTemporal(row.start).nanos,
        end = parseTemporal(row.end).nanos;
      if (start > end || (start === end && !(row.startClosed && row.endClosed)))
        dataError('TEMPORAL_EMPTY_INTERVAL', '区间为空或反向：' + row.id);
      return { id: row.id, start, end, startClosed: row.startClosed, endClosed: row.endClosed };
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : dataCompare(a.id, b.id)));
  let overlapCount = 0,
    gapCount = 0;
  const overlaps: { left: string; right: string }[] = [],
    gaps: { start: string; end: string; startClosed: boolean; endClosed: boolean }[] = [];
  let active: typeof intervals = [],
    frontier: (typeof intervals)[number] | undefined;
  for (const current of intervals) {
    checkDataSignal(signal);
    active = active.filter(
      (a) => a.end > current.start || (a.end === current.start && a.endClosed && current.startClosed),
    );
    if (active.length > 10000) dataError('TEMPORAL_OVERLAP_LIMIT', '同一时点活动区间超过 10000');
    for (const a of active) {
      overlapCount++;
      if (overlaps.length < input.maxDetails) overlaps.push({ left: a.id, right: current.id });
    }
    if (
      frontier &&
      (frontier.end < current.start ||
        (frontier.end === current.start && !frontier.endClosed && !current.startClosed))
    ) {
      gapCount++;
      if (gaps.length < input.maxDetails)
        gaps.push({
          start: frontier.end.toString(),
          end: current.start.toString(),
          startClosed: !frontier.endClosed,
          endClosed: !current.startClosed,
        });
    }
    if (!frontier || current.end > frontier.end || (current.end === frontier.end && current.endClosed))
      frontier = current;
    active.push(current);
  }
  return {
    intervals: intervals.map((v) => ({ ...v, start: v.start.toString(), end: v.end.toString() })),
    overlapCount,
    overlaps,
    gapCount,
    gaps,
    detailsTruncated: overlapCount > overlaps.length || gapCount > gaps.length,
    verdict: overlapCount || gapCount ? 'failed' : 'passed',
  };
}
const windowDefinition = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('tumbling'), sizeNanos: integerText, originNanos: integerText.default('0') })
    .strict(),
  z
    .object({
      kind: z.literal('sliding'),
      sizeNanos: integerText,
      stepNanos: integerText,
      originNanos: integerText.default('0'),
    })
    .strict(),
  z.object({ kind: z.literal('session'), gapNanos: integerText }).strict(),
  z
    .object({
      kind: z.literal('calendar'),
      boundaries: z.array(temporalTimestamp).min(2).max(10001),
      calendarVersion: dataId,
    })
    .strict(),
]);
const floorDivide = (a: bigint, b: bigint) => a / b - (a < 0n && a % b !== 0n ? 1n : 0n);
export function runTemporalWindows(raw: unknown, signal?: AbortSignal) {
  const input = z
    .object({
      records: z.array(temporalRecord).max(100000),
      window: windowDefinition,
      watermarks: z
        .array(
          z.object({ afterRecords: z.number().int().min(0).max(100000), time: temporalTimestamp }).strict(),
        )
        .max(100000)
        .default([]),
      allowedLateNanos: integerText.default('0'),
      latePolicy: z.enum(['reject', 'side-output', 'correct']).default('side-output'),
      aggregate: z.enum(['count', 'sum', 'mean']).default('count'),
      empty: z.enum(['omit', 'null']).default('omit'),
    })
    .strict()
    .parse(raw);
  uniqueDataIds(input.records.map((r) => r.id));
  const allowed = BigInt(input.allowedLateNanos);
  if (allowed < 0n) dataError('TEMPORAL_LATENESS', '迟到容忍值须非负');
  const rows = input.records.map((r, index) => ({
      id: r.id,
      time: parseTemporal(r.time).nanos + BigInt(r.offsetNanos),
      value: r.value,
      index,
    })),
    watermarks = input.watermarks.map((w) => ({ ...w, nanos: parseTemporal(w.time).nanos }));
  for (let i = 0; i < watermarks.length; i++)
    if (
      watermarks[i].afterRecords > rows.length ||
      (i &&
        (watermarks[i].afterRecords <= watermarks[i - 1].afterRecords ||
          watermarks[i].nanos < watermarks[i - 1].nanos))
    )
      dataError('TEMPORAL_WATERMARK_ORDER', '水位位置须唯一递增，水位时刻不可后退');
  let wi = 0,
    watermark: bigint | null = null;
  const accepted: typeof rows = [],
    late: typeof rows = [],
    sideOutput: typeof rows = [];
  for (const row of rows) {
    checkDataSignal(signal);
    while (wi < watermarks.length && watermarks[wi].afterRecords <= row.index)
      watermark = watermarks[wi++].nanos;
    const isLate = watermark !== null && row.time < watermark - allowed;
    if (isLate) {
      if (input.latePolicy === 'reject') dataError('TEMPORAL_LATE_RECORD', '迟到策略拒绝记录：' + row.id);
      if (input.latePolicy === 'side-output') {
        sideOutput.push(row);
        continue;
      }
      late.push(row);
    } else accepted.push(row);
  }
  const window = input.window;
  let calendar: bigint[] = [];
  if (window.kind === 'calendar') {
    calendar = window.boundaries.map((t) => parseTemporal(t).nanos);
    if (calendar.some((n, i) => i > 0 && n <= calendar[i - 1]))
      dataError('TEMPORAL_WINDOW_ORDER', '日历窗口边界须严格递增');
  } else if (window.kind === 'session') {
    if (BigInt(window.gapNanos) <= 0n) dataError('TEMPORAL_WINDOW_SIZE', '会话间隔须为正整数');
  } else if (BigInt(window.sizeNanos) <= 0n || (window.kind === 'sliding' && BigInt(window.stepNanos) <= 0n))
    dataError('TEMPORAL_WINDOW_SIZE', '窗口大小与步长须为正整数');
  if (input.empty === 'null' && window.kind !== 'calendar')
    dataError('TEMPORAL_EMPTY_WINDOW_RANGE', '空窗口输出须使用已声明完整边界的日历窗口');
  type WindowRow = { start: bigint; end: bigint; rows: typeof rows };
  function aggregate(items: typeof rows) {
    const groups = new Map<string, WindowRow>();
    const add = (start: bigint, end: bigint, row?: (typeof rows)[number]) => {
      const key = start.toString() + ':' + end.toString();
      let g = groups.get(key);
      if (!g) {
        if (groups.size >= 100000) dataError('TEMPORAL_WINDOW_LIMIT', '输出窗口超过 100000');
        g = { start, end, rows: [] };
        groups.set(key, g);
      }
      if (row) g.rows.push(row);
    };
    if (window.kind === 'session') {
      const sorted = [...items].sort((a, b) =>
        a.time < b.time ? -1 : a.time > b.time ? 1 : dataCompare(a.id, b.id),
      );
      let session: WindowRow | undefined;
      const gap = BigInt(window.gapNanos);
      for (const row of sorted) {
        checkDataSignal(signal);
        if (!session || row.time > session.end) {
          session = { start: row.time, end: row.time + gap, rows: [row] };
          groups.set(session.start.toString(), session);
        } else {
          session.end = row.time + gap;
          session.rows.push(row);
        }
      }
    } else if (window.kind === 'calendar') {
      if (input.empty === 'null')
        for (let i = 0; i < calendar.length - 1; i++) add(calendar[i], calendar[i + 1]);
      for (const row of items) {
        checkDataSignal(signal);
        let low = 0,
          high = calendar.length - 1;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (calendar[mid] <= row.time) low = mid;
          else high = mid - 1;
        }
        if (low < calendar.length - 1 && row.time >= calendar[low])
          add(calendar[low], calendar[low + 1], row);
        else dataError('TEMPORAL_WINDOW_RANGE', '记录不在已声明日历窗口：' + row.id);
      }
    } else {
      const size = BigInt(window.sizeNanos),
        step = window.kind === 'sliding' ? BigInt(window.stepNanos) : size,
        origin = BigInt(window.originNanos);
      if ((size + step - 1n) / step > 1000n)
        dataError('TEMPORAL_WINDOW_AMPLIFICATION', '单条记录最多展开 1000 个窗口');
      let assignments = 0;
      for (const row of items) {
        checkDataSignal(signal);
        const last = floorDivide(row.time - origin, step);
        for (let index = last; ; index--) {
          const start = origin + index * step;
          if (row.time >= start + size) break;
          if (++assignments > 1000000) dataError('TEMPORAL_WINDOW_AMPLIFICATION', '窗口成员展开超过 100 万');
          add(start, start + size, row);
        }
      }
    }
    return [...groups.values()]
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
      .map((group) => {
        const values = group.rows.filter((row) => row.value !== null).map((row) => row.value!),
          sum = values.reduce((s, n) => s + n, 0);
        if (!Number.isFinite(sum)) dataError('TEMPORAL_VALUE_OVERFLOW', '窗口聚合数值溢出');
        return {
          start: group.start.toString(),
          end: group.end.toString(),
          count: group.rows.length,
          missing: group.rows.length - values.length,
          value:
            input.aggregate === 'count'
              ? group.rows.length
              : values.length
                ? input.aggregate === 'sum'
                  ? sum
                  : sum / values.length
                : null,
          recordIds: group.rows.map((row) => row.id),
          interval: '[start,end)',
        };
      });
  }
  const initial = aggregate(accepted),
    corrected = late.length ? aggregate([...accepted, ...late]) : initial;
  return {
    windows: corrected,
    versions: late.length
      ? [
          { revision: 1, windows: initial, reason: 'before-late-corrections' },
          { revision: 2, windows: corrected, reason: 'late-correction' },
        ]
      : [{ revision: 1, windows: initial, reason: 'initial' }],
    lateRecordIds: late.map((r) => r.id),
    sideOutput: sideOutput.map((r) => ({ id: r.id, nanos: r.time.toString() })),
    aggregate: input.aggregate,
    windowKind: window.kind,
    sourceOrder: 'declared-arrival-order',
    verdict: 'passed',
    excludedCount: sideOutput.length,
  };
}
export function queryBitemporal(raw: unknown) {
  const input = z
    .object({
      rows: z
        .array(
          z
            .object({
              id: dataId,
              validFrom: temporalTimestamp,
              validTo: temporalTimestamp,
              knownFrom: temporalTimestamp,
              knownTo: temporalTimestamp,
              values: dataRow,
            })
            .strict(),
        )
        .max(100000),
      validAt: temporalTimestamp,
      knownAt: temporalTimestamp,
    })
    .strict()
    .parse(raw);
  const valid = parseTemporal(input.validAt).nanos,
    known = parseTemporal(input.knownAt).nanos;
  return {
    rows: input.rows.filter((row) => {
      const a = parseTemporal(row.validFrom).nanos,
        b = parseTemporal(row.validTo).nanos,
        c = parseTemporal(row.knownFrom).nanos,
        d = parseTemporal(row.knownTo).nanos;
      if (a >= b || c >= d) dataError('TEMPORAL_EMPTY_INTERVAL', '双时间记录的区间无效：' + row.id);
      return a <= valid && valid < b && c <= known && known < d;
    }),
    validAtNanos: valid.toString(),
    knownAtNanos: known.toString(),
    interval: '[start,end)',
  };
}
export function compareTemporal(raw: unknown) {
  const input = z
    .object({
      left: z.array(dataRow).max(100000),
      right: z.array(dataRow).max(100000),
      idColumn: dataId.default('id'),
    })
    .strict()
    .parse(raw);
  const left = new Map(input.left.map((r) => [stableData(r[input.idColumn]), r])),
    right = new Map(input.right.map((r) => [stableData(r[input.idColumn]), r]));
  if (left.size !== input.left.length || right.size !== input.right.length)
    dataError('TEMPORAL_DUPLICATE_ID', '时间比较中记录身份重复');
  return {
    added: [...right.keys()].filter((id) => !left.has(id)),
    removed: [...left.keys()].filter((id) => !right.has(id)),
    changed: [...right]
      .filter(([id, row]) => left.has(id) && stableData(left.get(id)) !== stableData(row))
      .map(([id]) => id),
  };
}

export function inspectTemporalCalendar(raw: unknown) {
  const localProbe = z.object({ value: z.string().max(64), ambiguity: z.enum(['reject', 'earlier', 'later', 'offset']).default('reject'), offsetMinutes: z.number().int().min(-840).max(840).optional(), missing: z.enum(['reject', 'first-valid']).default('reject') }).strict();
  const input = z.object({ profile: zoneProfile, workWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]), holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(36600).default([]), businessDayStartMinutes: z.number().int().min(0).max(1439).default(0), dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(36600).default([]), probes: z.array(localProbe).max(10000).default([]) }).strict().parse(raw);
  uniqueDataIds(input.workWeek.map(String), '工作周日'); uniqueDataIds(input.holidays, '节假日'); uniqueDataIds(input.dates, '日历日期');
  for (const date of [...input.holidays, ...input.dates]) isoNanos(date + 'T00:00:00Z');
  const periods = input.profile.periods.map(period => ({ start: isoNanos(period.startUtc), end: isoNanos(period.endUtc), offset: BigInt(period.offsetMinutes) * 60000000000n, offsetMinutes: period.offsetMinutes })).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  const coverageGaps: { start: string; end: string }[] = [], transitions: { utc: string; fromOffsetMinutes: number; toOffsetMinutes: number; kind: string; localStart: string; localEnd: string }[] = [];
  for (let index = 0; index < periods.length; index++) {
    const current = periods[index], previous = periods[index - 1];
    if (current.start >= current.end || (previous && previous.end > current.start)) dataError('TEMPORAL_ZONE_PROFILE', '时区资料 UTC 区间须非空且不重叠');
    if (previous && previous.end < current.start) coverageGaps.push({ start: previous.end.toString(), end: current.start.toString() });
    if (previous && previous.end === current.start && previous.offset !== current.offset) { const before = current.start + previous.offset, after = current.start + current.offset; transitions.push({ utc: current.start.toString(), fromOffsetMinutes: previous.offsetMinutes, toOffsetMinutes: current.offsetMinutes, kind: after > before ? 'missing-local-interval' : 'repeated-local-interval', localStart: (before < after ? before : after).toString(), localEnd: (before > after ? before : after).toString() }); }
  }
  const probes = input.probes.map(probe => { try { const result = parseTemporal({ kind: 'local', profile: input.profile, ...probe }); return { value: probe.value, status: 'resolved', nanos: result.nanos.toString(), adjusted: result.adjusted, error: null }; } catch (error) { const failure = error as Error & { code?: string }; return { value: probe.value, status: 'unresolved', nanos: null, adjusted: false, error: { code: failure.code ?? 'TEMPORAL_PROFILE_PROBE', message: failure.message } }; } });
  const holidays = new Set(input.holidays);
  return { version: input.profile.version, declaredDigest: input.profile.digest, digestVerification: 'caller-declared-profile-not-external-authenticity', coverage: { start: periods[0].start.toString(), end: periods.at(-1)!.end.toString(), gaps: coverageGaps }, transitions, businessDayStartMinutes: input.businessDayStartMinutes, dates: input.dates.map(date => { const day = new Date(date + 'T00:00:00Z').getUTCDay() || 7; return { date, weekday: day, holiday: holidays.has(date), working: input.workWeek.includes(day) && !holidays.has(date), businessStartLocal: date + 'T' + String(Math.floor(input.businessDayStartMinutes / 60)).padStart(2, '0') + ':' + String(input.businessDayStartMinutes % 60).padStart(2, '0') + ':00' }; }), probes, unresolvedCount: probes.filter(probe => probe.status === 'unresolved').length, interval: '[start,end)', verdict: probes.some(probe => probe.status === 'unresolved') || coverageGaps.length ? 'inconclusive' : 'passed' };
}

export function validateTemporalLatePolicy(raw: unknown, signal?: AbortSignal) {
  const result = runTemporalWindows(raw, signal);
  return { ...result, validation: 'fixed-arrival-order-watermark-replay', clockRead: false, originalWindowsPreserved: true, correctionCount: result.versions.length - 1, lateDecisionCount: result.lateRecordIds.length + result.sideOutput.length };
}

export function explainTemporalComparison(raw: unknown, signal?: AbortSignal) {
  const input = z.object({ left: z.array(dataRow).max(100000), right: z.array(dataRow).max(100000), idColumn: dataId.default('id'), leftRules: dataRow.default({}), rightRules: dataRow.default({}) }).strict().parse(raw);
  if ([...input.left, ...input.right].some(row => !Object.hasOwn(row, input.idColumn) || row[input.idColumn] === null)) dataError('TEMPORAL_COMPARISON_ID', '每条比较记录须有非空的固定身份列');
  const summary = compareTemporal({ left: input.left, right: input.right, idColumn: input.idColumn }), left = new Map(input.left.map(row => [stableData(row[input.idColumn]), row])), right = new Map(input.right.map(row => [stableData(row[input.idColumn]), row]));
  let detailCount = 0;
  const fieldChanges = summary.changed.map(id => { checkDataSignal(signal); const before = left.get(id)!, after = right.get(id)!; const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(dataCompare).filter(field => stableData(before[field]) !== stableData(after[field])).map(field => { if (++detailCount > 100000) dataError('TEMPORAL_COMPARISON_LIMIT', '比较字段差异超过 10 万项'); return { field, beforePresent: Object.hasOwn(before, field), afterPresent: Object.hasOwn(after, field), before: before[field] ?? null, after: after[field] ?? null }; }); return { identity: before[input.idColumn], fields }; });
  const ruleChanges = [...new Set([...Object.keys(input.leftRules), ...Object.keys(input.rightRules)])].sort(dataCompare).filter(field => stableData(input.leftRules[field]) !== stableData(input.rightRules[field])).map(field => ({ field, beforePresent: Object.hasOwn(input.leftRules, field), afterPresent: Object.hasOwn(input.rightRules, field), before: input.leftRules[field] ?? null, after: input.rightRules[field] ?? null }));
  return { ...summary, fieldChanges, ruleChanges, direction: 'left-to-right', interpretation: 'observed-differences-and-declared-rule-changes-no-causal-attribution' };
}
