import { Save, FolderSync as SyncIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobView } from '../../server/jobs';
import type { SyncConfig, SyncDecisions, SyncPreview, SyncQueue } from '../../server/sync';
import { TimeWindowFields } from '../../src/TimeWindowFields';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';

export function SyncPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
    projectId?: string;
    config: SyncConfig | null;
    job: JobView | null;
    queue?: SyncQueue | null;
    maintenance?: boolean;
  }>(request, `/vms/${vm.id}/sync`, true, 2500);
  const [config, setConfig] = useState<SyncConfig>({ host: '', guest: '/workspace/shared', auto: false });
  const [preview, setPreview] = useState<SyncPreview | null>(null),
    [decisions, setDecisions] = useState<SyncDecisions>({}),
    [previewQuery, setPreviewQuery] = useState('');
  const [loadedProject, setLoadedProject] = useState('');
  const action = useAction();
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      if (remote.data.config) setConfig(remote.data.config);
      else setConfig({ host: '', guest: '/workspace/shared', auto: false });
      setPreview(null);
      setDecisions({});
    }
  }, [remote.data, loadedProject]);
  const sync = (direction: 'both' | 'push' | 'pull') =>
    action.run(async () => {
      await request(`/vms/${vm.id}/sync`, 'POST', {
        direction,
        ...(direction === 'both' && preview ? { token: preview.token, decisions } : {}),
      });
      setPreview(null);
      remote.reload();
    });
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Windows 目录同步</h3>
          <p>把本机文件夹与 Linux 项目目录连接起来。</p>
        </div>
        <SyncIcon size={22} />
      </div>
      <Feedback error={action.error || remote.error} message={action.message} />
      <label>
        Windows 文件夹绝对路径
        <input
          placeholder="D:\\Projects\\my-app"
          value={config.host}
          onChange={(e) => setConfig({ ...config, host: e.target.value })}
        />
      </label>
      <label>
        Linux 目录
        <input value={config.guest} onChange={(e) => setConfig({ ...config, guest: e.target.value })} />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={config.auto}
          onChange={(e) => setConfig({ ...config, auto: e.target.checked })}
        />
        每 15 秒检查并自动双向同步，离线时排队
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!config.window}
          onChange={(event) =>
            setConfig({
              ...config,
              window: event.target.checked
                ? {
                    start: '09:00',
                    end: '18:00',
                    days: [1, 2, 3, 4, 5],
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }
                : undefined,
            })
          }
        />
        限定后台同步时间窗
      </label>
      {config.window && (
        <TimeWindowFields value={config.window} onChange={(window) => setConfig({ ...config, window })} />
      )}
      <label>
        同步传输限速（MiB/s，0 表示不限）
        <input
          type="number"
          min={0}
          max={10240}
          step={0.1}
          value={config.bandwidthMiBps || 0}
          onChange={(event) => setConfig({ ...config, bandwidthMiBps: +event.target.value })}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={config.mergeText === true}
          onChange={(event) => setConfig({ ...config, mergeText: event.target.checked })}
        />
        保存共同文本版本，支持三方合并
      </label>
      <p className="muted">
        每个文本文件最多 1 MiB，共同版本合计最多 16 MiB。首次同步建立基线；重叠修改保留两端。
      </p>
      <label>
        自定义忽略规则（每行一个，支持 * 与 **）
        <textarea
          rows={3}
          value={(config.ignore || []).join('\n')}
          onChange={(e) => setConfig({ ...config, ignore: e.target.value.split('\n') })}
          placeholder={'*.log\ndist\nbuild/**'}
        />
      </label>
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={action.busy || !remote.data?.config || !!remote.data?.queue}
          onClick={() =>
            void action.run(async () => {
              await request(`/vms/${vm.id}/sync-queue`, 'POST', {});
              remote.reload();
            }, '已排队，将在实例在线且处于允许时间窗时执行')
          }
        >
          排队同步
        </button>
        {remote.data?.queue && (
          <button
            className="secondary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await request(`/vms/${vm.id}/sync-queue`, 'DELETE');
                remote.reload();
              }, '已取消排队')
            }
          >
            取消排队
          </button>
        )}
        <button
          className="secondary compact"
          disabled={action.busy || remote.data?.job?.status === 'running'}
          onClick={() =>
            void action.run(async () => {
              await request(`/vms/${vm.id}/sync`, 'PUT', {
                ...config,
                ignore: config.ignore?.map((v) => v.trim()).filter(Boolean),
              });
              setPreview(null);
              remote.reload();
            }, '同步配置已保存')
          }
        >
          <Save size={14} />
          保存配置
        </button>
        <button
          className="primary compact"
          disabled={
            action.busy ||
            !remote.data?.config ||
            remote.data.job?.status === 'running' ||
            vm.status !== 'running'
          }
          onClick={() =>
            void action.run(async (signal) => {
              setPreview(await request(`/vms/${vm.id}/sync-preview`, 'POST', {}, signal));
              setDecisions({});
            })
          }
        >
          预览双向同步
        </button>
      </div>
      {remote.data?.maintenance && <p className="muted">当前处于维护窗口，暂停启动后台同步。</p>}
      {remote.data?.queue && (
        <p role="status" className="muted">
          同步已排队 · 已尝试 {remote.data.queue.attempts} 次
          {remote.data.queue.lastError && ` · ${remote.data.queue.lastError}`}
          {remote.data.queue.nextAttemptAt > Date.now() &&
            ` · 下次重试 ${new Date(remote.data.queue.nextAttemptAt).toLocaleString()}`}
        </p>
      )}
      {preview && (
        <div className="feature-card">
          <h4>变更预览</h4>
          <p>
            {preview.changes.length} 项变更 · {preview.unchanged} 个文件相同
          </p>
          <label>
            筛选文件
            <input value={previewQuery} onChange={(e) => setPreviewQuery(e.target.value)} />
          </label>
          <div className="sync-preview">
            {preview.changes
              .filter((entry) => entry.path.includes(previewQuery))
              .slice(0, 200)
              .map((entry) => (
                <div className="sync-change" key={entry.path}>
                  <code>{entry.path}</code>
                  <span>
                    {
                      {
                        push: '上传到 Linux',
                        pull: '下载到 Windows',
                        conflict: '两端均有修改',
                        'mkdir-host': '新建 Windows 目录',
                        'mkdir-guest': '新建 Linux 目录',
                        'delete-host': '删除 Windows 文件（需确认）',
                        'delete-guest': '删除 Linux 文件（需确认）',
                        skip: '跳过',
                      }[entry.action]
                    }
                  </span>
                  {(entry.action === 'conflict' ||
                    entry.action === 'delete-host' ||
                    entry.action === 'delete-guest') && (
                    <select
                      aria-label={`解决冲突 ${entry.path}`}
                      value={decisions[entry.path] || 'skip'}
                      onChange={(e) =>
                        setDecisions({ ...decisions, [entry.path]: e.target.value as SyncDecisions[string] })
                      }
                    >
                      <option value="skip">暂时跳过</option>
                      {remote.data?.config?.mergeText && entry.action === 'conflict' && (
                        <option value="merge">合并互不冲突的文本修改</option>
                      )}
                      <option value="push">保留 Windows 版本</option>
                      <option value="pull">保留 Linux 版本</option>
                      <option value="both">另存 Linux 版本，保留两份</option>
                      <option value="restore-host">恢复 Windows 文件</option>
                      <option value="restore-guest">恢复 Linux 文件</option>
                      <option value="delete-host">确认删除 Windows 文件</option>
                      <option value="delete-guest">确认删除 Linux 文件</option>
                    </select>
                  )}
                </div>
              ))}
          </div>
          <p className="subtle-note">
            每次显示前 200 项，可筛选路径。执行前会重新核对文件，发生变化时需要重新预览。
          </p>
          <button
            className="primary compact"
            disabled={action.busy || remote.data?.job?.status === 'running'}
            onClick={() => void sync('both')}
          >
            应用本次同步
          </button>
        </div>
      )}
      <p className="subtle-note">
        冲突文件默认保留两边；删除只有在预览中明确选择后才会传播。跳过符号链接、.git、node_modules 和 Sakura
        数据目录。单文件上限 256 MiB。
      </p>
      <details>
        <summary>解决冲突</summary>
        <p>以下操作会用所选一侧覆盖另一侧的同名文件。</p>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={action.busy || remote.data?.job?.status === 'running' || vm.status !== 'running'}
            onClick={() => {
              if (confirm('用 Windows 文件覆盖 Linux 同名文件？')) void sync('push');
            }}
          >
            以 Windows 为准
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || remote.data?.job?.status === 'running' || vm.status !== 'running'}
            onClick={() => {
              if (confirm('用 Linux 文件覆盖 Windows 同名文件？')) void sync('pull');
            }}
          >
            以 Linux 为准
          </button>
        </div>
      </details>
      <JobLog job={remote.data?.job} />
    </div>
  );
}

export const tabs = { sync: SyncPanel };
