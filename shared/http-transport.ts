/**
 * 模块职责：统一按请求查询解析请求体模式，并把 JSON、原始数据或表单请求体编码到线上格式。
 */
/** Query-dependent body modes are shared by admission and both generated clients. */
export function resolveOperationBody(
  contract: { kind: 'none' | 'json' | 'form' | 'binary'; required: boolean; bodylessQuery?: string },
  query: Record<string, unknown> = {},
): { kind: 'none' | 'json' | 'form' | 'binary'; required: boolean } {
  const value = contract.bodylessQuery && Object.hasOwn(query, contract.bodylessQuery)
    ? query[contract.bodylessQuery] : undefined;
  return value !== undefined && value !== null
    ? { kind: 'none', required: false }
    : { kind: contract.kind, required: contract.required };
}

/** Dependency-free wire encoder; the generated SDK embeds this same implementation. */
export function encodeOperationBody(
  kind: 'none' | 'json' | 'form' | 'binary',
  body: unknown,
  supplied: Record<string, string> = {},
): { headers: Record<string, string>; body?: BodyInit } {
  const headers = { ...supplied };
  if (kind === 'none') {
    if (body !== undefined) throw new Error('此操作不接受请求体');
    return { headers };
  }
  if (body === undefined) return { headers };
  const media =
    kind === 'json'
      ? 'application/json'
      : kind === 'form'
        ? 'application/x-www-form-urlencoded'
        : 'application/octet-stream';
  const contentKeys = Object.keys(headers).filter((key) => key.toLowerCase() === 'content-type');
  if (contentKeys.some((key) => headers[key].split(';')[0].trim().toLowerCase() !== media))
    throw new Error('请求媒体类型不符合操作契约');
  for (const key of contentKeys) delete headers[key];
  headers['Content-Type'] = kind === 'form' ? media + '; charset=utf-8' : media;
  if (kind === 'json') return { headers, body: JSON.stringify(body) };
  if (kind === 'binary') return { headers, body: body as BodyInit };
  if (body instanceof URLSearchParams) return { headers, body };
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('表单需要字段对象');
  return {
    headers,
    body: new URLSearchParams(
      Object.entries(body).map(([key, value]) => {
        if (typeof value !== 'string') throw new Error('表单字段必须是字符串');
        return [key, value];
      }),
    ),
  };
}
