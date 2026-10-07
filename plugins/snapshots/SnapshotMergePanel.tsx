/**
 * 模块职责（中文）：配置快照分支合并与冲突决策，预览合并结果并跟踪合并任务。
 * Module responsibility (English): UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 SnapshotMergePanel；职责覆盖快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SnapshotMergePanel. The scope covers UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import type { SnapshotMergeView } from './view-types';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveText } from '../../src/export-file';

type MergeResult = { mode: 'preview' | 'apply'; branchVmId: string; targetVmId: string;
  path: string; applied: string[]; conflicts: string[]; already: string[];
  mergedVmId?: string; checkedAt: string };


/**
 * 中文：呈现快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现中的 SnapshotMergePanel 界面，订阅 /vms/{vm.id}/snapshot-merge、/jobs/{job?.id}/result，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SnapshotMergePanel surface for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles, subscribing to /vms/{vm.id}/snapshot-merge, /jobs/{job?.id}/result. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request, refresh } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { vm, request, refresh } provides context fields vm (vm state), request (transport capability bound to identity/authority scope), refresh (refresh state)
 */
export function SnapshotMergePanel({ vm, request, refresh }: FeatureProps) {
  const [path, setPath] = useState('/workspace');
  const [partition, setPartition] = useState(0);
  const [name, setName] = useState((vm.name.slice(0, 24) + '-merged').slice(0, 32));
  const remote = useRemote<SnapshotMergeView>(request, `/vms/${vm.id}/snapshot-merge`,
    Boolean(vm.branchOrigin), 2000);
  const job = remote.data?.runs[0];
  const result = useRemote<MergeResult>(request, `/jobs/${job?.id}/result`, Boolean(job?.result), 0);
  const action = useAction();
  const cancellation = useAction();
  if (!vm.branchOrigin) return null;
  /**
   * 中文：提交 POST /vms/{vm.id}/snapshot-merge，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/snapshot-merge for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：mode：签名所示 'preview' | 'apply' 业务值
   * English: Inputs: mode: the 'preview' | 'apply' domain value in the signature
   */
  const launch = (mode: 'preview' | 'apply') => void action.run(/** 中文：提交 POST /vms/{vm.id}/snapshot-merge，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/snapshot-merge for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
          onClick={() => void cancellation.run(/** 中文：提交 POST /jobs/{job.id}/cancel，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /jobs/{job.id}/cancel for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
