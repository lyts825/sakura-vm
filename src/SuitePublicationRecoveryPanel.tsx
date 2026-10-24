/** 只核对原发布，恢复不会重新提交业务动作或取得新资源。 */
import { useEffect, useState } from 'react';
import type { SuitePublicationPage } from '../shared/contracts/suite-common';
type Invoke = <T>(domain: string, method: string, input: unknown) => Promise<T>;
export function SuitePublicationRecoveryPanel({
  domain,
  workspaceId,
  invoke,
  run,
  preview,
}: {
  domain: string;
  workspaceId: string;
  invoke: Invoke;
  run: (work: () => Promise<unknown>, message?: string) => Promise<void>;
  preview: (domain: string, action: string, input: unknown, apply: string) => Promise<void>;
}) {
  const [page, setPage] = useState<SuitePublicationPage>({ items: [], next: null });
  useEffect(() => setPage({ items: [], next: null }), [domain, workspaceId]);
  return (
    <section>
      <h3>原发布与引用核对</h3>
      <p>中断后只确认原对象是否落盘，或释放未发布对象自己的保护引用。不会重放检查、接收或外部动作。</p>
      <button
        onClick={() =>
          void run(
            async () => setPage(await invoke(domain, 'publications', { workspaceId, cursor: 0, limit: 50 })),
            '已读取原发布记录',
          )
        }
      >
        核对本领域发布
      </button>
      {page.items.map((publication) => (
        <article className="suite-card" key={publication.id}>
          <strong>{publication.status}</strong>
          <p>
            {publication.referenceCount} 项固定引用 · {new Date(publication.createdAt).toLocaleString()}
          </p>
          <code>{publication.id}</code>
          <p>
            原对象 {publication.reference.id} / {publication.reference.revision.slice(0, 12)}
          </p>
          {['pending', 'unknown'].includes(publication.status) && (
            <button
              onClick={() =>
                void run(
                  () =>
                    preview(
                      domain,
                      'previewPublicationRecovery',
                      { workspaceId, id: publication.id },
                      'recoverPublication',
                    ),
                  '请核对原发布的恢复范围',
                )
              }
            >
              预览发布恢复
            </button>
          )}
        </article>
      ))}
      {page.next !== null && (
        <button
          onClick={() =>
            void run(async () => {
              const next = await invoke<SuitePublicationPage>(domain, 'publications', {
                workspaceId,
                cursor: page.next,
                limit: 50,
              });
              setPage((previous) => ({ items: [...previous.items, ...next.items], next: next.next }));
            }, '已加载后续发布')
          }
        >
          加载后续发布
        </button>
      )}
    </section>
  );
}
