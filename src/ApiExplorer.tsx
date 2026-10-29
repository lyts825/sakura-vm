/**
 * 模块职责（中文）：读取控制面 API 文档，按操作契约构造请求并展示响应及下载结果。
 * Module responsibility (English): Building API requests from published operation contracts and presenting responses.
 * 详细范围（中文）：公开入口包括 ApiExplorer；职责覆盖依据公开操作契约构造 API 请求并呈现响应，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ApiExplorer. The scope covers Building API requests from published operation contracts and presenting responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useId, useRef, useState } from 'react';
import { apiPath, type ApiDocument } from '../shared/api-document';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import { saveBlob } from './export-file';
import './request-explorers.css';

/**
 * 中文：呈现依据公开操作契约构造 API 请求并呈现响应中的 ApiExplorer 界面，订阅 /openapi，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ApiExplorer surface for Building API requests from published operation contracts and presenting responses, subscribing to /openapi. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function ApiExplorer({ request }: { request: Request }) {
  const remote = useRemote<ApiDocument>(request, '/openapi', true, 0);
  const action = useAction();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('core.monitor');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const operations = Object.entries(remote.data?.paths || {}).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, ...operation })),
  );
  const visible = operations.filter((item) =>
    [item.path, item.method, item.summary, item.operationId]
      .join(' ')
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  const operation = operations.find((item) => item.operationId === selected);
  const selectedVisible = visible.some((item) => item.operationId === selected);
  const missingParameters = operation?.parameters.filter((item) => item.required && !parameters[item.name]) || [];
  const queryHint = !operation ? '' : !operation['x-sakura-enabled'] ? '请先启用此接口所属的插件。'
    : !operation['x-sakura-inspectable'] || operation.method !== 'get' ? '此操作不支持在这里试读，请使用对应功能页面或 SDK。'
      : missingParameters.length ? `请填写必填参数：${missingParameters.map((item) => item.name).join('、')}。`
        : '已具备只读查询条件，可发送请求。';
  useEffect(/** 中文：当依赖 [selected] 变化时parameters 状态，操作结果；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [selected] change, parameters state, operation result. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setParameters({});
    setResult('');
    action.clear();
  }, [selected]);
  /**
   * 中文：在依据公开操作契约构造 API 请求并呈现响应流程中把二进制内容导出为下载；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Building API requests from published operation contracts and presenting responses, export binary content through a download. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：name：目标名称或文件名；content：当前文件文本内容；type：此处理器的调用值（缺省 'application/json'）
   * English: Inputs: name: target name/filename; content: current file text; type: the invocation value for this handler (default 'application/json')
   */
  const download = (name: string, content: string, type = 'application/json') =>
    saveBlob(name, new Blob([content], { type }));
  return (
    <section className="system-card api-explorer request-explorer" aria-label="API 浏览器">
      <h3>API 浏览器与 SDK</h3>
      <p className="subtle-note">
        OpenAPI 3.1.1 覆盖核心 HTTP 接口与已声明的插件操作。partial
        表示响应结构未完整声明；旧插件的路由前缀另列，不作为可执行端点。此处可试读已标记的查询；写入通过功能页面或下载的
        SDK 执行。
      </p>
      <div className="button-row">
        <button
          className="secondary compact"
          disabled={!remote.data}
          onClick={() => download('sakura-openapi.json', JSON.stringify(remote.data, null, 2))}
        >
          下载 OpenAPI
        </button>
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={() =>
            void action.run(/** 中文：读取 GET /sdk，完成依据公开操作契约构造 API 请求并呈现响应的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /sdk for Building API requests from published operation contracts and presenting responses. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
              const file = await request<{ filename: string; content: string; mime: string }>(
                '/sdk',
                'GET',
                undefined,
                signal,
              );
              download(file.filename, file.content, file.mime);
            })
          }
        >
          下载 JavaScript SDK
        </button>
        <button className="text-button" disabled={action.busy} onClick={remote.reload}>
          刷新接口列表
        </button>
      </div>
      <Feedback error={remote.error || action.error} message={action.message} />
      <label>
        搜索接口
        <input
          ref={searchRef}
          type="search"
          aria-label="搜索 API 接口"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) setFilter('');
          }}
          placeholder="路径、插件、操作名称"
        />
      </label>
      <div className="explorer-search-summary">
        <p role="status">{remote.data ? `显示 ${visible.length} / ${operations.length} 个接口`
          : remote.error ? '接口列表读取失败，可点击上方刷新。' : '正在读取接口列表…'}</p>
        {filter && <button className="text-button" onClick={() => {
          setFilter('');
          searchRef.current?.focus();
        }}>清空接口搜索</button>}
      </div>
      {remote.data && !visible.length && <p className="explorer-empty">{operations.length
        ? '没有匹配的接口，请调整关键词或清空搜索。' : '当前没有已声明的接口。'}</p>}
      <label>
        已声明操作
        <select
          aria-label="API 操作"
          value={selectedVisible ? selected : ''}
          disabled={action.busy || !remote.data || !visible.length}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">选择操作（{visible.length}）</option>
          {visible.map((item) => (
            <option key={item.operationId} value={item.operationId}>
              {item.method.toUpperCase()} {item.path} · {item.summary}
              {item['x-sakura-enabled'] ? '' : ' · 插件未启用'}
            </option>
          ))}
        </select>
      </label>
      {operation && !selectedVisible && <p className="explorer-context">当前选中接口不在筛选结果中，下方仍显示该接口。搜索不会更换执行目标。</p>}
      {remote.data && !operation && visible.length > 0 && <p className="explorer-empty">选择一个接口，查看参数与查询条件。</p>}
      {operation && (
        <>
          <div className="explorer-operation-heading">
            <span className="explorer-method">{operation.method.toUpperCase()}</span>
            <code>{operation.path}</code>
          </div>
          <p>{operation.description}</p>
          <p className="subtle-note">
            {operation.operationId} · {operation['x-sakura-contract']} ·{' '}
            {operation['x-sakura-enabled'] ? '已启用' : '插件未启用'}
          </p>
          <fieldset className="shortcut-fields explorer-parameters" disabled={action.busy}>
            <legend>请求参数{operation.parameters.length ? `（${operation.parameters.length}）` : '（无需填写）'}</legend>
            {operation.parameters.map((parameter) => (
              <label key={`${parameter.in}:${parameter.name}`}>
                {parameter.name}
                {parameter.required ? ' *' : ''}（{parameter.in}）
                <input
                  aria-label={`API ${parameter.name}`}
                  value={parameters[parameter.name] || ''}
                  aria-required={parameter.required || undefined}
                  onChange={(event) => {
                    setParameters({ ...parameters, [parameter.name]: event.target.value });
                    setResult('');
                    action.clear();
                  }}
                />
                {parameter.description && <small>{parameter.description}</small>}
              </label>
            ))}
          </fieldset>
          <p id={hintId} className="explorer-context">{queryHint}</p>
          <button
            className="secondary compact"
            aria-describedby={hintId}
            disabled={
              action.busy ||
              !operation['x-sakura-enabled'] ||
              !operation['x-sakura-inspectable'] ||
              operation.method !== 'get' ||
              operation.parameters.some((item) => item.required && !parameters[item.name])
            }
            onClick={() =>
              void action.run(/** 中文：读取 GET apiPath(operation.path, path, query).slice(4)，完成依据公开操作契约构造 API 请求并呈现响应的数据交互并更新操作结果；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET apiPath(operation.path, path, query).slice(4) for Building API requests from published operation contracts and presenting responses and update operation result. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                setResult('');
                const path = Object.fromEntries(
                  operation.parameters
                    .filter((item) => item.in === 'path')
                    .map((item) => [item.name, parameters[item.name]]),
                );
                const query = Object.fromEntries(
                  operation.parameters
                    .filter((item) => item.in === 'query')
                    .map((item) => [item.name, parameters[item.name] || '']),
                );
                const response = await request(
                  apiPath(operation.path, path, query).slice(4),
                  'GET',
                  undefined,
                  signal,
                );
                const content = JSON.stringify(response, null, 2);
                if (!signal.aborted) setResult(
                  content.length > 100_000 ? content.slice(0, 100_000) + '\n…显示内容已截断' : content,
                );
              })
            }
          >
            {action.busy ? '正在处理请求…' : '执行只读查询'}
          </button>
          <details>
            <summary>参数及响应 Schema</summary>
            <pre className="api-json" tabIndex={0} aria-label="API 参数及响应 Schema">{JSON.stringify(operation, null, 2)}</pre>
          </details>
          <section className="explorer-response" aria-label="API 查询响应" aria-busy={action.busy}>
            <h4>查询响应</h4>
            {action.busy ? <p role="status">正在处理请求，请稍候…</p>
              : result ? <><p className="explorer-context">响应已返回，最多显示 100,000 个字符。</p>
                <pre className="api-json" tabIndex={0} aria-label="API 查询结果">{result}</pre></>
                : <p className="explorer-empty">{action.error ? '请求未完成，请查看上方错误并重试。' : '尚未执行查询。响应将在这里显示。'}</p>}
          </section>
        </>
      )}
      <details>
        <summary>插件路由前缀（不等于具体端点）</summary>
        <ul>
          {remote.data?.['x-sakura-route-prefixes'].map((route) => (
            <li key={route.owner + route.path}>
              {route.owner} · {route.methods.join('/')} {route.path} · {route.enabled ? '已启用' : '未启用'}
              {route.projectScoped ? ' · 项目范围' : ''}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>SDK 用法</summary>
        <pre className="api-json" tabIndex={0} aria-label="JavaScript SDK 用法">
          {
            "import { SakuraClient } from './sakura-client.mjs';\nconst client = new SakuraClient();\nconst vms = await client.call('core.vms.list');\n// 路径参数使用 path，项目和其他查询使用 query\nconst vm = await client.call('core.vms.get', { path: { vmId: vms[0].id } });\n// 旧接口及二进制传输：client.request('/api/...', { method, query, body, binary, signal });"
          }
        </pre>
        <p>
          ES 模块适用于 Node.js 22+ 和现代浏览器，自动获取本机凭证但不持久化。JSON
          响应自动解析，二进制默认返回 Response 供流式读取。失败和取消不会自动重放请求；401
          后下一次显式调用会重新获取凭证。
        </p>
      </details>
    </section>
  );
}
