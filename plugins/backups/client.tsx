import { useEffect, useState } from 'react';
import type { BackupPolicy, BackupRecord } from '../../server/backups';
import type { JobView } from '../../server/jobs';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, formatBytes, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function BackupPanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<{
    policy: BackupPolicy;
    items: BackupRecord[];
    bytes: number;
    job: JobView | null;
    waitingForShutdown: boolean;
    maintenance?: boolean;
  }>(request, `/vms/${vm.id}/backups`, true, 2500);
  const [policy, setPolicy] = useState<BackupPolicy | null>(null),
    action = useAction();
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (!policy && remote.data) setPolicy(remote.data.policy);
  }, [policy, remote.data]);
  const run = (kind: string, backupId?: string, name?: string) =>
    action.run(async () => {
      await request(`/vms/${vm.id}/backups`, 'POST', {
        action: kind,
        backupId,
        name,
        password: password || undefined,
      });
      setPassword('');
      remote.reload();
      await refresh();
    });
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="feature-card">
      <h3>备份与加密导出</h3>
      <p className="subtle-note">按周期生成独立备份包。实例运行时延后到关机；恢复会创建新实例。</p>
      {policy && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
            />
            启用自动备份
          </label>
          <div className="feature-grid">
            <label>
              间隔（小时）
              <input
                type="number"
                min={1}
                max={720}
                value={policy.intervalHours}
                onChange={(e) => setPolicy({ ...policy, intervalHours: +e.target.value })}
              />
            </label>
            <label>
              最多保留份数
              <input
                type="number"
                min={1}
                max={30}
                value={policy.keep}
                onChange={(e) => setPolicy({ ...policy, keep: +e.target.value })}
              />
            </label>
            <label>
              总容量上限（GiB）
              <input
                type="number"
                min={1}
                max={512}
                value={policy.maxGiB}
                onChange={(e) => setPolicy({ ...policy, maxGiB: +e.target.value })}
              />
            </label>
            <label>
              外部备份目录（可选）
              <input
                value={policy.directory || ''}
                onChange={(e) => setPolicy({ ...policy, directory: e.target.value || undefined })}
                placeholder="E:\SakuraBackups"
              />
            </label>
            <label>
              新备份保留锁（天，0 表示不锁定）
              <input
                type="number"
                min={0}
                max={3650}
                value={policy.lockDays || 0}
                onChange={(event) => setPolicy({ ...policy, lockDays: +event.target.value })}
              />
            </label>
            <label>
              备份输出限速（MiB/s，0 表示不限）
              <input
                type="number"
                min={0}
                max={10240}
                step={0.1}
                value={policy.bandwidthMiBps || 0}
                onChange={(event) => setPolicy({ ...policy, bandwidthMiBps: +event.target.value })}
              />
            </label>
            <label>
              自动加密密码引用（可选）
              <input
                value={policy.passwordSecret || ''}
                onChange={(e) => setPolicy({ ...policy, passwordSecret: e.target.value || undefined })}
                placeholder="backup-password"
              />
            </label>
          </div>
          <p className="subtle-note">
            加密密码引用来自“开发 → 私密配置”，至少 10 个字符。保留锁仅影响新备份，到期前禁止通过 Sakura
            删除或自动清理；修改策略不会缩短已有锁定期。
          </p>
          <label>
            本次加密 / 解密密码（可选）
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={1024}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="留空时使用备份的密码引用"
            />
          </label>
          <div className="feature-actions">
            <button
              className="secondary compact"
              disabled={busy}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/backups`, 'PUT', policy);
                  remote.reload();
                }, '备份策略已保存')
              }
            >
              保存策略
            </button>
            <button
              className="primary compact"
              disabled={busy || vm.poweredOn}
              onClick={() => void run('run')}
            >
              立即备份
            </button>
          </div>
        </>
      )}
      {remote.data?.waitingForShutdown && <p className="subtle-note">计划备份将在实例停止后检查并执行。</p>}
      {remote.data?.maintenance && <p className="subtle-note">当前处于维护窗口，暂停启动自动备份。</p>}
      <p>已用 {formatBytes(remote.data?.bytes || 0)}</p>
      {remote.data?.items.map((item) => (
        <div className="backup-row" key={item.id}>
          <div>
            <b>{new Date(item.createdAt).toLocaleString()}</b>
            <p className="subtle-note">
              {item.encrypted ? '已加密 · ' : ''}
              {formatBytes(item.bytes)} · {item.error || (item.verifiedAt ? '已通过校验' : '待校验')}
            </p>
            {item.directory && <p className="subtle-note wrap-path">{item.directory}</p>}
            {item.retainUntil && (
              <p className="subtle-note">保留锁到期：{new Date(item.retainUntil).toLocaleString()}</p>
            )}
          </div>
          <div className="feature-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action.run(async (signal) => {
                  const { url } = await request(
                    `/vms/${vm.id}/backup-download`,
                    'POST',
                    { backupId: item.id },
                    signal,
                  );
                  if (!/^\/api\/downloads\/[a-f0-9]{64}$/.test(url)) throw new Error('无效的下载地址');
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = '';
                  link.referrerPolicy = 'no-referrer';
                  document.body.append(link);
                  link.click();
                  link.remove();
                }, '下载已开始')
              }
            >
              下载
            </button>
            <button className="text-button" disabled={busy} onClick={() => void run('verify', item.id)}>
              校验
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                const name = prompt('恢复为新实例，输入名称', `${vm.name.slice(0, 23)}-restore`);
                if (name) void run('restore', item.id, name);
              }}
            >
              恢复
            </button>
            <button
              className="text-button danger-text"
              disabled={busy || (!!item.retainUntil && Date.parse(item.retainUntil) > Date.now())}
              onClick={() => {
                if (confirm('删除这份备份？')) void run('delete', item.id);
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      <Feedback error={action.error || remote.error} message={action.message} />
      <JobLog job={remote.data?.job} />
    </div>
  );
}
