import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CapabilityActionView } from '../shared/capability-actions';
import type { JobView } from '../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';
import { saveBlob } from './export-file';
import { SchemaFields } from './SchemaFields';
import { HostDiskHealthReport } from './HostDiskHealthReport';

type Props = {
  request: Request;
  path: string;
  scope: CapabilityActionView['scope'];
  definitions?: CapabilityActionView[];
  jobs?: JobView[];
  selected: string;
  onSelected: (id: string) => void;
  running: boolean;
  reload: () => unknown;
};

export function CapabilityActionsPanel({
  request,
  path,
  scope,
  definitions = [],
  jobs = [],
  selected,
  onSelected,
  running,
  reload,
}: Props) {
  const action = useAction();
  const [parameters, setParameters] = useState('{}');
  const [ideAccess, setIdeAccess] = useState<{ password: string; expiresAt: string } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const reportFormError = useCallback(
    (key: string, invalid: boolean) =>
      setFormErrors((current) =>
        Boolean(current[key]) === invalid ? current : { ...current, [key]: invalid },
      ),
    [],
  );
  const definition = definitions.find((item) => item.id === selected);
  const vmId = /^\/vms\/([^/]+)\/next-features$/.exec(path)?.[1];
  useEffect(() => {
    setParameters(JSON.stringify(definition?.example || {}, null, 2));
    setIdeAccess(null);
  }, [selected, path, request]);
  useEffect(() => {
    if (!ideAccess) return;
    const timer = setTimeout(() => setIdeAccess(null),
      Math.max(0, new Date(ideAccess.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [ideAccess]);
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(parameters);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }, [parameters]);
  const key = (scope === 'suite' ? 'capability:' : scope === 'extended' ? 'extended:' : 'next:') + selected;
  const job = jobs.find((item) => item.action === key);
  const saved = useRemote<any>(request, `/jobs/${job?.id}/result`, Boolean(job?.result), 0);
  let result: any;
  try {
    result = job?.result
      ? saved.data?.jobId === job.id
        ? saved.data.result
        : null
      : job?.log
        ? JSON.parse(job.log)
        : null;
  } catch {
    result = null;
  }
  if (!definitions.length) return null;
  return (
    <div className="capability-actions-panel">
      <label>
        可执行功能
        <select
          aria-label={scope + ' 功能操作'}
          value={selected}
          onChange={(event) => onSelected(event.target.value)}
        >
          <option value="">选择功能</option>
          {definitions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.writes ? ' · 可写入' : ''}
            </option>
          ))}
        </select>
      </label>
      {definition && (
        <>
          <p className="muted">{definition.note}</p>
          {parsed && (
            <details>
              <summary>填写参数表单</summary>
              <SchemaFields
                schema={definition.schema}
                value={parsed}
                report={reportFormError}
                update={(value) => setParameters(JSON.stringify(value, null, 2))}
              />
            </details>
          )}
          {selected === 'command-forms' && Array.isArray(parsed?.fields) && (
            <div className="feature-grid">
              {parsed.fields
                .filter((field: any) => typeof field?.name === 'string')
                .map((field: any) => {
                  const update = (value: unknown) =>
                    setParameters(
                      JSON.stringify(
                        { ...parsed, values: { ...parsed.values, [field.name]: value } },
                        null,
                        2,
                      ),
                    );
                  const value = parsed.values?.[field.name];
                  return (
                    <label key={field.name}>
                      {field.label || field.name}
                      {field.required ? ' *' : ''}
                      {field.type === 'choice' ? (
                        <select value={value ?? ''} onChange={(event) => update(event.target.value)}>
                          <option value="">请选择</option>
                          {(field.choices || []).map((item: string) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(event) => update(event.target.checked)}
                        />
                      ) : (
                        <input
                          type={field.type === 'integer' ? 'number' : 'text'}
                          value={value ?? ''}
                          onChange={(event) =>
                            update(
                              field.type === 'integer' && event.target.value !== ''
                                ? Number(event.target.value)
                                : event.target.value,
                            )
                          }
                        />
                      )}
                    </label>
                  );
                })}
            </div>
          )}
          <label>
            操作参数（JSON）
            <textarea
              rows={10}
              aria-label={scope + ' 功能参数'}
              value={parameters}
              onChange={(event) => setParameters(event.target.value)}
            />
          </label>
          {!parsed && <p role="alert">请输入有效的 JSON 对象。</p>}
          <button
            className="secondary compact"
            disabled={
              action.busy ||
              !parsed ||
              Object.values(formErrors).some(Boolean) ||
              (definition.requiresGuest && !running)
            }
            onClick={() =>
              action.run(async () => {
                await request(path, 'POST', {
                  action: scope === 'suite' ? 'feature-run' : 'run',
                  featureId: selected,
                  options: parsed,
                });
                reload();
              }, '任务已提交，执行结果显示在下方')
            }
          >
            提交{definition.name}
          </button>
          <Feedback error={action.error} message={action.message} />
          <JobLog job={job || null} />
          {saved.error && <p role="alert">{saved.error}</p>}
          {result && (
            <button
              className="secondary compact"
              onClick={() =>
                saveBlob(
                  selected + '-result.json',
                  new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                )
              }
            >
              导出完整结果
            </button>
          )}
          {selected === 'availability-report' && result && typeof result.coveragePercent === 'number' && (
            <div className="feature-card">
              <p>
                已观测时段可用率：
                {result.availablePercent === null ? '暂无样本' : result.availablePercent.toFixed(2) + '%'}
              </p>
              <p>
                观测覆盖率：{result.coveragePercent.toFixed(2)}% · 未知时长：
                {Math.round(result.unknownSeconds)} 秒
              </p>
              <p className="subtle-note">
                运行且 Linux 探测成功计为可用；停止、暂停和探测失败计为已观测的不可用。采样间隔约 30 秒，超过
                90 秒的采集空白计为未知。
              </p>
            </div>
          )}
          {selected === 'power-aware-schedule' && result?.decision && (
            <div className="feature-card">
              <p>电源调度：{result.decision.reason}</p>
              <p>
                电池电量：
                {result.sample.batteryPercent === null
                  ? '未知或未安装电池'
                  : result.sample.batteryPercent + '%'}
              </p>
              {result.sample.error && <p className="subtle-note">{result.sample.error}</p>}
            </div>
          )}
          {selected === 'host-disk-health' && result?.provider === 'Windows Storage' && (
            <HostDiskHealthReport report={result} />
          )}
          {selected === 'cold-migration' && result?.phase && (
            <div className="feature-card">
              <p>{result.phase === 'moved' ? '源实例已移除，冷迁移完成。' :
                '目标实例已导入，源实例仍保留。请在目标主机确认可用后，用相同目标 ID 和名称重试并明确勾选移除源实例。'}</p>
              <p>目标实例 ID：<code>{result.remoteVmId}</code></p>
              {!result.queuePersisted && result.phase === 'moved' &&
                <p className="subtle-note">迁移已完成，但队列状态保存失败；请检查目标实例。</p>}
            </div>
          )}
          {selected === 'maintenance-drain' && Array.isArray(result?.completed) && (
            <div className="feature-card">
              <p>{result.phase === 'moved' ? '排空批次已复核并移除来源实例。' :
                '排空批次已复制；来源实例仍保留。请逐台验证目标后，用相同目标 ID 再次执行并确认移除。'}</p>
              <p>已处理 {result.completed.length} 台 · 本机剩余 {result.remainingSourceVms} 台</p>
              {result.completed.map((item: any) => <p key={item.sourceVmId}>
                {item.name} → {item.targetName}：目标 <code>{item.remoteVmId}</code> ·
                {item.sourceRemoved ? '来源已移除' : '来源保留'}
              </p>)}
            </div>
          )}
          {selected === 'cross-host-snapshots' && result?.remoteVmId && (
            <div className="feature-card">
              <p>历史快照已复制到目标主机，来源实例和快照保持不变。</p>
              <p>目标实例 ID：<code>{result.remoteVmId}</code></p>
              <p>磁盘 SHA-256：<code>{result.sha256}</code></p>
            </div>
          )}
          {selected === 'notebook-environment' && result && (
            <div className="feature-card">
              <p>{result.message || 'Notebook 会话状态'}</p>
              {result.session && <p>{result.session.provider === 'jupyter' ? 'JupyterLab' : 'Marimo'} ·
                {result.session.status === 'running' ? '运行中' :
                  result.session.status === 'unhealthy' ? '入口未就绪' : '已停止'} ·
                本机端口 {result.session.hostPort}</p>}
              {result.session?.status === 'running' && vmId && <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() => {
                  const tab = window.open('about:blank', '_blank');
                  if (tab) tab.opener = null;
                  void action.run(async () => {
                    if (!tab) throw new Error('浏览器阻止了新标签页，请允许弹窗后重试');
                    try {
                      const link = await request<{ url: string }>(`/vms/${vmId}/notebook-link`);
                      tab.location.replace(link.url);
                    } catch (error) { tab.close(); throw error; }
                  }, 'Notebook 已在新标签页打开');
                }}
              >打开 Notebook</button>}
            </div>
          )}
          {selected === 'authenticated-ide-preview' && result && (
            <div className="feature-card">
              <p>{result.message || '浏览器 IDE 会话状态'}</p>
              {result.session && <p>
                {result.session.status === 'running' ? '运行中' :
                  result.session.status === 'expired' ? '已过期' :
                    result.session.status === 'unhealthy' ? '入口未就绪' : '已停止'} ·
                本机端口 {result.session.hostPort} ·
                到期 {new Date(result.session.expiresAt).toLocaleString('zh-CN')}
              </p>}
              {result.session?.status === 'running' && vmId && <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() => {
                  const tab = window.open('about:blank', '_blank');
                  if (tab) tab.opener = null;
                  void action.run(async () => {
                    if (!tab) throw new Error('浏览器阻止了新标签页，请允许弹窗后重试');
                    try {
                      const link = await request<{ url: string; password: string; expiresAt: string }>(
                        `/vms/${vmId}/browser-ide-link`);
                      setIdeAccess({ password: link.password, expiresAt: link.expiresAt });
                      tab.location.replace(link.url);
                    } catch (error) { tab.close(); throw error; }
                  }, '浏览器 IDE 已在新标签页打开，请输入下方密码');
                }}
              >打开浏览器 IDE</button>}
              {ideAccess && <p>访问密码：<code>{ideAccess.password}</code>
                <button className="secondary compact" onClick={() =>
                  void action.run(async () => navigator.clipboard.writeText(ideAccess.password),
                    '访问密码已复制')
                }>复制访问密码</button>
                <span className="subtle-note">到期 {new Date(ideAccess.expiresAt).toLocaleString('zh-CN')}</span>
              </p>}
            </div>
          )}
          {selected === 'storage-pools' && Array.isArray(result?.pools) && (
            <div className="feature-card">
              <p>当前实例存储池：<code>{result.currentPoolId}</code></p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>存储池</th><th>目录</th><th>可用容量</th><th>实例</th><th>操作</th></tr></thead>
                  <tbody>{result.pools.map((pool: any) => <tr key={pool.id}>
                    <td>{pool.name}<br /><code>{pool.id}</code></td>
                    <td><code>{pool.root}</code></td>
                    <td>{pool.freeBytes === null ? '目录不可用' :
                      (pool.freeBytes / 1024 ** 3).toFixed(1) + ' GiB'}</td>
                    <td>{pool.vms?.map((vm: any) => vm.name).join('、') || '无'}</td>
                    <td>
                      {pool.available && !running && pool.id !== result.currentPoolId && <button
                        className="secondary compact" onClick={() => setParameters(JSON.stringify({
                          mode: 'move', poolId: pool.id,
                        }, null, 2))}>迁移到此池</button>}
                      {pool.id !== 'default' && !pool.vms?.length && <button
                        className="secondary compact" onClick={() => setParameters(JSON.stringify({
                          mode: 'remove', poolId: pool.id,
                        }, null, 2))}>移除池</button>}
                    </td>
                  </tr>)}</tbody>
                </table>
              </div>
              {!!result.pendingCleanup?.length && <p role="alert">
                有 {result.pendingCleanup.length} 处迁移旧副本待清理。
                <button className="secondary compact" onClick={() =>
                  setParameters(JSON.stringify({ mode: 'cleanup' }, null, 2))
                }>准备重试清理</button>
              </p>}
            </div>
          )}
          {selected === 'storage-tiering' && Array.isArray(result?.candidates) && (
            <div className="feature-card">
              <p>{result.policy ? `分层策略${result.policy.enabled ? '已启用定期检查' : '仅手动执行'}；`
                + `最近未使用 ${result.policy.idleHours} 小时后进入冷池。`
                : '尚未设置热池与冷池。'}</p>
              <p className="subtle-note">池角色由你指定；Sakura 按实例最近使用时间迁移整个停机实例。</p>
              <button className="secondary compact" onClick={() => setParameters(JSON.stringify({
                mode: 'save', enabled: result.policy?.enabled || false,
                hotPoolId: result.policy?.hotPoolId || 'default',
                coldPoolId: result.policy?.coldPoolId || result.pools.find((pool: any) =>
                  pool.id !== 'default')?.id || 'default',
                idleHours: result.policy?.idleHours || 168,
                intervalHours: result.policy?.intervalHours || 24,
              }, null, 2))}>编辑分层策略</button>
              {result.current?.ready && <button className="secondary compact"
                onClick={() => setParameters(JSON.stringify({ mode: 'apply' }, null, 2))}>
                准备迁移当前实例到 {result.current.targetPoolId}
              </button>}
              <button className="secondary compact"
                disabled={!result.policy || result.running}
                onClick={() => setParameters(JSON.stringify({ mode: 'rebalance' }, null, 2))}>
                准备重平衡全部停机实例
              </button>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th>实例</th><th>当前池</th><th>建议池</th><th>最近使用</th><th>状态</th></tr></thead>
                  <tbody>{result.candidates.map((item: any) => <tr key={item.vmId}>
                    <td>{item.name}</td><td><code>{item.currentPoolId}</code></td>
                    <td><code>{item.targetPoolId || '—'}</code></td>
                    <td>{new Date(item.lastUsedAt).toLocaleString('zh-CN')}</td>
                    <td>{item.ready ? '可迁移' : item.reason}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          {selected === 'disaster-recovery-drill' && Array.isArray(result?.backups) && (
            <div className="feature-card">
              <p>选择一份已有备份进行临时恢复与启动验证；可在参数中补充检查路径和预期 SHA-256。</p>
              {result.backups.length ? <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th>备份</th><th>时间</th><th>大小</th><th>操作</th></tr></thead>
                  <tbody>{result.backups.map((backup: any) => <tr key={backup.id}>
                    <td><code>{backup.id}</code>{backup.encrypted ? ' · 已加密' : ''}</td>
                    <td>{new Date(backup.createdAt).toLocaleString('zh-CN')}</td>
                    <td>{(backup.bytes / 1024 ** 2).toFixed(1)} MiB</td>
                    <td><button className="secondary compact" onClick={() =>
                      setParameters(JSON.stringify({ mode: 'run', backupId: backup.id }, null, 2))
                    }>准备演练</button></td>
                  </tr>)}</tbody>
                </table>
              </div> : <p className="muted">当前实例还没有可演练的备份。</p>}
            </div>
          )}
          {selected === 'disaster-recovery-drill' && result?.executed && result?.backupId && (
            <div className="feature-card">
              <p>{result.ready ? '备份恢复、客户机启动和路径验证均通过。' :
                `演练未通过：${result.error || result.cleanupError || '请查看任务日志'}`}</p>
              <p>恢复 {result.restoreMs ?? '—'} ms · 启动 {result.bootMs ?? '—'} ms ·
                总计 {result.totalMs} ms</p>
              {result.temporaryVmId && !result.temporaryVmRemoved && <p role="alert">
                临时实例 {result.restoredName} 清理未完成，请检查后手动删除。
              </p>}
            </div>
          )}
          {selected === 'packet-capture' && typeof result?.capturedPackets === 'number' && (
            <div className="feature-card">
              <p>已捕获 {result.capturedPackets} 个数据包 ·
                {result.stopReason === 'packet-limit' ? '达到包数上限' : '达到采集时限'}</p>
              <p>协议分布：{Object.entries(result.protocolCounts || {})
                .map(([protocol, count]) => `${protocol} ${count}`)
                .join(' · ') || '无匹配数据包'}</p>
              <p className="subtle-note">结果只包含协议、时间桶和临时匿名流标识。可使用“导出完整结果”保存诊断报告。</p>
            </div>
          )}
          {selected === 'reverse-tunnel' && typeof result?.active === 'boolean' && (
            <div className="feature-card">
              <p>{result.active
                ? `本机 TCP 入口：127.0.0.1:${result.localPort} → 客户机 127.0.0.1:${result.guestPort}`
                : '当前没有临时 TCP 入口。'}</p>
              {result.active && <p>到期时间：{new Date(result.expiresAt).toLocaleString('zh-CN')}
                {' · '}当前连接：{result.connections}</p>}
              {result.active && <button className="secondary compact" onClick={() =>
                setParameters(JSON.stringify({ mode: 'close' }, null, 2))
              }>准备关闭入口</button>}
            </div>
          )}
          {(selected === 'flamegraph' || selected === 'ebpf-profiler') &&
            typeof result?.samples === 'number' && (
              <div className="feature-card">
                <p>已采集 {result.samples} 次样本
                  {typeof result.stackCount === 'number' ? ` · ${result.stackCount} 条内核调用栈` : ''}。</p>
                {result.clipped && <p className="subtle-note">输出超过采样上限；下载报告仅包含已解析部分。</p>}
                {selected === 'ebpf-profiler' && Array.isArray(result.topSymbols) && (
                  <table>
                    <thead><tr><th>内核函数</th><th>样本数</th><th>占比</th></tr></thead>
                    <tbody>{result.topSymbols.slice(0, 10).map((item: any) => (
                      <tr key={item.name}><td>{item.name}</td><td>{item.count}</td>
                        <td>{item.percent}%</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            )}
          {result?.download && (
            <button
              className="secondary compact"
              onClick={() =>
                saveBlob(
                  result.download.filename,
                  new Blob([result.download.content], { type: result.download.mime }),
                )
              }
            >
              下载 {result.download.filename}
            </button>
          )}
          {Array.isArray(result?.metrics) && selected === 'anomaly-detection' && (
            <table>
              <thead>
                <tr>
                  <th>指标</th>
                  <th>基线</th>
                  <th>当前</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((item: any) => (
                  <tr key={item.field}>
                    <td>{item.field}</td>
                    <td>{item.baseline.toFixed(2)}</td>
                    <td>{item.current.toFixed(2)}</td>
                    <td>{item.anomalous ? '异常' : '正常'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result?.basis === 'completed-tasks' && (
            <div className="feature-grid">
              <p>
                成功率：{result.actualPercent === null ? '暂无样本' : result.actualPercent.toFixed(2) + '%'}
              </p>
              <p>
                已完成任务：{result.samples} · 失败：{result.failed}
              </p>
              <p>剩余失败预算：{result.remainingFailures.toFixed(2)}</p>
            </div>
          )}
          {selected === 'disk-analyzer' && result?.types && (
            <div aria-label="磁盘占用分析">
              <p>
                共 {result.files} 个文件 · {(result.totalBytes / 1024 / 1024).toFixed(2)} MiB
              </p>
              {result.types.map((item: { type: string; bytes: number; files: number }) => (
                <div key={item.type}>
                  <span>
                    {item.type} · {item.files} 个文件 · {(item.bytes / 1024).toFixed(1)} KiB
                  </span>
                  <meter
                    aria-label={item.type + ' 占用'}
                    value={item.bytes}
                    min={0}
                    max={Math.max(1, result.totalBytes)}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
          )}
          {selected === 'workspace-search' && Array.isArray(result?.results) && (
            <div className="search-results">
              <p>
                找到 {result.totalMatches} 处匹配{result.truncated ? '，仅显示前一部分' : ''}
              </p>
              {result.results.map((target: any) => (
                <article key={target.vmId + target.projectId}>
                  <h4>
                    {target.vmName || target.vmId} · {target.projectId}
                  </h4>
                  {target.error && <p role="alert">{target.error}</p>}
                  {(target.matches || []).map((match: any, index: number) => (
                    <p key={index}>
                      <code>
                        {match.path}:{match.line}
                      </code>{' '}
                      {match.text}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          )}
          {selected === 'onboarding-checklist' && Array.isArray(result?.steps) && (
            <div>
              <p>
                {result.member}：{result.completed} / {result.total} 已完成
              </p>
              {result.steps.map((step: any) => (
                <p key={step.id}>
                  {step.done ? '✓' : '○'} {step.title}
                  <button
                    onClick={() =>
                      setParameters(
                        JSON.stringify(
                          { mode: step.done ? 'reopen' : 'complete', member: result.member, stepId: step.id },
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    {step.done ? '重新打开' : '标为完成'}
                  </button>
                </p>
              ))}
            </div>
          )}
          {(selected === 'review-comments' || selected === 'review-threads') &&
            Array.isArray(result?.threads) &&
            result.threads.map((thread: any) => (
              <article className="feature-card" key={thread.id}>
                <b>
                  {thread.path}:{thread.line} · {thread.resolved ? '已解决' : '待处理'}
                </b>
                {thread.comments.map((comment: any) => (
                  <p key={comment.id}>
                    {comment.author}：{comment.body}
                  </p>
                ))}
                <button
                  className="secondary compact"
                  onClick={() =>
                    setParameters(
                      JSON.stringify(
                        { mode: thread.resolved ? 'reopen' : 'resolve', threadId: thread.id },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  {thread.resolved ? '重新打开' : '解决线程'}
                </button>
                <button
                  className="secondary compact"
                  onClick={() =>
                    setParameters(
                      JSON.stringify(
                        { mode: 'reply', threadId: thread.id, body: '', author: '本地用户' },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  回复
                </button>
              </article>
            ))}
        </>
      )}
    </div>
  );
}
