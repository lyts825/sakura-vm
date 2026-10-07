/**
 * 模块职责：公开 HTTP 响应契约元数据，描述状态码、响应模式和运行时校验器。
 */
import type { z } from 'zod';

/** Wire response contract, independent of HTTP handlers and implementation classes. */
export type HttpResponseContract = {
  kind: 'json' | 'text' | 'binary' | 'event-stream' | 'empty';
  statuses: readonly number[];
  media?: string;
  schema?: z.ZodType;
};
