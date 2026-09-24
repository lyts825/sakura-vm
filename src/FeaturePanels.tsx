import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Play,
  Square,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Save,
  ExternalLink,
  Copy,
  FolderSync as SyncIcon,
} from 'lucide-react';
import type { VMConfig, Snapshot } from '../server/model';
import type { JobView } from '../server/jobs';
import type { Project } from '../server/workspaces';
import type { SyncConfig, SyncPreview, SyncDecisions } from '../server/sync';
import { ServiceEditor, EnvironmentEditor, ProjectConnections, BackupPanel } from './ManagementPanels';
import { executeProjectAction, type ProjectAction } from './project-action';
import { HealthPanel, SecretReferences } from './DevelopmentPanels';
import { workspaceRequest } from './workspace-request';
import './features.css';

export { distroName, formatBytes, useRemote, useAction, Feedback, JobLog, download } from './feature-shared';
export type { Request, FeatureProps } from './feature-shared';
import {
  formatBytes,
  useRemote,
  useAction,
  Feedback,
  JobLog,
  download,
  type FeatureProps,
  type Request,
} from './feature-shared';
import { PluginGate } from './plugin-context';
export function ProjectPanel(props: FeatureProps) {
  const { vm, request: baseRequest, refresh, projectId: selectedProjectId, onProjectChange } = props;
  const request = useMemo(
    () => workspaceRequest(baseRequest, selectedProjectId),
    [baseRequest, selectedProjectId],
  );
  const remote = useRemote<{ project: Project; projectId?: string; job: JobView | null }>(
    request,
    `/vms/${vm.id}/project`,
    true,
    2500,
  );
  const projects = useRemote<{ active: string; projects: { id: string; name: string }[] }>(
    request,
    `/vms/${vm.id}/projects`,
    true,
    5000,
  );
  const runtime = useRemote<{
    status: string;
    log: string;
    services?: { name: string; status: string; log: string }[];
  }>(request, `/vms/${vm.id}/project-runtime`, vm.status === 'running');
  const [project, setProject] = useState<Project | null>(null),
    [loadedProjectId, setLoadedProjectId] = useState('');
  const action = useAction();
  useEffect(() => {
    if (!remote.data) return;
    const nextId = remote.data.projectId || 'default';
    onProjectChange?.(nextId);
    if (!project || loadedProjectId !== nextId) {
      setProject(remote.data.project);
      setLoadedProjectId(nextId);
    }
  }, [loadedProjectId, onProjectChange, project, remote.data]);
  useEffect(() => {
    if (projects.data) onProjectChange?.(projects.data.active);
  }, [onProjectChange, projects.data]);
  const edit = (patch: Partial<Project>) => setProject((p) => p && { ...p, ...patch });
  const execute = (kind: ProjectAction) =>
    action.run(async (signal) => {
      if (!project) return;
      await executeProjectAction({ request, vm, project, kind, refresh, signal });
      signal.throwIfAborted();
      remote.reload();
      runtime.reload();
    });
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>项目工作区</h3>
          <p>保存环境、目录与命令，下次直接启动开发。</p>
        </div>
        <span className="badge">
          {runtime.data?.status === 'running'
            ? '项目运行中'
            : runtime.data?.status === 'partial'
              ? '部分服务运行中'
              : '项目未运行'}
        </span>
      </div>
      {projects.data && (
        <div className="feature-actions">
          <label>
            工作项目
            <select
              value={projects.data.active}
              onChange={(e) =>
                void action.run(async (signal) => {
                  const next = await request<{ active: string; projects: { id: string; name: string }[] }>(
                    `/vms/${vm.id}/projects`,
                    'POST',
                    { action: 'select', projectId: e.target.value },
                    signal,
                  );
                  onProjectChange?.(next.active);
                  remote.reload();
                  projects.reload();
                })
              }
            >
              {projects.data.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary compact"
            disabled={action.busy}
            onClick={() => {
              const name = prompt('新项目名称');
              if (name?.trim())
                void action.run(async (signal) => {
                  const next = await request<{ active: string; projects: { id: string; name: string }[] }>(
                    `/vms/${vm.id}/projects`,
                    'POST',
                    { action: 'create', name, config: project },
                    signal,
                  );
                  onProjectChange?.(next.active);
                  projects.reload();
                  remote.reload();
                });
            }}
          >
            新增项目
          </button>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => {
              const name = prompt('项目新名称');
              if (name?.trim())
                void action.run(async (signal) => {
                  await request(
                    `/vms/${vm.id}/projects`,
                    'POST',
                    { action: 'rename', projectId: projects.data!.active, name },
                    signal,
                  );
                  projects.reload();
                });
            }}
          >
            重命名
          </button>
        </div>
      )}
      <Feedback error={action.error || remote.error} message={action.message} />
      {project && (
        <>
          <div className="feature-grid">
            <label>
              开发模板
              <select
                value={project.template}
                onChange={(e) => edit({ template: e.target.value as Project['template'] })}
              >
                <option value="none">基础工具（Git / tmux）</option>
                <option value="node">Node.js</option>
                <option value="python">Python</option>
                <option value="rust">Rust</option>
              </select>
            </label>
            <label>
              Linux 项目目录
              <input value={project.directory} onChange={(e) => edit({ directory: e.target.value })} />
            </label>
          </div>
          <label>
            Git 仓库（HTTPS，可选）
            <input
              placeholder="https://example.com/team/project.git"
              value={project.repository}
              onChange={(e) => edit({ repository: e.target.value })}
            />
          </label>
          <label>
            初始化命令
            <textarea
              rows={3}
              placeholder="例如 npm install；在项目目录内执行"
              value={project.setup}
              onChange={(e) => edit({ setup: e.target.value })}
            />
          </label>
          <label>
            启动命令
            <textarea
              rows={2}
              placeholder="例如 npm run dev -- --host 0.0.0.0"
              value={project.command}
              onChange={(e) => edit({ command: e.target.value })}
            />
          </label>
          <label>
            预览的 Windows 端口（在“服务”中配置转发）
            <input
              type="number"
              min={1024}
              max={65535}
              value={project.previewPort ?? ''}
              onChange={(e) => edit({ previewPort: e.target.value ? +e.target.value : undefined })}
            />
          </label>
          <EnvironmentEditor value={project.environment} change={(environment) => edit({ environment })} />
          <PluginGate id="secrets">
            <SecretReferences value={project.secrets} change={(secrets) => edit({ secrets })} />
          </PluginGate>
          <ServiceEditor project={project} edit={edit} />
          <div className="feature-actions">
            <button
              className="secondary compact"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/project`, 'PUT', project);
                  remote.reload();
                }, '项目配置已保存')
              }
            >
              <Save size={14} />
              保存
            </button>
            <button
              className="secondary compact"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() => void execute('setup')}
            >
              准备环境
            </button>
            <button
              className="primary compact"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() => void execute('start')}
            >
              <Play size={14} />
              {action.busy ? '正在准备…' : '启动开发'}
            </button>
            <button
              className="secondary compact"
              disabled={action.busy || vm.status !== 'running' || remote.data?.job?.status === 'running'}
              onClick={() => void execute('stop')}
            >
              <Square size={14} />
              停止项目
            </button>
            {project.previewPort && (
              <a
                className="secondary compact"
                href={`http://127.0.0.1:${project.previewPort}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} />
                打开预览
              </a>
            )}
          </div>
          <div className="feature-actions">
            <button
              className="text-button"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() => void execute('terminal')}
            >
              安装终端会话恢复支持
            </button>
          </div>
        </>
      )}
      <JobLog job={remote.data?.job} />
      <PluginGate id="monitoring">
        <HealthPanel {...props} request={request} />
      </PluginGate>
      {runtime.data?.services?.map((service) => (
        <details className="feature-card" key={service.name}>
          <summary>
            {service.name} · {service.status === 'running' ? '运行中' : '已停止'}
          </summary>
          <div className="feature-actions">
            {(['start', 'stop'] as const).map((kind) => (
              <button
                className="secondary compact"
                key={kind}
                disabled={action.busy || remote.data?.job?.status === 'running'}
                onClick={() =>
                  void action.run(async () => {
                    await request(`/vms/${vm.id}/project`, 'POST', { action: kind, service: service.name });
                    remote.reload();
                    runtime.reload();
                  })
                }
              >
                {kind === 'start' ? '启动服务' : '停止服务'}
              </button>
            ))}
          </div>
          <pre className="feature-log">{service.log || '暂无日志'}</pre>
        </details>
      ))}
      {runtime.data?.log && (
        <details>
          <summary>项目运行日志</summary>
          <pre className="feature-log">{runtime.data.log}</pre>
        </details>
      )}
      <PluginGate id="environment">
        <ProjectConnections
          {...props}
          request={request}
          applied={(value) => {
            setProject(value);
            remote.reload();
          }}
        />
      </PluginGate>
    </div>
  );
}

