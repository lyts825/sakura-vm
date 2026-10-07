/**
 * 模块职责（中文）：配置实例的主机目录挂载，展示挂载状态与主机访问策略。
 * Module responsibility (English): UI interaction and state presentation for resource policy, packages and engineering tasks.
 * 详细范围（中文）：公开入口包括 HostMountSettings；职责覆盖资源策略、软件包与工程任务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HostMountSettings. The scope covers UI interaction and state presentation for resource policy, packages and engineering tasks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = {
  policy: { enabled: boolean; hostPath: string; readOnly: boolean };
  guestPath: string;
  running: boolean;
  mounted: boolean;
  observation: { at: string; mounted: boolean; error?: string } | null;
};

/**
 * 中文：呈现资源策略、软件包与工程任务的界面交互与状态呈现中的 HostMountSettings 界面，订阅 path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the HostMountSettings surface for UI interaction and state presentation for resource policy, packages and engineering tasks, subscribing to path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, request } 提供 vmId（当前实例标识）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vmId, request } provides context fields vmId (current VM identifier), request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function HostMountSettings({ vmId, request }: { vmId: string; request: Request }) {
  const path = `/vms/${vmId}/host-mount`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [hostPath, setHostPath] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  useEffect(/** 中文：当依赖 [vmId, remote.data?.policy?.enabled, remote.data?.policy?.hostPath, remote.data?.policy?.readOnly] 变化时启用标记，hostPath 状态，readOnly 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, remote.data?.policy?.enabled, remote.data?.policy?.hostPath, remote.data?.policy?.readOnly] change, enabled marker, hostPath state, readOnly state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!remote.data) return;
    setEnabled(remote.data.policy.enabled);
    setHostPath(remote.data.policy.hostPath);
    setReadOnly(remote.data.policy.readOnly);
  }, [vmId, remote.data?.policy?.enabled, remote.data?.policy?.hostPath,
    remote.data?.policy?.readOnly]);
  /**
   * 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：payload：签名所示 unknown 业务值；message：签名所示 string 业务值
   * English: Inputs: payload: the unknown domain value in the signature; message: the string domain value in the signature
   */
  const run = (payload: unknown, message: string) => void action.run(/** 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request(path, 'POST', payload, signal);
    remote.reload();
  }, message);
  return <div className="feature-card" role="region" aria-label="宿主目录挂载">
    <h4>宿主目录挂载</h4>
    <p className="subtle-note">把选定的 Windows 目录挂载到客户机 {remote.data?.guestPath || '/mnt/sakura-host'}。默认只读；启用后在实例启动时自动挂载。客户机首次使用需要安装 SSHFS 和 FUSE。</p>
    <Feedback error={remote.error || action.error || remote.data?.observation?.error}
      message={action.message} />
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      启用宿主目录挂载
    </label>
    <div className="inline-form">
      <label>Windows 目录绝对路径
        <input value={hostPath} onChange={(event) => setHostPath(event.target.value)}
          placeholder="C:\\Users\\me\\Projects" />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)} />
        只读挂载
      </label>
      <button className="secondary compact" disabled={action.busy || enabled && !hostPath.trim()}
        onClick={() => run({ operation: 'configure',
          policy: { enabled, hostPath: hostPath.trim(), readOnly } }, '宿主目录挂载策略已保存。')}>
        保存挂载策略
      </button>
      <button className="secondary compact"
        disabled={action.busy || !remote.data?.running || !remote.data?.policy?.enabled || remote.data?.mounted}
        onClick={() => run({ operation: 'mount' }, '宿主目录已挂载。')}>立即挂载</button>
      <button className="secondary compact" disabled={action.busy || !remote.data?.mounted}
        onClick={() => run({ operation: 'unmount' }, '宿主目录已卸载并停用。')}>
        卸载并停用
      </button>
    </div>
    <p role="status">{remote.data?.mounted ? '已挂载' :
      remote.data?.policy?.enabled ? '等待实例运行或挂载重试' : '未启用'} ·
      {remote.data?.policy?.readOnly ? '只读' : '可写'}</p>
  </div>;
}
