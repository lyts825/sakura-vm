import type { TimeWindow } from '../shared/time-windows';

export function TimeWindowFields({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (value: TimeWindow) => void;
}) {
  return (
    <div className="feature-card">
      <div className="feature-grid">
        <label>
          开始时间
          <input
            type="time"
            value={value.start}
            onChange={(event) => onChange({ ...value, start: event.target.value })}
          />
        </label>
        <label>
          结束时间
          <input
            type="time"
            value={value.end}
            onChange={(event) => onChange({ ...value, end: event.target.value })}
          />
        </label>
        <label>
          时区
          <input
            value={value.timeZone}
            onChange={(event) => onChange({ ...value, timeZone: event.target.value })}
            placeholder="Asia/Shanghai"
          />
        </label>
      </div>
      <fieldset className="feature-actions">
        <legend>允许开始的星期</legend>
        {['日', '一', '二', '三', '四', '五', '六'].map((name, day) => (
          <label key={day} className="checkbox-label">
            <input
              type="checkbox"
              checked={value.days.includes(day)}
              onChange={(event) =>
                onChange({
                  ...value,
                  days: event.target.checked
                    ? [...value.days, day].sort()
                    : value.days.filter((item) => item !== day),
                })
              }
            />
            周{name}
          </label>
        ))}
      </fieldset>
      <p className="muted">
        结束时间早于开始时间时跨越午夜；相同时间表示 24 小时。窗口按开始日计算，仅限制后台同步启动。
      </p>
    </div>
  );
}
