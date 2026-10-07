/**
 * 模块职责：从操作目录生成公开 OpenAPI 文档，保持请求和响应说明与服务声明一致。
 * Module purpose: Generates public OpenAPI documentation from operations so request/response contracts remain aligned with declarations.
 */
import { PLUGINS } from '../shared/plugins.ts';
import type { ApiDocument, ApiParameter } from '../shared/api-document.ts';
import { operationDirectory, operationEntries } from './operation-catalog.ts';
import { APP_VERSION } from '../shared/version.ts';
import { z } from 'zod';

/**
 * 入口 / Entry: apiDocument.
 * 功能：从已声明操作及当前启用插件生成 OpenAPI 请求、响应和权限文档。
 * Purpose: Generates OpenAPI request/response/authority documentation from declared operations and enabled plugins.
 * 设计：只发布目录中可核对的契约，文档生成不加载任意插件实现或执行领域动作。
 * Design: Only verifiable catalogue contracts are published; generation does not execute domain actions or arbitrary plugin implementations.
 * 输入 / Inputs: active: Iterable<string>; port: number; catalogVersion: default=0
 * 输出 / Returns: ApiDocument；结果来自 / values from `document`.
 * 副作用 / Effects: `parameters.push`; 更新 / updates `(document.paths[policy.path] ||= {})[policy.method.toLowerCase()]`, `document.paths[policy.path]`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function apiDocument(active: Iterable<string>, port: number, catalogVersion = 0): ApiDocument {
  const enabled = new Set(active);
  const directory = operationDirectory(enabled);
  const document: ApiDocument = {
    openapi: '3.1.1',
    info: {
      title: 'Sakura 本地控制 API',
      version: APP_VERSION,
      description:
        'HTTP、插件和 WebSocket 使用同一操作与权限声明。partial 表示响应结构尚未完整声明；专用下载票据、扩展和客户机入口继续使用各自凭证。写请求不会自动重放。',
    },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    security: [{ LocalControllerToken: [] }],
    components: {
      securitySchemes: {
        LocalControllerToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Token' },
        ExtensionToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Extension-Token' },
        GuestToken: { type: 'apiKey', in: 'header', name: 'X-Sakura-Guest-Token' },
      },
    },
    paths: {},
    'x-sakura-operations': directory,
    'x-sakura-catalog-version': catalogVersion,
    'x-sakura-route-prefixes': PLUGINS.flatMap((plugin) =>
      plugin.contributes.http.map((route) => ({
        owner: plugin.id,
        ...route,
        enabled: enabled.has(plugin.id),
      })),
    ),
  };
  for (const [index, entry] of operationEntries.entries()) {
    const policy = directory[index];
    if (policy.method === 'UPGRADE') continue;
    const response = entry.responseContract;
    const parameters: ApiParameter[] = [...policy.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    for (const [location, schema] of [['query', entry.requestContract!.query], ['header', entry.requestContract!.headers]] as const) {
      const json = z.toJSONSchema(schema, { io: 'input' });
      for (const [name, value] of Object.entries(json.properties || {})) parameters.push({ name, in: location,
        required: (json.required || []).includes(name), schema: value as Record<string, unknown> });
    }
    const security =
      policy.access === 'controller'
        ? undefined
        : policy.access === 'guest'
          ? [{ GuestToken: [] }]
          : policy.extensionAuth === 'paired'
            ? [{ ExtensionToken: [] }]
            : [];
    (document.paths[policy.path] ||= {})[policy.method.toLowerCase()] = {
      operationId: policy.id,
      summary: entry.title,
      description:
        policy.id === 'core.vms.update'
          ? '需要提交完整配置；实例名称、磁盘容量、发行版不能通过此接口改变。'
          : '入口与资源排队后均按本操作的权限、项目和运行身份重新校验。',
      tags: [policy.owner],
      parameters,
      'x-sakura-enabled': policy.enabled,
      'x-sakura-inspectable': !!entry.inspect,
      'x-sakura-contract': policy.contract,
      'x-sakura-operation': policy,
      'x-sakura-response': { kind: response!.kind },
      ...(security ? { security } : {}),
      ...(entry.requestContract?.kind !== 'none'
        ? {
            requestBody: {
              required: entry.requestContract!.required && !entry.requestContract!.bodylessQuery,
              ...(entry.requestContract!.bodylessQuery ? { description:
                `未提供查询参数 ${entry.requestContract!.bodylessQuery} 时必须发送 JSON 正文；提供该参数时禁止发送正文。` } : {}),
              content: {
                [entry.requestContract!.media!]: {
                  schema: entry.body || { type: 'string', format: 'binary' },
                },
              },
            },
          }
        : {}),
      responses: {
        ...Object.fromEntries((response?.statuses || [entry.status]).map(status => [status, {
          description: status >= 400 ? '协议错误响应' : '成功',
          ...(response?.kind === 'empty' ? {} : {
            content: { [response?.media || entry.media || 'application/json']: {
              schema: entry.response || { type: 'string',
                ...(response?.kind === 'binary' ? { format: 'binary' } : {}) },
            } },
          }),
        }])),
        default: { description: '参数、权限、维护状态、运行身份变化或运行失败。' },
      },
    };
  }
  return document;
}
