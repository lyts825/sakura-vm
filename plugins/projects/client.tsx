import { ExternalLink, Play, Save, Square } from 'lucide-react';
import { lazy, useEffect, useMemo, useState } from 'react';
import type { JobView } from '../../server/jobs';
import type { Project } from '../../server/workspaces';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { PluginGate } from '../../src/plugin-context';
import { executeProjectAction, type ProjectAction } from '../../src/project-action';
import { workspaceRequest } from '../../src/workspace-request';
import { TerminalPanel } from '../../src/TerminalPanel';
import { EnvironmentEditor, ProjectConnections, ServiceEditor } from './editors';
import type { DirectoryMigrationView } from '../../server/project-directory-migration';
const HealthPanel = lazy(() =>
  import('../service-health/client').then((module) => ({ default: module.HealthPanel })),
);
const SecretReferences = lazy(() =>
  import('../secrets/client').then((module) => ({ default: module.SecretReferences })),
);
const serviceStatus = (status: string) =>
  (
    ({
      running: '运行中',
      stopped: '已停止',
      absent: '已停止',
      prepared: '启动未确认',
      exited: '主进程已退出，待清理',
      unconfirmed: '状态未确认',
      'migration-required': '旧服务待迁移',
    }) as Record<string, string>
  )[status] || '状态未确认';

