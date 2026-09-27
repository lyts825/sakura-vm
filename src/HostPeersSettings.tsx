import { useState } from 'react';
import type { PeerStatus } from '../server/host-peers';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';

type Listener = { enabled: boolean; host: '127.0.0.1' | '0.0.0.0'; port: number;
  active: boolean; error?: string };
type Observation = { status?: PeerStatus; error?: string; checkedAt: number;
  lastSuccessAt?: number };
type HostPeersView = {
  hostId: string; name: string; fingerprint: string; local: PeerStatus;
  listener: Listener; pairing: { value: string; expiresAt: number } | null;
  incoming: Array<{ id: string; requesterId: string; name: string;
    createdAt: number; allowImport: boolean }>;
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
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1) + ' GiB';

function ResourceCard({ title, status, error, checkedAt }: {
  title: string; status?: PeerStatus; error?: string; checkedAt?: number;
}) {
  return <div className="feature-card host-peer-resource">
    <h4>{title}</h4>
    <p>{error ? `连接失败：${error}` : status ? '可访问' : '等待检查'}</p>
    {status && <p>{status.platform} / {status.arch} · {status.cpus} 核 ·
      可用内存 {gib(status.memoryFree)} / {gib(status.memoryTotal)} ·
      实例 {status.runningVms} 运行 / {status.vmCount} 总数</p>}
    {checkedAt && <p className="subtle-note">上次检查：{new Date(checkedAt).toLocaleString()}</p>}
  </div>;
}

