/**
 * 模块职责（中文）：公开 HTTP 响应契约元数据，描述状态码、响应模式和运行时校验器。
 * Module responsibility (English): public HTTP status, transport modes and validators.
 * 详细范围（中文）：公开入口包括 HttpResponseContract；职责覆盖公开 HTTP 状态、传输模式和校验器，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HttpResponseContract. The scope covers public HTTP status, transport modes and validators. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { z } from 'zod';

/** Wire response contract, independent of HTTP handlers and implementation classes. */
export type HttpResponseContract = {
  kind: 'json' | 'text' | 'binary' | 'event-stream' | 'empty';
  statuses: readonly number[];
  media?: string;
  schema?: z.ZodType;
};
