/**
 * 模块职责：控制面内部错误与公开 API 错误 DTO，安全解码服务端错误并保留状态、错误码和关联标识。
 */
export class AppError extends Error {
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
