/**
 * 模块职责（中文）：管理社区插件安装、授权与运行状态，并在插件边界内加载其扩展面板。
 * Module responsibility (English): Installing, authorizing and managing community plugins and their isolated surfaces.
 * 详细范围（中文）：公开入口包括 CommunityPluginCenter；职责覆盖安装、授权和管理社区插件及其独立界面，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include CommunityPluginCenter. The scope covers Installing, authorizing and managing community plugins and their isolated surfaces. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useCallback, useEffect, useState } from 'react';
import { useAction, type Request } from './feature-shared';
import { PluginBoundary } from './plugin-boundary';
import { pluginGeneration } from './plugin-generation';

type Entry = {
  id: string;
  name: string;
  description: string;
  version: string;
  sha256: string;
  publisher: string;
  extensions?: { routes: Array<{ id: string; name: string }>;
    panels: Array<{ id: string; title: string; description: string; routeId: string;
      fields: Array<{ key: string; label: string; type: 'text' | 'number' | 'boolean'; required: boolean }> }> };
};
type View = {
  publishers: Array<{ fingerprint: string; name: string }>;
  sources: Array<{ id: string; name: string; url: string }>;
  installed: Array<Entry & { sourceId: string }>;
  catalogs: Record<string, Entry[]>;
  problems?: Record<string, string>;
  subscriptions?: Array<{ pluginId: string; types: Array<'job.finished' | 'alert.raised'>;
    enabled: boolean }>;
  schedules?: Array<{ pluginId: string; intervalMinutes: number; enabled: boolean;
    nextRunAt: number }>;
  deliveries?: Array<{ id: string; pluginId: string; event: { type: string; occurredAt: string };
    status: 'pending' | 'done' | 'failed'; error?: string; resultPreview?: string }>;
  eventError?: string;
  runtime?: import('../shared/plugins').PluginRuntimeView;
};
/**
 * 中文：核对社区插件返回值的必要对象、字符串和集合形状，拒绝把不受控响应直接当作扩展界面描述。
 * English: Check the required object/string/collection shapes in a community-plugin reply rather than treating unchecked data as an extension UI description.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：value is View，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: value is View carrying the described computation/transport result; throwing branches do not provide success
 */
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

