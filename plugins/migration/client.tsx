import { useState } from 'react';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { Request } from '../../src/feature-shared';
import { Feedback, formatBytes, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

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
