import { useEffect, useState } from 'react';

type Schema = Record<string, any>;
function JsonField({
  label,
  value,
  update,
  report,
}: {
  label: string;
  value: unknown;
  update: (value: unknown) => void;
  report?: (label: string, invalid: boolean) => void;
}) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(JSON.stringify(value, null, 2));
    setInvalid(false);
  }, [value]);
  useEffect(() => {
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
        onChange={(event) => {
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

export function SchemaFields({
  schema,
  value,
  update,
  prefix = '',
  report,
}: {
  schema: Schema;
  value: Record<string, unknown>;
  update: (value: Record<string, unknown>) => void;
  prefix?: string;
  report?: (label: string, invalid: boolean) => void;
}) {
  return (
    <div className="schema-fields">
      {Object.entries(schema.properties || {}).map(([name, raw]) => {
        const field = raw as Schema;
        const required = schema.required?.includes(name),
          enabled = Object.hasOwn(value, name);
        const label = prefix + (field.title || name) + (required ? ' *' : '');
        const set = (next: unknown) => update({ ...value, [name]: next });
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
