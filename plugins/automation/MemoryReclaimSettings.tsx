import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = {
  policy: { enabled: boolean; minMiB: number };
  effectiveMinMiB: number;
  currentTargetMiB: number;
  observation: { at: string; totalMiB: number; availableMiB: number; targetMiB: number;
    decision: string; reason: string; error?: string } | null;
};

export function MemoryReclaimSettings({ vmId, maximum, running, request }: {
  vmId: string; maximum: number; running: boolean; request: Request;
}) {
  const path = `/vms/${vmId}/memory-reclaim`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [minimum, setMinimum] = useState(256);
  useEffect(() => {
    if (!remote.data?.policy) return;
    setEnabled(remote.data.policy.enabled);
    setMinimum(remote.data.policy.minMiB);
  }, [vmId, remote.data?.policy?.enabled, remote.data?.policy?.minMiB]);
  const save = () => void action.run(async (signal) => {
    await request(path, 'POST', { operation: 'configure',
      policy: { enabled, minMiB: minimum } }, signal);
    remote.reload();
  }, '自动内存回收策略已保存。');
  const sample = () => void action.run(async (signal) => {
    await request(path, 'POST', { operation: 'sample' }, signal);
    remote.reload();
  }, '内存压力已采样。');
  return <div className="feature-card" role="region" aria-label="自动内存回收">
    <h4>按客户机压力自动回收内存</h4>
    <p className="subtle-note">客户机可用内存连续三次超过 55% 时，通过 Virtio 气球每次回收至多 64 MiB；低于 20% 时恢复 128 MiB。每 15 秒检查一次，调整后冷却 60 秒。</p>
    <Feedback error={remote.error || action.error || remote.data?.observation?.error}
      message={action.message} />
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      启用自动内存回收
    </label>
    <div className="inline-form">
      <label>最低内存目标（MiB）
        <input type="number" min={256} max={maximum} step={64} value={minimum}
          onChange={(event) => setMinimum(Number(event.target.value))} />
      </label>
      <button className="secondary compact" disabled={action.busy || minimum < 256 || minimum > maximum}
        onClick={save}>保存回收策略</button>
      <button className="secondary compact" disabled={action.busy || !running}
        onClick={sample}>立即采样</button>
    </div>
    <p className="subtle-note">当前目标：{remote.data?.currentTargetMiB ?? maximum} MiB；发行版安全下限：{remote.data?.effectiveMinMiB ?? 256} MiB。手动调整内存目标后，自动策略可能在后续采样中再次调整。</p>
    {remote.data?.observation && <p role="status">最近采样：可用 {remote.data.observation.availableMiB} / {remote.data.observation.totalMiB} MiB；{remote.data.observation.reason}。</p>}
  </div>;
}
