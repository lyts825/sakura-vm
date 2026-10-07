/**
 * 模块职责（中文）：提供 GraphQL 查询和变量输入，执行请求并展示数据及查询错误。
 * Module responsibility (English): Submitting GraphQL queries and variables and presenting results or query errors.
 * 详细范围（中文）：公开入口包括 GraphQLExplorer；职责覆盖提交 GraphQL 查询与变量并显示结果或查询错误，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include GraphQLExplorer. The scope covers Submitting GraphQL queries and variables and presenting results or query errors. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
/**
 * 中文：呈现提交 GraphQL 查询与变量并显示结果或查询错误中的 GraphQLExplorer 界面，订阅 /graphql-schema，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the GraphQLExplorer surface for Submitting GraphQL queries and variables and presenting results or query errors, subscribing to /graphql-schema. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
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
              void action.run(/** 中文：提交 POST /graphql，完成提交 GraphQL 查询与变量并显示结果或查询错误的数据交互并更新操作结果；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /graphql for Submitting GraphQL queries and variables and presenting results or query errors and update operation result. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：查询变量必须是有效 JSON；查询变量需要 JSON 对象。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 查询变量必须是有效 JSON; 查询变量需要 JSON 对象. These errors reach the direct caller or this function's catch handler */ async (signal) => {
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
