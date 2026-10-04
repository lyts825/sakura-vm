import { z } from 'zod';
import type { HttpResponseContract } from '../shared/contracts/http-response.ts';
import contracts from '../docs/schemas/operations.json' with { type: 'json' };
import { operationDeclarationSchema, type OperationDeclaration } from '../shared/contracts/operations.ts';
import { coreOperations, coreRequestSchema, coreResponseContracts } from './core-operations.ts';
import { pluginRouteResponses } from '../shared/contracts/plugin-route-responses.ts';
import { pluginHttpRoutes } from './plugins/registry.ts';
import { requestContract, wireRequestSchema, type HttpRequestContract } from './http-request-contracts.ts';
import { socketContracts, socketContractSchema, type SocketContract } from '../shared/contracts/websocket.ts';

export type OperationEntry = {
  declaration: OperationDeclaration;
  /** Exact runtime registration target; security remains entirely in declaration. */
  handler: 'core' | 'plugin-route' | 'plugin-operation' | 'websocket';
  title: string;
  requestSchema?: z.ZodType;
  requestContract?: HttpRequestContract;
  socketContract?: SocketContract;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  responseContract?: HttpResponseContract;
  status: number;
  media?: string;
  inspect?: boolean;
};
const normalize = (path: string) => path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
const socketEntries: OperationEntry[] = [
  {
    "declaration": {
      "id": "core.socket.events",
      "owner": "core",
      "method": "UPGRADE",
      "path": "/ws/events",
      "access": "socket",
      "roles": [
        "owner"
      ],
      "projectScoped": false,
      "identity": "host",
      "maintenance": "allow",
      "transport": "websocket", "mutating": false,
      "contract": "partial",
      "enabled": true,
      "session": "required",
      "vmLock": "allow-locked",
      "projectBinding": "none",
      "approval": "none",
      "extensionAuth": "none",
      "socketChannel": "events"
    },
    "status": 101,
    "handler": "websocket",
    "title": "WebSocket events"
  },
  {
    "declaration": {
      "id": "core.socket.terminal",
      "owner": "core",
      "method": "UPGRADE",
      "path": "/ws/{vmId}/terminal",
      "access": "socket",
      "roles": [
        "owner"
      ],
      "projectScoped": true,
      "identity": "fixed-vm",
      "maintenance": "block",
      "transport": "websocket", "mutating": false,
      "contract": "partial",
      "enabled": true,
      "session": "required",
      "vmLock": "require-unlocked",
      "projectBinding": "query",
      "approval": "none",
      "extensionAuth": "none",
      "executionOwner": "core", "sessionOwner": "terminal-workspace", "socketChannel": "terminal"
    },
    "status": 101,
    "handler": "websocket",
    "title": "WebSocket terminal"
  },
  {
    "declaration": {
      "id": "core.socket.terminal-view",
      "owner": "core",
      "method": "UPGRADE",
      "path": "/ws/{vmId}/terminal-view",
      "access": "socket",
      "roles": [
        "owner",
        "viewer"
      ],
      "projectScoped": true,
      "identity": "fixed-vm",
      "maintenance": "block",
      "transport": "websocket", "mutating": false,
      "contract": "partial",
      "enabled": true,
      "session": "required",
      "vmLock": "require-unlocked",
      "projectBinding": "legacy-terminal-grant",
      "approval": "none",
      "extensionAuth": "none",
      "executionOwner": "core", "sessionOwner": "terminal-workspace", "socketChannel": "terminal-view"
    },
    "status": 101,
    "handler": "websocket",
    "title": "WebSocket terminal-view"
  },
  {
    "declaration": {
      "id": "core.socket.logs",
      "owner": "core",
      "method": "UPGRADE",
      "path": "/ws/{vmId}/logs",
      "access": "socket",
      "roles": [
        "owner"
      ],
      "projectScoped": false,
      "identity": "fixed-vm",
      "maintenance": "allow",
      "transport": "websocket", "mutating": false,
      "contract": "partial",
      "enabled": true,
      "session": "required",
      "vmLock": "allow-locked",
      "projectBinding": "none",
      "approval": "none",
      "extensionAuth": "none",
      "socketChannel": "logs"
    },
    "status": 101,
    "handler": "websocket",
    "title": "WebSocket logs"
  },
  {
    "declaration": {
      "id": "core.socket.desktop",
      "owner": "core",
      "method": "UPGRADE",
      "path": "/ws/{vmId}/desktop",
      "access": "socket",
      "roles": [
        "owner"
      ],
      "projectScoped": true,
      "identity": "fixed-vm",
      "maintenance": "block",
      "transport": "websocket", "mutating": false,
      "contract": "partial",
      "enabled": true,
      "session": "required",
      "vmLock": "require-unlocked",
      "projectBinding": "query",
      "approval": "none",
      "extensionAuth": "none",
      "executionOwner": "desktop", "socketChannel": "desktop"
    },
    "status": 101,
    "handler": "websocket",
    "title": "WebSocket desktop"
  },
  {
    "declaration": {
      "id": "core.socket.desktop-view",
      "owner": "core",
      "method": "UPGRADE",
      "path": "/ws/{vmId}/desktop-view",
      "access": "socket",
      "roles": [
        "owner",
        "viewer"
      ],
      "projectScoped": true,
      "identity": "fixed-vm",
      "maintenance": "block",
      "transport": "websocket", "mutating": false,
      "contract": "partial",
      "enabled": true,
      "session": "required",
      "vmLock": "require-unlocked",
      "projectBinding": "query",
      "approval": "none",
      "extensionAuth": "none",
      "executionOwner": "desktop", "socketChannel": "desktop-view"
    },
    "status": 101,
    "handler": "websocket",
    "title": "WebSocket desktop-view"
  }
];