/**
 * 中文：呈现安装、授权和管理社区插件及其独立界面中的 CommunityExtensionPanel 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the CommunityExtensionPanel surface for Installing, authorizing and managing community plugins and their isolated surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ pluginId, panel, request } 提供 pluginId（pluginId 状态）、panel（panel 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { pluginId, panel, request } provides context fields pluginId (pluginId state), panel (panel state), request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function CommunityExtensionPanel({ pluginId, panel, request }: {
  pluginId: string; panel: NonNullable<Entry['extensions']>['panels'][number]; request: Request;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [result, setResult] = useState('');
  const { error, busy, run } = useAction();
  const invalid = panel.fields.some((field) => {
    const value = values[field.key];
    return field.required && value === undefined && field.type !== 'boolean' ||
      field.required && value === '' ||
      field.type === 'number' && value !== undefined && value !== '' &&
        !Number.isFinite(Number(value));
  });
  /**
   * 中文：提交 POST /community-plugins/extensions/{pluginId}/{panel.routeId}，完成安装、授权和管理社区插件及其独立界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /community-plugins/extensions/{pluginId}/{panel.routeId} for Installing, authorizing and managing community plugins and their isolated surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const submit = () => {
    if (invalid) return;
    return run(/** 中文：提交 POST /community-plugins/extensions/{pluginId}/{panel.routeId}，完成安装、授权和管理社区插件及其独立界面的数据交互并更新操作结果；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /community-plugins/extensions/{pluginId}/{panel.routeId} for Installing, authorizing and managing community plugins and their isolated surfaces and update operation result. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async signal => {
      const body: Record<string, unknown> = {};
      for (const field of panel.fields) {
        const value = values[field.key];
        if (field.type === 'boolean') body[field.key] = value === true;
        else if (value !== undefined && value !== '')
          body[field.key] = field.type === 'number' ? Number(value) : value;
      }
      const response = await request<unknown>(
        `/community-plugins/extensions/${pluginId}/${panel.routeId}`, 'POST', body, signal);
      signal.throwIfAborted();
      setResult(JSON.stringify(response, null, 2));
    });
  };
  return <section className="community-plugin-extension" aria-label={panel.title}>
    <h4>{panel.title}</h4>
    {panel.description && <p className="muted">{panel.description}</p>}
    {panel.fields.map((field) => <label key={field.key}>
      {field.label}
      {field.type === 'boolean' ? <input type="checkbox" checked={values[field.key] === true}
        onChange={(event) => setValues((current) => ({ ...current,
          [field.key]: event.target.checked }))} /> :
        <input type={field.type === 'number' ? 'number' : 'text'}
          value={String(values[field.key] ?? '')} maxLength={field.type === 'text' ? 4096 : undefined}
          onChange={(event) => setValues((current) => ({ ...current,
            [field.key]: event.target.value }))} />}
    </label>)}
    <button className="secondary compact" disabled={busy || invalid} onClick={() => void submit()}>
      {busy ? '处理中…' : '运行扩展操作'}
    </button>
    {error && <p role="alert">{error}</p>}
    {result && <pre className="feature-log" aria-label={panel.title + ' 结果'}>{result}</pre>}
  </section>;
}

/**
 * 中文：呈现安装、授权和管理社区插件及其独立界面中的 CommunityPluginCenter 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the CommunityPluginCenter surface for Installing, authorizing and managing community plugins and their isolated surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function CommunityPluginCenter({ request }: { request: Request }) {
  const [view, setView] = useState<View | null>(null);
  const [publisherName, setPublisherName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [input, setInput] = useState('{}');
  const [result, setResult] = useState('');
  const [scheduleMinutes, setScheduleMinutes] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /**
   * 中文：读取 GET /community-plugins，完成安装、授权和管理社区插件及其独立界面的数据交互并更新服务端视图；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform GET /community-plugins for Installing, authorizing and managing community plugins and their isolated surfaces and update server view. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：signal：本次调用的取消寿命
   * English: Inputs: signal: cancellation lifetime for this invocation
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：拒绝原因：第三方插件目录响应无效。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 第三方插件目录响应无效. These errors reach the direct caller or this function's catch handler
   */
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const data = await request<View>('/community-plugins', 'GET', undefined, signal);
      if (!validView(data)) throw new Error('第三方插件目录响应无效');
      pluginGeneration.update(data.runtime);
      if (!signal?.aborted) setView(data);
    },
    [request],
  );
  useEffect(/** 中文：当依赖 [load] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [load] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    void load(abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError((e as Error).message);
    });
    /**
     * 中文：在安装、授权和管理社区插件及其独立界面流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Installing, authorizing and managing community plugins and their isolated surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, [load]);
  /**
   * 中文：提交 POST /community-plugins，完成安装、授权和管理社区插件及其独立界面的数据交互并更新忙碌标记、错误反馈、notice 状态、操作结果、服务端视图；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /community-plugins for Installing, authorizing and managing community plugins and their isolated surfaces and update busy flag, error feedback, notice state, operation result, server view. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：operation：签名所示 Record<string, unknown> 业务值；success：签名所示 string 业务值
   * English: Inputs: operation: the Record<string, unknown> domain value in the signature; success: the string domain value in the signature
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：拒绝原因：第三方插件目录响应无效。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 第三方插件目录响应无效. These errors reach the direct caller or this function's catch handler
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
  const act = async (operation: Record<string, unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await request<unknown>('/community-plugins', 'POST', operation);
      if (operation.operation === 'run') setResult(JSON.stringify(response, null, 2));
      else {
        if (!validView(response)) throw new Error('第三方插件目录响应无效');
        pluginGeneration.update(response.runtime);
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
        数据，无法访问宿主服务。可订阅脱敏任务和告警事件，自动运行插件并查看结果。
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
                {(view.catalogs[source.id] || []).map(/**
                 * 中文功能：关联目录项的已安装版本与发布者信任状态，渲染摘要和安装/更新入口；忙碌、未信任或相同版本摘要时禁用操作。
                 * English: Associate catalog entries with installed versions/publisher trust, render digest and install/update actions, and disable them while busy, untrusted or already matching version/digest.
                 * 输入 / Inputs: entry.
                 * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                 * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                 * 设计思路：这里的信任状态只决定界面准入；实际下载与签名验证由 act 对应的控制面执行，不以按钮状态代替验证。
                 * Design: Trust state here governs UI admission only; the act control-plane operation performs download/signature checks, so button state does not replace verification.
                 */
                (entry) => {
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
                <div key={item.id}>
                <div className="community-plugin-entry">
                  <span>
                    <strong>{item.name}</strong>{' '}
                    <code>
                      {item.id}@{item.version}
                    </code>
                    {view.problems?.[item.id] && <small role="alert"> · {view.problems[item.id]}</small>}
                    {['draining', 'cleanup-pending'].includes(view.runtime?.instances.find(instance =>
                      instance.identity === 'community:' + item.id)?.phase || '') &&
                      <small role="status"> · 清理待恢复，请重试卸载</small>}
                  </span>
                  <div className="community-plugin-actions">
                    {(/**
                     * 中文功能：读取当前插件的订阅与定时配置，渲染暂停、恢复、移除和间隔调整操作，默认间隔为 60 分钟。
                     * English: Read the plugin subscription/schedule configuration and render pause/resume/remove/interval actions, defaulting the interval to 60 minutes.
                     * 输入 / Inputs: 无 / none.
                     * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                     * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                     */
                    () => {
                      const subscription = view.subscriptions?.find((value) => value.pluginId === item.id);
                      const schedule = view.schedules?.find((value) => value.pluginId === item.id);
                      const minutes = scheduleMinutes[item.id] ?? schedule?.intervalMinutes ?? 60;
                      return <>
                        <button className="secondary compact" disabled={busy}
                          onClick={() => void act({ operation: 'subscribe', pluginId: item.id,
                            types: subscription?.types || ['job.finished', 'alert.raised'],
                            enabled: !subscription?.enabled },
                          subscription?.enabled ? '自动触发已暂停' : '自动触发已启用')}>
                          {subscription?.enabled ? '暂停自动触发' : subscription ? '恢复自动触发' : '订阅任务与告警'}
                        </button>
                        {subscription && <button className="secondary compact" disabled={busy}
                          onClick={() => void act({ operation: 'unsubscribe', pluginId: item.id },
                            '事件订阅已移除')}>移除订阅</button>}
                        <label>定时周期（分钟）
                          <input type="number" min={1} max={1440} value={minutes}
                            style={{ width: 96 }}
                            onChange={(event) => setScheduleMinutes((current) => ({ ...current,
                              [item.id]: Number(event.target.value) }))} />
                        </label>
                        <button className="secondary compact"
                          disabled={busy || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440}
                          onClick={() => void act({ operation: 'schedule', pluginId: item.id,
                            intervalMinutes: minutes, enabled: !schedule?.enabled },
                          schedule?.enabled ? '定时触发已暂停' : '定时触发已启用')}>
                          {schedule?.enabled ? '暂停定时' : schedule ? '恢复定时' : '启用定时'}
                        </button>
                        {schedule && <button className="secondary compact" disabled={busy}
                          onClick={() => void act({ operation: 'unschedule', pluginId: item.id },
                            '定时触发已移除')}>移除定时</button>}
                      </>;
                    })()}
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={/** 中文：在安装、授权和管理社区插件及其独立界面流程中错误反馈，按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Installing, authorizing and managing community plugins and their isolated surfaces, error feedback, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
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
                {item.extensions?.panels.map((panel) =>
                  <PluginBoundary key={panel.id} identity={`community:${item.id}`} request={request} label={panel.title}>
                    {scoped => <CommunityExtensionPanel pluginId={item.id} panel={panel} request={scoped} />}
                  </PluginBoundary>)}
                </div>
              ))}
              {result && (
                <pre className="feature-log" aria-label="隔离插件运行结果">
                  {result}
                </pre>
              )}
              <h4>自动触发记录</h4>
              <button className="secondary compact" disabled={busy}
                onClick={() => void load().catch((e) => setError((e as Error).message))}>
                刷新触发记录
              </button>
              {(view.deliveries?.length || 0) > 0 ? <>
                <ul>
                  {view.deliveries?.slice(0, 10).map((delivery) => <li key={delivery.id}>
                    <code>{delivery.pluginId}</code> · {delivery.event.type} · {delivery.status} ·
                    {delivery.event.occurredAt}
                    {delivery.error && <small role="alert"> · {delivery.error}</small>}
                    {delivery.resultPreview && <details><summary>查看结果</summary>
                      <pre className="feature-log">{delivery.resultPreview}</pre></details>}
                  </li>)}
                </ul>
              </> : <p className="muted">尚无自动触发记录。</p>}
              {view.eventError && <p role="alert">事件检查失败：{view.eventError}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
