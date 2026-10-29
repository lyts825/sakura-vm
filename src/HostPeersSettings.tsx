/**
 * 模块职责（中文）：配置主机配对与监听，查看远端资源、健康评分、冷迁移及快照复制状态。
 * Module responsibility (English): Configuring host pairing, health scores and migration/replication state.
 * 详细范围（中文）：公开入口包括 HostPeersSettings；职责覆盖配置主机配对、健康评分与迁移复制状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HostPeersSettings. The scope covers Configuring host pairing, health scores and migration/replication state. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from './localization';
import { formatDateTime } from './localization';
import { useId, useState } from 'react';
import type { PeerStatus } from '../server/host-peers';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';
import './host-peers-settings.css';

type Listener = { enabled: boolean; host: '127.0.0.1' | '0.0.0.0'; port: number;
  active: boolean; error?: string };
type Observation = { status?: PeerStatus; error?: string; checkedAt: number;
  lastSuccessAt?: number };
type HostPeersView = {
  hostId: string; name: string; fingerprint: string; local: PeerStatus;
  listener: Listener; pairing: { value: string; expiresAt: number } | null;
  incoming: Array<{ id: string; requesterId: string; name: string;
    createdAt: number; allowImport: boolean; allowPolicy: boolean;
    allowActivate: boolean; allowFailover: boolean }>;
  outbound: Array<{ id: string; remoteId: string; name: string; url: string;
    fingerprint: string; createdAt: number; observation: Observation | null }>;
};
type ScoreView = { scoredAt: string; requirements: { cpus: number; memoryMiB: number };
  candidates: Array<{ id: string; name: string; source: 'local' | 'peer';
    eligible: boolean; score: number | null; reasons: string[]; status: PeerStatus | null;
    components: { memory: number; cpuLoad: number; instanceDensity: number } }> };
type MigrationView = { enabled: boolean; entries: Array<{ vmId: string; transferId: string;
  peerId: string; targetName: string; status: 'queued' | 'transferring' | 'copied' | 'moved' | 'review';
  remoteVmId?: string; error?: string; updatedAt: string }> };
type ReplicationView = { enabled: boolean; entries: Array<{ vmId: string; snapshotId: string;
  transferId: string; peerId: string; targetName: string;
  status: 'queued' | 'transferring' | 'replicated' | 'review';
  remoteVmId?: string; sha256?: string; error?: string; updatedAt: string }> };
/**
 * 中文：把主机资源字节换算为一位区域格式小数的 GiB。
 * English: Convert host-resource bytes to GiB with one locale-formatted fractional digit.
 * 中文：输入：bytes：签名所示 number 业务值
 * English: Inputs: bytes: the number domain value in the signature
 */
const gib = (bytes: number) => formatDecimal((bytes / 1024 ** 3), 1) + ' GiB';

