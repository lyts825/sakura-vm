import { useState } from 'react';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import { formatDateTime } from '../../src/localization';
import '../../src/features.css';

type RuntimeView = {
  selected: { node?: string; python?: string };
  declared: Record<string, string>;
  actual: Record<string, string>;
  mismatches: string[];
  probe: {
    state: 'unprobed' | 'cached' | 'stale' | 'running' | 'failed';
    checkedAt: string | null;
    configVersion: string | null;
    bootId: string | null;
    errorCode?: string;
  };
  job: JobView | null;
};

export function RuntimePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<RuntimeView>(request, `/vms/${vm.id}/runtimes`, vm.status === 'running', 10000);
  const action = useAction();
  const [tool, setTool] = useState<'node' | 'python'>('node');
  const [version, setVersion] = useState('22.12.0');
  const probeState = remote.data?.probe?.state || 'unprobed';
  const probeBusy = probeState === 'running';
  const runtimeBusy = probeBusy || remote.data?.job?.status === 'running';
  const hasRequirements = Boolean(remote.data &&
    (Object.values(remote.data.selected).some(Boolean) || Object.values(remote.data.declared).some(Boolean)));
  return (
    <>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-card">
        <p>
          项目选择：Node {remote.data?.selected.node || '未指定'} · Python{' '}
          {remote.data?.selected.python || '未指定'}
        </p>
        <p>
          最近探测声明：Node {remote.data?.declared.node || '—'} · Python{' '}
          {remote.data?.declared.python || '—'}
        </p>
        <p>
          最近探测版本：Node {remote.data?.actual.node || '—'} · Python{' '}
          {remote.data?.actual.python || '—'}
        </p>
        {remote.data?.probe?.checkedAt && (
          <p className="subtle-note">
            采样时间：{formatDateTime(new Date(remote.data.probe.checkedAt))}
          </p>
        )}
        {probeState === 'unprobed' && <p>尚未探测，请点击“探测项目版本”。</p>}
        {probeBusy && <p role="status">正在探测项目版本…</p>}
        {probeState === 'stale' && <p>最近采样已过期，请重新探测。</p>}
        {probeState === 'failed' && <p className="machine-error">上次探测未完成，请重试。</p>}
        {probeState === 'cached' && (remote.data?.mismatches.length ? (
          <p className="machine-error">最近探测版本不匹配：{remote.data.mismatches.join('、')}</p>
        ) : hasRequirements ? <p className="feature-success">最近探测版本匹配</p> :
          <p>最近探测未发现版本要求。</p>)}
        <p className="subtle-note">面板刷新只读取最近采样；项目文件或环境变化后需重新探测。</p>
        <button
          className="secondary compact"
          disabled={action.busy || runtimeBusy || !remote.data}
          onClick={() => void action.run(async (signal) => {
            try {
              await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'probe' }, signal);
            } finally { remote.reload(); }
          }, '项目运行时已探测')}
        >
          探测项目版本
        </button>
      </div>
      <div className="feature-actions">
        <select value={tool} onChange={(e) => setTool(e.target.value as 'node' | 'python')}>
          <option value="node">Node.js</option>
          <option value="python">Python</option>
        </select>
        <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="22.12.0" />
        <button
          className="secondary compact"
          disabled={action.busy || runtimeBusy}
          onClick={() =>
            void action.run(async (signal) => {
              await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'install', tool, version }, signal);
              remote.reload();
            })
          }
        >
          安装版本
        </button>
        <button
          className="primary compact"
          disabled={action.busy || runtimeBusy || !remote.data}
          onClick={() =>
            void action.run(async (signal) => {
              try {
                await request(
                  `/vms/${vm.id}/runtimes`,
                  'POST',
                  {
                    action: 'select',
                    node: tool === 'node' ? version : remote.data?.selected.node,
                    python: tool === 'python' ? version : remote.data?.selected.python,
                  },
                  signal,
                );
              } finally { remote.reload(); }
            }, '项目版本已选择')
          }
        >
          应用到项目
        </button>
        <button
          className="secondary compact"
          disabled={action.busy || runtimeBusy || !remote.data || !Object.values(remote.data.selected).some(Boolean)}
          onClick={() => void action.run(async (signal) => {
            try { await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'select' }, signal); }
            finally { remote.reload(); }
          }, '已清除项目版本选择')}
        >
          清除版本选择
        </button>
      </div>
      <JobLog job={remote.data?.job} />
    </>
  );
}

export const developmentSections = { runtimes: RuntimePanel };
