import { GitBranch, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { GitChange } from '../../server/git-workbench';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';
import { workspaceRequest } from '../../src/workspace-request';

export function GitPanel({ vm, request: baseRequest, projectId }: FeatureProps) {
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
    job: JobView | null;
  }>(request, `/vms/${vm.id}/git`, vm.status === 'running');
  const action = useAction(),
    [message, setMessage] = useState(''),
    [branch, setBranch] = useState(''),
    [author, setAuthor] = useState(''),
    [email, setEmail] = useState('');
  const [remoteName, setRemoteName] = useState('origin'),
    [remoteUrl, setRemoteUrl] = useState('');
  const [selection, setSelection] = useState<{ path: string; staged: boolean } | null>(null);
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
  const busy = action.busy || remote.data?.job?.status === 'running';
  const run = (value: unknown) =>
    action.run(async (signal) => {
      await request(`/vms/${vm.id}/git`, 'POST', value, signal);
      remote.reload();
      diff.reload();
    });
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Git 工作台</h3>
          <p>检查改动、暂存、提交与管理本地分支。</p>
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
                    <div className="feature-actions">
                      <input
                        value={remoteName}
                        onChange={(e) => setRemoteName(e.target.value)}
                        placeholder="origin"
                      />
                      <input
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
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void run({ action: 'fetch', remote: remoteName })}
                      >
                        获取更新
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void run({ action: 'pull', remote: remoteName })}
                      >
                        快进合并
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void run({ action: 'push', remote: remoteName })}
                      >
                        推送
                      </button>
                    </div>
                    {remote.data.remotes?.length ? (
                      <p className="subtle-note">
                        远程：
                        {[...new Set(remote.data.remotes.map((item) => `${item.name} · ${item.url}`))].join(
                          '；',
                        )}{' '}
                        {remote.data.divergence?.length === 2
                          ? `（落后 ${remote.data.divergence[0]}，领先 ${remote.data.divergence[1]}）`
                          : ''}
                      </p>
                    ) : (
                      <p className="subtle-note">尚未配置远程仓库。</p>
                    )}
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
                          暂存
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
                    disabled={busy || !message.trim()}
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
              <JobLog job={remote.data.job} />
            </>
          )}
    </div>
  );
}

export const tabs = { git: GitPanel };
