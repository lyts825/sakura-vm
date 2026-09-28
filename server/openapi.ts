import { z } from 'zod';
import { createSchema } from './model.ts';
import { PLUGINS } from '../shared/plugins.ts';
import contracts from '../docs/schemas/operations.json' with { type: 'json' };
import { logRetentionRequest } from './log-retention.ts';
import { graphqlRequest } from './graphql-api.ts';
import { sessionLockConfiguration, sessionUnlockRequest } from './session-lock.ts';
import { accessEnableInput, accessLoginInput, accessViewerInput, accessPasswordInput } from './access-control.ts';
import { webhookRequest } from './webhooks.ts';
import { automationRequest } from './automation-rules.ts';
import { featureRolloutRequest } from './feature-rollouts.ts';
import { hostPeerRequest } from './host-peers.ts';
import { assistantRequest } from './local-assistant.ts';
import { nativeRequest } from './native-integration.ts';
import { storagePoolInput } from './storage-pools.ts';
import type { ApiDocument, ApiOperation, ApiParameter } from '../shared/api-document.ts';

const response = (schema: Record<string, unknown> = {}, media = 'application/json') => ({
  description: '成功；结构未完整声明的字段由实际接口决定。',
  content: { [media]: { schema } },
});
const request = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' });
const string = { type: 'string' };
const pathName = (path: string) => path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
const core: {
  id: string;
  method: string;
  path: string;
  title: string;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status?: number;
  media?: string;
  inspect?: boolean;
  public?: boolean;
}[] = [
  {
    id: 'bootstrap',
    method: 'GET',
    path: '/api/bootstrap',
    title: '未启用账户模式时获取本地控制凭证',
    public: true,
    response: { type: 'object', properties: { token: string }, required: ['token'] },
  },
  { id: 'access.status', method: 'GET', path: '/api/access/status',
    title: '账户模式与会话锁状态', public: true, response: { type: 'object',
      properties: { enabled: { type: 'boolean' }, session: { type: 'object' } },
      required: ['enabled', 'session'] } },
  { id: 'access.login', method: 'POST', path: '/api/access/login',
    title: '使用账户密码登录', public: true, body: request(accessLoginInput) },
  { id: 'access.view', method: 'GET', path: '/api/access/view',
    title: '获授权的实例摘要', inspect: true },
  { id: 'access.logout', method: 'POST', path: '/api/access/logout', title: '撤销当前账户会话' },
  { id: 'access.enable', method: 'POST', path: '/api/access/enable',
    title: '启用账户模式并设置管理员密码', body: request(accessEnableInput) },
  { id: 'access.users', method: 'GET', path: '/api/access/users', title: '列出账户' },
  { id: 'access.createViewer', method: 'POST', path: '/api/access/users',
    title: '创建限定实例的只读账户', body: request(accessViewerInput), status: 201 },
  { id: 'access.removeViewer', method: 'DELETE', path: '/api/access/users/{id}',
    title: '撤销只读账户及其会话' },
  { id: 'access.password', method: 'POST', path: '/api/access/password',
    title: '更换管理员密码并撤销全部会话', body: request(accessPasswordInput) },
  { id: 'system', method: 'GET', path: '/api/system', title: '主机与插件状态', inspect: true },
  { id: 'monitor', method: 'GET', path: '/api/monitor', title: '只读监控快照', inspect: true },
  { id: 'storage-pools.get', method: 'GET', path: '/api/storage-pools',
    title: '本机存储池容量、实例分配与迁移清理状态', inspect: true },
  { id: 'storage-pools.action', method: 'POST', path: '/api/storage-pools',
    title: '创建、移除或清理存储池以及迁移停机实例', body: request(storagePoolInput) },
  {
    id: 'native.get',
    method: 'GET',
    path: '/api/native-integration',
    title: 'Windows 工作区映射与集成设置',
    inspect: true,
  },
  {
    id: 'native.action',
    method: 'POST',
    path: '/api/native-integration',
    title: '配置资源管理器入口、文件关联或打开本机副本',
    body: request(nativeRequest),
  },
  {
    id: 'assistant.get',
    method: 'GET',
    path: '/api/assistant',
    title: '本地 AI 设置与请求状态',
    inspect: true,
  },
  {
    id: 'assistant.action',
    method: 'POST',
    path: '/api/assistant',
    title: '模型设置、脱敏预览、编程建议或命令规划',
    body: request(assistantRequest),
  },
  {
    id: 'webhooks.get',
    method: 'GET',
    path: '/api/webhooks',
    title: '事件订阅、告警路由与投递记录',
    inspect: true,
  },
  {
    id: 'webhooks.change',
    method: 'POST',
    path: '/api/webhooks',
    title: '管理订阅、测试或处理投递记录',
    body: request(webhookRequest),
  },
  {
    id: 'automation-rules.get', method: 'GET', path: '/api/automation-rules',
    title: '事件自动化规则与执行记录', inspect: true,
  },
  {
    id: 'automation-rules.change', method: 'POST', path: '/api/automation-rules',
    title: '保存、预览或删除事件自动化规则', body: request(automationRequest),
  },
  {
    id: 'feature-rollouts.get', method: 'GET', path: '/api/feature-rollouts',
    title: '插件功能灰度与当前启动状态', inspect: true,
  },
  {
    id: 'feature-rollouts.change', method: 'POST', path: '/api/feature-rollouts',
    title: '保存、预览或删除插件灰度策略', body: request(featureRolloutRequest),
  },
  {
    id: 'host-peers.get', method: 'GET', path: '/api/host-peers',
    title: '主机配对、资源和健康状态', inspect: true,
  },
  {
    id: 'host-peers.change', method: 'POST', path: '/api/host-peers',
    title: '管理同伴入口、短码和已配对主机', body: request(hostPeerRequest),
  },
  {
    id: 'cold-migrations.get', method: 'GET', path: '/api/cold-migrations',
    title: '跨主机冷迁移队列及状态', inspect: true,
  },
  {
    id: 'snapshot-replications.get', method: 'GET', path: '/api/snapshot-replications',
    title: '跨主机快照复制队列、校验值及重试状态', inspect: true,
  },
  {
    id: 'session.status',
    method: 'GET',
    path: '/api/session',
    title: '会话锁定状态',
    inspect: true,
    public: true,
  },
  {
    id: 'session.settings',
    method: 'GET',
    path: '/api/session/settings',
    title: '会话锁定配置',
    inspect: true,
  },
  {
    id: 'session.configure',
    method: 'PATCH',
    path: '/api/session/settings',
    title: '保存会话锁定配置',
    body: request(sessionLockConfiguration),
  },
  {
    id: 'session.unlock',
    method: 'POST',
    path: '/api/session/unlock',
    title: '验证密码并解锁',
    public: true,
    body: request(sessionUnlockRequest),
  },
  {
    id: 'session.lock',
    method: 'POST',
    path: '/api/session/lock',
    title: '立即锁定控制面',
    body: request(z.object({}).strict()),
  },
  {
    id: 'session.activity',
    method: 'POST',
    path: '/api/session/activity',
    title: '报告用户操作并延长空闲期限',
    body: request(z.object({}).strict()),
  },
  {
    id: 'graphql.schema',
    method: 'GET',
    path: '/api/graphql-schema',
    title: 'GraphQL Schema 和查询限制',
    inspect: true,
  },
  {
    id: 'graphql.query',
    method: 'POST',
    path: '/api/graphql',
    title: '执行只读 GraphQL 查询',
    body: request(graphqlRequest),
    media: 'application/graphql-response+json',
  },
  {
    id: 'log-retention.get',
    method: 'GET',
    path: '/api/log-retention',
    title: '任务日志保留策略与用量',
    inspect: true,
  },
  {
    id: 'log-retention.change',
    method: 'POST',
    path: '/api/log-retention',
    title: '预览或保存并应用日志保留策略',
    body: request(logRetentionRequest),
  },
  { id: 'audit', method: 'GET', path: '/api/audit', title: '审计链记录' },
  { id: 'plugins.list', method: 'GET', path: '/api/plugins', title: '插件目录与启用状态', inspect: true },
  {
    id: 'plugins.change',
    method: 'PATCH',
    path: '/api/plugins',
    title: '保存插件选择（重启后生效）',
    body: request(
      z.object({ kind: z.enum(['plugin', 'pack']), id: z.string(), enabled: z.boolean() }).strict(),
    ),
  },
  {
    id: 'vms.list',
    method: 'GET',
    path: '/api/vms',
    title: '实例列表',
    inspect: true,
    response: { type: 'array', items: { type: 'object' } },
  },
  {
    id: 'vms.create',
    method: 'POST',
    path: '/api/vms',
    title: '创建实例',
    body: request(createSchema),
    status: 201,
  },
  { id: 'vms.get', method: 'GET', path: '/api/vms/{vmId}', title: '实例详情', inspect: true },
  {
    id: 'vms.update',
    method: 'PATCH',
    path: '/api/vms/{vmId}',
    title: '更新已停止实例配置',
    body: request(createSchema),
  },
  { id: 'vms.delete', method: 'DELETE', path: '/api/vms/{vmId}', title: '删除已停止实例' },
  { id: 'vms.start', method: 'POST', path: '/api/vms/{vmId}/start', title: '启动实例' },
  {
    id: 'vms.stop',
    method: 'POST',
    path: '/api/vms/{vmId}/stop',
    title: '停止实例',
    body: request(z.object({ force: z.boolean().default(false) }).strict()),
  },
  {
    id: 'vms.exec',
    method: 'POST',
    path: '/api/vms/{vmId}/exec',
    title: '执行客户机命令',
    body: request(z.object({ command: z.string().min(1).max(65536) }).strict()),
  },
  {
    id: 'vms.logs',
    method: 'GET',
    path: '/api/vms/{vmId}/logs',
    title: '实例日志',
    response: { type: 'object', properties: { content: string }, required: ['content'] },
  },
  {
    id: 'lockdown.get',
    method: 'GET',
    path: '/api/vms/{vmId}/lockdown',
    title: '应急锁定状态',
    inspect: true,
  },
  {
    id: 'lockdown.set',
    method: 'POST',
    path: '/api/vms/{vmId}/lockdown',
    title: '改变应急锁定状态',
    body: request(z.object({ locked: z.boolean() }).strict()),
  },
  { id: 'jobs.list', method: 'GET', path: '/api/jobs', title: '任务记录' },
  { id: 'jobs.result', method: 'GET', path: '/api/jobs/{jobId}/result', title: '持久化任务结果' },
  { id: 'jobs.cancel', method: 'POST', path: '/api/jobs/{jobId}/cancel', title: '取消任务' },
  { id: 'jobs.retry', method: 'POST', path: '/api/jobs/{jobId}/retry', title: '按原插件规则重试任务' },
  { id: 'events', method: 'GET', path: '/api/events', title: '需要关注的任务事件' },
  { id: 'openapi', method: 'GET', path: '/api/openapi', title: 'OpenAPI 文档' },
  { id: 'sdk', method: 'GET', path: '/api/sdk', title: '生成 JavaScript 客户端文件' },
];
export function apiDocument(active: Iterable<string>, port: number): ApiDocument {
  const enabled = new Set(active);
  const document: ApiDocument = {
    openapi: '3.1.1',
    info: {
      title: 'Sakura 本地控制 API',
      version: '0.1.0',
      description:
        '核心 HTTP 接口及已声明的插件操作。未声明完整响应的核心接口标记 partial；旧插件只列入 x-sakura-route-prefixes，不把分发前缀当作可执行端点。二进制传输和旧接口可通过 SDK 的通用 HTTP 方法访问，参数以功能文档和服务端校验为准。WebSocket 不在本 HTTP 文档和客户端的范围。账户模式启用后请先通过 SDK login 登录；控制凭证只属于当前服务进程。',
    },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    security: [{ LocalControllerToken: [] }],
    components: {
      securitySchemes: { LocalControllerToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Token' } },
    },
    paths: {},
    'x-sakura-route-prefixes': PLUGINS.flatMap((plugin) =>
      plugin.contributes.http.map((route) => ({
        owner: plugin.id,
        ...route,
        enabled: enabled.has(plugin.id),
      })),
    ),
  };
  const add = (
    path: string,
    method: string,
    item: Omit<ApiOperation, 'parameters'> & { parameters?: ApiParameter[] },
  ) => {
    const parameters: ApiParameter[] = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: string,
    }));
    (document.paths[path] ||= {})[method.toLowerCase()] = {
      ...item,
      parameters: [...parameters, ...(item.parameters || [])],
    };
  };
  for (const item of core)
    add(item.path, item.method, {
      operationId: 'core.' + item.id,
      summary: item.title,
      description:
        item.id === 'vms.update'
          ? '需要提交完整配置；实例名称、磁盘容量、发行版不能通过此接口改变。自定义约束继续由服务端执行。'
          : '仅接受本机同源访问。写入请求不应在网络错误后自动重放。',
      tags: ['core'],
      'x-sakura-enabled': true,
      'x-sakura-inspectable': !!item.inspect,
      'x-sakura-contract': item.response ? 'declared' : 'partial',
      ...(item.public ? { security: [] } : {}),
      ...(item.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: item.body } } } }
        : {}),
      responses: {
        [item.status || 200]: response(item.response, item.media),
        default: { description: '接口错误，返回 error 和 code 字段。' },
      },
    });
  for (const [id, contract] of Object.entries(contracts)) {
    const plugin = PLUGINS.find((item) => item.id === id.split('.')[0])!;
    const scoped = plugin.contributes.http.some(
      (route) => route.path === contract.path && route.projectScoped,
    );
    const parameters: ApiParameter[] = scoped
      ? [
          {
            name: 'project',
            in: 'query',
            required: false,
            schema: string,
            description: '省略时使用实例当前项目。',
          },
        ]
      : [];
    if (id === 'sandbox.artifact')
      parameters.push(
        ...['run', 'artifact'].map((name) => ({
          name,
          in: 'query' as const,
          required: true,
          schema: { type: 'string', format: 'uuid' },
        })),
      );
    add(pathName(contract.path), contract.method, {
      operationId: id,
      summary: plugin.name + ' · ' + contract.id,
      description: '参数和响应来自插件声明的 Zod 合约；额外运行条件由服务端校验。',
      tags: [plugin.id],
      parameters,
      'x-sakura-enabled': enabled.has(plugin.id),
      'x-sakura-inspectable': id === 'metrics.sample',
      'x-sakura-contract': 'declared',
      ...(contract.request
        ? { requestBody: { required: true, content: { 'application/json': { schema: contract.request } } } }
        : {}),
      responses: {
        [contract.status]: response(contract.response),
        default: { description: '插件未启用、参数错误、状态冲突或运行失败。' },
      },
    });
  }
  return document;
}
