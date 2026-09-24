import { useEffect, useState } from 'react';
import { Boxes, Puzzle, RefreshCw } from 'lucide-react';
import type { PluginStatus } from '../shared/plugins';
import type { Request } from './feature-shared';
import './plugins.css';

export function PluginCenter({ request }: { request: Request }) {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void request<PluginStatus>('/plugins', 'GET', undefined, abort.signal)
      .then(setStatus)
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, [request]);
  const change = async (kind: 'plugin' | 'pack', id: string, enabled: boolean) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await request('/plugins', 'PATCH', { kind, id, enabled }));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="plugins-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Puzzle size={14} /> BUILD YOUR OWN SAKURA
          </div>
          <h1>从轻开始，按需生长。</h1>
          <p>基础版提供 Linux 实例、终端和必要配置。其余能力由你选择。</p>
        </div>
      </div>
      {error && (
        <p className="machine-error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p role="status">正在读取插件…</p>
      ) : (
        <>
          <div className="plugin-summary">
            <span>
              <b>{status.active.length}</b> 个插件运行中
            </span>
            <span>
              <b>{status.planned.length}</b> 个插件将在下次启动加载
            </span>
          </div>
          {status.restartRequired && (
            <div className="info-callout" role="status">
              <RefreshCw size={22} />
              <div>
                <h3>选择已保存，重启服务后生效</h3>
                <p>在运行 Sakura 的终端按 Ctrl+C，等待服务退出，再运行 npm start。刷新浏览器不会重启服务。</p>
                <p>重启会停止正在运行的实例。停用插件会保留实例、文件和插件配置。</p>
              </div>
            </div>
          )}
          {Object.entries(status.errors).map(([id, error]) => (
            <p key={id} className="machine-error" role="alert">
              {id} 启动失败：{error}
            </p>
          ))}
          <h2>
            <Boxes size={20} /> 插件整合包
          </h2>
          <p className="muted">
            整合包统一选择一组插件。移除整合包后，单独选择或被其他整合包依赖的插件继续保留。
          </p>
          <div className="plugin-grid">
            {status.packs.map((pack) => {
              const selected = status.selection.packs.includes(pack.id);
              return (
                <article className="plugin-card" key={pack.id}>
                  <div className="panel-heading">
                    <h3>{pack.name}</h3>
                    <small>v{pack.version}</small>
                  </div>
                  <p>{pack.description}</p>
                  <details>
                    <summary>{pack.plugins.length} 个直接成员</summary>
                    <ul>
                      {pack.plugins.map((pin) => (
                        <li key={pin.id}>
                          {status.plugins.find((p) => p.id === pin.id)?.name || pin.id}{' '}
                          <small>{pin.version}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button
                    className={`${selected ? 'secondary' : 'primary'} compact`}
                    disabled={busy}
                    onClick={() => void change('pack', pack.id, !selected)}
                  >
                    {selected ? '移除整合包' : '选用整合包'}
                  </button>
                </article>
              );
            })}
          </div>
          <h2>
            <Puzzle size={20} /> 独立插件
          </h2>
          <p className="muted">依赖会自动加入。所有插件均随当前版本提供，实验插件会明确标识。</p>
          <div className="plugin-grid">
            {status.plugins.map((plugin) => {
              const selected = status.selection.plugins.includes(plugin.id);
              const planned = status.planned.includes(plugin.id);
              const active = status.active.includes(plugin.id);
              return (
                <article className="plugin-card" key={plugin.id}>
                  <div className="panel-heading">
                    <h3>{plugin.name}</h3>
                    <small>{plugin.experimental ? '实验' : `v${plugin.version}`}</small>
                  </div>
                  <p>{plugin.description}</p>
                  <code>{plugin.id}</code>
                  <small>
                    {plugin.requires.length ? `依赖：${plugin.requires.join('、')}` : '无插件依赖'}
                  </small>
                  <span className="plugin-state">
                    {active ? '运行中' : '未运行'} ·{' '}
                    {planned ? (selected ? '已单独选择' : '由整合包或依赖引入') : '下次启动不加载'}
                  </span>
                  <button
                    className={`${selected ? 'secondary' : 'primary'} compact`}
                    disabled={busy}
                    onClick={() => void change('plugin', plugin.id, !selected)}
                  >
                    {selected ? '停用独立选择' : planned ? '保留为独立选择' : '启用插件'}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
