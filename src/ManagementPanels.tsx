import { useEffect, useState } from 'react';
import { PluginGate } from './plugin-context';
import {
  Boxes,
  ClipboardList,
  Download,
  Inbox,
  Play,
  Save,
  Square,
  Star,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import type { VMView } from '../server/model';
import type { JobView } from '../server/jobs';
import type { Project } from '../server/workspaces';
import type { BackupPolicy, BackupRecord } from '../server/backups';
import type { DiagnosticCheck } from '../server/maintenance';
import { HealthEditor, SecretReferences } from './DevelopmentPanels';
import {
  Feedback,
  JobLog,
  useAction,
  useRemote,
  formatBytes,
  type FeatureProps,
  type Request,
} from './FeaturePanels';

export function saveText(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const taskLabels = {
  running: '执行中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};
export function TasksPanel({ request, vms }: { request: Request; vms: VMView[] }) {
  const remote = useRemote<{ jobs: JobView[]; warnings: string[] }>(request, '/jobs', true, 2000),
    events = useRemote<{ events: { title?: string; status: string; message?: string; at: string }[] }>(
      request,
      '/events',
      true,
      5000,
    ),
    action = useAction();
  const [filter, setFilter] = useState('all'),
    [machine, setMachine] = useState('all');
  const jobs =
    remote.data?.jobs.filter(
      (job) => (filter === 'all' || job.status === filter) && (machine === 'all' || job.vmId === machine),
    ) || [];
  const taskStatus = remote.error
    ? { tone: 'error', label: '暂时离线' }
    : remote.data
      ? { tone: 'running', label: '实时更新' }
      : { tone: 'starting', label: '正在连接' };
  return (
    <div className="content-panel feature-panel management-page">
      <div className="management-header">
        <div>
          <div className="eyebrow">
            <ClipboardList size={14} /> BACKGROUND WORK
          </div>
          <h2>任务中心</h2>
          <p className="muted">查看执行阶段、日志与历史。服务重启后，未完成的任务会标记为中断。</p>
        </div>
        <span className="page-status">
          <span className={`tiny-dot ${taskStatus.tone}`} />
          {taskStatus.label}
        </span>
      </div>
      <div className="feature-grid management-filters">
        <label>
          任务状态
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部状态</option>
            {Object.entries(taskLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          发行版
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="all">全部发行版</option>
            {vms.map((vm) => (
              <option key={vm.id} value={vm.id}>
                {vm.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Feedback error={action.error || remote.error || remote.data?.warnings.join('；')} />
      {events.data?.events.length ? (
        <details className="feature-card">
          <summary>需要关注的事件（{events.data.events.length}）</summary>
          {events.data.events.slice(0, 20).map((event, index) => (
            <p className="subtle-note" key={`${event.at}-${index}`}>
              {new Date(event.at).toLocaleString()} · {event.title || '后台任务'} ·{' '}
              {event.message || event.status}
            </p>
          ))}
        </details>
      ) : null}
      {remote.data && !jobs.length && (
        <div className="management-empty">
          <span className="empty-icon">
            <Inbox size={24} />
          </span>
          <h3>暂无任务记录</h3>
          <p>启动、同步或维护实例后，后台任务会显示在这里。</p>
        </div>
      )}
      {!remote.data && !remote.error && (
        <div className="management-loading" aria-label="正在读取任务">
          <span />
          <span />
          <span />
        </div>
      )}
      {jobs.map((job) => (
        <details className="feature-card" key={job.id} open={job.status === 'running'}>
          <summary>
            {job.title || '后台操作'} · {taskLabels[job.status]} ·{' '}
            {vms.find((vm) => vm.id === job.vmId)?.name || '系统'}
          </summary>
          <p className="subtle-note">
            {new Date(job.startedAt).toLocaleString()} · 耗时{' '}
            {Math.max(
              0,
              Math.round(
                ((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt)) /
                  1000,
              ),
            )}{' '}
            秒
          </p>
          <p role="status">{job.phase}</p>
          {job.status === 'running' && <progress aria-label="任务进度" max={100} value={job.progress} />}
          <Feedback error={job.error} />
          <pre className="feature-log">{job.log || '等待任务输出…'}</pre>
          <div className="feature-actions">
            {job.status === 'running' && (
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await request(`/jobs/${job.id}/cancel`, 'POST');
                    remote.reload();
                  })
                }
              >
                取消任务
              </button>
            )}
            {job.status !== 'running' && job.action && (
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = await request(`/jobs/${job.id}/retry`, 'POST');
                    if (result?.url && /^\/api\/downloads\/[a-f0-9]{64}$/.test(result.url)) {
                      const link = document.createElement('a');
                      link.href = result.url;
                      link.download = '';
                      link.click();
                    }
                    remote.reload();
                  })
                }
              >
                重新执行
              </button>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function OrganizationCard({
  vm,
  request,
  refresh,
  selected,
  toggle,
}: {
  vm: VMView;
  request: Request;
  refresh: () => Promise<unknown>;
  selected: boolean;
  toggle: () => void;
}) {
  const [group, setGroup] = useState(vm.organization?.group || ''),
    [tags, setTags] = useState(vm.organization?.tags.join(', ') || '');
  const action = useAction();
  const save = (favorite = !!vm.organization?.favorite) =>
    action.run(async () => {
      await request(`/vms/${vm.id}/organization`, 'PUT', {
        group,
        tags: tags
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
        favorite,
      });
      await refresh();
    }, '已保存');
  return (
    <div className="feature-card">
      <div className="panel-heading">
        <label className="checkbox-label">
          <input type="checkbox" checked={selected} onChange={toggle} />
          {vm.name}
        </label>
        <button
          className="icon-button"
          aria-label={`收藏 ${vm.name}`}
          aria-pressed={!!vm.organization?.favorite}
          disabled={action.busy}
          onClick={() => void save(!vm.organization?.favorite)}
        >
          <Star size={17} fill={vm.organization?.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <p className="subtle-note">
        {vm.cpus} vCPU · {vm.memoryMiB} MiB ·{' '}
        {
          {
            running: '运行中',
            paused: '已暂停',
            stopped: '已停止',
            starting: '启动中',
            stopping: '停止中',
            error: '需要检查',
          }[vm.status]
        }
      </p>
      <label>
        项目分组
        <input value={group} maxLength={40} onChange={(e) => setGroup(e.target.value)} />
      </label>
      <label>
        标签（逗号分隔）
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <button className="secondary compact" disabled={action.busy} onClick={() => void save()}>
        <Save size={14} />
        保存分组与标签
      </button>
      <Feedback error={action.error} message={action.message} />
    </div>
  );
}
export function LibraryPanel({
  request,
  vms,
  refresh,
}: {
  request: Request;
  vms: VMView[];
  refresh: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [group, setGroup] = useState('all'),
    [query, setQuery] = useState(''),
    [favorites, setFavorites] = useState(false);
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string }[]>([]),
    action = useAction();
  const visible = vms
    .filter(
      (v) =>
        (group === 'all' || (v.organization?.group || '') === group) &&
        (!favorites || v.organization?.favorite) &&
        [v.name, ...(v.organization?.tags || [])].join(' ').toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => Number(!!b.organization?.favorite) - Number(!!a.organization?.favorite));
  const chosen = vms.filter((v) => selected.includes(v.id));
  const batch = (kind: 'start' | 'stop') =>
    action.run(async () => {
      const result = await request('/vms/batch', 'POST', { ids: chosen.map((v) => v.id), action: kind });
      setResults(result.results);
      await refresh();
    });
  return (
    <div className="content-panel feature-panel management-page">
      <div className="management-header">
        <div>
          <div className="eyebrow">
            <Boxes size={14} /> WORKSPACE ORGANIZER
          </div>
          <h2>实例管理</h2>
          <p className="muted">用分组、标签和批量操作整理本机 Linux 工作空间。</p>
        </div>
        <span className="page-status">
          <span className="tiny-dot" />
          {vms.length} 个实例
        </span>
      </div>
      <div className="feature-grid management-filters">
        <label>
          搜索名称或标签
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          项目分组
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">全部分组</option>
            {[...new Set(vms.map((v) => v.organization?.group || ''))].map((name) => (
              <option key={name} value={name}>
                {name || '未分组'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="feature-actions">
        <label className="checkbox-label">
          <input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} />
          仅显示收藏
        </label>
        <button className="text-button" onClick={() => setSelected(visible.map((v) => v.id))}>
          选择当前列表
        </button>
        <button className="text-button" onClick={() => setSelected([])}>
          清空选择
        </button>
      </div>
      <div className="feature-card">
        <p>
          已选 {chosen.length} 个实例 · {chosen.reduce((sum, v) => sum + v.cpus, 0)} vCPU ·{' '}
          {formatBytes(chosen.reduce((sum, v) => sum + v.memoryMiB * 1024 ** 2, 0))} 内存
        </p>
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={!chosen.length || action.busy}
            onClick={() => void batch('start')}
          >
            <Play size={14} />
            批量启动
          </button>
          <button
            className="secondary compact"
            disabled={!chosen.length || action.busy}
            onClick={() => void batch('stop')}
          >
            <Square size={14} />
            批量停止
          </button>
        </div>
        <p className="subtle-note">最多同时运行 4 个实例；每个实例单独显示操作结果。</p>
        {results.map((result) => (
          <p key={result.id} className={result.ok ? 'feature-success' : 'danger-text'}>
            {vms.find((v) => v.id === result.id)?.name || result.id}：{result.ok ? '操作成功' : result.error}
          </p>
        ))}
        <Feedback error={action.error} />
      </div>
      <div className="feature-grid library-grid">
        {visible.map((vm) => (
          <OrganizationCard
            key={vm.id}
            vm={vm}
            request={request}
            refresh={refresh}
            selected={selected.includes(vm.id)}
            toggle={() =>
              setSelected((values) =>
                values.includes(vm.id) ? values.filter((v) => v !== vm.id) : [...values, vm.id],
              )
            }
          />
        ))}
      </div>
      {!visible.length && (
        <div className="management-empty">
          <span className="empty-icon">
            <Inbox size={24} />
          </span>
          <h3>没有匹配的实例</h3>
          <p>调整搜索、项目分组或收藏筛选后再试。</p>
        </div>
      )}
      <PluginGate id="environment">
        <RecipeImporter request={request} refresh={refresh} />
      </PluginGate>
    </div>
  );
}

export function ServiceEditor({
  project,
  edit,
}: {
  project: Project;
  edit: (patch: Partial<Project>) => void;
}) {
  const services = project.services || [];
  const change = (index: number, patch: Partial<(typeof services)[number]>) =>
    edit({ services: services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  return (
    <details className="feature-card" open={services.length > 0}>
      <summary>多服务项目（{services.length}）</summary>
      <p className="subtle-note">
        配置多个服务后，“启动开发”会按依赖顺序启动它们。就绪命令返回 0 后才会启动依赖它的服务。
      </p>
      {services.map((service, index) => (
        <div className="feature-card" key={index}>
          <div className="feature-grid">
            <label>
              服务名称
              <input
                value={service.name}
                onChange={(e) => change(index, { name: e.target.value })}
                placeholder="api"
              />
            </label>
            <label>
              依赖服务（逗号分隔）
              <input
                value={service.dependsOn.join(', ')}
                onChange={(e) =>
                  change(index, {
                    dependsOn: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>
          <label>
            启动命令
            <textarea
              value={service.command}
              onChange={(e) => change(index, { command: e.target.value })}
              placeholder="npm run dev -- --host 0.0.0.0"
            />
          </label>
          <div className="feature-grid">
            <label>
              就绪检查命令（可选）
              <input
                value={service.ready}
                onChange={(e) => change(index, { ready: e.target.value })}
                placeholder="curl -fsS http://127.0.0.1:3000/health"
              />
            </label>
            <label>
              最长等待秒数
              <input
                type="number"
                min={5}
                max={300}
                value={service.timeout}
                onChange={(e) => change(index, { timeout: +e.target.value })}
              />
            </label>
          </div>
          <EnvironmentEditor
            value={service.environment}
            change={(environment) => change(index, { environment })}
          />
          <PluginGate id="secrets">
            <SecretReferences value={service.secrets} change={(secrets) => change(index, { secrets })} />
          </PluginGate>
          <PluginGate id="monitoring">
            <HealthEditor value={service.health} change={(health) => change(index, { health })} />
          </PluginGate>
          <button
            className="text-button danger-text"
            onClick={() => edit({ services: services.filter((_, i) => i !== index) })}
          >
            <Trash2 size={14} />
            移除服务配置
          </button>
        </div>
      ))}
      <button
        className="secondary compact"
        disabled={services.length >= 12}
        onClick={() =>
          edit({
            services: [
              ...services,
              { name: `service-${services.length + 1}`, command: '', dependsOn: [], ready: '', timeout: 30 },
            ],
          })
        }
      >
        <Plus size={14} />
        添加服务
      </button>
    </details>
  );
}
export function EnvironmentEditor({
  value,
  change,
}: {
  value?: Record<string, string>;
  change: (value: Record<string, string>) => void;
}) {
  const [text, setText] = useState(() =>
    Object.entries(value || {})
      .map(([key, val]) => `${key}=${val}`)
      .join('\n'),
  );
  useEffect(() => {
    const parsed = Object.fromEntries(
      text
        .split('\n')
        .filter((s) => s.includes('='))
        .map((s) => [s.slice(0, s.indexOf('=')).trim(), s.slice(s.indexOf('=') + 1)]),
    );
    if (JSON.stringify(parsed) !== JSON.stringify(value || {}))
      setText(
        Object.entries(value || {})
          .map(([key, val]) => `${key}=${val}`)
          .join('\n'),
      );
  }, [value]);
  return (
    <label>
      环境变量（每行 NAME=value）
      <textarea
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          change(
            Object.fromEntries(
              e.target.value
                .split('\n')
                .filter((s) => s.includes('='))
                .map((s) => [s.slice(0, s.indexOf('=')).trim(), s.slice(s.indexOf('=') + 1)]),
            ),
          );
        }}
      />
      <small>环境配置会随导出文件一起分享，请使用非敏感配置值。</small>
    </label>
  );
}

export function ProjectConnections({
  vm,
  request,
  applied,
}: FeatureProps & { applied: (project: Project) => void }) {
  const ide = useRemote<{
    supported: boolean;
    running: boolean;
    alias: string;
    command: string;
    url: string;
  }>(request, `/vms/${vm.id}/ide`);
  const [recipe, setRecipe] = useState(''),
    [link, setLink] = useState('');
  const action = useAction();
  return (
    <>
      <div className="feature-card">
        <h4>在 VS Code 中开发</h4>
        {ide.data?.supported ? (
          <>
            <p className="subtle-note">
              连接当前项目目录。首次配置会向本机 SSH 配置添加 Sakura 的 Include，并保留原配置备份。
            </p>
            <button
              className="secondary compact"
              disabled={action.busy || !ide.data.running}
              onClick={() =>
                void action.run(async () => {
                  const result = await request(`/vms/${vm.id}/ide`, 'POST');
                  setLink(result.url);
                }, 'SSH 连接配置已更新')
              }
            >
              <ExternalLink size={14} />
              配置 VS Code 连接
            </button>
            {link && (
              <a className="primary compact" href={link}>
                打开 VS Code
              </a>
            )}
            <p className="muted">也可以在 PowerShell 中运行：</p>
            <code className="wrap-code">{ide.data.command}</code>
          </>
        ) : (
          <p className="muted">
            Remote-SSH 接入支持 Debian 与 Ubuntu。Alpine 可继续使用网页终端和文件编辑器。
          </p>
        )}
      </div>
      <details className="feature-card">
        <summary>分享与导入项目环境</summary>
        <p className="subtle-note">
          sakura.json 保存资源、环境和服务配置。导入后可以先检查命令，再点击“准备环境”。
        </p>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const result = await request(`/vms/${vm.id}/recipe`);
                setRecipe(JSON.stringify(result, null, 2));
                saveText('sakura.json', result);
              })
            }
          >
            <Download size={14} />
            导出配置
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || vm.status !== 'running'}
            onClick={() =>
              void action.run(async () => {
                const value = await request(`/vms/${vm.id}/recipe`, 'POST', { action: 'read' });
                setRecipe(JSON.stringify(value, null, 2));
              }, '已读取项目目录中的 sakura.json')
            }
          >
            从项目读取
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || vm.status !== 'running'}
            onClick={() =>
              void action.run(
                () => request(`/vms/${vm.id}/recipe`, 'POST', { action: 'write' }),
                '已在项目目录新建 sakura.json',
              )
            }
          >
            写入项目目录
          </button>
        </div>
        <label>
          待应用的环境配置
          <textarea
            rows={10}
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
            placeholder="粘贴 sakura.json 内容"
          />
        </label>
        <button
          className="primary compact"
          disabled={action.busy || !recipe.trim()}
          onClick={() =>
            void action.run(async () => {
              const result = await request(`/vms/${vm.id}/recipe`, 'PUT', JSON.parse(recipe));
              applied(result.project);
            }, '项目配置已应用，启动时生效')
          }
        >
          应用项目配置
        </button>
        <p className="subtle-note">应用到现有实例会更新项目配置；资源参数在创建新实例时使用。</p>
      </details>
      <Feedback error={action.error || ide.error} message={action.message} />
    </>
  );
}
function RecipeImporter({ request, refresh }: { request: Request; refresh: () => Promise<unknown> }) {
  const [name, setName] = useState('shared-dev'),
    [recipe, setRecipe] = useState('');
  const action = useAction();
  return (
    <details className="feature-card">
      <summary>从 sakura.json 创建环境</summary>
      <label>
        新实例名称
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        选择配置文件
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void action.run(async () => {
                if (file.size > 1024 ** 2) throw new Error('配置文件不能超过 1 MiB');
                setRecipe(await file.text());
              });
          }}
        />
      </label>
      <label>
        配置内容
        <textarea rows={8} value={recipe} onChange={(e) => setRecipe(e.target.value)} />
      </label>
      <button
        className="primary compact"
        disabled={action.busy || !recipe}
        onClick={() =>
          void action.run(async () => {
            await request('/recipes', 'POST', { name, recipe: JSON.parse(recipe) });
            await refresh();
          }, '环境已创建，可在项目面板准备环境并启动')
        }
      >
        创建环境
      </button>
      <Feedback error={action.error} message={action.message} />
    </details>
  );
}

export function BackupPanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<{
    policy: BackupPolicy;
    items: BackupRecord[];
    bytes: number;
    job: JobView | null;
    waitingForShutdown: boolean;
  }>(request, `/vms/${vm.id}/backups`, true, 2500);
  const [policy, setPolicy] = useState<BackupPolicy | null>(null),
    action = useAction();
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (!policy && remote.data) setPolicy(remote.data.policy);
  }, [policy, remote.data]);
  const run = (kind: string, backupId?: string, name?: string) =>
    action.run(async () => {
      await request(`/vms/${vm.id}/backups`, 'POST', {
        action: kind,
        backupId,
        name,
        password: password || undefined,
      });
      setPassword('');
      remote.reload();
      await refresh();
    });
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="feature-card">
      <h3>备份与加密导出</h3>
      <p className="subtle-note">按周期生成独立备份包。实例运行时延后到关机；恢复会创建新实例。</p>
      {policy && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
            />
            启用自动备份
          </label>
          <div className="feature-grid">
            <label>
              间隔（小时）
              <input
                type="number"
                min={1}
                max={720}
                value={policy.intervalHours}
                onChange={(e) => setPolicy({ ...policy, intervalHours: +e.target.value })}
              />
            </label>
            <label>
              最多保留份数
              <input
                type="number"
                min={1}
                max={30}
                value={policy.keep}
                onChange={(e) => setPolicy({ ...policy, keep: +e.target.value })}
              />
            </label>
            <label>
              总容量上限（GiB）
              <input
                type="number"
                min={1}
                max={512}
                value={policy.maxGiB}
                onChange={(e) => setPolicy({ ...policy, maxGiB: +e.target.value })}
              />
            </label>
            <label>
              外部备份目录（可选）
              <input
                value={policy.directory || ''}
                onChange={(e) => setPolicy({ ...policy, directory: e.target.value || undefined })}
                placeholder="E:\SakuraBackups"
              />
            </label>
            <label>
              自动加密密码引用（可选）
              <input
                value={policy.passwordSecret || ''}
                onChange={(e) => setPolicy({ ...policy, passwordSecret: e.target.value || undefined })}
                placeholder="backup-password"
              />
            </label>
          </div>
          <p className="subtle-note">
            加密密码引用来自“开发 → 私密配置”，至少 10 个字符。修改目录只影响新备份。
          </p>
          <label>
            本次加密 / 解密密码（可选）
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={1024}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="留空时使用备份的密码引用"
            />
          </label>
          <div className="feature-actions">
            <button
              className="secondary compact"
              disabled={busy}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/backups`, 'PUT', policy);
                  remote.reload();
                }, '备份策略已保存')
              }
            >
              保存策略
            </button>
            <button
              className="primary compact"
              disabled={busy || vm.poweredOn}
              onClick={() => void run('run')}
            >
              立即备份
            </button>
          </div>
        </>
      )}
      {remote.data?.waitingForShutdown && <p className="subtle-note">计划备份将在实例停止后检查并执行。</p>}
      <p>已用 {formatBytes(remote.data?.bytes || 0)}</p>
      {remote.data?.items.map((item) => (
        <div className="backup-row" key={item.id}>
          <div>
            <b>{new Date(item.createdAt).toLocaleString()}</b>
            <p className="subtle-note">
              {item.encrypted ? '已加密 · ' : ''}
              {formatBytes(item.bytes)} · {item.error || (item.verifiedAt ? '已通过校验' : '待校验')}
            </p>
            {item.directory && <p className="subtle-note wrap-path">{item.directory}</p>}
          </div>
          <div className="feature-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action.run(async (signal) => {
                  const { url } = await request(
                    `/vms/${vm.id}/backup-download`,
                    'POST',
                    { backupId: item.id },
                    signal,
                  );
                  if (!/^\/api\/downloads\/[a-f0-9]{64}$/.test(url)) throw new Error('无效的下载地址');
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = '';
                  link.referrerPolicy = 'no-referrer';
                  document.body.append(link);
                  link.click();
                  link.remove();
                }, '下载已开始')
              }
            >
              下载
            </button>
            <button className="text-button" disabled={busy} onClick={() => void run('verify', item.id)}>
              校验
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                const name = prompt('恢复为新实例，输入名称', `${vm.name.slice(0, 23)}-restore`);
                if (name) void run('restore', item.id, name);
              }}
            >
              恢复
            </button>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => {
                if (confirm('删除这份备份？')) void run('delete', item.id);
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      <Feedback error={action.error || remote.error} message={action.message} />
      <JobLog job={remote.data?.job} />
    </div>
  );
}

export function StoragePanel({ request }: { request: Request }) {
  const remote = useRemote<{
    total: number;
    available: number;
    backupBytes: number;
    warning: string;
    images: { id: string; name: string; bytes: number }[];
    machines: { id: string; name: string; bytes: number; snapshots: number }[];
  }>(request, '/storage');
  return (
    <div className="feature-card">
      <h3>空间管理</h3>
      <Feedback error={remote.error || remote.data?.warning} />
      {remote.data && (
        <>
          <p>
            所在磁盘剩余 {formatBytes(remote.data.available)} / {formatBytes(remote.data.total)}
          </p>
          <progress
            max={remote.data.total}
            value={remote.data.total - remote.data.available}
            aria-label="主机磁盘占用"
          />
          <div className="feature-grid">
            <div>
              <h4>基础镜像</h4>
              {remote.data.images.map((item) => (
                <p key={item.id}>
                  {item.name} · {formatBytes(item.bytes)}
                </p>
              ))}
            </div>
            <div>
              <h4>实例与快照</h4>
              {remote.data.machines.map((item) => (
                <p key={item.id}>
                  {item.name} · {formatBytes(item.bytes)} · {item.snapshots} 个快照
                </p>
              ))}
            </div>
          </div>
          <p>独立备份：{formatBytes(remote.data.backupBytes)}</p>
          <p className="subtle-note">内部快照与实例共享磁盘文件，占用合并显示。</p>
        </>
      )}
    </div>
  );
}
export function MaintenancePanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<{
    report: { createdAt: string; checks: DiagnosticCheck[]; log: string } | null;
    job: JobView | null;
  }>(request, `/vms/${vm.id}/diagnostics`, true, 2500);
  const [size, setSize] = useState(Math.min(128, vm.diskGiB * 2)),
    action = useAction();
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="content-panel feature-panel">
      <div className="feature-card">
        <h3>故障诊断</h3>
        <p className="subtle-note">检查加速、连接、网络、端口和磁盘，生成可导出的诊断报告。</p>
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={busy}
            onClick={() =>
              void action.run(async () => {
                await request(`/vms/${vm.id}/diagnostics`, 'POST');
                remote.reload();
              })
            }
          >
            开始诊断
          </button>
          <button
            className="secondary compact"
            disabled={!remote.data?.report}
            onClick={() => saveText('sakura-diagnostics.json', remote.data?.report)}
          >
            <Download size={14} />
            导出脱敏报告
          </button>
        </div>
        {remote.data?.report?.checks.map((check) => (
          <div key={check.name} className="diagnostic-row">
            <b>{check.name}</b>
            <span>
              {{ ok: '通过', warning: '需要留意', error: '异常', skip: '未检查' }[check.status]} ·{' '}
              {check.detail}
            </span>
            {check.suggestion && <p className="muted">{check.suggestion}</p>}
          </div>
        ))}
      </div>
      <div className="feature-card">
        <h3>扩容磁盘</h3>
        <p>
          当前容量 {vm.diskGiB} GiB · 已用磁盘文件 {formatBytes(vm.diskBytes)}
        </p>
        <label>
          目标容量（GiB）
          <input
            type="number"
            min={vm.diskGiB + 1}
            max={128}
            value={size}
            onChange={(e) => setSize(+e.target.value)}
          />
        </label>
        <button
          className="secondary compact"
          disabled={busy || vm.poweredOn || size <= vm.diskGiB || size > 128}
          onClick={() =>
            void action.run(async () => {
              await request(`/vms/${vm.id}/resize`, 'POST', { diskGiB: size });
              remote.reload();
              await refresh();
            })
          }
        >
          建立快照并扩容
        </button>
        <p className="subtle-note">请先停止实例。扩容完成后启动实例，会自动扩展 Linux 分区和文件系统。</p>
        {vm.pendingResize && (
          <>
            <p className="machine-error">Linux 文件系统尚待扩展，查看任务日志了解进度。</p>
            <button
              className="secondary compact"
              disabled={busy || vm.status !== 'running'}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/resize`, 'POST', { finish: true });
                  remote.reload();
                })
              }
            >
              重试文件系统扩容
            </button>
          </>
        )}
      </div>
      <div className="feature-card">
        <h3>整理磁盘空间</h3>
        <p className="subtle-note">
          停机后重建稀疏 QCOW2 镜像，移除未使用块。内部快照存在时需先保留或导出快照。
        </p>
        <button
          className="secondary compact"
          disabled={busy || vm.poweredOn || vm.snapshots.length > 0}
          onClick={() =>
            void action.run(async () => {
              await request(`/vms/${vm.id}/compact`, 'POST');
              remote.reload();
              await refresh();
            })
          }
        >
          整理未使用空间
        </button>
      </div>
      <Feedback error={action.error || remote.error} message={action.message} />
      <JobLog job={remote.data?.job} />
      <StoragePanel request={request} />
    </div>
  );
}
