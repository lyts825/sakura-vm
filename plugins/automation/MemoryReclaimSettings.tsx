/**
 * 模块职责（中文）：配置动态内存回收策略并展示资源采样和回收结果。
 * Module responsibility (English): UI interaction and state presentation for resource policy, packages and engineering tasks.
 * 详细范围（中文）：公开入口包括 MemoryReclaimSettings；职责覆盖资源策略、软件包与工程任务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include MemoryReclaimSettings. The scope covers UI interaction and state presentation for resource policy, packages and engineering tasks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = {
  policy: { enabled: boolean; minMiB: number };
  effectiveMinMiB: number;
  currentTargetMiB: number;
  observation: { at: string; totalMiB: number; availableMiB: number; targetMiB: number;
    decision: string; reason: string; error?: string } | null;
};

/**
 * 中文：呈现资源策略、软件包与工程任务的界面交互与状态呈现中的 MemoryReclaimSettings 界面，订阅 path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MemoryReclaimSettings surface for UI interaction and state presentation for resource policy, packages and engineering tasks, subscribing to path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, maximum, running, request } 提供 vmId（当前实例标识）、maximum（maximum 状态）、running（running 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vmId, maximum, running, request } provides context fields vmId (current VM identifier), maximum (maximum state), running (running state), request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function MemoryReclaimSettings({ vmId, maximum, running, request }: {
  vmId: string; maximum: number; running: boolean; request: Request;
}) {
  const path = `/vms/${vmId}/memory-reclaim`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [minimum, setMinimum] = useState(256);
  useEffect(/** 中文：当依赖 [vmId, remote.data?.policy?.enabled, remote.data?.policy?.minMiB] 变化时启用标记，minimum 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, remote.data?.policy?.enabled, remote.data?.policy?.minMiB] change, enabled marker, minimum state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!remote.data?.policy) return;
    setEnabled(remote.data.policy.enabled);
    setMinimum(remote.data.policy.minMiB);
  }, [vmId, remote.data?.policy?.enabled, remote.data?.policy?.minMiB]);
  /**
   * 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const save = () => void action.run(/** 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request(path, 'POST', { operation: 'configure',
      policy: { enabled, minMiB: minimum } }, signal);
    remote.reload();
  }, '自动内存回收策略已保存。');
  /**
   * 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const sample = () => void action.run(/** 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
