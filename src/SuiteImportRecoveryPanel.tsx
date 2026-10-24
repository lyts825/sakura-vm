/** 隔离核销与接收回执共用入口；每次执行都先取得新的服务端计划。 */
import { useState } from 'react';
import type * as S from '../shared/contracts/suite-common';
import { suiteReference, suiteReferenceKey } from './suite-client';
type Invoke = <T>(domain: string, method: string, input?: unknown) => Promise<T>;
export function SuiteImportRecoveryPanel({
  workspaceId,
  records,
  invoke,
  busy,
  run,
  preview,
}: {
  workspaceId: string;
  records: S.SuiteRecord[];
  invoke: Invoke;
  busy: boolean;
  run: (work: () => Promise<unknown>, message?: string) => Promise<void>;
  preview: (domain: string, action: string, input: unknown, apply: string) => Promise<void>;
}) {
  const [quarantines, setQuarantines] = useState<S.SuiteQuarantine[]>(),
    scope = { workspaceId };
  const latest = new Map<string, S.SuiteRecord>();
  for (const row of records)
    if (!latest.has(row.id) || latest.get(row.id)!.sequence < row.sequence) latest.set(row.id, row);
  const receipts = [...latest.values()].filter(
    (row) =>
      row.origin === 'local' &&
      row.state === 'sealed' &&
      row.content &&
      typeof row.content === 'object' &&
      !Array.isArray(row.content) &&
      row.content.format === 'sakura-suite-receipt/1' &&
      row.content.state === 'staged',
  );
  return (
    <article>
      <h2>接收中断恢复</h2>
      <p>空间已发布而回执未确认时，可复核原对象和字节后确认接收。此操作保留原 ID 和人工审批边界。</p>
      {receipts.length === 0 && <p>当前交接记录页没有待确认回执。更早记录可在“历史与清理”中查询。</p>}
      {receipts.map((receipt) => (
        <div className="suite-card" key={suiteReferenceKey(receipt)}>
          <strong>{receipt.name}</strong>
          <code>{receipt.id}</code>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  preview(
                    'exchange',
                    'previewImportRecovery',
                    { ...scope, receipt: suiteReference(receipt) },
                    'recoverImport',
                  ),
                '请核对原接收对象和回执',
              )
            }
          >
            预览接收回执恢复
          </button>
        </div>
      ))}
      <h3>未发布的隔离空间</h3>
      <p>核销前列出原对象、保护引用和容量预留。未知占用会保留账本并阻止关闭；核销回执保存在当前接收空间。</p>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setQuarantines(await invoke<S.SuiteQuarantine[]>('exchange', 'quarantines', scope));
          }, '隔离列表已刷新')
        }
      >
        刷新隔离列表
      </button>
      {quarantines && <p>查询到 {quarantines.length} 个隔离空间，显示最近 50 项。操作后可刷新状态。</p>}
      {quarantines?.slice(-50).reverse().map((item) => (
        <div className="suite-card" key={item.workspace.id}>
          <strong>{item.workspace.name}</strong>
          <p>
            {item.disposition === 'discarded' ? '已核销' : '待核销'} · 未核销预留 {item.reservations.length} 项
          </p>
          <code>{item.workspace.id}</code>
          {item.receipt && <p>回执所在接收空间：{item.receipt.workspaceId}</p>}
          <button
            disabled={busy || (item.receipt !== null && item.receipt.workspaceId !== workspaceId)}
            onClick={() =>
              void run(
                () =>
                  preview(
                    'exchange',
                    'previewQuarantineDiscard',
                    { ...scope, targetWorkspaceId: item.workspace.id },
                    'discardQuarantine',
                  ),
                '请核对隔离对象及原资源核销计划',
              )
            }
          >
            {item.disposition === 'discarded' ? '预览核销回执确认' : '预览隔离核销'}
          </button>
        </div>
      ))}
    </article>
  );
}
