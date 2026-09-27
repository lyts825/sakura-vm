import { Save, FolderSync as SyncIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobView } from '../../server/jobs';
import type { SyncConfig, SyncDecisions, SyncManualMerges, SyncPreview, SyncQueue } from '../../server/sync';
import type { SyncHistoryView } from '../../server/sync-history';
import type { SyncWatchView } from '../../server/sync-watch';
import { TimeWindowFields } from '../../src/TimeWindowFields';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { policyAllows } from '../../shared/sync-policy';
import { ThreeWayMerge } from '../../src/ThreeWayMerge';

const driverNames = {
  manual: '手动处理',
  'keep-both': '两端都保留（另存 Linux 版本）',
  'prefer-host': '保留 Windows 版本',
  'prefer-guest': '保留 Linux 版本',
  'merge-text': '尝试三方文本合并',
} as const;

export function SyncPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
    projectId?: string;
    config: SyncConfig | null;
    job: JobView | null;
    queue?: SyncQueue | null;
    maintenance?: boolean;
    history?: SyncHistoryView[];
    watching?: SyncWatchView | null;
  }>(request, `/vms/${vm.id}/sync`, true, 2500);
  const [config, setConfig] = useState<SyncConfig>({ host: '', guest: '/workspace/shared', auto: false });
  const [preview, setPreview] = useState<SyncPreview | null>(null),
    [decisions, setDecisions] = useState<SyncDecisions>({}),
    [manualMerges, setManualMerges] = useState<SyncManualMerges>({}),
    [mergeContext, setMergeContext] = useState<{
      path: string; token: string; base: string; ours: string; theirs: string;
    } | null>(null),
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
      setManualMerges({});
      setMergeContext(null);
    }
  }, [remote.data, loadedProject]);
  const sync = (direction: 'both' | 'push' | 'pull') =>
    action.run(async () => {
      await request(`/vms/${vm.id}/sync`, 'POST', {
        direction,
        ...(direction === 'both' && preview ? { token: preview.token, decisions, merges: manualMerges } : {}),
      });
      setPreview(null);
      setManualMerges({});
      setMergeContext(null);
      remote.reload();
    });
  const openMerge = (path: string) => action.run(async (signal) => {
    if (!preview) throw new Error('请先预览同步变更');
    const context = await request<typeof mergeContext>(`/vms/${vm.id}/sync-merge`, 'POST',
      { path, token: preview.token }, signal);
    if (!context || context.token !== preview.token) throw new Error('合并预览已过期，请重新预览');
    setMergeContext(context);
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
        自动双向同步，离线时排队
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!config.watch}
          onChange={(event) => setConfig({ ...config, watch: event.target.checked })}
        />
        优先使用文件变化事件触发同步
      </label>
      <p className="muted">
        Windows 使用目录事件，Linux 使用 inotify-tools；不支持时每 15
        秒轮询。事件模式每分钟补查一次以恢复遗漏的事件。
      </p>
      {remote.data?.watching && (
        <p className="muted" role="status">
          监听状态：Windows {remote.data.watching.host === 'watching' ? '事件监听' : '轮询'} · Linux
          {remote.data.watching.guest === 'watching'
            ? '事件监听'
            : remote.data.watching.guest === 'offline'
              ? '离线'
              : '轮询'}
          {remote.data.watching.reason && ` · ${remote.data.watching.reason}`}
        </p>
      )}
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
          onChange={(event) => setConfig({
            ...config,
            mergeText: event.target.checked,
            drivers: event.target.checked ? config.drivers : config.drivers?.map((driver) =>
              driver.mode === 'merge-text' ? { ...driver, mode: 'manual' } : driver),
          })}
        />
        保存共同文本版本，支持三方合并
      </label>
      <p className="muted">
        每个文本文件最多 1 MiB，共同版本合计最多 16 MiB。首次同步建立基线；重叠修改保留两端。
      </p>
      <details>
        <summary>按路径设置冲突合并驱动</summary>
        <p className="muted">从上到下使用第一条匹配规则，支持 * 与 **。驱动在手动和后台双向同步时生效；本次预览的单文件决策可覆盖规则。自动文本合并遇到重叠修改、二进制文件或缺少共同版本时保留两端原文件。</p>
        {(config.drivers || []).map((driver, index) => (
          <div className="feature-card" key={index}>
            <label>合并路径 {index + 1}
              <input value={driver.pattern} placeholder="*.lock"
                onChange={(event) => setConfig({ ...config, drivers: config.drivers!.map((item, i) =>
                  i === index ? { ...item, pattern: event.target.value } : item) })} />
            </label>
            <label>合并方式 {index + 1}
              <select value={driver.mode}
                onChange={(event) => setConfig({ ...config, drivers: config.drivers!.map((item, i) =>
                  i === index ? { ...item, mode: event.target.value as typeof driver.mode } : item) })}>
                {Object.entries(driverNames).map(([value, label]) =>
                  <option key={value} value={value} disabled={value === 'merge-text' && !config.mergeText}>{label}</option>)}
              </select>
            </label>
            <button className="secondary compact"
              onClick={() => setConfig({ ...config, drivers: config.drivers!.filter((_, i) => i !== index) })}>
              删除合并驱动 {index + 1}
            </button>
          </div>
        ))}
        <button className="secondary compact" disabled={(config.drivers?.length || 0) >= 64}
          onClick={() => setConfig({ ...config, drivers: [
            ...(config.drivers || []), { pattern: '', mode: 'manual' },
          ] })}>
          添加合并驱动
        </button>
      </details>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!config.detectRenames}
          onChange={(event) => setConfig({ ...config, detectRenames: event.target.checked })}
        />
        识别内容未变化的文件重命名
      </label>
      <p className="muted">
        仅在内容对应关系唯一且另一端未修改时移动文件；同内容的多个文件仍按复制和删除处理。
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!config.rollback}
          onChange={(event) => setConfig({ ...config, rollback: event.target.checked })}
        />
        同步前保存可校验的回滚点
      </label>
      <p className="muted">
        保存两端原文件，每个回滚点最多 512 MiB，保留最近 10
        次完成记录。恢复会拒绝覆盖同步后新增的修改；新建空目录保留。
      </p>
      <details>
        <summary>按路径设置同步方向与 Linux 权限</summary>
        <p className="muted">
          从上到下使用第一条匹配规则，支持 * 与 **。只读规则保留两端文件；Linux 权限在写入时应用。
        </p>
        {(config.policies || []).map((policy, index) => (
          <div className="feature-card" key={index}>
            <label>
              路径规则 {index + 1}
              <input
                value={policy.pattern}
                placeholder="secrets/**"
                onChange={(event) =>
                  setConfig({
                    ...config,
                    policies: config.policies!.map((item, i) =>
                      i === index ? { ...item, pattern: event.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              同步方向 {index + 1}
              <select
                aria-label={`同步方向 ${index + 1}`}
                value={policy.direction}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    policies: config.policies!.map((item, i) =>
                      i === index
                        ? { ...item, direction: event.target.value as typeof policy.direction }
                        : item,
                    ),
                  })
                }
              >
                <option value="both">双向</option>
                <option value="push">只上传到 Linux</option>
                <option value="pull">只下载到 Windows</option>
                <option value="readonly">只读，跳过修改</option>
              </select>
            </label>
            <label>
              Linux 权限 {index + 1}（可留空）
              <input
                value={policy.guestMode || ''}
                placeholder="644"
                maxLength={3}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    policies: config.policies!.map((item, i) =>
                      i === index ? { ...item, guestMode: event.target.value || undefined } : item,
                    ),
                  })
                }
              />
            </label>
            <button
              className="secondary compact"
              onClick={() =>
                setConfig({ ...config, policies: config.policies!.filter((_, i) => i !== index) })
              }
            >
              删除规则 {index + 1}
            </button>
          </div>
        ))}
        <button
          className="secondary compact"
          disabled={(config.policies?.length || 0) >= 64}
          onClick={() =>
            setConfig({
              ...config,
              policies: [...(config.policies || []), { pattern: '', direction: 'both' }],
            })
          }
        >
          添加路径规则
        </button>
      </details>
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
              setManualMerges({});
              setMergeContext(null);
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
              setManualMerges({});
              setMergeContext(null);
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
                  <code>{entry.from ? `${entry.from} → ${entry.path}` : entry.path}</code>
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
                        'rename-host': '重命名 Windows 文件',
                        'rename-guest': '重命名 Linux 文件',
                        skip: '按路径策略跳过',
                      }[entry.action]
                    }
                  </span>
                  {entry.driver && <span className="subtle-note">
                    路径驱动：{driverNames[entry.driver]}
                    {entry.suggestedDecision === 'skip' && entry.driver !== 'manual' && '（路径策略限制，暂时跳过）'}
                  </span>}
                  {(entry.action === 'conflict' ||
                    entry.action === 'delete-host' ||
                    entry.action === 'delete-guest') && (
                    <select
                      aria-label={`解决冲突 ${entry.path}`}
                      value={decisions[entry.path] || entry.suggestedDecision || 'skip'}
                      onChange={(e) => {
                        const decision = e.target.value as SyncDecisions[string];
                        setDecisions({ ...decisions, [entry.path]: decision });
                        if (decision !== 'manual') setManualMerges((current) => {
                          const next = { ...current };
                          delete next[entry.path];
                          return next;
                        });
                      }}
                    >
                      <option value="skip">暂时跳过</option>
                      {Object.hasOwn(manualMerges, entry.path) &&
                        <option value="manual">使用已审阅的手动合并</option>}
                      {remote.data?.config?.mergeText &&
                        entry.action === 'conflict' &&
                        policyAllows(entry.path, 'merge', remote.data.config.policies) && (
                          <option value="merge">合并互不冲突的文本修改</option>
                        )}
                      {entry.action === 'conflict' && (
                        <>
                          {policyAllows(entry.path, 'push', remote.data?.config?.policies) && (
                            <option value="push">保留 Windows 版本</option>
                          )}
                          {policyAllows(entry.path, 'pull', remote.data?.config?.policies) && (
                            <option value="pull">保留 Linux 版本</option>
                          )}
                          {policyAllows(entry.path, 'both', remote.data?.config?.policies) && (
                            <option value="both">另存 Linux 版本，保留两份</option>
                          )}
                        </>
                      )}
                      {entry.action === 'delete-guest' && (
                        <>
                          {policyAllows(entry.path, 'pull', remote.data?.config?.policies) && (
                            <option value="restore-host">恢复 Windows 文件</option>
                          )}
                          <option value="delete-guest">确认删除 Linux 文件</option>
                        </>
                      )}
                      {entry.action === 'delete-host' && (
                        <>
                          {policyAllows(entry.path, 'push', remote.data?.config?.policies) && (
                            <option value="restore-guest">恢复 Linux 文件</option>
                          )}
                          <option value="delete-host">确认删除 Windows 文件</option>
                        </>
                      )}
                    </select>
                  )}
                  {entry.action === 'conflict' && remote.data?.config?.mergeText &&
                    policyAllows(entry.path, 'merge', remote.data.config.policies) && (
                      <button className="secondary compact" disabled={action.busy}
                        onClick={() => void openMerge(entry.path)}>
                        手动三方合并
                      </button>
                    )}
                </div>
              ))}
          </div>
          {mergeContext && (
            <div className="feature-card">
              <h4>手动合并：{mergeContext.path}</h4>
              <ThreeWayMerge
                key={`${mergeContext.path}:${mergeContext.token}`}
                base={mergeContext.base}
                ours={mergeContext.ours}
                theirs={mergeContext.theirs}
                oursLabel="Windows 内容"
                theirsLabel="Linux 内容"
                cancel={() => setMergeContext(null)}
                apply={(content) => {
                  setManualMerges((current) => ({ ...current, [mergeContext.path]: content }));
                  setDecisions((current) => ({ ...current, [mergeContext.path]: 'manual' }));
                  setMergeContext(null);
                }}
              />
            </div>
          )}
          <p className="subtle-note">
            每次显示前 200 项，可筛选路径。手动合并内容合计最多 1 MiB；执行前会重新核对文件，发生变化时需要重新预览。
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
      {!!remote.data?.history?.length && (
        <details>
          <summary>同步回滚点（{remote.data.history.length}）</summary>
          {remote.data.history.map((point) => (
            <div className="feature-card" key={point.id}>
              <p>
                {new Date(point.createdAt).toLocaleString()} · {point.changes} 项变更 ·{' '}
                {(point.bytes / 1024 ** 2).toFixed(1)} MiB ·
                {
                  { pending: '未完成', done: '已完成', failed: '部分失败', 'rolled-back': '已回滚' }[
                    point.status
                  ]
                }
              </p>
              {point.error && <p className="muted">{point.error}</p>}
              {point.id === remote.data?.history?.find((item) => item.status !== 'rolled-back')?.id && (
                <button
                  className="secondary compact"
                  disabled={action.busy || remote.data.job?.status === 'running' || vm.status !== 'running'}
                  onClick={() => {
                    if (confirm('恢复此次同步修改前的文件及共同版本？同步后另行编辑过的文件会阻止恢复。'))
                      void action.run(async () => {
                        await request(`/vms/${vm.id}/sync-rollback`, 'POST', { checkpoint: point.id });
                        setPreview(null);
                        remote.reload();
                      });
                  }}
                >
                  回滚此轮同步
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export const tabs = { sync: SyncPanel };
