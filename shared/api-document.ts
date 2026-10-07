/**
 * 模块职责（中文）：定义 API 文档与操作参数的公共形状，并规范化操作路径。
 * Module responsibility (English): Defining API-document structures and safely filling path/query parameters.
 * 详细范围（中文）：公开入口包括 ApiParameter, ApiOperation, ApiDocument, apiPath；职责覆盖定义 API 文档结构并安全填充路径和查询参数，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ApiParameter, ApiOperation, ApiDocument, apiPath. The scope covers Defining API-document structures and safely filling path/query parameters. Types, validation branches and cleanup paths define its data/behavior boundaries
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
/**
 * 中文：按操作描述填充并编码必需路径参数和查询参数，缺少参数时拒绝；空查询值不生成多余键。
 * English: Fill/encode required path and query parameters from an operation description, rejecting missing parameters and omitting absent query values.
 * 中文：输入：template：签名所示 string 业务值；path：目标文件或请求路径（缺省 {}）；query：签名所示 Record<string, string | undefined> 业务值（缺省 {}）
 * English: Inputs: template: the string domain value in the signature; path: target file/request path (default {}); query: the Record<string, string | undefined> domain value in the signature (default {})
 * 中文：拒绝原因：无效 API 路径。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 无效 API 路径. These errors reach the direct caller or this function's catch handler
 */
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
