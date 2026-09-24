import { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, CheckCircle2, Compass, HardDrive, Package, Play, Search, ShieldCheck, Wifi } from 'lucide-react';
import type { VMView } from '../server/model';
import type { FeatureCatalogItem, Schedule, AlertConfig, ResourcePreset, ResourcePresetId } from '../server/feature-suite';
import type { ExtendedFeature } from '../server/extended-features';
import type { NextFeature } from '../server/next-features';
import type { JobView } from '../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type Request } from './FeaturePanels';
import { workspaceRequest } from './workspace-request';

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
type DiskEntry = { path: string; bytes: number };
type SuiteView = {
  projectId?: string;
  settings: { schedule: Schedule; alerts: AlertConfig; updatedAt: string };
  history: MetricPoint[];
  events: FeatureEvent[];
  job: JobView | null;
  devJob: JobView | null;
  presets: Record<ResourcePresetId, ResourcePreset>;
  features: FeatureCatalogItem[];
};
type Props = {
  request: Request;
  vms: VMView[];
  selected: string;
  onSelected: (id: string) => void;
  projectId?: string;
};
type ExtendedView = {
  projectId?: string;
  features: ExtendedFeature[];
  operations: Array<{ id: string; name: string; feature: string; example: Record<string, unknown>; note: string; writes: boolean }>;
  settings: Record<string, { enabled: boolean; options?: Record<string, unknown>; updatedAt: string }>;
  executions?: Array<{ featureId: string; action: string; ready: boolean; finishedAt: string }>;
  jobs: JobView[];
};
type NextView = {
  projectId?: string;
  features: NextFeature[];
  settings: Record<string, { enabled: boolean; options?: Record<string, unknown>; updatedAt: string }>;
  executions?: Array<{ featureId: string; action: string; ready: boolean; executed: boolean; finishedAt: string }>;
  jobs: JobView[];
};

const fallbackPresets: Record<ResourcePresetId, ResourcePreset> = {
  light: { name: '轻量命令行', memoryMiB: 512, cpus: 1 },
  development: { name: '日常开发', memoryMiB: 2048, cpus: 2 },
  build: { name: '编译构建', memoryMiB: 4096, cpus: 4 },
  desktop: { name: '图形桌面', memoryMiB: 2048, cpus: 2 },
};