type Metrics = {
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptime: number;
  processes: { name: string; memory: number }[];
  sampledAt: string;
};
export function MetricsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<Metrics>(request, `/vms/${vm.id}/metrics`, vm.status === 'running');
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    if (remote.data) setHistory((h) => [...h.slice(-29), remote.data!.cpuPercent]);
  }, [remote.data]);
  const m = remote.data;
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>实时资源</h3>
          <p>客户机实际使用量 · 每 5 秒采样</p>
        </div>
        <button className="icon-button" aria-label="刷新资源" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={remote.error} />
      {!m ? (
        <p className="muted">{vm.status === 'running' ? '正在采样…' : '启动发行版后查看实时资源。'}</p>
      ) : (
        <>
          <div className="metrics-grid">
            {[
              ['CPU', `${m.cpuPercent.toFixed(1)}%`, m.cpuPercent],
              [
                '内存',
                `${formatBytes(m.memoryUsed)} / ${formatBytes(m.memoryTotal)}`,
                (100 * m.memoryUsed) / m.memoryTotal,
              ],
              [
                '根分区',
                `${formatBytes(m.diskUsed)} / ${formatBytes(m.diskTotal)}`,
                (100 * m.diskUsed) / m.diskTotal,
              ],
            ].map(([title, value, percent]) => (
              <div className="metric-tile" key={title}>
                <span>{title}</span>
                <strong>{value}</strong>
                <progress max={100} value={Number(percent)} />
              </div>
            ))}
          </div>
          <svg className="cpu-history" viewBox="0 0 600 100" role="img" aria-label="最近 30 次 CPU 使用率">
            <path d="M0 95H600 M0 50H600 M0 5H600" stroke="var(--line)" fill="none" />
            <polyline
              points={history.map((n, i) => `${(i * 600) / 29},${95 - n * 0.9}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
            />
          </svg>
          <p className="muted">
            运行 {Math.floor(m.uptime / 3600)} 小时 {Math.floor((m.uptime % 3600) / 60)} 分钟 · 更新于{' '}
            {new Date(m.sampledAt).toLocaleTimeString()}
          </p>
          <h4>内存占用最高的进程</h4>
          <div className="feature-list">
            {m.processes.map((p, i) => (
              <div key={i}>
                <code>{p.name}</code>
                <span>{formatBytes(p.memory)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ServicesPanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<{
    forwards: (VMConfig['forwards'][number] & { listening: boolean })[];
    listening: number[];
  }>(request, `/vms/${vm.id}/services`);
  const [forwards, setForwards] = useState(vm.forwards);
  const action = useAction();
  const patch = (i: number, value: Partial<VMConfig['forwards'][number]>) =>
    setForwards((list) => list.map((v, n) => (n === i ? { ...v, ...value } : v)));
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>服务与端口</h3>
          <p>可在运行中更新转发；服务需监听 0.0.0.0 或客户机网卡地址。</p>
        </div>
        <button
          className="secondary compact"
          disabled={forwards.length >= 12}
          onClick={() => setForwards((p) => [...p, { name: '', host: 8080, guest: 80 }])}
        >
          <Plus size={14} />
          添加
        </button>
      </div>
      <Feedback error={action.error || remote.error} message={action.message} />
      {forwards.map((p, i) => (
        <div className="service-row" key={i}>
          <label>
            名称
            <input
              maxLength={40}
              value={p.name || ''}
              placeholder="开发服务器"
              onChange={(e) => patch(i, { name: e.target.value })}
            />
          </label>
          <label>
            Windows 端口
            <input
              type="number"
              min={1024}
              max={65535}
              value={p.host}
              onChange={(e) => patch(i, { host: +e.target.value })}
            />
          </label>
          <label>
            Linux 端口
            <input
              type="number"
              min={1}
              max={65535}
              value={p.guest}
              onChange={(e) => patch(i, { guest: +e.target.value })}
            />
          </label>
          <span className="muted">
            {remote.data?.forwards.find((f) => f.host === p.host && f.guest === p.guest)?.listening
              ? '客户机已监听'
              : '未检测到监听'}
          </span>
          <a
            href={`http://127.0.0.1:${p.host}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开端口 ${p.host}`}
          >
            <ExternalLink size={17} />
          </a>
          <button
            className="icon-button"
            aria-label={`删除端口 ${p.host}`}
            onClick={() => setForwards((list) => list.filter((_, n) => n !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {!forwards.length && <p className="muted">添加转发，即可从 Windows 浏览器访问 Linux 服务。</p>}
      <button
        className="primary compact"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await request(`/vms/${vm.id}/services`, 'PATCH', { forwards });
            await refresh();
            remote.reload();
          }, '端口规则已生效')
        }
      >
        <Save size={14} />
        应用端口规则
      </button>
      {!!remote.data?.listening.length && (
        <p className="subtle-note">客户机监听端口：{remote.data.listening.join('、')}</p>
      )}
    </div>
  );
}

export function SyncPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ projectId?: string; config: SyncConfig | null; job: JobView | null }>(
    request,
    `/vms/${vm.id}/sync`,
    true,
    2500,
  );
  const [config, setConfig] = useState<SyncConfig>({ host: '', guest: '/workspace/shared', auto: false });
  const [preview, setPreview] = useState<SyncPreview | null>(null),
    [decisions, setDecisions] = useState<SyncDecisions>({}),
    [previewQuery, setPreviewQuery] = useState('');
  const [loadedProject, setLoadedProject] = useState('');
  const action = useAction();
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      if (remote.data.config) setConfig(remote.data.config);
      else setConfig({ host: '', guest: '/workspace/shared', auto: false });
      setPreview(null);
      setDecisions({});
    }
  }, [remote.data, loadedProject]);
  const sync = (direction: 'both' | 'push' | 'pull') =>
    action.run(async () => {
      await request(`/vms/${vm.id}/sync`, 'POST', {
        direction,
        ...(direction === 'both' && preview ? { token: preview.token, decisions } : {}),
      });
      setPreview(null);
      remote.reload();
    });
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Windows 目录同步</h3>
          <p>把本机文件夹与 Linux 项目目录连接起来。</p>
        </div>
        <SyncIcon size={22} />
      </div>
      <Feedback error={action.error || remote.error} message={action.message} />
      <label>
        Windows 文件夹绝对路径
        <input
          placeholder="D:\\Projects\\my-app"
          value={config.host}
          onChange={(e) => setConfig({ ...config, host: e.target.value })}
        />
      </label>
      <label>
        Linux 目录
        <input value={config.guest} onChange={(e) => setConfig({ ...config, guest: e.target.value })} />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={config.auto}
          onChange={(e) => setConfig({ ...config, auto: e.target.checked })}
        />
        每 15 秒自动双向同步
      </label>
      <label>
        自定义忽略规则（每行一个，支持 * 与 **）
        <textarea
          rows={3}
          value={(config.ignore || []).join('\n')}
          onChange={(e) => setConfig({ ...config, ignore: e.target.value.split('\n') })}
          placeholder={'*.log\ndist\nbuild/**'}
        />
      </label>
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={action.busy || remote.data?.job?.status === 'running'}
          onClick={() =>
            void action.run(async () => {
              await request(`/vms/${vm.id}/sync`, 'PUT', {
                ...config,
                ignore: config.ignore?.map((v) => v.trim()).filter(Boolean),
              });
              setPreview(null);
              remote.reload();
            }, '同步配置已保存')
          }
        >
          <Save size={14} />
          保存配置
        </button>
        <button
          className="primary compact"
          disabled={
            action.busy ||
            !remote.data?.config ||
            remote.data.job?.status === 'running' ||
            vm.status !== 'running'
          }
          onClick={() =>
            void action.run(async (signal) => {
              setPreview(await request(`/vms/${vm.id}/sync-preview`, 'POST', {}, signal));
              setDecisions({});
            })
          }
        >
          预览双向同步
        </button>
      </div>
      {preview && (
        <div className="feature-card">
          <h4>变更预览</h4>
          <p>
            {preview.changes.length} 项变更 · {preview.unchanged} 个文件相同
          </p>
          <label>
            筛选文件
            <input value={previewQuery} onChange={(e) => setPreviewQuery(e.target.value)} />
          </label>
          <div className="sync-preview">
            {preview.changes
              .filter((entry) => entry.path.includes(previewQuery))
              .slice(0, 200)
              .map((entry) => (
                <div className="sync-change" key={entry.path}>
                  <code>{entry.path}</code>
                  <span>
                    {
                      {
                        push: '上传到 Linux',
                        pull: '下载到 Windows',
                        conflict: '两端均有修改',
                        'mkdir-host': '新建 Windows 目录',
                        'mkdir-guest': '新建 Linux 目录',
                        'delete-host': '删除 Windows 文件（需确认）',
                        'delete-guest': '删除 Linux 文件（需确认）',
                        skip: '跳过',
                      }[entry.action]
                    }
                  </span>
                  {(entry.action === 'conflict' ||
                    entry.action === 'delete-host' ||
                    entry.action === 'delete-guest') && (
                    <select
                      aria-label={`解决冲突 ${entry.path}`}
                      value={decisions[entry.path] || 'skip'}
                      onChange={(e) =>
                        setDecisions({ ...decisions, [entry.path]: e.target.value as SyncDecisions[string] })
                      }
                    >
                      <option value="skip">暂时跳过</option>
                      <option value="push">保留 Windows 版本</option>
                      <option value="pull">保留 Linux 版本</option>
                      <option value="both">另存 Linux 版本，保留两份</option>
                      <option value="restore-host">恢复 Windows 文件</option>
                      <option value="restore-guest">恢复 Linux 文件</option>
                      <option value="delete-host">确认删除 Windows 文件</option>
                      <option value="delete-guest">确认删除 Linux 文件</option>
                    </select>
                  )}
                </div>
              ))}
          </div>
          <p className="subtle-note">
            每次显示前 200 项，可筛选路径。执行前会重新核对文件，发生变化时需要重新预览。
          </p>
          <button
            className="primary compact"
            disabled={action.busy || remote.data?.job?.status === 'running'}
            onClick={() => void sync('both')}
          >
            应用本次同步
          </button>
        </div>
      )}
      <p className="subtle-note">
        冲突文件默认保留两边；删除只有在预览中明确选择后才会传播。跳过符号链接、.git、node_modules 和 Sakura
        数据目录。单文件上限 256 MiB。
      </p>
      <details>
        <summary>解决冲突</summary>
        <p>以下操作会用所选一侧覆盖另一侧的同名文件。</p>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={action.busy || remote.data?.job?.status === 'running' || vm.status !== 'running'}
            onClick={() => {
              if (confirm('用 Windows 文件覆盖 Linux 同名文件？')) void sync('push');
            }}
          >
            以 Windows 为准
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || remote.data?.job?.status === 'running' || vm.status !== 'running'}
            onClick={() => {
              if (confirm('用 Linux 文件覆盖 Windows 同名文件？')) void sync('pull');
            }}
          >
            以 Linux 为准
          </button>
        </div>
      </details>
      <JobLog job={remote.data?.job} />
    </div>
  );
}

