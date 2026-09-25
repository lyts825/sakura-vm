import { useState } from 'react';
import { Shield, Plus, Play, Square, Trash2, Clock, TerminalSquare } from 'lucide-react';
import type { PluginPageProps } from '../../src/plugin-client';
import type { SandboxOverview, SandboxView } from '../../server/sandboxes';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import './sandbox.css';

const presets = {
  light: { label: '轻量实验', memoryMiB: 512, cpus: 1, diskGiB: 4 },
  standard: { label: '脚本与测试', memoryMiB: 1024, cpus: 2, diskGiB: 8 },
  large: { label: '构建任务', memoryMiB: 2048, cpus: 4, diskGiB: 16 },
};
const statusLabels = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  paused: '已暂停',
  stopping: '停止中',
  error: '异常',
};
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export function SandboxPage({ request, refresh }: PluginPageProps) {
  const remote = useRemote<SandboxOverview>(request, '/sandboxes', true, 1500);
  const creation = useAction(),
    action = useAction();
  const [name, setName] = useState('');
  const [distro, setDistro] = useState('alpine');
  const [resources, setResources] = useState({ memoryMiB: 512, cpus: 1, diskGiB: 4 });
  const [network, setNetwork] = useState<'isolated' | 'nat'>('isolated');
  const [lifetimeMinutes, setLifetime] = useState(60);
  const [onExpire, setOnExpire] = useState<'delete' | 'stop'>('delete');
  const [selected, setSelected] = useState('');
  const [command, setCommand] = useState('uname -a\npwd');
  const [cwd, setCwd] = useState('/workspace');
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [logId, setLogId] = useState('');
  const vms = remote.data?.sandboxes || [],
    runs = remote.data?.runs || [];
  const vm = vms.find((item) => item.id === selected) || vms[0];
  const runningJob = vm && runs.find((job) => job.vmId === vm.id && job.status === 'running');
  const job = runs.find((item) => item.id === logId) || runs.find((item) => item.vmId === vm?.id) || runs[0];
  const reload = async () => {
    remote.reload();
    await refresh();
  };
  const control = (target: SandboxView, verb: 'start' | 'stop' | 'destroy') => {
    if (
      verb === 'destroy' &&
      !confirm('销毁沙箱 ' + target.name + '？磁盘和其中的文件将被删除，执行记录保留。')
    )
      return;
    void action.run(
      async (signal) => {
        await request(
          '/vms/' + target.id + '/sandbox',
          verb === 'destroy' ? 'DELETE' : 'POST',
          verb === 'destroy' ? undefined : { action: verb },
          signal,
        );
        await reload();
      },
      verb === 'destroy' ? '沙箱已销毁' : verb === 'stop' ? '沙箱已停止' : '沙箱正在启动',
    );
  };
  return (
    <section className="feature-panel management-page sandbox-page">
      <header className="sandbox-heading">
        <div className="sandbox-emblem">
          <Shield size={26} />
        </div>
        <div>
          <h2>沙箱工作台</h2>
          <p className="subtle-note">独立 Linux 环境，用于临时实验、脚本与测试。</p>
        </div>
        <span className="sandbox-count">
          {vms.length} 个环境 · {vms.filter((item) => item.poweredOn).length} 个运行中
        </span>
      </header>
      <Feedback error={remote.error || remote.data?.persistenceError} />
      <div className="sandbox-layout">
        <form
          className="feature-card sandbox-create"
          onSubmit={(event) => {
            event.preventDefault();
            void creation.run(async (signal) => {
              const created = await request<SandboxView>(
                '/sandboxes',
                'POST',
                { name, distro, ...resources, network, lifetimeMinutes, onExpire },
                signal,
              );
              setSelected(created.id);
              setName('');
              setLogId('');
              await reload();
            }, '沙箱已创建，执行命令时会自动启动');
          }}
        >
          <h3>
            <Plus size={18} /> 创建沙箱
          </h3>
          <label>
            沙箱名称
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sandbox-demo"
              maxLength={32}
              pattern="[a-z][a-z0-9-]*"
            />
          </label>
          <label>
            发行版
            <select
              value={distro}
              onChange={(e) => {
                const value = e.target.value;
                setDistro(value);
                if (value !== 'alpine')
                  setResources((previous) => ({
                    ...previous,
                    memoryMiB: Math.max(1024, previous.memoryMiB),
                    diskGiB: Math.max(8, previous.diskGiB),
                  }));
              }}
            >
              <option value="alpine">Alpine 3.23</option>
              <option value="debian">Debian 12</option>
              <option value="ubuntu">Ubuntu 24.04</option>
            </select>
          </label>
          <div className="sandbox-presets" aria-label="资源预设">
            {Object.entries(presets).map(([key, preset]) => (
              <button
                type="button"
                key={key}
                className="text-button"
                onClick={() =>
                  setResources({
                    memoryMiB: distro === 'alpine' ? preset.memoryMiB : Math.max(1024, preset.memoryMiB),
                    cpus: preset.cpus,
                    diskGiB: distro === 'alpine' ? preset.diskGiB : Math.max(8, preset.diskGiB),
                  })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="sandbox-resources">
            <label>
              CPU 核数
              <input
                type="number"
                required
                min={1}
                max={4}
                value={resources.cpus}
                onChange={(e) => setResources({ ...resources, cpus: Number(e.target.value) })}
              />
            </label>
            <label>
              内存 MiB
              <input
                type="number"
                required
                min={distro === 'alpine' ? 256 : 1024}
                max={4096}
                value={resources.memoryMiB}
                onChange={(e) => setResources({ ...resources, memoryMiB: Number(e.target.value) })}
              />
            </label>
            <label>
              磁盘 GiB
              <input
                type="number"
                required
                min={distro === 'alpine' ? 2 : 8}
                max={32}
                value={resources.diskGiB}
                onChange={(e) => setResources({ ...resources, diskGiB: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            网络策略
            <select value={network} onChange={(e) => setNetwork(e.target.value as typeof network)}>
              <option value="isolated">隔离网络（默认）</option>
              <option value="nat">允许联网（NAT）</option>
            </select>
          </label>
          <p className="subtle-note">
            {network === 'isolated'
              ? '阻止访问宿主机和外部网络，保留 Sakura 管理连接。适合离线命令。'
              : '允许访问互联网和宿主机可达的网络。安装依赖时可选，不提供网络访问隔离。'}
          </p>
          <div className="feature-grid compact-grid">
            <label>
              存活时间（分钟）
              <input
                type="number"
                required
                min={5}
                max={1440}
                value={lifetimeMinutes}
                onChange={(e) => setLifetime(Number(e.target.value))}
              />
            </label>
            <label>
              到期处理
              <select value={onExpire} onChange={(e) => setOnExpire(e.target.value as typeof onExpire)}>
                <option value="delete">停止并销毁磁盘</option>
                <option value="stop">停止并保留磁盘</option>
              </select>
            </label>
          </div>
          <p className="subtle-note">期限从创建时开始计算。到期后不能重新启动；资源与网络策略创建后固定。</p>
          <button className="primary" disabled={creation.busy}>
            <Plus size={16} />
            {creation.busy ? '正在创建…' : '创建沙箱'}
          </button>
          <Feedback error={creation.error} message={creation.message} />
        </form>
        <div className="feature-panel sandbox-workspace">
          <section className="feature-card">
            <h3>
              <Shield size={18} /> 沙箱环境
            </h3>
            {!remote.data && !remote.error && (
              <p className="subtle-note" role="status">
                正在加载沙箱…
              </p>
            )}
            {remote.data && !vms.length && (
              <div className="sandbox-empty">
                <Shield size={32} />
                <h4>还没有沙箱</h4>
                <p>创建一个临时环境，磁盘和密钥均独立于现有工作空间。</p>
              </div>
            )}
            {vms.map((item) => (
              <div className={'sandbox-row' + (vm?.id === item.id ? ' selected' : '')} key={item.id}>
                <button
                  className="sandbox-select"
                  aria-pressed={vm?.id === item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setLogId('');
                    action.clear();
                  }}
                >
                  <span>
                    <b>{item.name}</b>
                    <span className={'badge ' + (item.expired ? 'error' : item.status)}>
                      {item.expired ? '已到期' : statusLabels[item.status]}
                    </span>
                  </span>
                  <small>
                    {item.cpus} 核 · {item.memoryMiB} MiB · {item.diskGiB} GiB ·{' '}
                    {item.sandbox.network === 'isolated' ? '隔离网络' : '允许联网'}
                  </small>
                  <small>
                    <Clock size={12} /> {date(item.sandbox.expiresAt)}{' '}
                    {item.sandbox.onExpire === 'delete' ? '自动销毁' : '到期停止'}
                  </small>
                </button>
                <div className="feature-actions">
                  <button
                    className="text-button"
                    aria-label={'启动 ' + item.name}
                    disabled={
                      action.busy ||
                      item.poweredOn ||
                      item.expired ||
                      runs.some((run) => run.vmId === item.id && run.status === 'running')
                    }
                    onClick={() => control(item, 'start')}
                  >
                    <Play size={14} /> 启动
                  </button>
                  <button
                    className="text-button"
                    aria-label={'停止 ' + item.name}
                    disabled={
                      action.busy ||
                      (!item.poweredOn &&
                        !runs.some((run) => run.vmId === item.id && run.status === 'running'))
                    }
                    onClick={() => control(item, 'stop')}
                  >
                    <Square size={14} /> 停止
                  </button>
                  <button
                    className="text-button danger-text"
                    aria-label={'销毁 ' + item.name}
                    disabled={action.busy}
                    onClick={() => control(item, 'destroy')}
                  >
                    <Trash2 size={14} /> 销毁
                  </button>
                </div>
                <Feedback error={item.lastError} />
              </div>
            ))}
          </section>
          {vm && (
            <form
              className="feature-card"
              onSubmit={(event) => {
                event.preventDefault();
                void action.run(async (signal) => {
                  const result = await request<{ id: string }>(
                    '/vms/' + vm.id + '/sandbox/run',
                    'POST',
                    { command, cwd, timeoutSeconds },
                    signal,
                  );
                  setLogId(result.id);
                  await reload();
                }, '命令已提交，可在下方查看输出');
              }}
            >
              <h3>
                <TerminalSquare size={18} /> 在 {vm.name} 中执行
              </h3>
              <label>
                Linux 命令
                <textarea
                  rows={4}
                  required
                  maxLength={8192}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <div className="feature-grid compact-grid">
                <label>
                  工作目录
                  <input
                    required
                    value={cwd}
                    maxLength={4096}
                    pattern="/.*"
                    onChange={(e) => setCwd(e.target.value)}
                  />
                </label>
                <label>
                  命令超时（秒）
                  <input
                    required
                    type="number"
                    min={1}
                    max={3600}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="subtle-note">
                以沙箱内的 root
                用户执行；需要时自动启动。命令结束、超时或取消后，整台沙箱关闭，后台进程一并终止。
              </p>
              <div className="feature-actions">
                <button
                  className="primary compact"
                  disabled={
                    action.busy || !!runningJob || vm.expired || ['paused', 'stopping'].includes(vm.status)
                  }
                >
                  <Play size={15} /> 执行命令
                </button>
                {runningJob && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={action.busy}
                    onClick={() => control(vm, 'stop')}
                  >
                    <Square size={14} /> 取消执行
                  </button>
                )}
              </div>
            </form>
          )}
          <Feedback error={action.error} message={action.message} />
          <section className="feature-card">
            <h3>执行记录</h3>
            {runs.length ? (
              <>
                <label>
                  查看记录
                  <select value={job?.id || ''} onChange={(e) => setLogId(e.target.value)}>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.title} · {date(run.startedAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <JobLog job={job} />
              </>
            ) : (
              <p className="subtle-note">执行后显示退出状态和输出；销毁环境后仍保留最近 200 条记录。</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

export const pages = { sandbox: SandboxPage };
