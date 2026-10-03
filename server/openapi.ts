import { PLUGINS } from '../shared/plugins.ts';
import type { ApiDocument, ApiParameter } from '../shared/api-document.ts';
import { operationDirectory, operationEntries } from './operation-catalog.ts';

export function apiDocument(active: Iterable<string>, port: number): ApiDocument {
  const enabled = new Set(active);
  const directory = operationDirectory(enabled);
  const document: ApiDocument = {
    openapi: '3.1.1',
    info: {
      title: 'Sakura 本地控制 API', version: '0.1.0',
      description: 'HTTP、插件和 WebSocket 使用同一操作与权限声明。partial 表示响应结构尚未完整声明；专用下载票据、扩展和客户机入口继续使用各自凭证。写请求不会自动重放。',
    },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    security: [{ LocalControllerToken: [] }],
    components: { securitySchemes: {
      LocalControllerToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Token' },
      ExtensionToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Extension-Token' },
      GuestToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Guest-Token' },
    } },
    paths: {},
    'x-sakura-operations': directory,
    'x-sakura-route-prefixes': PLUGINS.flatMap(plugin => plugin.contributes.http.map(route => ({
      owner: plugin.id, ...route, enabled: enabled.has(plugin.id),
    }))),
  };
  for (const [index, entry] of operationEntries.entries()) {
    const policy = directory[index];
    if (policy.method === 'UPGRADE') continue;
    const parameters: ApiParameter[] = [...policy.path.matchAll(/\{([^}]+)\}/g)].map(match => ({
      name: match[1], in: 'path', required: true, schema: { type: 'string' },
    }));
    if (policy.projectScoped) parameters.push({ name: 'project', in: 'query', required: false,
      schema: { type: 'string', pattern: '^(default|[a-f0-9]{16})$' },
      description: '成员必须指定项目；管理员省略时在准入时固定当前活动项目。' });
    if (policy.id === 'sandbox.artifact') parameters.push(...['run', 'artifact'].map(name => ({
      name, in: 'query' as const, required: true, schema: { type: 'string', format: 'uuid' },
    })));
    const security = policy.access === 'controller' ? undefined : policy.access === 'guest' ? [{ GuestToken: [] }] :
      policy.id === 'core.extension.inventory' ? [{ ExtensionToken: [] }] : [];
    (document.paths[policy.path] ||= {})[policy.method.toLowerCase()] = {
      operationId: policy.id, summary: entry.title,
      description: policy.id === 'core.vms.update'
        ? '需要提交完整配置；实例名称、磁盘容量、发行版不能通过此接口改变。'
        : '入口与资源排队后均按本操作的权限、项目和运行身份重新校验。',
      tags: [policy.owner], parameters,
      'x-sakura-enabled': policy.enabled, 'x-sakura-inspectable': !!entry.inspect,
      'x-sakura-contract': policy.contract, 'x-sakura-operation': policy,
      ...(security ? { security } : {}),
      ...(entry.body ? { requestBody: { required: true, content: {
        [policy.transport === 'form' ? 'application/x-www-form-urlencoded' : 'application/json']: { schema: entry.body },
      } } } : {}),
      responses: {
        [entry.status]: { description: policy.contract === 'declared' ? '成功' : '成功；结构以实际响应为准。',
          ...(entry.status === 204 ? {} : { content: {
            [entry.media || 'application/json']: { schema: entry.response || {} },
          } }) },
        default: { description: '参数、权限、维护状态、运行身份变化或运行失败。' },
      },
    };
  }
  return document;
}