/**
 * 中文：呈现配置主机配对、健康评分与迁移复制状态中的 ResourceCard 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ResourceCard surface for Configuring host pairing, health scores and migration/replication state. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ title, status, error, checkedAt } 提供 title（title 状态）、status（status 状态）、error（错误反馈）、checkedAt（checkedAt 状态） 上下文字段
 * English: Inputs: { title, status, error, checkedAt } provides context fields title (title state), status (status state), error (error feedback), checkedAt (checkedAt state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function ResourceCard({ title, status, error, checkedAt }: {
  title: string; status?: PeerStatus; error?: string; checkedAt?: number;
}) {
  return <div className="feature-card host-peer-resource">
    <div className="peers-section-heading"><h4 data-locale-ignore>{title}</h4><span>{error ? '连接失败' : status ? '可访问' : '等待检查'}</span></div>
    {error && <p className="peers-resource-error">连接失败：{error}</p>}
    {error && status && <p className="subtle-note">以下资源来自上次成功观测。</p>}
    {status && <dl className="peers-metrics">
      <div><dt>系统</dt><dd>{status.platform} / {status.arch}</dd></div>
      <div><dt>逻辑处理器</dt><dd>{status.cpus} 核</dd></div>
      <div><dt>可用 / 总内存</dt><dd>{gib(status.memoryFree)} / {gib(status.memoryTotal)}</dd></div>
      <div><dt>实例</dt><dd>{status.runningVms} 运行 / {status.vmCount} 总数</dd></div>
    </dl>}
    {checkedAt && <p className="subtle-note">上次检查：{formatDateTime(new Date(checkedAt))}</p>}
  </div>;
}

/**
 * 中文：呈现配置主机配对、健康评分与迁移复制状态中的 HostPeersSettings 界面，订阅 /host-peers、/cold-migrations、/snapshot-replications，组合 ResourceCard，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the HostPeersSettings surface for Configuring host pairing, health scores and migration/replication state, subscribing to /host-peers, /cold-migrations, /snapshot-replications and composing ResourceCard. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function HostPeersSettings({ request }: { request: Request }) {
  const fieldId = useId();
  const remote = useRemote<HostPeersView>(request, '/host-peers', true, 5000);
  const migrations = useRemote<MigrationView>(request, '/cold-migrations', true, 15000);
  const replications = useRemote<ReplicationView>(request, '/snapshot-replications', true, 15000);
  const replicationEntries = Array.isArray(replications.data?.entries)
    ? replications.data.entries : [];
  const action = useAction();
  const [listenerDraft, setListenerDraft] = useState<Pick<Listener, 'enabled' | 'host' | 'port'> | null>(null);
  const [address, setAddress] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [code, setCode] = useState('');
  const [requirements, setRequirements] = useState({ cpus: 2, memoryMiB: 2048 });
  const [scores, setScores] = useState<ScoreView | null>(null);
  const [pendingOperation, setPendingOperation] = useState('');
  const pendingLabels: Record<string, string> = { refresh: '正在检查全部主机…', listener: '正在保存入口配置…',
    'create-code': '正在生成配对码…', 'revoke-code': '正在撤销配对码…', connect: '正在连接并配对…',
    'remove-outbound': '正在移除远端主机…', 'revoke-inbound': '正在撤销入站访问…',
    'allow-import': '正在更新实例包导入授权…', 'allow-policy': '正在更新策略发布授权…',
    'allow-activate': '正在更新目标启动授权…', 'allow-failover': '正在更新故障接管授权…', score: '正在计算主机评分…' };
  const cpusValid = Number.isInteger(requirements.cpus) && requirements.cpus >= 1 && requirements.cpus <= 128;
  const memoryValid = Number.isInteger(requirements.memoryMiB) && requirements.memoryMiB >= 256 && requirements.memoryMiB <= 131072;
  const listener = listenerDraft || remote.data?.listener ||
    { enabled: false, host: '127.0.0.1' as const, port: 7443 };
  /**
   * 中文：提交 POST /host-peers，完成配置主机配对、健康评分与迁移复制状态的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /host-peers for Configuring host pairing, health scores and migration/replication state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：operation：签名所示 string 业务值；data：签名所示 Record<string, unknown> 业务值（缺省 {}）；message：签名所示 string 业务值
   * English: Inputs: operation: the string domain value in the signature; data: the Record<string, unknown> domain value in the signature (default {}); message: the string domain value in the signature
   */
  const apply = (operation: string, data: Record<string, unknown> = {}, message?: string) =>
    void action.run(/** 中文：提交 POST /host-peers，完成配置主机配对、健康评分与迁移复制状态的数据交互并更新scores 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /host-peers for Configuring host pairing, health scores and migration/replication state and update scores state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      setPendingOperation(operation);
      await request('/host-peers', 'POST', { operation, ...data }, signal);
      setScores(null);
      remote.reload();
    }, message);
  /**
   * 中文：仅提交监听入口 enabled/host/port 配置，并反馈需要重启服务才生效；不把保存确认当作监听已重启。
   * English: Submit only listener enabled/host/port and report that service restart is required, without treating save confirmation as a restarted listener.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const saveListener = () => {
    apply('listener', { listener: { enabled: listener.enabled, host: listener.host,
      port: listener.port } }, '入口配置已保存，重启 Sakura 服务后生效');
  };
  /**
   * 中文：提交 POST /host-peers，完成配置主机配对、健康评分与迁移复制状态的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /host-peers for Configuring host pairing, health scores and migration/replication state. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const connect = () => void action.run(/** 中文：提交 POST /host-peers，完成配置主机配对、健康评分与迁移复制状态的数据交互并更新address 状态、fingerprint 状态、code 状态、scores 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /host-peers for Configuring host pairing, health scores and migration/replication state and update address state, fingerprint state, code state, scores state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setPendingOperation('connect');
    await request('/host-peers', 'POST', { operation: 'connect', url: address.trim(),
      fingerprint: fingerprint.trim().toUpperCase(), code: code.trim().toUpperCase() }, signal);
    setAddress(''); setFingerprint(''); setCode('');
    setScores(null);
    remote.reload();
  }, '主机已配对');
  /**
   * 中文：提交 POST /host-peers，完成配置主机配对、健康评分与迁移复制状态的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /host-peers for Configuring host pairing, health scores and migration/replication state. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const score = () => void action.run(/** 中文：提交 POST /host-peers，完成配置主机配对、健康评分与迁移复制状态的数据交互并更新scores 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /host-peers for Configuring host pairing, health scores and migration/replication state and update scores state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setPendingOperation('score');
    setScores(await request<ScoreView>('/host-peers', 'POST',
      { operation: 'score', requirements }, signal));
  }, '主机评分已更新');
  return <section className="system-card host-peers-settings host-peers-panel" aria-label="主机配对与多主机状态">
    <div className="panel-heading">
      <div><h3>主机配对与多主机状态</h3><p>通过短码和证书指纹连接另一台 Sakura，集中查看资源与连通性。</p></div>
      <button className="secondary compact" disabled={action.busy} onClick={() =>
        apply('refresh', {}, '主机状态已检查')}>检查全部主机</button>
    </div>
    <Feedback error={action.error} message={action.message} />
    {action.busy && <p className="peers-operation-status" role="status">{pendingLabels[pendingOperation] || '正在处理主机操作…'}</p>}
    {!remote.data && !remote.error && <p role="status">正在读取主机配对与资源状态…</p>}
    <Feedback error={remote.error} />
    {remote.error && <div className="peers-read-recovery">
      {remote.data && <p className="subtle-note">以下主机状态来自上次读取，请重新核对。</p>}
      <button className="secondary compact" disabled={action.busy} onClick={remote.reload}>重新读取主机状态</button>
    </div>}
    <ResourceCard title={`本机 · ${remote.data?.name || 'Sakura'}`} status={remote.data?.local} />
    {remote.data?.outbound.map((peer) => <ResourceCard key={peer.id}
      title={`${peer.name} · ${peer.url}`} status={peer.observation?.status}
      error={peer.observation?.error} checkedAt={peer.observation?.checkedAt} />)}
    <section className="feature-card peers-scoring" aria-label="资源评分调度">
      <h4>资源评分调度</h4>
      <p>按最近的 CPU、空闲内存与负载为计划中的实例排序；评分不会迁移或启动实例。</p>
      <div className="shortcut-fields">
        <label>所需逻辑处理器<input type="number" min={1} max={128}
          aria-label="所需逻辑处理器" aria-invalid={!cpusValid || undefined} aria-describedby={`${fieldId}-cpus`}
          value={requirements.cpus} onChange={(event) => {
            setRequirements({ ...requirements, cpus: Number(event.target.value) }); setScores(null);
          }} /><small id={`${fieldId}-cpus`} className={!cpusValid ? 'peers-field-error' : undefined}>填写 1～128 的整数。</small></label>
        <label>所需内存（MiB）<input type="number" min={256} max={131072}
          aria-label="所需内存（MiB）" aria-invalid={!memoryValid || undefined} aria-describedby={`${fieldId}-memory`}
          value={requirements.memoryMiB} onChange={(event) => {
            setRequirements({ ...requirements, memoryMiB: Number(event.target.value) }); setScores(null);
          }} /><small id={`${fieldId}-memory`} className={!memoryValid ? 'peers-field-error' : undefined}>填写 256～131072 MiB 的整数。</small></label>
      </div>
      <button className="primary compact" disabled={action.busy || !cpusValid || !memoryValid} onClick={score}>{action.busy && pendingOperation === 'score' ? '正在计算评分…' : '计算主机评分'}</button>
      {scores && <div className="host-peer-scores" role="region" aria-label="主机评分结果">
        <p className="subtle-note">评分时间：{formatDateTime(new Date(scores.scoredAt))}</p>
        <p className="peers-score-context">本次需求：{scores.requirements.cpus} 核 · {scores.requirements.memoryMiB} MiB；{scores.candidates.filter(item => item.eligible).length} / {scores.candidates.length} 台主机可选。</p>
        {!scores.candidates.length && <p className="subtle-note">本次没有可评分的主机，请检查主机状态后重新计算。</p>}
        {scores.candidates.map((item) => <article className="host-peer-row peers-score-card" key={item.id}>
          <div className="peers-section-heading"><h5 data-locale-ignore>{item.name}</h5><span>{item.source === 'local' ? '本机' : '远端'}</span></div>
          {item.eligible ? <>
            <p className="peers-score-value">评分 <strong>{item.score}</strong> / 100</p>
            <dl className="peers-metrics">
              <div><dt>内存</dt><dd>{item.components.memory}</dd></div>
              <div><dt>CPU 负载</dt><dd>{item.components.cpuLoad}</dd></div>
              <div><dt>实例密度</dt><dd>{item.components.instanceDensity}</dd></div>
            </dl>
          </> : <><p className="peers-unavailable">不可选</p><ul>{item.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></>}
        </article>)}
      </div>}
    </section>
    <section className="feature-card peers-migrations" aria-label="冷迁移队列">
      <h4>冷迁移队列</h4>
      <p>停止来源实例后，在该实例的能力中心选择“跨主机冷迁移”，填入下方目标 ID。先传输并检查目标，再明确确认移除源实例。要处理本机所有实例，可在任意实例的能力中心选择“主机维护排空”；批量移除前须先完成整批复制并逐台验证。</p>
      {!migrations.data && !migrations.error && <p role="status">正在读取冷迁移队列…</p>}
      <Feedback error={migrations.error} />
      {migrations.error && <div className="peers-read-recovery">
        {migrations.data && <p className="subtle-note">以下迁移记录来自上次读取，请重新核对。</p>}
        <button className="secondary compact" disabled={action.busy} onClick={migrations.reload}>重新读取迁移队列</button>
      </div>}
      {migrations.data && !migrations.data.enabled && <p className="subtle-note">需要启用平台与快照插件。</p>}
      {migrations.data?.enabled && !migrations.data.entries.length &&
        <p className="subtle-note">尚无迁移任务。</p>}
      {migrations.data && <p className="peers-queue-count">{migrations.data.entries.length} 项迁移记录</p>}
      {migrations.data?.entries.map((entry) => <article className="peers-transfer-card" key={entry.transferId}>
        <div className="peers-section-heading"><h5 data-locale-ignore>{entry.targetName}</h5><span className={`peers-transfer-state peers-transfer-${entry.status}`}>
          {entry.status === 'queued' ? '等待传输' : entry.status === 'transferring' ? '传输中' :
            entry.status === 'copied' ? '目标已导入，源仍保留' :
              entry.status === 'moved' ? '已移除源实例' : '需要复核'}</span></div>
        <dl className="peers-identity">
          <div><dt>来源实例</dt><dd><code>{entry.vmId}</code></dd></div>
          <div><dt>目标主机</dt><dd><code>{entry.peerId}</code></dd></div>
          <div><dt>目标实例</dt><dd><code>{entry.remoteVmId || '尚未返回'}</code></dd></div>
          <div><dt>传输标识</dt><dd><code>{entry.transferId}</code></dd></div>
        </dl>
        <p className="peers-transfer-time">更新于 {formatDateTime(new Date(entry.updatedAt))}</p>
        {entry.error && <p className="peers-resource-error">{entry.error}</p>}
      </article>)}
    </section>
    <section className="feature-card peers-replications" aria-label="跨主机快照复制">
      <h4>跨主机快照复制</h4>
      <p>停止来源实例后，在“快照”页查看快照 ID，再到该实例的能力中心选择“跨主机快照复制”。填写下方目标 ID、快照 ID 和新实例名称。目标会收到选定历史快照的独立实例。</p>
      {!replications.data && !replications.error && <p role="status">正在读取快照复制队列…</p>}
      <Feedback error={replications.error} />
      {replications.error && <div className="peers-read-recovery">
        {replications.data && <p className="subtle-note">以下复制记录来自上次读取，请重新核对。</p>}
        <button className="secondary compact" disabled={action.busy} onClick={replications.reload}>重新读取复制队列</button>
      </div>}
      {replications.data && !replications.data.enabled && <p className="subtle-note">需要启用平台与快照插件。</p>}
      {replications.data?.enabled && !replicationEntries.length &&
        <p className="subtle-note">尚无快照复制任务。</p>}
      {replications.data && <p className="peers-queue-count">{replicationEntries.length} 项快照复制记录</p>}
      {replicationEntries.map((entry) => <article className="peers-transfer-card" key={entry.transferId}>
        <div className="peers-section-heading"><h5 data-locale-ignore>{entry.targetName}</h5><span className={`peers-transfer-state peers-transfer-${entry.status}`}>
          {entry.status === 'queued' ? '等待传输' : entry.status === 'transferring' ? '传输中' :
            entry.status === 'replicated' ? '已校验并导入' : '需要复核'}</span></div>
        <dl className="peers-identity">
          <div><dt>来源快照</dt><dd><code>{entry.snapshotId}</code></dd></div>
          <div><dt>目标主机</dt><dd><code>{entry.peerId}</code></dd></div>
          <div><dt>目标实例</dt><dd><code>{entry.remoteVmId || '尚未返回'}</code></dd></div>
          <div><dt>传输标识</dt><dd><code>{entry.transferId}</code></dd></div>
          {entry.sha256 && <div><dt>SHA-256</dt><dd><code>{entry.sha256}</code></dd></div>}
        </dl>
        <p className="peers-transfer-time">更新于 {formatDateTime(new Date(entry.updatedAt))}</p>
        {entry.error && <p className="peers-resource-error">{entry.error}</p>}
      </article>)}
    </section>
    <section className="feature-card peers-pairing" aria-label="同伴入口">
      <h4>同伴入口</h4>
      <p>当前入口：{remote.data ? remote.data.listener.active ? '正在监听' : '未监听' : remote.error ? '暂未确认' : '正在读取…'}。
        {remote.data?.listener.error && ` ${remote.data.listener.error}`}</p>
      <div className="shortcut-fields">
        <label className="check"><input type="checkbox" checked={listener.enabled}
          onChange={(event) => setListenerDraft({ ...listener, enabled: event.target.checked })} />
          启用同伴入口</label>
        <div className="host-peer-field"><label htmlFor={`${fieldId}-host`}>监听地址</label>
          <select id={`${fieldId}-host`} value={listener.host}
            onChange={(event) => setListenerDraft({ ...listener,
              host: event.target.value as Listener['host'] })}>
            <option value="127.0.0.1">仅本机 / SSH 隧道</option>
            <option value="0.0.0.0">所有网卡 / 局域网</option>
          </select></div>
        <label>监听端口<input type="number" min={1024} max={65535} value={listener.port}
          onChange={(event) => setListenerDraft({ ...listener, port: Number(event.target.value) })} /></label>
      </div>
      <dl className="peers-identity">
        <div><dt>本机主机 ID</dt><dd><code>{remote.data?.hostId || (remote.error ? '暂未确认' : '读取中')}</code></dd></div>
        <div><dt>本机 TLS 指纹（在另一台主机配对时核对）</dt><dd><code className="host-peer-fingerprint">
          {remote.data?.fingerprint || (remote.error ? '暂未确认' : '读取中')}</code></dd></div>
      </dl>
      <div className="feature-actions">
        <button className="primary compact" disabled={action.busy || listener.port < 1024 ||
          listener.port > 65535} onClick={saveListener}>保存入口配置</button>
        <button className="secondary compact" disabled={action.busy || !remote.data?.listener.active}
          onClick={() => apply('create-code')}>生成一次性配对码</button>
        {remote.data?.pairing && <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('revoke-code')}>撤销配对码</button>}
      </div>
      {remote.data?.pairing && <div className="peers-pairing-code">
        <span>一次性配对码</span><strong data-locale-ignore>{remote.data.pairing.value}</strong>
        <span>有效至 <time dateTime={new Date(remote.data.pairing.expiresAt).toISOString()}>{formatDateTime(new Date(remote.data.pairing.expiresAt))}</time></span>
      </div>}
      <p className="subtle-note">入口配置在重启服务后生效。局域网访问请使用这台主机的 IP、所设端口、上方指纹和一次性配对码。</p>
    </section>
    <section className="feature-card peers-connect" aria-label="加入远端主机">
      <h4>加入远端主机</h4>
      <div className="shortcut-fields">
        <label>HTTPS 地址（含端口）<input value={address} placeholder="https://192.168.1.10:7443/"
          onChange={(event) => setAddress(event.target.value)} /></label>
        <label>远端 TLS 指纹<input value={fingerprint} placeholder="AA:BB:…"
          onChange={(event) => setFingerprint(event.target.value)} /></label>
        <label>远端一次性配对码<input value={code} maxLength={10}
          onChange={(event) => setCode(event.target.value)} /></label>
      </div>
      <button className="primary compact" disabled={action.busy || !address.trim() ||
        !fingerprint.trim() || code.trim().length !== 10} onClick={connect}>{action.busy && pendingOperation === 'connect' ? '正在连接并配对…' : '连接并配对'}</button>
    </section>
    <section className="feature-card peers-outbound" aria-label="已配对主机">
      <div className="peers-section-heading"><h4>已配对主机</h4>{remote.data && <span>{remote.data.outbound.length} 台出站主机</span>}</div>
      <p className="subtle-note">本机访问的远端主机。远端访问本机的权限在下方单独管理。</p>
      {remote.data && !remote.data.outbound.length && <p className="subtle-note">尚未加入远端主机。</p>}
      {remote.data?.outbound.map((peer) => <article className="peers-trust-card" key={peer.id} aria-label={`出站主机 ${peer.name}`}>
        <h5 data-locale-ignore>{peer.name}</h5>
        <p className="peers-endpoint" data-locale-ignore>{peer.url}</p>
        <dl className="peers-identity"><div><dt>迁移目标 ID / 快照复制目标 ID</dt><dd><code>{peer.id}</code></dd></div></dl>
        <details className="peers-trust-details">
          <summary>查看信任身份</summary>
          <dl className="peers-identity">
            <div><dt>远端主机 ID</dt><dd><code>{peer.remoteId}</code></dd></div>
            <div><dt>已固定的 TLS 指纹</dt><dd><code>{peer.fingerprint}</code></dd></div>
            <div><dt>配对时间</dt><dd><time dateTime={new Date(peer.createdAt).toISOString()}>{formatDateTime(new Date(peer.createdAt))}</time></dd></div>
          </dl>
        </details>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('remove-outbound', { id: peer.id }, '远端主机已移除')}>移除</button>
      </article>)}
    </section>
    <section className="feature-card peers-inbound" aria-label="已授权的入站主机">
      <div className="peers-section-heading"><h4>已授权的入站主机</h4>{remote.data && <span>{remote.data.incoming.length} 台入站主机</span>}</div>
      <p className="subtle-note">以下权限控制远端主机对本机的操作。各项授权分别设置；目标启动与故障副本接管同时需要实例包导入权限。</p>
      {remote.data && !remote.data.incoming.length && <p className="subtle-note">尚无入站配对。</p>}
      {remote.data?.incoming.map((peer) => <article className="peers-trust-card" key={peer.id} aria-label={`入站主机 ${peer.name}`}>
        <h5 data-locale-ignore>{peer.name}</h5>
        <dl className="peers-identity"><div><dt>请求方主机 ID</dt><dd><code>{peer.requesterId}</code></dd></div></dl>
        <div className="peers-permissions">
        <div className="peers-permission"><p>实例包导入<span>{peer.allowImport ? '已允许' : '未允许'}</span></p>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('allow-import', { id: peer.id, enabled: !peer.allowImport },
            peer.allowImport ? '实例包导入权限已关闭' : '实例包导入权限已开启')}>
          {peer.allowImport ? '关闭导入' : '允许导入'}
        </button></div>
        <div className="peers-permission"><p>策略发布<span>{peer.allowPolicy ? '已允许' : '未允许'}</span></p>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('allow-policy', { id: peer.id, enabled: !peer.allowPolicy },
            peer.allowPolicy ? '策略发布权限已关闭' : '策略发布权限已开启')}>
          {peer.allowPolicy ? '关闭策略发布' : '允许策略发布'}
        </button></div>
        <div className="peers-permission"><p>目标启动<span>{peer.allowActivate ? '已允许' : '未允许'}</span></p>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('allow-activate', { id: peer.id, enabled: !peer.allowActivate },
            peer.allowActivate ? '目标启动权限已关闭' : '目标启动权限已开启')}>
          {peer.allowActivate ? '关闭目标启动' : '允许目标启动'}
        </button></div>
        <div className="peers-permission"><p>故障副本接管<span>{peer.allowFailover ? '已允许' : '未允许'}</span></p>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('allow-failover', { id: peer.id, enabled: !peer.allowFailover },
            peer.allowFailover ? '故障副本接管权限已关闭' : '故障副本接管权限已开启')}>
          {peer.allowFailover ? '关闭故障接管' : '允许故障接管'}
        </button></div>
        </div>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('revoke-inbound', { id: peer.id }, '读取权限已撤销')}>撤销访问</button>
      </article>)}
    </section>
  </section>;
}
