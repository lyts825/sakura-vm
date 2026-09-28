import { useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

type Policy = { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string };
type Target = { peerId: string; hostId: string; name: string; beforeRevision: number;
  state: 'pending' | 'applied' | 'failed'; error?: string; appliedAt?: string };
type Batch = { id: string; revision: number; policy: Policy; targets: Target[];
  createdAt: string; updatedAt: string };
type Peers = { outbound: { id: string; name: string; url: string }[] };
type Plugins = { plugins: { id: string; name: string }[] };

export function FleetPolicyRolloutSettings({ request }: { request: Request }) {
  const batches = useRemote<{ batches: Batch[] }>(request, '/fleet-policy-rollouts', true, 5000);
  const peers = useRemote<Peers>(request, '/host-peers', true, 5000);
  const plugins = useRemote<Plugins>(request, '/feature-rollouts', true, 5000);
  const action = useAction();
  const [policy, setPolicy] = useState<Policy>({ pluginId: '', enabled: true,
    percentage: 100, cohortVersion: '1' });
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Batch | null>(null);
  const available = plugins.data?.plugins || [];
  const draft = { ...policy, pluginId: policy.pluginId || available[0]?.id || '' };
  const create = () => void action.run(async (signal) => {
    const result = await request<Batch>('/fleet-policy-rollouts', 'POST',
      { operation: 'create', policy: draft, peers: selected }, signal);
    setReview(result);
    batches.reload();
  }, '批次已保存，请核对目标后发布');
  const publish = (batch: Batch) => void action.run(async (signal) => {
    const result = await request<Batch>('/fleet-policy-rollouts', 'POST',
      { operation: 'publish', id: batch.id, revision: batch.revision }, signal);
    setReview(result);
    batches.reload();
  }, '发布尝试已记录，请查看各主机结果');
  return <section className="system-card" aria-label="集群策略发布">
    <h3>集群策略发布</h3>
    <p>从已配对主机建立版本化批次，先保存目标当前版本供复核，再向获授权的主机逐台发布。灰度策略在各目标下次启动 Sakura 时生效；失败目标可按原批次重试。</p>
    <Feedback error={action.error || batches.error || peers.error || plugins.error} message={action.message} />
    <div className="shortcut-fields">
      <label>插件
        <select aria-label="集群插件" value={draft.pluginId}
          onChange={(event) => setPolicy({ ...policy, pluginId: event.target.value })}>
          {available.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={policy.enabled}
        onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} />启用插件</label>
      <label>灰度百分比
        <input aria-label="集群灰度百分比" type="number" min={0} max={100} value={policy.percentage}
          onChange={(event) => setPolicy({ ...policy, percentage: Number(event.target.value) })} />
      </label>
      <label>分桶版本
        <input aria-label="集群分桶版本" maxLength={64} value={policy.cohortVersion}
          onChange={(event) => setPolicy({ ...policy, cohortVersion: event.target.value })} />
      </label>
    </div>
    <div className="feature-card">
      <h4>目标主机</h4>
      {!peers.data?.outbound.length && <p className="subtle-note">请先配对远端主机，并在目标主机授权此主机发布策略。</p>}
      {peers.data?.outbound.map((peer) => <label key={peer.id} className="checkbox-row">
        <input type="checkbox" checked={selected.includes(peer.id)} onChange={(event) =>
          setSelected((current) => event.target.checked ? [...current, peer.id]
            : current.filter((id) => id !== peer.id))} />
        {peer.name} · {peer.url}
      </label>)}
    </div>
    <button className="primary compact" disabled={action.busy || !draft.pluginId || !selected.length ||
      !Number.isInteger(policy.percentage) || policy.percentage < 0 || policy.percentage > 100 ||
      !policy.cohortVersion.trim()} onClick={create}>保存待发布批次</button>
    {review && <div className="feature-card" aria-label="待发布策略批次">
      <h4>复核批次 {review.id.slice(0, 8)}</h4>
      <p>{review.policy.pluginId} · {review.policy.enabled ? '启用' : '停用'} ·
        {review.policy.percentage}% · 版本 {review.policy.cohortVersion}</p>
      {review.targets.map((target) => <p key={target.peerId}>{target.name} ·
        原修订 {target.beforeRevision} · {target.state === 'applied' ? '已发布' :
          target.state === 'failed' ? '失败' : '待发布'}{target.error && ` · ${target.error}`}</p>)}
      {review.targets.some((target) => target.state !== 'applied') &&
        <button className="primary compact" disabled={action.busy} onClick={() => publish(review)}>发布或重试批次</button>}
    </div>}
    {!!batches.data?.batches.length && <div className="feature-card">
      <h4>历史批次</h4>
      {batches.data.batches.map((batch) => <button key={batch.id} className="text-button"
        onClick={() => setReview(batch)}>{batch.id.slice(0, 8)} · {batch.policy.pluginId} ·
          {batch.targets.filter((target) => target.state === 'applied').length}/{batch.targets.length} 已发布</button>)}
    </div>}
  </section>;
}
