import { useCallback, useEffect, useRef, useState } from 'react';
import {
  recoveryListSchema,
  recoveryViewSchema,
  type RecoveryView,
  type RecoveryDiagnostics,
} from '../shared/contracts/recovery';
import type { Request } from './feature-shared';
import { formatDateTime } from './localization';

export function RecoveryPanel({ request }: { request: Request }) {
  const [records, setRecords] = useState<RecoveryView[]>([]);
  const [diagnostics, setDiagnostics] = useState<RecoveryDiagnostics>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(20);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request<unknown>('/recoveries', 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      const parsed = recoveryListSchema.safeParse(result);
      if (!parsed.success) throw new Error('恢复目录响应格式无效，请刷新重试。');
      setRecords(parsed.data.records);
      setDiagnostics(parsed.data.diagnostics);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '读取恢复记录失败，请重试。');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }, [request]);
  useEffect(() => {
    void load();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [load]);
  const retry = async (record: RecoveryView, action: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request<unknown>(
        '/recoveries',
        'POST',
        { id: record.id, digest: record.digest, action },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const parsed = recoveryViewSchema.safeParse(result);
      if (!parsed.success || parsed.data.id !== record.id)
        throw new Error('恢复操作响应格式无效，请刷新重试。');
      setRecords((values) => values.map((value) => (value.id === record.id ? parsed.data : value)));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '执行恢复操作失败，请重试。');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const rebuild = async () => {
    if (active.current || !diagnostics) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request<unknown>(
        '/recoveries/rebuild',
        'POST',
        { revision: diagnostics.revision },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const parsed = recoveryListSchema.safeParse(result);
      if (!parsed.success) throw new Error('重建响应格式无效，请刷新核对目录状态。');
      setRecords(parsed.data.records);
      setDiagnostics(parsed.data.diagnostics);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '重建失败，原文件和领域票据仍保留。');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const pending = records.filter((record) => record.state !== 'resolved');
  return (
    <details className="plugin-recovery">
      <summary>资源恢复{pending.length ? ` · ${pending.length} 项待处理` : ''}</summary>
      <div className="plugin-recovery-content">
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? '正在处理…' : '刷新恢复记录'}
        </button>
        {error && <p role="alert">{error}</p>}
        {diagnostics?.state === 'degraded' && (
          <div role="alert">
            <p>{diagnostics.message}</p>
            <p>
              目录已暂停恢复操作，迁移封锁与待清理资源继续保留。重建会先保留原文件副本，再从所属服务重新发现票据。
            </p>
            {!!diagnostics.sourceFailures.length && (
              <p>待检查服务：{diagnostics.sourceFailures.join('、')}</p>
            )}
            <button type="button" disabled={busy} onClick={() => void rebuild()}>
              保留原文件并重建目录
            </button>
          </div>
        )}
        {diagnostics?.quarantineFile && <p>原目录副本：{diagnostics.quarantineFile}</p>}
        {!pending.length && !error && diagnostics?.state !== 'degraded' && <p>没有待恢复资源。</p>}
        {pending.slice(0, limit).map((record) => (
          <article key={record.id} className="plugin-recovery-record">
            <strong>{record.binding.pluginInstanceId || record.binding.owner}</strong>
            <p>
              {record.binding.domain === 'plugin-lifecycle' ? '插件清理' : '资源所属服务'} ·{' '}
              {record.resourceIds.length} 项资源
            </p>
            {record.binding.vmId && (
              <p>
                实例：{record.binding.vmId}
                {record.binding.projectId ? ` · 项目：${record.binding.projectId}` : ''}
              </p>
            )}
            {record.error && <p>{record.error}</p>}
            {record.actions.length ? (
              record.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void retry(record, action.id)}
                >
                  {action.title}
                </button>
              ))
            ) : (
              <p>请通过所属服务的恢复入口处理；原清理票据仍保留。</p>
            )}
            <details>
              <summary>原始记录</summary>
              <p>记录：{record.id}</p>
              {record.binding.pluginGeneration && <p>代次：{record.binding.pluginGeneration}</p>}
              {record.binding.artifactDigest && <p>产物：{record.binding.artifactDigest}</p>}
              <p>
                首次发现：{formatDateTime(record.firstSeenAt)} · 已尝试 {record.attempts} 次
              </p>
            </details>
          </article>
        ))}
        {pending.length > limit && (
          <button type="button" onClick={() => setLimit((value) => value + 20)}>
            显示更多
          </button>
        )}
      </div>
    </details>
  );
}
