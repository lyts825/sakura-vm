import { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, CheckCircle2, Compass, HardDrive, Package, Play, Search, ShieldCheck, Wifi } from 'lucide-react';
import type { VMView } from '../server/model';
import type { FeatureCatalogItem, Schedule, AlertConfig } from '../server/feature-suite';
import type { JobView } from '../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type Request } from './FeaturePanels';

type MetricPoint = {
  sampledAt: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
};
type FeatureEvent = {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  acknowledged: boolean;
};
type SuiteView = {
  settings: { schedule: Schedule; alerts: AlertConfig; updatedAt: string };
  history: MetricPoint[];
  events: FeatureEvent[];
  job: JobView | null;
  features: FeatureCatalogItem[];
};
type Props = { request: Request; vms: VMView[]; selected: string; onSelected: (id: string) => void };

const bytes = (value: number) =>
  value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(0)} MiB`;

export function FeatureSuitePanel({ request, vms, selected, onSelected }: Props) {
  const active = vms.find((vm) => vm.id === selected) || vms[0];
  const remote = useRemote<SuiteView>(request, active ? `/vms/${active.id}/advanced` : '/feature-suite', !!active, 5000);
  const action = useAction();
  const [schedule, setSchedule] = useState<Schedule>({ enabled: false, idleMinutes: 0, idleAction: 'stop' });
  const [alerts, setAlerts] = useState<AlertConfig>({
    enabled: false,
    cpuPercent: 90,
    memoryPercent: 90,
    diskPercent: 90,
    cooldownMinutes: 30,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPath, setSearchPath] = useState('/workspace');
  const [searchContent, setSearchContent] = useState(true);
  const [searchResult, setSearchResult] = useState<string[]>([]);
  const [packageName, setPackageName] = useState('');
  const [packageOperation, setPackageOperation] = useState<'list' | 'search' | 'install' | 'remove' | 'update'>('list');
  const [networkTarget, setNetworkTarget] = useState('example.com');
  const [networkResult, setNetworkResult] = useState('');
  const [securityResult, setSecurityResult] = useState<{ findings: string[]; output: string } | null>(null);
  const [ports, setPorts] = useState<number[]>([]);

  useEffect(() => {
    if (!remote.data) return;
    setSchedule(remote.data.settings.schedule);
    setAlerts(remote.data.settings.alerts);
  }, [remote.data]);

  const latest = remote.data?.history.at(-1);
  const groups = useMemo(() => {
    const map = new Map<string, FeatureCatalogItem[]>();
    for (const feature of remote.data?.features || []) map.set(feature.category, [...(map.get(feature.category) || []), feature]);
    return [...map.entries()];
  }, [remote.data?.features]);

  if (!active) {
    return (
      <div className="content-panel feature-panel management-page">
        <h2>能力中心</h2>
        <p className="muted">先创建一个 Linux 空间，再使用自动化、搜索和诊断功能。</p>
      </div>
    );
  }

  const saveSettings = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'PUT', { schedule, alerts });
      remote.reload();
    }, '能力中心设置已保存');
  const sample = () => action.run(async () => {
    await request(`/vms/${active.id}/advanced`, 'POST', { action: 'sample' });
    remote.reload();
  });
  const runSearch = () =>
    action.run(async () => {
      const result = await request<{ matches: string[] }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'search',
        query: searchQuery,
        path: searchPath,
        content: searchContent,
      });
      setSearchResult(result.matches);
    });
  const runPackage = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', {
        action: 'package',
        operation: packageOperation,
        ...(packageName.trim() ? { name: packageName.trim() } : {}),
      });
    }, '软件包任务已提交，请在任务中心查看日志');
  const runNetwork = () =>
    action.run(async () => {
      const result = await request<{ output: string }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'network-test',
        target: networkTarget,
      });
      setNetworkResult(result.output);
    });
  const runSecurity = () =>
    action.run(async () => {
      const result = await request<{ findings: string[]; output: string }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'security-scan',
      });
      setSecurityResult(result);
    });
  const discoverPorts = () =>
    action.run(async () => {
      const result = await request<{ ports: number[] }>(`/vms/${active.id}/advanced`, 'POST', { action: 'discover-ports' });
      setPorts(result.ports);
    });

  return (
    <div className="content-panel feature-panel management-page">
      <div className="panel-heading">
        <div>
          <h2>能力中心</h2>
          <p className="muted">把自动化、搜索、软件包和运行状态集中到一个工作台。</p>
        </div>
        <label>
          当前发行版
          <select value={active.id} onChange={(event) => onSelected(event.target.value)}>
            {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
          </select>
        </label>
      </div>
      <Feedback error={remote.error || action.error} message={action.message} />

      <div className="feature-grid">
        <section className="feature-card">
          <div className="panel-heading"><h3><Activity size={17} />资源趋势</h3><button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={sample}><Play size={13} />立即采样</button></div>
          {latest ? (
            <>
              <div className="metric-strip">
                <span>CPU <b>{latest.cpuPercent.toFixed(1)}%</b></span>
                <span>内存 <b>{latest.memoryTotal ? ((latest.memoryUsed / latest.memoryTotal) * 100).toFixed(1) : '0'}%</b></span>
                <span>磁盘 <b>{latest.diskTotal ? ((latest.diskUsed / latest.diskTotal) * 100).toFixed(1) : '0'}%</b></span>
              </div>
              <div className="metric-bars" aria-label="最近资源采样">
                {remote.data?.history.slice(-24).map((point) => <i key={point.sampledAt} style={{ height: `${Math.max(3, point.cpuPercent)}%` }} title={`${point.cpuPercent.toFixed(1)}%`} />)}
              </div>
              <p className="subtle-note">最近采样：{new Date(latest.sampledAt).toLocaleString()} · 磁盘 {bytes(latest.diskUsed)} / {bytes(latest.diskTotal)}</p>
            </>
          ) : <p className="muted">启动发行版后点击“立即采样”，或等待自动采样。</p>}
        </section>
        <section className="feature-card">
          <h3><Bell size={17} />自动化与告警</h3>
          <div className="feature-grid compact-grid">
            <label className="checkbox-label"><input type="checkbox" checked={schedule.enabled} onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })} />启用计划</label>
            <label>自动启动时间<input type="time" value={schedule.startAt || ''} onChange={(event) => setSchedule({ ...schedule, startAt: event.target.value || undefined })} /></label>
            <label>自动停止时间<input type="time" value={schedule.stopAt || ''} onChange={(event) => setSchedule({ ...schedule, stopAt: event.target.value || undefined })} /></label>
            <label>空闲停止（分钟）<input type="number" min={0} max={10080} value={schedule.idleMinutes} onChange={(event) => setSchedule({ ...schedule, idleMinutes: Number(event.target.value) || 0 })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={alerts.enabled} onChange={(event) => setAlerts({ ...alerts, enabled: event.target.checked })} />启用资源告警</label>
            <label>CPU 阈值<input type="number" min={0} max={100} value={alerts.cpuPercent} onChange={(event) => setAlerts({ ...alerts, cpuPercent: Number(event.target.value) })} /></label>
            <label>内存阈值<input type="number" min={0} max={100} value={alerts.memoryPercent} onChange={(event) => setAlerts({ ...alerts, memoryPercent: Number(event.target.value) })} /></label>
            <label>磁盘阈值<input type="number" min={0} max={100} value={alerts.diskPercent} onChange={(event) => setAlerts({ ...alerts, diskPercent: Number(event.target.value) })} /></label>
          </div>
          <button className="primary compact" disabled={action.busy} onClick={saveSettings}>保存自动化设置</button>
          {!!remote.data?.events.length && <div className="event-list">{remote.data.events.slice(0, 5).map((event) => <p key={event.id}><span className="tiny-dot error" />{event.message}<small>{new Date(event.createdAt).toLocaleString()}</small></p>)}</div>}
        </section>
      </div>

      <div className="feature-grid">
        <section className="feature-card">
          <h3><Search size={17} />工作区搜索</h3>
          <div className="feature-grid compact-grid">
            <label>搜索内容<input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="函数名、错误信息…" /></label>
            <label>目录<input value={searchPath} onChange={(event) => setSearchPath(event.target.value)} /></label>
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={searchContent} onChange={(event) => setSearchContent(event.target.checked)} />搜索文件内容</label>
          <button className="secondary compact" disabled={action.busy || active.status !== 'running' || !searchQuery.trim()} onClick={runSearch}>搜索</button>
          {searchResult.length > 0 && <pre className="feature-log search-results">{searchResult.join('\n')}</pre>}
        </section>
        <section className="feature-card">
          <h3><Package size={17} />软件包</h3>
          <div className="feature-grid compact-grid">
            <label>操作<select value={packageOperation} onChange={(event) => setPackageOperation(event.target.value as typeof packageOperation)}><option value="list">列出已安装</option><option value="search">搜索</option><option value="install">安装</option><option value="remove">卸载</option><option value="update">更新索引</option></select></label>
            <label>软件包名称<input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="可选" /></label>
          </div>
          <button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={runPackage}>提交软件包任务</button>
          <JobLog job={remote.data?.job} />
        </section>
      </div>

      <div className="feature-grid">
        <section className="feature-card">
          <h3><Wifi size={17} />网络诊断与端口</h3>
          <div className="feature-actions"><input value={networkTarget} onChange={(event) => setNetworkTarget(event.target.value)} aria-label="网络诊断目标" /><button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={runNetwork}>测试网络</button><button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={discoverPorts}>发现端口</button></div>
          {networkResult && <pre className="feature-log">{networkResult}</pre>}
          {ports.length > 0 && <p className="subtle-note">正在监听：{ports.join('、')}</p>}
        </section>
        <section className="feature-card">
          <h3><ShieldCheck size={17} />安全扫描</h3>
          <p className="muted">只读检查 SSH 设置、待更新软件包和可写系统文件。</p>
          <button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={runSecurity}>开始扫描</button>
          {securityResult && <><p className={securityResult.findings.length ? 'machine-error' : 'feature-success'}>{securityResult.findings.length ? securityResult.findings.join('；') : '未发现明显问题'}</p><details><summary>查看原始检查结果</summary><pre className="feature-log">{securityResult.output}</pre></details></>}
        </section>
      </div>

      <section className="feature-card">
        <div className="panel-heading"><h3><Compass size={17} />功能路线图</h3><span className="subtle-note">共 {remote.data?.features.length || 50} 项</span></div>
        {groups.map(([category, features]) => <details key={category} open><summary>{category}（{features.length}）</summary><div className="feature-catalog">{features.map((feature) => <div className="catalog-item" key={feature.id}><div><b>{feature.name}</b><p>{feature.summary}</p></div><span className={`badge ${feature.state === 'available' ? 'running' : feature.state === 'experimental' ? 'starting' : 'stopped'}`}>{feature.state === 'available' ? '可用' : feature.state === 'experimental' ? '实验性' : '规划中'}</span></div>)}</div></details>)}
      </section>
    </div>
  );
}
