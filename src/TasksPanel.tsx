/**
 * 模块职责（中文）：展示控制面任务列表、执行详情与日志，提供取消、重试和刷新入口。
 * Module responsibility (English): Presenting job details and providing cancellation, retry and refresh actions.
 * 详细范围（中文）：公开入口包括 TasksPanel；职责覆盖显示任务详情并提供取消、重试和刷新，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TasksPanel. The scope covers Presenting job details and providing cancellation, retry and refresh actions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from './localization';
import { ClipboardList, Inbox, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { VMView } from '../shared/contracts/vm.ts';
import type { Request } from './feature-shared';
import { Feedback, useAction, useRemote } from './feature-shared';
import './features.css';
import './tasks-panel.css';
import { jobPresentation, taskLabels } from './job-presentation';
import { TaskEvidencePanel } from './TaskEvidencePanel';
import { usePlugins } from './plugin-context';
export { taskLabels } from './job-presentation';

/**
 * 中文：呈现显示任务详情并提供取消、重试和刷新中的 TasksPanel 界面，订阅 /jobs、/events，组合 ClipboardList、Inbox，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the TasksPanel surface for Presenting job details and providing cancellation, retry and refresh actions, subscribing to /jobs, /events and composing ClipboardList, Inbox. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request, vms } 提供 request（带身份和权限作用域的传输能力）、vms（vms 状态） 上下文字段
 * English: Inputs: { request, vms } provides context fields request (transport capability bound to identity/authority scope), vms (vms state)
 */
export function TasksPanel({ request, vms, onDiagnose }: { request: Request; vms: VMView[]; onDiagnose?: (vmId: string) => void }) {
  const plugins = usePlugins();
  const [evidenceId, setEvidenceId] = useState<string>();
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
      (job) => (filter === 'all' || jobPresentation(job).state === filter) && (machine === 'all' || job.vmId === machine),
    ) || [];
  const hasFilters = filter !== 'all' || machine !== 'all';
  const statusLabel = { all: '全部状态', queued: '等待资源', cancelling: '正在取消',
    'cleanup-pending': '清理待确认', ...taskLabels }[filter as keyof typeof taskLabels | 'all' | 'queued' | 'cancelling' | 'cleanup-pending'];
  const machineLabel = machine === 'all' ? '全部发行版' : vms.find(vm => vm.id === machine)?.name || '已移除的发行版';
  const clearFilters = () => { setFilter('all'); setMachine('all'); };
  const taskStatus = remote.error
    ? { tone: 'error', label: '暂时离线' }
    : remote.data
      ? { tone: 'running', label: '实时更新' }
      : { tone: 'starting', label: '正在连接' };
  return (
    <div className="content-panel feature-panel management-page tasks-panel">
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
            <option value="queued">等待资源</option>
            <option value="cancelling">正在取消</option>
            <option value="cleanup-pending">清理待确认</option>
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
      {remote.data && <div className="tasks-result-context">
        <p role="status" aria-live="polite">显示 <strong>{jobs.length}</strong> / {remote.data.jobs.length} 项任务</p>
        {hasFilters && <>
          <span className="tasks-filter-scope">{statusLabel} · {machineLabel}</span>
          <button className="text-button" type="button" onClick={clearFilters}><X size={14} />清除筛选</button>
        </>}
      </div>}
      <Feedback error={action.error || remote.error || remote.data?.warnings.join('；')} />
      {remote.error && <button className="secondary compact tasks-reload" type="button" onClick={remote.reload}>
        <RefreshCw size={14} />重新读取任务
      </button>}
      {events.data?.events.length ? (
        <details className="feature-card">
          <summary>需要关注的事件（{events.data.events.length}）</summary>
          {events.data.events.slice(0, 20).map((event, index) => (
            <p className="subtle-note" key={`${event.at}-${index}`}>
              {formatDateTime(new Date(event.at))} · {event.title || '后台任务'} ·{' '}
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
          <h3>{hasFilters ? '没有符合筛选条件的任务' : '暂无任务记录'}</h3>
          <p>{hasFilters ? '试试其他任务状态或发行版，也可以查看全部任务。' : '启动、同步或维护实例后，后台任务会显示在这里。'}</p>
          {hasFilters && <button className="secondary compact" type="button" onClick={clearFilters}>查看全部任务</button>}
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
            {job.title || '后台操作'} · {jobPresentation(job).label} ·{' '}
            {vms.find((vm) => vm.id === job.vmId)?.name || '系统'}
          </summary>
          <p className="subtle-note">
            {formatDateTime(new Date(job.startedAt))} · 耗时{' '}
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
          {jobPresentation(job).detail && <p className="subtle-note">{jobPresentation(job).detail}</p>}
          {job.status === 'running' && job.admission !== 'queued' && <progress aria-label="任务进度" max={100} value={job.progress} />}
          <Feedback error={job.error} />
          <pre className="feature-log">
            {job.log ||
              (job.logPruned
                ? `日志已按保留策略清理（${formatDateTime(new Date(job.logPruned.at))}）`
                : job.status === 'running'
                  ? '等待任务输出…'
                  : '任务没有日志输出。')}
          </pre>
          <div className="feature-actions">
            <button className="secondary compact" onClick={() => setEvidenceId(job.id)}>查看证据与处理</button>
            {job.status === 'running' && (
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(/** 中文：提交 POST /jobs/{job.id}/cancel，完成显示任务详情并提供取消、重试和刷新的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /jobs/{job.id}/cancel for Presenting job details and providing cancellation, retry and refresh actions. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                    await request(`/jobs/${job.id}/cancel`, 'POST', undefined, signal);
                    signal.throwIfAborted();
                    remote.reload();
                  })
                }
              >
                取消任务
              </button>
            )}
            {jobPresentation(job).retryable && job.action && (
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(/** 中文：提交 POST /jobs/{job.id}/retry，完成显示任务详情并提供取消、重试和刷新的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /jobs/{job.id}/retry for Presenting job details and providing cancellation, retry and refresh actions. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                    const result = await request(`/jobs/${job.id}/retry`, 'POST', undefined, signal);
                    signal.throwIfAborted();
                    if (result && typeof result === 'object' && 'url' in result && typeof result.url === 'string' &&
                      /^\/api\/downloads\/[a-f0-9]{64}$/.test(result.url)) {
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
          {evidenceId === job.id && <TaskEvidencePanel key={job.id} request={request} job={job}
            onClose={() => setEvidenceId(undefined)}
            onDiagnose={job.vmId && plugins.includes('maintenance') && vms.some(vm => vm.id === job.vmId)
              && onDiagnose ? () => onDiagnose(job.vmId!) : undefined} />}
        </details>
      ))}
    </div>
  );
}
