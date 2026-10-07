/**
 * 模块职责（中文）：“Git 工作台”插件的Git 状态、差异、分支、远程与三方冲突解决工作台，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for Git status, branches and conflict resolution.
 * 详细范围（中文）：公开入口包括 GitPanel, tabs；职责覆盖Git 状态、分支与冲突处理的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include GitPanel, tabs. The scope covers UI interaction and state presentation for Git status, branches and conflict resolution. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from '../../src/localization';
import { GitBranch, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import type { JobView } from '../../shared/contracts/jobs.ts';
import { isGitConflict } from '../../shared/git';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';
import { workspaceRequest } from '../../src/workspace-request';
import { ThreeWayMerge } from '../../src/ThreeWayMerge';
type GitResponse = OperationResponse<'git.legacy.get.vms.vmId.git'>;
type GitView = Extract<GitResponse, { repository: boolean }>;
type GitDiff = Extract<GitResponse, { diff: string }>;
type GitMerge = Extract<GitResponse, { base: string }>;
type GitChoices = Extract<GitResponse, { expectedWorktree: string }>;

// 实例/项目变更通过 key 重挂载工作台，避免上一仓库的选择、冲突上下文或表单草稿进入新仓库。
/**
 * 中文：呈现Git 状态、分支与冲突处理的界面交互与状态呈现中的 GitPanel 界面，组合 GitWorkspacePanel，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the GitPanel surface for UI interaction and state presentation for Git status, branches and conflict resolution and composing GitWorkspacePanel. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps 业务值
 * English: Inputs: props: the FeatureProps domain value in the signature
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function GitPanel(props: FeatureProps) {
  return <GitWorkspacePanel key={`${props.vm.id}:${props.projectId || 'default'}`} {...props} />;
}

/**
 * 中文：呈现Git 状态、分支与冲突处理的界面交互与状态呈现中的 GitWorkspacePanel 界面，订阅 /vms/{vm.id}/git、/vms/{vm.id}/git?path={encodeURIComponent(selection?.path || '')}&staged={selection?.staged ? 1 : 0}，组合 RefreshCw、GitBranch、ThreeWayMerge，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the GitWorkspacePanel surface for UI interaction and state presentation for Git status, branches and conflict resolution, subscribing to /vms/{vm.id}/git, /vms/{vm.id}/git?path={encodeURIComponent(selection?.path || '')}&staged={selection?.staged ? 1 : 0} and composing RefreshCw, GitBranch, ThreeWayMerge. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request: baseRequest, projectId } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、projectId（当前项目标识） 上下文字段
 * English: Inputs: { vm, request: baseRequest, projectId } provides context fields vm (vm state), request (transport capability bound to identity/authority scope), projectId (current project identifier)
 */
