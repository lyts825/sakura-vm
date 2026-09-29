import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';
import { formatDateTime } from '../../src/localization';

type Setting = { enabled: boolean; options?: Record<string, unknown>; updatedAt: string };
type PeerView = { outbound: Array<{ id: string; remoteId: string; name: string }> };
type Monitor = { armed: boolean; suspected: boolean; consecutiveFailures: number;
  observedState: string; observedAt: string; suspectedAt?: string;
  sampleIntervalSeconds: number };

export function HaFailoverPanel({ request, vmId, setting, monitor, reload }: {
  request: Request; vmId: string; setting?: Setting; monitor?: Monitor | null; reload: () => void;
}) {
  const peers = useRemote<PeerView>(request, '/host-peers', true, 10000);
  const action = useAction();
  const [enabled, setEnabled] = useState(setting?.enabled ?? false);
  const [targetHostId, setTargetHostId] = useState(String(setting?.options?.targetHostId || ''));
  const [failureThreshold, setFailureThreshold] = useState(
    Number(setting?.options?.failureThreshold || 3));
  const [maxReplicaAgeMinutes, setMaxReplicaAgeMinutes] = useState(
    Number(setting?.options?.maxReplicaAgeMinutes || 1440));
  const [result, setResult] = useState('');
  useEffect(() => {
    if (!setting) return;
    setEnabled(setting.enabled);
    setTargetHostId(String(setting.options?.targetHostId || ''));
    setFailureThreshold(Number(setting.options?.failureThreshold || 3));
    setMaxReplicaAgeMinutes(Number(setting.options?.maxReplicaAgeMinutes || 1440));
  }, [setting?.updatedAt]);
  const options = { ...(targetHostId ? { targetHostId } : {}),
    failureThreshold, maxReplicaAgeMinutes };
  return <div className="ha-failover-panel" aria-label="故障接管策略与健康检查">
    <h4>故障接管策略与健康检查</h4>
    <p className="muted">本机每 15 秒观察主实例运行状态并持久记录连续故障样本；自动接管尚未实现。</p>
    {monitor && <p role={monitor.suspected ? 'alert' : undefined}>
      {monitor.suspected ? '已达到疑似故障阈值' : monitor.armed ? '正在监测主实例' : '监测未就绪'}：
      {monitor.consecutiveFailures}/{Number(setting?.options?.failureThreshold || 3)} 次 ·
      当前状态 {monitor.observedState} · 上次观察 {formatDateTime(monitor.observedAt)}
    </p>}
    <div className="feature-grid compact-grid">
      <label>目标主机
        <select value={targetHostId} onChange={(event) => setTargetHostId(event.target.value)}>
          <option value="">选择已配对主机</option>
          {(peers.data?.outbound || []).map((peer) =>
            <option value={peer.remoteId} key={peer.id}>{peer.name}</option>)}
        </select>
      </label>
      <label>故障检查次数阈值
        <input type="number" min={2} max={10} value={failureThreshold}
          onChange={(event) => setFailureThreshold(Number(event.target.value))} />
      </label>
      <label>副本最长时效（分钟）
        <input type="number" min={1} max={10080} value={maxReplicaAgeMinutes}
          onChange={(event) => setMaxReplicaAgeMinutes(Number(event.target.value))} />
      </label>
      <label className="checkbox-row"><input type="checkbox" checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)} />启用本机故障监测</label>
    </div>
    <div className="feature-actions">
      <button className="secondary" disabled={action.busy || (enabled && !targetHostId)}
        onClick={() => void action.run(async () => {
          await request(`/vms/${vmId}/next-features`, 'POST',
            { action: 'configure', featureId: 'ha-failover', enabled, options });
          reload();
        }, '接管策略已保存')}>保存策略</button>
      <button className="secondary" disabled={action.busy}
        onClick={() => void action.run(async () => {
          const checked = await request(`/vms/${vmId}/next-features`, 'POST',
            { action: 'check', featureId: 'ha-failover' });
          setResult(JSON.stringify(checked, null, 2));
          reload();
        })}>检查健康</button>
    </div>
    <Feedback error={action.error || peers.error} message={action.message} />
    {result && <pre className="feature-log">{result}</pre>}
  </div>;
}
