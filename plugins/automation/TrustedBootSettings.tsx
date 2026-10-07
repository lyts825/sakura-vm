/**
 * 模块职责（中文）：配置可信启动和 vTPM 密钥，查看启动检查及注册结果。
 * Module responsibility (English): UI interaction and state presentation for resource policy, packages and engineering tasks.
 * 详细范围（中文）：公开入口包括 TrustedBootSettings；职责覆盖资源策略、软件包与工程任务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TrustedBootSettings. The scope covers UI interaction and state presentation for resource policy, packages and engineering tasks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = { policy: { enabled: boolean }; stopped: boolean; attached: boolean };
type Check = { ready: boolean; reason: string | null;
  guest: { efi: boolean; secureBootEnabled: boolean | null;
    setupMode: boolean | null; tpmDevicePresent: boolean } | null };

/**
 * 中文：呈现资源策略、软件包与工程任务的界面交互与状态呈现中的 TrustedBootSettings 界面，订阅 path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the TrustedBootSettings surface for UI interaction and state presentation for resource policy, packages and engineering tasks, subscribing to path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, request } 提供 vmId（当前实例标识）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vmId, request } provides context fields vmId (current VM identifier), request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function TrustedBootSettings({ vmId, request }: { vmId: string; request: Request }) {
  const path = `/vms/${vmId}/trusted-boot`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(/** 中文：当依赖 [vmId, remote.data?.policy?.enabled] 变化时启用标记，check 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, remote.data?.policy?.enabled] change, enabled marker, check state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setEnabled(remote.data?.policy?.enabled || false);
    setCheck(null);
  }, [vmId, remote.data?.policy?.enabled]);
  /**
   * 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const configure = () => void action.run(/** 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request(path, 'POST', { operation: 'configure', policy: { enabled } }, signal);
    remote.reload();
  }, 'TPM 与安全启动策略已保存；下次启动时生效。');
  /**
   * 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const inspect = () => void action.run(/** 中文：提交 POST path，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互并更新check 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for UI interaction and state presentation for resource policy, packages and engineering tasks and update check state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setCheck(await request<Check>(path, 'POST', { operation: 'check' }, signal));
  });
  return <div className="feature-card" role="region" aria-label="TPM 与安全启动">
    <h4>TPM 与安全启动</h4>
    <p className="subtle-note">Linux x86_64 宿主上的 Debian 或 Ubuntu UEFI 实例可使用持久 vTPM 与预登记密钥的 OVMF 固件。停止实例后保存策略，重启并检查实际状态。新建备份和导出包含 TPM 状态与安全启动 NVRAM；包含敏感密钥的备份请设置密码。历史磁盘快照不能与当前 TPM 状态一起导出或克隆。</p>
    <Feedback error={remote.error || action.error} message={action.message} />
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      启用 TPM 与安全启动
    </label>
    <div className="feature-actions">
      <button className="secondary compact" disabled={action.busy || !remote.data?.stopped}
        onClick={configure}>保存策略</button>
      <button className="secondary compact" disabled={action.busy || !remote.data?.attached}
        onClick={inspect}>检查客户机状态</button>
    </div>
    <p role="status">{remote.data?.attached ? 'vTPM 已附加' :
      remote.data?.policy?.enabled ? '等待下次启动' : '未启用'}</p>
    {check && <p role="status">{check.ready ? '客户机已启用安全启动并识别 TPM' :
      check.reason || '尚未确认安全启动与 TPM'}</p>}
  </div>;
}
