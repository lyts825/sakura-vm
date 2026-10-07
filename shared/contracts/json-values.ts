/**
 * 模块职责（中文）：递归 JSON 值类型及运行时 Schema，限制跨 HTTP/插件边界传输的值形状。
 * Module responsibility (English): recursive JSON values crossing transport boundaries.
 * 详细范围（中文）：公开入口包括 jsonValueSchema, JsonValue；职责覆盖跨传输边界的递归 JSON 值，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include jsonValueSchema, JsonValue. The scope covers recursive JSON values crossing transport boundaries. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

/** JSON extension payload: recursively excludes undefined, functions and non-JSON native values. */
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;