export function SnapshotsPanel(props: FeatureProps) {
  const { vm, request, refresh } = props;
  const [name, setName] = useState(''),
    [cloneName, setCloneName] = useState(vm.name.slice(0, 26) + '-copy'),
    [editing, setEditing] = useState<Snapshot | null>(null),
    [backup, setBackup] = useState(true);
  const action = useAction();
  const stopped = !vm.poweredOn;
  const mutate = (path: string, method: string, body?: unknown) =>
    action.run(async () => {
      await request(`/vms/${vm.id}${path}`, method, body);
      await refresh();
    }, '操作完成');
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>快照与迁移</h3>
          <p>停止实例后创建恢复点、克隆或导出。</p>
        </div>
      </div>
      <Feedback error={action.error} message={action.message} />
      <div className="inline-form">
        <input
          aria-label="新快照名称"
          placeholder="快照名称"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="primary compact"
          disabled={!stopped || action.busy || !name.trim()}
          onClick={() => void mutate('/snapshots', 'POST', { name })}
        >
          <Plus size={14} />
          创建快照
        </button>
      </div>
      <label className="checkbox-label">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        恢复前自动保存当前状态（占用一个快照名额）
      </label>
      <div className="snapshot-list">
        {[...vm.snapshots].reverse().map((s) => (
          <div key={s.id}>
            <div>
              <b>{s.name}</b>
              <p>
                {new Date(s.createdAt).toLocaleString()}
                {s.note ? ` · ${s.note}` : ''}
              </p>
            </div>
            <div className="feature-actions">
              <button
                className="text-button"
                disabled={action.busy || !stopped}
                onClick={() => setEditing(s)}
              >
                备注
              </button>
              <button
                className="secondary compact"
                disabled={action.busy || !stopped}
                onClick={() => {
                  if (confirm(`恢复“${s.name}”并覆盖当前磁盘状态？`))
                    void mutate(`/snapshots/${s.id}/restore`, 'POST', { backup });
                }}
              >
                恢复
              </button>
              <button
                className="text-button"
                disabled={action.busy || !stopped || !cloneName}
                onClick={() => void mutate('/clone', 'POST', { name: cloneName, snapshot: s.id })}
              >
                克隆
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`删除快照 ${s.name}`}
                disabled={action.busy || !stopped}
                onClick={() => {
                  if (confirm(`删除快照“${s.name}”？`)) void mutate(`/snapshots/${s.id}`, 'DELETE');
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div className="feature-card">
          <label>
            名称
            <input
              maxLength={60}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label>
            备注
            <textarea
              maxLength={1000}
              value={editing.note || ''}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </label>
          <div className="feature-actions">
            <button
              className="primary compact"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/snapshots/${editing.id}`, 'PATCH', {
                    name: editing.name,
                    note: editing.note || '',
                  });
                  setEditing((current) => (current === editing ? null : current));
                  await refresh();
                })
              }
            >
              保存备注
            </button>
            <button className="secondary compact" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      <div className="feature-card">
        <h4>复制环境与迁移</h4>
        <label>
          克隆后的实例名称
          <input
            pattern="[a-z][a-z0-9-]*"
            maxLength={32}
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
          />
        </label>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={!stopped || action.busy}
            onClick={() => void mutate('/clone', 'POST', { name: cloneName })}
          >
            <Copy size={14} />
            克隆当前状态
          </button>
          <button
            className="secondary compact"
            disabled={!stopped || action.busy}
            onClick={() =>
              void action.run(
                () => download(request, vm.id, { type: 'export' }),
                '导出已交给浏览器处理，准备磁盘可能需要一些时间。请在浏览器查看下载进度。',
              )
            }
          >
            <Download size={14} />
            导出实例
          </button>
        </div>
        <p className="subtle-note">
          导出包含当前磁盘和实例连接凭证，请妥善保存。快照历史不随导出迁移；克隆默认清空端口转发，首次启动更新密钥。
        </p>
      </div>
      <PluginGate id="backups">
        <BackupPanel {...props} />
      </PluginGate>
    </div>
  );
}

export type ImageInfo = {
  id: 'alpine' | 'debian' | 'ubuntu';
  name: string;
  ready: boolean;
  minimumMemory: number;
  minimumDisk: number;
  job: JobView | null;
};
export function ImageCatalog({
  request,
  token,
  refresh,
}: {
  request: Request;
  token: string;
  refresh: () => Promise<unknown>;
}) {
  const remote = useRemote<ImageInfo[]>(request, '/images', true, 2500);
  const action = useAction();
  const [name, setName] = useState('imported-linux');
  const [password, setPassword] = useState('');
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="feature-panel">
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="image-catalog">
        {remote.data?.map((img) => (
          <div className="feature-card" key={img.id}>
            <span className="tag">官方云镜像</span>
            <h3>{img.name}</h3>
            <p>x86_64 · 最低 {img.minimumMemory} MiB 内存</p>
            <span className={`badge ${img.ready ? 'running' : ''}`}>
              {img.ready ? '可创建实例' : '尚未下载'}
            </span>
            {!img.ready && (
              <button
                className="secondary compact"
                disabled={action.busy || img.job?.status === 'running'}
                onClick={() =>
                  void action.run(async () => {
                    await request(`/images/${img.id}`, 'POST');
                    remote.reload();
                  })
                }
              >
                <Download size={14} />
                下载并校验
              </button>
            )}
            <JobLog job={img.job} />
          </div>
        ))}
      </div>
      <PluginGate id="snapshots">
        <div className="feature-card">
          <h3>导入 Sakura 实例</h3>
          <p>从 .sakura 或 .sakura.enc 文件恢复到新实例，端口转发默认清空。</p>
          <PluginGate id="backups">
            <label>
              加密备份密码
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                maxLength={1024}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="普通备份可留空"
              />
            </label>
          </PluginGate>
          <div className="inline-form">
            <input
              aria-label="导入实例名称"
              pattern="[a-z][a-z0-9-]*"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="secondary compact"
              disabled={action.busy}
              onClick={() => file.current?.click()}
            >
              <Upload size={14} />
              {action.busy ? '正在处理…' : '选择导出文件'}
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".sakura,.enc"
            hidden
            onChange={(e) => {
              const value = e.target.files?.[0];
              if (value)
                void action.run(async (signal) => {
                  if (value.name.endsWith('.enc') && !password) throw new Error('请输入加密备份密码');
                  const response = await fetch(`/api/import?name=${encodeURIComponent(name)}`, {
                    method: 'POST',
                    headers: {
                      'X-Sakura-Token': token,
                      'Content-Type': 'application/octet-stream',
                      ...(value.name.endsWith('.enc')
                        ? {
                            'X-Sakura-Passphrase': btoa(
                              Array.from(new TextEncoder().encode(password), (byte) =>
                                String.fromCharCode(byte),
                              ).join(''),
                            ),
                          }
                        : {}),
                    },
                    body: value,
                    signal,
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  setPassword('');
                  await refresh();
                }, '实例已导入，可在工作空间启动');
              e.target.value = '';
            }}
          />
        </div>
      </PluginGate>
    </div>
  );
}