export const operationEntries: readonly OperationEntry[] = [
  ...coreOperations.map((item): OperationEntry => {
    const input = requestContract('core.' + item.id, item.policy, item.method, coreRequestSchema(item.body) || undefined, item.body);
    return ({
    declaration: {
      id: 'core.' + item.id, owner: 'core', method: item.method as OperationDeclaration['method'],
      path: normalize(item.path), ...item.policy,
      contract: coreResponseContracts[item.id] ? 'declared' : 'partial', enabled: true,
      request: { kind: input.kind, required: input.required, ...(input.media ? { media: input.media } : {}) },
    },
    handler: 'core', title: item.title, requestSchema: input.schema, requestContract: input,
    body: input.schema ? wireRequestSchema(input.schema) : undefined,
    response: item.response, responseContract: coreResponseContracts[item.id],
    status: item.status || 200, media: coreResponseContracts[item.id]?.media || item.media, inspect: item.inspect,
  }); }),
  ...pluginHttpRoutes().map((route): OperationEntry => {
    const id = route.owner + '.' + route.id;
    const responseContract = (pluginRouteResponses as Readonly<Record<string, HttpResponseContract>>)[id];
    const typed = (contracts as Record<string, { id: string; request?: Record<string, unknown> | null; response?: Record<string, unknown> | null; status: number }>)[id];
    if (route.handler === 'operation' && !typed?.response)
      throw new Error('插件操作缺少响应契约：' + id);
    const input = requestContract(id, route.policy, route.method, undefined, typed?.request || undefined);
    return {
      declaration: { id, owner: route.owner, method: route.method, path: normalize(route.path), ...route.policy,
        contract: responseContract ? 'declared' : 'partial', enabled: false,
        request: { kind: input.kind, required: input.required, ...(input.media ? { media: input.media } : {}) } },
      handler: route.handler === 'operation' ? 'plugin-operation' : 'plugin-route',
      title: typed ? route.owner + ' · ' + typed.id : route.owner + ' · ' + route.method + ' ' + route.path,
      requestSchema: input.schema, requestContract: input,
      ...(input.schema ? { body: wireRequestSchema(input.schema, typed?.request || undefined) } : {}),
      response: responseContract?.schema ? z.toJSONSchema(responseContract.schema) : undefined,
      responseContract, media: responseContract?.media,
      status: responseContract?.statuses[0] ?? route.status, inspect: id === 'metrics.sample',
    };
  }),
  ...socketEntries.map(entry => {
    const input = requestContract(entry.declaration.id, entry.declaration, 'UPGRADE');
    const socketContract = socketContracts[entry.declaration.socketChannel!];
    return { ...entry, requestContract: input, socketContract, declaration: { ...entry.declaration, contract: 'declared' as const,
      socketContract,
      request: { kind: input.kind, required: false } } };
  }),
];

