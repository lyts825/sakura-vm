import { formatDecimal } from './localization';
import { formatDateTime } from './localization';
import { useState } from 'react';
import type { MetricPoint } from '../server/feature-suite';
import { formatBytes } from './feature-shared';
import { saveBlob, saveText } from './export-file';

const series = {
  cpu: { name: 'CPU 使用率', value: (p: MetricPoint) => p.cpuPercent, percent: true },
  memory: {
    name: '内存使用率',
    value: (p: MetricPoint) => (p.memoryTotal ? (p.memoryUsed / p.memoryTotal) * 100 : null),
    percent: true,
  },
  disk: {
    name: '磁盘使用率',
    value: (p: MetricPoint) => (p.diskTotal ? (p.diskUsed / p.diskTotal) * 100 : null),
    percent: true,
  },
  receive: {
    name: '网络接收速率',
    value: (p: MetricPoint) => p.networkReceiveBytesPerSecond ?? null,
    percent: false,
  },
  transmit: {
    name: '网络发送速率',
    value: (p: MetricPoint) => p.networkTransmitBytesPerSecond ?? null,
    percent: false,
  },
};
const rate = (value?: number | null) =>
  value === null || value === undefined ? '等待连续采样' : formatBytes(value) + '/s';

export function MetricHistory({ history }: { history: MetricPoint[] }) {
  const [kind, setKind] = useState<keyof typeof series>('cpu');
  const selected = series[kind],
    values = history.map((point) => selected.value(point)),
    maximum = selected.percent ? 100 : Math.max(1, ...values.map((value) => value ?? 0)),
    paths: string[][] = [],
    start = Date.parse(history[0]?.sampledAt || ''),
    duration = Date.parse(history.at(-1)?.sampledAt || '') - start;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      paths.push([]);
      return;
    }
    if (!paths.length) paths.push([]);
    const time = Date.parse(history[index].sampledAt);
    if (index && time - Date.parse(history[index - 1].sampledAt) > 120000) paths.push([]);
    paths
      .at(-1)!
      .push(
        `${duration > 0 ? ((time - start) * 600) / duration : 0},${95 - (Math.max(0, Math.min(maximum, value)) / maximum) * 90}`,
      );
  });
  const fields: (keyof MetricPoint)[] = [
    'sampledAt',
    'cpuPercent',
    'memoryUsed',
    'memoryTotal',
    'diskUsed',
    'diskTotal',
    'networkReceivedBytes',
    'networkTransmittedBytes',
    'networkReceiveBytesPerSecond',
    'networkTransmitBytesPerSecond',
  ];
  const csv = () =>
    saveBlob(
      'sakura-metrics.csv',
      new Blob(
        [
          fields.join(',') +
            '\r\n' +
            history.map((point) => fields.map((field) => point[field] ?? '').join(',')).join('\r\n'),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
    );
  return (
    <div>
      <label>
        趋势指标
        <select value={kind} onChange={(event) => setKind(event.target.value as keyof typeof series)}>
          {Object.entries(series).map(([key, item]) => (
            <option key={key} value={key}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <svg className="cpu-history" viewBox="0 0 600 100" role="img" aria-label={selected.name + '历史趋势'}>
        <title>
          {selected.name}，纵轴上限 {selected.percent ? '100%' : formatBytes(maximum) + '/s'}
        </title>
        <path d="M0 95H600 M0 50H600 M0 5H600" stroke="var(--line)" fill="none" />
        {paths
          .filter((path) => path.length)
          .map((path, index) =>
            path.length === 1 ? (
              <circle
                key={index}
                cx={path[0].split(',')[0]}
                cy={path[0].split(',')[1]}
                r="2"
                fill="var(--accent)"
              />
            ) : (
              <polyline
                key={index}
                points={path.join(' ')}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
              />
            ),
          )}
      </svg>
      <p className="subtle-note">
        {history.length} 次采样 · 纵轴上限 {selected.percent ? '100%' : formatBytes(maximum) + '/s'}。
        自动采样每 30 秒一次，持久保留最近 720 次。网络汇总除 lo
        外的接口；首次采样、重启或采样间断超过两分钟时速率未知。
      </p>
      <div className="feature-actions">
        <button className="secondary compact" disabled={!history.length} onClick={csv}>
          导出指标 CSV
        </button>
        <button
          className="secondary compact"
          disabled={!history.length}
          onClick={() => saveText('sakura-metrics.json', history)}
        >
          导出指标 JSON
        </button>
      </div>
      <details>
        <summary>查看采样明细</summary>
        <div className="metric-history-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>CPU</th>
                <th>内存使用</th>
                <th>磁盘使用</th>
                <th>接收</th>
                <th>发送</th>
              </tr>
            </thead>
            <tbody>
              {history
                .slice()
                .reverse()
                .map((point) => (
                  <tr key={point.sampledAt}>
                    <td>{formatDateTime(new Date(point.sampledAt))}</td>
                    <td>{formatDecimal(point.cpuPercent, 1)}%</td>
                    <td>{formatBytes(point.memoryUsed)}</td>
                    <td>{formatBytes(point.diskUsed)}</td>
                    <td>{rate(point.networkReceiveBytesPerSecond)}</td>
                    <td>{rate(point.networkTransmitBytesPerSecond)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
