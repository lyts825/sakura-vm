/**
 * 模块职责（中文）：编辑由星期和时段组成的时间窗口，复用到同步和调度策略表单。
 * Module responsibility (English): Editing policy windows composed of time zone, weekdays and time ranges.
 * 详细范围（中文）：公开入口包括 TimeWindowFields；职责覆盖编辑时区、星期与时段构成的策略窗口，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TimeWindowFields. The scope covers Editing policy windows composed of time zone, weekdays and time ranges. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { TimeWindow } from '../shared/time-windows';

/**
 * 中文：呈现编辑时区、星期与时段构成的策略窗口中的 TimeWindowFields 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the TimeWindowFields surface for Editing policy windows composed of time zone, weekdays and time ranges. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  value,
  onChange,
} 提供 value（待校验、转换或保存的输入值）、onChange（onChange 状态） 上下文字段
 * English: Inputs: {
  value,
  onChange,
} provides context fields value (input value to validate/transform/save), onChange (onChange state)
 */
export function TimeWindowFields({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: /** 中文：把新表单值交给父级状态所有者；这是 TimeWindowFields 的调用契约 | English: Deliver newly edited form values to the parent state owner; this is the callable contract of TimeWindowFields | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: TimeWindow) => void;
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