/** Fail publication before any listener starts, including incomplete policies supplied by plugins. */
export function validateOperationEntries(entries: readonly OperationEntry[]) {
  const keys = new Set<string>(), ids = new Set<string>();
  for (const entry of entries) {
    const declaration = operationDeclarationSchema.parse(entry.declaration);
    if (!entry.requestContract || !declaration.request)
      throw new Error('操作缺少明确请求契约：' + declaration.id);
    const input = entry.requestContract;
    if (declaration.request.kind !== input.kind || declaration.request.required !== input.required ||
      declaration.request.media !== input.media ||
      ((input.kind === 'json' || input.kind === 'form') && !input.schema))
      throw new Error('操作输入声明与实际请求协议不一致：' + declaration.id);
    const key = declaration.method + ' ' + declaration.path;
    if (keys.has(key) || ids.has(declaration.id)) throw new Error('重复操作声明：' + key);
    if (declaration.method === 'UPGRADE' ? entry.handler !== 'websocket' : entry.handler === 'websocket')
      throw new Error('操作与传输处理器不一致：' + declaration.id);
    if (declaration.transport === 'websocket' && !declaration.socketChannel)
      throw new Error('WebSocket 操作缺少通道声明：' + declaration.id);
    if (declaration.transport === 'websocket') {
      const expected = socketContracts[declaration.socketChannel!];
      const actual = socketContractSchema.parse(entry.socketContract);
      if (declaration.contract !== 'declared' || JSON.stringify(actual) !== JSON.stringify(expected) ||
        JSON.stringify(declaration.socketContract) !== JSON.stringify(expected))
        throw new Error('WebSocket 帧协议与真实通道不匹配：' + declaration.id);
    } else if (entry.socketContract || declaration.socketContract)
      throw new Error('HTTP操作不能声明WebSocket帧协议：' + declaration.id);
    if (declaration.identity !== 'host' && !declaration.path.includes('{vmId}'))
      throw new Error('VM 身份策略缺少明确路径参数：' + declaration.id);
    if (declaration.projectScoped !== (declaration.projectBinding !== 'none'))
      throw new Error('操作项目范围与绑定策略不一致：' + declaration.id);
    if ((declaration.access === 'socket') !== (declaration.transport === 'websocket'))
      throw new Error('操作身份与传输声明不一致：' + declaration.id);
    if (declaration.method !== 'UPGRADE') {
      const contract = entry.responseContract;
      if (!contract || declaration.contract !== 'declared')
        throw new Error('HTTP 操作缺少响应契约，禁止发布：' + declaration.id);
      if (!contract.statuses.length || entry.status < 200 || entry.status >= 300 || !contract.statuses.includes(entry.status) ||
        contract.statuses.some(status => !Number.isInteger(status) || status < 200 || status > 599))
        throw new Error('HTTP 响应状态声明无效：' + declaration.id);
      if (contract.kind === 'json' && (!contract.schema || !entry.response))
        throw new Error('JSON 响应缺少结构声明：' + declaration.id);
      if (contract.kind !== 'empty' && !contract.media)
        throw new Error('HTTP 响应缺少媒体类型：' + declaration.id);
      if (contract.kind === 'empty' && contract.statuses.some(status => status !== 204 && status !== 205))
        throw new Error('空响应状态声明无效：' + declaration.id);
    }
    keys.add(key); ids.add(declaration.id);
  }
}
validateOperationEntries(operationEntries);

export function operationDirectory(active: Iterable<string>) {
  const enabled = new Set(active);
  return operationEntries.map(({ declaration }) => ({ ...declaration,
    enabled: declaration.owner === 'core' || enabled.has(declaration.owner) }));
}
