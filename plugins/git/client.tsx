import { GitBranch, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { GitChange } from '../../server/git-workbench';
import type { JobView } from '../../server/jobs';
import { isGitConflict, type GitUpstream } from '../../shared/git';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';
import { workspaceRequest } from '../../src/workspace-request';
import { ThreeWayMerge } from '../../src/ThreeWayMerge';

export function GitPanel(props: FeatureProps) {
  return <GitWorkspacePanel key={`${props.vm.id}:${props.projectId || 'default'}`} {...props} />;
}

function GitWorkspacePanel({ vm, request: baseRequest, projectId }: FeatureProps) {
  const request = useMemo(() => workspaceRequest(baseRequest, projectId), [baseRequest, projectId]);
  const remote = useRemote<{
    projectId?: string;
    repository: boolean;
    error?: string;
    branch: string;
    changes: GitChange[];
    branches: string[];
    history: { id: string; short: string; subject: string; author: string; date: string }[];
    remotes?: { name: string; url: string; kind: string }[];
    divergence?: number[];
    detached: boolean;
    hasCommits: boolean;
    conflicts: string[];
    operation: string | null;
    upstream: GitUpstream | null;
    job: JobView | null;
  }>(request, `/vms/${vm.id}/git`, vm.status === 'running');
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
  const [merge, setMerge] = useState<{
    path: string;
    base: string;
    ours: string;
    theirs: string;
    expectedVersion: string;
    expectedIndex: string;
  } | null>(null);
  const [loadedProject, setLoadedProject] = useState('');
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setSelection(null);
    }
  }, [remote.data, loadedProject]);
  const diff = useRemote<{ diff: string; truncated: boolean }>(
    request,
    `/vms/${vm.id}/git?path=${encodeURIComponent(selection?.path || '')}&staged=${selection?.staged ? 1 : 0}`,
    vm.status === 'running' && !!selection,
    5000,
  );
  const remoteNames = [...new Set(remote.data?.remotes?.map((item) => item.name) || [])];
  const namesKey = remoteNames.join('\0');
  useEffect(() => {
    setSelectedRemote((selected) =>
      remoteNames.includes(selected)
        ? selected
        : remoteNames.includes(remote.data?.upstream?.remote || '')
          ? remote.data!.upstream!.remote
          : remoteNames.includes('origin')
            ? 'origin'
            : remoteNames[0] || '',
    );
  }, [namesKey, remote.data?.upstream?.remote]);
  useEffect(() => {
    setTargetBranch(
      remote.data?.upstream?.remote === selectedRemote
        ? remote.data.upstream.branch
        : remote.data?.detached
          ? ''
          : remote.data?.branch || '',
    );
  }, [
    selectedRemote,
    remote.data?.branch,
    remote.data?.detached,
    remote.data?.upstream?.remote,
    remote.data?.upstream?.branch,
  ]);
  const job =
    submittedJob &&
    submittedJob.id !== remote.data?.job?.id &&
    (!remote.data?.job || submittedJob.startedAt >= remote.data.job.startedAt)
      ? submittedJob
      : remote.data?.job;
  const busy = action.busy || job?.status === 'running';
  useEffect(() => {
    if (job && job.status !== 'running') diff.reload();
    if (job?.status === 'done' && job.action === 'resolve') setMerge(null);
  }, [job?.id, job?.status, diff.reload]);
  const conflicts = remote.data?.changes.filter(isGitConflict) || [];
  const blocked =
    !!conflicts.length || !!remote.data?.operation || remote.data?.detached || !remote.data?.hasCommits;
  const hasRemote = remoteNames.includes(selectedRemote);
  const run = (value: unknown) =>
    action.run(async (signal) => {
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
              {!remote.data.repository ? (
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
                        <GitBranch size={16} /> {remote.data.branch}
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
                          {remote.data.branches.map((name) => (
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
                  {(conflicts.length > 0 || remote.data.operation) && (
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
                      {remote.data.operation && (
                        <p className="subtle-note">当前状态：{remote.data.operation}</p>
                      )}
                      {conflicts.map((change) => (
                        <p key={change.path}>
                          <code>{change.path}</code>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action.run(async (signal) => {
                                setMerge(
                                  await request(
                                    `/vms/${vm.id}/git?merge=${encodeURIComponent(change.path)}`,
                                    'GET',
                                    undefined,
                                    signal,
                                  ),
                                );
                              })
                            }
                          >
                            三方合并 {change.path}
                          </button>
                        </p>
                      ))}
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
                    {remote.data.remotes
                      ?.filter((item) => item.name === selectedRemote)
                      .map((item) => (
                        <p className="subtle-note" key={`${item.name}:${item.kind}`}>
                          {item.kind === '(push)' ? '推送地址' : '获取地址'}：{item.url}
                        </p>
                      ))}
                    {remote.data.upstream && (
                      <p className="subtle-note">
                        当前上游：{remote.data.upstream.name}
                        {remote.data.divergence?.length === 2
                          ? `（落后 ${remote.data.divergence[0]}，领先 ${remote.data.divergence[1]}；基于上次获取）`
                          : ''}
                      </p>
                    )}
                    {remote.data.divergence?.length === 2 &&
                      remote.data.divergence.every((count) => count > 0) && (
                        <p role="alert">
                          本地与上游历史已分叉。请获取更新后在终端手动合并或变基，再重试；快进拉取不会合并分叉。
                        </p>
                      )}
                    {remote.data.detached ? (
                      <p className="subtle-note">detached HEAD：请先切换到本地分支再拉取或推送。</p>
                    ) : (
                      !remote.data.hasCommits && (
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
                            {commit.author} · {new Date(commit.date).toLocaleString()}
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
                    void action.run(async (signal) => {
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
