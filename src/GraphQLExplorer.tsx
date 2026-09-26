import { useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import { saveBlob } from './export-file';

const example = `query Overview($limit: Int!) {
  apiVersion
  host { name capturedAt totalVms totalJobs }
  vms(limit: $limit) { id name status cpus memoryMiB }
  jobs(limit: $limit) { id vmId status startedAt }
  plugins { id enabled }
}`;
export function GraphQLExplorer({ request }: { request: Request }) {
  const info = useRemote<{
    version: string;
    sdl: string;
    limits: { queryBytes: number; depth: number; cost: number; pageSize: number };
  }>(request, '/graphql-schema', true, 0);
  const action = useAction();
  const [query, setQuery] = useState(example),
    [variables, setVariables] = useState('{ "limit": 5 }'),
    [operation, setOperation] = useState('');
  const [result, setResult] = useState('');
  return (
    <section className="system-card api-explorer" aria-label="GraphQL 查询面板">
      <h3>GraphQL 查询</h3>
      <p className="subtle-note">
        按需读取主机、实例、任务元数据和插件状态。任务输出、结果和私密配置不在此接口中。支持变量、别名、片段和自省；当前
        Schema 只提供查询。
      </p>
      <p className="subtle-note">
        列表先筛选后分页，limit 为 1–100，offset 为
        0–10000。每次读取当前已启用插件的任务；输入和结果仅保留在本次面板中。
      </p>
      <fieldset disabled={action.busy}>
        <label>
          GraphQL 查询文本
          <textarea
            aria-label="GraphQL 查询文本"
            rows={10}
            maxLength={16384}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setResult('');
              action.clear();
            }}
            spellCheck={false}
          />
        </label>
        <label>
          查询变量（JSON 对象）
          <textarea
            aria-label="GraphQL 查询变量"
            rows={3}
            maxLength={60000}
            value={variables}
            onChange={(e) => {
              setVariables(e.target.value);
              setResult('');
              action.clear();
            }}
            spellCheck={false}
          />
        </label>
        <label>
          操作名称（多查询时必填）
          <input
            aria-label="GraphQL 操作名称"
            maxLength={128}
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value);
              setResult('');
              action.clear();
            }}
          />
        </label>
        <div className="button-row">
          <button
            className="secondary compact"
            disabled={!query.trim()}
            onClick={() =>
              void action.run(async (signal) => {
                setResult('');
                let values: unknown;
                try {
                  values = JSON.parse(variables || '{}');
                } catch {
                  throw new Error('查询变量必须是有效 JSON');
                }
                if (!values || typeof values !== 'object' || Array.isArray(values))
                  throw new Error('查询变量需要 JSON 对象');
                const response = await request(
                  '/graphql',
                  'POST',
                  {
                    query,
                    variables: values,
                    ...(operation.trim() ? { operationName: operation.trim() } : {}),
                  },
                  signal,
                );
                if (!signal.aborted) setResult(JSON.stringify(response, null, 2));
              })
            }
          >
            执行 GraphQL 查询
          </button>
          <button
            className="text-button"
            onClick={() => {
              setQuery(example);
              setVariables('{ "limit": 5 }');
              setOperation('');
              setResult('');
              action.clear();
            }}
          >
            恢复查询示例
          </button>
          <button
            className="secondary compact"
            disabled={!info.data}
            onClick={() =>
              saveBlob('sakura-schema.graphql', new Blob([info.data!.sdl], { type: 'application/graphql' }))
            }
          >
            下载 GraphQL Schema
          </button>
        </div>
      </fieldset>
      <Feedback error={action.error || info.error} />
      {action.busy && <p role="status">正在读取查询结果…</p>}
      {result && (
        <>
          <p className="subtle-note">结果包含 errors 时，请按错误路径检查对应字段。</p>
          <pre className="feature-log" aria-label="GraphQL 查询结果">
            {result.slice(0, 100000)}
            {result.length > 100000 ? '\n显示已截断，可下载完整结果。' : ''}
          </pre>
          <button
            className="text-button"
            onClick={() =>
              saveBlob('sakura-query-result.json', new Blob([result], { type: 'application/json' }))
            }
          >
            下载查询结果
          </button>
        </>
      )}
      {info.data && (
        <details>
          <summary>Schema v{info.data.version} · 查询限制与字段</summary>
          <p>
            查询文本最多 {info.data.limits.queryBytes} 字节，深度 {info.data.limits.depth}，展开成本{' '}
            {info.data.limits.cost}；较大的自省查询也受到限制。
          </p>
          <pre>{info.data.sdl}</pre>
          <p className="subtle-note">
            JavaScript SDK：client.call('core.graphql.query', {'{'} body: {'{'} query, variables {'}'} {'}'} )
          </p>
        </details>
      )}
    </section>
  );
}
