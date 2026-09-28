import { formatDateTime } from '../../src/localization';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobView } from '../../server/jobs';
import type { DiagnosticCheck } from '../../server/maintenance';
import type { DiskMaintenancePolicy, DiskMaintenanceState } from '../../server/disk-maintenance';
import { saveText } from '../../src/export-file';
import type { FeatureProps, Request } from '../../src/feature-shared';
import { Feedback, formatBytes, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function StoragePanel({ request }: { request: Request }) {
  const remote = useRemote<{
    total: number;
    available: number;
    backupBytes: number;
    deduplicatedBackups?: { physicalBytes: number; savedBytes: number; orphanBytes: number };
    warning: string;
    images: { id: string; name: string; bytes: number }[];
    machines: { id: string; name: string; bytes: number; snapshots: number }[];
  }>(request, '/storage');
  return (
    <div className="feature-card">
      <h3>空间管理</h3>
      <Feedback error={remote.error || remote.data?.warning} />
      {remote.data && (
        <>
          <p>
            所在磁盘剩余 {formatBytes(remote.data.available)} / {formatBytes(remote.data.total)}
          </p>
          <progress
            max={remote.data.total}
            value={remote.data.total - remote.data.available}
            aria-label="主机磁盘占用"
          />
          <div className="feature-grid">
            <div>
              <h4>基础镜像</h4>
              {remote.data.images.map((item) => (
                <p key={item.id}>
                  {item.name} · {formatBytes(item.bytes)}
                </p>
              ))}
            </div>
            <div>
              <h4>实例与快照</h4>
              {remote.data.machines.map((item) => (
                <p key={item.id}>
                  {item.name} · {formatBytes(item.bytes)} · {item.snapshots} 个快照
                </p>
              ))}
            </div>
          </div>
          <p>独立备份：{formatBytes(remote.data.backupBytes)}</p>
          {remote.data.deduplicatedBackups && (
            <p>
              去重备份块：{formatBytes(remote.data.deduplicatedBackups.physicalBytes)} · 已节省{' '}
              {formatBytes(remote.data.deduplicatedBackups.savedBytes)} · 待回收{' '}
              {formatBytes(remote.data.deduplicatedBackups.orphanBytes)}
            </p>
          )}
          <p className="subtle-note">内部快照与实例共享磁盘文件，占用合并显示。</p>
        </>
      )}
    </div>
  );
}

export function MaintenancePanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<{
    report: { createdAt: string; checks: DiagnosticCheck[]; log: string } | null;
    job: JobView | null;
  }>(request, `/vms/${vm.id}/diagnostics`, true, 2500);
  const disk = useRemote<DiskMaintenanceState & { maintenance: boolean }>(
    request,
    `/vms/${vm.id}/disk-maintenance`,
    true,
    2500,
  );
  const [policy, setPolicy] = useState<DiskMaintenancePolicy | null>(null);
  useEffect(() => {
    setPolicy(null);
  }, [vm.id]);
  useEffect(() => {
    if (!policy && disk.data) setPolicy(disk.data.policy);
  }, [policy, disk.data]);
  const [size, setSize] = useState(Math.min(128, vm.diskGiB * 2)),
    action = useAction();
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="content-panel feature-panel">
      <div className="feature-card">
        <h3>故障诊断</h3>
        <p className="subtle-note">检查加速、连接、网络、端口和磁盘，生成可导出的诊断报告。</p>
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={busy}
            onClick={() =>
              void action.run(async () => {
                await request(`/vms/${vm.id}/diagnostics`, 'POST');
                remote.reload();
              })
            }
          >
            开始诊断
          </button>
          <button
            className="secondary compact"
            disabled={!remote.data?.report}
            onClick={() => saveText('sakura-diagnostics.json', remote.data?.report)}
          >
            <Download size={14} />
            导出脱敏报告
          </button>
        </div>
        {remote.data?.report?.checks.map((check) => (
          <div key={check.name} className="diagnostic-row">
            <b>{check.name}</b>
            <span>
              {{ ok: '通过', warning: '需要留意', error: '异常', skip: '未检查' }[check.status]} ·{' '}
              {check.detail}
            </span>
            {check.suggestion && <p className="muted">{check.suggestion}</p>}
          </div>
        ))}
      </div>
      <div className="feature-card">
        <h3>扩容磁盘</h3>
        <p>
          当前容量 {vm.diskGiB} GiB · 已用磁盘文件 {formatBytes(vm.diskBytes)}
        </p>
        <label>
          目标容量（GiB）
          <input
            type="number"
            min={vm.diskGiB + 1}
            max={128}
            value={size}
            onChange={(e) => setSize(+e.target.value)}
          />
        </label>
        <button
          className="secondary compact"
          disabled={busy || vm.poweredOn || size <= vm.diskGiB || size > 128}
          onClick={() =>
            void action.run(async () => {
              await request(`/vms/${vm.id}/resize`, 'POST', { diskGiB: size });
              remote.reload();
              await refresh();
            })
          }
        >
          建立快照并扩容
        </button>
        <p className="subtle-note">请先停止实例。扩容完成后启动实例，会自动扩展 Linux 分区和文件系统。</p>
        {vm.pendingResize && (
          <>
            <p className="machine-error">Linux 文件系统尚待扩展，查看任务日志了解进度。</p>
            <button
              className="secondary compact"
              disabled={busy || vm.status !== 'running'}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/resize`, 'POST', { finish: true });
                  remote.reload();
                })
              }
            >
              重试文件系统扩容
            </button>
          </>
        )}
      </div>
      <div className="feature-card">
        <h3>整理磁盘空间</h3>
        <p className="subtle-note">
          运行时 TRIM 回收根文件系统的空闲块；停机后整理并校验磁盘内容。内部快照或未完成扩容会阻止整理。
        </p>
        {policy && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={policy.enabled}
                onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })}
              />
              启用定期磁盘维护
            </label>
            <div className="feature-grid">
              <label>
                磁盘维护间隔（小时）
                <input
                  type="number"
                  min={1}
                  max={8760}
                  value={policy.intervalHours}
                  onChange={(event) => setPolicy({ ...policy, intervalHours: +event.target.value })}
                />
              </label>
              <label>
                自动维护操作
                <select
                  value={policy.mode}
                  onChange={(event) =>
                    setPolicy({ ...policy, mode: event.target.value as DiskMaintenancePolicy['mode'] })
                  }
                >
                  <option value="both">运行时 TRIM，停机后整理</option>
                  <option value="trim">仅 TRIM</option>
                  <option value="compact">仅停机整理</option>
                </select>
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={policy.compress}
                onChange={(event) => setPolicy({ ...policy, compress: event.target.checked })}
              />
              整理时压缩磁盘块
            </label>
            <button
              className="secondary compact"
              disabled={busy}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/disk-maintenance`, 'PUT', policy);
                  disk.reload();
                }, '磁盘维护策略已保存')
              }
            >
              保存磁盘维护策略
            </button>
          </>
        )}
        <p className="subtle-note">
          TRIM 需要启用设备档案中的 discard，并安装 fstrim。每分钟检查到期任务，TRIM
          与整理各自计算间隔；不会为维护自动关机，维护窗口内暂停自动执行。
        </p>
        {disk.data?.maintenance && <p className="subtle-note">当前处于维护窗口，自动磁盘维护已暂停。</p>}
        {(['trim', 'compact'] as const).map((mode) => {
          const attempt = disk.data?.attempts[mode];
          return (
            attempt && (
              <p key={mode} className={attempt.error ? 'machine-error' : 'subtle-note'}>
                {mode === 'trim' ? 'TRIM' : '磁盘整理'} · {formatDateTime(new Date(attempt.startedAt))} ·{' '}
                {attempt.error || (attempt.finishedAt ? '完成' : '执行中或上次执行中断')}
              </p>
            )
          );
        })}
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={busy || vm.status !== 'running'}
            onClick={() =>
              void action.run(async () => {
                await request(`/vms/${vm.id}/disk-maintenance`, 'POST', { mode: 'trim' });
                remote.reload();
                disk.reload();
              })
            }
          >
            立即执行 TRIM
          </button>
          <button
            className="secondary compact"
            disabled={busy || vm.poweredOn || vm.snapshots.length > 0 || vm.pendingResize}
            onClick={() =>
              void action.run(async () => {
                await request(`/vms/${vm.id}/compact`, 'POST');
                remote.reload();
                await refresh();
              })
            }
          >
            整理未使用空间
          </button>
        </div>
      </div>
      <Feedback error={action.error || remote.error || disk.error} message={action.message} />
      <JobLog job={remote.data?.job} />
      <StoragePanel request={request} />
    </div>
  );
}

export const tabs = { maintenance: MaintenancePanel };
