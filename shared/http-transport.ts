/**
 * 模块职责（中文）：统一按请求查询解析请求体模式，并把 JSON、原始数据或表单请求体编码到线上格式。
 * Module responsibility (English): Resolving body modes and encoding wire data according to contracts.
 * 详细范围（中文）：公开入口包括 resolveOperationBody, encodeOperationBody；职责覆盖解析请求体模式并按契约编码线上数据，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include resolveOperationBody, encodeOperationBody. The scope covers Resolving body modes and encoding wire data according to contracts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
/** Query-dependent body modes are shared by admission and both generated clients. */
/**
 * 中文：只有显式存在且非 null 的 bodylessQuery 查询值才禁用正文要求，否则沿用声明正文类型及 required，避免缺失查询误当无正文。
 * English: Disable body requirements only for an explicitly present/nonnull bodylessQuery value; otherwise retain declared kind/required, avoiding treating absent queries as bodyless.
 * 中文：输入：contract：签名所示 { kind: 'none' | 'json' | 'form' | 'binary'; required: boolean; bodylessQuery?: string } 业务值；query：签名所示 Record<string, unknown> 业务值（缺省 {}）
 * English: Inputs: contract: the { kind: 'none' | 'json' | 'form' | 'binary'; required: boolean; bodylessQuery?: string } domain value in the signature; query: the Record<string, unknown> domain value in the signature (default {})
 * 中文：结果：{ kind: 'none' | 'json' | 'form' | 'binary'; required: boolean }，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: { kind: 'none' | 'json' | 'form' | 'binary'; required: boolean } carrying the described computation/transport result; throwing branches do not provide success
 */
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
/**
 * 中文：按 none/json/binary/form 契约编码正文，统一 Content-Type 大小写并拒绝冲突媒体类型；表单仅接受字符串字段，不隐式转换复杂值。
 * English: Encode none/json/binary/form bodies, normalize Content-Type casing and reject conflicting media types. Forms accept only string fields instead of silently coercing complex values.
 * 中文：输入：kind：签名所示 'none' | 'json' | 'form' | 'binary' 业务值；body：待按操作契约编码的请求正文；supplied：签名所示 Record<string, string> 业务值（缺省 {}）
 * English: Inputs: kind: the 'none' | 'json' | 'form' | 'binary' domain value in the signature; body: request body to encode under the operation contract; supplied: the Record<string, string> domain value in the signature (default {})
 * 中文：结果：包含 headers 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing headers for caller state reads/operations
 * 中文：拒绝原因：此操作不接受请求体；请求媒体类型不符合操作契约；表单需要字段对象。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 此操作不接受请求体; 请求媒体类型不符合操作契约; 表单需要字段对象. These errors reach the direct caller or this function's catch handler
 */
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
