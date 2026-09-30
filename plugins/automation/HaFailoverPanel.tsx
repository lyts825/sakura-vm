import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';
import { formatDateTime } from '../../src/localization';

type Setting = { enabled: boolean; options?: Record<string, unknown>; updatedAt: string };
type PeerView = { outbound: Array<{ id: string; remoteId: string; name: string }> };
type Monitor = { armed: boolean; suspected: boolean; consecutiveFailures: number;
  observedState: string; observedAt: string; suspectedAt?: string;
  sampleIntervalSeconds: number };
type Promotion = { remoteVmId: string; snapshotId: string; status: 'fenced' | 'accepted';
  fencedAt: string; error?: string };

export function HaFailoverPanel({ request, vmId, setting, monitor, promotion, localFailover,
  hostFailover,
  reload }: {
  request: Request; vmId: string; setting?: Setting; monitor?: Monitor | null;
  promotion?: Promotion | null; localFailover?: { error: string | null } | null;
  hostFailover?: { configured: boolean; armed: boolean; phase: string | null;
    targetVmId: string | null; error: string | null } | null;
  reload: () => void;
}) {
  const peers = useRemote<PeerView>(request, '/host-peers', true, 10000);
  const action = useAction();
  const [enabled, setEnabled] = useState(setting?.enabled ?? false);
  const [targetHostId, setTargetHostId] = useState(String(setting?.options?.targetHostId || ''));
  const [failureThreshold, setFailureThreshold] = useState(
    Number(setting?.options?.failureThreshold || 3));
  const [maxReplicaAgeMinutes, setMaxReplicaAgeMinutes] = useState(
    Number(setting?.options?.maxReplicaAgeMinutes || 1440));
  const [autoProcessFailover, setAutoProcessFailover] = useState(
    setting?.options?.autoProcessFailover === true);
  const [autoHostFailover, setAutoHostFailover] = useState(
    setting?.options?.autoHostFailover === true);
  const [dataReconciled, setDataReconciled] = useState(false);
  const [result, setResult] = useState('');
  const rejoinAvailable = !!promotion || ['fencing', 'fenced', 'promoted'].includes(hostFailover?.phase || '');
  useEffect(() => { setDataReconciled(false); },
    [vmId, promotion?.remoteVmId, hostFailover?.targetVmId, rejoinAvailable]);
  useEffect(() => {
    if (!setting) return;
    setEnabled(setting.enabled);
    setTargetHostId(String(setting.options?.targetHostId || ''));
    setFailureThreshold(Number(setting.options?.failureThreshold || 3));
    setMaxReplicaAgeMinutes(Number(setting.options?.maxReplicaAgeMinutes || 1440));
    setAutoProcessFailover(setting.options?.autoProcessFailover === true);
    setAutoHostFailover(setting.options?.autoHostFailover === true);
  }, [setting?.updatedAt]);
  const options = { ...(targetHostId ? { targetHostId } : {}),
    failureThreshold, maxReplicaAgeMinutes, autoProcessFailover, autoHostFailover };
  return <div className="ha-failover-panel" aria-label="故障接管策略与健康检查">
    <h4>故障接管策略与健康检查</h4>
    <p className="muted">本机每 15 秒观察主实例。进程接管先持久封锁来源再启动副本；宿主失联接管还需独立见证节点、带外电源隔离、应用健康检查与流量切换配置。</p>
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
      <label className="checkbox-row"><input type="checkbox" checked={autoProcessFailover}
        onChange={(event) => setAutoProcessFailover(event.target.checked)} />本机 QEMU 进程退出后自动接管</label>
      <label className="checkbox-row"><input type="checkbox" checked={autoHostFailover}
        disabled={!hostFailover?.configured}
        onChange={(event) => setAutoHostFailover(event.target.checked)} />独立见证节点确认宿主隔离后自动接管</label>
    </div>
    {autoHostFailover && hostFailover && <p role={hostFailover.error ? 'alert' : undefined}>
      见证节点：{hostFailover.phase === 'promoted' ? '目标已接管' :
        hostFailover.phase === 'fencing' ? '正在隔离来源' :
        hostFailover.phase === 'fenced' ? '来源已隔离，等待目标就绪' :
        hostFailover.armed ? '已布防' : '未布防'}
      {hostFailover.targetVmId && ` · 目标 ${hostFailover.targetVmId}`}
      {hostFailover.error && ` · ${hostFailover.error}`}</p>}
    {!hostFailover?.configured && <p className="muted">需先设置 SAKURA_HA_WITNESS_CONFIG_FILE 并重启 Sakura，才能启用宿主失联接管。</p>}
    {promotion && <p role="alert">来源启动已被持久封锁；目标实例 <code>{promotion.remoteVmId}</code>：
      {promotion.status === 'accepted' ? '已接受启动' : '等待启动确认'} ·
      栅栏时间 {formatDateTime(promotion.fencedAt)}
      {promotion.error && ` · ${promotion.error}`}</p>}
    {localFailover?.error && <p role="alert">最近一次接管尝试：{localFailover.error}</p>}
    {rejoinAvailable && <label className="checkbox-row"><input type="checkbox"
      checked={dataReconciled} onChange={(event) => setDataReconciled(event.target.checked)} />
      已回迁目标运行期间的写入数据，或接受丢失这些新数据</label>}
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
      {rejoinAvailable &&
        <button className="secondary" disabled={action.busy || !dataReconciled}
        onClick={() => void action.run(async () => {
          await request(`/vms/${vmId}/next-features`, 'POST',
            { action: 'run', featureId: 'ha-failover',
              options: { mode: 'rejoin', dataReconciled: true } });
          setDataReconciled(false);
          reload();
        }, '目标副本已持久封锁，来源可以重新启动')}>目标停机后退出接管</button>}
    </div>
    <Feedback error={action.error || peers.error} message={action.message} />
    {result && <pre className="feature-log">{result}</pre>}
  </div>;
}
