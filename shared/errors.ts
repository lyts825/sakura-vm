/**
 * 模块职责（中文）：控制面内部错误与公开 API 错误 DTO，安全解码服务端错误并保留状态、错误码和关联标识。
 * Module responsibility (English): Representing internal errors and decoding stable public error envelopes.
 * 详细范围（中文）：公开入口包括 AppError, ApiErrorDto, SakuraApiError, apiResponseError；职责覆盖表示内部错误并解码稳定公开错误信封，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include AppError, ApiErrorDto, SakuraApiError, apiResponseError. The scope covers Representing internal errors and decoding stable public error envelopes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export class AppError extends Error {
  /**
   * 中文：初始化 AppError 的注入依赖和 实例字段，后续方法复用这组能力和配置
   * English: Initialize AppError injected dependencies and instance fields for reuse by subsequent methods
   * 中文：输入：message：签名所示 string 业务值；status：此处理器的调用值（缺省 400）；code：签名所示 string 业务值
   * English: Inputs: message: the string domain value in the signature; status: the invocation value for this handler (default 400); code: the string domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  constructor(
    message: string,
    public status = 400,
    public code?: string,
  ) {
    super(message);
  }
}

/** Stable public envelope. Internal exception messages and filesystem paths never belong here. */
export type ApiErrorDto = {
  error: string;
  code: string;
  correlationId: string;
  operationResult?: {
    correlationId: string;
    outcome: 'pending' | 'succeeded' | 'failed' | 'unknown';
    executed: boolean;
    query?: string;
  };
  auditFailure?: { code: 'AUDIT_UNAVAILABLE' };
};

export class SakuraApiError extends Error {
  readonly name = 'SakuraApiError';
  /**
   * 中文：初始化 SakuraApiError 的注入依赖和 实例字段，后续方法复用这组能力和配置
   * English: Initialize SakuraApiError injected dependencies and instance fields for reuse by subsequent methods
   * 中文：输入：message：签名所示 string 业务值；status：签名所示 number 业务值；code：签名所示 string 业务值；correlationId：签名所示 string 业务值；operationResult：签名所示 ApiErrorDto['operationResult'] 业务值；auditFailure：签名所示 ApiErrorDto['auditFailure'] 业务值
   * English: Inputs: message: the string domain value in the signature; status: the number domain value in the signature; code: the string domain value in the signature; correlationId: the string domain value in the signature; operationResult: the ApiErrorDto['operationResult'] domain value in the signature; auditFailure: the ApiErrorDto['auditFailure'] domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly correlationId?: string,
    public readonly operationResult?: ApiErrorDto['operationResult'],
    public readonly auditFailure?: ApiErrorDto['auditFailure'],
  ) {
    super(message + (correlationId ? `（关联 ID：${correlationId}）` : ''));
  }
}
/**
 * 中文：从未知 HTTP 错误数据提取稳定消息、code、关联 ID、操作结果与审计失败证据，缺失字段使用明确 HTTP 回退，返回 SakuraApiError。
 * English: Extract stable message/code/correlation ID/operation outcome/audit-failure evidence from unknown HTTP error data, use explicit HTTP fallbacks for absent fields and return SakuraApiError.
 * 中文：输入：status：签名所示 number 业务值；value：待校验、转换或保存的输入值
 * English: Inputs: status: the number domain value in the signature; value: input value to validate/transform/save
 * 中文：结果：SakuraApiError，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: SakuraApiError carrying the described computation/transport result; throwing branches do not provide success
 */
export function apiResponseError(status: number, value: unknown): SakuraApiError {
  const failure = value && typeof value === 'object' ? (value as Partial<ApiErrorDto>) : {};
  return new SakuraApiError(
    typeof failure.error === 'string' ? failure.error : `请求失败（${status}）`,
    status,
    typeof failure.code === 'string' ? failure.code : 'HTTP_ERROR',
    typeof failure.correlationId === 'string' ? failure.correlationId : undefined,
    failure.operationResult,
    failure.auditFailure,
  );
}
