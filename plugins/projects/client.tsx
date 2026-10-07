/**
 * 模块职责（中文）：“项目工作区”插件的项目切换、配置、运行状态与目录迁移工作台，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for project configuration, identities and running services.
 * 详细范围（中文）：公开入口包括 ProjectPanel, tabs；职责覆盖项目配置、账号与运行服务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ProjectPanel, tabs. The scope covers UI interaction and state presentation for project configuration, identities and running services. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { embeddedPluginComponent } from '../../src/plugin-client';
import { ExternalLink, Play, Save, Square } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { DirectoryMigrationView, Project, ProjectList, ProjectRuntime, ProjectView } from './view-types';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { PluginGate } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
import { executeProjectAction, type ProjectAction } from '../../src/project-action';
import { workspaceRequest } from '../../src/workspace-request';
import { TerminalPanel } from '../../src/TerminalPanel';
import { EnvironmentEditor, ProjectConnections, ServiceEditor } from './editors';
/**
 * 中文：懒加载 ../service-health/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../service-health/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadHealthPanel = () =>
  import('../service-health/client').then((module) => ({ default: module.HealthPanel }));
/**
 * 中文：懒加载 ../secrets/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../secrets/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadSecretReferences = () =>
  import('../secrets/client').then((module) => ({ default: module.SecretReferences }));
/**
 * 中文：把服务运行、退出、准备和迁移等状态映射为明确显示文字，未知值显示未确认，避免误称已启动。
 * English: Map running/exited/prepared/migration service states to explicit display text and unknown values to unconfirmed, avoiding false started claims.
 * 中文：输入：status：签名所示 string 业务值
 * English: Inputs: status: the string domain value in the signature
 */
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

/**
 * 中文：呈现项目配置、账号与运行服务的界面交互与状态呈现中的 DirectoryPermissions 界面，订阅 endpoint，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DirectoryPermissions surface for UI interaction and state presentation for project configuration, identities and running services, subscribing to endpoint. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  request,
  vmId,
  enabled,
  networkPrivate,
  applied,
} 提供 request（带身份和权限作用域的传输能力）、vmId（当前实例标识）、enabled（是否启用本能力或读取流程）、networkPrivate（networkPrivate 状态）、applied（applied 状态） 上下文字段
 * English: Inputs: {
  request,
  vmId,
  enabled,
  networkPrivate,
  applied,
} provides context fields request (transport capability bound to identity/authority scope), vmId (current VM identifier), enabled (whether this capability/read flow is enabled), networkPrivate (networkPrivate state), applied (applied state)
 */
