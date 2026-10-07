/**
 * 模块职责：递归 JSON 值类型及运行时 Schema，限制跨 HTTP/插件边界传输的值形状。
 */
import { z } from 'zod';

/** JSON extension payload: recursively excludes undefined, functions and non-JSON native values. */
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;
