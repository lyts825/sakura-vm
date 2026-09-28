import { useState } from 'react';
import type { JobView } from '../../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveText } from '../../src/export-file';

type MergeView = {
  branchOrigin?: { sourceVmId: string; snapshotId: string; createdAt: string };
  sourceName?: string;
  runs: JobView[];
  persistenceError?: string;
};
type MergeResult = { mode: 'preview' | 'apply'; branchVmId: string; targetVmId: string;
  path: string; applied: string[]; conflicts: string[]; already: string[];
  mergedVmId?: string; checkedAt: string };

export function SnapshotMergePanel({ vm, request, refresh }: FeatureProps) {
  const [path, setPath] = useState('/workspace');
  const [partition, setPartition] = useState(0);
  const [name, setName] = useState((vm.name.slice(0, 24) + '-merged').slice(0, 32));
  const remote = useRemote<MergeView>(request, `/vms/${vm.id}/snapshot-merge`,
    Boolean(vm.branchOrigin), 2000);
  const job = remote.data?.runs[0];
  const result = useRemote<MergeResult>(request, `/jobs/${job?.id}/result`, Boolean(job?.result), 0);
  const action = useAction();
  const cancellation = useAction();
  if (!vm.branchOrigin) return null;
  const launch = (mode: 'preview' | 'apply') => void action.run(async (signal) => {
    await request(`/vms/${vm.id}/snapshot-merge`, 'POST',
      { mode, path, partition, ...(mode === 'apply' ? { name } : {}) }, signal);
    remote.reload();
  }, mode === 'preview' ? '合并预览任务已提交。' : '合并任务已提交。');
  return (
    <section className="feature-card" aria-label="快照分支合并">
      <h4>快照分支合并</h4>
      <p>此实例从 {remote.data?.sourceName || vm.branchOrigin.sourceVmId} 的快照克隆。合并会比较基线、当前分支和原实例；无冲突时把工作区文件变更写入原实例的新副本，原实例与分支保持不变。</p>
      <Feedback error={remote.error || action.error || cancellation.error || result.error || remote.data?.persistenceError}
        message={action.message} />
      <div className="inline-form">
        <label>合并路径
          <input aria-label="合并路径" value={path} maxLength={1024}
            onChange={(event) => setPath(event.target.value)} />
        </label>
        <label>分区编号（整盘为 0）
          <input type="number" min={0} max={128} value={partition}
            onChange={(event) => setPartition(Number(event.target.value))} />
        </label>
        <label>新实例名称
          <input aria-label="合并实例名称" value={name} maxLength={32}
            onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="secondary compact" disabled={vm.poweredOn || action.busy || job?.status === 'running'}
          onClick={() => launch('preview')}>预览三方差异</button>
        <button className="primary compact" disabled={vm.poweredOn || action.busy || !name || job?.status === 'running'}
          onClick={() => launch('apply')}>合并到新实例</button>
      </div>
      <p className="subtle-note">原实例也必须停止。仅处理所选路径内的普通文件和符号链接；不合并磁盘结构、目录属性或项目设置。一次最多应用 200 项、64 MiB；冲突不会生成实例。</p>
      {job && <div><JobLog job={job} />
        {job.status === 'running' && <button className="secondary compact" disabled={cancellation.busy}
          onClick={() => void cancellation.run(async (signal) => {
            await request(`/jobs/${job.id}/cancel`, 'POST', undefined, signal);
            remote.reload();
          })}>取消合并</button>}
      </div>}
      {result.data && <div>
        <p role="status">可应用 {result.data.applied.length} 项；已存在 {result.data.already.length} 项；冲突 {result.data.conflicts.length} 项。
          {result.data.mergedVmId ? ` 新实例 ID：${result.data.mergedVmId}` : ''}</p>
        {result.data.conflicts.length > 0 && <details open><summary>冲突文件</summary><ul>
          {result.data.conflicts.slice(0, 100).map((item) => <li key={item}>{item}</li>)}
        </ul></details>}
        <button className="secondary compact" onClick={() => saveText(`snapshot-merge-${job?.id}.json`, result.data)}>
          下载完整合并结果 JSON
        </button>
        {result.data.mergedVmId && <button className="secondary compact" onClick={() => void refresh()}>
          刷新实例列表
        </button>}
      </div>}
    </section>
  );
}
