import { useEffect, useState } from 'react';
import type { LogRetentionPolicy, LogRetentionPreview, LogRetentionView } from '../shared/log-retention';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

const bytes = (n: number) => `${(n / 1024 ** 2).toFixed(2)} MiB`;
export function LogRetentionSettings({ request }: { request: Request }) {
  const remote = useRemote<LogRetentionView>(request, '/log-retention', true, 0);
  const action = useAction();
  const [policy, setPolicy] = useState<LogRetentionPolicy>({ enabled: false, days: 30, maxMiB: 64 });
  const [preview, setPreview] = useState<LogRetentionPreview | null>(null);
  const [saved, setSaved] = useState<LogRetentionView | null>(null);
  useEffect(() => {
    if (remote.data) {
      setPolicy(remote.data.policy);
      setSaved(remote.data);
      setPreview(null);
    }
  }, [remote.data]);
  const change = (value: Partial<LogRetentionPolicy>) => {
    setPolicy({ ...policy, ...value });
    setPreview(null);
    action.clear();
  };
  const valid =
    Number.isInteger(policy.days) &&
    policy.days >= 1 &&
    policy.days <= 3650 &&
    Number.isInteger(policy.maxMiB) &&
    policy.maxMiB >= 1 &&
    policy.maxMiB <= 1024;
  return (
    <section className="system-card log-retention" aria-label="任务日志保留设置">
      <h3>任务日志保留</h3>
      <p className="subtle-note">
        按完成时间清理已启用插件的任务日志正文，先删除到期日志，再按从旧到新满足总容量。启用后每分钟检查一次；清理后无法恢复原日志。
      </p>
      <p className="subtle-note">
        任务状态、错误摘要、结果文件、审计记录和客户机日志各自保留。容量仅计算已结束任务的日志正文，不是整个数据目录的配额。禁用插件的历史在再次启用后处理。
      </p>
      <fieldset disabled={action.busy || !saved}>
        <label className="check">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          自动清理任务日志
        </label>
        <div className="shortcut-fields">
          <label>
            日志保留天数
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              value={policy.days || ''}
              onChange={(e) => change({ days: Number(e.target.value) })}
            />
          </label>
          <label>
            任务日志容量（MiB）
            <input
              type="number"
              min={1}
              max={1024}
              step={1}
              value={policy.maxMiB || ''}
              onChange={(e) => change({ maxMiB: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            className="secondary compact"
            disabled={!valid}
            onClick={() =>
              void action.run(async (signal) => {
                setPreview(null);
                const value = await request<LogRetentionPreview>(
                  '/log-retention',
                  'POST',
                  { action: 'preview', policy },
                  signal,
                );
                if (!signal.aborted) setPreview(value);
              })
            }
          >
            预览日志清理
          </button>
          <button
            className="secondary compact"
            disabled={!preview || !valid}
            onClick={() =>
              void action.run(
                async (signal) => {
                  const token = preview!.token;
                  setPreview(null);
                  try {
                    const value = await request<LogRetentionView>(
                      '/log-retention',
                      'POST',
                      { action: 'save', policy, token },
                      signal,
                    );
                    if (!signal.aborted) {
                      setSaved(value);
                      setPolicy(value.policy);
                    }
                  } catch (error) {
                    // A response can be lost after the policy was saved. Read back without replaying the write.
                    const current = await request<LogRetentionView>(
                      '/log-retention',
                      'GET',
                      undefined,
                      signal,
                    ).catch(() => null);
                    if (!signal.aborted) setSaved(current);
                    throw error;
                  }
                },
                policy.enabled ? '策略已保存并应用' : '自动清理已停用',
              )
            }
          >
            {policy.enabled ? '保存策略并清理' : '保存停用策略'}
          </button>
        </div>
      </fieldset>
      <Feedback error={action.error || remote.error || saved?.warning} message={action.message} />
      {preview && (
        <p role="status">
          预览：将清理 {preview.removeLogs} 份日志（{bytes(preview.removeBytes)}），其中 {preview.expiredLogs}{' '}
          份到期、{preview.capacityLogs} 份超过容量。保留 {bytes(preview.remainingBytes)}；保护{' '}
          {preview.protectedLogs} 份运行中或时间异常的日志。
        </p>
      )}
      {saved && (
        <p className="subtle-note">
          当前覆盖 {saved.summary.stores} 个任务存储，已结束日志 {bytes(saved.summary.completedBytes)}
          ，受保护日志 {bytes(saved.summary.protectedBytes)}。
          {saved.policy.enabled ? '自动清理已启用。' : '自动清理未启用。'}
        </p>
      )}
      {saved?.lastRun && (
        <p className="subtle-note">
          上次清理：{new Date(saved.lastRun.at).toLocaleString()}，清理 {saved.lastRun.removedLogs} 份（
          {bytes(saved.lastRun.removedBytes)}）。
        </p>
      )}
      <button className="text-button" disabled={action.busy} onClick={remote.reload}>
        重新读取已保存策略
      </button>
    </section>
  );
}
