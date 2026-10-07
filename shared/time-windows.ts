/**
 * 模块职责（中文）：按窗口指定的时区、星期和分钟判断策略是否生效，支持跨午夜时段。
 * Module responsibility (English): Evaluating policy windows, including overnight ranges, in their configured time zone.
 * 详细范围（中文）：公开入口包括 TimeWindow, withinWindow；职责覆盖按指定时区判断含跨午夜的策略窗口，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TimeWindow, withinWindow. The scope covers Evaluating policy windows, including overnight ranges, in their configured time zone. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type TimeWindow = { days: number[]; start: string; end: string; timeZone: string };

/** Weekdays identify the day the window starts; equal endpoints mean 24 hours. */
/**
 * 中文：按指定 IANA 时区读取星期与分钟，起点包含、终点不包含；跨午夜的凌晨属于前一天的开始日，相同端点表达连续 24 小时。
 * English: Read weekday/minutes in the configured IANA time zone, including the start and excluding the end. Early hours of overnight windows belong to the previous starting day; equal endpoints represent a continuous 24-hour span.
 * 中文：输入：window：签名所示 TimeWindow 业务值；now：签名所示 Date | number 业务值（缺省 Date.now()）
 * English: Inputs: window: the TimeWindow domain value in the signature; now: the Date | number domain value in the signature (default Date.now())
 */
export function withinWindow(window: TimeWindow, now: Date | number = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  /**
   * 中文：从 Intl 时区格式化字段中读取指定分量，供跨平台一致的星期和时分判断。
   * English: Read a requested component from Intl time-zone formatting parts for consistent weekday/hour/minute decisions.
   * 中文：输入：type：签名所示 Intl.DateTimeFormatPartTypes 业务值
   * English: Inputs: type: the Intl.DateTimeFormatPartTypes domain value in the signature
   */
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(field('weekday'));
  const minute = Number(field('hour')) * 60 + Number(field('minute'));
  /**
   * 中文：把已校验的时分字符串转换为当日分钟数，便于比较窗口边界。
   * English: Convert validated hour/minute text to minutes since midnight for window-boundary comparison.
   * 中文：输入：clock：签名所示 string 业务值
   * English: Inputs: clock: the string domain value in the signature
   */
  const toMinute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  const start = toMinute(window.start),
    end = toMinute(window.end);
  // 跨午夜窗口的凌晨部分属于前一天的开始日；结束分钟不包含在窗口内。
  if (start < end) return window.days.includes(day) && minute >= start && minute < end;
  return (
    (window.days.includes(day) && minute >= start) || (window.days.includes((day + 6) % 7) && minute < end)
  );
}
