/**
 * 模块职责（中文）：按 JSON Schema 生成常见类型的输入控件，保留嵌套或复杂字段的 JSON 编辑能力。
 * Module responsibility (English): Turning JSON schemas into controlled forms and complex JSON inputs.
 * 详细范围（中文）：公开入口包括 SchemaFields；职责覆盖将 JSON Schema 转换为受控表单和复杂 JSON 输入，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SchemaFields. The scope covers Turning JSON schemas into controlled forms and complex JSON inputs. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';

type Schema = Record<string, any>;
/**
 * 中文：呈现将 JSON Schema 转换为受控表单和复杂 JSON 输入中的 JsonField 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the JsonField surface for Turning JSON schemas into controlled forms and complex JSON inputs. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  label,
  value,
  update,
  report,
} 提供 label（label 状态）、value（待校验、转换或保存的输入值）、update（要发布的部分快照字段）、report（向调用者交付状态或进度的回调） 上下文字段
 * English: Inputs: {
  label,
  value,
  update,
  report,
} provides context fields label (label state), value (input value to validate/transform/save), update (partial snapshot fields to publish), report (callback delivering status/progress to the caller)
 */
function JsonField({
  label,
  value,
  update,
  report,
}: {
  label: string;
  value: unknown;
  update: /** 中文：把当前字段新值交给受控表单所有者；这是 JsonField 的调用契约 | English: Deliver current field values to the controlled-form owner; this is the callable contract of JsonField | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: unknown) => void;
  report?: /** 中文：向界面交付进度、连接状态或校验反馈；这是 JsonField 的调用契约 | English: Deliver progress/connection/validation feedback to the surface; this is the callable contract of JsonField | 中文：输入：label：签名所示 string 业务值；invalid：签名所示 boolean 业务值 | English: Inputs: label: the string domain value in the signature; invalid: the boolean domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (label: string, invalid: boolean) => void;
}) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  useEffect(/** 中文：当依赖 [value] 变化时编辑草稿，invalid 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [value] change, editing draft, invalid state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setDraft(JSON.stringify(value, null, 2));
    setInvalid(false);
  }, [value]);
  useEffect(/** 中文：当依赖 [label, invalid, report] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [label, invalid, report] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    report?.(label, invalid);
    return () => report?.(label, false);
  }, [label, invalid, report]);
  return (
    <label>
      {label}
      <textarea
        rows={4}
        value={draft ?? ''}
        aria-invalid={invalid}
        onChange={/** 中文：在将 JSON Schema 转换为受控表单和复杂 JSON 输入流程中编辑草稿，invalid 状态，按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Turning JSON schemas into controlled forms and complex JSON inputs, editing draft, invalid state, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (event) => {
          setDraft(event.target.value);
          try {
            const next = JSON.parse(event.target.value);
            setInvalid(false);
            update(next);
          } catch {
            setInvalid(true);
          }
        }}
        onBlur={(event) => event.target.setCustomValidity(invalid ? '请输入有效的 JSON' : '')}
      />
      {invalid && <span role="alert">尚未应用：JSON 格式无效</span>}
    </label>
  );
}

/**
 * 中文：呈现将 JSON Schema 转换为受控表单和复杂 JSON 输入中的 SchemaFields 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SchemaFields surface for Turning JSON schemas into controlled forms and complex JSON inputs. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  schema,
  value,
  update,
  prefix = '',
  report,
} 提供 schema（schema 状态）、value（待校验、转换或保存的输入值）、update（要发布的部分快照字段）、prefix（prefix 状态）、report（向调用者交付状态或进度的回调） 上下文字段
 * English: Inputs: {
  schema,
  value,
  update,
  prefix = '',
  report,
} provides context fields schema (schema state), value (input value to validate/transform/save), update (partial snapshot fields to publish), prefix (prefix state), report (callback delivering status/progress to the caller)
 */
export function SchemaFields({
  schema,
  value,
  update,
  prefix = '',
  report,
}: {
  schema: Schema;
  value: Record<string, unknown>;
  update: /** 中文：把当前字段新值交给受控表单所有者；这是 SchemaFields 的调用契约 | English: Deliver current field values to the controlled-form owner; this is the callable contract of SchemaFields | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: Record<string, unknown>) => void;
  prefix?: string;
  report?: /** 中文：向界面交付进度、连接状态或校验反馈；这是 SchemaFields 的调用契约 | English: Deliver progress/connection/validation feedback to the surface; this is the callable contract of SchemaFields | 中文：输入：label：签名所示 string 业务值；invalid：签名所示 boolean 业务值 | English: Inputs: label: the string domain value in the signature; invalid: the boolean domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (label: string, invalid: boolean) => void;
}) {
  return (
    <div className="schema-fields">
      {Object.entries(schema.properties || {}).map(/**
       * 中文功能：按 Schema 属性构建输入与必填标记，为可选字段提供启用/移除操作，按 default、enum 或类型选择初值。
       * English: Build inputs/required markers from Schema properties, allow optional fields to be enabled/removed, and choose initial values from default, enum or field type.
       * 输入 / Inputs: [name, raw].
       * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
       * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
       * 设计思路：字段是否存在由 Object.hasOwn 判断，而非值的真假，避免把 false、0 或空字符串误当成未启用。
       * Design: Use Object.hasOwn for field presence instead of truthiness so false, zero or empty strings are not mistaken for disabled fields.
       */
      ([name, raw]) => {
        const field = raw as Schema;
        const required = schema.required?.includes(name),
          enabled = Object.hasOwn(value, name);
        const label = prefix + (field.title || name) + (required ? ' *' : '');
        /**
         * 中文：不可变合并当前字段的新值到受控对象，再交给父级 update，不覆盖其他表单字段。
         * English: Immutably merge this field's value into the controlled object and call the parent's update without replacing other fields.
         * 中文：输入：next：待采用的新状态或数据
         * English: Inputs: next: new state/data to adopt
         */
        const set = (next: unknown) => update({ ...value, [name]: next });
        /**
         * 中文：按 Schema default、首个 enum、类型空值及数值 minimum 顺序选择新增字段初值。
         * English: Choose a new field's initial value from Schema default, first enum member, typed empty value and numeric minimum in that order.
         */
        const initial = () =>
          field.default ??
          field.enum?.[0] ??
          (field.type === 'object'
            ? {}
            : field.type === 'array'
              ? []
              : field.type === 'boolean'
                ? false
                : field.type === 'number' || field.type === 'integer'
                  ? (field.minimum ?? 0)
                  : '');
        return (
          <div className="schema-field" key={name}>
            {!required && (
              <label className="schema-optional">
                <input
                  type="checkbox"
                  checked={enabled}
                  aria-label={'启用 ' + prefix + name}
                  onChange={(event) => {
                    if (event.target.checked) set(initial());
                    else {
                      const next = { ...value };
                      delete next[name];
                      update(next);
                    }
                  }}
                />
                {name}（可选）
              </label>
            )}
            {(required || enabled) &&
              (field.enum ? (
                <label>
                  {label}
                  <select
                    value={String(value[name] ?? field.default ?? '')}
                    onChange={(event) =>
                      set(field.enum.find((item: unknown) => String(item) === event.target.value))
                    }
                  >
                    <option value="" disabled>
                      请选择
                    </option>
                    {field.enum.map((item: unknown) => (
                      <option key={String(item)} value={String(item)}>
                        {String(item)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : field.type === 'object' && field.properties ? (
                <fieldset>
                  <legend>{label}</legend>
                  <SchemaFields
                    schema={field}
                    value={(value[name] || {}) as Record<string, unknown>}
                    update={set}
                    prefix={prefix + name + '.'}
                    report={report}
                  />
                </fieldset>
              ) : field.type === 'boolean' ? (
                <label>
                  <input
                    type="checkbox"
                    checked={value[name] === true}
                    onChange={(event) => set(event.target.checked)}
                  />
                  {label}
                </label>
              ) : ['string', 'number', 'integer'].includes(field.type) ? (
                <label>
                  {label}
                  <input
                    type={field.type === 'string' ? 'text' : 'number'}
                    value={String(value[name] ?? '')}
                    required={required}
                    minLength={field.minLength}
                    maxLength={field.maxLength}
                    pattern={field.pattern}
                    min={field.minimum}
                    max={field.maximum}
                    step={field.type === 'integer' ? 1 : 'any'}
                    onChange={(event) => {
                      if (event.target.value === '' && !required) {
                        const next = { ...value };
                        delete next[name];
                        update(next);
                      } else
                        set(
                          field.type === 'string' || event.target.value === ''
                            ? event.target.value
                            : Number(event.target.value),
                        );
                    }}
                  />
                </label>
              ) : (
                <JsonField label={label} value={value[name] ?? initial()} update={set} report={report} />
              ))}
            {field.description && <small>{field.description}</small>}
          </div>
        );
      })}
    </div>
  );
}
