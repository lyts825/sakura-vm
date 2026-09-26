export type ApiParameter = {
  name: string;
  in: 'path' | 'query';
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
  requestBody?: { required: boolean; content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: Record<string, unknown> }> }
  >;
  security?: Record<string, string[]>[];
  'x-sakura-enabled': boolean;
  'x-sakura-inspectable': boolean;
  'x-sakura-contract': 'declared' | 'partial';
};
export type ApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  security: Record<string, string[]>[];
  components: Record<string, unknown>;
  paths: Record<string, Record<string, ApiOperation>>;
  'x-sakura-route-prefixes': {
    owner: string;
    path: string;
    methods: string[];
    projectScoped: boolean;
    enabled: boolean;
  }[];
};
export function apiPath(
  template: string,
  path: Record<string, string> = {},
  query: Record<string, string> = {},
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
  for (const [key, value] of Object.entries(query)) if (value !== '') url.searchParams.set(key, value);
  return url.pathname + url.search;
}
