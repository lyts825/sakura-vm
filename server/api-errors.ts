/**
 * 模块职责：将内部错误转换为稳定的公开 API 错误分类，避免暴露内部异常细节。
 * Module purpose: Maps internal failures to stable public API categories without exposing private exception details.
 */
import { ZodError } from 'zod';
import { AppError, type ApiErrorDto } from '../shared/errors.ts';
import { auditFailure } from './audit.ts';

/**
 * 入口 / Entry: publicApiFailure.
 * 功能：在将内部错误转换为稳定的公开 API 错误分类中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ status, dto }` 供上层消费（`api-errors.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `api-errors.ts`; this entry produces `{ status, dto }` for its caller. Module context: Maps internal failures to stable public API categories without exposing private exception details.
 * 处理：通过 `inline.test`, `auditFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `auditFailure`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: error: unknown; correlationId: string; auditFailed: default=false
 * 输出 / Returns: `{ status, dto }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function publicApiFailure(error: unknown, correlationId: string, auditFailed = false) {
  const status = error instanceof ZodError ? 400 : error instanceof AppError ? error.status : 500;
  const codes: Record<number, string> = {
    400: 'INVALID_INPUT',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    423: 'SESSION_LOCKED',
    503: 'UNAVAILABLE',
  };
  const code =
    error instanceof AppError && error.code && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code)
      ? error.code
      : codes[status] || 'INTERNAL_ERROR';
  const messages: Record<number, string> = {
    400: '请求参数不符合契约',
    401: '访问凭证已过期，请重新登录或刷新页面',
    403: '当前账户没有此操作权限',
    404: '请求的资源不存在',
    405: '不支持此请求方法',
    409: '操作状态发生冲突，请刷新后核对',
    413: '请求内容超过限制',
    415: '请求媒体类型不符合契约',
    423: '控制面已锁定，请先解锁',
  };
  const availabilityMessages: Record<string, string> = {
    SERVICE_UNAVAILABLE: '此功能暂不可用，请查看插件中心的启动诊断，修复后重启',
    OPERATION_RESULTS_FULL: '未确认操作已达上限，请管理员核对并归档操作回执后重试',
    OPERATION_ARCHIVES_FULL: '操作结果档案已满，请管理员保管并迁移旧档案后重试',
    OPERATION_ARCHIVE_UNAVAILABLE: '操作结果档案需要检查，原证据已保留',
  };
  const message = availabilityMessages[code] || (
    code === 'AUDIT_UNAVAILABLE'
      ? '审计记录暂不可用，请查询操作结果后再决定是否重试'
      : code === 'INVALID_OPERATION_RESPONSE'
        ? '操作响应校验失败，请查询操作结果后再决定是否重试'
        : '服务操作失败');
  const dto: ApiErrorDto = {
    error: messages[status] || message,
    code,
    correlationId,
    ...(auditFailed || auditFailure(error) ? { auditFailure: { code: 'AUDIT_UNAVAILABLE' as const } } : {}),
  };
  return { status, dto };
}