function DirectoryPermissions({
  request,
  vmId,
  enabled,
  applied,
}: {
  request: FeatureProps['request'];
  vmId: string;
  enabled: boolean;
  applied: () => void;
}) {
  const endpoint = `/vms/${vmId}/project-directory-migration`;
  const remote = useRemote<DirectoryMigrationView>(request, endpoint, enabled, 5000);
  const action = useAction(),
    plan = remote.data?.plan;
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => setReviewed(false), [plan?.sha256, remote.data?.projectId]);
  return (
    <details className="feature-card">
      <summary>目录账户权限</summary>
      <p>请先保存项目配置，再生成权限预览；应用前必须停止全部入口。</p>
      <p className="subtle-note">生成预览会为已保存项目保留独立账户，不修改项目目录权限。</p>
      <p className="subtle-note">仅支持独立项目目录；父目录权限、链接和其他项目不会自动调整。</p>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={!enabled || action.busy}
          onClick={() =>
            void action.run(async (signal) => {
              await request(endpoint, 'POST', { action: 'preview', version: 1 }, signal);
              remote.reload();
            })
          }
        >
          生成迁移预览
        </button>
      </div>
      {plan && (
        <>
          <p>{plan.proposal.directory}</p>
          <p>
            目标账户：{plan.proposal.identity.account} · UID/GID：{plan.proposal.identity.uid}/
            {plan.proposal.identity.gid}
          </p>
          <p>
            文件数：{plan.proposal.summary.files} · 目录数：{plan.proposal.summary.directories} ·
            已核对应用项：{plan.completed.length}/{plan.proposal.entries.length}
          </p>
          <p className="subtle-note">
            计划版本：{plan.proposal.version} · {plan.sha256}
          </p>
          {remote.data?.lastFailure && (
            <p className="subtle-note">
              上次失败：{remote.data.lastFailure.code} {remote.data.lastFailure.path}
            </p>
          )}
          {plan.state === 'applied' && !remote.data?.lastFailure ? (
            <p>目录权限与独立账户已完整确认。</p>
          ) : (
            <p className="subtle-note">应用或确认失败时保留原计划；未完整确认前，新项目运行会被阻止。</p>
          )}
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>路径</th>
                  <th>原 UID/GID</th>
                  <th>原权限</th>
                  <th>目标权限</th>
                </tr>
              </thead>
              <tbody>
                {plan.proposal.entries.map((entry) => (
                  <tr key={entry.path}>
                    <td>{entry.path}</td>
                    <td>
                      {entry.uid}/{entry.gid}
                    </td>
                    <td>{entry.mode.toString(8).padStart(4, '0')}</td>
                    <td>{entry.targetMode.toString(8).padStart(4, '0')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(plan.state !== 'applied' || remote.data?.lastFailure) && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                我已审阅逐项权限修改，并确认应用这份计划。
              </label>
              <button
                className="secondary compact"
                disabled={!enabled || action.busy || !reviewed}
                onClick={() =>
                  void action.run(async (signal) => {
                    try {
                      await request(
                        endpoint,
                        'POST',
                        {
                          action: 'apply',
                          version: 1,
                          planId: plan.proposal.planId,
                          sha256: plan.sha256,
                          reviewed: true,
                        },
                        signal,
                      );
                      applied();
                      setReviewed(false);
                    } finally {
                      remote.reload();
                    }
                  })
                }
              >
                应用这份预览
              </button>
            </>
          )}
        </>
      )}
    </details>
  );
}

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
    main?: { status: string };
    services?: { name: string; status: string; log: string }[];
  }>(request, `/vms/${vm.id}/project-runtime`, vm.status === 'running');
  const [project, setProject] = useState<Project | null>(null),
    [loadedProjectId, setLoadedProjectId] = useState('');
  const [shellProjectId, setShellProjectId] = useState<string | null>(null);
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
  useEffect(() => setShellProjectId(null), [remote.data?.projectId]);
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
          {runtime.data?.main?.status === 'unmanaged'
            ? '旧项目运行待迁移'
            : runtime.data?.status === 'running'
              ? '项目运行中'
              : runtime.data?.status === 'partial'
                ? '部分服务运行中'
                : runtime.data?.status === 'exited'
                  ? runtime.data.main
                    ? '项目主进程已退出，待清理'
                    : '服务主进程已退出，待清理'
                  : runtime.data?.status === 'unconfirmed'
                    ? runtime.data.main
                      ? '项目状态未确认'
                      : '服务状态未确认'
                    : '项目未运行'}
        </span>
      </div>
      {runtime.data?.main?.status === 'unmanaged' && (
        <p className="subtle-note">
          旧项目会话缺少运行归属。请由管理员核查并停止旧会话及其后台任务，再从这里启动。
        </p>
      )}
      {runtime.data?.main?.status === 'exited' && (
        <p className="subtle-note">主进程已退出，后台任务仍保留归属。请先停止项目完成清理。</p>
      )}
      {runtime.data?.main && ['prepared', 'unconfirmed'].includes(runtime.data.main.status) && (
        <p className="subtle-note">项目运行尚未确认。请先停止项目完成核对和清理，再修改配置或重新启动。</p>
      )}
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
            项目网络
            <select
              value={project.networkIsolation || 'host'}
              onChange={(e) =>
                edit({
                  networkIsolation: e.target.value as 'host' | 'private',
                  ...(e.target.value === 'private' ? { previewPort: undefined } : {}),
                })
              }
            >
              <option value="host">共享客户机网络</option>
              <option value="private">独立命名空间（仅回环，无外网）</option>
            </select>
            <small>
              私有项目的命令、服务和已接入的开发工具仅能访问自身回环网络；工具安装与依赖预取使用共享网络。专属容器和
              SSH 接入支持 Debian 与 Ubuntu。
            </small>
          </label>
          <label>
            预览的 Windows 端口（在“服务”中配置转发）
            <input
              type="number"
              min={1024}
              max={65535}
              value={project.previewPort ?? ''}
              disabled={project.networkIsolation === 'private'}
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
              disabled={
                action.busy ||
                remote.data?.job?.status === 'running' ||
                runtime.data?.main?.status === 'unmanaged'
              }
              onClick={() => void execute('start')}
            >
              <Play size={14} />
              {action.busy ? '正在准备…' : '启动开发'}
            </button>
            <button
              className="secondary compact"
              disabled={
                action.busy ||
                vm.status !== 'running' ||
                remote.data?.job?.status === 'running' ||
                runtime.data?.main?.status === 'unmanaged'
              }
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
            {remote.data?.project.networkIsolation === 'private' && vm.status === 'running' && (
              <button
                className="secondary compact"
                aria-expanded={shellProjectId === (remote.data.projectId || 'default')}
                onClick={() =>
                  setShellProjectId((current) =>
                    current === (remote.data!.projectId || 'default')
                      ? null
                      : remote.data!.projectId || 'default',
                  )
                }
              >
                {shellProjectId === (remote.data.projectId || 'default')
                  ? '关闭项目隔离终端'
                  : '打开项目隔离终端'}
              </button>
            )}
          </div>
          {shellProjectId === (remote.data?.projectId || 'default') &&
            remote.data?.project.networkIsolation === 'private' &&
            vm.status === 'running' && (
              <TerminalPanel vm={vm} start={() => {}} busy={false} projectId={shellProjectId} />
            )}
        </>
      )}
      <JobLog job={remote.data?.job} />
      <DirectoryPermissions
        request={request}
        vmId={vm.id}
        enabled={vm.status === 'running'}
        applied={() => {
          remote.reload();
          runtime.reload();
          refresh();
        }}
      />
      <PluginGate id="service-health">
        <HealthPanel {...props} request={request} />
      </PluginGate>
      {runtime.data?.services?.map((service) => (
        <details className="feature-card" key={service.name}>
          <summary>
            {service.name} · {serviceStatus(service.status)}
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
      <ProjectConnections
        {...props}
        request={request}
        applied={(value) => {
          setProject(value);
          remote.reload();
        }}
      />
    </div>
  );
}

export const tabs = { project: ProjectPanel };
