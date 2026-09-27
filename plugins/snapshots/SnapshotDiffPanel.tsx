import { useState } from 'react';
import type { SnapshotDiffResult } from '../../shared/snapshot-diff';
import type { JobView } from '../../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveText } from '../../src/export-file';

export function SnapshotDiffPanel({ vm, request }: FeatureProps) {
  const [from, setFrom] = useState(vm.snapshots.at(-1)?.id || '');
  const [to, setTo] = useState('current');
  const [path, setPath] = useState('/workspace');
  const [partition, setPartition] = useState(0);
  const action = useAction();
  const cancellation = useAction();
  const remote = useRemote<{ runs: JobView[]; persistenceError?: string }>(
    request,
    `/vms/${vm.id}/snapshot-diff`,
    !vm.sandbox,
    2000,
  );
  const job = remote.data?.runs?.[0];
  const result = useRemote<SnapshotDiffResult>(request, `/jobs/${job?.id}/result`, Boolean(job?.result), 0);
  if (vm.sandbox) return null;
  return (
    <section className="feature-card" aria-label="快照差异">
      <h4>快照时间线与差异</h4>
      <p>
        停止实例后比较两个状态的虚拟磁盘内容及指定目录中的普通文件和符号链接。两块磁盘在隔离救援系统中只读挂载；文件按
        SHA-256 比较，结果可下载。
      </p>
      <Feedback
        error={
          remote.error || action.error || cancellation.error || result.error || remote.data?.persistenceError
        }
        message={action.message}
      />
      <div className="inline-form">
        <label>
          起点快照
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            <option value="">选择快照</option>
            {vm.snapshots.map((shot) => (
              <option key={shot.id} value={shot.id}>
                {shot.name} · {new Date(shot.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <label>
          终点状态
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            <option value="current">当前磁盘</option>
            {vm.snapshots
              .filter((shot) => shot.id !== from)
              .map((shot) => (
                <option key={shot.id} value={shot.id}>
                  {shot.name} · {new Date(shot.createdAt).toLocaleString()}
                </option>
              ))}
          </select>
        </label>
        <label>
          客户机路径
          <input
            aria-label="比较路径"
            value={path}
            maxLength={1024}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <label>
          分区编号（整盘为 0）
          <input
            type="number"
            min={0}
            max={128}
            value={partition}
            onChange={(event) => setPartition(Number(event.target.value))}
          />
        </label>
        <button
          className="primary compact"
          disabled={!from || from === to || vm.poweredOn || action.busy || job?.status === 'running'}
          onClick={() =>
            void action.run(async (signal) => {
              await request(`/vms/${vm.id}/snapshot-diff`, 'POST', { from, to, path, partition }, signal);
              remote.reload();
            }, '比较任务已提交。')
          }
        >
          比较快照
        </button>
      </div>
      <p className="subtle-note">
        仅自动挂载 ext2/ext3/ext4；最多扫描 5000 个文件，单次命令输出不超过 1 MiB。建议先比较
        /workspace；范围过大时请缩小路径。仅普通文件和符号链接列入文件差异，磁盘内容比较覆盖整个虚拟磁盘。
      </p>
      {vm.poweredOn && <p className="subtle-note">请先停止实例。</p>}
      {job && (
        <div>
          <JobLog job={job} />
          {job.status === 'running' && (
            <button
              className="secondary compact"
              disabled={cancellation.busy}
              onClick={() =>
                void cancellation.run(async (signal) => {
                  await request(`/jobs/${job.id}/cancel`, 'POST', undefined, signal);
                  remote.reload();
                })
              }
            >
              取消比较
            </button>
          )}
        </div>
      )}
      {result.data && (
        <div>
          <p role="status">
            磁盘内容：{result.data.diskChanged ? '不同' : '相同'}；文件：新增 {result.data.counts.added}、删除{' '}
            {result.data.counts.removed}、修改 {result.data.counts.modified}。
          </p>
          {(['added', 'removed', 'modified'] as const).map((kind) => {
            const rows = result.data![kind];
            return (
              <details key={kind}>
                <summary>
                  {{ added: '新增', removed: '删除', modified: '修改' }[kind]}文件（{rows.length}）
                </summary>
                <ul>
                  {rows.slice(0, 100).map((item) => (
                    <li key={item.path}>{item.path}</li>
                  ))}
                </ul>
                {rows.length > 100 && <p>仅显示前 100 项；下载结果可查看全部。</p>}
              </details>
            );
          })}
          <button
            className="secondary compact"
            onClick={() => saveText(`snapshot-diff-${job?.id}.json`, result.data)}
          >
            下载完整差异 JSON
          </button>
        </div>
      )}
    </section>
  );
}
