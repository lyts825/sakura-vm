/** 可复用的结构化输入编辑，不依赖任何结果或可视化组件。 */
import { useState } from 'react';
export type SeventhPath = (string | number)[];
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const seventhObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export const seventhPretty = (value: unknown) => JSON.stringify(value, null, 2) ?? '';

function AddField({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (next: unknown) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('text');
  const invalid = !name.trim() || name.length > 128 || forbidden.has(name) || Object.hasOwn(value, name);
  return (
    <div className="sv-add-field">
      <input
        aria-label="新字段名称"
        placeholder="新字段名称"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select aria-label="新字段类型" value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="text">文本</option>
        <option value="number">数值</option>
        <option value="boolean">布尔</option>
        <option value="object">对象</option>
        <option value="array">列表</option>
        <option value="null">空值</option>
      </select>
      <button
        type="button"
        disabled={invalid}
        onClick={() => {
          onChange({
            ...value,
            [name]:
              kind === 'number'
                ? 0
                : kind === 'boolean'
                  ? false
                  : kind === 'object'
                    ? {}
                    : kind === 'array'
                      ? []
                      : kind === 'null'
                        ? null
                        : '',
          });
          setName('');
        }}
      >
        添加字段
      </button>
    </div>
  );
}

export function SeventhEditor({
  value,
  onChange,
  label,
  depth = 0,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
  depth?: number;
}) {
  if (depth > 8)
    return (
      <div className="sv-field">
        <strong>{label}</strong>
        <p>较深结构请在高级输入中编辑；完整内容会保留。</p>
        <pre>{seventhPretty(value).slice(0, 4000)}</pre>
      </div>
    );
  if (Array.isArray(value))
    return (
      <details open={depth < 2} className="sv-field">
        <summary>
          {label} · {value.length} 项
        </summary>
        {value.slice(0, 30).map((item, index) => (
          <div className="sv-array-row" key={index}>
            <SeventhEditor
              label={`第 ${index + 1} 项`}
              value={item}
              depth={depth + 1}
              onChange={(next) => onChange(value.map((old, at) => (at === index ? next : old)))}
            />
            <button type="button" onClick={() => onChange(value.filter((_, at) => at !== index))}>
              移除此项
            </button>
          </div>
        ))}
        {value.length > 30 && (
          <p className="sv-hint">当前展开前 30 项，其他 {value.length - 30} 项保留；计划使用完整列表。</p>
        )}
        <button
          type="button"
          onClick={() => onChange([...value, value.length ? structuredClone(value[0]) : ''])}
        >
          添加一项
        </button>
      </details>
    );
  const object = seventhObject(value);
  if (object)
    return (
      <fieldset className="sv-field">
        <legend>{label}</legend>
        {Object.entries(object)
          .slice(0, 60)
          .map(([key, item]) => (
            <div key={key} className="sv-object-field">
              <SeventhEditor
                label={key}
                value={item}
                depth={depth + 1}
                onChange={(next) => onChange({ ...object, [key]: next })}
              />
              <button
                type="button"
                className="sv-remove-field"
                aria-label={`移除字段 ${key}`}
                onClick={() => {
                  const next = { ...object };
                  delete next[key];
                  onChange(next);
                }}
              >
                移除
              </button>
            </div>
          ))}
        {Object.keys(object).length > 60 && (
          <p className="sv-hint">显示前 60 个字段，其余字段完整保留，可在高级输入中编辑。</p>
        )}
        <AddField value={object} onChange={onChange} />
      </fieldset>
    );
  return (
    <div className="sv-input">
      <span>{label}</span>
      <span className="sv-scalar">
        {typeof value === 'boolean' ? (
          <input
            aria-label={label}
            type="checkbox"
            checked={value}
            onChange={(event) => onChange(event.target.checked)}
          />
        ) : typeof value === 'number' ? (
          <input
            aria-label={label}
            type="number"
            value={value}
            step="any"
            onChange={(event) => {
              if (event.target.value !== '' && Number.isFinite(Number(event.target.value)))
                onChange(Number(event.target.value));
            }}
          />
        ) : value === null ? (
          <span>
            空值{' '}
            <button type="button" onClick={() => onChange('')}>
              改为文本
            </button>
          </span>
        ) : (
          <textarea
            aria-label={label}
            rows={typeof value === 'string' && value.includes('\n') ? 5 : 1}
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {value !== null && (
          <button type="button" className="sv-small" onClick={() => onChange(null)}>
            设为空值
          </button>
        )}
      </span>
    </div>
  );
}
