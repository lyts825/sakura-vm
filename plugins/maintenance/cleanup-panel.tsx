/** 中文：展示逐提供者的清理范围、保护理由及一次性确认。English: Show provider-specific candidates, protection reasons and one-use confirmation. */
import { useState } from 'react';
import { cleanupPreviewSchema, cleanupProvidersSchema, cleanupResultSchema, type CleanupPreview, type CleanupResult } from '../../shared/contracts/cleanup-plan.ts';
import type { Request } from '../../src/feature-shared';
import { Feedback, formatBytes, useAction, useRemote } from '../../src/feature-shared';

export function CleanupPanel({ request }: { request: Request }) {
  const remote = useRemote<unknown>(request, '/cleanup');
  // 中文：无效来源只影响清理面板，原有磁盘维护入口继续可用。English: Invalid provider data affects cleanup only, preserving the disk maintenance controls.
  const providers = cleanupProvidersSchema.safeParse(remote.data);
  const providerError = remote.data !== null && !providers.success ? '清理来源响应无效，请刷新后重试。' : '';
  const [plan, setPlan] = useState<CleanupPreview | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const action = useAction();
  return <section aria-label="安全清理中心">
    <h3>安全清理中心</h3>
    <p className="subtle-note">先预览清单，再确认本次清理。预览 5 分钟内有效；引用或日志变化后需要重新预览。</p>
    <div className="feature-actions">
      {!remote.error && providers.success && providers.data.providers.map((provider) => <button key={provider.id} className="secondary compact" disabled={action.busy}
        title={provider.description} onClick={() => void action.run(async (signal) => {
          setPlan(null); setResult(null); setConfirmed(false);
          const result = await request<CleanupPreview>('/cleanup/preview', 'POST', { provider: provider.id }, signal);
          signal.throwIfAborted(); setPlan(cleanupPreviewSchema.parse(result));
        })}>预览{provider.label}</button>)}
    </div>
    <Feedback error={action.error || remote.error || providerError} />
    {result && <p role="status">本次已清理 {result.removedCount} 项，释放日志正文或备份块 {formatBytes(result.reclaimedBytes)}。</p>}
    {plan && <>
      <p>候选 {plan.candidateCount} 项 · 预计释放 {formatBytes(plan.estimatedBytes)} · 保留 {plan.entries.length - plan.candidateCount} 项</p>
      {plan.notes.map((note) => <p className="subtle-note" key={note}>{note}</p>)}
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {plan.entries.length === 0 && <p>当前没有可检查的内容。</p>}
        {plan.entries.map((entry) => <div className="diagnostic-row" key={entry.id}>
          <b style={{ overflowWrap: 'anywhere' }}>{entry.eligible ? '待清理' : '保留'} · {entry.label}</b>
          <p style={{ overflowWrap: 'anywhere' }}>来源：{entry.source} · 归属：{entry.owner} · {formatBytes(entry.bytes)}</p>
          <p>{entry.reason}</p>
        </div>)}
      </div>
      <label><input type="checkbox" checked={confirmed} disabled={action.busy || !plan.candidateCount}
        onChange={(event) => setConfirmed(event.target.checked)} /> 我已检查候选清单，确认清理列出的内容</label>
      <button className="secondary compact" disabled={action.busy || !confirmed || !plan.candidateCount}
        onClick={() => void action.run(async (signal) => {
          const current = plan;
          // 中文：提交后即移除本地令牌，失败也要求重新预览。English: Drop the local token on submission, including failures.
          setPlan(null); setConfirmed(false);
          const result = await request<CleanupResult>('/cleanup/execute', 'POST', { provider: current.provider, token: current.token }, signal);
          signal.throwIfAborted(); setResult(cleanupResultSchema.parse(result));
        })}>执行本次清理</button>
    </>}
  </section>;
}