const bytes = (value: number) =>
  value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(0)} MiB`;

export function FeatureSuitePanel({ request: baseRequest, vms, selected, onSelected, projectId }: Props) {
  const request = useMemo(() => workspaceRequest(baseRequest, projectId), [baseRequest, projectId]);
  const active = vms.find((vm) => vm.id === selected) || vms[0];
  const remote = useRemote<SuiteView>(request, active ? `/vms/${active.id}/advanced` : '/feature-suite', !!active, 5000);
  const extended = useRemote<ExtendedView>(request, active ? `/vms/${active.id}/extended-features` : '/extended-features', !!active, 10000);
  const next = useRemote<NextView>(request, active ? `/vms/${active.id}/next-features` : '/next-features', !!active, 10000);
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
  const [memoryTarget, setMemoryTarget] = useState(active.memoryTargetMiB || active.memoryMiB);
  const [preset, setPreset] = useState<ResourcePresetId>('development');
  const [devOperation, setDevOperation] = useState<'test' | 'test-discover' | 'lint' | 'format' | 'dependencies' | 'lock' | 'lock-check' | 'install-locked' | 'worktree-list' | 'worktree-add' | 'worktree-remove' | 'database'>('test');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [worktreePath, setWorktreePath] = useState('');
  const [database, setDatabase] = useState<'postgres' | 'redis' | 'mysql'>('postgres');
  const [databaseName, setDatabaseName] = useState('');
  const [databasePort, setDatabasePort] = useState('');
  const [databasePassword, setDatabasePassword] = useState('');
  const [diskPath, setDiskPath] = useState('/workspace');
  const [diskEntries, setDiskEntries] = useState<DiskEntry[]>([]);
  const [extendedResult, setExtendedResult] = useState('');
  const [extendedOperation, setExtendedOperation] = useState('');
  const [nextResult, setNextResult] = useState('');
  const [nextSearch, setNextSearch] = useState('');

  useEffect(() => {
    if (!remote.data) return;
    setSchedule(remote.data.settings.schedule);
    setAlerts(remote.data.settings.alerts);
  }, [remote.data]);
  useEffect(() => {
    setMemoryTarget(active.memoryTargetMiB || active.memoryMiB);
  }, [active.id, active.memoryMiB, active.memoryTargetMiB]);

  const latest = remote.data?.history.at(-1);
  const presets = remote.data?.presets || fallbackPresets;
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
  const applyMemoryTarget = () => action.run(async () => {
    await request(`/vms/${active.id}/advanced`, 'POST', { action: 'memory-target', memoryMiB: memoryTarget });
    await remote.reload();
  }, '动态内存目标已更新');
  const applyPreset = () => action.run(async () => {
    await request(`/vms/${active.id}/advanced`, 'POST', { action: 'apply-preset', preset });
    await remote.reload();
  }, '资源预设已应用，请重新启动发行版');
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
  const runDiskAnalysis = () =>
    action.run(async () => {
      const result = await request<{ entries: DiskEntry[] }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'disk-analysis',
        path: diskPath,
      });
      setDiskEntries(result.entries);
    });
  const runPackage = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', {
        action: 'package',
        operation: packageOperation,
        ...(packageName.trim() ? { name: packageName.trim() } : {}),
      });
    }, '软件包任务已提交，请在任务中心查看日志');
  const runDev = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', {
        action: 'dev',
        operation: devOperation,
        ...(worktreeBranch ? { branch: worktreeBranch } : {}),
        ...(worktreePath ? { path: worktreePath } : {}),
        ...(devOperation === 'database' ? { database } : {}),
        ...(devOperation === 'database' && databaseName.trim() ? { name: databaseName.trim() } : {}),
        ...(devOperation === 'database' && databasePort ? { port: Number(databasePort) } : {}),
        ...(devOperation === 'database' ? { password: databasePassword } : {}),
      });
      remote.reload();
    }, '开发任务已提交，请查看日志');
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
  const checkExtended = (featureId: string) => action.run(async () => {
    const result = await request(`/vms/${active.id}/extended-features`, 'POST', { action: 'check', featureId });
    setExtendedResult(JSON.stringify(result, null, 2));
  });
  const runExtended = (featureId: string) => action.run(async () => {
    const result = await request(`/vms/${active.id}/extended-features`, 'POST', { action: 'run', featureId });
    setExtendedResult(JSON.stringify(result, null, 2));
    extended.reload();
  }, '扩展能力任务已提交');
  const runExtendedOperation = () => action.run(async () => {
    const item = extended.data?.operations.find((value) => value.id === extendedOperation);
    if (!item) return;
    await request(`/vms/${active.id}/extended-features`, 'POST', { action: 'operation', operation: item.id, parameters: item.example });
    extended.reload();
  }, '扩展操作已提交，请在任务中心查看结果');
  const nextFeatures = useMemo(() => {
    const query = nextSearch.trim().toLocaleLowerCase();
    return (next.data?.features || []).filter((feature) => !query || `${feature.id} ${feature.name} ${feature.category} ${feature.summary}`.toLocaleLowerCase().includes(query));
  }, [next.data?.features, nextSearch]);
  const checkNext = (featureId: string) => action.run(async () => {
    const result = await request(`/vms/${active.id}/next-features`, 'POST', { action: 'check', featureId });
    setNextResult(JSON.stringify(result, null, 2));
    next.reload();
  });
  const runNext = (featureId: string) => action.run(async () => {
    const result = await request(`/vms/${active.id}/next-features`, 'POST', { action: 'run', featureId });
    setNextResult(JSON.stringify(result, null, 2));
    next.reload();
  }, '第三批能力任务已提交');

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
      <Feedback error={remote.error || extended.error || next.error || action.error} message={action.message} />

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
          <label>动态内存目标：{memoryTarget} MiB<input type="range" min={256} max={active.memoryMiB} step={128} value={memoryTarget} disabled={active.status !== 'running'} onChange={(event) => setMemoryTarget(Number(event.target.value))} /></label>
          <button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={applyMemoryTarget}>应用内存目标</button>
          <div className="feature-actions">
            <label>资源预设<select value={preset} onChange={(event) => setPreset(event.target.value as ResourcePresetId)}>
              {Object.entries(presets).map(([id, value]) => <option key={id} value={id}>{value.name} · {value.memoryMiB} MiB · {value.cpus} vCPU</option>)}
            </select></label>
            <button className="secondary compact" disabled={action.busy || active.status !== 'stopped'} onClick={applyPreset}>应用预设</button>
          </div>
          {active.status !== 'stopped' && <p className="subtle-note">资源预设需要先停止发行版；动态内存目标可在运行中调整。</p>}
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
          <h3><HardDrive size={17} />磁盘分析</h3>
          <div className="feature-actions"><input value={diskPath} onChange={(event) => setDiskPath(event.target.value)} aria-label="磁盘分析目录" /><button className="secondary compact" disabled={action.busy || active.status !== 'running'} onClick={runDiskAnalysis}>分析目录</button></div>
          {diskEntries.length > 0 && <div className="disk-analysis-list">{diskEntries.slice(0, 12).map((entry) => <div key={entry.path}><span>{entry.path}</span><b>{bytes(entry.bytes)}</b></div>)}</div>}
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

      <section className="feature-card">
        <div className="panel-heading"><h3><Compass size={17} />100 项扩展能力</h3><span className="subtle-note">{extended.data?.features.length || 100} 项 · 可检查前置条件</span></div>
        <p className="muted">每项能力都可以检查或运行；客户机工具不可用时会使用便携适配器并保留执行记录。</p>
        <div className="feature-actions">
          <select value={extendedOperation} onChange={(event) => setExtendedOperation(event.target.value)} aria-label="扩展工程操作">
            <option value="">选择工程操作</option>
            {extended.data?.operations.map((operation) => <option key={operation.id} value={operation.id}>{operation.name}{operation.writes ? ' · 写入' : ''}</option>)}
          </select>
          <button className="secondary compact" disabled={action.busy || active.status !== 'running' || !extendedOperation} onClick={runExtendedOperation}>提交操作</button>
        </div>
        <div className="feature-catalog extended-catalog">
          {(extended.data?.features || []).map((feature) => <div className="catalog-item" key={feature.id}><div><b>{feature.name}</b><p>{feature.summary}</p></div><span className="badge running">已接入</span><button className="secondary compact" disabled={action.busy} onClick={() => checkExtended(feature.id)}>检查</button><button className="secondary compact" disabled={action.busy} onClick={() => runExtended(feature.id)}>运行</button></div>)}
        </div>
        {extendedResult && <pre className="feature-log">{extendedResult}</pre>}
      </section>

      <section className="feature-card">
        <div className="panel-heading"><h3><Compass size={17} />第三批 100 项能力</h3><span className="subtle-note">{next.data?.features.length || 100} 项 · 配置、检查、执行均有记录</span></div>
        <p className="muted">每项功能都已接入统一适配器。主机、客户机或外部服务缺失时，检查结果会明确说明原因并保留配置。</p>
        <input value={nextSearch} onChange={(event) => setNextSearch(event.target.value)} placeholder="搜索功能、分类或说明…" aria-label="搜索第三批能力" />
        <div className="feature-catalog extended-catalog next-catalog">
          {nextFeatures.map((feature) => <div className="catalog-item" key={feature.id}><div><b>{feature.name}</b><p>{feature.category} · {feature.summary}</p></div><span className="badge running">已接入</span><button className="secondary compact" disabled={action.busy} onClick={() => checkNext(feature.id)}>检查</button><button className="secondary compact" disabled={action.busy} onClick={() => runNext(feature.id)}>运行</button></div>)}
        </div>
        {nextResult && <pre className="feature-log">{nextResult}</pre>}
      </section>

      <section className="feature-card">
        <h3><HardDrive size={17} />开发任务</h3>
        <div className="feature-grid compact-grid">
          <label>操作<select value={devOperation} onChange={(event) => setDevOperation(event.target.value as typeof devOperation)}><option value="test">运行测试</option><option value="test-discover">发现测试文件</option><option value="lint">代码检查</option><option value="format">格式化</option><option value="dependencies">依赖报告</option><option value="lock">生成环境锁文件</option><option value="lock-check">校验环境锁文件</option><option value="install-locked">按锁文件安装依赖</option><option value="worktree-list">列出 Git Worktree</option><option value="worktree-add">创建 Git Worktree</option><option value="worktree-remove">删除 Git Worktree</option><option value="database">创建数据库容器</option></select></label>
          {(devOperation === 'worktree-add' || devOperation === 'worktree-remove') && <><label>分支<input value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder="feature/example" /></label><label>工作树路径<input value={worktreePath} onChange={(event) => setWorktreePath(event.target.value)} placeholder=".worktrees/example" /></label></>}
          {devOperation === 'database' && <><label>数据库<select value={database} onChange={(event) => setDatabase(event.target.value as typeof database)}><option value="postgres">PostgreSQL</option><option value="redis">Redis</option><option value="mysql">MySQL</option></select></label><label>容器名称<input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} placeholder="可选，如 sakura-postgres" /></label><label>客户机端口<input type="number" min={1024} max={65535} value={databasePort} onChange={(event) => setDatabasePort(event.target.value)} placeholder="默认数据库端口" /></label><label>数据库密码<input type="password" minLength={12} maxLength={128} value={databasePassword} onChange={(event) => setDatabasePassword(event.target.value)} placeholder="至少 12 个可打印字符" /></label></>}
        </div>
        <button className="secondary compact" disabled={action.busy || active.status !== 'running' || (devOperation === 'database' && databasePassword.length < 12)} onClick={runDev}>提交开发任务</button>
        <JobLog job={remote.data?.devJob} />
      </section>

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