function GitWorkspacePanel({ vm, request: baseRequest, projectId }: FeatureProps) {
  const request = useMemo(() => workspaceRequest(baseRequest, projectId), [baseRequest, projectId]);
  const remote = useRemote<GitView>(request, `/vms/${vm.id}/git`, vm.status === 'running');
  const repository = remote.data && 'branch' in remote.data ? remote.data : null;
  const action = useAction(),
    [message, setMessage] = useState(''),
    [branch, setBranch] = useState(''),
    [author, setAuthor] = useState(''),
    [email, setEmail] = useState('');
  const [remoteName, setRemoteName] = useState('origin'),
    [remoteUrl, setRemoteUrl] = useState('');
  const [selectedRemote, setSelectedRemote] = useState(''),
    [targetBranch, setTargetBranch] = useState(''),
    [submittedJob, setSubmittedJob] = useState<JobView | null>(null);
  const [selection, setSelection] = useState<{ path: string; staged: boolean } | null>(null);
  const [merge, setMerge] = useState<GitMerge | null>(null);
  const [choiceContext, setChoiceContext] = useState<GitChoices | null>(null);
  const [loadedProject, setLoadedProject] = useState('');
  useEffect(/** 中文：当依赖 [remote.data, loadedProject] 变化时loadedProject 状态，selection 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data, loadedProject] change, loadedProject state, selection state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setSelection(null);
    }
  }, [remote.data, loadedProject]);
  const diff = useRemote<GitDiff>(
    request,
    `/vms/${vm.id}/git?path=${encodeURIComponent(selection?.path || '')}&staged=${selection?.staged ? 1 : 0}`,
    vm.status === 'running' && !!selection,
    5000,
  );
  const remoteNames = [...new Set(repository?.remotes?.map((item) => item.name) || [])];
  const namesKey = remoteNames.join('\0');
  useEffect(/** 中文：当依赖 [namesKey, repository?.upstream?.remote] 变化时selectedRemote 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [namesKey, repository?.upstream?.remote] change, selectedRemote state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setSelectedRemote((selected) =>
      remoteNames.includes(selected)
        ? selected
        : remoteNames.includes(repository?.upstream?.remote || '')
          ? repository!.upstream!.remote
          : remoteNames.includes('origin')
            ? 'origin'
            : remoteNames[0] || '',
    );
  }, [namesKey, repository?.upstream?.remote]);
  useEffect(/** 中文：当依赖 [ selectedRemote, repository?.branch, repository?.detached, repository?.upstream?.remote, repository?.upstream?.branch, ] 变化时targetBranch 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [ selectedRemote, repository?.branch, repository?.detached, repository?.upstream?.remote, repository?.upstream?.branch, ] change, targetBranch state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setTargetBranch(
      repository?.upstream?.remote === selectedRemote
        ? repository.upstream.branch
        : repository?.detached
          ? ''
          : repository?.branch || '',
    );
  }, [
    selectedRemote,
    repository?.branch,
    repository?.detached,
    repository?.upstream?.remote,
    repository?.upstream?.branch,
  ]);
  // 保留刚提交的任务直至轮询追上，不能让稍旧的服务端任务快照把新的执行状态隐藏掉。
  const job =
    submittedJob &&
    submittedJob.id !== remote.data?.job?.id &&
    (!remote.data?.job || submittedJob.startedAt >= remote.data.job.startedAt)
      ? submittedJob
      : remote.data?.job;
  const busy = action.busy || job?.status === 'running';
  useEffect(/** 中文：当依赖 [job?.id, job?.status, diff.reload] 变化时触发所属资源重新读取，merge 状态，choiceContext 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [job?.id, job?.status, diff.reload] change, trigger rereading of the owned resource, merge state, choiceContext state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (job && job.status !== 'running') diff.reload();
    if (job?.status === 'done' && ['resolve', 'resolve-choice'].includes(job.action || '')) {
      setMerge(null);
      setChoiceContext(null);
    }
  }, [job?.id, job?.status, diff.reload]);
  const conflicts = remote.data?.changes.filter(isGitConflict) || [];
  const blocked =
    !!conflicts.length || !!repository?.operation || repository?.detached || !repository?.hasCommits;
  const hasRemote = remoteNames.includes(selectedRemote);
  /**
   * 中文：提交 POST /vms/{vm.id}/git，完成Git 状态、分支与冲突处理的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/git for UI interaction and state presentation for Git status, branches and conflict resolution. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   */
  const run = (value: unknown) =>
    action.run(/** 中文：提交 POST /vms/{vm.id}/git，完成Git 状态、分支与冲突处理的界面交互与状态呈现的数据交互并更新submittedJob 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/git for UI interaction and state presentation for Git status, branches and conflict resolution and update submittedJob state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      const accepted = await request<JobView>(`/vms/${vm.id}/git`, 'POST', value, signal);
      if (signal.aborted) return;
      setSubmittedJob(accepted);
      remote.reload();
      diff.reload();
    });
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Git 工作台</h3>
          <p>检查改动、暂存、提交，以及安全获取、快进拉取与推送远程分支。</p>
        </div>
        <button className="icon-button" aria-label="刷新 Git" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={action.error || remote.error || diff.error} />
      {vm.status !== 'running'
        ? stopped
        : remote.data && (
            <>
              {!repository ? (
                <div className="feature-card">
                  <p>项目目录还不是 Git 仓库。请先在开发工具中安装 Git。</p>
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void run({ action: 'init' })}
                  >
                    初始化仓库
                  </button>
                </div>
              ) : (
                <>
                  <div className="feature-card">
                    <div className="panel-heading">
                      <h4>
                        <GitBranch size={16} /> {repository.branch}
                      </h4>
                      <span className="badge">{remote.data.changes.length} 个改动</span>
                    </div>
                    <div className="feature-grid">
                      <label>
                        切换已有分支
                        <select
                          value=""
                          disabled={busy}
                          onChange={(e) =>
                            e.target.value && void run({ action: 'switch', branch: e.target.value })
                          }
                        >
                          <option value="">选择分支</option>
                          {repository.branches.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        新分支名称
                        <input
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                          placeholder="feature/my-change"
                        />
                      </label>
                    </div>
                    <button
                      className="secondary compact"
                      disabled={busy || !branch.trim()}
                      onClick={() => void run({ action: 'branch', branch: branch.trim() })}
                    >
                      创建并切换
                    </button>
                  </div>
                  {(conflicts.length > 0 || repository.operation) && (
                    <div className="feature-card" role="alert">
                      <h4>
                        {conflicts.length
                          ? `存在 ${conflicts.length} 个未解决的文件冲突`
                          : 'Git 操作尚未结束'}
                      </h4>
                      <p>
                        请编辑冲突文件并暂存解决结果，再在终端完成或中止当前合并 /
                        变基。解决前暂停拉取与推送。
                      </p>
                      {repository.operation && (
                        <p className="subtle-note">当前状态：{repository.operation}</p>
                      )}
                      {conflicts.map((change) => (
                        <p key={change.path}>
                          <code>{change.path}</code>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action.run(/** 中文：读取 GET /vms/{vm.id}/git?merge={encodeURIComponent(change.path)}，完成Git 状态、分支与冲突处理的界面交互与状态呈现的数据交互并更新merge 状态、choiceContext 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/git?merge={encodeURIComponent(change.path)} for UI interaction and state presentation for Git status, branches and conflict resolution and update merge state, choiceContext state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                                const result = await request<GitMerge>(
                                  `/vms/${vm.id}/git?merge=${encodeURIComponent(change.path)}`,
                                  'GET',
                                  undefined,
                                  signal,
                                );
                                signal.throwIfAborted();
                                setMerge(result);
                                setChoiceContext(null);
                              })
                            }
                          >
                            文本三方合并 {change.path}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void action.run(/** 中文：读取 GET /vms/{vm.id}/git?choices={encodeURIComponent(change.path)}，完成Git 状态、分支与冲突处理的界面交互与状态呈现的数据交互并更新choiceContext 状态、merge 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/git?choices={encodeURIComponent(change.path)} for UI interaction and state presentation for Git status, branches and conflict resolution and update choiceContext state, merge state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                              const result = await request<GitChoices>(
                                `/vms/${vm.id}/git?choices=${encodeURIComponent(change.path)}`,
                                'GET', undefined, signal,
                              );
                              signal.throwIfAborted();
                              setChoiceContext(result);
                              setMerge(null);
                            })}
                          >
                            选择版本 {change.path}
                          </button>
                        </p>
                      ))}
                      {choiceContext && (
                        <div className="feature-card">
                          <h5>选择冲突版本：{choiceContext.path}</h5>
                          <p className="subtle-note">
                            二进制、删除、符号链接和子模块冲突可选择一侧版本；子模块工作目录不会自动切换。
                          </p>
                          {(['ours', 'theirs'] as const).map((choice) => {
                            const stage = choiceContext[choice];
                            return <button key={choice} className="secondary compact" disabled={busy}
                              onClick={() => void run({
                                action: 'resolve-choice', path: choiceContext.path, choice,
                                expectedIndex: choiceContext.expectedIndex,
                                expectedWorktree: choiceContext.expectedWorktree,
                              })}>
                              采用{choice === 'ours' ? '当前' : '传入'}版本
                              {stage ? `（${stage.mode} · ${stage.oid.slice(0, 8)}）` : '（删除）'}
                            </button>;
                          })}
                          <button className="secondary compact" disabled={busy}
                            onClick={() => setChoiceContext(null)}>取消</button>
                        </div>
                      )}
                      {merge && (
                        <fieldset disabled={busy}>
                          <ThreeWayMerge
                            key={merge.path + merge.expectedIndex + merge.expectedVersion}
                            base={merge.base}
                            ours={merge.ours}
                            theirs={merge.theirs}
                            cancel={() => setMerge(null)}
                            apply={(content) => {
                              void run({
                                action: 'resolve',
                                path: merge.path,
                                content,
                                expectedVersion: merge.expectedVersion,
                                expectedIndex: merge.expectedIndex,
                              });
                            }}
                          />
                        </fieldset>
                      )}
                    </div>
                  )}
                  <div className="feature-card">
                    <h4>远程同步</h4>
                    <div className="feature-grid">
                      <label>
                        远程仓库
                        <select
                          value={selectedRemote}
                          disabled={busy || !remoteNames.length}
                          onChange={(e) => setSelectedRemote(e.target.value)}
                        >
                          {!remoteNames.length && <option value="">尚未配置远程仓库</option>}
                          {remoteNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        目标远程分支
                        <input
                          value={targetBranch}
                          disabled={busy}
                          onChange={(e) => setTargetBranch(e.target.value)}
                          placeholder="main"
                        />
                      </label>
                    </div>
                    {repository.remotes
                      ?.filter((item) => item.name === selectedRemote)
                      .map((item) => (
                        <p className="subtle-note" key={`${item.name}:${item.kind}`}>
                          {item.kind === '(push)' ? '推送地址' : '获取地址'}：{item.url}
                        </p>
                      ))}
                    {repository.upstream && (
                      <p className="subtle-note">
                        当前上游：{repository.upstream.name}
                        {repository.divergence?.length === 2
                          ? `（落后 ${repository.divergence[0]}，领先 ${repository.divergence[1]}；基于上次获取）`
                          : ''}
                      </p>
                    )}
                    {repository.divergence?.length === 2 &&
                      repository.divergence.every((count) => count > 0) && (
                        <p role="alert">
                          本地与上游历史已分叉。请获取更新后在终端手动合并或变基，再重试；快进拉取不会合并分叉。
                        </p>
                      )}
                    {repository.detached ? (
                      <p className="subtle-note">detached HEAD：请先切换到本地分支再拉取或推送。</p>
                    ) : (
                      !repository.hasCommits && (
                        <p className="subtle-note">请先创建首次提交，再拉取或推送。</p>
                      )
                    )}
                    {!!remote.data.changes.length && (
                      <p className="subtle-note">
                        拉取前请提交或自行 stash 工作区与暂存区的改动（含未跟踪文件）。推送仅发送已有提交。
                      </p>
                    )}
                    <p className="subtle-note">
                      获取更新只更新远程跟踪分支。拉取仅允许快进；推送将当前分支的提交发送到所选目标，不会强制覆盖远程历史。
                    </p>
                    <div className="feature-actions">
                      <button
                        className="secondary compact"
                        disabled={busy || !hasRemote}
                        onClick={() => void run({ action: 'fetch', remote: selectedRemote })}
                      >
                        获取更新
                      </button>
                      <button
                        className="secondary compact"
                        disabled={
                          busy ||
                          !hasRemote ||
                          !targetBranch.trim() ||
                          blocked ||
                          !!remote.data.changes.length
                        }
                        onClick={() =>
                          void run({ action: 'pull', remote: selectedRemote, branch: targetBranch.trim() })
                        }
                      >
                        快进拉取
                      </button>
                      <button
                        className="secondary compact"
                        disabled={busy || !hasRemote || !targetBranch.trim() || blocked}
                        onClick={() =>
                          void run({ action: 'push', remote: selectedRemote, branch: targetBranch.trim() })
                        }
                      >
                        推送当前分支
                      </button>
                    </div>
                    <details>
                      <summary>添加远程仓库</summary>
                      <div className="feature-actions">
                        <input
                          aria-label="新远程名称"
                          value={remoteName}
                          onChange={(e) => setRemoteName(e.target.value)}
                          placeholder="origin"
                        />
                        <input
                          aria-label="新远程 HTTPS 地址"
                          value={remoteUrl}
                          onChange={(e) => setRemoteUrl(e.target.value)}
                          placeholder="https://git.example/repo.git"
                        />
                        <button
                          className="secondary compact"
                          disabled={busy || !remoteUrl}
                          onClick={() => void run({ action: 'remote-add', name: remoteName, url: remoteUrl })}
                        >
                          添加远程
                        </button>
                      </div>
                    </details>
                  </div>
                  {!remote.data.changes.length && <p className="muted">工作区干净，没有待提交改动。</p>}
                  {remote.data.changes.map((change) => (
                    <div className="development-row" key={change.path}>
                      <div>
                        <code>
                          {change.index}
                          {change.worktree}
                        </code>{' '}
                        <b>{change.path}</b>
                        {isGitConflict(change) && <span className="badge error">未解决冲突</span>}
                        {change.previous && <small> ← {change.previous}</small>}
                      </div>
                      <div className="feature-actions">
                        <button
                          className="text-button"
                          onClick={() => setSelection({ path: change.path, staged: false })}
                        >
                          工作区差异
                        </button>
                        {change.index !== ' ' && change.index !== '?' && (
                          <button
                            className="text-button"
                            onClick={() => setSelection({ path: change.path, staged: true })}
                          >
                            暂存差异
                          </button>
                        )}
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run({
                              action: 'stage',
                              paths: [change.path, ...(change.previous ? [change.previous] : [])],
                            })
                          }
                        >
                          {isGitConflict(change) ? '标记已解决（暂存）' : '暂存'}
                        </button>
                        {change.index !== ' ' && change.index !== '?' && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void run({
                                action: 'unstage',
                                paths: [change.path, ...(change.previous ? [change.previous] : [])],
                              })
                            }
                          >
                            取消暂存
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {selection && (
                    <div className="feature-card">
                      <div className="panel-heading">
                        <h4>
                          {selection.path} · {selection.staged ? '暂存区' : '工作区'}
                        </h4>
                        <button className="text-button" onClick={() => setSelection(null)}>
                          关闭差异
                        </button>
                      </div>
                      <pre className="feature-log git-diff">{diff.data?.diff || '没有文本差异'}</pre>
                      {diff.data?.truncated && (
                        <p className="subtle-note">差异过长，仅显示前 200,000 个字符。</p>
                      )}
                    </div>
                  )}
                  <label>
                    提交说明
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={2}
                      placeholder="说明这次改动的目的"
                    />
                  </label>
                  <details className="feature-card">
                    <summary>本次提交身份（可选）</summary>
                    <div className="feature-grid">
                      <label>
                        作者
                        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
                      </label>
                      <label>
                        邮箱
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                      </label>
                    </div>
                    <p className="subtle-note">留空时使用仓库已有的 Git 身份配置。</p>
                  </details>
                  <button
                    className="primary compact"
                    disabled={busy || !message.trim() || !!conflicts.length}
                    onClick={() =>
                      void run({
                        action: 'commit',
                        message,
                        author: author.trim() || undefined,
                        email: email.trim() || undefined,
                      })
                    }
                  >
                    提交暂存改动
                  </button>
                  <details className="feature-card">
                    <summary>最近提交（{remote.data.history.length}）</summary>
                    {remote.data.history.map((commit) => (
                      <div className="development-row" key={commit.id}>
                        <div>
                          <code>{commit.short}</code> {commit.subject}
                          <p className="subtle-note">
                            {commit.author} · {formatDateTime(new Date(commit.date))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </details>
                </>
              )}
              <JobLog job={job} />
              {job?.status === 'running' && job.id && (
                <button
                  className="secondary compact"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(/** 中文：在Git 状态、分支与冲突处理的界面交互与状态呈现流程中触发所属资源重新读取；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for Git status, branches and conflict resolution, trigger rereading of the owned resource. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                      await baseRequest(`/jobs/${job.id}/cancel`, 'POST', undefined, signal);
                      remote.reload();
                    })
                  }
                >
                  取消 Git 任务
                </button>
              )}
            </>
          )}
    </div>
  );
}

export const tabs = { git: GitPanel };
