import type { z } from 'zod';
import contracts from '../docs/schemas/operations.json' with { type: 'json' };
import { operationDeclarationSchema, type OperationDeclaration } from '../shared/contracts/operations.ts';
import { coreOperations, coreRequestSchema } from './core-operations.ts';
import { pluginHttpRoutes } from './plugins/registry.ts';

export type OperationEntry = {
  declaration: OperationDeclaration;
  /** Exact runtime registration target; security remains entirely in declaration. */
  handler: 'core' | 'plugin-route' | 'plugin-operation' | 'websocket';
  title: string;
  requestSchema?: z.ZodType;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
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
  ...coreOperations.map((item): OperationEntry => ({
    declaration: {
      id: 'core.' + item.id, owner: 'core', method: item.method as OperationDeclaration['method'],
      path: normalize(item.path), ...item.policy,
      contract: item.response || item.status === 204 ? 'declared' : 'partial', enabled: true,
    },
    handler: 'core', title: item.title, requestSchema: coreRequestSchema(item.body) || undefined,
    body: item.body, response: item.response, status: item.status || 200, media: item.media, inspect: item.inspect,
  })),
  ...pluginHttpRoutes().map((route): OperationEntry => {
    const id = route.owner + '.' + route.id;
    const typed = (contracts as Record<string, { id: string; request?: Record<string, unknown> | null; response?: Record<string, unknown>; status: number }>)[id];
    if (route.handler === 'operation' && !typed?.response)
      throw new Error('插件操作缺少响应契约：' + id);
    return {
      declaration: { id, owner: route.owner, method: route.method, path: normalize(route.path), ...route.policy,
        contract: route.handler === 'operation' ? 'declared' : 'partial', enabled: false },
      handler: route.handler === 'operation' ? 'plugin-operation' : 'plugin-route',
      title: typed ? route.owner + ' · ' + typed.id : route.owner + ' · ' + route.method + ' ' + route.path,
      ...(typed?.request ? { body: typed.request } : {}), response: typed?.response,
      status: route.status, inspect: id === 'metrics.sample',
    };
  }),
  ...socketEntries,
];

/** Fail publication before any listener starts, including incomplete policies supplied by plugins. */
export function validateOperationEntries(entries: readonly OperationEntry[]) {
  const keys = new Set<string>(), ids = new Set<string>();
  for (const entry of entries) {
    const declaration = operationDeclarationSchema.parse(entry.declaration);
    const key = declaration.method + ' ' + declaration.path;
    if (keys.has(key) || ids.has(declaration.id)) throw new Error('重复操作声明：' + key);
    if (declaration.method === 'UPGRADE' ? entry.handler !== 'websocket' : entry.handler === 'websocket')
      throw new Error('操作与传输处理器不一致：' + declaration.id);
    if (declaration.transport === 'websocket' && !declaration.socketChannel)
      throw new Error('WebSocket 操作缺少通道声明：' + declaration.id);
    if (declaration.identity !== 'host' && !declaration.path.includes('{vmId}'))
      throw new Error('VM 身份策略缺少明确路径参数：' + declaration.id);
    if (declaration.projectScoped !== (declaration.projectBinding !== 'none'))
      throw new Error('操作项目范围与绑定策略不一致：' + declaration.id);
    if ((declaration.access === 'socket') !== (declaration.transport === 'websocket'))
      throw new Error('操作身份与传输声明不一致：' + declaration.id);
    keys.add(key); ids.add(declaration.id);
  }
}
validateOperationEntries(operationEntries);

export function operationDirectory(active: Iterable<string>) {
  const enabled = new Set(active);
  return operationEntries.map(({ declaration }) => ({ ...declaration,
    enabled: declaration.owner === 'core' || enabled.has(declaration.owner) }));
}
