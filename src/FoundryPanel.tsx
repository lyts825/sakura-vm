import './plugin-fonts.css';
/** 工坊阶段界面；所有修改先展示固定计划，后台任务可恢复。 */
import { useEffect, useRef, useState } from 'react';
import type { FeatureProps } from './feature-shared';
import { DeliveryHash } from './delivery-transfer';
import {
  foundryActionSchema,
  foundryResultSchema,
  foundryViewSchema,
  foundrySections,
  type FoundryAction,
  type FoundryPlan,
  type FoundryRecord,
  type FoundryView,
} from '../shared/contracts/foundry';
import type { ImageLease, ImageUpload } from '../shared/contracts/image-assets';
const labels = ['来源', '蓝图', '离线材料', '制作', '身份清理', '验收', '镜像库', '交接', '总览'];
const b64 = (bytes: Uint8Array) => {
  let str = '';
  for (let n = 0; n < bytes.length; n += 16384) str += String.fromCharCode(...bytes.subarray(n, n + 16384));
  return btoa(str);
};
type FoundryPanelProps = Pick<FeatureProps, 'request' | 'token' | 'projectId' | 'onDevelopmentNavigate'> &
  Partial<Pick<FeatureProps, 'vm'>> & { section: (typeof foundrySections)[number] };
