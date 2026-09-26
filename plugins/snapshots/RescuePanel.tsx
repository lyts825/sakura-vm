import { useState } from 'react';
import { DEFAULT_RESCUE_COMMAND } from '../../shared/rescue';
import type { Rescue } from '../../server/rescue';
import type { SandboxArtifact } from '../../shared/sandbox';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveBlob, saveText } from '../../src/export-file';

export function RescuePanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<ReturnType<Rescue['view']>>(request, `/vms/${vm.id}/rescue`, !vm.sandbox, 2000);
  const action = useAction(),
    cancellation = useAction();
  const [command, setCommand] = useState(DEFAULT_RESCUE_COMMAND),
    [mount, setMount] = useState(true),
    [partition, setPartition] = useState(0),
    [timeout, setTimeout] = useState(60),
    [artifacts, setArtifacts] = useState('');
  if (vm.sandbox) return null;
  const running = remote.data?.runs.find((job) => job.status === 'running');
  const busy = action.busy || !!running;
  return (
    <section className="feature-card rescue-panel" aria-label="只读救援">
      <h3>只读救援</h3>
      <p>
        从独立 Alpine
        临时系统检查故障磁盘。源实例需停止，救援期间锁定；网络隔离，源盘只读，结束后自动清理临时系统。
      </p>
      <Feedback
        error={remote.error || action.error || cancellation.error || remote.data?.persistenceError}
        message={action.message}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async (signal) => {
            await request(
              `/vms/${vm.id}/rescue`,
              'POST',
              {
                command,
                partition: mount ? partition : null,
                timeoutSeconds: timeout,
                artifacts: artifacts
                  .split('\n')
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
              signal,
            );
            remote.reload();
            await refresh();
          }, '已提交救援任务，可在此查看进度与取消。');
        }}
      >
        <fieldset disabled={busy}>
          <legend>救援命令</legend>
          <label className="checkbox-row">
            <input type="checkbox" checked={mount} onChange={(event) => setMount(event.target.checked)} />
            自动只读挂载源文件系统
          </label>
          {mount && (
            <label>
              源分区编号（0 为整盘文件系统）
              <input
                type="number"
                min={0}
                max={128}
                required
                value={partition}
                onChange={(event) => setPartition(Number(event.target.value))}
              />
            </label>
          )}
          <p className="subtle-note">
            自动挂载 ext2/ext3/ext4 到 /mnt/source，不重放日志。Alpine 默认使用
            0；分区不明时取消自动挂载，先执行 cat /proc/partitions 和 blkid。
          </p>
          <label>
            检查命令
            <textarea
              rows={7}
              maxLength={8192}
              required
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            命令与产物总期限（秒）
            <input
              type="number"
              min={1}
              max={1800}
              required
              value={timeout}
              onChange={(event) => setTimeout(Number(event.target.value))}
            />
          </label>
          <label>
            保存产物（每行一个相对路径）
            <textarea
              rows={2}
              maxLength={4104}
              value={artifacts}
              onChange={(event) => setArtifacts(event.target.value)}
              placeholder="recovered.txt"
            />
          </label>
          <p className="subtle-note">
            命令在 /workspace 执行。将要保留的文件从 /mnt/source 复制到 /workspace 后列为产物；最多 8
            个文件、合计 8 MiB。离开页面后任务继续运行，停止任务请点击取消。
          </p>
          <button type="submit" className="primary compact" disabled={vm.poweredOn || !command.trim()}>
            启动只读救援
          </button>
          {vm.poweredOn && <p className="subtle-note">请先停止源实例。</p>}
        </fieldset>
      </form>
      {running && (
        <div className="feature-actions">
          <span role="status">{running.phase || '救援正在执行'}</span>
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
            取消救援
          </button>
        </div>
      )}
      {(remote.data?.runs || []).map((job) => (
        <details key={job.id} open={job === remote.data?.runs[0]}>
          <summary>救援记录 · {new Date(job.startedAt).toLocaleString()}</summary>
          <JobLog job={job} />
          <div className="feature-actions">
            <button
              type="button"
              className="secondary compact"
              onClick={() => saveText(`rescue-${job.id}.json`, job)}
            >
              导出救援记录
            </button>
            {job.execution?.artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async (signal) => {
                    const value = await request<SandboxArtifact & { base64: string }>(
                      `/vms/${vm.id}/rescue/artifact?run=${job.id}&artifact=${artifact.id}`,
                      'GET',
                      undefined,
                      signal,
                    );
                    const bytes = Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0));
                    saveBlob(value.name, new Blob([bytes], { type: 'application/octet-stream' }));
                  })
                }
              >
                下载 {artifact.name} · {(artifact.bytes / 1024).toFixed(1)} KiB
              </button>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
