/**
 * 模块职责（中文）：配置实例高可用与见证节点，查看故障转移监控和提升记录。
 * Module responsibility (English): UI interaction and state presentation for resource policy, packages and engineering tasks.
 * 详细范围（中文）：公开入口包括 HaFailoverPanel；职责覆盖资源策略、软件包与工程任务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HaFailoverPanel. The scope covers UI interaction and state presentation for resource policy, packages and engineering tasks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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

/**
 * 中文：呈现资源策略、软件包与工程任务的界面交互与状态呈现中的 HaFailoverPanel 界面，订阅 /host-peers，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the HaFailoverPanel surface for UI interaction and state presentation for resource policy, packages and engineering tasks, subscribing to /host-peers. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request, vmId, setting, monitor, promotion, localFailover,
  hostFailover,
  reload } 提供 request（带身份和权限作用域的传输能力）、vmId（当前实例标识）、setting（ting 状态）、monitor（monitor 状态）、promotion（promotion 状态）、localFailover（localFailover 状态）、hostFailover（hostFailover 状态）、reload（reload 状态） 上下文字段
 * English: Inputs: { request, vmId, setting, monitor, promotion, localFailover,
  hostFailover,
  reload } provides context fields request (transport capability bound to identity/authority scope), vmId (current VM identifier), setting (ting state), monitor (monitor state), promotion (promotion state), localFailover (localFailover state), hostFailover (hostFailover state), reload (reload state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function HaFailoverPanel({ request, vmId, setting, monitor, promotion, localFailover,
  hostFailover,
  reload }: {
  request: Request; vmId: string; setting?: Setting; monitor?: Monitor | null;
  promotion?: Promotion | null; localFailover?: { error: string | null } | null;
  hostFailover?: { configured: boolean; armed: boolean; phase: string | null;
    targetVmId: string | null; error: string | null;
    failback?: 'pending' | 'completed' | null; recoveryHeld?: boolean;
    statusPending?: boolean } | null;
  reload: /** 中文：使当前资源重新核对，供成功写入后恢复列表或详情；这是 HaFailoverPanel 的调用契约 | English: Reconcile the current resource after successful mutations to restore list/detail state; this is the callable contract of HaFailoverPanel | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
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
  const rejoinAvailable = !!promotion || !!hostFailover?.recoveryHeld ||
    ['fencing', 'fenced', 'promoted'].includes(hostFailover?.phase || '');
  useEffect(/** 中文：当依赖 [vmId, promotion?.remoteVmId, hostFailover?.targetVmId, rejoinAvailable] 变化时dataReconciled 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, promotion?.remoteVmId, hostFailover?.targetVmId, rejoinAvailable] change, dataReconciled state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { setDataReconciled(false); },
    [vmId, promotion?.remoteVmId, hostFailover?.targetVmId, rejoinAvailable]);
  useEffect(/** 中文：当依赖 [setting?.updatedAt] 变化时启用标记，targetHostId 状态，failureThreshold 状态，maxReplicaAgeMinutes 状态，autoProcessFailover 状态，autoHostFailover 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [setting?.updatedAt] change, enabled marker, targetHostId state, failureThreshold state, maxReplicaAgeMinutes state, autoProcessFailover state, autoHostFailover state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
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
  return <div id={`ha-failover-${vmId}`} tabIndex={-1}
    className="ha-failover-panel" aria-label="故障接管策略与健康检查">
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
    {(autoHostFailover || hostFailover?.failback || hostFailover?.recoveryHeld ||
      hostFailover?.statusPending) && hostFailover &&
      <p role={hostFailover.error || hostFailover.recoveryHeld ? 'alert' : undefined}>
      见证节点：{hostFailover.recoveryHeld ? '恢复封锁，等待核对全部历史副本' :
        hostFailover.statusPending ? '正在恢复见证状态，将自动重试' :
        hostFailover.failback === 'pending' ? '等待来源健康并回切流量' :
        hostFailover.failback === 'completed' ? '流量已回切来源' :
        hostFailover.phase === 'promoted' ? '目标已接管' :
        hostFailover.phase === 'fencing' ? '正在隔离来源' :
        hostFailover.phase === 'fenced' ? '来源已隔离，等待目标就绪' :
        hostFailover.armed ? '已布防' : '未布防'}
      {hostFailover.targetVmId && ` · 目标 ${hostFailover.targetVmId}`}
      {hostFailover.error && ` · ${hostFailover.error}`}</p>}
    {hostFailover?.failback === 'pending' &&
      !(setting?.enabled && setting.options?.autoHostFailover) &&
      <p className="muted">后续接管已关闭，已授权的流量回切仍会继续。</p>}
    {hostFailover?.recoveryHeld &&
      <p className="muted">解除恢复封锁前，须停止该来源的全部历史副本并核对写入数据。</p>}
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
        onClick={() => void action.run(/** 中文：提交 POST /vms/{vmId}/next-features，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vmId}/next-features for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
          await request(`/vms/${vmId}/next-features`, 'POST',
            { action: 'configure', featureId: 'ha-failover', enabled, options });
          reload();
        }, '接管策略已保存')}>保存策略</button>
      <button className="secondary" disabled={action.busy}
        onClick={() => void action.run(/** 中文：提交 POST /vms/{vmId}/next-features，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互并更新操作结果；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vmId}/next-features for UI interaction and state presentation for resource policy, packages and engineering tasks and update operation result. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
          const checked = await request(`/vms/${vmId}/next-features`, 'POST',
            { action: 'check', featureId: 'ha-failover' });
          setResult(JSON.stringify(checked, null, 2));
          reload();
        })}>检查健康</button>
      {rejoinAvailable &&
        <button className="secondary" disabled={action.busy || !dataReconciled}
        onClick={() => void action.run(/** 中文：提交 POST /vms/{vmId}/next-features，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互并更新操作结果、dataReconciled 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vmId}/next-features for UI interaction and state presentation for resource policy, packages and engineering tasks and update operation result, dataReconciled state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
          const rejoined = await request(`/vms/${vmId}/next-features`, 'POST',
            { action: 'run', featureId: 'ha-failover',
              options: { mode: 'rejoin', dataReconciled: true } });
          setResult(JSON.stringify(rejoined, null, 2));
          setDataReconciled(false);
          reload();
        }, '目标副本已持久封锁，来源可以重新启动')}>目标停机后退出接管</button>}
    </div>
    <Feedback error={action.error || peers.error} message={action.message} />
    {result && <pre className="feature-log">{result}</pre>}
  </div>;
}
