/**
 * 模块职责：定义 API 文档与操作参数的公共形状，并规范化操作路径。
 */
import type { OperationDeclaration } from './contracts/operations.ts';

export type ApiParameter = {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: Record<string, unknown>;
  description?: string;
};
export type ApiOperation = {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: ApiParameter[];
  requestBody?: { required: boolean; description?: string; content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: Record<string, unknown> }> }
  >;
  security?: Record<string, string[]>[];
  'x-sakura-enabled': boolean;
  'x-sakura-inspectable': boolean;
  'x-sakura-contract': 'declared' | 'partial';
  'x-sakura-operation'?: OperationDeclaration;
  'x-sakura-response'?: { kind: 'json' | 'text' | 'binary' | 'event-stream' | 'empty' };
};
export type ApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  security: Record<string, string[]>[];
  components: Record<string, unknown>;
  paths: Record<string, Record<string, ApiOperation>>;
  'x-sakura-operations'?: OperationDeclaration[];
  'x-sakura-catalog-version'?: number;
  'x-sakura-route-prefixes': {
    owner: string;
    path: string;
    methods: string[];
    projectScoped: boolean;
    enabled: boolean;
  }[];
};
// 路径模板只替换单个安全路径段；查询参数交给 URLSearchParams 编码，不能通过参数注入额外路由层级。
export function apiPath(
  template: string,
  path: Record<string, string> = {},
  query: Record<string, string | undefined> = {},
) {
  if (!template.startsWith('/api/') || template.includes('?') || template.includes('#'))
    throw new Error('无效 API 路径');
  const filled = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = path[key];
    if (!value || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value))
      throw new Error(`路径参数 ${key} 无效`);
    return encodeURIComponent(value);
  });
  const url = new URL(filled, 'http://localhost');
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url.pathname + url.search;
}
