import { ClipboardList, Inbox } from 'lucide-react';
import { useState } from 'react';
import type { JobView } from '../server/jobs';
import type { VMView } from '../server/model';
import type { Request } from './feature-shared';
import { Feedback, useAction, useRemote } from './feature-shared';
import './features.css';

export const taskLabels = {
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