export function HostPeersSettings({ request }: { request: Request }) {
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
  const listener = listenerDraft || remote.data?.listener ||
    { enabled: false, host: '127.0.0.1' as const, port: 7443 };
  const apply = (operation: string, data: Record<string, unknown> = {}, message?: string) =>
    void action.run(async (signal) => {
      await request('/host-peers', 'POST', { operation, ...data }, signal);
      setScores(null);
      remote.reload();
    }, message);
  const saveListener = () => {
    apply('listener', { listener: { enabled: listener.enabled, host: listener.host,
      port: listener.port } }, '入口配置已保存，重启 Sakura 服务后生效');
  };
  const connect = () => void action.run(async (signal) => {
    await request('/host-peers', 'POST', { operation: 'connect', url: address.trim(),
      fingerprint: fingerprint.trim().toUpperCase(), code: code.trim().toUpperCase() }, signal);
    setAddress(''); setFingerprint(''); setCode('');
    setScores(null);
    remote.reload();
  }, '主机已配对');
  const score = () => void action.run(async (signal) => {
    setScores(await request<ScoreView>('/host-peers', 'POST',
      { operation: 'score', requirements }, signal));
  }, '主机评分已更新');
  return <section className="system-card host-peers-settings" aria-label="主机配对与多主机状态">
    <div className="panel-heading">
      <div><h3>主机配对与多主机状态</h3><p>通过短码和证书指纹连接另一台 Sakura，集中查看资源与连通性。</p></div>
      <button className="secondary compact" onClick={() =>
        apply('refresh', {}, '主机状态已检查')}>检查全部主机</button>
    </div>
    <Feedback error={action.error || remote.error} message={action.message} />
    <ResourceCard title={`本机 · ${remote.data?.name || 'Sakura'}`} status={remote.data?.local} />
    {remote.data?.outbound.map((peer) => <ResourceCard key={peer.id}
      title={`${peer.name} · ${peer.url}`} status={peer.observation?.status}
      error={peer.observation?.error} checkedAt={peer.observation?.checkedAt} />)}
    <div className="feature-card">
      <h4>资源评分调度</h4>
      <p>按最近的 CPU、空闲内存与负载为计划中的实例排序；评分不会迁移或启动实例。</p>
      <div className="shortcut-fields">
        <label>所需逻辑处理器<input type="number" min={1} max={128}
          value={requirements.cpus} onChange={(event) => {
            setRequirements({ ...requirements, cpus: Number(event.target.value) }); setScores(null);
          }} /></label>
        <label>所需内存（MiB）<input type="number" min={256} max={131072}
          value={requirements.memoryMiB} onChange={(event) => {
            setRequirements({ ...requirements, memoryMiB: Number(event.target.value) }); setScores(null);
          }} /></label>
      </div>
      <button className="primary compact" disabled={action.busy || !Number.isInteger(requirements.cpus) ||
        requirements.cpus < 1 || requirements.cpus > 128 ||
        !Number.isInteger(requirements.memoryMiB) || requirements.memoryMiB < 256 ||
        requirements.memoryMiB > 131072} onClick={score}>计算主机评分</button>
      {scores && <div className="host-peer-scores" aria-label="主机评分结果">
        <p className="subtle-note">评分时间：{new Date(scores.scoredAt).toLocaleString()}</p>
        {scores.candidates.map((item) => <div className="host-peer-row" key={item.id}>
          <span><strong>{item.name}</strong> · {item.source === 'local' ? '本机' : '远端'} ·
            {item.eligible ? `评分 ${item.score} / 100（内存 ${item.components.memory}、CPU 负载 ${item.components.cpuLoad}、实例密度 ${item.components.instanceDensity}）` :
              `不可选：${item.reasons.join('；')}`}</span>
        </div>)}
      </div>}
    </div>
    <div className="feature-card">
      <h4>冷迁移队列</h4>
      <p>停止来源实例后，在该实例的能力中心选择“跨主机冷迁移”，填入下方目标 ID。先传输并检查目标，再明确确认移除源实例。要处理本机所有实例，可在任意实例的能力中心选择“主机维护排空”；批量移除前须先完成整批复制并逐台验证。</p>
      {!migrations.data?.enabled && <p className="subtle-note">需要启用平台与快照插件。</p>}
      {migrations.data?.enabled && !migrations.data.entries.length &&
        <p className="subtle-note">尚无迁移任务。</p>}
      {migrations.data?.entries.map((entry) => <div className="host-peer-row" key={entry.transferId}>
        <span><strong>{entry.targetName}</strong> ·
          {entry.status === 'queued' ? '等待传输' : entry.status === 'transferring' ? '传输中' :
            entry.status === 'copied' ? '目标已导入，源仍保留' :
              entry.status === 'moved' ? '已移除源实例' : '需要复核'} ·
          来源 {entry.vmId} · 目标 {entry.remoteVmId || entry.peerId}
          {entry.error && ` · ${entry.error}`}</span>
      </div>)}
    </div>
    <div className="feature-card">
      <h4>跨主机快照复制</h4>
      <p>停止来源实例后，在“快照”页查看快照 ID，再到该实例的能力中心选择“跨主机快照复制”。填写下方目标 ID、快照 ID 和新实例名称。目标会收到选定历史快照的独立实例。</p>
      {!replications.data?.enabled && <p className="subtle-note">需要启用平台与快照插件。</p>}
      {replications.data?.enabled && !replicationEntries.length &&
        <p className="subtle-note">尚无快照复制任务。</p>}
      {replicationEntries.map((entry) => <div className="host-peer-row" key={entry.transferId}>
        <span><strong>{entry.targetName}</strong> ·
          {entry.status === 'queued' ? '等待传输' : entry.status === 'transferring' ? '传输中' :
            entry.status === 'replicated' ? '已校验并导入' : '需要复核'} ·
          来源快照 <code>{entry.snapshotId}</code> ·
          目标实例 <code>{entry.remoteVmId || '尚未返回'}</code>
          {entry.sha256 && <> · SHA-256 <code>{entry.sha256}</code></>}
          {entry.error && ` · ${entry.error}`}</span>
      </div>)}
    </div>
    <div className="feature-card">
      <h4>同伴入口</h4>
      <p>当前入口：{remote.data?.listener.active ? '正在监听' : '未监听'}。
        {remote.data?.listener.error && ` ${remote.data.listener.error}`}</p>
      <div className="shortcut-fields">
        <label className="check"><input type="checkbox" checked={listener.enabled}
          onChange={(event) => setListenerDraft({ ...listener, enabled: event.target.checked })} />
          启用同伴入口</label>
        <div className="host-peer-field"><label htmlFor="peer-host">监听地址</label>
          <select id="peer-host" value={listener.host}
            onChange={(event) => setListenerDraft({ ...listener,
              host: event.target.value as Listener['host'] })}>
            <option value="127.0.0.1">仅本机 / SSH 隧道</option>
            <option value="0.0.0.0">所有网卡 / 局域网</option>
          </select></div>
        <label>监听端口<input type="number" min={1024} max={65535} value={listener.port}
          onChange={(event) => setListenerDraft({ ...listener, port: Number(event.target.value) })} /></label>
      </div>
      <p>本机 TLS 指纹（在另一台主机配对时核对）：<code className="host-peer-fingerprint">
        {remote.data?.fingerprint || '读取中'}</code></p>
      <div className="feature-actions">
        <button className="primary compact" disabled={action.busy || listener.port < 1024 ||
          listener.port > 65535} onClick={saveListener}>保存入口配置</button>
        <button className="secondary compact" disabled={action.busy || !remote.data?.listener.active}
          onClick={() => apply('create-code')}>生成一次性配对码</button>
        {remote.data?.pairing && <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('revoke-code')}>撤销配对码</button>}
      </div>
      {remote.data?.pairing && <p>配对码：<strong>{remote.data.pairing.value}</strong> ·
        有效至 {new Date(remote.data.pairing.expiresAt).toLocaleString()}</p>}
      <p className="subtle-note">入口配置在重启服务后生效。局域网访问请使用这台主机的 IP、所设端口、上方指纹和一次性配对码。</p>
    </div>
    <div className="feature-card">
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
        !fingerprint.trim() || code.trim().length !== 10} onClick={connect}>连接并配对</button>
    </div>
    <div className="feature-card"><h4>已配对主机</h4>
      {!remote.data?.outbound.length && <p className="subtle-note">尚未加入远端主机。</p>}
      {remote.data?.outbound.map((peer) => <div className="host-peer-row" key={peer.id}>
        <span><strong>{peer.name}</strong> · {peer.url} · 迁移目标 ID / 快照复制目标 ID <code>{peer.id}</code></span>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('remove-outbound', { id: peer.id }, '远端主机已移除')}>移除</button>
      </div>)}
    </div>
    <div className="feature-card"><h4>已授权的入站主机</h4>
      {!remote.data?.incoming.length && <p className="subtle-note">尚无入站配对。</p>}
      {remote.data?.incoming.map((peer) => <div className="host-peer-row" key={peer.id}>
        <span><strong>{peer.name}</strong> · {peer.requesterId} ·
          实例包导入：{peer.allowImport ? '已允许' : '未允许'}</span>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('allow-import', { id: peer.id, enabled: !peer.allowImport },
            peer.allowImport ? '实例包导入权限已关闭' : '实例包导入权限已开启')}>
          {peer.allowImport ? '关闭导入' : '允许导入'}
        </button>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => apply('revoke-inbound', { id: peer.id }, '读取权限已撤销')}>撤销访问</button>
      </div>)}
    </div>
  </section>;
}
