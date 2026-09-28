import { formatDecimal } from '../../src/localization';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRemote, Feedback, formatBytes, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
type Metrics = {
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptime: number;
  processes: { name: string; memory: number }[];
  sampledAt: string;
  networkReceiveBytesPerSecond?: number | null;
  networkTransmitBytesPerSecond?: number | null;
};
export function MetricsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<Metrics>(request, `/vms/${vm.id}/metrics`, vm.status === 'running');
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    if (remote.data) setHistory((h) => [...h.slice(-29), remote.data!.cpuPercent]);
  }, [remote.data]);
  const m = remote.data;
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>实时资源</h3>
          <p>客户机实际使用量 · 每 5 秒采样</p>
        </div>
        <button className="icon-button" aria-label="刷新资源" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={remote.error} />
      {!m ? (
        <p className="muted">{vm.status === 'running' ? '正在采样…' : '启动发行版后查看实时资源。'}</p>
      ) : (
        <>
          <div className="metrics-grid">
            {[
              ['CPU', `${formatDecimal(m.cpuPercent, 1)}%`, m.cpuPercent],
              [
                '内存',
                `${formatBytes(m.memoryUsed)} / ${formatBytes(m.memoryTotal)}`,
                (100 * m.memoryUsed) / m.memoryTotal,
              ],
              [
                '根分区',
                `${formatBytes(m.diskUsed)} / ${formatBytes(m.diskTotal)}`,
                (100 * m.diskUsed) / m.diskTotal,
              ],
            ].map(([title, value, percent]) => (
              <div className="metric-tile" key={title}>
                <span>{title}</span>
                <strong>{value}</strong>
                <progress max={100} value={Number(percent)} />
              </div>
            ))}
          </div>
          <p>
            网络接收：
            {m.networkReceiveBytesPerSecond == null
              ? '等待连续采样'
              : formatBytes(m.networkReceiveBytesPerSecond) + '/s'}{' '}
            · 发送：
            {m.networkTransmitBytesPerSecond == null
              ? '等待连续采样'
              : formatBytes(m.networkTransmitBytesPerSecond) + '/s'}
          </p>
          <svg className="cpu-history" viewBox="0 0 600 100" role="img" aria-label="最近 30 次 CPU 使用率">
            <path d="M0 95H600 M0 50H600 M0 5H600" stroke="var(--line)" fill="none" />
            <polyline
              points={history.map((n, i) => `${(i * 600) / 29},${95 - n * 0.9}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
            />
          </svg>
          <p className="muted">
            运行 {Math.floor(m.uptime / 3600)} 小时 {Math.floor((m.uptime % 3600) / 60)} 分钟 · 更新于{' '}
            {new Date(m.sampledAt).toLocaleTimeString()}
          </p>
          <h4>内存占用最高的进程</h4>
          <div className="feature-list">
            {m.processes.map((p, i) => (
              <div key={i}>
                <code>{p.name}</code>
                <span>{formatBytes(p.memory)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const tabs = { metrics: MetricsPanel };
