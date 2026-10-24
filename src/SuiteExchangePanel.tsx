/** 工作台共用交接视图；所有读取和批准仍由所属领域服务核验。 */
import { useState } from 'react';
import { SuiteImportRecoveryPanel } from './SuiteImportRecoveryPanel';
import type * as S from '../shared/contracts/suite-common';
import {
  suiteReference as ref,
  suiteReferenceKey as key,
  suiteDigest,
  suiteBase64,
  suiteUnbase64,
  suiteDownload,
} from './suite-client';
type Invoke = <T>(domain: string, method: string, input?: unknown) => Promise<T>;
export function SuiteExchangePanel({
  invoke,
  workspaceId,
  domains,
  records,
  transfers,
  busy,
  run,
  preview,
  onAccepted,
  downloadName,
}: {
  invoke: Invoke;
  workspaceId: string;
  domains: Record<string, string>;
  records: Record<string, S.SuiteRecord[]>;
  transfers: S.SuiteUpload[];
  busy: boolean;
  run: (work: () => Promise<unknown>, message?: string) => Promise<void>;
  preview: (domain: string, action: string, input: unknown, apply: string) => Promise<void>;
  onAccepted: () => Promise<void>;
  downloadName: string;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [bundle, setBundle] = useState<File>();
  const scope = { workspaceId };
  const downloadable = (records.exchange ?? []).filter(
    (row) =>
      row.state === 'sealed' &&
      row.origin === 'local' &&
      row.content &&
      typeof row.content === 'object' &&
      !Array.isArray(row.content) &&
      row.content.format === 'sakura-suite-export/1',
  );
  return (
    <div className="suite-columns">
      <article>
        <h2>导出固定材料</h2>
        <p>预览包含完整引用图、来源许可和实际字节。当前交接包上限 16 MiB。</p>
        {Object.entries(domains)
          .filter(([domain]) => !['exchange', 'workbench'].includes(domain))
          .flatMap(([domain, title]) =>
            (records[domain] ?? [])
              .filter((row) => row.state === 'sealed' && row.origin === 'local' && row.kind !== 'source')
              .map((row) => (
                <label className="suite-check" key={key(row)}>
                  <input
                    type="checkbox"
                    checked={selected.includes(key(row))}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, key(row)]
                          : previous.filter((value) => value !== key(row)),
                      )
                    }
                  />
                  {title} · {row.name} · {row.revision.slice(0, 8)}
                </label>
              )),
          )}
        <button
          disabled={busy || !selected.length}
          onClick={() =>
            void run(
              () =>
                preview(
                  'exchange',
                  'previewExport',
                  {
                    ...scope,
                    references: Object.values(records)
                      .flat()
                      .filter((row) => selected.includes(key(row)))
                      .map(ref),
                  },
                  'export',
                ),
              '请核对完整导出计划',
            )
          }
        >
          预览导出
        </button>
        {downloadable.map((row) => (
          <div className="suite-card" key={key(row)}>
            <strong>{row.name}</strong>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const chunks: Uint8Array[] = [];
                  let offset = 0;
                  for (;;) {
                    const part = await invoke<{ data: string; offset: number; eof: boolean }>(
                        'exchange',
                        'download',
                        { ...scope, id: row.id, revision: row.revision, offset, length: 512 * 1024 },
                      ),
                      data = suiteUnbase64(part.data);
                    if (
                      part.offset !== offset + data.length ||
                      (!part.eof && !data.length) ||
                      part.offset > 16 * 1024 ** 2
                    )
                      throw new Error('交接下载回执无效');
                    chunks.push(data);
                    offset = part.offset;
                    if (part.eof) break;
                  }
                  const bytes = new Uint8Array(offset);
                  let position = 0;
                  for (const chunk of chunks) {
                    bytes.set(chunk, position);
                    position += chunk.length;
                  }
                  if (
                    !row.content ||
                    typeof row.content !== 'object' ||
                    Array.isArray(row.content) ||
                    (await suiteDigest(bytes)) !== row.content.digest
                  )
                    throw new Error('交接包摘要不同');
                  suiteDownload(bytes, downloadName);
                }, '下载已核对摘要')
              }
            >
              下载 ZIP
            </button>
          </div>
        ))}
      </article>
      <article>
        <h2>隔离接收</h2>
        <label>
          交接 ZIP
          <input type="file" accept=".zip" onChange={(event) => setBundle(event.target.files?.[0])} />
        </label>
        <button
          disabled={busy || !bundle}
          onClick={() =>
            void run(async () => {
              if (!bundle || bundle.size > 16 * 1024 ** 2) throw new Error('交接包最多 16 MiB');
              const bytes = new Uint8Array(await bundle.arrayBuffer()),
                upload = await invoke<S.SuiteUpload>('exchange', 'beginImport', {
                  ...scope,
                  name: bundle.name,
                  bytes: bytes.length,
                  digest: await suiteDigest(bytes),
                });
              for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
                await invoke('exchange', 'appendImport', {
                  ...scope,
                  id: upload.id,
                  offset,
                  data: suiteBase64(bytes.subarray(offset, offset + 512 * 1024)),
                });
              const inspected = await invoke<{ inspection: S.SuiteRecord; plan: S.SuitePlan }>(
                'exchange',
                'inspectImport',
                { ...scope, id: upload.id },
              );
              await preview(
                'exchange',
                'inspectPlan',
                { ...scope, planId: inspected.plan.id },
                'acceptImport',
              );
              await onAccepted();
            }, '完整性核对完成，等待显式接受')
          }
        >
          上传并核对
        </button>
        <p>接受创建新的空间和 ID。导入的审阅只作参考，发布需要在本机重新检查和决定。</p>
        <h3>交接暂存</h3>
        <p>共 {transfers.length} 项，显示最近 50 项。被正式记录保护的字节须先归档并清理记录。</p>
        {transfers
          .slice(-50)
          .reverse()
          .map((upload) => (
            <div className="suite-card" key={upload.id}>
              <strong>{upload.name}</strong>
              <p>
                {upload.state} · {upload.offset} / {upload.bytes} 字节
              </p>
              {upload.state !== 'discarded' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => invoke('exchange', 'discardImport', { ...scope, id: upload.id }),
                      '暂存已核销',
                    )
                  }
                >
                  取消暂存
                </button>
              )}
            </div>
          ))}
      </article>
      <SuiteImportRecoveryPanel
        workspaceId={workspaceId}
        records={records.exchange ?? []}
        invoke={invoke}
        busy={busy}
        run={run}
        preview={preview}
      />
    </div>
  );
}
