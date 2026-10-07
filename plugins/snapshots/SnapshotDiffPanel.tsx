/**
 * 模块职责（中文）：选择基础/目标快照并发起差异比较，展示变更统计和文件条目。
 * Module responsibility (English): UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 SnapshotDiffPanel；职责覆盖快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SnapshotDiffPanel. The scope covers UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from '../../src/localization';
import { useState } from 'react';
import type { SnapshotDiffResult } from '../../shared/snapshot-diff';
import type { SnapshotDiffView } from './view-types';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveText } from '../../src/export-file';

/**
 * 中文：呈现快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现中的 SnapshotDiffPanel 界面，订阅 /vms/{vm.id}/snapshot-diff、/jobs/{job?.id}/result，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SnapshotDiffPanel surface for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles, subscribing to /vms/{vm.id}/snapshot-diff, /jobs/{job?.id}/result. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function SnapshotDiffPanel({ vm, request }: FeatureProps) {
  const [from, setFrom] = useState(vm.snapshots.at(-1)?.id || '');
  const [to, setTo] = useState('current');
  const [path, setPath] = useState('/workspace');
  const [partition, setPartition] = useState(0);
  const action = useAction();
  const cancellation = useAction();
  const remote = useRemote<SnapshotDiffView>(
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
                {shot.name} · {formatDateTime(new Date(shot.createdAt))}
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
                  {shot.name} · {formatDateTime(new Date(shot.createdAt))}
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
            void action.run(/** 中文：提交 POST /vms/{vm.id}/snapshot-diff，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/snapshot-diff for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
                void cancellation.run(/** 中文：提交 POST /jobs/{job.id}/cancel，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /jobs/{job.id}/cancel for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
          {(['added', 'removed', 'modified'] as const).map(/**
           * 中文功能：为新增、删除和修改文件分别生成可折叠列表，显示总数但仅渲染前 100 项，并提示下载完整结果。
           * English: Generate collapsible added/removed/modified file lists, display totals but render only the first 100 entries and direct users to the full downloadable result.
           * 输入 / Inputs: kind.
           * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
           * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
           */
          (kind) => {
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
