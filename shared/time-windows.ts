export type TimeWindow = { days: number[]; start: string; end: string; timeZone: string };

/** Weekdays identify the day the window starts; equal endpoints mean 24 hours. */
export function withinWindow(window: TimeWindow, now: Date | number = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(field('weekday'));
  const minute = Number(field('hour')) * 60 + Number(field('minute'));
  const toMinute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  const start = toMinute(window.start),
    end = toMinute(window.end);
  if (start < end) return window.days.includes(day) && minute >= start && minute < end;
  return (
    (window.days.includes(day) && minute >= start) || (window.days.includes((day + 6) % 7) && minute < end)
  );
}
