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
const HealthPanel = lazy(() =>
  import('../service-health/client').then((module) => ({ default: module.HealthPanel })),
);
const SecretReferences = lazy(() =>
  import('../secrets/client').then((module) => ({ default: module.SecretReferences })),
);

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
            项目网络
            <select value={project.networkIsolation || 'host'}
              onChange={(e) => edit({ networkIsolation: e.target.value as 'host' | 'private',
                ...(e.target.value === 'private' ? { previewPort: undefined } : {}) })}>
              <option value="host">共享客户机网络</option>
              <option value="private">独立命名空间（仅回环，无外网）</option>
            </select>
            <small>私有模式适用于项目命令、服务、流水线、收藏命令和显式项目隔离终端；Notebook、浏览器 IDE、服务网格及容器启动需要共享网络。</small>
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
            {remote.data?.project.networkIsolation === 'private' &&
              vm.status === 'running' && <button className="secondary compact"
                aria-expanded={shellProjectId === (remote.data.projectId || 'default')}
                onClick={() => setShellProjectId((current) =>
                  current === (remote.data!.projectId || 'default')
                    ? null : (remote.data!.projectId || 'default'))}>
                {shellProjectId === (remote.data.projectId || 'default')
                  ? '关闭项目隔离终端' : '打开项目隔离终端'}
              </button>}
          </div>
          {shellProjectId === (remote.data?.projectId || 'default') &&
            remote.data?.project.networkIsolation === 'private' &&
            vm.status === 'running' && <TerminalPanel vm={vm} start={() => {}}
              busy={false} projectId={shellProjectId} />}
        </>
      )}
      <JobLog job={remote.data?.job} />
      <PluginGate id="service-health">
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