function DirectoryPermissions({
  request,
  vmId,
  enabled,
  networkPrivate,
  applied,
}: {
  request: FeatureProps['request'];
  vmId: string;
  enabled: boolean;
  networkPrivate: boolean;
  applied: /** 中文：在配置应用后通知外层恢复最新视图；这是 DirectoryPermissions 的调用契约 | English: Notify the outer owner to restore current views after configuration application; this is the callable contract of DirectoryPermissions | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const endpoint = `/vms/${vmId}/project-directory-migration`;
  const remote = useRemote<DirectoryMigrationView>(request, endpoint, enabled, 5000);
  const action = useAction(),
    plan = remote.data?.plan;
  const [reviewed, setReviewed] = useState(false);
  useEffect(/** 中文：当依赖 [plan?.sha256, remote.data?.projectId] 变化时reviewed 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [plan?.sha256, remote.data?.projectId] change, reviewed state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => setReviewed(false), [plan?.sha256, remote.data?.projectId]);
  return (
    <details className="feature-card">
      <summary>目录账户权限</summary>
      <p>请先保存项目配置，再生成权限预览；应用前必须停止全部入口。</p>
      <p className="subtle-note">生成预览会为已保存项目保留独立账户，不修改项目目录权限。</p>
      {networkPrivate && <p className="subtle-note">
        私有项目预览也会配置本实例的普通 SSH、定时任务和用户服务提权限制，影响所有普通账号的 sudo/su。
        首次准入可能要求管理员重启相关服务并结束旧会话；不会自动中断连接。
      </p>}
      <p className="subtle-note">仅支持独立项目目录；父目录权限、链接和其他项目不会自动调整。</p>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={!enabled || action.busy}
          onClick={() =>
            void action.run(/** 中文：提交 POST endpoint，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST endpoint for UI interaction and state presentation for project configuration, identities and running services. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
                  void action.run(/** 中文：提交 POST endpoint，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互并更新reviewed 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST endpoint for UI interaction and state presentation for project configuration, identities and running services and update reviewed state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
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

/**
 * 中文：呈现项目配置、账号与运行服务的界面交互与状态呈现中的 ProjectPanel 界面，订阅 /vms/{vm.id}/project、/vms/{vm.id}/projects、/vms/{vm.id}/project-runtime，组合 EnvironmentEditor、ServiceEditor、Save、Play、Square、ExternalLink、TerminalPanel、DirectoryPermissions，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ProjectPanel surface for UI interaction and state presentation for project configuration, identities and running services, subscribing to /vms/{vm.id}/project, /vms/{vm.id}/projects, /vms/{vm.id}/project-runtime and composing EnvironmentEditor, ServiceEditor, Save, Play, Square, ExternalLink, TerminalPanel, DirectoryPermissions. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps 业务值
 * English: Inputs: props: the FeatureProps domain value in the signature
 */
export function ProjectPanel(props: FeatureProps) {
  const { vm, request: baseRequest, refresh, projectId: selectedProjectId, onProjectChange } = props;
  const request = useMemo(
    () => workspaceRequest(baseRequest, selectedProjectId),
    [baseRequest, selectedProjectId],
  );
  const remote = useRemote<ProjectView>(
    request,
    `/vms/${vm.id}/project`,
    true,
    2500,
  );
  const projects = useRemote<ProjectList>(
    request,
    `/vms/${vm.id}/projects`,
    true,
    5000,
  );
  const runtime = useRemote<ProjectRuntime>(request, `/vms/${vm.id}/project-runtime`, vm.status === 'running');
  const [project, setProject] = useState<Project | null>(null),
    [loadedProjectId, setLoadedProjectId] = useState('');
  const [shellProjectId, setShellProjectId] = useState<string | null>(null);
  const action = useAction();
  useEffect(/** 中文：当依赖 [loadedProjectId, onProjectChange, project, remote.data] 变化时project 状态，loadedProjectId 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [loadedProjectId, onProjectChange, project, remote.data] change, project state, loadedProjectId state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!remote.data) return;
    const nextId = remote.data.projectId || 'default';
    onProjectChange?.(nextId);
    // 同一项目的后台轮询只更新远端视图；本地配置表单仅在首次加载或项目身份变化时初始化。
    if (!project || loadedProjectId !== nextId) {
      setProject(remote.data.project);
      setLoadedProjectId(nextId);
    }
  }, [loadedProjectId, onProjectChange, project, remote.data]);
  useEffect(/** 中文：当依赖 [onProjectChange, projects.data] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [onProjectChange, projects.data] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (projects.data) onProjectChange?.(projects.data.active);
  }, [onProjectChange, projects.data]);
  useEffect(/** 中文：当依赖 [remote.data?.projectId] 变化时shellProjectId 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data?.projectId] change, shellProjectId state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => setShellProjectId(null), [remote.data?.projectId]);
  /**
   * 中文：在项目配置、账号与运行服务的界面交互与状态呈现流程中project 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for project configuration, identities and running services, project state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：patch：只包含修改字段的增量
   * English: Inputs: patch: delta containing modified fields only
   */
  const edit = (patch: Partial<Project>) => setProject((p) => p && { ...p, ...patch });
  /**
   * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 action.run；进度和失败通过原任务服务契约交付
   * English: Execute the registered plugin job, delegating its context and validated resource arguments to action.run; deliver progress/failure through the existing job-service contract
   * 中文：输入：kind：签名所示 ProjectAction 业务值
   * English: Inputs: kind: the ProjectAction domain value in the signature
   */
  const execute = (kind: ProjectAction) =>
    action.run(/** 中文：在项目配置、账号与运行服务的界面交互与状态呈现流程中触发所属资源重新读取；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for project configuration, identities and running services, trigger rereading of the owned resource. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
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
                void action.run(/** 中文：提交 POST /vms/{vm.id}/projects，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/projects for UI interaction and state presentation for project configuration, identities and running services. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
            onClick={/**
             * 中文功能：取得非空新项目名称，经可取消 POST 创建项目，切换到返回的 active 项并刷新项目与配置视图。
             * English: Obtain a nonempty new project name, create it through cancellable POST, select the returned active project and refresh project/configuration views.
             * 输入 / Inputs: 无 / none.
             * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
             * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
             */
            () => {
              const name = prompt('新项目名称');
              if (name?.trim())
                void action.run(/** 中文：提交 POST /vms/{vm.id}/projects，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/projects for UI interaction and state presentation for project configuration, identities and running services. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
            onClick={/**
             * 中文功能：取得非空的新名称，为当前 active 项目提交重命名，再刷新项目列表。
             * English: Obtain a nonempty new name, submit a rename for the active project and refresh the project list.
             * 输入 / Inputs: 无 / none.
             * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
             * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
             */
            () => {
              const name = prompt('项目新名称');
              if (name?.trim())
                void action.run(/** 中文：提交 POST /vms/{vm.id}/projects，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/projects for UI interaction and state presentation for project configuration, identities and running services. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              私有项目的托管命令仅能访问自身回环网络；同一项目账号从共享网络建立的 IPv4/IPv6 连接也被阻断。
              工具安装与依赖预取使用共享网络，专属容器支持 Debian 与 Ubuntu。
            </small>
            {project.networkIsolation === 'private' && <small>
              系统服务提权限制会影响本实例所有普通账号的 sudo/su；首次启用可能需要管理员重启相关服务，关闭私有项目不会自动撤回。
            </small>}
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
            <PluginBoundary identity="official:secrets" request={request} label="凭据引用">
              {(_request, lifetime) => {
                const SecretReferences = embeddedPluginComponent('secrets', 'project-secrets', lifetime, loadSecretReferences);
                return <Suspense fallback={<p role="status">正在加载凭据配置…</p>}>
                  <SecretReferences value={project.secrets} change={(secrets) => edit({ secrets })} />
                </Suspense>;
              }}
            </PluginBoundary>
          </PluginGate>
          <ServiceEditor project={project} edit={edit} request={request} />
          <div className="feature-actions">
            <button
              className="secondary compact"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() =>
                void action.run(/** 中文：提交 PUT /vms/{vm.id}/project，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/project for UI interaction and state presentation for project configuration, identities and running services. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
        networkPrivate={remote.data?.project.networkIsolation === 'private'}
        applied={() => {
          remote.reload();
          runtime.reload();
          refresh();
        }}
      />
      <PluginGate id="service-health">
        <PluginBoundary identity="official:service-health" request={request} label="服务健康">
          {(scopedRequest, lifetime) => {
            const HealthPanel = embeddedPluginComponent('service-health', 'health-panel', lifetime, loadHealthPanel);
            return <Suspense fallback={<p role="status">正在加载服务健康…</p>}>
              <HealthPanel {...props} request={scopedRequest} />
            </Suspense>;
          }}
        </PluginBoundary>
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
                  void action.run(/** 中文：提交 POST /vms/{vm.id}/project，完成项目配置、账号与运行服务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/project for UI interaction and state presentation for project configuration, identities and running services. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
