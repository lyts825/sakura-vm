import { useEffect, useState } from 'react';
import { apiPath, type ApiDocument } from '../shared/api-document';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import { saveBlob } from './export-file';

export function ApiExplorer({ request }: { request: Request }) {
  const remote = useRemote<ApiDocument>(request, '/openapi', true, 0);
  const action = useAction();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('core.monitor');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
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
  useEffect(() => {
    setParameters({});
    setResult('');
    action.clear();
  }, [selected]);
  const download = (name: string, content: string, type = 'application/json') =>
    saveBlob(name, new Blob([content], { type }));
  return (
    <section className="system-card api-explorer" aria-label="API 浏览器">
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
            void action.run(async (signal) => {
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
        <button className="text-button" onClick={remote.reload}>
          刷新接口列表
        </button>
      </div>
      <Feedback error={remote.error || action.error} message={action.message} />
      <label>
        搜索接口
        <input
          aria-label="搜索 API 接口"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="路径、插件、操作名称"
        />
      </label>
      <label>
        已声明操作
        <select
          aria-label="API 操作"
          value={selected}
          disabled={action.busy}
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
      {operation && (
        <>
          <p>
            <strong>
              {operation.method.toUpperCase()} {operation.path}
            </strong>
          </p>
          <p>{operation.description}</p>
          <p className="subtle-note">
            {operation.operationId} · {operation['x-sakura-contract']} ·{' '}
            {operation['x-sakura-enabled'] ? '已启用' : '插件未启用'}
          </p>
          <div className="shortcut-fields">
            {operation.parameters.map((parameter) => (
              <label key={`${parameter.in}:${parameter.name}`}>
                {parameter.name}
                {parameter.required ? ' *' : ''}（{parameter.in}）
                <input
                  aria-label={`API ${parameter.name}`}
                  value={parameters[parameter.name] || ''}
                  onChange={(event) => setParameters({ ...parameters, [parameter.name]: event.target.value })}
                />
                {parameter.description && <small>{parameter.description}</small>}
              </label>
            ))}
          </div>
          <button
            className="secondary compact"
            disabled={
              action.busy ||
              !operation['x-sakura-enabled'] ||
              !operation['x-sakura-inspectable'] ||
              operation.method !== 'get' ||
              operation.parameters.some((item) => item.required && !parameters[item.name])
            }
            onClick={() =>
              void action.run(async (signal) => {
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
                setResult(
                  content.length > 100_000 ? content.slice(0, 100_000) + '\n…显示内容已截断' : content,
                );
              })
            }
          >
            执行只读查询
          </button>
          <details>
            <summary>参数及响应 Schema</summary>
            <pre className="api-json">{JSON.stringify(operation, null, 2)}</pre>
          </details>
          {result && (
            <pre className="api-json" aria-label="API 查询结果">
              {result}
            </pre>
          )}
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
        <pre className="api-json">
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
