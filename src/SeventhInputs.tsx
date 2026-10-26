/** 工作台的结构化输入、有限结果预览与显式字段选择；不执行导入内容。 */
import { useState } from 'react';
import type { SuiteRef } from '../shared/contracts/suite-common.ts';
import { SeventhVisual } from './SeventhVisual.tsx';

import { seventhObject, seventhPretty, type SeventhPath } from './SeventhEditor.tsx';
export { SeventhEditor, seventhObject, seventhPretty, type SeventhPath } from './SeventhEditor.tsx';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function TextResult({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : seventhPretty(value);
  return (
    <>
      <pre>{text.length > 8000 ? text.slice(0, 8000) + '\n……' : text || '空值'}</pre>
      {text.length > 8000 && <p className="sv-hint">此处显示前 8,000 个字符。完整数据保留在原记录中。</p>}
    </>
  );
}
export function SeventhResult({
  value,
  depth = 0,
  source,
  definition,
}: {
  value: unknown;
  depth?: number;
  source?: SuiteRef;
  definition?: Record<string, unknown>;
}) {
  return (
    <>
      {depth === 0 && <SeventhVisual value={value} source={source} definition={definition} />}
      <SeventhResultContent value={value} depth={depth} />
    </>
  );
}
function SeventhResultContent({ value, depth }: { value: unknown; depth: number }) {
  const [page, setPage] = useState(0);
  if (depth > 10) return <TextResult value={value} />;
  if (Array.isArray(value) && value.length && value.every((row) => seventhObject(row))) {
    const allKeys = [...new Set(value.flatMap((row) => Object.keys(row)))],
      keys = allKeys.slice(0, 16),
      pages = Math.ceil(value.length / 25),
      current = Math.min(page, pages - 1);
    return (
      <div className="sv-table">
        <div className="sv-pagination">
          <span>
            {value.length} 项 · 第 {current + 1} / {pages} 页
            {allKeys.length > 16 ? ` · 表格显示前 16 / ${allKeys.length} 列` : ''}
          </span>
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            上一页
          </button>
          <button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            下一页
          </button>
        </div>
        <table>
          <thead>
            <tr>
              {keys.map((key) => (
                <th key={key}>{key}</th>
              ))}
              <th>完整行</th>
            </tr>
          </thead>
          <tbody>
            {value.slice(current * 25, (current + 1) * 25).map((row, index) => (
              <tr key={current * 25 + index}>
                {keys.map((key) => (
                  <td key={key}>
                    {seventhObject(row[key]) || Array.isArray(row[key])
                      ? seventhPretty(row[key]).slice(0, 180)
                      : String(row[key] ?? '').slice(0, 240)}
                  </td>
                ))}
                <td>
                  <details>
                    <summary>展开</summary>
                    <TextResult value={row} />
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(value))
    return (
      <div className="sv-result">
        <p>{value.length} 项</p>
        <TextResult value={value} />
      </div>
    );
  const object = seventhObject(value);
  if (object) {
    const entries = Object.entries(object),
      pages = Math.ceil(entries.length / 50),
      current = Math.min(page, Math.max(0, pages - 1));
    return (
      <div className="sv-result">
        {pages > 1 && (
          <div className="sv-pagination">
            <span>
              {entries.length} 个字段 · 第 {current + 1} / {pages} 页
            </span>
            <button disabled={current === 0} onClick={() => setPage(current - 1)}>
              上一页
            </button>
            <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              下一页
            </button>
          </div>
        )}
        {entries.slice(current * 50, (current + 1) * 50).map(([key, item]) => (
          <ResultBranch key={key} name={key} value={item} depth={depth} />
        ))}
      </div>
    );
  }
  return <TextResult value={value} />;
}

function ResultBranch({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 1 || name === 'output' || name === 'error');
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{name}</summary>
      {open && <SeventhResult value={value} depth={depth + 1} />}
    </details>
  );
}

function pathEntries(value: unknown) {
  const entries: { path: SeventhPath; label: string }[] = [];
  const visit = (item: unknown, path: SeventhPath, depth: number) => {
    if (entries.length >= 500 || depth > 16) return;
    const suffix = Array.isArray(item)
      ? `列表，${item.length} 项`
      : seventhObject(item)
        ? '对象'
        : typeof item;
    entries.push({
      path,
      label: (path.length ? path.map((part) => String(part)).join(' / ') : '完整正文') + ' · ' + suffix,
    });
    if (Array.isArray(item))
      item.slice(0, 30).forEach((child, index) => visit(child, [...path, index], depth + 1));
    else {
      const object = seventhObject(item);
      if (object)
        for (const [key, child] of Object.entries(object))
          if (!forbidden.has(key) && key.length > 0 && key.length <= 128)
            visit(child, [...path, key], depth + 1);
    }
  };
  visit(value, [], 0);
  return entries;
}
export function SeventhProjection({
  value,
  path,
  onChange,
  disabled,
}: {
  value: unknown;
  path: SeventhPath;
  onChange: (path: SeventhPath) => void;
  disabled?: boolean;
}) {
  const entries = pathEntries(value);
  return (
    <label className="sv-input">
      <span>取用字段</span>
      <span>
        <select
          aria-label="绑定取用字段"
          value={JSON.stringify(path)}
          onChange={(event) => onChange(JSON.parse(event.target.value) as SeventhPath)}
          disabled={disabled}
        >
          {entries.map((entry) => (
            <option key={JSON.stringify(entry.path)} value={JSON.stringify(entry.path)}>
              {entry.label}
            </option>
          ))}
        </select>
        {entries.length >= 500 && <small>字段树显示有界范围；选择父字段会保留其中的完整内容。</small>}
      </span>
    </label>
  );
}
