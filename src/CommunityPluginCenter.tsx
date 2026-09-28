import { useCallback, useEffect, useState } from 'react';
import type { Request } from './feature-shared';

type Entry = {
  id: string;
  name: string;
  description: string;
  version: string;
  sha256: string;
  publisher: string;
};
type View = {
  publishers: Array<{ fingerprint: string; name: string }>;
  sources: Array<{ id: string; name: string; url: string }>;
  installed: Array<Entry & { sourceId: string }>;
  catalogs: Record<string, Entry[]>;
  problems?: Record<string, string>;
};
const validView = (value: unknown): value is View => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<View>;
  return (
    Array.isArray(candidate.publishers) &&
    Array.isArray(candidate.sources) &&
    Array.isArray(candidate.installed) &&
    !!candidate.catalogs &&
    typeof candidate.catalogs === 'object'
  );
};

export function CommunityPluginCenter({ request }: { request: Request }) {
  const [view, setView] = useState<View | null>(null);
  const [publisherName, setPublisherName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [input, setInput] = useState('{}');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const data = await request<View>('/community-plugins', 'GET', undefined, signal);
      if (!validView(data)) throw new Error('第三方插件目录响应无效');
      if (!signal?.aborted) setView(data);
    },
    [request],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError((e as Error).message);
    });
    return () => abort.abort();
  }, [load]);
  const act = async (operation: Record<string, unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await request<any>('/community-plugins', 'POST', operation);
      if (operation.operation === 'run') setResult(JSON.stringify(response, null, 2));
      else {
        if (!validView(response)) throw new Error('第三方插件目录响应无效');
        setView(response);
      }
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="community-plugins" aria-label="第三方插件市场">
      <h2>第三方插件市场</h2>
      <p className="muted">
        添加信任的 Ed25519 发布者和 HTTPS 目录源。安装前核对签名与文件摘要；运行时插件只能处理 JSON
        数据，无法访问宿主服务。
      </p>
      {error && (
        <p role="alert" className="machine-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="feature-success">
          {notice}
        </p>
      )}
      <div className="community-plugin-forms">
        <div>
          <h3>信任发布者</h3>
          <label>
            名称
            <input value={publisherName} onChange={(event) => setPublisherName(event.target.value)} />
          </label>
          <label>
            Ed25519 公钥（PEM）
            <textarea rows={4} value={publicKey} onChange={(event) => setPublicKey(event.target.value)} />
          </label>
          <button
            className="secondary compact"
            disabled={busy || !publisherName.trim() || !publicKey.trim()}
            onClick={() =>
              void act({ operation: 'trust', name: publisherName, publicKey }, '发布者已加入信任列表')
            }
          >
            添加信任
          </button>
        </div>
        <div>
          <h3>添加插件目录</h3>
          <label>
            名称
            <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
          </label>
          <label>
            HTTPS 目录 URL
            <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
          </label>
          <button
            className="secondary compact"
            disabled={busy || !sourceName.trim() || !sourceUrl.trim()}
            onClick={() =>
              void act(
                { operation: 'add-source', name: sourceName, url: sourceUrl },
                '目录源已保存，请刷新目录',
              )
            }
          >
            添加目录源
          </button>
        </div>
      </div>
      {view && (
        <>
          <h3>信任的发布者</h3>
          {view.publishers.length === 0 ? (
            <p className="muted">尚无受信任发布者。</p>
          ) : (
            <ul>
              {view.publishers.map((item) => (
                <li key={item.fingerprint}>
                  {item.name} · <code>{item.fingerprint.slice(0, 16)}…</code>{' '}
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() =>
                      void act({ operation: 'untrust', fingerprint: item.fingerprint }, '已撤销发布者信任')
                    }
                  >
                    撤销信任
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3>目录与可安装插件</h3>
          {view.sources.length === 0 ? (
            <p className="muted">尚无目录源。</p>
          ) : (
            view.sources.map((source) => (
              <div className="community-plugin-source" key={source.id}>
                <div>
                  <strong>{source.name}</strong> <code>{source.url}</code>
                </div>
                <div className="community-plugin-actions">
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void act({ operation: 'refresh', id: source.id }, '插件目录已刷新')}
                  >
                    刷新目录
                  </button>
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void act({ operation: 'remove-source', id: source.id }, '目录源已移除')}
                  >
                    移除目录源
                  </button>
                </div>
                {(view.catalogs[source.id] || []).map((entry) => {
                  const installed = view.installed.find((item) => item.id === entry.id);
                  const trusted = view.publishers.some((item) => item.fingerprint === entry.publisher);
                  return (
                    <div className="community-plugin-entry" key={entry.id}>
                      <div>
                        <strong>{entry.name}</strong>{' '}
                        <code>
                          {entry.id}@{entry.version}
                        </code>
                        <p>{entry.description}</p>
                        <small>
                          {trusted ? '签名发布者已受信任' : '发布者尚未受信任'} · SHA-256{' '}
                          {entry.sha256.slice(0, 16)}…
                        </small>
                      </div>
                      <button
                        className="secondary compact"
                        disabled={
                          busy ||
                          !trusted ||
                          (installed?.version === entry.version && installed.sha256 === entry.sha256)
                        }
                        onClick={() =>
                          void act(
                            { operation: 'install', sourceId: source.id, pluginId: entry.id },
                            '插件已验证并安装',
                          )
                        }
                      >
                        {installed ? '更新' : '安装'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <h3>已安装的隔离插件</h3>
          {view.installed.length === 0 ? (
            <p className="muted">尚无已安装插件。</p>
          ) : (
            <>
              <label>
                测试输入（JSON）
                <textarea rows={4} value={input} onChange={(event) => setInput(event.target.value)} />
              </label>
              {view.installed.map((item) => (
                <div className="community-plugin-entry" key={item.id}>
                  <span>
                    <strong>{item.name}</strong>{' '}
                    <code>
                      {item.id}@{item.version}
                    </code>
                    {view.problems?.[item.id] && <small role="alert"> · {view.problems[item.id]}</small>}
                  </span>
                  <div className="community-plugin-actions">
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        try {
                          void act(
                            { operation: 'run', pluginId: item.id, input: JSON.parse(input) },
                            '插件运行完成',
                          );
                        } catch {
                          setError('测试输入需要有效的 JSON');
                        }
                      }}
                    >
                      测试运行
                    </button>
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => void act({ operation: 'uninstall', pluginId: item.id }, '插件已卸载')}
                    >
                      卸载
                    </button>
                  </div>
                </div>
              ))}
              {result && (
                <pre className="feature-log" aria-label="隔离插件运行结果">
                  {result}
                </pre>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
