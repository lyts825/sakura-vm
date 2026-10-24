/** 固定引用选择器：显示修订和外来参考状态。 */
import type { SuiteRecord } from '../shared/contracts/suite-common';
import { suiteReferenceKey } from './suite-client';
export function SuiteRecordSelect({
  title,
  rows,
  value,
  onChange,
}: {
  title: string;
  rows: SuiteRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {title}
      <select aria-label={title} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">选择固定修订</option>
        {rows
          .filter((row) => row.state === 'sealed')
          .map((row) => (
            <option key={suiteReferenceKey(row)} value={suiteReferenceKey(row)}>
              {row.name} · {row.revision.slice(0, 8)}
              {row.origin === 'imported' ? ' · 导入参考' : ''}
            </option>
          ))}
      </select>
    </label>
  );
}
