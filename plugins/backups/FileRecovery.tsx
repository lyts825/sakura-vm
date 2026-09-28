import { formatDecimal } from '../../src/localization';
import { formatDateTime } from '../../src/localization';
import { useState } from 'react';
import type { BackupRecord } from '../../server/backups';
import type { BackupRecovery } from '../../server/backup-recovery';
import type { SandboxArtifact } from '../../shared/sandbox';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveBlob, saveText } from '../../src/export-file';

export function FileRecovery({
  vm,
  request,
  refresh,
  items,
}: Pick<FeatureProps, 'vm' | 'request' | 'refresh'> & { items: BackupRecord[] }) {
  const remote = useRemote<ReturnType<BackupRecovery['view']>>(
    request,
    `/vms/${vm.id}/backup-recovery`,
    !vm.sandbox,
    2000,
  );
  const action = useAction(),
    cancellation = useAction();
  const [backupId, setBackupId] = useState(''),
    [partition, setPartition] = useState(0),
    [paths, setPaths] = useState(''),
    [password, setPassword] = useState('');
  if (vm.sandbox) return null;
  const running = remote.data?.runs.find((job) => job.status === 'running');
  const selected = items.find((item) => item.id === backupId);
  return (
    <section className="rescue-panel" aria-label="备份文件恢复">
      <h3>备份文件恢复</h3>
      <p>选择备份与文件，在临时系统中只读提取后下载。支持普通、加密及内容块备份；原实例和备份保持原样。</p>
      <Feedback
        error={remote.error || action.error || cancellation.error || remote.data?.persistenceError}
        message={action.message}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const secret = password;
          setPassword('');
          void action.run(async (signal) => {
            await request(
              `/vms/${vm.id}/backup-recovery`,
              'POST',
              {
                backupId,
                partition,
                paths: paths
                  .split('\n')
                  .map((value) => value.trim())
                  .filter(Boolean),
                password: secret || undefined,
              },
              signal,
            );
            remote.reload();
            await refresh();
          }, '文件恢复任务已提交，提取完成后可下载。');
        }}
      >
        <fieldset disabled={action.busy || !!running}>
          <legend>选择恢复内容</legend>
          <label>
            恢复来源备份
            <select
              aria-label="恢复来源备份"
              value={backupId}
              required
              onChange={(event) => {
                setBackupId(event.target.value);
                setPassword('');
              }}
            >
              <option value="">选择一份备份</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatDateTime(new Date(item.createdAt))} · {item.id.slice(0, 8)}
                  {item.encrypted ? ' · 加密' : item.storage === 'blocks' ? ' · 内容块' : ''}
                </option>
              ))}
            </select>
          </label>
          {selected?.encrypted && (
            <label>
              文件恢复解密密码
              <input
                type="password"
                autoComplete="off"
                maxLength={1024}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={selected.passwordSecret ? '留空使用备份的密钥引用' : '输入所选备份的密码'}
              />
            </label>
          )}
          <label>
            备份内分区编号（0 为整盘文件系统）
            <input
              type="number"
              min={0}
              max={128}
              required
              value={partition}
              onChange={(event) => setPartition(Number(event.target.value))}
            />
          </label>
          <label>
            要恢复的文件（每行一个相对根目录的路径）
            <textarea
              rows={4}
              maxLength={4104}
              required
              value={paths}
              onChange={(event) => setPaths(event.target.value)}
              placeholder="workspace/README.md"
            />
          </label>
          <p className="subtle-note">
            例如 workspace/README.md。支持 ext2/ext3/ext4，最多 8 个普通文件、合计 8
            MiB；不自动重放日志。需要停止源实例和本机 Alpine
            镜像，并预留备份解密、重组与磁盘展开空间。离开页面后后台任务继续运行。
          </p>
          <button
            type="submit"
            className="primary compact"
            disabled={vm.poweredOn || !selected || !paths.trim()}
          >
            提取备份文件
          </button>
          {vm.poweredOn && <p className="subtle-note">请先停止源实例。</p>}
        </fieldset>
      </form>
      {running && (
        <div className="feature-actions">
          <span role="status">{running.phase || '文件恢复正在执行'}</span>
          <button
            className="secondary compact"
            disabled={cancellation.busy}
            onClick={() =>
              void cancellation.run(async (signal) => {
                await request(`/jobs/${running.id}/cancel`, 'POST', undefined, signal);
                remote.reload();
                await refresh();
              })
            }
          >
            取消文件恢复
          </button>
        </div>
      )}
      {(remote.data?.runs || []).map((job) => (
        <details key={job.id} open={job === remote.data?.runs[0]}>
          <summary>文件恢复记录 · {formatDateTime(new Date(job.startedAt))}</summary>
          <JobLog job={job} />
          <div className="feature-actions">
            <button
              className="secondary compact"
              onClick={() => saveText(`backup-recovery-${job.id}.json`, job)}
            >
              导出文件恢复记录
            </button>
            {job.execution?.artifacts.map((artifact) => (
              <button
                key={artifact.id}
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async (signal) => {
                    const value = await request<SandboxArtifact & { base64: string }>(
                      `/vms/${vm.id}/backup-recovery/artifact?run=${job.id}&artifact=${artifact.id}`,
                      'GET',
                      undefined,
                      signal,
                    );
                    const bytes = Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0));
                    saveBlob(value.name, new Blob([bytes], { type: 'application/octet-stream' }));
                  })
                }
              >
                下载恢复文件 {artifact.path} · {formatDecimal((artifact.bytes / 1024), 1)} KiB
              </button>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
