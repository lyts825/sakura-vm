import { useEffect, useMemo, useState } from 'react';
import { GitBranch, RefreshCw, Play, Save, Trash2, Download } from 'lucide-react';
import type { JobView } from '../server/jobs';
import type { GitChange } from '../server/git-workbench';
import type { NetworkProfile, NetworkChange } from '../server/network-profiles';
import type { CommandPreset } from '../server/command-presets';
import type { HealthView } from '../server/service-health';
import type { ProjectService } from '../server/project-services';
import {
  Feedback,
  JobLog,
  useAction,
  useRemote,
  formatBytes,
  type FeatureProps,
  type Request,
} from './FeaturePanels';
import { workspaceRequest } from './workspace-request';
import { usePlugin } from './plugin-context';
import './development.css';

const stopped = <p className="subtle-note">启动实例后可使用此功能。</p>;
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

export function DevelopmentPanel(props: FeatureProps) {
  const development = usePlugin('development'),
    network = usePlugin('network'),
    secrets = usePlugin('secrets');
  const scopedRequest = useMemo(
    () => workspaceRequest(props.request, props.projectId),
    [props.projectId, props.request],
  );
  const scopedProps = { ...props, request: scopedRequest };
  const [section, setSection] = useState(development ? 'tools' : network ? 'network' : 'secrets');
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>开发设置</h3>
          <p>管理工具、网络、私密配置和常用命令。</p>
        </div>
      </div>
      <div className="feature-actions development-sections" aria-label="开发设置分类">
        {[
          ['tools', '开发工具'],
          ['network', '网络配置'],
          ['secrets', '私密配置'],
          ['commands', '收藏命令'],
          ['pipelines', '流水线'],
          ['runtimes', '版本'],
        ]
          .filter(([id]) => (id === 'network' ? network : id === 'secrets' ? secrets : development))
          .map(([id, label]) => (
            <button
              key={id}
              className={`${section === id ? 'primary' : 'secondary'} compact`}
              aria-pressed={section === id}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
      </div>
      {section === 'tools' && <ToolsPanel {...scopedProps} />}
      {section === 'network' && <NetworkPanel {...scopedProps} />}
      {section === 'secrets' && <SecretsPanel {...scopedProps} />}
      {section === 'commands' && <CommandsPanel {...scopedProps} />}
      {section === 'pipelines' && <PipelinePanel {...scopedProps} />}
      {section === 'runtimes' && <RuntimePanel {...scopedProps} />}
    </div>
  );
}
function PipelinePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
    projectId?: string;
    pipelines: {
      id: string;
      name: string;
      steps: { name: string; command: string }[];
      artifacts: string[];
    }[];
    runs: any[];
    job: JobView | null;
  }>(request, `/vms/${vm.id}/pipelines`, vm.status === 'running', 3000);
  const action = useAction();
  const [name, setName] = useState('检查与构建');
  const [command, setCommand] = useState('npm test && npm run build');
  const [artifact, setArtifact] = useState('dist');
  const [loadedProject, setLoadedProject] = useState('');
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setName('检查与构建');
      setCommand('npm test && npm run build');
      setArtifact('dist');
    }
  }, [remote.data, loadedProject]);
  const save = () =>
    void action.run(async (signal) => {
      await request(
        `/vms/${vm.id}/pipelines`,
        'PUT',
        {
          name,
          steps: [{ name: '检查与构建', command, timeout: 600 }],
          artifacts: artifact ? [artifact] : [],
        },
        signal,
      );
      remote.reload();
    }, '流水线已保存');
  return (
    <>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-grid">
        <label>
          流水线名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          产物路径（相对项目目录）
          <input value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="dist" />
        </label>
      </div>
      <label>
        步骤命令
        <textarea rows={3} value={command} onChange={(e) => setCommand(e.target.value)} />
      </label>
      <div className="feature-actions">
        <button className="secondary compact" disabled={action.busy} onClick={save}>
          <Save size={14} />
          保存流水线
        </button>
        {remote.data?.pipelines.map((p) => (
          <button
            className="primary compact"
            disabled={action.busy}
            key={p.id}
            onClick={() =>
              void action.run(async (signal) => {
                await request(`/vms/${vm.id}/pipelines`, 'POST', { action: 'run', pipelineId: p.id }, signal);
                remote.reload();
              })
            }
          >
            <Play size={14} />
            运行 {p.name}
          </button>
        ))}
      </div>
      <JobLog job={remote.data?.job} />
      {remote.data?.runs.map((run) => (
        <details className="feature-card" key={run.id}>
          <summary>
            {run.name} · {run.status} · {new Date(run.startedAt).toLocaleString()}
          </summary>
          {run.steps.map((step: any) => (
            <div className="development-row" key={step.name}>
              <span>
                {step.name} · {step.status}
              </span>
              <pre className="feature-log">{step.log}</pre>
            </div>
          ))}
          <div className="feature-actions">
            {run.artifacts.map((a: any) => (
              <button
                className="text-button"
                key={a.index}
                onClick={() =>
                  void action.run(async (signal) => {
                    const { url } = await request(
                      `/vms/${vm.id}/pipeline-artifact`,
                      'POST',
                      { runId: run.id, index: a.index },
                      signal,
                    );
                    window.open(url, '_blank', 'noopener,noreferrer');
                  })
                }
              >
                下载 {a.name}
              </button>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}
function RuntimePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
    selected: { node?: string; python?: string };
    declared: Record<string, string>;
    actual: Record<string, string>;
    mismatches: string[];
    job: JobView | null;
  }>(request, `/vms/${vm.id}/runtimes`, vm.status === 'running', 10000);
  const action = useAction();
  const [tool, setTool] = useState<'node' | 'python'>('node');
  const [version, setVersion] = useState('22.12.0');
  return (
    <>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-card">
        <p>
          项目声明：Node {remote.data?.declared.node || '—'} · Python {remote.data?.declared.python || '—'}
        </p>
        <p>
          当前版本：Node {remote.data?.actual.node || '—'} · Python {remote.data?.actual.python || '—'}
        </p>
        {remote.data?.mismatches.length ? (
          <p className="machine-error">版本不匹配：{remote.data.mismatches.join('、')}</p>
        ) : (
          <p className="feature-success">版本匹配</p>
        )}
      </div>
      <div className="feature-actions">
        <select value={tool} onChange={(e) => setTool(e.target.value as 'node' | 'python')}>
          <option value="node">Node.js</option>
          <option value="python">Python</option>
        </select>
        <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="22.12.0" />
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={() =>
            void action.run(async (signal) => {
              await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'install', tool, version }, signal);
              remote.reload();
            })
          }
        >
          安装版本
        </button>
        <button
          className="primary compact"
          disabled={action.busy || !remote.data}
          onClick={() =>
            void action.run(async (signal) => {
              await request(
                `/vms/${vm.id}/runtimes`,
                'POST',
                {
                  action: 'select',
                  node: tool === 'node' ? version : remote.data?.selected.node,
                  python: tool === 'python' ? version : remote.data?.selected.python,
                },
                signal,
              );
              remote.reload();
            }, '项目版本已选择')
          }
        >
          应用到项目
        </button>
      </div>
      <JobLog job={remote.data?.job} />
    </>
  );
}
function ToolsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
      tools: { id: string; name: string; installed: boolean; version: string; required: boolean }[];
      job: JobView | null;
    }>(request, `/vms/${vm.id}/tools`, vm.status === 'running', 10000),
    action = useAction();
  const install = (tools: string[]) =>
    action.run(async (signal) => {
      await request(`/vms/${vm.id}/tools`, 'POST', { tools }, signal);
      remote.reload();
    });
  return (
    <>
      <Feedback error={action.error || remote.error} />
      {vm.status !== 'running' && stopped}
      <div className="feature-grid">
        {remote.data?.tools.map((tool) => (
          <div className="feature-card" key={tool.id}>
            <h4>{tool.name}</h4>
            <p className="subtle-note">
              {tool.required ? '项目需要 · ' : ''}
              {tool.installed ? '已安装' : '未安装'}
            </p>
            <pre className="tool-version">{tool.version || '—'}</pre>
            <button
              className="secondary compact"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() => void install([tool.id])}
            >
              {tool.installed ? '安装 / 更新' : '安装'}
            </button>
          </div>
        ))}
      </div>
      <p className="subtle-note">
        使用当前发行版的软件源安装；项目需求根据 package.json、go.mod 等文件识别。
      </p>
      <JobLog job={remote.data?.job} />
    </>
  );
}
const networkFields: [keyof NetworkProfile, string, string][] = [
  ['httpProxy', 'HTTP 代理', 'http://10.0.2.2:7890'],
  ['httpsProxy', 'HTTPS 代理', 'http://10.0.2.2:7890'],
  ['noProxy', '不使用代理的地址', 'localhost,127.0.0.1,::1'],
  ['npmRegistry', 'npm 仓库', 'https://registry.npmjs.org'],
  ['pipIndex', 'Python 包索引', 'https://pypi.org/simple'],
  ['apkMirror', 'Alpine 镜像根地址', 'https://dl-cdn.alpinelinux.org/alpine'],
  ['aptMirror', 'Debian / Ubuntu 软件源', ''],
  ['aptSecurityMirror', '安全更新软件源', ''],
];
function NetworkPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
      config: NetworkProfile;
      changes: NetworkChange[];
      appliedAt?: string;
      job: JobView | null;
    }>(request, `/vms/${vm.id}/network`),
    action = useAction();
  const [config, setConfig] = useState<NetworkProfile | null>(null),
    [preview, setPreview] = useState<{
      config: NetworkProfile;
      changes: NetworkChange[];
      token: string;
    } | null>(null);
  useEffect(() => {
    if (!config && remote.data) setConfig(remote.data.config);
  }, [config, remote.data]);
  const run = (kind: string) =>
    action.run(async (signal) => {
      const value = await request(
        `/vms/${vm.id}/network`,
        'POST',
        { action: kind, config, token: preview?.token },
        signal,
      );
      if (kind === 'preview') setPreview(value);
      else {
        setPreview(null);
        remote.reload();
      }
    });
  const applied = !!remote.data?.appliedAt || !!remote.data?.changes.length,
    busy = action.busy || vm.status !== 'running';
  return (
    <>
      <p className="subtle-note">
        预览后应用到此实例。代理和包仓库设置用于新的登录终端及 Sakura 项目任务；已有进程需重新启动。
      </p>
      {vm.status !== 'running' && stopped}
      <Feedback error={action.error || remote.error} />
      {config && (
        <div className="feature-grid">
          {networkFields
            .filter(([key]) =>
              (vm.distro || 'alpine') === 'alpine' ? !key.startsWith('apt') : key !== 'apkMirror',
            )
            .map(([key, label, placeholder]) => (
              <label key={key}>
                {label}
                <input
                  value={config[key]}
                  placeholder={placeholder}
                  disabled={applied || action.busy}
                  onChange={(e) => {
                    setConfig({ ...config, [key]: e.target.value });
                    setPreview(null);
                  }}
                />
              </label>
            ))}
        </div>
      )}
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={busy || !config || applied}
          onClick={() => void run('preview')}
        >
          预览修改
        </button>
        <button
          className="secondary compact"
          disabled={busy || !config || remote.data?.job?.status === 'running'}
          onClick={() => void run('test')}
        >
          测试连通性
        </button>
        {applied && (
          <button className="secondary compact" disabled={busy} onClick={() => void run('restore')}>
            恢复原配置
          </button>
        )}
      </div>
      {applied && (
        <p className="feature-success">
          {remote.data?.appliedAt ? '配置已应用' : '应用中断，可恢复原配置后重试'}
        </p>
      )}
      {preview && (
        <div className="feature-card">
          <h4>即将修改 {preview.changes.length} 个文件</h4>
          {preview.changes.map((change) => (
            <details key={change.path}>
              <summary>{change.path}</summary>
              <div className="feature-grid">
                <pre className="feature-log">{change.before ?? '原文件不存在'}</pre>
                <pre className="feature-log">{change.after}</pre>
              </div>
            </details>
          ))}
          <button className="primary compact" disabled={busy} onClick={() => void run('apply')}>
            应用以上修改
          </button>
        </div>
      )}
      <JobLog job={remote.data?.job} />
    </>
  );
}
function SecretsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ items: { name: string; updatedAt: string }[] }>(
      request,
      `/vms/${vm.id}/secrets`,
    ),
    action = useAction();
  const [name, setName] = useState(''),
    [value, setValue] = useState('');
  return (
    <>
      <p className="subtle-note">
        由当前 Windows 账户加密保护，保存后只显示名称。在项目和服务中以名称引用，备份密码也可使用这里的配置。
      </p>
      <Feedback error={action.error || remote.error} message={action.message} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async (signal) => {
            await request(`/vms/${vm.id}/secrets`, 'PUT', { name, value }, signal);
            setValue('');
            setName('');
            remote.reload();
          }, '私密配置已保存');
        }}
      >
        <div className="feature-grid">
          <label>
            配置名称
            <input
              required
              maxLength={60}
              pattern="[A-Za-z][A-Za-z0-9_-]*"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api-token"
            />
          </label>
          <label>
            私密值
            <input
              type="password"
              required
              autoComplete="new-password"
              maxLength={8192}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <button className="primary compact" disabled={action.busy}>
          保存私密配置
        </button>
      </form>
      {remote.data?.items.map((item) => (
        <div className="development-row" key={item.name}>
          <div>
            <b>{item.name}</b>
            <p className="subtle-note">更新于 {new Date(item.updatedAt).toLocaleString()}</p>
          </div>
          <div className="feature-actions">
            <button
              className="text-button"
              onClick={() => {
                setName(item.name);
                setValue('');
              }}
            >
              更新值
            </button>
            <button
              className="text-button danger-text"
              disabled={action.busy}
              onClick={() => {
                if (confirm(`删除私密配置 ${item.name}？引用它的任务将无法启动。`))
                  void action.run(async (signal) => {
                    await request(`/vms/${vm.id}/secrets`, 'DELETE', { name: item.name }, signal);
                    remote.reload();
                  });
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
export function SecretReferences({
  value,
  change,
}: {
  value?: Record<string, string>;
  change: (value: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState(() => Object.entries(value || {}));
  useEffect(() => {
    if (
      JSON.stringify(Object.fromEntries(rows.filter(([key, name]) => key && name))) !==
      JSON.stringify(value || {})
    )
      setRows(Object.entries(value || {}));
  }, [value]);
  const update = (next: [string, string][]) => {
    setRows(next);
    change(Object.fromEntries(next.filter(([key, name]) => key && name)));
  };
  return (
    <details className="feature-card">
      <summary>私密配置引用（{Object.keys(value || {}).length}）</summary>
      <p className="subtle-note">例如 TOKEN → api-token。右侧填写“开发设置 → 私密配置”中保存的名称。</p>
      {rows.map(([key, name], index) => (
        <div className="secret-reference" key={index}>
          <input
            aria-label={`环境变量名称 ${index + 1}`}
            value={key}
            placeholder="TOKEN"
            onChange={(e) => update(rows.map((row, i) => (i === index ? [e.target.value, name] : row)))}
          />
          <span>→</span>
          <input
            aria-label={`私密配置名称 ${index + 1}`}
            value={name}
            placeholder="api-token"
            onChange={(e) => update(rows.map((row, i) => (i === index ? [key, e.target.value] : row)))}
          />
          <button
            className="icon-button"
            aria-label={`移除引用 ${index + 1}`}
            onClick={() => update(rows.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        className="text-button"
        disabled={rows.length >= 32}
        onClick={() => setRows([...rows, ['', '']])}
      >
        添加引用
      </button>
    </details>
  );
}

export function HealthEditor({
  value,
  change,
}: {
  value?: ProjectService['health'];
  change: (value: ProjectService['health']) => void;
}) {
  return (
    <details className="feature-card" open={!!value}>
      <summary>持续健康检查</summary>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            change(
              e.target.checked
                ? {
                    command: '',
                    interval: 30,
                    timeout: 5,
                    failures: 3,
                    restart: false,
                    maxRestarts: 3,
                    backoff: 10,
                  }
                : undefined,
            )
          }
        />
        启用健康检查
      </label>
      {value && (
        <>
          <label>
            检查命令
            <input
              value={value.command}
              onChange={(e) => change({ ...value, command: e.target.value })}
              placeholder="curl -fsS http://127.0.0.1:3000/health"
            />
          </label>
          <div className="feature-grid">
            {(
              [
                ['interval', '检查间隔（秒）', 5, 3600],
                ['timeout', '检查超时（秒）', 1, 30],
                ['failures', '连续失败次数', 1, 10],
                ['maxRestarts', '自动重启上限', 0, 5],
                ['backoff', '退避基数（秒）', 5, 300],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={value[key]}
                  onChange={(e) => change({ ...value, [key]: +e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={value.restart}
              onChange={(e) => change({ ...value, restart: e.target.checked })}
            />
            异常时自动重启
          </label>
          <p className="subtle-note">
            失败达到阈值后按退避间隔重试；手动启动会重置次数，手动停止后不再自动重启。
          </p>
        </>
      )}
    </details>
  );
}
export function HealthPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ services: HealthView[]; job: JobView | null }>(
    request,
    `/vms/${vm.id}/health`,
    true,
    5000,
  );
  const labels = {
    waiting: '等待检查',
    healthy: '健康',
    unhealthy: '异常',
    restarting: '重启中',
    stopped: '未启用监控',
    exhausted: '重启次数已用尽',
  };
  return (
    <>
      <Feedback error={remote.error} />
      {!!remote.data?.services.length && (
        <div className="feature-card">
          <h4>服务健康状态</h4>
          {remote.data.services.map((service) => (
            <div className="development-row" key={service.name}>
              <b>{service.name}</b>
              <div>
                <span
                  className={`badge ${service.status === 'healthy' ? 'running' : ['unhealthy', 'exhausted'].includes(service.status) ? 'error' : ''}`}
                >
                  {labels[service.status]}
                </span>
                <p className="subtle-note">
                  连续失败 {service.failures} 次 · 自动重启 {service.restarts} 次
                  {service.checkedAt ? ` · ${new Date(service.checkedAt).toLocaleTimeString()}` : ''}
                </p>
                {service.error && <p className="danger-text">{service.error}</p>}
              </div>
            </div>
          ))}
          <JobLog job={remote.data.job} />
        </div>
      )}
    </>
  );
}

export function PresetRunner({
  preset,
  id,
  request,
  executed,
}: {
  preset: CommandPreset;
  id: string;
  request: Request;
  executed?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(preset.parameters.map((p) => [p.name, p.value])),
    ),
    action = useAction();
  return (
    <form
      className="feature-card"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async (signal) => {
          await request(`/vms/${id}/commands`, 'POST', { id: preset.id, values }, signal);
          executed?.();
        }, '命令已加入任务中心');
      }}
    >
      <h4>{preset.name}</h4>
      <pre className="feature-log">{preset.command}</pre>
      {preset.parameters.map((parameter) => (
        <label key={parameter.name}>
          {parameter.name}
          <input
            value={values[parameter.name] || ''}
            maxLength={4096}
            onChange={(e) => setValues({ ...values, [parameter.name]: e.target.value })}
          />
        </label>
      ))}
      <button className="primary compact" disabled={action.busy}>
        <Play size={14} />
        执行命令
      </button>
      <Feedback error={action.error} message={action.message} />
    </form>
  );
}
function CommandsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ projectId?: string; presets: CommandPreset[]; job: JobView | null }>(
      request,
      `/vms/${vm.id}/commands`,
      true,
      2500,
    ),
    action = useAction();
  const [name, setName] = useState(''),
    [command, setCommand] = useState(''),
    [parameters, setParameters] = useState(''),
    [selected, setSelected] = useState<CommandPreset | null>(null),
    [editing, setEditing] = useState<string | undefined>(),
    [loadedProject, setLoadedProject] = useState('');
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setSelected(null);
      setEditing(undefined);
      setName('');
      setCommand('');
      setParameters('');
    }
  }, [remote.data, loadedProject]);
  return (
    <>
      <p className="subtle-note">
        收藏命令可用 Ctrl / ⌘ + K 快速找到。参数以环境变量传入，在命令中使用 $NAME；执行记录保存在任务中心。
      </p>
      <Feedback error={action.error || remote.error} />
      <div className="feature-card">
        <h4>{editing ? '编辑收藏命令' : '收藏新命令'}</h4>
        <label>
          命令名称
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          命令
          <textarea
            rows={3}
            value={command}
            maxLength={8192}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={'npm run test -- "$TARGET"'}
          />
        </label>
        <label>
          参数默认值（每行 NAME=value）
          <textarea
            rows={2}
            value={parameters}
            onChange={(e) => setParameters(e.target.value)}
            placeholder="TARGET=unit"
          />
        </label>
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={action.busy || !name.trim() || !command.trim()}
            onClick={() =>
              void action.run(async (signal) => {
                const params = parameters
                  .split('\n')
                  .filter((row) => row.trim())
                  .map((row) => {
                    const index = row.indexOf('=');
                    return {
                      name: (index < 0 ? row : row.slice(0, index)).trim(),
                      value: index < 0 ? '' : row.slice(index + 1),
                    };
                  });
                await request(
                  `/vms/${vm.id}/commands`,
                  'PUT',
                  { id: editing, name, command, parameters: params },
                  signal,
                );
                setName('');
                setCommand('');
                setParameters('');
                setEditing(undefined);
                remote.reload();
              })
            }
          >
            <Save size={14} />
            保存收藏
          </button>
          {editing && (
            <button
              className="text-button"
              onClick={() => {
                setEditing(undefined);
                setName('');
                setCommand('');
                setParameters('');
              }}
            >
              取消编辑
            </button>
          )}
        </div>
      </div>
      {remote.data?.presets.map((preset) => (
        <div className="development-row" key={preset.id}>
          <b>{preset.name}</b>
          <div className="feature-actions">
            <button
              className="text-button"
              disabled={vm.status !== 'running' || remote.data?.job?.status === 'running'}
              onClick={() => setSelected(preset)}
            >
              填写参数并执行
            </button>
            <button
              className="text-button"
              onClick={() => {
                setEditing(preset.id);
                setName(preset.name);
                setCommand(preset.command);
                setParameters(preset.parameters.map((p) => `${p.name}=${p.value}`).join('\n'));
              }}
            >
              编辑
            </button>
            <button
              className="text-button danger-text"
              disabled={action.busy}
              onClick={() => {
                if (confirm(`删除收藏命令 ${preset.name}？`))
                  void action.run(async (signal) => {
                    await request(`/vms/${vm.id}/commands`, 'DELETE', { id: preset.id }, signal);
                    if (selected?.id === preset.id) setSelected(null);
                    remote.reload();
                  });
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      {selected && vm.status === 'running' && (
        <PresetRunner
          key={selected.id + selected.command}
          preset={selected}
          id={vm.id}
          request={request}
          executed={() => {
            setSelected(null);
            remote.reload();
          }}
        />
      )}
      <JobLog job={remote.data?.job} />
    </>
  );
}

type DockerItem = Record<string, string>;
export function ContainersPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
      supported: boolean;
      installed: boolean;
      available?: boolean;
      error?: string;
      version?: string;
      compose?: string;
      containers: DockerItem[];
      images: DockerItem[];
      volumes: DockerItem[];
      files: string[];
      job: JobView | null;
    }>(request, `/vms/${vm.id}/containers`, vm.status === 'running', 8000),
    action = useAction();
  const [image, setImage] = useState(''),
    [file, setFile] = useState('compose.yaml'),
    [logs, setLogs] = useState('');
  const output = useRemote<{ log: string }>(
    request,
    `/vms/${vm.id}/containers?logs=${encodeURIComponent(logs)}`,
    !!logs && vm.status === 'running',
  );
  const run = (value: unknown) =>
    action.run(async (signal) => {
      await request(`/vms/${vm.id}/containers`, 'POST', value, signal);
      remote.reload();
      output.reload();
    });
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Docker / Compose</h3>
          <p>管理此实例内的容器、镜像和项目。</p>
        </div>
        <button className="icon-button" aria-label="刷新容器" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={action.error || remote.error || output.error || remote.data?.error} />
      {vm.status !== 'running'
        ? stopped
        : remote.data && (
            <>
              {!remote.data.supported ? (
                <p className="subtle-note">容器面板支持 Debian 和 Ubuntu 实例。</p>
              ) : (
                <>
                  {!remote.data.available && (
                    <button
                      className="primary compact"
                      disabled={busy}
                      onClick={() => void run({ action: 'install' })}
                    >
                      安装并启动 Docker / Compose
                    </button>
                  )}
                  {remote.data.available && (
                    <>
                      <p className="subtle-note">
                        Docker {remote.data.version} · {remote.data.compose || 'Compose 未安装'}
                      </p>
                      <h4>容器</h4>
                      {!remote.data.containers.length && (
                        <p className="muted">暂无容器，可通过 Compose 创建。</p>
                      )}
                      {remote.data.containers.map((container) => (
                        <div className="feature-card" key={container.ID}>
                          <h4>{container.Names || container.ID}</h4>
                          <p>
                            {container.Image} · {container.Status}
                          </p>
                          <p className="subtle-note">{container.Ports}</p>
                          <div className="feature-actions">
                            {[
                              ['start', '启动'],
                              ['stop', '停止'],
                              ['restart', '重启'],
                              ['remove', '删除'],
                            ].map(([kind, label]) => (
                              <button
                                key={kind}
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    kind !== 'remove' ||
                                    confirm(`删除容器 ${container.Names}？容器内未持久化的数据会丢失。`)
                                  )
                                    void run({ action: kind, id: container.ID });
                                }}
                              >
                                {label}
                              </button>
                            ))}
                            <button className="text-button" onClick={() => setLogs(container.ID)}>
                              日志
                            </button>
                          </div>
                        </div>
                      ))}
                      {logs && (
                        <div className="feature-card">
                          <div className="panel-heading">
                            <h4>容器日志</h4>
                            <button className="text-button" onClick={() => setLogs('')}>
                              关闭
                            </button>
                          </div>
                          <pre className="feature-log">{output.data?.log || '暂无日志'}</pre>
                        </div>
                      )}
                      <div className="feature-card">
                        <h4>Compose 项目</h4>
                        <label>
                          项目内的 Compose 文件
                          <input
                            value={file}
                            onChange={(e) => setFile(e.target.value)}
                            list="compose-files"
                          />
                          <datalist id="compose-files">
                            {remote.data.files.map((name) => (
                              <option value={name} key={name} />
                            ))}
                          </datalist>
                        </label>
                        <div className="feature-actions">
                          {[
                            ['compose-up', '启动项目'],
                            ['compose-down', '停止并移除容器'],
                            ['compose-restart', '重启项目'],
                          ].map(([kind, label]) => (
                            <button
                              key={kind}
                              className="secondary compact"
                              disabled={busy || !file}
                              onClick={() => {
                                if (
                                  kind !== 'compose-down' ||
                                  confirm('停止此 Compose 项目并移除容器？命名卷会保留。')
                                )
                                  void run({ action: kind, file });
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="feature-card">
                        <h4>镜像</h4>
                        <label>
                          拉取镜像
                          <input
                            value={image}
                            onChange={(e) => setImage(e.target.value)}
                            placeholder="nginx:alpine"
                          />
                        </label>
                        <button
                          className="secondary compact"
                          disabled={busy || !image.trim()}
                          onClick={() => void run({ action: 'pull', image: image.trim() })}
                        >
                          <Download size={14} />
                          拉取
                        </button>
                        {remote.data.images.map((item, index) => (
                          <div className="development-row" key={`${item.ID}-${index}`}>
                            <span>
                              {item.Repository}:{item.Tag} · {item.Size}
                            </span>
                            <button
                              className="text-button danger-text"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`删除镜像 ${item.Repository}:${item.Tag}？`))
                                  void run({
                                    action: 'remove-image',
                                    image:
                                      item.Repository === '<none>' || item.Tag === '<none>'
                                        ? item.ID
                                        : `${item.Repository}:${item.Tag}`,
                                  });
                              }}
                            >
                              删除镜像
                            </button>
                          </div>
                        ))}
                      </div>
                      <details className="feature-card">
                        <summary>数据卷（{remote.data.volumes.length}）</summary>
                        {remote.data.volumes.map((volume) => (
                          <p key={volume.Name}>
                            {volume.Name} · {volume.Driver}
                          </p>
                        ))}
                      </details>
                    </>
                  )}
                </>
              )}
              <JobLog job={remote.data.job} />
            </>
          )}
    </div>
  );
}

export function MigrationPanel({ request }: { request: Request }) {
  const remote = useRemote<{
      source: string;
      target?: string;
      restartRequired: boolean;
      blocked: boolean;
      job: JobView | null;
    }>(request, '/migration', true, 2500),
    action = useAction();
  const [target, setTarget] = useState(''),
    [plan, setPlan] = useState<{
      source: string;
      target: string;
      bytes: number;
      available: number;
      count: number;
      token: string;
    } | null>(null);
  const busy = action.busy || remote.data?.blocked;
  return (
    <div className="content-panel feature-panel migration-panel">
      <h3>数据目录迁移</h3>
      <p className="subtle-note">
        将实例、镜像、快照与本地备份复制到新磁盘并逐项校验。请先停止全部实例并等待任务结束；完成后重启 Sakura
        生效，原目录保留。
      </p>
      <p>
        当前目录：<code className="wrap-path">{remote.data?.source || '读取中…'}</code>
      </p>
      <Feedback error={action.error || remote.error} />
      <label>
        目标新目录
        <input
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value);
            setPlan(null);
          }}
          placeholder="E:\SakuraData"
        />
      </label>
      <button
        className="secondary compact"
        disabled={busy || !target.trim()}
        onClick={() =>
          void action.run(async (signal) => {
            setPlan(await request('/migration', 'POST', { action: 'preview', target }, signal));
          })
        }
      >
        检查空间与预览
      </button>
      {plan && !remote.data?.blocked && (
        <div className="feature-card">
          <p className="wrap-path">
            {plan.source} → {plan.target}
          </p>
          <p>
            {plan.count} 个文件 · 需复制 {formatBytes(plan.bytes)} · 可用 {formatBytes(plan.available)}
          </p>
          <button
            className="primary compact"
            disabled={busy}
            onClick={() =>
              void action.run(async (signal) => {
                await request(
                  '/migration',
                  'POST',
                  { action: 'start', target: plan.target, token: plan.token },
                  signal,
                );
                setPlan(null);
                remote.reload();
              })
            }
          >
            开始停机迁移
          </button>
        </div>
      )}
      {remote.data?.job?.status === 'running' && (
        <div className="feature-actions">
          <progress max={100} value={remote.data.job.progress || 0} />
          <span>{remote.data.job.phase}</span>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => void action.run(() => request(`/jobs/${remote.data!.job!.id}/cancel`, 'POST'))}
          >
            取消迁移
          </button>
        </div>
      )}
      {remote.data?.restartRequired && (
        <div className="feature-card">
          <p className="feature-success">迁移完成。请重新启动 Sakura 服务使用新目录。</p>
          <code className="wrap-path">{remote.data.target}</code>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async (signal) => {
                await request('/migration', 'POST', { action: 'cancel-activation' }, signal);
                remote.reload();
              })
            }
          >
            继续使用原目录
          </button>
        </div>
      )}
      <JobLog job={remote.data?.job} />
    </div>
  );
}