export function FoundryPanel(props: FoundryPanelProps) {
  return (
    <Panel
      key={
        props.section +
        ':' +
        (props.vm?.id || 'host') +
        ':' +
        (props.projectId || 'local') +
        ':' +
        props.token
      }
      {...props}
    />
  );
}
function Panel({ request, section, onDevelopmentNavigate }: FoundryPanelProps) {
  const [scope, setScope] = useState('local'),
    [view, setView] = useState<FoundryView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(''),
    [plan, setPlan] = useState<FoundryPlan | null>(null),
    [reviewed, setReviewed] = useState(false),
    [draft, setDraft] = useState(''),
    [distro, setDistro] = useState<'alpine' | 'debian' | 'ubuntu'>('alpine'),
    [arch, setArch] = useState<'x86_64' | 'aarch64'>('x86_64'),
    [progress, setProgress] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [descriptor, setDescriptor] = useState('');
  const [cleanup, setCleanup] = useState<{ token: string; assets: string[]; protected: string[] } | null>(
    null,
  );
  const lifetime = useRef(new AbortController());
  useEffect(() => () => lifetime.current.abort(), []);
  const url = '/foundry-' + section + '?workspaceId=' + encodeURIComponent(scope);
  const load = async () => {
    const next = foundryViewSchema.parse(await request(url, 'GET', undefined, lifetime.current.signal));
    if (!lifetime.current.signal.aborted) setView(next);
  };
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setPlan(null);
    setReviewed(false);
    setSelected('');
    const poll = () =>
      request(url, 'GET', undefined, controller.signal)
        .then(foundryViewSchema.parse)
        .then((v) => {
          if (!controller.signal.aborted) setView(v);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(String(e));
        });
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [url, request]);
  useEffect(() => {
    setPlan(null);
    setReviewed(false);
  }, [selected, draft, scope, distro, arch]);
  const act = async (input: FoundryAction) =>
    foundryResultSchema.parse(
      await request(url, 'POST', foundryActionSchema.parse(input), lifetime.current.signal),
    );
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (e) {
      if (!lifetime.current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  };
  const rows = view?.rows || [],
    own = rows.filter((r) => r.section === section),
    picked = rows.find((r) => r.id === selected);
  const preparePlan = (task: FoundryPlan['input']['task']) =>
    run(async () => {
      const result = await act({ action: 'plan', input: { task, id: selected, name: '', reviewed: true } });
      if (!('token' in result) || !('input' in result)) throw new Error('计划响应不完整');
      setPlan(result);
      setReviewed(false);
    });
  const upload = () =>
    run(async () => {
      if (!file) throw new Error('请选择 QCOW2 镜像');
      if (file.size > 32 * 1024 ** 3) throw new Error('镜像超过 32 GiB');
      const hash = new DeliveryHash();
      for (let offset = 0; offset < file.size; offset += 524288) {
        lifetime.current.signal.throwIfAborted();
        hash.update(new Uint8Array(await file.slice(offset, offset + 524288).arrayBuffer()));
        setProgress('核对 ' + Math.round((offset / file.size) * 100) + '%');
      }
      const digest = hash.digest();
      const upload = (await act({
        action: 'begin-import',
        input: { digest, bytes: file.size, distro, architecture: arch, source: 'local-upload' },
      })) as ImageUpload;
      for (let offset = 0; offset < file.size; offset += 524288) {
        const bytes = new Uint8Array(await file.slice(offset, offset + 524288).arrayBuffer());
        const next = (await act({
          action: 'append-import',
          id: upload.id,
          offset,
          data: b64(bytes),
        })) as ImageUpload;
        if (next.offset !== offset + bytes.length) throw new Error('上传偏移不符');
        setProgress('上传 ' + Math.round((next.offset / file.size) * 100) + '%');
      }
      await act({ action: 'finish-import', id: upload.id });
      setProgress('镜像已校验，导入内容尚未执行');
    });
  const download = (row: FoundryRecord) =>
    run(async () => {
      if (!row.image) throw new Error('此记录没有磁盘');
      const picker = (
        window as unknown as {
          showSaveFilePicker?: (options: unknown) => Promise<{
            createWritable: () => Promise<{
              write: (b: Uint8Array) => Promise<void>;
              close: () => Promise<void>;
              abort: () => Promise<void>;
            }>;
          }>;
        }
      ).showSaveFilePicker;
      if (!picker) throw new Error('大型镜像下载需要支持流式文件保存的浏览器，或使用 foundry CLI');
      const handle = await picker({ suggestedName: row.image.id + '.qcow2' }),
        writer = await handle.createWritable();
      let lease: ImageLease | undefined;
      try {
        lease = (await act({ action: 'open-read', id: row.id })) as ImageLease;
        let offset = 0;
        const hash = new DeliveryHash();
        while (offset < row.image.bytes) {
          const length = Math.min(524288, row.image.bytes - offset),
            result = await act({
              action: 'read',
              imageRef: lease.imageRef,
              token: lease.token,
              offset,
              length,
            });
          if (!('data' in result) || !('eof' in result)) throw new Error('下载响应无效');
          const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
          if (
            bytes.length !== length ||
            result.offset !== offset + length ||
            result.eof !== (result.offset === row.image.bytes)
          )
            throw new Error('下载偏移不符');
          hash.update(bytes);
          await writer.write(bytes);
          offset = result.offset;
          setProgress('下载 ' + Math.round((offset / row.image.bytes) * 100) + '%');
        }
        if (hash.digest() !== row.image.digest) throw new Error('下载摘要不符');
        await writer.close();
        setDescriptor(
          JSON.stringify(
            { format: 'sakura-image-v1', image: row.image, blueprint: row.blueprint, signature: null },
            null,
            2,
          ),
        );
      } catch (e) {
        await writer.abort();
        throw e;
      } finally {
        if (lease)
          await request(
            url,
            'POST',
            { action: 'close-read', token: lease.token },
            AbortSignal.timeout(5000),
          ).catch(() => {});
      }
    });
  const taskButtons: Partial<
    Record<typeof section, { task: FoundryPlan['input']['task']; label: string; from: string[] }[]>
  > = {
    depot: [{ task: 'materials', label: '预览联网取材计划', from: ['blueprints'] }],
    builders: [{ task: 'build', label: '预览离线制作计划', from: ['depot'] }],
    sanitizers: [{ task: 'sanitize', label: '预览身份清理计划', from: ['builders', 'sanitizers'] }],
    checks: [{ task: 'check', label: '预览双实例断网验收', from: ['sanitizers'] }],
    catalog: [
      { task: 'publish', label: '发布已验收镜像', from: ['checks'] },
      { task: 'instantiate', label: '创建持久隔离实例', from: ['catalog'] },
      { task: 'withdraw', label: '撤回镜像', from: ['catalog'] },
    ],
    exchange: [
      { task: 'export', label: '准备交接清单', from: ['catalog'] },
      { task: 'accept', label: '审阅接收导入', from: ['exchange'] },
    ],
  };
  return (
    <section style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <h3>环境镜像工坊 · {labels[foundrySections.indexOf(section)]}</h3>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {foundrySections.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onDevelopmentNavigate?.('foundry-' + s)}
            disabled={!onDevelopmentNavigate || s === section}
          >
            {labels[i]}
          </button>
        ))}
      </nav>
      <label>
        工坊空间{' '}
        <input value={scope} maxLength={128} onChange={(e) => setScope(e.target.value)} disabled={busy} />
      </label>
      <p>独立镜像固定字节摘要。联网取材、制作、清理和接收分别审阅；安装或导入不会替换当前实例。</p>
      {error && <p role="alert">{error}</p>}
      {progress && <p role="status">{progress}</p>}
      {!!view?.pendingUploads.length && (
        <fieldset>
          <legend>未完成上传</legend>
          {view.pendingUploads.map((upload) => (
            <div key={upload.id}>
              <p>
                {upload.id} · {upload.offset} / {upload.bytes} 字节
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await act({ action: 'finish-import', id: upload.id });
                  })
                }
              >
                核验完整内容并完成导入
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await act({ action: 'discard-import', id: upload.id, reviewed: true });
                  })
                }
              >
                丢弃此暂存并释放配额
              </button>
            </div>
          ))}
        </fieldset>
      )}
      {section === 'workbench' && (
        <>
          <p>
            按来源、蓝图、材料、制作、清理、验收、镜像库和交接依次完成。各阶段保存自己的记录，关闭页面后可回来查看。
          </p>
          <ul>
            {foundrySections.slice(0, -1).map((s, i) => (
              <li key={s}>
                {labels[i]}：{rows.filter((r) => r.section === s).length} 条记录
              </li>
            ))}
          </ul>
        </>
      )}
      {(section === 'sources' || section === 'exchange') && (
        <fieldset>
          <legend>镜像输入</legend>
          <label>
            发行版{' '}
            <select value={distro} onChange={(e) => setDistro(e.target.value as typeof distro)}>
              <option>alpine</option>
              <option>debian</option>
              <option>ubuntu</option>
            </select>
          </label>
          <label>
            架构{' '}
            <select value={arch} onChange={(e) => setArch(e.target.value as typeof arch)}>
              <option>x86_64</option>
              <option>aarch64</option>
            </select>
          </label>
          {section === 'sources' && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await act({ action: 'prepare', distro, architecture: arch, reviewed: true });
                })
              }
            >
              固定已准备的基础镜像
            </button>
          )}
          <p>基础镜像未下载时，先在发行版镜像页明确下载，或在此上传独立 QCOW2。</p>
          <input type="file" accept=".qcow2" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button disabled={busy || !file} onClick={upload}>
            校验并上传，不启动内容
          </button>
        </fieldset>
      )}
      {section === 'blueprints' && (
        <fieldset>
          <legend>冻结蓝图修订</legend>
          <label>
            基础来源{' '}
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">请选择</option>
              {rows
                .filter((r) => r.section === 'sources' && r.state === 'ready')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.digest.slice(0, 12)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            模板{' '}
            <select
              defaultValue=""
              onChange={(e) => {
                const t = view?.templates[Number(e.target.value)];
                if (t)
                  setDraft(
                    JSON.stringify(
                      {
                        ...t,
                        packages:
                          picked?.image?.distro === 'alpine'
                            ? t.packages
                            : t.packages.map(
                                (p) =>
                                  ({
                                    shadow: 'passwd',
                                    'musl-dev': 'libc6-dev',
                                    'linux-headers': 'linux-libc-dev',
                                  })[p] || p,
                              ),
                      },
                      null,
                      2,
                    ),
                  );
              }}
            >
              <option value="" disabled>
                选择模板
              </option>
              {view?.templates.map((t, i) => (
                <option value={i} key={i}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            rows={14}
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="蓝图 JSON"
          />
          <button
            disabled={busy || !selected || !draft}
            onClick={() =>
              run(async () => {
                await act({
                  action: 'save',
                  expectedRevision: 0,
                  blueprint: { ...JSON.parse(draft), sourceId: selected },
                });
              })
            }
          >
            保存为不可变修订
          </button>
        </fieldset>
      )}
      {taskButtons[section] && (
        <fieldset>
          <legend>下一阶段</legend>
          <select aria-label="选择阶段输入" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">选择已有记录</option>
            {rows
              .filter((r) => taskButtons[section]!.some((t) => t.from.includes(r.section)))
              .map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name} · {r.state} · {r.digest.slice(0, 8)}
                </option>
              ))}
          </select>
          {taskButtons[section]!.map((t) => (
            <button
              key={t.task}
              disabled={busy || !picked || !t.from.includes(picked.section)}
              onClick={() => preparePlan(t.task)}
            >
              {t.label}
            </button>
          ))}
        </fieldset>
      )}
      {section === 'sanitizers' && (
        <details>
          <summary>接收外部镜像后，登记本机清理输入</summary>
          <p>粘贴交接描述；这里还会要求独立清理计划和本机验收。</p>
          <textarea
            rows={10}
            style={{ width: '100%', boxSizing: 'border-box' }}
            aria-label="导入镜像描述"
            value={descriptor}
            onChange={(e) => setDescriptor(e.target.value)}
          />
          <button
            disabled={busy || !descriptor}
            onClick={() =>
              run(async () => {
                const value = JSON.parse(descriptor);
                await act({
                  action: 'stage-import',
                  image: value.image,
                  blueprint: value.blueprint,
                  reviewed: true,
                });
              })
            }
          >
            登记待清理候选
          </button>
        </details>
      )}
      {plan && (
        <fieldset>
          <legend>执行前审阅</legend>
          <p>{plan.description}</p>
          <p>
            网络：{plan.network}；到期：{plan.expiresAt}
          </p>
          <code style={{ overflowWrap: 'anywhere' }}>{plan.dependencyDigest}</code>
          <label>
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            已核对该输入、网络和资源影响
          </label>
          <button
            disabled={busy || !reviewed}
            onClick={() =>
              run(async () => {
                await act({ action: 'execute', token: plan.token });
                setPlan(null);
                setReviewed(false);
              })
            }
          >
            执行此计划
          </button>
        </fieldset>
      )}
      <div>
        {section === 'catalog' && (
          <fieldset>
            <legend>镜像容量回收</legend>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await act({ action: 'cleanup-plan' });
                  if ('assets' in result) setCleanup(result);
                })
              }
            >
              预览无引用镜像
            </button>
            {cleanup && (
              <>
                <p>
                  可回收 {cleanup.assets.length} 个；引用或租约保护 {cleanup.protected.length}{' '}
                  个。确认后按本次预览执行。
                </p>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {cleanup.assets.join('\n')}
                </pre>
                <button
                  disabled={busy || !cleanup.assets.length}
                  onClick={() =>
                    run(async () => {
                      await act({ action: 'cleanup', token: cleanup.token });
                      setCleanup(null);
                    })
                  }
                >
                  确认回收这些镜像
                </button>
              </>
            )}
          </fieldset>
        )}
        {own.map((row) => (
          <article
            key={row.id}
            style={{
              border: '1px solid var(--border-color, #8884)',
              padding: 12,
              marginBottom: 8,
              overflowWrap: 'anywhere',
            }}
          >
            <strong>{row.name}</strong>
            <p>
              {row.state} · 清理 {row.cleanup} · {row.trust === 'unverified' ? '来源未认证' : '本机记录'}
            </p>
            <code>{row.digest}</code>
            {row.error && <p role="alert">{row.error}</p>}
            {row.evidence && (
              <details>
                <summary>查看实际证据</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.evidence}</pre>
              </details>
            )}
            {row.state === 'running' && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await act({ action: 'cancel', id: row.id });
                  })
                }
              >
                请求取消
              </button>
            )}
            {(row.cleanup !== 'confirmed' || row.receipts.some((r) => r.cleanup !== 'confirmed')) && (
              <button
                disabled={busy}
                onClick={() => {
                  setSelected(row.id);
                  void run(async () => {
                    const p = await act({
                      action: 'plan',
                      input: { task: 'recover', id: row.id, name: '', reviewed: true },
                    });
                    if ('input' in p) setPlan(p);
                  });
                }}
              >
                恢复原资源清理
              </button>
            )}
            {row.cleanup === 'confirmed' &&
              !['queued', 'running', 'published', 'archived'].includes(row.state) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await act({ action: 'archive', id: row.id, expectedRevision: row.revision });
                    })
                  }
                >
                  归档并释放本记录引用
                </button>
              )}
            {row.image && (
              <button disabled={busy} onClick={() => download(row)}>
                流式下载磁盘
              </button>
            )}
            {row.image && (
              <button
                onClick={() =>
                  setDescriptor(
                    JSON.stringify(
                      {
                        format: 'sakura-image-v1',
                        image: row.image,
                        blueprint: row.blueprint,
                        signature: null,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                显示交接描述
              </button>
            )}
          </article>
        ))}
      </div>
      {descriptor && section !== 'sanitizers' && (
        <details open>
          <summary>交接描述，与磁盘一起保存</summary>
          <textarea
            readOnly
            rows={10}
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={descriptor}
          />
        </details>
      )}
    </section>
  );
}
